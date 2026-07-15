import { Router } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { recipeShare, review, notification } from '../schema/social';
import { recipe, recipeBook, recipeIngredient } from '../schema/recipe';
import { user } from '../schema/auth';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';

const router = Router();
router.use(requireAuth);
router.use(requireHousehold);

// Resolve recipeBookId for accept/recopy (need recipient's book to copy into)
import { Request, Response, NextFunction } from 'express';
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const [book] = await db
    .select({ id: recipeBook.id })
    .from(recipeBook)
    .where(eq(recipeBook.householdId, req.householdId))
    .limit(1);
  req.recipeBookId = book.id;
  next();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

// Copies a recipe (title, description, steps, ingredients) into a target recipe book.
// Images are not copied — the recipient can add their own.
async function copyRecipe(
  tx: any,
  originalRecipeId: string,
  targetRecipeBookId: string,
  sharedByUserId: string
): Promise<string> {
  const [original] = await tx
    .select()
    .from(recipe)
    .where(eq(recipe.id, originalRecipeId))
    .limit(1);

  const [copy] = await tx
    .insert(recipe)
    .values({
      recipeBookId: targetRecipeBookId,
      title: original.title,
      description: original.description,
      baseServings: original.baseServings,
      steps: original.steps,
      sharedByUserId,
      originalRecipeId: original.id,
    })
    .returning();

  const ingredients = await tx
    .select()
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, originalRecipeId));

  if (ingredients.length > 0) {
    await tx.insert(recipeIngredient).values(
      ingredients.map((ing: any) => ({
        recipeId: copy.id,
        ingredientId: ing.ingredientId,
        quantity: ing.quantity,
        unit: ing.unit,
        note: ing.note,
        sortOrder: ing.sortOrder,
      }))
    );
  }

  return copy.id;
}

// ─── Share routes ─────────────────────────────────────────────────────────────

// GET /api/shares/received — shares sent to me
// Must be before /:id to prevent "received" matching as :id
router.get('/received', async (req, res) => {
  const shares = await db
    .select({
      id: recipeShare.id,
      recipeId: recipeShare.recipeId,
      recipeTitle: recipe.title,
      fromUserId: recipeShare.fromUserId,
      fromUserName: user.name,
      fromUserHandle: user.handle,
      fromUserImage: user.image,
      status: recipeShare.status,
      copiedRecipeId: recipeShare.copiedRecipeId,
      createdAt: recipeShare.createdAt,
      updatedAt: recipeShare.updatedAt,
    })
    .from(recipeShare)
    .leftJoin(recipe, eq(recipeShare.recipeId, recipe.id))
    .leftJoin(user, eq(recipeShare.fromUserId, user.id))
    .where(eq(recipeShare.toUserId, req.user.id))
    .orderBy(desc(recipeShare.createdAt));

  res.json(shares);
});

// GET /api/shares/sent — shares I've sent
router.get('/sent', async (req, res) => {
  const shares = await db
    .select({
      id: recipeShare.id,
      recipeId: recipeShare.recipeId,
      recipeTitle: recipe.title,
      toUserId: recipeShare.toUserId,
      toUserName: user.name,
      toUserHandle: user.handle,
      toUserImage: user.image,
      status: recipeShare.status,
      copiedRecipeId: recipeShare.copiedRecipeId,
      createdAt: recipeShare.createdAt,
      updatedAt: recipeShare.updatedAt,
    })
    .from(recipeShare)
    .leftJoin(recipe, eq(recipeShare.recipeId, recipe.id))
    .leftJoin(user, eq(recipeShare.toUserId, user.id))
    .where(eq(recipeShare.fromUserId, req.user.id))
    .orderBy(desc(recipeShare.createdAt));

  res.json(shares);
});

// POST /api/shares — share a recipe with another user
router.post('/', async (req, res) => {
  const parsed = z.object({
    recipeId: z.string().uuid(),
    toUserId: z.string(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  if (parsed.data.toUserId === req.user.id) {
    res.status(400).json({ error: 'You cannot share a recipe with yourself' });
    return;
  }

  // Verify recipe is in sender's household book
  const [r] = await db
    .select({ id: recipe.id, title: recipe.title })
    .from(recipe)
    .where(and(eq(recipe.id, parsed.data.recipeId), eq(recipe.recipeBookId, req.recipeBookId)))
    .limit(1);
  if (!r) { res.status(404).json({ error: 'Recipe not found' }); return; }

  // Verify recipient exists
  const [recipient] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, parsed.data.toUserId))
    .limit(1);
  if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }

  // Don't allow duplicate pending shares
  const [existingShare] = await db
    .select({ id: recipeShare.id })
    .from(recipeShare)
    .where(and(
      eq(recipeShare.recipeId, parsed.data.recipeId),
      eq(recipeShare.fromUserId, req.user.id),
      eq(recipeShare.toUserId, parsed.data.toUserId),
      eq(recipeShare.status, 'PENDING'),
    ))
    .limit(1);
  if (existingShare) { res.status(409).json({ error: 'You already have a pending share with this user for this recipe' }); return; }

  const [share] = await db
    .insert(recipeShare)
    .values({
      recipeId: parsed.data.recipeId,
      fromUserId: req.user.id,
      toUserId: parsed.data.toUserId,
      status: 'PENDING',
    })
    .returning();

  await db.insert(notification).values({
    userId: parsed.data.toUserId,
    type: 'RECIPE_SHARED',
    payload: {
      shareId: share.id,
      fromUserId: req.user.id,
      fromUserName: req.user.name,
      recipeTitle: r.title,
    },
  });

  res.status(201).json(share);
});

