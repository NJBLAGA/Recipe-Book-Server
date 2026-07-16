import { Router } from 'express';
import { and, asc, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { communityPost, follow, recipeShare, review } from '../schema/social';
import { user } from '../schema/auth';
import { recipe, recipeBook, recipeImage, recipeIngredient, recipeCategory } from '../schema/recipe';
import { ingredient } from '../schema/ingredient';
import { householdUser } from '../schema/household';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

// ─── GET /api/community/posts — public feed ───────────────────────────────────
// Optional query params: userId (filter by poster), since (24h|1w|1m|all)
router.get('/posts', async (req, res) => {
  const filterUserId = typeof req.query.userId === 'string' ? req.query.userId : null;
  const since = typeof req.query.since === 'string' ? req.query.since : 'all';

  const sinceDate: Date | null = (() => {
    const now = new Date();
    if (since === '24h') return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (since === '1w') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (since === '1m') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return null;
  })();

  const baseWhere = or(eq(user.isPublic, true), eq(communityPost.userId, req.user.id))!;
  const conditions = [baseWhere];
  if (filterUserId) conditions.push(eq(communityPost.userId, filterUserId));
  if (sinceDate) conditions.push(gte(communityPost.createdAt, sinceDate));

  const rows = await db
    .select({
      id: communityPost.id,
      comment: communityPost.comment,
      createdAt: communityPost.createdAt,
      userId: communityPost.userId,
      userName: user.name,
      userHandle: user.handle,
      userImage: user.image,
      recipeId: communityPost.recipeId,
      recipeTitle: recipe.title,
      recipeDescription: recipe.description,
    })
    .from(communityPost)
    .innerJoin(user, eq(communityPost.userId, user.id))
    .leftJoin(recipe, eq(communityPost.recipeId, recipe.id))
    .where(and(...conditions))
    .orderBy(desc(communityPost.createdAt))
    .limit(200);

  if (rows.length === 0) { res.json([]); return; }

  const recipeIds = [...new Set(rows.map((r) => r.recipeId).filter(Boolean))] as string[];
  const images = recipeIds.length > 0
    ? await db
        .select({ recipeId: recipeImage.recipeId, url: recipeImage.url })
        .from(recipeImage)
        .where(inArray(recipeImage.recipeId, recipeIds))
        .orderBy(asc(recipeImage.sortOrder))
    : [];
  const imageMap = new Map<string, string>();
  for (const img of images) {
    if (!imageMap.has(img.recipeId)) imageMap.set(img.recipeId, img.url);
  }

  const posterIds = [...new Set(rows.map((r) => r.userId))];
  const followRows = posterIds.length > 0
    ? await db
        .select({ followingId: follow.followingId })
        .from(follow)
        .where(and(eq(follow.followerId, req.user.id), inArray(follow.followingId, posterIds)))
    : [];
  const followingSet = new Set(followRows.map((f) => f.followingId));

  res.json(rows.map((row) => ({
    ...row,
    recipeImage: row.recipeId ? (imageMap.get(row.recipeId) ?? null) : null,
    isFollowing: followingSet.has(row.userId),
    isOwnPost: row.userId === req.user.id,
  })));
});

// ─── GET /api/community/posts/following ───────────────────────────────────────
// Must come BEFORE /:postId
router.get('/posts/following', async (req, res) => {
  const followedRows = await db
    .select({ followingId: follow.followingId })
    .from(follow)
    .where(eq(follow.followerId, req.user.id));

  if (followedRows.length === 0) { res.json([]); return; }
  const followedIds = followedRows.map((f) => f.followingId);

  const rows = await db
    .select({
      id: communityPost.id,
      comment: communityPost.comment,
      createdAt: communityPost.createdAt,
      userId: communityPost.userId,
      userName: user.name,
      userHandle: user.handle,
      userImage: user.image,
      userIsPublic: user.isPublic,
      recipeId: communityPost.recipeId,
      recipeTitle: recipe.title,
      recipeDescription: recipe.description,
    })
    .from(communityPost)
    .innerJoin(user, eq(communityPost.userId, user.id))
    .leftJoin(recipe, eq(communityPost.recipeId, recipe.id))
    .where(inArray(communityPost.userId, followedIds))
    .orderBy(desc(communityPost.createdAt))
    .limit(200);

  const recipeIds = [...new Set(rows.map((r) => r.recipeId).filter(Boolean))] as string[];
  const images = recipeIds.length > 0
    ? await db
        .select({ recipeId: recipeImage.recipeId, url: recipeImage.url })
        .from(recipeImage)
        .where(inArray(recipeImage.recipeId, recipeIds))
        .orderBy(asc(recipeImage.sortOrder))
    : [];
  const imageMap = new Map<string, string>();
  for (const img of images) {
    if (!imageMap.has(img.recipeId)) imageMap.set(img.recipeId, img.url);
  }

  res.json(rows.map((row) => ({
    ...row,
    userName: row.userIsPublic ? row.userName : null,
    userHandle: row.userIsPublic ? row.userHandle : null,
    userImage: row.userIsPublic ? row.userImage : null,
    recipeImage: row.recipeId ? (imageMap.get(row.recipeId) ?? null) : null,
    isOwnPost: row.userId === req.user.id,
  })));
});

// ─── GET /api/community/posts/:postId/recipe — recipe detail for modal ────────
router.get('/posts/:postId/recipe', async (req, res) => {
  const [post] = await db
    .select({ recipeId: communityPost.recipeId })
    .from(communityPost)
    .where(eq(communityPost.id, req.params.postId))
    .limit(1);

  if (!post) { res.status(404).json({ error: 'Post not found' }); return; }
  if (!post.recipeId) { res.status(404).json({ error: 'Recipe no longer available' }); return; }

  const [r] = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      baseServings: recipe.baseServings,
      steps: recipe.steps,
      categoryName: recipeCategory.name,
    })
    .from(recipe)
    .leftJoin(recipeCategory, eq(recipe.categoryId, recipeCategory.id))
    .where(eq(recipe.id, post.recipeId))
    .limit(1);

  if (!r) { res.status(404).json({ error: 'Recipe not found' }); return; }

  const [ingredients, images] = await Promise.all([
    db
      .select({
        id: recipeIngredient.id,
        name: ingredient.name,
        quantity: recipeIngredient.quantity,
        unit: recipeIngredient.unit,
        note: recipeIngredient.note,
        sortOrder: recipeIngredient.sortOrder,
      })
      .from(recipeIngredient)
      .innerJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
      .where(eq(recipeIngredient.recipeId, r.id))
      .orderBy(asc(recipeIngredient.sortOrder)),
    db
      .select({ url: recipeImage.url, sortOrder: recipeImage.sortOrder })
      .from(recipeImage)
      .where(eq(recipeImage.recipeId, r.id))
      .orderBy(asc(recipeImage.sortOrder)),
  ]);

  res.json({ ...r, ingredients, images });
});

