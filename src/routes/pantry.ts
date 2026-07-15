import { Router, Request, Response, NextFunction } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { pantry, pantryCategory, pantryItem, pantryBatch, pantryItemImage } from '../schema/pantry';
import { ingredient } from '../schema/ingredient';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { findOrCreateIngredient } from '../lib/ingredient';
import { upload } from '../lib/upload';
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

const fillLevelSchema = z.union([
  z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100),
]);

const createItemSchema = z.object({
  ingredientName: z.string().trim().min(1, 'Ingredient name is required'),
  categoryId: z.string().uuid().nullable().optional(),
  fillLevel: fillLevelSchema.default(100),
});

const updateItemSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
});

const batchSchema = z.object({
  fillLevel: fillLevelSchema,
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

  await db.delete(pantryCategory).where(eq(pantryCategory.id, req.params.id));
  res.json({ message: 'Category deleted' });
});

// ─── Item routes ──────────────────────────────────────────────────────────────

router.get('/items', async (req, res) => {
  const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;

  const conditions = [eq(pantryItem.pantryId, req.pantryId)];
  if (categoryId) conditions.push(eq(pantryItem.categoryId, categoryId));

  const items = await db
    .select({
      id: pantryItem.id,
      ingredientId: pantryItem.ingredientId,
      ingredientName: ingredient.name,
      categoryId: pantryItem.categoryId,
      categoryName: pantryCategory.name,
      createdAt: pantryItem.createdAt,
    })
    .from(pantryItem)
    .innerJoin(ingredient, eq(pantryItem.ingredientId, ingredient.id))
    .leftJoin(pantryCategory, eq(pantryItem.categoryId, pantryCategory.id))
    .where(and(...conditions))
    .orderBy(asc(ingredient.name));

  if (items.length === 0) { res.json([]); return; }

  const itemIds = items.map(i => i.id);
  const batches = await db
    .select()
    .from(pantryBatch)
    .where(inArray(pantryBatch.pantryItemId, itemIds));

  const batchesByItemId = batches.reduce<Record<string, typeof batches>>((acc, b) => {
    (acc[b.pantryItemId] ??= []).push(b);
    return acc;
  }, {});

  const result = items.map(item => ({
    ...item,
    batches: batchesByItemId[item.id] ?? [],
    effectiveStock: (batchesByItemId[item.id] ?? []).reduce((sum, b) => sum + b.fillLevel, 0),
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

  const ingredientId = await findOrCreateIngredient(db, parsed.data.ingredientName);

  const [existingItem] = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(and(eq(pantryItem.pantryId, req.pantryId), eq(pantryItem.ingredientId, ingredientId)))
    .limit(1);
  if (existingItem) { res.status(409).json({ error: 'This ingredient is already in your pantry' }); return; }

  const result = await db.transaction(async (tx) => {
    const [item] = await tx
      .insert(pantryItem)
      .values({ pantryId: req.pantryId, ingredientId, categoryId: parsed.data.categoryId ?? null })
      .returning();

    const [batch] = await tx
      .insert(pantryBatch)
      .values({ pantryItemId: item.id, fillLevel: parsed.data.fillLevel })
      .returning();

    return { ...item, batches: [batch], effectiveStock: batch.fillLevel };
  });

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
      createdAt: pantryItem.createdAt,
      updatedAt: pantryItem.updatedAt,
    })
    .from(pantryItem)
    .innerJoin(ingredient, eq(pantryItem.ingredientId, ingredient.id))
    .leftJoin(pantryCategory, eq(pantryItem.categoryId, pantryCategory.id))
    .where(and(eq(pantryItem.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);

  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

  const [batches, images] = await Promise.all([
    db.select().from(pantryBatch).where(eq(pantryBatch.pantryItemId, item.id)),
    db
      .select({ id: pantryItemImage.id, url: pantryItemImage.url, sortOrder: pantryItemImage.sortOrder })
      .from(pantryItemImage)
      .where(eq(pantryItemImage.pantryItemId, item.id))
      .orderBy(asc(pantryItemImage.sortOrder)),
  ]);

  res.json({
    ...item,
    batches,
    effectiveStock: batches.reduce((sum, b) => sum + b.fillLevel, 0),
    images,
  });
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

  const [updated] = await db
    .update(pantryItem)
    .set({
      ...(parsed.data.categoryId !== undefined && { categoryId: parsed.data.categoryId }),
      updatedAt: new Date(),
    })
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

  // Fetch images before delete for Cloudinary cleanup
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

// ─── Batch routes ─────────────────────────────────────────────────────────────

router.post('/items/:id/batches', async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [item] = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(and(eq(pantryItem.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }

  const [batch] = await db
    .insert(pantryBatch)
    .values({ pantryItemId: req.params.id, fillLevel: parsed.data.fillLevel })
    .returning();
  res.status(201).json(batch);
});

router.patch('/batches/:id', async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [batch] = await db
    .select({ id: pantryBatch.id })
    .from(pantryBatch)
    .innerJoin(pantryItem, eq(pantryBatch.pantryItemId, pantryItem.id))
    .where(and(eq(pantryBatch.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }

  const [updated] = await db
    .update(pantryBatch)
    .set({ fillLevel: parsed.data.fillLevel, updatedAt: new Date() })
    .where(eq(pantryBatch.id, req.params.id))
    .returning();
  res.json(updated);
});

router.delete('/batches/:id', async (req, res) => {
  const [batch] = await db
    .select({ id: pantryBatch.id, pantryItemId: pantryBatch.pantryItemId })
    .from(pantryBatch)
    .innerJoin(pantryItem, eq(pantryBatch.pantryItemId, pantryItem.id))
    .where(and(eq(pantryBatch.id, req.params.id), eq(pantryItem.pantryId, req.pantryId)))
    .limit(1);
  if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }

  const allBatches = await db
    .select({ id: pantryBatch.id })
    .from(pantryBatch)
    .where(eq(pantryBatch.pantryItemId, batch.pantryItemId));

  if (allBatches.length <= 1) {
    res.status(400).json({ error: 'Cannot delete the only batch — delete the pantry item instead' });
    return;
  }

  await db.delete(pantryBatch).where(eq(pantryBatch.id, req.params.id));
  res.json({ message: 'Batch deleted' });
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
