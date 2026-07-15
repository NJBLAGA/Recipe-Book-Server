import { Router, Request, Response, NextFunction } from 'express';
import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { recipeBook, recipeCategory, recipe, recipeIngredient, recipeImage } from '../schema/recipe';
import { ingredient } from '../schema/ingredient';
import { pantry, pantryItem, pantryBatch } from '../schema/pantry';
import { userPinnedRecipe } from '../schema/social';
import { requireAuth } from '../middleware/requireAuth';
import { requireHousehold } from '../middleware/requireHousehold';
import { upload } from '../lib/upload';
import { uploadImage, deleteImage, extractPublicId } from '../lib/cloudinary';
import { findOrCreateIngredient } from '../lib/ingredient';

const router = Router();
router.use(requireAuth);
router.use(requireHousehold);

// Resolve recipeBookId for all routes in this router
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const [book] = await db
    .select({ id: recipeBook.id })
    .from(recipeBook)
    .where(eq(recipeBook.householdId, req.householdId))
    .limit(1);

  req.recipeBookId = book.id;
  next();
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, 'Ingredient name is required'),
  quantity: z.number().positive().nullable().default(null),
  unit: z.string().trim().max(50).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
  sortOrder: z.number().int().min(0),
});

const createRecipeSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).optional(),
  baseServings: z.number().int().positive('Base servings must be a positive number'),
  categoryId: z.string().uuid().nullable().optional(),
  steps: z.array(z.string().trim().min(1)).min(1, 'At least one step is required'),
  ingredients: z.array(ingredientInputSchema).min(1, 'At least one ingredient is required'),
});

const updateRecipeSchema = createRecipeSchema.partial();

const reorderImagesSchema = z.array(
  z.object({
    id: z.string().uuid(),
    sortOrder: z.number().int().min(0),
  })
).min(1);

// ─── Category routes ──────────────────────────────────────────────────────────

// GET /api/recipe-book/categories
router.get('/categories', async (req, res) => {
  const categories = await db
    .select()
    .from(recipeCategory)
    .where(eq(recipeCategory.recipeBookId, req.recipeBookId))
    .orderBy(asc(recipeCategory.name));

  res.json(categories);
});

// POST /api/recipe-book/categories
router.post('/categories', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const [existing] = await db
    .select({ id: recipeCategory.id })
    .from(recipeCategory)
    .where(
      and(
        eq(recipeCategory.recipeBookId, req.recipeBookId),
        eq(recipeCategory.name, parsed.data.name)
      )
    )
    .limit(1);

  if (existing) {
    res.status(409).json({ error: 'A category with this name already exists' });
    return;
  }

  const [created] = await db
    .insert(recipeCategory)
    .values({ recipeBookId: req.recipeBookId, name: parsed.data.name })
    .returning();

  res.status(201).json(created);
});

