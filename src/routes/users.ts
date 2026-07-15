import { Router } from 'express';
import { and, asc, eq, ilike, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { user } from '../schema/auth';
import { household, householdUser } from '../schema/household';
import { userPinnedRecipe } from '../schema/social';
import { recipe } from '../schema/recipe';
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
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, req.user.id))
    .limit(1);

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
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const { handle, firstName, lastName, bio, theme } = parsed.data;

  if (handle !== undefined) {
    const [taken] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.handle, handle), ne(user.id, req.user.id)))
      .limit(1);
    if (taken) { res.status(409).json({ error: 'Handle is already taken' }); return; }
  }

  // Derive updated full name from firstName/lastName when either changes
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
    });

  res.json(updated);
});

// POST /api/users/me/picture — upload profile picture
router.post('/me/picture', upload.single('image'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'Image file is required' }); return; }

  // Remove old Cloudinary image if one exists
  if (req.user.image?.includes('cloudinary.com')) {
    const oldPublicId = extractPublicId(req.user.image);
    if (oldPublicId) await deleteImage(oldPublicId);
  }

  const url = await uploadImage(req.file.buffer, `profile-pictures`);

  const [updated] = await db
    .update(user)
    .set({ image: url, updatedAt: new Date() })
    .where(eq(user.id, req.user.id))
    .returning({ id: user.id, image: user.image });

  res.json(updated);
});

// GET /api/users/search?handle= — find users by handle (partial, case-insensitive)
router.get('/search', async (req, res) => {
  const handle = typeof req.query.handle === 'string' ? req.query.handle.trim() : '';
  if (handle.length < 2) { res.status(400).json({ error: 'Search term must be at least 2 characters' }); return; }

  const results = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
      householdId: household.id,
      householdName: household.name,
    })
    .from(user)
    .leftJoin(householdUser, eq(user.id, householdUser.userId))
    .leftJoin(household, eq(householdUser.householdId, household.id))
    .where(and(isNotNull(user.handle), ilike(user.handle, `%${handle}%`)))
    .limit(20);

  res.json(results);
});

// GET /api/users/:handle — public profile with pinned recipes
// Must be last to avoid matching /me, /search, etc.
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
    })
    .from(userPinnedRecipe)
    .leftJoin(recipe, eq(userPinnedRecipe.recipeId, recipe.id))
    .where(eq(userPinnedRecipe.userId, profile.id))
    .orderBy(asc(userPinnedRecipe.position));

  res.json({ ...profile, pins });
});

export default router;
