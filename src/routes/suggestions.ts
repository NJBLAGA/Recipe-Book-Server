import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { recipeBook, recipeCategory } from '../schema/recipe';
import { pantry, pantryCategory } from '../schema/pantry';
import { shoppingList, shoppingListCategory } from '../schema/shopping';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { suggestCategory } from '../lib/anthropic';

const router = Router();
router.use(requireAuth);
router.use(requireHousehold);

const bodySchema = z.object({
  type: z.enum(['recipe', 'pantry', 'shopping-list']),
  name: z.string().min(1).max(200).trim(),
});

router.post('/category', async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'type and name are required' });
    return;
  }

  const { type, name } = parsed.data;
  const { householdId } = req;

  try {
    let categories: { id: string; name: string }[] = [];

    if (type === 'recipe') {
      const [book] = await db
        .select({ id: recipeBook.id })
        .from(recipeBook)
        .where(eq(recipeBook.householdId, householdId))
        .limit(1);
      if (book) {
        categories = await db
          .select({ id: recipeCategory.id, name: recipeCategory.name })
          .from(recipeCategory)
          .where(eq(recipeCategory.recipeBookId, book.id));
      }
    } else if (type === 'pantry') {
      const [p] = await db
        .select({ id: pantry.id })
        .from(pantry)
        .where(eq(pantry.householdId, householdId))
        .limit(1);
      if (p) {
        categories = await db
          .select({ id: pantryCategory.id, name: pantryCategory.name })
          .from(pantryCategory)
          .where(eq(pantryCategory.pantryId, p.id));
      }
    } else {
      const [sl] = await db
        .select({ id: shoppingList.id })
        .from(shoppingList)
        .where(eq(shoppingList.householdId, householdId))
        .limit(1);
      if (sl) {
        categories = await db
          .select({ id: shoppingListCategory.id, name: shoppingListCategory.name })
          .from(shoppingListCategory)
          .where(eq(shoppingListCategory.shoppingListId, sl.id));
      }
    }

    const suggestion = await suggestCategory(name, type, categories.map((c) => c.name));

    const matched = categories.find(
      (c) => c.name.toLowerCase() === suggestion.toLowerCase(),
    );

    res.json({ suggestion, categoryId: matched?.id ?? null });
  } catch (e) {
    console.error('[suggestions] category error:', e);
    res.status(500).json({ error: 'Failed to suggest category' });
  }
});

export default router;
