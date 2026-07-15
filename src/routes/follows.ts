import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { follow } from '../schema/social';
import { user } from '../schema/auth';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

// GET /api/follows/following — users I follow (quick list for share dialog)
router.get('/following', async (req, res) => {
  const results = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
      followedAt: follow.createdAt,
    })
    .from(follow)
    .innerJoin(user, eq(follow.followingId, user.id))
    .where(eq(follow.followerId, req.user.id))
    .orderBy(asc(user.name));

  res.json(results);
});

// GET /api/follows/followers — users who follow me
router.get('/followers', async (req, res) => {
  const results = await db
    .select({
      id: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
      followedAt: follow.createdAt,
    })
    .from(follow)
    .innerJoin(user, eq(follow.followerId, user.id))
    .where(eq(follow.followingId, req.user.id))
    .orderBy(asc(user.name));

  res.json(results);
});

// POST /api/follows — follow a user
router.post('/', async (req, res) => {
  const parsed = z.object({ followingId: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  if (parsed.data.followingId === req.user.id) {
    res.status(400).json({ error: 'You cannot follow yourself' });
    return;
  }

  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, parsed.data.followingId))
    .limit(1);
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }

  const [existing] = await db
    .select({ followerId: follow.followerId })
    .from(follow)
    .where(and(eq(follow.followerId, req.user.id), eq(follow.followingId, parsed.data.followingId)))
    .limit(1);
  if (existing) { res.status(409).json({ error: 'Already following this user' }); return; }

  await db.insert(follow).values({ followerId: req.user.id, followingId: parsed.data.followingId });

  res.status(201).json({ message: 'Following' });
});

// DELETE /api/follows/:userId — unfollow a user
router.delete('/:userId', async (req, res) => {
  await db
    .delete(follow)
    .where(and(eq(follow.followerId, req.user.id), eq(follow.followingId, req.params.userId)));

  res.json({ message: 'Unfollowed' });
});

export default router;
