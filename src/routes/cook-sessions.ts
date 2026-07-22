import { Router, Request, Response, NextFunction } from 'express';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { recipe, recipeBook, recipeCook, recipeCookImage, recipeCategory } from '../schema/recipe';
import { householdUser } from '../schema/household';
import { user } from '../schema/auth';
import { pantry, pantryItem } from '../schema/pantry';
import { ingredient } from '../schema/ingredient';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { upload, validateImageBuffer } from '../lib/upload';
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

const pendingChangesSchema = z.object({
  ticked: z.array(z.string().uuid()).default([]),
  tickedSteps: z.array(z.number().int().min(0)).default([]),
  pantryChanges: z.array(z.object({
    itemId: z.string().uuid(),
    inStock: z.boolean(),
  })).default([]),
  extraChanges: z.array(z.object({
    itemId: z.string().uuid(),
    inStock: z.boolean(),
  })).default([]),
});

// ─── Cook session routes ──────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/cook-sessions — completed cook history for the current user
router.get('/', async (req, res) => {
  const rawRecipeId = typeof req.query.recipeId === 'string' ? req.query.recipeId : undefined;
  const recipeId = rawRecipeId && UUID_RE.test(rawRecipeId) ? rawRecipeId : undefined;

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

// GET /api/cook-sessions/household-history — all completed sessions for the household
router.get('/household-history', async (req, res) => {
  const householdUserIds = await db
    .select({ userId: householdUser.userId })
    .from(householdUser)
    .where(eq(householdUser.householdId, req.householdId));

  if (householdUserIds.length === 0) { res.json([]); return; }

  const userIds = householdUserIds.map((h) => h.userId);

  const sessions = await db
    .select({
      id: recipeCook.id,
      recipeId: recipeCook.recipeId,
      recipeTitle: recipe.title,
      recipeImage: sql<string | null>`(
        SELECT url FROM recipe_image WHERE recipe_id = ${recipeCook.recipeId} ORDER BY sort_order ASC LIMIT 1
      )`,
      userId: recipeCook.userId,
      userName: user.name,
      userHandle: sql<string | null>`(SELECT handle FROM "user" WHERE id = ${recipeCook.userId})`,
      userImage: user.image,
      servings: recipeCook.servings,
      note: recipeCook.note,
      cookedAt: recipeCook.cookedAt,
    })
    .from(recipeCook)
    .leftJoin(recipe, eq(recipeCook.recipeId, recipe.id))
    .leftJoin(user, eq(recipeCook.userId, user.id))
    .where(and(
      inArray(recipeCook.userId, userIds),
      eq(recipeCook.status, 'COMPLETED'),
    ))
    .orderBy(desc(recipeCook.cookedAt))
    .limit(100);

  res.json(sessions);
});

// GET /api/cook-sessions/household-in-progress — all active sessions for the household
router.get('/household-in-progress', async (req, res) => {
  const householdUserIds = await db
    .select({ userId: householdUser.userId })
    .from(householdUser)
    .where(eq(householdUser.householdId, req.householdId));

  if (householdUserIds.length === 0) { res.json([]); return; }

  const userIds = householdUserIds.map((h) => h.userId);

  const sessions = await db
    .select({
      id: recipeCook.id,
      recipeId: recipeCook.recipeId,
      recipeTitle: recipe.title,
      recipeImage: sql<string | null>`(
        SELECT url FROM recipe_image WHERE recipe_id = ${recipeCook.recipeId} ORDER BY sort_order ASC LIMIT 1
      )`,
      userId: recipeCook.userId,
      userName: user.name,
      userHandle: sql<string | null>`(SELECT handle FROM "user" WHERE id = ${recipeCook.userId})`,
      userImage: user.image,
      startedAt: recipeCook.cookedAt,
    })
    .from(recipeCook)
    .leftJoin(recipe, eq(recipeCook.recipeId, recipe.id))
    .leftJoin(user, eq(recipeCook.userId, user.id))
    .where(and(
      inArray(recipeCook.userId, userIds),
      eq(recipeCook.status, 'IN_PROGRESS'),
    ))
    .orderBy(desc(recipeCook.cookedAt));

  res.json(sessions);
});

// GET /api/cook-sessions/active — current user's IN_PROGRESS session (optional ?recipeId)
// Registered before /:id so Express doesn't match "active" as a param
router.get('/active', async (req, res) => {
  const rawRecipeId = typeof req.query.recipeId === 'string' ? req.query.recipeId : undefined;
  const recipeId = rawRecipeId && UUID_RE.test(rawRecipeId) ? rawRecipeId : undefined;

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
      pendingChanges: { ticked: [], tickedSteps: [], pantryChanges: [], extraChanges: [] },
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

  const parsedBody = z.object({
    pantryChanges: z.array(z.object({
      itemId: z.string().uuid(),
      inStock: z.boolean(),
      quantity: z.number().int().min(1).max(999).nullable().optional(),
      unit: z.string().trim().max(50).nullable().optional(),
      notes: z.string().trim().max(500).nullable().optional(),
    })).max(200).optional(),
    servings: z.number().int().positive().nullable().optional(),
  }).safeParse(req.body);

  const bodyServings = parsedBody.success ? (parsedBody.data.servings ?? null) : null;
  const bodyPantryChanges = parsedBody.success ? (parsedBody.data.pantryChanges ?? null) : null;

  const changes = session.pendingChanges ?? { ticked: [], pantryChanges: [], extraChanges: [] };
  const allItemChanges = bodyPantryChanges ?? [...changes.pantryChanges, ...changes.extraChanges];

  const result = await db.transaction(async (tx) => {
    const outOfStockItemIds: string[] = [];

    for (const change of allItemChanges) {
      const { itemId, inStock } = change;
      const [item] = await tx
        .select({ id: pantryItem.id })
        .from(pantryItem)
        .where(and(eq(pantryItem.id, itemId), eq(pantryItem.pantryId, pantryRow.id)))
        .limit(1);

      if (!item) continue; // item deleted mid-session; skip silently

      const updateFields: Record<string, unknown> = { inStock, updatedAt: new Date() };
      if ('quantity' in change && change.quantity !== undefined) updateFields.quantity = change.quantity;
      if ('unit' in change && change.unit !== undefined) updateFields.unit = change.unit;
      if ('notes' in change && change.notes !== undefined) updateFields.notes = change.notes;

      await tx
        .update(pantryItem)
        .set(updateFields)
        .where(eq(pantryItem.id, item.id));

      if (!inStock) outOfStockItemIds.push(item.id);
    }

    const [done] = await tx
      .update(recipeCook)
      .set({ status: 'COMPLETED', pendingChanges: null, servings: bodyServings })
      .where(eq(recipeCook.id, session.id))
      .returning();

    let lowStockItems: { ingredientId: string; name: string }[] = [];

    if (outOfStockItemIds.length > 0) {
      const rows = await tx
        .select({ ingredientId: pantryItem.ingredientId, name: ingredient.name })
        .from(pantryItem)
        .innerJoin(ingredient, eq(pantryItem.ingredientId, ingredient.id))
        .where(inArray(pantryItem.id, outOfStockItemIds));

      lowStockItems = rows;
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

  if (!validateImageBuffer(req.file.buffer)) {
    res.status(400).json({ error: 'Invalid image file' });
    return;
  }

  const [{ count: imgCount }] = await db
    .select({ count: count() })
    .from(recipeCookImage)
    .where(eq(recipeCookImage.recipeCookId, sessionId));
  if (Number(imgCount) >= 10) {
    res.status(400).json({ error: 'Maximum 10 photos per cook session' });
    return;
  }

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
  if (publicId) await deleteImage(publicId).catch(() => {});
  await db.delete(recipeCookImage).where(eq(recipeCookImage.id, image.id));

  res.json({ message: 'Image deleted' });
});

export default router;
