import { Router, Request, Response, NextFunction } from 'express';
import { and, asc, count, desc, eq, gt, inArray, lt, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { shoppingList, shoppingListCategory, shoppingListItem, shoppingListItemImage } from '../schema/shopping';
import { ingredient } from '../schema/ingredient';
import { user } from '../schema/auth';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { upload, validateImageBuffer } from '../lib/upload';
import { uploadImage, deleteImage, extractPublicId } from '../lib/cloudinary';

const router = Router();
router.use(requireAuth);
router.use(requireHousehold);

router.use(async (req: Request, res: Response, next: NextFunction) => {
  const [s] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(eq(shoppingList.householdId, req.householdId))
    .limit(1);
  if (!s) { res.status(500).json({ error: 'Shopping list not found' }); return; }
  req.shoppingListId = s.id;
  next();
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

const createItemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  categoryId: z.string().uuid().nullable().optional(),
  ingredientId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  source: z.enum(['RECIPE', 'PANTRY', 'DIRECT']).optional(),
});

const updateItemSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  isChecked: z.boolean().optional(),
});

// ─── Category routes ──────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  const categories = await db
    .select()
    .from(shoppingListCategory)
    .where(eq(shoppingListCategory.shoppingListId, req.shoppingListId))
    .orderBy(asc(shoppingListCategory.name));
  res.json(categories);
});

router.post('/categories', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [existing] = await db
    .select({ id: shoppingListCategory.id })
    .from(shoppingListCategory)
    .where(and(
      eq(shoppingListCategory.shoppingListId, req.shoppingListId),
      eq(shoppingListCategory.name, parsed.data.name)
    ))
    .limit(1);
  if (existing) { res.status(409).json({ error: 'A category with this name already exists' }); return; }

  const [created] = await db
    .insert(shoppingListCategory)
    .values({ shoppingListId: req.shoppingListId, name: parsed.data.name })
    .returning();
  res.status(201).json(created);
});

router.patch('/categories/:id', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [cat] = await db
    .select({ id: shoppingListCategory.id })
    .from(shoppingListCategory)
    .where(and(
      eq(shoppingListCategory.id, req.params.id),
      eq(shoppingListCategory.shoppingListId, req.shoppingListId)
    ))
    .limit(1);
  if (!cat) { res.status(404).json({ error: 'Category not found' }); return; }

  const [updated] = await db
    .update(shoppingListCategory)
    .set({ name: parsed.data.name })
    .where(eq(shoppingListCategory.id, req.params.id))
    .returning();
  res.json(updated);
});

router.delete('/categories/:id', async (req, res) => {
  const [cat] = await db
    .select({ id: shoppingListCategory.id })
    .from(shoppingListCategory)
    .where(and(
      eq(shoppingListCategory.id, req.params.id),
      eq(shoppingListCategory.shoppingListId, req.shoppingListId)
    ))
    .limit(1);
  if (!cat) { res.status(404).json({ error: 'Category not found' }); return; }

  const targetCategoryId = typeof req.body?.targetCategoryId === 'string' ? req.body.targetCategoryId : null;

  if (targetCategoryId) {
    const [target] = await db
      .select({ id: shoppingListCategory.id })
      .from(shoppingListCategory)
      .where(and(eq(shoppingListCategory.id, targetCategoryId), eq(shoppingListCategory.shoppingListId, req.shoppingListId)))
      .limit(1);
    if (target) {
      await db.update(shoppingListItem).set({ categoryId: targetCategoryId }).where(eq(shoppingListItem.categoryId, req.params.id));
    }
  } else {
    // Find or create Misc category and move items there
    let [misc] = await db
      .select({ id: shoppingListCategory.id })
      .from(shoppingListCategory)
      .where(and(eq(shoppingListCategory.shoppingListId, req.shoppingListId), eq(shoppingListCategory.name, 'Misc')))
      .limit(1);
    if (!misc) {
      const [created] = await db.insert(shoppingListCategory).values({ shoppingListId: req.shoppingListId, name: 'Misc' }).returning();
      misc = created;
    }
    await db.update(shoppingListItem).set({ categoryId: misc.id }).where(eq(shoppingListItem.categoryId, req.params.id));
  }

  await db.delete(shoppingListCategory).where(eq(shoppingListCategory.id, req.params.id));
  res.json({ message: 'Category deleted' });
});

