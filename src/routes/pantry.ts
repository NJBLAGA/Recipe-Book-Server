import { Router, Request, Response, NextFunction } from 'express';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { pantry, pantryCategory, pantryItem, pantryItemImage } from '../schema/pantry';
import { ingredient } from '../schema/ingredient';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { findOrCreateIngredient } from '../lib/ingredient';
import { upload, validateImageBuffer } from '../lib/upload';
import { uploadImage, deleteImage, extractPublicId } from '../lib/cloudinary';

const router = Router();
router.use(requireAuth);
router.use(requireHousehold);

router.use(async (req: Request, res: Response, next: NextFunction) => {
  const [p] = await db
    .select({ id: pantry.id })
    .from(pantry)
    .where(eq(pantry.householdId, req.householdId))
    .limit(1);
  if (!p) { res.status(500).json({ error: 'Pantry not found' }); return; }
  req.pantryId = p.id;
  next();
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

const createItemSchema = z.object({
  name: z.string().trim().min(1, 'Ingredient name is required').max(200),
  categoryId: z.string().uuid({ message: 'Category is required' }),
  inStock: z.boolean().default(true),
  quantity: z.number().int().min(1).max(999).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const updateItemSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  inStock: z.boolean().optional(),
  quantity: z.number().int().min(1).max(999).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

// ─── Category routes ──────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  const categories = await db
    .select()
    .from(pantryCategory)
    .where(eq(pantryCategory.pantryId, req.pantryId))
    .orderBy(asc(pantryCategory.name));
  res.json(categories);
});

router.post('/categories', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [existing] = await db
    .select({ id: pantryCategory.id })
    .from(pantryCategory)
    .where(and(eq(pantryCategory.pantryId, req.pantryId), eq(pantryCategory.name, parsed.data.name)))
    .limit(1);
  if (existing) { res.status(409).json({ error: 'A category with this name already exists' }); return; }

  const [created] = await db
    .insert(pantryCategory)
    .values({ pantryId: req.pantryId, name: parsed.data.name })
    .returning();
  res.status(201).json(created);
});

router.patch('/categories/:id', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [cat] = await db
    .select({ id: pantryCategory.id })
    .from(pantryCategory)
    .where(and(eq(pantryCategory.id, req.params.id), eq(pantryCategory.pantryId, req.pantryId)))
    .limit(1);
  if (!cat) { res.status(404).json({ error: 'Category not found' }); return; }

  const [updated] = await db
    .update(pantryCategory)
    .set({ name: parsed.data.name })
    .where(eq(pantryCategory.id, req.params.id))
    .returning();
  res.json(updated);
});

router.delete('/categories/:id', async (req, res) => {
  const [cat] = await db
    .select({ id: pantryCategory.id })
    .from(pantryCategory)
    .where(and(eq(pantryCategory.id, req.params.id), eq(pantryCategory.pantryId, req.pantryId)))
    .limit(1);
  if (!cat) { res.status(404).json({ error: 'Category not found' }); return; }

  const parsed = z.object({ targetCategoryId: z.string().uuid().optional() }).safeParse(req.body);
  const targetCategoryId = parsed.success ? parsed.data.targetCategoryId : undefined;

  if (targetCategoryId) {
    const [target] = await db
      .select({ id: pantryCategory.id })
      .from(pantryCategory)
      .where(and(eq(pantryCategory.id, targetCategoryId), eq(pantryCategory.pantryId, req.pantryId)))
      .limit(1);
    if (!target) { res.status(400).json({ error: 'Target category not found' }); return; }
    await db.update(pantryItem).set({ categoryId: targetCategoryId }).where(eq(pantryItem.categoryId, req.params.id));
  }

  await db.delete(pantryCategory).where(eq(pantryCategory.id, req.params.id));
  res.json({ message: 'Category deleted' });
});

