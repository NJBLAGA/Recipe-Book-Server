import { Router } from 'express';
import { ilike } from 'drizzle-orm';
import { db } from '../db';
import { ingredient } from '../schema/ingredient';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

// GET /api/ingredients/search?name= — autocomplete for ingredient names
router.get('/search', async (req, res) => {
  const rawName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const name = rawName.slice(0, 200);

  if (name.length < 2) {
    res.status(400).json({ error: 'Search term must be at least 2 characters' });
    return;
  }

  const results = await db
    .select({ id: ingredient.id, name: ingredient.name })
    .from(ingredient)
    .where(ilike(ingredient.name, `%${name}%`))
    .limit(20);

  res.json(results);
});

export default router;
