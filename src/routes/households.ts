import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { household, householdUser } from '../schema/household';
import { recipeBook } from '../schema/recipe';
import { pantry } from '../schema/pantry';
import { shoppingList } from '../schema/shopping';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, 'Household name is required').max(100),
});

// POST /api/households — create a household (caller becomes OWNER)
router.post('/', async (req, res) => {
  const parsed = createHouseholdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const existing = await db
    .select({ id: householdUser.id })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: 'You already belong to a household' });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [newHousehold] = await tx
      .insert(household)
      .values({ name: parsed.data.name })
      .returning();

    await tx.insert(householdUser).values({
      householdId: newHousehold.id,
      userId: req.user.id,
      role: 'OWNER',
    });

    await tx.insert(recipeBook).values({ householdId: newHousehold.id });
    await tx.insert(pantry).values({ householdId: newHousehold.id });
    await tx.insert(shoppingList).values({ householdId: newHousehold.id });

    return newHousehold;
  });

  res.status(201).json(result);
});

// GET /api/households/mine — return the current user's household + their role
router.get('/mine', async (req, res) => {
  const rows = await db
    .select({
      id: household.id,
      name: household.name,
      createdAt: household.createdAt,
      updatedAt: household.updatedAt,
      role: householdUser.role,
    })
    .from(householdUser)
    .innerJoin(household, eq(householdUser.householdId, household.id))
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'No household found' });
    return;
  }

  res.json(rows[0]);
});

export default router;