// ─── Item routes ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/items', async (req, res) => {
  const rawCategoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const categoryId = rawCategoryId && UUID_RE.test(rawCategoryId) ? rawCategoryId : undefined;

  const conditions = [eq(pantryItem.pantryId, req.pantryId)];
  if (categoryId) conditions.push(eq(pantryItem.categoryId, categoryId));

  const items = await db
    .select({
      id: pantryItem.id,
      ingredientId: pantryItem.ingredientId,
      ingredientName: ingredient.name,
      categoryId: pantryItem.categoryId,
      categoryName: pantryCategory.name,
      inStock: pantryItem.inStock,
      quantity: pantryItem.quantity,
      unit: pantryItem.unit,
      notes: pantryItem.notes,
      createdAt: pantryItem.createdAt,
    })
    .from(pantryItem)
    .innerJoin(ingredient, eq(pantryItem.ingredientId, ingredient.id))
    .leftJoin(pantryCategory, eq(pantryItem.categoryId, pantryCategory.id))
    .where(and(...conditions))
    .orderBy(asc(ingredient.name));

  if (items.length === 0) { res.json([]); return; }

  const itemIds = items.map((i) => i.id);
  const images = await db
    .select({ id: pantryItemImage.id, url: pantryItemImage.url, sortOrder: pantryItemImage.sortOrder, pantryItemId: pantryItemImage.pantryItemId })
    .from(pantryItemImage)
    .where(inArray(pantryItemImage.pantryItemId, itemIds))
    .orderBy(asc(pantryItemImage.sortOrder));

  const imagesByItemId = images.reduce<Record<string, typeof images>>((acc, img) => {
    (acc[img.pantryItemId] ??= []).push(img);
    return acc;
  }, {});

  const result = items.map((item) => ({
    ...item,
    images: (imagesByItemId[item.id] ?? []).map((img) => ({ id: img.id, url: img.url, sortOrder: img.sortOrder })),
  }));

  res.json(result);
});

router.post('/items', async (req, res) => {
  const parsed = createItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  if (parsed.data.categoryId) {
    const [cat] = await db
      .select({ id: pantryCategory.id })
      .from(pantryCategory)
      .where(and(eq(pantryCategory.id, parsed.data.categoryId), eq(pantryCategory.pantryId, req.pantryId)))
      .limit(1);
    if (!cat) { res.status(400).json({ error: 'Invalid category' }); return; }
  }

  let result: Record<string, unknown> | null = null;
  try {
    result = await db.transaction(async (tx) => {
      const ingredientId = await findOrCreateIngredient(tx, parsed.data.name);

      const [existingItem] = await tx
        .select({ id: pantryItem.id })
        .from(pantryItem)
        .where(and(eq(pantryItem.pantryId, req.pantryId), eq(pantryItem.ingredientId, ingredientId)))
        .limit(1);
      if (existingItem) return null;

      const [item] = await tx
        .insert(pantryItem)
        .values({
          pantryId: req.pantryId,
          ingredientId,
          categoryId: parsed.data.categoryId,
          inStock: parsed.data.inStock,
          quantity: parsed.data.quantity ?? null,
          unit: parsed.data.unit ?? null,
          notes: parsed.data.notes ?? null,
        })
        .returning();

      return { ...item, ingredientName: parsed.data.name, categoryName: null, images: [] };
    });
  } catch (e: any) {
    if (e?.code === '23505') { res.status(409).json({ error: 'This ingredient is already in your pantry' }); return; }
    throw e;
  }

  if (!result) { res.status(409).json({ error: 'This ingredient is already in your pantry' }); return; }

  res.status(201).json(result);
});