// ─── GET /api/community/posts/:postId/recipe/reviews — all reviews for the recipe ──
router.get('/posts/:postId/recipe/reviews', async (req, res) => {
  const [post] = await db
    .select({ recipeId: communityPost.recipeId })
    .from(communityPost)
    .where(eq(communityPost.id, req.params.postId))
    .limit(1);

  if (!post?.recipeId) { res.json([]); return; }

  const rows = await db
    .select({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      updatedAt: review.updatedAt,
      reviewerName: user.name,
      reviewerHandle: user.handle,
      reviewerImage: user.image,
    })
    .from(review)
    .innerJoin(recipeShare, eq(review.shareId, recipeShare.id))
    .innerJoin(user, eq(recipeShare.toUserId, user.id))
    .where(eq(recipeShare.recipeId, post.recipeId))
    .orderBy(desc(review.updatedAt));

  res.json(rows);
});

// ─── POST /api/community/posts — create a community post ─────────────────────
router.post('/posts', async (req, res) => {
  const parsed = z.object({
    recipeId: z.string().uuid(),
    comment: z.string().trim().min(1, 'Comment is required').max(1000),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  // Verify recipe belongs to the current user's household via proper joins
  const [owned] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .innerJoin(recipeBook, eq(recipe.recipeBookId, recipeBook.id))
    .innerJoin(householdUser, eq(recipeBook.householdId, householdUser.householdId))
    .where(and(eq(recipe.id, parsed.data.recipeId), eq(householdUser.userId, req.user.id)))
    .limit(1);

  if (!owned) { res.status(403).json({ error: 'Recipe not found in your household' }); return; }

  const [created] = await db
    .insert(communityPost)
    .values({ userId: req.user.id, recipeId: parsed.data.recipeId, comment: parsed.data.comment })
    .returning();

  res.status(201).json(created);
});

// ─── DELETE /api/community/posts/:id — delete own post ────────────────────────
router.delete('/posts/:id', async (req, res) => {
  const [post] = await db
    .select({ userId: communityPost.userId })
    .from(communityPost)
    .where(eq(communityPost.id, req.params.id))
    .limit(1);

  if (!post) { res.status(404).json({ error: 'Post not found' }); return; }
  if (post.userId !== req.user.id) { res.status(403).json({ error: 'Not your post' }); return; }

  await db.delete(communityPost).where(eq(communityPost.id, req.params.id));
  res.json({ message: 'Deleted' });
});

export default router;