// POST /api/shares/:id/accept — copy recipe into recipient's book
router.post('/:id/accept', async (req, res) => {
  const [share] = await db
    .select()
    .from(recipeShare)
    .where(and(eq(recipeShare.id, req.params.id), eq(recipeShare.toUserId, req.user.id)))
    .limit(1);

  if (!share) { res.status(404).json({ error: 'Share not found' }); return; }
  if (share.status !== 'PENDING') { res.status(400).json({ error: 'Share is no longer pending' }); return; }
  if (!share.recipeId) { res.status(410).json({ error: 'The original recipe has been deleted' }); return; }

  const result = await db.transaction(async (tx) => {
    const copyId = await copyRecipe(tx, share.recipeId!, req.recipeBookId, share.fromUserId);

    const [updated] = await tx
      .update(recipeShare)
      .set({ status: 'ACCEPTED', copiedRecipeId: copyId, updatedAt: new Date() })
      .where(eq(recipeShare.id, share.id))
      .returning();

    return updated;
  });

  res.json(result);
});

// POST /api/shares/:id/reject
router.post('/:id/reject', async (req, res) => {
  const [share] = await db
    .select({ id: recipeShare.id, status: recipeShare.status })
    .from(recipeShare)
    .where(and(eq(recipeShare.id, req.params.id), eq(recipeShare.toUserId, req.user.id)))
    .limit(1);

  if (!share) { res.status(404).json({ error: 'Share not found' }); return; }
  if (share.status !== 'PENDING') { res.status(400).json({ error: 'Share is no longer pending' }); return; }

  const [updated] = await db
    .update(recipeShare)
    .set({ status: 'REJECTED', updatedAt: new Date() })
    .where(eq(recipeShare.id, share.id))
    .returning();

  res.json(updated);
});

// POST /api/shares/:id/recopy — re-copy the original after the recipient deleted their copy
router.post('/:id/recopy', async (req, res) => {
  const [share] = await db
    .select()
    .from(recipeShare)
    .where(and(eq(recipeShare.id, req.params.id), eq(recipeShare.toUserId, req.user.id)))
    .limit(1);

  if (!share) { res.status(404).json({ error: 'Share not found' }); return; }
  if (share.status !== 'ACCEPTED') { res.status(400).json({ error: 'Can only re-copy an accepted share' }); return; }
  if (share.copiedRecipeId !== null) { res.status(409).json({ error: 'You still have a copy — delete it first' }); return; }
  if (!share.recipeId) { res.status(410).json({ error: 'The original recipe has been deleted' }); return; }

  const result = await db.transaction(async (tx) => {
    const copyId = await copyRecipe(tx, share.recipeId!, req.recipeBookId, share.fromUserId);

    const [updated] = await tx
      .update(recipeShare)
      .set({ copiedRecipeId: copyId, updatedAt: new Date() })
      .where(eq(recipeShare.id, share.id))
      .returning();

    return updated;
  });

  res.json(result);
});

// ─── Review routes ────────────────────────────────────────────────────────────

// GET /api/shares/:shareId/review
router.get('/:shareId/review', async (req, res) => {
  const [share] = await db
    .select({ id: recipeShare.id })
    .from(recipeShare)
    .where(and(
      eq(recipeShare.id, req.params.shareId),
      eq(recipeShare.toUserId, req.user.id),
    ))
    .limit(1);

  if (!share) { res.status(404).json({ error: 'Share not found' }); return; }

  const [r] = await db
    .select()
    .from(review)
    .where(eq(review.shareId, share.id))
    .limit(1);

  if (!r) { res.status(404).json({ error: 'No review yet' }); return; }
  res.json(r);
});

// POST /api/shares/:shareId/review — create a review (one per share)
router.post('/:shareId/review', async (req, res) => {
  const parsed = z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [share] = await db
    .select({ id: recipeShare.id, status: recipeShare.status })
    .from(recipeShare)
    .where(and(
      eq(recipeShare.id, req.params.shareId),
      eq(recipeShare.toUserId, req.user.id),
    ))
    .limit(1);

  if (!share) { res.status(404).json({ error: 'Share not found' }); return; }
  if (share.status !== 'ACCEPTED') { res.status(400).json({ error: 'You can only review a recipe you accepted' }); return; }

  const [existing] = await db
    .select({ id: review.id })
    .from(review)
    .where(eq(review.shareId, share.id))
    .limit(1);
  if (existing) { res.status(409).json({ error: 'You have already reviewed this share — use PATCH to update it' }); return; }

  const [created] = await db
    .insert(review)
    .values({ shareId: share.id, rating: parsed.data.rating, comment: parsed.data.comment ?? null })
    .returning();

  res.status(201).json(created);
});

// PATCH /api/shares/:shareId/review — update an existing review
router.patch('/:shareId/review', async (req, res) => {
  const parsed = z.object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const [share] = await db
    .select({ id: recipeShare.id })
    .from(recipeShare)
    .where(and(
      eq(recipeShare.id, req.params.shareId),
      eq(recipeShare.toUserId, req.user.id),
    ))
    .limit(1);

  if (!share) { res.status(404).json({ error: 'Share not found' }); return; }

  const [existing] = await db
    .select({ id: review.id })
    .from(review)
    .where(eq(review.shareId, share.id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: 'No review found — use POST to create one' }); return; }

  const { rating, comment } = parsed.data;

  const [updated] = await db
    .update(review)
    .set({
      ...(rating !== undefined && { rating }),
      ...(comment !== undefined && { comment }),
      updatedAt: new Date(),
    })
    .where(eq(review.id, existing.id))
    .returning();

  res.json(updated);
});

export default router;