router.get('/items/:id', async (req, res) => {
  const [item] = await db
    .select({
      id: pantryItem.id,
      ingredientId: pantryItem.ingredientId,
      ingredientName: ingredient.name,
      categoryId: pantryItem.categoryId,
      categoryName: pantryCategory.name,
      inStock: pantryItem.inStock,
      quantity: pantryItem.quantity,
      unit: pantryItem.unit,
      notes: pantryItem.notes,
      createdAt: pantryItem.createdAt,
      updatedAt: pantryItem.updatedAt,
    })
    .from(pantryItem)
    .innerJoin(ingredient, eq(pantryItem.ingredientId, ingredient.id))
    .leftJoin(pantryCategory, eq(pantryItem.categoryId, pantryCategory.id))
    .where(and(eq(pantryItem.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);

  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

  const images = await db
    .select({ id: pantryItemImage.id, url: pantryItemImage.url, sortOrder: pantryItemImage.sortOrder })
    .from(pantryItemImage)
    .where(eq(pantryItemImage.pantryItemId, item.id))
    .orderBy(asc(pantryItemImage.sortOrder));

  res.json({ ...item, images });
});

router.patch('/items/:id', async (req, res) => {
  const parsed = updateItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [existing] = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(and(eq(pantryItem.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  if (parsed.data.categoryId) {
    const [cat] = await db
      .select({ id: pantryCategory.id })
      .from(pantryCategory)
      .where(and(eq(pantryCategory.id, parsed.data.categoryId), eq(pantryCategory.pantryId, req.pantryId)))
      .limit(1);
    if (!cat) { res.status(400).json({ error: 'Invalid category' }); return; }
  }

  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.categoryId !== undefined) updateFields.categoryId = parsed.data.categoryId;
  if (parsed.data.inStock !== undefined) updateFields.inStock = parsed.data.inStock;
  if (parsed.data.quantity !== undefined) updateFields.quantity = parsed.data.quantity;
  if (parsed.data.unit !== undefined) updateFields.unit = parsed.data.unit;
  if (parsed.data.notes !== undefined) updateFields.notes = parsed.data.notes;

  const [updated] = await db
    .update(pantryItem)
    .set(updateFields)
    .where(eq(pantryItem.id, req.params.id))
    .returning();
  res.json(updated);
});

router.delete('/items/:id', async (req, res) => {
  const [existing] = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(and(eq(pantryItem.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: 'Item not found' }); return; }

  const images = await db
    .select({ url: pantryItemImage.url })
    .from(pantryItemImage)
    .where(eq(pantryItemImage.pantryItemId, req.params.id));

  await db.delete(pantryItem).where(eq(pantryItem.id, req.params.id));

  for (const img of images) {
    const publicId = extractPublicId(img.url);
    if (publicId) await deleteImage(publicId).catch(() => {});
  }

  res.json({ message: 'Item deleted' });
});

// ─── Image routes ─────────────────────────────────────────────────────────────

router.post('/items/:id/images', upload.single('image'), async (req, res) => {
  const itemId = req.params.id as string;

  const [item] = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(and(eq(pantryItem.id, itemId), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

  if (!req.file) { res.status(400).json({ error: 'Image file is required' }); return; }

  if (!validateImageBuffer(req.file.buffer)) {
    res.status(400).json({ error: 'Invalid image file' });
    return;
  }

  const [{ count: imgCount }] = await db
    .select({ count: count() })
    .from(pantryItemImage)
    .where(eq(pantryItemImage.pantryItemId, itemId));
  if (Number(imgCount) >= 10) {
    res.status(400).json({ error: 'Maximum 10 images per pantry item' });
    return;
  }

  const url = await uploadImage(req.file.buffer, `pantry-images/${req.householdId}`);
  const [image] = await db
    .insert(pantryItemImage)
    .values({ pantryItemId: itemId, url, sortOrder: 0 })
    .returning();
  res.status(201).json(image);
});

router.delete('/items/:id/images/:imageId', async (req, res) => {
  const [item] = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(and(eq(pantryItem.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

  const [image] = await db
    .select({ id: pantryItemImage.id, url: pantryItemImage.url })
    .from(pantryItemImage)
    .where(and(eq(pantryItemImage.id, req.params.imageId), eq(pantryItemImage.pantryItemId, req.params.id)))
    .limit(1);
  if (!image) { res.status(404).json({ error: 'Image not found' }); return; }

  const publicId = extractPublicId(image.url);
  if (publicId) await deleteImage(publicId).catch(() => {});
  await db.delete(pantryItemImage).where(eq(pantryItemImage.id, image.id));
  res.json({ message: 'Image deleted' });
});

export default router;
