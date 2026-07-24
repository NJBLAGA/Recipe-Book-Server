import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { user } from '../schema/auth';
import { householdUser } from '../schema/household';
import { recipeBook, recipeCategory, recipe, recipeIngredient } from '../schema/recipe';
import { pantry, pantryCategory, pantryItem } from '../schema/pantry';
import { shoppingList, shoppingListCategory, shoppingListItem } from '../schema/shopping';
import { recipeShare, follow } from '../schema/social';
import { requireAuth } from '../middleware/requireAuth';
import { findOrCreateIngredient } from '../lib/ingredient';

const router = Router();
router.use(requireAuth);

async function getOrCreateDemoUser(
  email: string,
  userData: { name: string; firstName: string; lastName: string; bio: string }
): Promise<string> {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(user).values({
    id: randomUUID(),
    email,
    emailVerified: true,
    isDemoUser: true,
    isPublic: false,
    onboardingComplete: true,
    ...userData,
  }).returning({ id: user.id });
  return created.id;
}

// POST /api/tutorial/seed — populate the current user's household with demo data for the tour
router.post('/seed', async (req, res) => {
  const [membership] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (!membership) {
    res.status(400).json({ error: 'You must be in a household first' });
    return;
  }

  const householdId = membership.householdId;

  const [book] = await db
    .select({ id: recipeBook.id })
    .from(recipeBook)
    .where(eq(recipeBook.householdId, householdId));

  const [pantryRow] = await db
    .select({ id: pantry.id })
    .from(pantry)
    .where(eq(pantry.householdId, householdId));

  const [listRow] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(eq(shoppingList.householdId, householdId));

  if (!book || !pantryRow || !listRow) {
    res.status(500).json({ error: 'Household setup incomplete' });
    return;
  }

  // Get or create 2 demo users unique to this household (idempotent by email)
  const demoUser1Id = await getOrCreateDemoUser(`demo1-${householdId}@tutorial.rb`, {
    name: 'Jamie Clarke',
    firstName: 'Jamie',
    lastName: 'Clarke',
    bio: 'Home cook and weekend baker. Obsessed with sourdough.',
  });
  const demoUser2Id = await getOrCreateDemoUser(`demo2-${householdId}@tutorial.rb`, {
    name: 'Alex Rivera',
    firstName: 'Alex',
    lastName: 'Rivera',
    bio: 'Passionate about Asian cuisine and meal prep.',
  });

  // Add them to the household (skip if already members)
  await db.insert(householdUser).values([
    { householdId, userId: demoUser1Id, role: 'USER' },
    { householdId, userId: demoUser2Id, role: 'USER' },
  ]).onConflictDoNothing();

  // ── Recipe categories ─────────────────────────────────────────────────────
  const catNames = ['Breakfast', 'Pasta & Grains', 'Salads', 'Soups & Stews', 'Desserts', 'Quick Dinners', 'Snacks'];
  const catMap: Record<string, string> = {};
  for (const name of catNames) {
    const [existing] = await db
      .select({ id: recipeCategory.id })
      .from(recipeCategory)
      .where(and(eq(recipeCategory.recipeBookId, book.id), eq(recipeCategory.name, name)))
      .limit(1);
    if (existing) { catMap[name] = existing.id; continue; }
    const [created] = await db
      .insert(recipeCategory)
      .values({ recipeBookId: book.id, name })
      .returning({ id: recipeCategory.id });
    catMap[name] = created.id;
  }

  // ── Recipes ───────────────────────────────────────────────────────────────
  const RECIPES = [
    {
      title: 'Classic Spaghetti Bolognese',
      description: 'A rich Italian meat sauce slow-cooked to perfection, served over al dente spaghetti.',
      baseServings: 4,
      categoryName: 'Pasta & Grains',
      source: 'Family Recipe',
      steps: [
        { text: 'Heat olive oil in a large heavy-based pan over medium heat. Add diced onion and cook until softened, about 5 minutes.', subSteps: [] },
        { text: 'Add minced garlic, carrot and celery. Cook for 3 minutes until fragrant.', subSteps: [] },
        { text: 'Increase heat and add minced beef. Brown well, then pour in red wine and reduce by half.', subSteps: [] },
        { text: 'Add crushed tomatoes, tomato paste, bay leaves and oregano. Simmer on low for 1 hour.', subSteps: ['The longer it simmers, the richer the flavour'] },
        { text: 'Cook spaghetti in salted boiling water until al dente. Drain, toss through sauce, and serve with parmesan.', subSteps: [] },
      ],
      ingredients: [
        { name: 'spaghetti', quantity: 400, unit: 'g', note: null },
        { name: 'minced beef', quantity: 500, unit: 'g', note: null },
        { name: 'onion', quantity: 1, unit: null, note: 'finely diced' },
        { name: 'garlic', quantity: 3, unit: 'cloves', note: 'minced' },
        { name: 'carrot', quantity: 1, unit: null, note: 'finely diced' },
        { name: 'celery', quantity: 2, unit: 'stalks', note: 'finely diced' },
        { name: 'crushed tomatoes', quantity: 400, unit: 'g', note: null },
        { name: 'tomato paste', quantity: 2, unit: 'tbsp', note: null },
        { name: 'red wine', quantity: 150, unit: 'ml', note: null },
        { name: 'dried oregano', quantity: 1, unit: 'tsp', note: null },
        { name: 'olive oil', quantity: 2, unit: 'tbsp', note: null },
        { name: 'parmesan', quantity: null, unit: null, note: 'to serve' },
      ],
    },
    {
      title: 'Avocado Toast with Poached Eggs',
      description: 'The classic café brunch made at home — creamy avocado on sourdough with perfectly poached eggs.',
      baseServings: 2,
      categoryName: 'Breakfast',
      source: 'Jamie Clarke',
      steps: [
        { text: 'Toast sourdough slices until golden and crisp.', subSteps: [] },
        { text: 'Mash ripe avocado with salt, pepper and a squeeze of lemon.', subSteps: [] },
        { text: 'Poach eggs in barely simmering water with a splash of vinegar for 3 minutes.', subSteps: [] },
        { text: 'Spread avocado over toast, top with eggs and fresh herbs.', subSteps: [] },
      ],
      ingredients: [
        { name: 'sourdough bread', quantity: 4, unit: 'slices', note: null },
        { name: 'avocado', quantity: 2, unit: null, note: 'ripe' },
        { name: 'eggs', quantity: 4, unit: null, note: 'free-range' },
        { name: 'lemon', quantity: 0.5, unit: null, note: null },
        { name: 'chilli flakes', quantity: null, unit: null, note: 'to taste' },
        { name: 'white vinegar', quantity: 1, unit: 'tbsp', note: 'for poaching' },
        { name: 'fresh herbs', quantity: null, unit: null, note: 'chives or coriander, to serve' },
      ],
    },
    {
      title: 'Creamy Mushroom Risotto',
      description: 'Velvety, rich risotto packed with earthy mushrooms — ultimate comfort food.',
      baseServings: 4,
      categoryName: 'Pasta & Grains',
      source: 'Alex Rivera',
      steps: [
        { text: 'Warm the stock in a saucepan and keep it at a gentle simmer.', subSteps: [] },
        { text: 'Melt butter with olive oil in a wide pan. Sauté shallots until translucent, then add mushrooms and cook until golden.', subSteps: [] },
        { text: 'Add arborio rice and stir for 2 minutes. Pour in white wine and stir until absorbed.', subSteps: [] },
        { text: 'Add hot stock one ladle at a time, stirring constantly, until rice is al dente — about 18 minutes.', subSteps: ['Never stop stirring — this is what makes it creamy'] },
        { text: 'Remove from heat, stir in cold butter and parmesan. Season generously.', subSteps: [] },
      ],
      ingredients: [
        { name: 'arborio rice', quantity: 320, unit: 'g', note: null },
        { name: 'mixed mushrooms', quantity: 400, unit: 'g', note: 'sliced' },
        { name: 'vegetable stock', quantity: 1.2, unit: 'L', note: 'warm' },
        { name: 'shallots', quantity: 2, unit: null, note: 'finely diced' },
        { name: 'white wine', quantity: 150, unit: 'ml', note: null },
        { name: 'butter', quantity: 60, unit: 'g', note: 'divided' },
        { name: 'olive oil', quantity: 2, unit: 'tbsp', note: null },
        { name: 'parmesan', quantity: 60, unit: 'g', note: 'freshly grated' },
      ],
    },
    {
      title: 'Chicken Tikka Masala',
      description: 'Tender marinated chicken in a rich, spiced tomato and cream sauce — a classic curry.',
      baseServings: 4,
      categoryName: 'Quick Dinners',
      source: 'Family Recipe',
      steps: [
        { text: 'Marinate chicken in yoghurt, lemon juice and spices for at least 2 hours. Grill or bake at 220°C for 15 minutes.', subSteps: [] },
        { text: 'Sauté onion in butter until deeply golden, then add garlic, ginger and spices.', subSteps: [] },
        { text: 'Add crushed tomatoes and simmer 10 minutes. Stir in cream and cooked chicken.', subSteps: [] },
        { text: 'Garnish with coriander. Serve with basmati rice and naan.', subSteps: [] },
      ],
      ingredients: [
        { name: 'chicken thighs', quantity: 800, unit: 'g', note: 'boneless, cut into chunks' },
        { name: 'yoghurt', quantity: 150, unit: 'g', note: 'full fat' },
        { name: 'crushed tomatoes', quantity: 400, unit: 'g', note: null },
        { name: 'heavy cream', quantity: 200, unit: 'ml', note: null },
        { name: 'onion', quantity: 2, unit: null, note: null },
        { name: 'garlic', quantity: 4, unit: 'cloves', note: 'minced' },
        { name: 'fresh ginger', quantity: 2, unit: 'tsp', note: 'grated' },
        { name: 'garam masala', quantity: 2, unit: 'tsp', note: null },
        { name: 'ground cumin', quantity: 1, unit: 'tsp', note: null },
        { name: 'butter', quantity: 2, unit: 'tbsp', note: null },
        { name: 'basmati rice', quantity: 300, unit: 'g', note: 'to serve' },
        { name: 'fresh coriander', quantity: null, unit: null, note: 'to garnish' },
      ],
    },
    {
      title: 'Chocolate Lava Cake',
      description: 'Individual chocolate cakes with a molten flowing centre. Ready in 20 minutes.',
      baseServings: 4,
      categoryName: 'Desserts',
      source: 'Jamie Clarke',
      steps: [
        { text: 'Preheat oven to 220°C. Grease 4 ramekins with butter and dust with cocoa powder.', subSteps: [] },
        { text: 'Melt dark chocolate and butter together in a heatproof bowl.', subSteps: [] },
        { text: 'Whisk eggs, yolks and sugar until pale. Fold in chocolate mixture, then sift in flour.', subSteps: [] },
        { text: 'Divide batter between ramekins. Bake for exactly 12 minutes. Invert and serve immediately.', subSteps: ['The centre should still jiggle when done'] },
      ],
      ingredients: [
        { name: 'dark chocolate', quantity: 200, unit: 'g', note: '70% cocoa' },
        { name: 'butter', quantity: 150, unit: 'g', note: 'plus extra for greasing' },
        { name: 'eggs', quantity: 3, unit: null, note: null },
        { name: 'egg yolks', quantity: 3, unit: null, note: null },
        { name: 'caster sugar', quantity: 100, unit: 'g', note: null },
        { name: 'plain flour', quantity: 50, unit: 'g', note: null },
        { name: 'vanilla ice cream', quantity: null, unit: null, note: 'to serve' },
      ],
    },
    {
      title: 'Greek Salad',
      description: 'A vibrant, refreshing salad with salty feta, crisp vegetables, and a simple olive oil dressing.',
      baseServings: 4,
      categoryName: 'Salads',
      source: 'Alex Rivera',
      steps: [
        { text: 'Slice cucumber into chunky half-moons. Halve the cherry tomatoes.', subSteps: [] },
        { text: 'Slice red onion very thin and soak in cold water for 5 minutes.', subSteps: [] },
        { text: 'Combine cucumber, tomatoes, drained onion, olives and capsicum in a large bowl.', subSteps: [] },
        { text: 'Whisk olive oil, red wine vinegar, dried oregano, salt and pepper. Pour over salad and top with feta.', subSteps: [] },
      ],
      ingredients: [
        { name: 'cucumber', quantity: 1, unit: null, note: null },
        { name: 'cherry tomatoes', quantity: 250, unit: 'g', note: null },
        { name: 'red onion', quantity: 0.5, unit: null, note: null },
        { name: 'kalamata olives', quantity: 80, unit: 'g', note: 'pitted' },
        { name: 'feta cheese', quantity: 200, unit: 'g', note: null },
        { name: 'red capsicum', quantity: 1, unit: null, note: 'diced' },
        { name: 'olive oil', quantity: 4, unit: 'tbsp', note: 'extra virgin' },
        { name: 'red wine vinegar', quantity: 1, unit: 'tbsp', note: null },
        { name: 'dried oregano', quantity: 1, unit: 'tsp', note: null },
      ],
    },
    {
      title: 'Homemade Hummus',
      description: 'Silky smooth chickpea dip that puts shop-bought to shame.',
      baseServings: 6,
      categoryName: 'Snacks',
      source: 'Alex Rivera',
      steps: [
        { text: 'Blend tahini and lemon juice in a food processor for 1 minute, then add garlic and olive oil.', subSteps: [] },
        { text: 'Add drained chickpeas and blend for 3–4 minutes, adding reserved liquid to reach desired consistency.', subSteps: ['The more you blend, the silkier it gets'] },
        { text: 'Serve with a swirl of olive oil, paprika and warm pita.', subSteps: [] },
      ],
      ingredients: [
        { name: 'canned chickpeas', quantity: 400, unit: 'g', note: 'drained, liquid reserved' },
        { name: 'tahini', quantity: 80, unit: 'g', note: null },
        { name: 'lemon juice', quantity: 3, unit: 'tbsp', note: 'freshly squeezed' },
        { name: 'garlic', quantity: 1, unit: 'clove', note: null },
        { name: 'olive oil', quantity: 3, unit: 'tbsp', note: null },
        { name: 'paprika', quantity: null, unit: null, note: 'to serve' },
        { name: 'pita bread', quantity: null, unit: null, note: 'to serve' },
      ],
    },
  ];

  let firstRecipeId: string | null = null;

  for (const r of RECIPES) {
    const [existing] = await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(eq(recipe.recipeBookId, book.id), eq(recipe.title, r.title)))
      .limit(1);
    if (existing) { firstRecipeId ??= existing.id; continue; }

    const [newRecipe] = await db.insert(recipe).values({
      recipeBookId: book.id,
      title: r.title,
      description: r.description,
      source: r.source,
      baseServings: r.baseServings,
      categoryId: catMap[r.categoryName] ?? null,
      steps: r.steps,
    }).returning({ id: recipe.id });

    firstRecipeId ??= newRecipe.id;

    const ingredientRows = await Promise.all(
      r.ingredients.map(async (ing, i) => {
        const ingredientId = await findOrCreateIngredient(db, ing.name);
        return {
          recipeId: newRecipe.id,
          ingredientId,
          quantity: ing.quantity != null ? String(ing.quantity) : null,
          unit: ing.unit,
          note: ing.note,
          sortOrder: i,
        };
      })
    );
    await db.insert(recipeIngredient).values(ingredientRows);
  }

  // ── Pantry categories + items ─────────────────────────────────────────────
  const pantryCatNames = ['Dairy & Eggs', 'Meat & Fish', 'Vegetables', 'Fruit', 'Pantry Staples', 'Herbs & Spices', 'Bakery'];
  const pantryCatMap: Record<string, string> = {};
  for (const name of pantryCatNames) {
    const [existing] = await db
      .select({ id: pantryCategory.id })
      .from(pantryCategory)
      .where(and(eq(pantryCategory.pantryId, pantryRow.id), eq(pantryCategory.name, name)))
      .limit(1);
    if (existing) { pantryCatMap[name] = existing.id; continue; }
    const [created] = await db
      .insert(pantryCategory)
      .values({ pantryId: pantryRow.id, name })
      .returning({ id: pantryCategory.id });
    pantryCatMap[name] = created.id;
  }

  const pantrySeeds: Array<{
    name: string; cat: string; inStock: boolean;
    quantity?: number | null; unit?: string | null;
  }> = [
    { name: 'eggs', cat: 'Dairy & Eggs', inStock: true, quantity: 12, unit: 'pack' },
    { name: 'butter', cat: 'Dairy & Eggs', inStock: true, quantity: 2, unit: 'block' },
    { name: 'milk', cat: 'Dairy & Eggs', inStock: true, quantity: 2, unit: 'litre' },
    { name: 'parmesan', cat: 'Dairy & Eggs', inStock: true },
    { name: 'heavy cream', cat: 'Dairy & Eggs', inStock: false },
    { name: 'chicken thighs', cat: 'Meat & Fish', inStock: true, quantity: 1, unit: 'pack' },
    { name: 'minced beef', cat: 'Meat & Fish', inStock: false },
    { name: 'garlic', cat: 'Vegetables', inStock: true, quantity: 1, unit: 'bulb' },
    { name: 'onion', cat: 'Vegetables', inStock: true, quantity: 1, unit: 'bag' },
    { name: 'carrot', cat: 'Vegetables', inStock: true },
    { name: 'celery', cat: 'Vegetables', inStock: false },
    { name: 'mixed mushrooms', cat: 'Vegetables', inStock: true },
    { name: 'cherry tomatoes', cat: 'Vegetables', inStock: true },
    { name: 'avocado', cat: 'Fruit', inStock: true, quantity: 2, unit: 'loose' },
    { name: 'lemon', cat: 'Fruit', inStock: true, quantity: 4, unit: 'loose' },
    { name: 'olive oil', cat: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bottle' },
    { name: 'plain flour', cat: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bag' },
    { name: 'canned chickpeas', cat: 'Pantry Staples', inStock: true, quantity: 3, unit: 'can' },
    { name: 'crushed tomatoes', cat: 'Pantry Staples', inStock: true, quantity: 4, unit: 'can' },
    { name: 'spaghetti', cat: 'Pantry Staples', inStock: true, quantity: 2, unit: 'pack' },
    { name: 'arborio rice', cat: 'Pantry Staples', inStock: false },
    { name: 'basmati rice', cat: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bag' },
    { name: 'dried oregano', cat: 'Herbs & Spices', inStock: true },
    { name: 'garam masala', cat: 'Herbs & Spices', inStock: true },
    { name: 'ground cumin', cat: 'Herbs & Spices', inStock: true },
    { name: 'sourdough bread', cat: 'Bakery', inStock: true, quantity: 1, unit: 'loaf' },
  ];

  for (const seed of pantrySeeds) {
    const catId = pantryCatMap[seed.cat];
    if (!catId) continue;
    const ingredientId = await findOrCreateIngredient(db, seed.name);
    // pantry_item has unique(pantryId, ingredientId) — onConflictDoNothing handles re-seed
    await db.insert(pantryItem).values({
      pantryId: pantryRow.id,
      ingredientId,
      categoryId: catId,
      inStock: seed.inStock,
      quantity: seed.quantity ?? null,
      unit: seed.unit ?? null,
    }).onConflictDoNothing();
  }

  // ── Shopping list categories + items ──────────────────────────────────────
  const listCatNames = ['Fruit & Veg', 'Meat & Fish', 'Dairy', 'Pantry'];
  const listCatMap: Record<string, string> = {};
  for (const name of listCatNames) {
    const [existing] = await db
      .select({ id: shoppingListCategory.id })
      .from(shoppingListCategory)
      .where(and(eq(shoppingListCategory.shoppingListId, listRow.id), eq(shoppingListCategory.name, name)))
      .limit(1);
    if (existing) { listCatMap[name] = existing.id; continue; }
    const [created] = await db
      .insert(shoppingListCategory)
      .values({ shoppingListId: listRow.id, name })
      .returning({ id: shoppingListCategory.id });
    listCatMap[name] = created.id;
  }

  const listSeeds: Array<{
    name: string; cat: string; quantity?: number | null; unit?: string | null;
  }> = [
    { name: 'minced beef', cat: 'Meat & Fish', quantity: 500, unit: 'g' },
    { name: 'heavy cream', cat: 'Dairy', quantity: 300, unit: 'ml' },
    { name: 'arborio rice', cat: 'Pantry', quantity: 500, unit: 'g' },
    { name: 'celery', cat: 'Fruit & Veg' },
    { name: 'dark chocolate', cat: 'Pantry', quantity: 200, unit: 'g' },
  ];

  for (let i = 0; i < listSeeds.length; i++) {
    const seed = listSeeds[i];
    const ingredientId = await findOrCreateIngredient(db, seed.name);
    // Check for existing item with same ingredient to avoid duplicates on re-seed
    const [existingItem] = await db
      .select({ id: shoppingListItem.id })
      .from(shoppingListItem)
      .where(and(eq(shoppingListItem.shoppingListId, listRow.id), eq(shoppingListItem.ingredientId, ingredientId)))
      .limit(1);
    if (existingItem) continue;

    await db.insert(shoppingListItem).values({
      shoppingListId: listRow.id,
      categoryId: listCatMap[seed.cat] ?? null,
      ingredientId,
      name: seed.name,
      quantity: seed.quantity != null ? String(seed.quantity) : null,
      unit: seed.unit ?? null,
      source: 'DIRECT',
      sortOrder: i,
      addedByUserId: req.user.id,
    });
  }

  // ── Community demo data ───────────────────────────────────────────────────
  if (firstRecipeId) {
    const [existingShare] = await db
      .select({ id: recipeShare.id })
      .from(recipeShare)
      .where(and(eq(recipeShare.fromUserId, demoUser1Id), eq(recipeShare.toUserId, req.user.id)))
      .limit(1);

    if (!existingShare) {
      await db.insert(recipeShare).values({
        recipeId: firstRecipeId,
        fromUserId: demoUser1Id,
        toUserId: req.user.id,
        status: 'PENDING',
      });
    }
  }

  // follow has PK (followerId, followingId) so onConflictDoNothing handles re-seed
  await db.insert(follow).values({
    followerId: req.user.id,
    followingId: demoUser1Id,
  }).onConflictDoNothing();

  res.json({ ok: true, firstRecipeId });
});

// POST /api/tutorial/complete — remove demo users and mark onboarding done
router.post('/complete', async (req, res) => {
  const [membership] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (membership) {
    const demoMembers = await db
      .select({ userId: householdUser.userId })
      .from(householdUser)
      .innerJoin(user, eq(householdUser.userId, user.id))
      .where(and(eq(householdUser.householdId, membership.householdId), eq(user.isDemoUser, true)));

    for (const { userId } of demoMembers) {
      await db.delete(user).where(eq(user.id, userId));
    }
  }

  await db.update(user)
    .set({ onboardingComplete: true, updatedAt: new Date() })
    .where(eq(user.id, req.user.id));

  res.json({ ok: true });
});

export default router;
