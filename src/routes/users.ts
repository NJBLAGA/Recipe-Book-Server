import { Router } from 'express';
import { and, eq, ilike, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { user } from '../schema/auth';
import { household, householdUser } from '../schema/household';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

// GET /api/users/search?handle= — find users by handle (partial, case-insensitive)
// Returns user details + their household (id + name) if they have one
router.get('/search', async (req, res) => {
  const handle = typeof req.query.handle === 'string' ? req.query.handle.trim() : '';

  if (handle.length < 2) {
    res.status(400).json({ error: 'Search term must be at least 2 characters' });
    return;
  }

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
    .where(
      and(
        isNotNull(user.handle),
        ilike(user.handle, `%${handle}%`)
      )
    )
    .limit(20);

  res.json(results);
});

export default router;
