import 'dotenv/config';
import { eq, and } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { household, householdUser } from './schema/household';
import { recipeBook, recipe, recipeIngredient } from './schema/recipe';
import { pantry } from './schema/pantry';
import { shoppingList } from './schema/shopping';
import { ingredient } from './schema/ingredient';
import { userPinnedRecipe } from './schema/social';

const TEST_EMAIL = 'test@gmail.com';

// ─── Recipe data ─────────────────────────────────────────────────────────────

const RECIPES = [
  {
    title: 'Spaghetti Bolognese',
    description: 'A classic Italian meat sauce served over spaghetti.',
    baseServings: 4,
    steps: [
      'Heat olive oil in a large pan over medium heat.',
      'Fry onion, carrot and celery until soft, about 8 minutes.',
      'Add garlic and cook for 1 minute.',
      'Brown the mince, breaking it up as it cooks.',
      'Pour in wine and let it bubble for 2 minutes.',
      'Stir in tomatoes, tomato paste and oregano. Season well.',
      'Simmer uncovered for 30 minutes, stirring occasionally.',
      'Cook spaghetti per packet instructions. Serve topped with sauce and parmesan.',
    ],
    ingredients: [
      { name: 'spaghetti', quantity: '400', unit: 'g' },
      { name: 'beef mince', quantity: '500', unit: 'g' },
      { name: 'brown onion', quantity: '1', unit: null },
      { name: 'carrot', quantity: '1', unit: null },
      { name: 'celery', quantity: '2', unit: 'stalks' },
      { name: 'garlic', quantity: '3', unit: 'cloves' },
      { name: 'red wine', quantity: '125', unit: 'ml' },
      { name: 'crushed tomatoes', quantity: '400', unit: 'g' },
      { name: 'tomato paste', quantity: '2', unit: 'tbsp' },
      { name: 'dried oregano', quantity: '1', unit: 'tsp' },
      { name: 'olive oil', quantity: '2', unit: 'tbsp' },
      { name: 'parmesan', quantity: null, unit: null, note: 'freshly grated, to serve' },
    ],
  },
  {
    title: 'Chicken Tikka Masala',
    description: 'Tender marinated chicken in a rich, creamy tomato sauce.',
    baseServings: 4,
    steps: [
      'Mix yoghurt, lemon juice, garlic, ginger, cumin, paprika and salt. Coat chicken and marinate for at least 1 hour.',
      'Grill or pan-fry the chicken until charred and cooked through. Set aside.',
      'Fry onion in butter until golden, about 10 minutes.',
      'Add garlic, ginger, cumin, coriander, paprika and garam masala. Cook for 2 minutes.',
      'Add tomatoes and simmer for 15 minutes until thickened.',
      'Stir in cream and the cooked chicken. Simmer for 10 minutes.',
      'Season and garnish with fresh coriander. Serve with rice or naan.',
    ],
    ingredients: [
      { name: 'chicken thighs', quantity: '700', unit: 'g', note: 'boneless, skinless, cut into chunks' },
      { name: 'plain yoghurt', quantity: '200', unit: 'g' },
      { name: 'lemon juice', quantity: '2', unit: 'tbsp' },
      { name: 'garlic', quantity: '4', unit: 'cloves', note: 'minced' },
      { name: 'fresh ginger', quantity: '2', unit: 'tsp', note: 'grated' },
      { name: 'ground cumin', quantity: '2', unit: 'tsp' },
      { name: 'smoked paprika', quantity: '2', unit: 'tsp' },
      { name: 'crushed tomatoes', quantity: '400', unit: 'g' },
      { name: 'heavy cream', quantity: '200', unit: 'ml' },
      { name: 'butter', quantity: '2', unit: 'tbsp' },
      { name: 'brown onion', quantity: '1', unit: null, note: 'finely diced' },
      { name: 'garam masala', quantity: '1', unit: 'tsp' },
      { name: 'ground coriander', quantity: '1', unit: 'tsp' },
      { name: 'fresh coriander', quantity: null, unit: null, note: 'to garnish' },
    ],
  },
  {
    title: 'Banana Bread',
    description: 'Moist and fluffy banana bread — best made with very ripe bananas.',
    baseServings: 8,
    steps: [
      'Preheat oven to 175°C. Grease a 23×13 cm loaf tin.',
      'Mash bananas in a large bowl until smooth.',
      'Stir in melted butter, sugar, egg and vanilla.',
      'Fold in flour, baking soda and salt until just combined — do not overmix.',
      'Pour into prepared tin and bake for 55–65 minutes until a skewer comes out clean.',
      'Cool in tin for 10 minutes, then turn out onto a rack.',
    ],
    ingredients: [
      { name: 'ripe bananas', quantity: '3', unit: null, note: 'very ripe, mashed' },
      { name: 'butter', quantity: '75', unit: 'g', note: 'melted' },
      { name: 'caster sugar', quantity: '150', unit: 'g' },
      { name: 'egg', quantity: '1', unit: null, note: 'beaten' },
      { name: 'vanilla extract', quantity: '1', unit: 'tsp' },
      { name: 'plain flour', quantity: '190', unit: 'g' },
      { name: 'baking soda', quantity: '1', unit: 'tsp' },
      { name: 'salt', quantity: null, unit: null, note: 'a pinch' },
    ],
  },
  {
    title: 'Classic Caesar Salad',
    description: 'Crisp romaine with a bold anchovy dressing, croutons and shaved parmesan.',
    baseServings: 2,
    steps: [
      'Whisk together garlic, anchovy, lemon juice, Worcestershire, Dijon, egg yolk and parmesan to make the dressing.',
      'Slowly drizzle in olive oil while whisking until emulsified. Season well.',
      'Tear romaine into a large bowl. Toss with dressing to coat evenly.',
      'Top with croutons and extra parmesan. Serve immediately.',
    ],
    ingredients: [
      { name: 'romaine lettuce', quantity: '1', unit: 'head' },
      { name: 'parmesan', quantity: '50', unit: 'g', note: 'finely grated, plus extra to serve' },
      { name: 'croutons', quantity: '1', unit: 'cup' },
      { name: 'garlic', quantity: '1', unit: 'clove', note: 'minced' },
      { name: 'anchovy fillets', quantity: '2', unit: null, note: 'finely chopped' },
      { name: 'lemon juice', quantity: '2', unit: 'tbsp' },
      { name: 'Worcestershire sauce', quantity: '1', unit: 'tsp' },
      { name: 'Dijon mustard', quantity: '1', unit: 'tsp' },
      { name: 'egg yolk', quantity: '1', unit: null },
      { name: 'olive oil', quantity: '80', unit: 'ml' },
    ],
  },
  {
    title: 'Beef Tacos',
    description: 'Quick and flavourful ground beef tacos with all the classic toppings.',
    baseServings: 4,
    steps: [
      'Heat oil in a pan over medium-high heat. Cook onion until soft.',
      'Add beef mince and cook until browned, breaking it up.',
      'Stir in garlic, cumin, chilli powder, smoked paprika and salt. Cook for 1 minute.',
      'Add a splash of water and simmer for 5 minutes.',
      'Warm taco shells in the oven per packet instructions.',
      'Fill shells with beef, top with shredded lettuce, tomato, cheese, sour cream and salsa.',
    ],
    ingredients: [
      { name: 'beef mince', quantity: '500', unit: 'g' },
      { name: 'taco shells', quantity: '8', unit: null },
      { name: 'brown onion', quantity: '1', unit: null, note: 'finely diced' },
      { name: 'garlic', quantity: '2', unit: 'cloves', note: 'minced' },
      { name: 'ground cumin', quantity: '1.5', unit: 'tsp' },
      { name: 'chilli powder', quantity: '1', unit: 'tsp' },
      { name: 'smoked paprika', quantity: '1', unit: 'tsp' },
      { name: 'iceberg lettuce', quantity: null, unit: null, note: 'shredded, to serve' },
      { name: 'tomato', quantity: '2', unit: null, note: 'diced, to serve' },
      { name: 'cheddar cheese', quantity: null, unit: null, note: 'grated, to serve' },
      { name: 'sour cream', quantity: null, unit: null, note: 'to serve' },
      { name: 'salsa', quantity: null, unit: null, note: 'to serve' },
      { name: 'olive oil', quantity: '1', unit: 'tbsp' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findOrCreateIngredient(name: string): Promise<string> {
  const normalised = name.toLowerCase().trim();
  const existing = await db.select().from(ingredient).where(eq(ingredient.name, normalised)).limit(1);
  if (existing.length > 0) return existing[0].id;
  const [created] = await db.insert(ingredient).values({ name: normalised }).returning();
  return created.id;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  // 1. Find test user
  const [testUser] = await db.select().from(user).where(eq(user.email, TEST_EMAIL)).limit(1);
  if (!testUser) {
    console.error(`Test user not found. Run seed-test-user.ts first.`);
    process.exit(1);
  }

  // 2. Find or create household
  let householdRow = await db
    .select({ h: household, hu: householdUser })
    .from(householdUser)
    .innerJoin(household, eq(householdUser.householdId, household.id))
    .where(eq(householdUser.userId, testUser.id))
    .limit(1)
    .then((rows) => rows[0]?.h ?? null);

  if (!householdRow) {
    console.log('Test user has no household — creating one...');
    const [h] = await db.insert(household).values({ name: "Test's Kitchen" }).returning();
    await db.insert(householdUser).values({ householdId: h.id, userId: testUser.id, role: 'OWNER' });
    await db.insert(recipeBook).values({ householdId: h.id });
    await db.insert(pantry).values({ householdId: h.id });
    await db.insert(shoppingList).values({ householdId: h.id });
    householdRow = h;
    console.log(`Created household: ${h.name}`);
  }

  // 3. Get recipe book
  const [book] = await db.select().from(recipeBook).where(eq(recipeBook.householdId, householdRow.id)).limit(1);
  if (!book) {
    console.error('Recipe book not found for household.');
    process.exit(1);
  }

  // 4. Create recipes (skip if already exist by title)
  const recipeIds: string[] = [];

  for (const r of RECIPES) {
    const existing = await db
      .select()
      .from(recipe)
      .where(and(eq(recipe.recipeBookId, book.id), eq(recipe.title, r.title)))
      .limit(1);

    if (existing.length > 0) {
      console.log(`Recipe already exists: ${r.title}`);
      recipeIds.push(existing[0].id);
      continue;
    }

    const [newRecipe] = await db.insert(recipe).values({
      recipeBookId: book.id,
      title: r.title,
      description: r.description,
      baseServings: r.baseServings,
      steps: (r.steps as string[]).map((s) => ({ text: s, subSteps: [] as string[] })),
    }).returning();

    for (let i = 0; i < r.ingredients.length; i++) {
      const ing = r.ingredients[i];
      const ingredientId = await findOrCreateIngredient(ing.name);
      await db.insert(recipeIngredient).values({
        recipeId: newRecipe.id,
        ingredientId,
        quantity: ing.quantity ?? null,
        unit: ing.unit ?? null,
        note: (ing as { note?: string }).note ?? null,
        sortOrder: i,
      });
    }

    recipeIds.push(newRecipe.id);
    console.log(`Created recipe: ${r.title}`);
  }

  // 5. Pin all 5 to the test user (upsert — delete existing pins first)
  await db.delete(userPinnedRecipe).where(eq(userPinnedRecipe.userId, testUser.id));
  for (let i = 0; i < recipeIds.length; i++) {
    await db.insert(userPinnedRecipe).values({
      userId: testUser.id,
      recipeId: recipeIds[i],
      position: i + 1,
    });
  }

  console.log(`Pinned ${recipeIds.length} recipes to ${testUser.email}.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
