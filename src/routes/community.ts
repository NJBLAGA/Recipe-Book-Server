import { Router } from 'express';
import { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { and, asc, avg, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { communityPost, follow, recipeShare, review } from '../schema/social';
import { user } from '../schema/auth';
import { recipe, recipeBook, recipeImage, recipeIngredient, recipeCategory } from '../schema/recipe';
import { ingredient } from '../schema/ingredient';
import { householdUser } from '../schema/household';
import { requireAuth } from '../middleware/requireAuth';
import { textIsClean } from '../lib/moderation';

const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req as Request).user?.id ?? 'unknown',
  message: { error: 'Too many posts — please wait before posting again' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();
router.use(requireAuth);

// ─── GET /api/community/posts — public feed ───────────────────────────────────
// Optional query params: userId, from (ISO), to (ISO), ingredients (comma-separated)
router.get('/posts', async (req, res) => {
  const filterUserId = typeof req.query.userId === 'string' ? req.query.userId : null;
  const fromParam = typeof req.query.from === 'string' ? new Date(req.query.from) : null;
  const toParam = typeof req.query.to === 'string' ? new Date(req.query.to) : null;
  const rawIngredients = req.query.ingredients;
  const ingredientFilters: string[] = (Array.isArray(rawIngredients)
    ? (rawIngredients as string[]).map((v) => v.trim()).filter(Boolean)
    : typeof rawIngredients === 'string'
      ? rawIngredients.split(',').map((v) => v.trim()).filter(Boolean)
      : []).slice(0, 50);

  const baseWhere = or(eq(user.isPublic, true), eq(communityPost.userId, req.user.id))!;
  const conditions = [baseWhere];
  if (filterUserId) conditions.push(eq(communityPost.userId, filterUserId));
  if (fromParam && !isNaN(fromParam.getTime())) conditions.push(gte(communityPost.createdAt, fromParam));
  if (toParam && !isNaN(toParam.getTime())) conditions.push(lte(communityPost.createdAt, toParam));

  if (ingredientFilters.length > 0) {
    const matchingIds = await db
      .selectDistinct({ recipeId: recipeIngredient.recipeId })
      .from(recipeIngredient)
      .innerJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
      .where(or(...ingredientFilters.map((name) => ilike(ingredient.name, `%${name}%`))));
    if (matchingIds.length === 0) { res.json([]); return; }
    conditions.push(inArray(communityPost.recipeId, matchingIds.map((r) => r.recipeId)));
  }

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
      recipeSource: recipe.source,
      recipePrepTime: recipe.prepTime,
      recipeCookTime: recipe.cookTime,
    })
    .from(communityPost)
    .innerJoin(user, eq(communityPost.userId, user.id))
    .leftJoin(recipe, eq(communityPost.recipeId, recipe.id))
    .where(and(...conditions))
    .orderBy(desc(communityPost.createdAt))
    .limit(500);

  if (rows.length === 0) { res.json([]); return; }

  const recipeIds = [...new Set(rows.map((r) => r.recipeId).filter(Boolean))] as string[];
  const images = recipeIds.length > 0
    ? await db
        .select({ recipeId: recipeImage.recipeId, url: recipeImage.url })
        .from(recipeImage)
        .where(inArray(recipeImage.recipeId, recipeIds))
        .orderBy(asc(recipeImage.sortOrder))
    : [];
  const imageMap = new Map<string, string[]>();
  for (const img of images) {
    const existing = imageMap.get(img.recipeId) ?? [];
    imageMap.set(img.recipeId, [...existing, img.url]);
  }

  const reviewStats = recipeIds.length > 0
    ? await db
        .select({
          recipeId: recipeShare.recipeId,
          reviewCount: count(review.id),
          avgRating: avg(review.rating),
        })
        .from(review)
        .innerJoin(recipeShare, eq(review.shareId, recipeShare.id))
        .where(and(inArray(recipeShare.recipeId, recipeIds), isNotNull(recipeShare.recipeId)))
        .groupBy(recipeShare.recipeId)
    : [];
  const reviewMap = new Map<string, { count: number; avg: number | null }>();
  for (const s of reviewStats) {
    if (s.recipeId) reviewMap.set(s.recipeId, { count: Number(s.reviewCount), avg: s.avgRating != null ? Number(s.avgRating) : null });
  }

  const posterIds = [...new Set(rows.map((r) => r.userId))];
  const followRows = posterIds.length > 0
    ? await db
        .select({ followingId: follow.followingId })
        .from(follow)
        .where(and(eq(follow.followerId, req.user.id), inArray(follow.followingId, posterIds)))
    : [];
  const followingSet = new Set(followRows.map((f) => f.followingId));

  const viewerHouseholdRow = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);
  const viewerHouseholdId = viewerHouseholdRow[0]?.householdId ?? null;

  const posterHouseholdRows = posterIds.length > 0
    ? await db
        .select({ userId: householdUser.userId, householdId: householdUser.householdId })
        .from(householdUser)
        .where(inArray(householdUser.userId, posterIds))
    : [];
  const posterHouseholdMap = new Map(posterHouseholdRows.map((r) => [r.userId, r.householdId]));

  res.json(rows.map((row) => ({
    ...row,
    recipeImages: row.recipeId ? (imageMap.get(row.recipeId) ?? []) : [],
    reviewCount: row.recipeId ? (reviewMap.get(row.recipeId)?.count ?? 0) : 0,
    recipeAvgRating: row.recipeId ? (reviewMap.get(row.recipeId)?.avg ?? null) : null,
    isFollowing: followingSet.has(row.userId),
    isOwnPost: row.userId === req.user.id,
    sameHousehold: viewerHouseholdId !== null && posterHouseholdMap.get(row.userId) === viewerHouseholdId,
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
  const imageMap = new Map<string, string[]>();
  for (const img of images) {
    const existing = imageMap.get(img.recipeId) ?? [];
    imageMap.set(img.recipeId, [...existing, img.url]);
  }

  const reviewStats = recipeIds.length > 0
    ? await db
        .select({
          recipeId: recipeShare.recipeId,
          reviewCount: count(review.id),
          avgRating: avg(review.rating),
        })
        .from(review)
        .innerJoin(recipeShare, eq(review.shareId, recipeShare.id))
        .where(and(inArray(recipeShare.recipeId, recipeIds), isNotNull(recipeShare.recipeId)))
        .groupBy(recipeShare.recipeId)
    : [];
  const reviewMap = new Map<string, { count: number; avg: number | null }>();
  for (const s of reviewStats) {
    if (s.recipeId) reviewMap.set(s.recipeId, { count: Number(s.reviewCount), avg: s.avgRating != null ? Number(s.avgRating) : null });
  }

  const viewerHouseholdRow = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);
  const viewerHouseholdId = viewerHouseholdRow[0]?.householdId ?? null;

  const posterIds = [...new Set(rows.map((r) => r.userId))];
  const posterHouseholdRows = posterIds.length > 0
    ? await db
        .select({ userId: householdUser.userId, householdId: householdUser.householdId })
        .from(householdUser)
        .where(inArray(householdUser.userId, posterIds))
    : [];
  const posterHouseholdMap = new Map(posterHouseholdRows.map((r) => [r.userId, r.householdId]));

  res.json(rows.map((row) => ({
    ...row,
    userName: row.userIsPublic ? row.userName : null,
    userHandle: row.userIsPublic ? row.userHandle : null,
    userImage: row.userIsPublic ? row.userImage : null,
    recipeTitle: row.userIsPublic ? row.recipeTitle : null,
    recipeDescription: row.userIsPublic ? row.recipeDescription : null,
    recipeImages: row.recipeId && row.userIsPublic ? (imageMap.get(row.recipeId) ?? []) : [],
    reviewCount: row.recipeId && row.userIsPublic ? (reviewMap.get(row.recipeId)?.count ?? 0) : 0,
    recipeAvgRating: row.recipeId && row.userIsPublic ? (reviewMap.get(row.recipeId)?.avg ?? null) : null,
    isOwnPost: row.userId === req.user.id,
    isFollowing: true,
    sameHousehold: viewerHouseholdId !== null && posterHouseholdMap.get(row.userId) === viewerHouseholdId,
  })));
});

// ─── GET /api/community/posts/:postId/recipe — recipe detail for modal ────────
router.get('/posts/:postId/recipe', async (req, res) => {
  const [post] = await db
    .select({ recipeId: communityPost.recipeId, userId: communityPost.userId })
    .from(communityPost)
    .where(eq(communityPost.id, req.params.postId))
    .limit(1);

  if (!post) { res.status(404).json({ error: 'Post not found' }); return; }
  if (!post.recipeId) { res.status(404).json({ error: 'Recipe no longer available' }); return; }

  // Only return recipe details if the poster is public or is the requesting user
  if (post.userId !== req.user.id) {
    const [poster] = await db
      .select({ isPublic: user.isPublic })
      .from(user)
      .where(eq(user.id, post.userId))
      .limit(1);
    if (!poster?.isPublic) {
      res.status(403).json({ error: 'This post is from a private user' });
      return;
    }
  }

  const [r] = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      source: recipe.source,
      baseServings: recipe.baseServings,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
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
    .select({ recipeId: communityPost.recipeId, userId: communityPost.userId })
    .from(communityPost)
    .where(eq(communityPost.id, req.params.postId))
    .limit(1);

  if (!post?.recipeId) { res.json([]); return; }

  if (post.userId !== req.user.id) {
    const [poster] = await db
      .select({ isPublic: user.isPublic })
      .from(user)
      .where(eq(user.id, post.userId))
      .limit(1);
    if (!poster?.isPublic) { res.status(403).json({ error: 'This post is from a private user' }); return; }
  }

  const rows = await db
    .select({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      updatedAt: review.updatedAt,
      reviewerId: recipeShare.toUserId,
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
router.post('/posts', postLimiter, async (req, res) => {
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

  if (!textIsClean(parsed.data.comment)) {
    res.status(422).json({ error: 'Comment contains inappropriate content' });
    return;
  }

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