// ─── Item routes ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/items', async (req, res) => {
  const rawCategoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const categoryId = rawCategoryId && UUID_RE.test(rawCategoryId) ? rawCategoryId : undefined;
  const addedByUserId = typeof req.query.addedByUserId === 'string' ? req.query.addedByUserId : undefined;
  const isChecked =
    req.query.isChecked === 'true' ? true
    : req.query.isChecked === 'false' ? false
    : undefined;

  const conditions = [eq(shoppingListItem.shoppingListId, req.shoppingListId)];
  if (categoryId) conditions.push(eq(shoppingListItem.categoryId, categoryId));
  if (isChecked !== undefined) conditions.push(eq(shoppingListItem.isChecked, isChecked));
  if (addedByUserId) conditions.push(eq(shoppingListItem.addedByUserId, addedByUserId));

  const rows = await db
    .select({
      id: shoppingListItem.id,
      name: shoppingListItem.name,
      categoryId: shoppingListItem.categoryId,
      categoryName: shoppingListCategory.name,
      ingredientId: shoppingListItem.ingredientId,
      addedByUserId: shoppingListItem.addedByUserId,
      addedByUserName: user.name,
      sortOrder: shoppingListItem.sortOrder,
      quantity: shoppingListItem.quantity,
      unit: shoppingListItem.unit,
      note: shoppingListItem.note,
      isChecked: shoppingListItem.isChecked,
      source: shoppingListItem.source,
      createdAt: shoppingListItem.createdAt,
      updatedAt: shoppingListItem.updatedAt,
    })
    .from(shoppingListItem)
    .leftJoin(shoppingListCategory, eq(shoppingListItem.categoryId, shoppingListCategory.id))
    .leftJoin(user, eq(shoppingListItem.addedByUserId, user.id))
    .where(and(...conditions))
    .orderBy(asc(shoppingListCategory.name), asc(shoppingListItem.sortOrder), asc(shoppingListItem.createdAt));

  const itemIds = rows.map((r) => r.id);
  const images = itemIds.length > 0
    ? await db.select().from(shoppingListItemImage).where(inArray(shoppingListItemImage.itemId, itemIds)).orderBy(asc(shoppingListItemImage.sortOrder))
    : [];

  const imagesByItemId = new Map<string, typeof images>();
  for (const img of images) {
    if (!imagesByItemId.has(img.itemId)) imagesByItemId.set(img.itemId, []);
    imagesByItemId.get(img.itemId)!.push(img);
  }

  res.json(rows.map((r) => ({ ...r, images: imagesByItemId.get(r.id) ?? [] })));
});

// Must be registered before /:id so Express doesn't treat "checked" as an :id param
router.delete('/items/checked', async (req, res) => {
  await db
    .delete(shoppingListItem)
    .where(and(
      eq(shoppingListItem.shoppingListId, req.shoppingListId),
      eq(shoppingListItem.isChecked, true)
    ));
  res.json({ message: 'Checked items cleared' });
});

router.post('/items', async (req, res) => {
  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  if (parsed.data.categoryId) {
    const [cat] = await db
      .select({ id: shoppingListCategory.id })
      .from(shoppingListCategory)
      .where(and(eq(shoppingListCategory.id, parsed.data.categoryId), eq(shoppingListCategory.shoppingListId, req.shoppingListId)))
      .limit(1);
    if (!cat) { res.status(400).json({ error: 'Invalid category' }); return; }
  }

  if (parsed.data.ingredientId) {
    const [ing] = await db
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.id, parsed.data.ingredientId))
      .limit(1);
    if (!ing) { res.status(400).json({ error: 'Invalid ingredient' }); return; }
  }

  // Compute next sortOrder within this category
  const [maxRow] = await db
    .select({ m: max(shoppingListItem.sortOrder) })
    .from(shoppingListItem)
    .where(and(
      eq(shoppingListItem.shoppingListId, req.shoppingListId),
      parsed.data.categoryId
        ? eq(shoppingListItem.categoryId, parsed.data.categoryId)
        : sql`${shoppingListItem.categoryId} IS NULL`,
    ));
  const nextOrder = (maxRow?.m ?? -1) + 1;

  const [item] = await db
    .insert(shoppingListItem)
    .values({
      shoppingListId: req.shoppingListId,
      name: parsed.data.name,
      categoryId: parsed.data.categoryId ?? null,
      ingredientId: parsed.data.ingredientId ?? null,
      addedByUserId: req.user.id,
      quantity: parsed.data.quantity != null ? String(parsed.data.quantity) : null,
      unit: parsed.data.unit ?? null,
      note: parsed.data.note ?? null,
      source: parsed.data.source ?? null,
      sortOrder: nextOrder,
    })
    .returning();
  res.status(201).json(item);
});

router.patch('/items/:id', async (req, res) => {
  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [existing] = await db
    .select({ id: shoppingListItem.id })
    .from(shoppingListItem)
    .where(and(
      eq(shoppingListItem.id, req.params.id),
      eq(shoppingListItem.shoppingListId, req.shoppingListId)
    ))
    .limit(1);
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  const { name, categoryId, quantity, unit, note, isChecked } = parsed.data;

  if (categoryId) {
    const [cat] = await db
      .select({ id: shoppingListCategory.id })
      .from(shoppingListCategory)
      .where(and(eq(shoppingListCategory.id, categoryId), eq(shoppingListCategory.shoppingListId, req.shoppingListId)))
      .limit(1);
    if (!cat) { res.status(400).json({ error: 'Invalid category' }); return; }
  }

  const [updated] = await db
    .update(shoppingListItem)
    .set({
      ...(name !== undefined && { name }),
      ...(categoryId !== undefined && { categoryId }),
      ...(quantity !== undefined && { quantity: quantity != null ? String(quantity) : null }),
      ...(unit !== undefined && { unit }),
      ...(note !== undefined && { note }),
      ...(isChecked !== undefined && { isChecked }),
      updatedAt: new Date(),
    })
    .where(eq(shoppingListItem.id, req.params.id))
    .returning();
  res.json(updated);
});

