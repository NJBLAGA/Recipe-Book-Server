import { Router } from 'express';
import { and, asc, avg, count, desc, eq, ilike, inArray, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { user } from '../schema/auth';
import { household, householdUser } from '../schema/household';
import { userPinnedRecipe } from '../schema/social';
import { recipe, recipeImage } from '../schema/recipe';
import { recipeShare } from '../schema/social';
import { review } from '../schema/social';
import { requireAuth } from '../middleware/requireAuth';
import { upload } from '../lib/upload';
import { uploadImage, deleteImage, extractPublicId } from '../lib/cloudinary';

const router = Router();
router.use(requireAuth);

// GET /api/users/me — current user's own profile
router.get('/me', async (req, res) => {
  const [profile] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      handle: user.handle,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      image: user.image,
      theme: user.theme,
      isPublic: user.isPublic,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, req.user.id))
    .limit(1);

  if (!profile) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(profile);
});

// PATCH /api/users/me — update profile fields
router.patch('/me', async (req, res) => {
  const parsed = z.object({
    handle: z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9_]+$/, 'Handle can only contain letters, numbers, and underscores').optional(),
    firstName: z.string().trim().max(100).nullable().optional(),
    lastName: z.string().trim().max(100).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    theme: z.enum(['light', 'dark']).nullable().optional(),
    isPublic: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const { handle, firstName, lastName, bio, theme, isPublic } = parsed.data;

  if (handle !== undefined) {
    const [taken] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.handle, handle), ne(user.id, req.user.id)))
      .limit(1);
    if (taken) { res.status(409).json({ error: 'Handle is already taken' }); return; }
  }

  const first = firstName !== undefined ? (firstName ?? '') : (req.user.firstName ?? '');
  const last = lastName !== undefined ? (lastName ?? '') : (req.user.lastName ?? '');
  const derivedName = [first, last].filter(Boolean).join(' ') || req.user.name;

  const [updated] = await db
    .update(user)
    .set({
      ...(handle !== undefined && { handle }),
      ...(firstName !== undefined && { firstName }),
      ...(lastName !== undefined && { lastName }),
      ...(bio !== undefined && { bio }),
      ...(theme !== undefined && { theme }),
      ...(isPublic !== undefined && { isPublic }),
      name: derivedName,
      updatedAt: new Date(),
    })
    .where(eq(user.id, req.user.id))
    .returning({
      id: user.id,
      name: user.name,
      handle: user.handle,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      image: user.image,
      theme: user.theme,
      isPublic: user.isPublic,
    });

  res.json(updated);
});

// POST /api/users/me/picture — upload profile picture
router.post('/me/picture', upload.single('image'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'Image file is required' }); return; }

  if (req.user.image?.includes('cloudinary.com')) {
    const oldPublicId = extractPublicId(req.user.image);
    if (oldPublicId) await deleteImage(oldPublicId).catch(() => {});
  }

  const url = await uploadImage(req.file.buffer, `profile-pictures`);

  const [updated] = await db
    .update(user)
    .set({ image: url, updatedAt: new Date() })
    .where(eq(user.id, req.user.id))
    .returning({ id: user.id, image: user.image });

  res.json(updated);
});

// GET /api/users/community — public users browsable in the community tab
router.get('/community', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  const conditions = [isNotNull(user.handle), eq(user.isPublic, true)];
  if (search.length >= 2) conditions.push(ilike(user.handle, `%${search}%`));

  const results = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
      bio: user.bio,
      householdId: householdUser.householdId,
      householdName: household.name,
    })
    .from(user)
    .leftJoin(householdUser, eq(user.id, householdUser.userId))
    .leftJoin(household, eq(householdUser.householdId, household.id))
    .where(and(...conditions))
    .orderBy(desc(user.createdAt))
    .limit(50);

  res.json(results);
});

// GET /api/users/search?handle= — find users by handle (only public profiles)
router.get('/search', async (req, res) => {
  const handle = typeof req.query.handle === 'string' ? req.query.handle.trim() : '';
  if (handle.length < 2) { res.status(400).json({ error: 'Search term must be at least 2 characters' }); return; }

  const results = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
      householdId: householdUser.householdId,
      householdName: household.name,
    })
    .from(user)
    .leftJoin(householdUser, eq(user.id, householdUser.userId))
    .leftJoin(household, eq(householdUser.householdId, household.id))
    .where(and(isNotNull(user.handle), eq(user.isPublic, true), ilike(user.handle, `%${handle}%`)))
    .limit(20);

  res.json(results);
});

// GET /api/users/:handle — public profile with pinned recipes
router.get('/:handle', async (req, res) => {
  const [profile] = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      firstName: user.firstName,
      lastName: user.lastName,
      bio: user.bio,
      image: user.image,
      isPublic: user.isPublic,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.handle, req.params.handle))
    .limit(1);

  if (!profile) { res.status(404).json({ error: 'User not found' }); return; }

  const pins = await db
    .select({
      position: userPinnedRecipe.position,
      recipeId: userPinnedRecipe.recipeId,
      recipeTitle: recipe.title,
      recipeDescription: recipe.description,
    })
    .from(userPinnedRecipe)
    .leftJoin(recipe, eq(userPinnedRecipe.recipeId, recipe.id))
    .where(eq(userPinnedRecipe.userId, profile.id))
    .orderBy(asc(userPinnedRecipe.position));

  const recipeIds = pins.map((p) => p.recipeId).filter(Boolean) as string[];
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

  const ratings = recipeIds.length > 0
    ? await db
        .select({
          recipeId: recipeShare.recipeId,
          avgRating: avg(review.rating),
          reviewCount: count(review.id),
        })
        .from(recipeShare)
        .innerJoin(review, eq(review.shareId, recipeShare.id))
        .where(inArray(recipeShare.recipeId, recipeIds))
        .groupBy(recipeShare.recipeId)
    : [];

  const ratingMap = new Map(ratings.map((r) => [r.recipeId, { avg: Number(r.avgRating), count: Number(r.reviewCount) }]));

  const enrichedPins = pins.map((p) => ({
    ...p,
    recipeImage: p.recipeId ? (imageMap.get(p.recipeId) ?? null) : null,
    recipeRating: p.recipeId ? (ratingMap.get(p.recipeId) ?? null) : null,
  }));

  res.json({ ...profile, pins: enrichedPins });
});

export default router;
