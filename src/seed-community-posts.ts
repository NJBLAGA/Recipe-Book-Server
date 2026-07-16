import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { recipe, recipeBook } from './schema/recipe';
import { householdUser } from './schema/household';
import { communityPost } from './schema/social';

const TEST_EMAIL = 'test@gmail.com';

const COMMENTS: Record<string, string[]> = {
  'Spaghetti Bolognese': [
    "Made this for the family last Sunday and they devoured every last bit. The secret is letting the sauce simmer low and slow — at least two hours. Worth every minute.",
    "Finally a bolognese that actually tastes like what my Italian nonna used to make. I added a splash of whole milk near the end and it made all the difference.",
    "This has become my go-to Sunday cook. I make a double batch and freeze half for those chaotic weeknight dinners. Absolute lifesaver.",
    "Pro tip: use a mix of pork and beef mince and don't skip the chicken livers if you can find them. Adds incredible depth to the sauce.",
  ],
  'Chicken Tikka Masala': [
    "Made this last night for a dinner party and everyone thought I'd ordered from a restaurant. The overnight marinade is non-negotiable — do not skip it.",
    "I've tried at least a dozen tikka masala recipes and this one blows them all out of the water. The toasted spice blend is the real game changer.",
    "Swapped the cream for coconut milk to make it dairy free and it was still absolutely sensational. This recipe is incredibly forgiving.",
    "Triple the marinade, use your biggest pan, and cook the chicken in batches so it chars properly. You will not regret it.",
  ],
  'Banana Bread': [
    "Used four very ripe bananas instead of three and added a handful of dark chocolate chips. Best decision I've ever made in the kitchen.",
    "This is the only banana bread recipe I'll ever need. Perfectly moist, not too sweet, and the crust gets this beautiful caramelised edge.",
    "Added a teaspoon of cinnamon and a pinch of cardamom — absolute game changer. My house smelled incredible for hours.",
    "Made this three times in one week because we keep buying bananas and forgetting about them. Not complaining at all.",
  ],
  'Classic Caesar Salad': [
    "Made the dressing from scratch for the first time and I will never go back to bottled. The anchovy-garlic base is everything.",
    "Grilled the cos lettuce halves until lightly charred before dressing them. Sounds weird, tastes incredible. Try it.",
    "Added crispy prosciutto instead of croutons and fresh shaved parmesan on top. The texture contrast is unreal.",
    "The homemade croutons with garlic butter are what take this from good to unforgettable. Do not skip that step.",
  ],
  'Beef Tacos': [
    "These are weeknight gold. From fridge to table in under 25 minutes and somehow they taste like you spent hours on them.",
    "The seasoning blend in this recipe is perfectly balanced. I made a big batch of the spice mix and now it lives permanently in my pantry.",
    "Loaded ours up with pickled red onions, fresh jalapeño, and a squeeze of lime. Absolutely incredible. This recipe is the perfect base.",
    "Made these for Taco Tuesday and my kids are already asking when we're having them again. Huge win in this household.",
  ],
};

const FALLBACK_COMMENTS = [
  "Tested this recipe twice this week and it keeps getting better each time. The flavours really develop as it sits.",
  "Simple ingredients, outstanding result. This is exactly the kind of cooking I love — no fuss, all flavour.",
  "Brought this to a potluck and came home with an empty dish and five people asking for the recipe.",
  "My partner doesn't usually get excited about food but they went back for thirds. That's the highest praise in this house.",
  "Made a few small adjustments based on what I had in the pantry and it still turned out beautifully. Very adaptable recipe.",
  "This is the kind of recipe that makes cooking feel easy and joyful. Already planning to make it again next weekend.",
];

async function seed() {
  const [testUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, TEST_EMAIL))
    .limit(1);

  if (!testUser) {
    console.error('Test user not found. Run seed-test-user.ts first.');
    process.exit(1);
  }

  // Ensure test user is public so posts show in feed
  await db.update(user).set({ isPublic: true }).where(eq(user.id, testUser.id));
  console.log('Set test user to public.');

  const [hu] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, testUser.id))
    .limit(1);

  if (!hu) {
    console.error('Test user has no household.');
    process.exit(1);
  }

  const [book] = await db
    .select()
    .from(recipeBook)
    .where(eq(recipeBook.householdId, hu.householdId))
    .limit(1);

  if (!book) {
    console.error('No recipe book found.');
    process.exit(1);
  }

  const recipes = await db
    .select({ id: recipe.id, title: recipe.title })
    .from(recipe)
    .where(eq(recipe.recipeBookId, book.id));

  if (recipes.length === 0) {
    console.error('No recipes found. Run seed-test-recipes.ts first.');
    process.exit(1);
  }

  // Delete existing posts to start fresh
  await db.delete(communityPost).where(eq(communityPost.userId, testUser.id));
  console.log('Cleared existing community posts.');

  // Build 20 posts spread across available recipes
  const posts: { userId: string; recipeId: string; comment: string }[] = [];

  for (let i = 0; i < 20; i++) {
    const r = recipes[i % recipes.length];
    const recipeComments = COMMENTS[r.title] ?? [];
    const commentPool = [...recipeComments, ...FALLBACK_COMMENTS];
    const comment = commentPool[i % commentPool.length];
    posts.push({ userId: testUser.id, recipeId: r.id, comment });
  }

  await db.insert(communityPost).values(posts);
  console.log(`Created ${posts.length} community posts for ${testUser.name}.`);
  console.log('Done!');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