// PATCH /items/:id/move — swap sort order with adjacent item in same category
router.patch('/items/:id/move', async (req, res) => {
  const direction = req.body?.direction === 'up' ? 'up' : 'down';

  const [item] = await db
    .select({ id: shoppingListItem.id, sortOrder: shoppingListItem.sortOrder, categoryId: shoppingListItem.categoryId })
    .from(shoppingListItem)
    .where(and(eq(shoppingListItem.id, req.params.id), eq(shoppingListItem.shoppingListId, req.shoppingListId)))
    .limit(1);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

  const catCondition = item.categoryId
    ? eq(shoppingListItem.categoryId, item.categoryId)
    : sql`${shoppingListItem.categoryId} IS NULL`;

  const [adjacent] = await db
    .select({ id: shoppingListItem.id, sortOrder: shoppingListItem.sortOrder })
    .from(shoppingListItem)
    .where(and(
      eq(shoppingListItem.shoppingListId, req.shoppingListId),
      catCondition,
      direction === 'up'
        ? lt(shoppingListItem.sortOrder, item.sortOrder)
        : gt(shoppingListItem.sortOrder, item.sortOrder),
    ))
    .orderBy(direction === 'up' ? desc(shoppingListItem.sortOrder) : asc(shoppingListItem.sortOrder))
    .limit(1);

  if (!adjacent) { res.json({ message: 'Already at boundary' }); return; }

  await db.transaction(async (tx) => {
    await tx.update(shoppingListItem).set({ sortOrder: adjacent.sortOrder }).where(eq(shoppingListItem.id, item.id));
    await tx.update(shoppingListItem).set({ sortOrder: item.sortOrder }).where(eq(shoppingListItem.id, adjacent.id));
  });

  res.json({ message: 'Moved' });
});

router.delete('/items/:id', async (req, res) => {
  const [existing] = await db
    .select({ id: shoppingListItem.id })
    .from(shoppingListItem)
    .where(and(
      eq(shoppingListItem.id, req.params.id),
      eq(shoppingListItem.shoppingListId, req.shoppingListId)
    ))
    .limit(1);
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  await db.delete(shoppingListItem).where(eq(shoppingListItem.id, req.params.id));
  res.json({ message: 'Item deleted' });
});

// ─── Shopping list item image routes ─────────────────────────────────────────

router.post('/items/:id/images', upload.single('image'), async (req: Request, res: Response) => {
  const itemRows = await db.execute<{ id: string; shopping_list_id: string }>(
    sql`SELECT id, shopping_list_id FROM shopping_list_item WHERE id = ${req.params.id} LIMIT 1`
  );
  const item = itemRows.rows[0];
  if (!item || item.shopping_list_id !== req.shoppingListId) { res.status(404).json({ error: 'Item not found' }); return; }
  if (!req.file) { res.status(400).json({ error: 'No image uploaded' }); return; }

  if (!validateImageBuffer(req.file.buffer)) {
    res.status(400).json({ error: 'Invalid image file' });
    return;
  }

  const [{ count: imgCount }] = await db
    .select({ count: count() })
    .from(shoppingListItemImage)
    .where(eq(shoppingListItemImage.itemId, item.id));
  if (Number(imgCount) >= 10) {
    res.status(400).json({ error: 'Maximum 10 images per shopping list item' });
    return;
  }

  const url = await uploadImage(req.file.buffer, `shopping-list-items/${item.id}`);

  const maxRows = await db.execute<{ m: number | null }>(
    sql`SELECT MAX(sort_order) AS m FROM shopping_list_item_image WHERE item_id = ${item.id}`
  );
  const nextSort = ((maxRows.rows[0]?.m ?? -1) as number) + 1;

  const [img] = await db
    .insert(shoppingListItemImage)
    .values({ itemId: item.id, url, sortOrder: nextSort })
    .returning();

  res.status(201).json(img);
});

router.delete('/items/:id/images/:imageId', async (req, res) => {
  const [item] = await db
    .select({ id: shoppingListItem.id })
    .from(shoppingListItem)
    .where(and(eq(shoppingListItem.id, req.params.id), eq(shoppingListItem.shoppingListId, req.shoppingListId)))
    .limit(1);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

  const [img] = await db
    .select()
    .from(shoppingListItemImage)
    .where(and(eq(shoppingListItemImage.id, req.params.imageId), eq(shoppingListItemImage.itemId, item.id)))
    .limit(1);
  if (!img) { res.status(404).json({ error: 'Image not found' }); return; }

  const publicId = extractPublicId(img.url);
  if (publicId) await deleteImage(publicId).catch(() => {});
  await db.delete(shoppingListItemImage).where(eq(shoppingListItemImage.id, img.id));

  res.json({ message: 'Image deleted' });
});

export default router;
