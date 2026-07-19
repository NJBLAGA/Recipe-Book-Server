import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { recipeBook, recipe, recipeImage } from './schema/recipe';

// Extra Unsplash food images per recipe category/type
// These are paired by food theme so they look natural together
const EXTRA_IMAGES_BY_TITLE: Record<string, string[]> = {
  // Breakfast recipes
  'Shakshuka': [
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80',
    'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=400&q=80',
  ],
  'Mango Coconut Chia Pudding': [
    'https://images.unsplash.com/photo-1511690743698-d9d85f2fbf38?w=400&q=80',
    'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=400&q=80',
  ],
  'Buttermilk Pancakes': [
    'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400&q=80',
    'https://images.unsplash.com/photo-1528207776546-365bb710ee93?w=400&q=80',
  ],
  // Soups
  'French Onion Soup': [
    'https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?w=400&q=80',
    'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=400&q=80',
  ],
  'Miso Ramen': [
    'https://images.unsplash.com/photo-1557872943-16a5ac26437e?w=400&q=80',
    'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&q=80',
  ],
  // Salads
  'Greek Salad': [
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&q=80',
    'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80',
  ],
  // Pasta
  'Pesto Gnocchi': [
    'https://images.unsplash.com/photo-1551892374-ecf8754cf8b0?w=400&q=80',
    'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=400&q=80',
  ],
  // Mains
  'Pulled Pork Sliders': [
    'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&q=80',
    'https://images.unsplash.com/photo-1550317138-10000687a72b?w=400&q=80',
  ],
  'Mushroom Risotto': [
    'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400&q=80',
    'https://images.unsplash.com/photo-1548943487-a2e4e43b4853?w=400&q=80',
  ],
  // Desserts
  'Lemon Tart': [
    'https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=400&q=80',
    'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80',
  ],
};

// Generic extra images to fall back on by index, grouped thematically
const GENERIC_EXTRAS: string[][] = [
  [
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&q=80',
    'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=400&q=80',
  ],
  [
    'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=400&q=80',
    'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=400&q=80',
  ],
  [
    'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=400&q=80',
    'https://images.unsplash.com/photo-1493770348161-369560ae357d?w=400&q=80',
  ],
  [
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80',
    'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=400&q=80',
  ],
  [
    'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=400&q=80',
    'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&q=80',
  ],
];

async function getUserRecipes(email: string): Promise<{ id: string; title: string }[]> {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (!u) return [];

  const [hu] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, u.id))
    .limit(1);
  if (!hu) return [];

  const [book] = await db
    .select({ id: recipeBook.id })
    .from(recipeBook)
    .where(eq(recipeBook.householdId, hu.householdId))
    .limit(1);
  if (!book) return [];

  return db
    .select({ id: recipe.id, title: recipe.title })
    .from(recipe)
    .where(eq(recipe.recipeBookId, book.id));
}

async function seed() {
  const emails = ['nathanblaga90@gmail.com', 'test@gmail.com', 'test2@gmail.com'];
  let totalAdded = 0;

  for (const email of emails) {
    const recipes = await getUserRecipes(email);
    if (recipes.length === 0) {
      console.log(`No recipes found for ${email} — skipping.`);
      continue;
    }

    const recipeIds = recipes.map((r) => r.id);

    // Find which recipes already have extra images (more than 1)
    const existingImages = await db
      .select({ recipeId: recipeImage.recipeId })
      .from(recipeImage)
      .where(inArray(recipeImage.recipeId, recipeIds));

    const countMap = new Map<string, number>();
    for (const img of existingImages) {
      countMap.set(img.recipeId, (countMap.get(img.recipeId) ?? 0) + 1);
    }

    for (let idx = 0; idx < recipes.length; idx++) {
      const r = recipes[idx];
      const existing = countMap.get(r.id) ?? 0;

      // Only add if fewer than 3 images total
      if (existing >= 3) continue;

      const toAdd = EXTRA_IMAGES_BY_TITLE[r.title] ?? GENERIC_EXTRAS[idx % GENERIC_EXTRAS.length];
      const needed = toAdd.slice(0, 3 - existing);

      for (let i = 0; i < needed.length; i++) {
        await db.insert(recipeImage).values({
          recipeId: r.id,
          url: needed[i],
          sortOrder: existing + i + 1,
        });
        totalAdded++;
      }
    }

    console.log(`Processed ${recipes.length} recipes for ${email}.`);
  }

  console.log(`Added ${totalAdded} extra recipe images total.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