// PATCH /api/recipe-book/categories/:id
router.patch('/categories/:id', async (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const [cat] = await db
    .select({ id: recipeCategory.id })
    .from(recipeCategory)
    .where(
      and(
        eq(recipeCategory.id, req.params.id),
        eq(recipeCategory.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!cat) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const [updated] = await db
    .update(recipeCategory)
    .set({ name: parsed.data.name })
    .where(eq(recipeCategory.id, req.params.id))
    .returning();

  res.json(updated);
});

// DELETE /api/recipe-book/categories/:id
router.delete('/categories/:id', async (req, res) => {
  const [cat] = await db
    .select({ id: recipeCategory.id })
    .from(recipeCategory)
    .where(
      and(
        eq(recipeCategory.id, req.params.id),
        eq(recipeCategory.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!cat) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  // Recipes in this category have categoryId SET NULL (schema constraint) — no manual cleanup needed
  await db.delete(recipeCategory).where(eq(recipeCategory.id, req.params.id));

  res.json({ message: 'Category deleted' });
});

// ─── Pins routes ─────────────────────────────────────────────────────────────

// GET /api/recipe-book/pins — current user's pinned recipes (positions 1-5)
router.get('/pins', async (req, res) => {
  const pins = await db
    .select({
      position: userPinnedRecipe.position,
      recipeId: userPinnedRecipe.recipeId,
      recipeTitle: recipe.title,
      recipeDescription: recipe.description,
    })
    .from(userPinnedRecipe)
    .leftJoin(recipe, eq(userPinnedRecipe.recipeId, recipe.id))
    .where(eq(userPinnedRecipe.userId, req.user.id))
    .orderBy(asc(userPinnedRecipe.position));

  res.json(pins);
});

// PUT /api/recipe-book/pins — replace all pins atomically
router.put('/pins', async (req, res) => {
  const parsed = z.array(
    z.object({
      position: z.number().int().min(1).max(5),
      recipeId: z.string().uuid(),
    })
  ).max(5, 'Maximum 5 pinned recipes').safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const recipeIds = parsed.data.map(p => p.recipeId);
  const positions = parsed.data.map(p => p.position);

  if (new Set(recipeIds).size !== recipeIds.length) {
    res.status(400).json({ error: 'Duplicate recipes in pins' });
    return;
  }
  if (new Set(positions).size !== positions.length) {
    res.status(400).json({ error: 'Duplicate positions in pins' });
    return;
  }

  if (recipeIds.length > 0) {
    const validRecipes = await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(eq(recipe.recipeBookId, req.recipeBookId), inArray(recipe.id, recipeIds)));

    if (validRecipes.length !== recipeIds.length) {
      res.status(400).json({ error: 'One or more recipes not found in your recipe book' });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(userPinnedRecipe).where(eq(userPinnedRecipe.userId, req.user.id));

    if (parsed.data.length > 0) {
      await tx.insert(userPinnedRecipe).values(
        parsed.data.map(p => ({ userId: req.user.id, recipeId: p.recipeId, position: p.position }))
      );
    }
  });

  res.json({ message: 'Pins updated' });
});

// ─── Can-make route ───────────────────────────────────────────────────────────

// GET /api/recipe-book/can-make — tier all recipes by pantry stock
router.get('/can-make', async (req, res) => {
  const [p] = await db
    .select({ id: pantry.id })
    .from(pantry)
    .where(eq(pantry.householdId, req.householdId))
    .limit(1);

  if (!p) { res.json({ ready: [], almost: [], rest: [] }); return; }

  const recipes = await db
    .select({ id: recipe.id, title: recipe.title })
    .from(recipe)
    .where(eq(recipe.recipeBookId, req.recipeBookId))
    .orderBy(asc(recipe.title));

  if (recipes.length === 0) { res.json({ ready: [], almost: [], rest: [] }); return; }

  // effectiveStock = SUM(fillLevel) across all batches per pantry item
  const stockRows = await db
    .select({
      ingredientId: pantryItem.ingredientId,
      effectiveStock: sql<number>`COALESCE(SUM(${pantryBatch.fillLevel}), 0)::int`,
    })
    .from(pantryItem)
    .leftJoin(pantryBatch, eq(pantryBatch.pantryItemId, pantryItem.id))
    .where(eq(pantryItem.pantryId, p.id))
    .groupBy(pantryItem.ingredientId);

  const stockMap = new Map(stockRows.map(r => [r.ingredientId, r.effectiveStock]));

  const recipeIdList = recipes.map(r => r.id);

  const ingRows = await db
    .select({
      recipeId: recipeIngredient.recipeId,
      ingredientId: recipeIngredient.ingredientId,
      name: ingredient.name,
      quantity: recipeIngredient.quantity,
    })
    .from(recipeIngredient)
    .innerJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
    .where(inArray(recipeIngredient.recipeId, recipeIdList));

  const byRecipe = new Map<string, Array<{ ingredientId: string; name: string; quantity: string | null }>>();
  for (const row of ingRows) {
    if (!byRecipe.has(row.recipeId)) byRecipe.set(row.recipeId, []);
    byRecipe.get(row.recipeId)!.push(row);
  }

  const ready: Array<{ id: string; title: string; runningLowItems: Array<{ ingredientId: string; name: string }> }> = [];
  const almost: Array<{ id: string; title: string; matchPct: number; missingIngredients: Array<{ ingredientId: string; name: string }> }> = [];
  const rest: Array<{ id: string; title: string; matchPct: number; missingCount: number }> = [];

  for (const r of recipes) {
    const ings = byRecipe.get(r.id) ?? [];
    const measurable = ings.filter(i => i.quantity !== null);

    const missing = measurable.filter(i => (stockMap.get(i.ingredientId) ?? 0) === 0);
    const runningLow = measurable.filter(i => {
      const stock = stockMap.get(i.ingredientId) ?? 0;
      return stock > 0 && stock <= 25;
    });

    const matchPct = measurable.length > 0
      ? Math.round(((measurable.length - missing.length) / measurable.length) * 100)
      : 100;

    if (missing.length === 0) {
      ready.push({
        id: r.id,
        title: r.title,
        runningLowItems: runningLow.map(i => ({ ingredientId: i.ingredientId, name: i.name })),
      });
    } else if (missing.length <= 2) {
      almost.push({
        id: r.id,
        title: r.title,
        matchPct,
        missingIngredients: missing.map(i => ({ ingredientId: i.ingredientId, name: i.name })),
      });
    } else {
      rest.push({ id: r.id, title: r.title, matchPct, missingCount: missing.length });
    }
  }

  rest.sort((a, b) => b.matchPct - a.matchPct);

  res.json({ ready, almost, rest });
});

// ─── Recipe routes ────────────────────────────────────────────────────────────

// GET /api/recipe-book/recipes
router.get('/recipes', async (req, res) => {
  const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;

  const conditions = [eq(recipe.recipeBookId, req.recipeBookId)];
  if (categoryId) conditions.push(eq(recipe.categoryId, categoryId));
  if (search) conditions.push(ilike(recipe.title, `%${search}%`));

  const recipes = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      baseServings: recipe.baseServings,
      categoryId: recipe.categoryId,
      categoryName: recipeCategory.name,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    })
    .from(recipe)
    .leftJoin(recipeCategory, eq(recipe.categoryId, recipeCategory.id))
    .where(and(...conditions))
    .orderBy(asc(recipe.title));

  res.json(recipes);
});

// POST /api/recipe-book/recipes
router.post('/recipes', async (req, res) => {
  const parsed = createRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { title, description, baseServings, categoryId, steps, ingredients } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [newRecipe] = await tx
      .insert(recipe)
      .values({
        recipeBookId: req.recipeBookId,
        title,
        description,
        baseServings,
        categoryId: categoryId ?? null,
        steps,
      })
      .returning();

    const ingredientRows = await Promise.all(
      ingredients.map(async (ing) => {
        const ingredientId = await findOrCreateIngredient(tx, ing.name);
        return {
          recipeId: newRecipe.id,
          ingredientId,
          quantity: ing.quantity?.toString() ?? null,
          unit: ing.unit,
          note: ing.note,
          sortOrder: ing.sortOrder,
        };
      })
    );

    await tx.insert(recipeIngredient).values(ingredientRows);

    return newRecipe;
  });

  res.status(201).json(result);
});

