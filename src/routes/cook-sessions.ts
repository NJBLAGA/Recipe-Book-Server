import { Router, Request, Response, NextFunction } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { recipe, recipeBook, recipeCook, recipeCookImage } from '../schema/recipe';
import { pantry, pantryBatch, pantryItem } from '../schema/pantry';
import { ingredient } from '../schema/ingredient';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { upload } from '../lib/upload';
import { uploadImage, deleteImage, extractPublicId } from '../lib/cloudinary';

const router = Router();
router.use(requireAuth);
router.use(requireHousehold);

router.use(async (req: Request, res: Response, next: NextFunction) => {
  const [book] = await db
    .select({ id: recipeBook.id })
    .from(recipeBook)
    .where(eq(recipeBook.householdId, req.householdId))
    .limit(1);
  if (!book) { res.status(500).json({ error: 'Recipe book not found' }); return; }
  req.recipeBookId = book.id;
  next();
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const fillLevelSchema = z.union([
  z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100),
]);

const pendingChangesSchema = z.object({
  ticked: z.array(z.string().uuid()).default([]),
  pantryChanges: z.array(z.object({
    batchId: z.string().uuid(),
    newFillLevel: fillLevelSchema,
  })).default([]),
  extraChanges: z.array(z.object({
    batchId: z.string().uuid(),
    newFillLevel: fillLevelSchema,
  })).default([]),
});

// ─── Cook session routes ──────────────────────────────────────────────────────

// GET /api/cook-sessions — completed cook history for the current user
router.get('/', async (req, res) => {
  const recipeId = typeof req.query.recipeId === 'string' ? req.query.recipeId : undefined;

  const conditions = [
    eq(recipeCook.userId, req.user.id),
    eq(recipeCook.status, 'COMPLETED'),
  ];
  if (recipeId) conditions.push(eq(recipeCook.recipeId, recipeId));

  const sessions = await db
    .select({
      id: recipeCook.id,
      recipeId: recipeCook.recipeId,
      recipeTitle: recipe.title,
      status: recipeCook.status,
      note: recipeCook.note,
      cookedAt: recipeCook.cookedAt,
    })
    .from(recipeCook)
    .leftJoin(recipe, eq(recipeCook.recipeId, recipe.id))
    .where(and(...conditions))
    .orderBy(desc(recipeCook.cookedAt));

  res.json(sessions);
});

// GET /api/cook-sessions/active — current user's IN_PROGRESS session (optional ?recipeId)
// Registered before /:id so Express doesn't match "active" as a param
router.get('/active', async (req, res) => {
  const recipeId = typeof req.query.recipeId === 'string' ? req.query.recipeId : undefined;

  const conditions = [
    eq(recipeCook.userId, req.user.id),
    eq(recipeCook.status, 'IN_PROGRESS'),
  ];
  if (recipeId) conditions.push(eq(recipeCook.recipeId, recipeId));

  const [session] = await db
    .select()
    .from(recipeCook)
    .where(and(...conditions))
    .limit(1);

  res.json(session ?? null);
});

// POST /api/cook-sessions — start or resume
router.post('/', async (req, res) => {
  const parsed = z.object({ recipeId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [r] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.id, parsed.data.recipeId), eq(recipe.recipeBookId, req.recipeBookId)))
    .limit(1);
  if (!r) { res.status(404).json({ error: 'Recipe not found' }); return; }

  const [existing] = await db
    .select()
    .from(recipeCook)
    .where(and(
      eq(recipeCook.userId, req.user.id),
      eq(recipeCook.recipeId, parsed.data.recipeId),
      eq(recipeCook.status, 'IN_PROGRESS'),
    ))
    .limit(1);

  if (existing) {
    res.json({ ...existing, resumed: true });
    return;
  }

  const [session] = await db
    .insert(recipeCook)
    .values({
      userId: req.user.id,
      recipeId: parsed.data.recipeId,
      status: 'IN_PROGRESS',
      pendingChanges: { ticked: [], pantryChanges: [], extraChanges: [] },
    })
    .returning();

  res.status(201).json({ ...session, resumed: false });
});

