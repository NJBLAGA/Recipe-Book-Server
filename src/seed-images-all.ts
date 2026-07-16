import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './db/index';
import { recipeBook, recipe, recipeImage } from './schema/recipe';
import { householdUser } from './schema/household';
import { user } from './schema/auth';

const EMAIL = process.argv[2] ?? 'nathanblaga90@gmail.com';

const IMAGES: Record<string, string> = {
  'Spaghetti Bolognese': 'https://images.unsplash.com/photo-1551892374-ecf8754cf8b0?w=400&q=80',
  'Chicken Tikka Masala': 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&q=80',
  'Banana Bread': 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400&q=80',
  'Classic Caesar Salad': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80',
  'Beef Tacos': 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&q=80',
  'Chocolate Lava Cake': 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=400&q=80',
  'Avocado Toast': 'https://images.unsplash.com/photo-1541519227354-08fa5d50c820?w=400&q=80',
  'Pancakes': 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400&q=80',
  'Grilled Salmon': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&q=80',
  'Margherita Pizza': 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&q=80',
  'Mushroom Risotto': 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400&q=80',
  'Lemon Tart': 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400&q=80',
  'Beef Stew': 'https://images.unsplash.com/photo-1507048331197-7d4ac70811cf?w=400&q=80',
  'Pad Thai': 'https://images.unsplash.com/photo-1559314809-0d155014e29e?w=400&q=80',
  'Greek Salad': 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&q=80',
  'Chocolate Chip Cookies': 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=400&q=80',
  'French Onion Soup': 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400&q=80',
  'BBQ Ribs': 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&q=80',
  'Tiramisu': 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400&q=80',
  'Veggie Stir Fry': 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&q=80',
};

// Fallback image for any recipe title not in the map above
const FALLBACK = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&q=80';

async function run() {
  const [targetUser] = await db.select().from(user).where(eq(user.email, EMAIL)).limit(1);
  if (!targetUser) { console.error(`User ${EMAIL} not found.`); process.exit(1); }

  const [hu] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, targetUser.id))
    .limit(1);

  if (!hu) { console.error('User has no household.'); process.exit(1); }

  const [book] = await db
    .select()
    .from(recipeBook)
    .where(eq(recipeBook.householdId, hu.householdId))
    .limit(1);

  if (!book) { console.error('No recipe book found.'); process.exit(1); }

  const recipes = await db.select().from(recipe).where(eq(recipe.recipeBookId, book.id));
  console.log(`Found ${recipes.length} recipes in household book.`);

  for (const r of recipes) {
    const url = IMAGES[r.title] ?? FALLBACK;
    const existing = await db.select().from(recipeImage).where(eq(recipeImage.recipeId, r.id)).limit(1);

    if (existing.length > 0) {
      await db.update(recipeImage).set({ url, sortOrder: 0 }).where(eq(recipeImage.recipeId, r.id));
      console.log(`Updated: ${r.title}`);
    } else {
      await db.insert(recipeImage).values({ recipeId: r.id, url, sortOrder: 0 });
      console.log(`Added: ${r.title}`);
    }
  }

  console.log('Done.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