// GET /api/recipe-book/recipes/:id
router.get('/recipes/:id', async (req, res) => {
  const [r] = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      baseServings: recipe.baseServings,
      categoryId: recipe.categoryId,
      categoryName: recipeCategory.name,
      steps: recipe.steps,
      sharedByUserId: recipe.sharedByUserId,
      originalRecipeId: recipe.originalRecipeId,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    })
    .from(recipe)
    .leftJoin(recipeCategory, eq(recipe.categoryId, recipeCategory.id))
    .where(
      and(
        eq(recipe.id, req.params.id),
        eq(recipe.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!r) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const [ingredients, images] = await Promise.all([
    db
      .select({
        id: recipeIngredient.id,
        ingredientId: recipeIngredient.ingredientId,
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
      .select({ id: recipeImage.id, url: recipeImage.url, sortOrder: recipeImage.sortOrder })
      .from(recipeImage)
      .where(eq(recipeImage.recipeId, r.id))
      .orderBy(asc(recipeImage.sortOrder)),
  ]);

  res.json({ ...r, ingredients, images });
});

// PATCH /api/recipe-book/recipes/:id
router.patch('/recipes/:id', async (req, res) => {
  const parsed = updateRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(
      and(
        eq(recipe.id, req.params.id),
        eq(recipe.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const { title, description, baseServings, categoryId, steps, ingredients } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(recipe)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(baseServings !== undefined && { baseServings }),
        ...(categoryId !== undefined && { categoryId: categoryId ?? null }),
        ...(steps !== undefined && { steps }),
        updatedAt: new Date(),
      })
      .where(eq(recipe.id, req.params.id))
      .returning();

    if (ingredients !== undefined) {
      await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, req.params.id));

      const ingredientRows = await Promise.all(
        ingredients.map(async (ing) => {
          const ingredientId = await findOrCreateIngredient(tx, ing.name);
          return {
            recipeId: req.params.id,
            ingredientId,
            quantity: ing.quantity?.toString() ?? null,
            unit: ing.unit,
            note: ing.note,
            sortOrder: ing.sortOrder,
          };
        })
      );

      await tx.insert(recipeIngredient).values(ingredientRows);
    }

    return updated;
  });

  res.json(result);
});