// GET /api/cook-sessions/:id — get a specific session with images
router.get('/:id', async (req, res) => {
  const [session] = await db
    .select()
    .from(recipeCook)
    .where(and(eq(recipeCook.id, req.params.id), eq(recipeCook.userId, req.user.id)))
    .limit(1);

  if (!session) { res.status(404).json({ error: 'Cook session not found' }); return; }

  const images = await db
    .select()
    .from(recipeCookImage)
    .where(eq(recipeCookImage.recipeCookId, session.id))
    .orderBy(asc(recipeCookImage.sortOrder));

  res.json({ ...session, images });
});

// PATCH /api/cook-sessions/:id/pending-changes — save ticked state mid-cook
router.patch('/:id/pending-changes', async (req, res) => {
  const [session] = await db
    .select({ id: recipeCook.id, status: recipeCook.status })
    .from(recipeCook)
    .where(and(eq(recipeCook.id, req.params.id), eq(recipeCook.userId, req.user.id)))
    .limit(1);

  if (!session) { res.status(404).json({ error: 'Cook session not found' }); return; }
  if (session.status !== 'IN_PROGRESS') { res.status(400).json({ error: 'Session is no longer in progress' }); return; }

  const parsed = z.object({ pendingChanges: pendingChangesSchema }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [updated] = await db
    .update(recipeCook)
    .set({ pendingChanges: parsed.data.pendingChanges })
    .where(eq(recipeCook.id, session.id))
    .returning();

  res.json(updated);
});

// POST /api/cook-sessions/:id/complete
// Atomically applies all pantry batch updates, marks the session COMPLETED,
// and returns which pantry items are now low/empty so the frontend can prompt
// the user to add them to the shopping list (a separate user action).
router.post('/:id/complete', async (req, res) => {
  const [session] = await db
    .select()
    .from(recipeCook)
    .where(and(eq(recipeCook.id, req.params.id), eq(recipeCook.userId, req.user.id)))
    .limit(1);

  if (!session) { res.status(404).json({ error: 'Cook session not found' }); return; }
  if (session.status !== 'IN_PROGRESS') { res.status(400).json({ error: 'Session is no longer in progress' }); return; }

  const [pantryRow] = await db
    .select({ id: pantry.id })
    .from(pantry)
    .where(eq(pantry.householdId, req.householdId))
    .limit(1);

  if (!pantryRow) {
    res.status(500).json({ error: 'Pantry not found' });
    return;
  }

  const changes = session.pendingChanges ?? { ticked: [], pantryChanges: [], extraChanges: [] };
  const allBatchChanges = [...changes.pantryChanges, ...changes.extraChanges];

  const result = await db.transaction(async (tx) => {
    // Track which pantryItem IDs we successfully updated for the stock check below
    const affectedItemIds: string[] = [];

    for (const { batchId, newFillLevel } of allBatchChanges) {
      const [batch] = await tx
        .select({ id: pantryBatch.id, pantryItemId: pantryBatch.pantryItemId })
        .from(pantryBatch)
        .innerJoin(pantryItem, eq(pantryBatch.pantryItemId, pantryItem.id))
        .where(and(eq(pantryBatch.id, batchId), eq(pantryItem.pantryId, pantryRow.id)))
        .limit(1);

      if (!batch) continue; // batch deleted mid-session; skip silently

      await tx
        .update(pantryBatch)
        .set({ fillLevel: newFillLevel, updatedAt: new Date() })
        .where(eq(pantryBatch.id, batchId));

      affectedItemIds.push(batch.pantryItemId);
    }

    const [done] = await tx
      .update(recipeCook)
      .set({ status: 'COMPLETED', pendingChanges: null })
      .where(eq(recipeCook.id, session.id))
      .returning();

    // Calculate effective stock for every affected pantry item (reads post-update values)
    let lowStockItems: { ingredientId: string; name: string; effectiveStock: number }[] = [];

    const uniqueItemIds = [...new Set(affectedItemIds)];
    if (uniqueItemIds.length > 0) {
      const allBatches = await tx
        .select({ pantryItemId: pantryBatch.pantryItemId, fillLevel: pantryBatch.fillLevel })
        .from(pantryBatch)
        .where(inArray(pantryBatch.pantryItemId, uniqueItemIds));

      // Sum fill levels per item
      const stockByItemId: Record<string, number> = {};
      for (const b of allBatches) {
        stockByItemId[b.pantryItemId] = (stockByItemId[b.pantryItemId] ?? 0) + b.fillLevel;
      }

      const lowItemIds = Object.entries(stockByItemId)
        .filter(([, stock]) => stock <= 25)
        .map(([id]) => id);

      if (lowItemIds.length > 0) {
        const rows = await tx
          .select({
            pantryItemId: pantryItem.id,
            ingredientId: pantryItem.ingredientId,
            name: ingredient.name,
          })
          .from(pantryItem)
          .innerJoin(ingredient, eq(pantryItem.ingredientId, ingredient.id))
          .where(inArray(pantryItem.id, lowItemIds));

        lowStockItems = rows.map(r => ({
          ingredientId: r.ingredientId,
          name: r.name,
          effectiveStock: stockByItemId[r.pantryItemId] ?? 0,
        }));
      }
    }

    return { session: done, lowStockItems };
  });

  res.json(result);
});

// POST /api/cook-sessions/:id/cancel — discard pending changes, keep record for history
router.post('/:id/cancel', async (req, res) => {
  const [session] = await db
    .select({ id: recipeCook.id, status: recipeCook.status })
    .from(recipeCook)
    .where(and(eq(recipeCook.id, req.params.id), eq(recipeCook.userId, req.user.id)))
    .limit(1);

  if (!session) { res.status(404).json({ error: 'Cook session not found' }); return; }
  if (session.status !== 'IN_PROGRESS') { res.status(400).json({ error: 'Session is no longer in progress' }); return; }

  const [cancelled] = await db
    .update(recipeCook)
    .set({ status: 'CANCELLED', pendingChanges: null })
    .where(eq(recipeCook.id, session.id))
    .returning();

  res.json(cancelled);
});

// PATCH /api/cook-sessions/:id/note — add or update a note on a completed session
router.patch('/:id/note', async (req, res) => {
  const parsed = z.object({ note: z.string().trim().max(2000).nullable() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [session] = await db
    .select({ id: recipeCook.id, status: recipeCook.status })
    .from(recipeCook)
    .where(and(eq(recipeCook.id, req.params.id), eq(recipeCook.userId, req.user.id)))
    .limit(1);

  if (!session) { res.status(404).json({ error: 'Cook session not found' }); return; }
  if (session.status !== 'COMPLETED') { res.status(400).json({ error: 'Notes can only be added to completed sessions' }); return; }

  const [updated] = await db
    .update(recipeCook)
    .set({ note: parsed.data.note })
    .where(eq(recipeCook.id, session.id))
    .returning();

  res.json(updated);
});

// POST /api/cook-sessions/:id/images — upload a photo of the cook attempt
router.post('/:id/images', upload.single('image'), async (req, res) => {
  const sessionId = req.params.id as string;

  const [session] = await db
    .select({ id: recipeCook.id, status: recipeCook.status })
    .from(recipeCook)
    .where(and(eq(recipeCook.id, sessionId), eq(recipeCook.userId, req.user.id)))
    .limit(1);

  if (!session) { res.status(404).json({ error: 'Cook session not found' }); return; }
  if (session.status !== 'COMPLETED') { res.status(400).json({ error: 'Photos can only be added to completed sessions' }); return; }
  if (!req.file) { res.status(400).json({ error: 'Image file is required' }); return; }

  const url = await uploadImage(req.file.buffer, `cook-images/${req.user.id}`);
  const [image] = await db
    .insert(recipeCookImage)
    .values({ recipeCookId: sessionId, url, sortOrder: 0 })
    .returning();

  res.status(201).json(image);
});

// DELETE /api/cook-sessions/:id/images/:imageId
router.delete('/:id/images/:imageId', async (req, res) => {
  const [session] = await db
    .select({ id: recipeCook.id })
    .from(recipeCook)
    .where(and(eq(recipeCook.id, req.params.id), eq(recipeCook.userId, req.user.id)))
    .limit(1);

  if (!session) { res.status(404).json({ error: 'Cook session not found' }); return; }

  const [image] = await db
    .select({ id: recipeCookImage.id, url: recipeCookImage.url })
    .from(recipeCookImage)
    .where(and(
      eq(recipeCookImage.id, req.params.imageId),
      eq(recipeCookImage.recipeCookId, session.id),
    ))
    .limit(1);

  if (!image) { res.status(404).json({ error: 'Image not found' }); return; }

  const publicId = extractPublicId(image.url);
  if (publicId) await deleteImage(publicId);
  await db.delete(recipeCookImage).where(eq(recipeCookImage.id, image.id));

  res.json({ message: 'Image deleted' });
});

export default router;