// DELETE /api/recipe-book/recipes/:id
router.delete('/recipes/:id', async (req, res) => {
  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(
      and(
        eq(recipe.id, req.params.id),
        eq(recipe.recipeBookId, req.recipeBookId)
      )
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  await db.delete(recipe).where(eq(recipe.id, req.params.id));

  res.json({ message: 'Recipe deleted' });
});

// ─── Recipe image routes ──────────────────────────────────────────────────────

// POST /api/recipe-book/recipes/:id/images
router.post('/recipes/:id/images', upload.single('image'), async (req, res) => {
  const recipeId = req.params.id as string;
  const recipeBookId = req.recipeBookId;
  const householdId = req.householdId;

  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.id, recipeId), eq(recipe.recipeBookId, recipeBookId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'Image file is required' });
    return;
  }

  const url = await uploadImage(req.file.buffer, `recipe-images/${householdId}`);

  const [image] = await db
    .insert(recipeImage)
    .values({ recipeId, url, sortOrder: 0 })
    .returning();

  res.status(201).json(image);
});

// PATCH /api/recipe-book/recipes/:id/images/order — update sortOrder for a set of images
router.patch('/recipes/:id/images/order', async (req, res) => {
  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.id, req.params.id), eq(recipe.recipeBookId, req.recipeBookId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const parsed = reorderImagesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of parsed.data) {
      await tx
        .update(recipeImage)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(recipeImage.id, item.id), eq(recipeImage.recipeId, req.params.id)));
    }
  });

  res.json({ message: 'Order updated' });
});

// DELETE /api/recipe-book/recipes/:id/images/:imageId
router.delete('/recipes/:id/images/:imageId', async (req, res) => {
  const [existing] = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(and(eq(recipe.id, req.params.id), eq(recipe.recipeBookId, req.recipeBookId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const [image] = await db
    .select({ id: recipeImage.id, url: recipeImage.url })
    .from(recipeImage)
    .where(and(eq(recipeImage.id, req.params.imageId), eq(recipeImage.recipeId, req.params.id)))
    .limit(1);

  if (!image) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }

  const publicId = extractPublicId(image.url);
  if (publicId) await deleteImage(publicId);

  await db.delete(recipeImage).where(eq(recipeImage.id, image.id));

  res.json({ message: 'Image deleted' });
});

export default router;
