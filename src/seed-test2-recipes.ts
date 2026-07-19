import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { household, householdUser } from './schema/household';
import { recipeBook, recipeCategory, recipe, recipeIngredient, recipeImage } from './schema/recipe';
import { pantry } from './schema/pantry';
import { shoppingList } from './schema/shopping';
import { communityPost } from './schema/social';
import { ingredient } from './schema/ingredient';

const TEST2_EMAIL = 'test2@gmail.com';

const RECIPES = [
  {
    title: 'Shakshuka',
    description: 'Eggs poached in a spiced tomato and pepper sauce — the perfect one-pan breakfast.',
    baseServings: 2,
    category: 'Breakfast',
    image: 'https://images.unsplash.com/photo-1590301157890-4810ed352733?w=400&q=80',
    steps: [
      'Heat olive oil in a wide pan over medium heat. Add onion and peppers and cook until soft, about 8 minutes.',
      'Add garlic, cumin, paprika and chilli flakes. Cook for 1 minute until fragrant.',
      'Stir in crushed tomatoes and season well. Simmer for 10 minutes until slightly thickened.',
      'Make 4 wells in the sauce and crack an egg into each.',
      'Cover and cook on low heat for 6–8 minutes until whites are set but yolks are still runny.',
      'Top with crumbled feta and fresh herbs. Serve with crusty bread.',
    ],
    ingredients: [
      { name: 'eggs', quantity: '4', unit: null },
      { name: 'crushed tomatoes', quantity: '400', unit: 'g' },
      { name: 'red capsicum', quantity: '1', unit: null, note: 'diced' },
      { name: 'brown onion', quantity: '1', unit: null, note: 'diced' },
      { name: 'garlic', quantity: '3', unit: 'cloves', note: 'minced' },
      { name: 'ground cumin', quantity: '1', unit: 'tsp' },
      { name: 'smoked paprika', quantity: '1', unit: 'tsp' },
      { name: 'chilli flakes', quantity: null, unit: null, note: 'to taste' },
      { name: 'olive oil', quantity: '2', unit: 'tbsp' },
      { name: 'feta', quantity: '60', unit: 'g', note: 'crumbled, to serve' },
      { name: 'fresh parsley', quantity: null, unit: null, note: 'to garnish' },
    ],
  },
  {
    title: 'French Onion Soup',
    description: 'A deeply rich and comforting classic with caramelised onions and a gruyère crouton.',
    baseServings: 4,
    category: 'Soups',
    image: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=400&q=80',
    steps: [
      'Melt butter in a large heavy pot over medium-low heat. Add sliced onions and a pinch of sugar.',
      'Cook, stirring occasionally, for 45–60 minutes until deeply golden and caramelised.',
      'Add garlic and cook for 1 minute. Pour in wine and scrape up any bits.',
      'Add stock, thyme and bay leaf. Season well and simmer for 20 minutes.',
      'Ladle into oven-safe bowls. Float a toasted baguette slice on top and cover with gruyère.',
      'Grill under a hot broiler for 3–4 minutes until the cheese is golden and bubbling.',
    ],
    ingredients: [
      { name: 'brown onions', quantity: '1.2', unit: 'kg', note: 'thinly sliced' },
      { name: 'butter', quantity: '50', unit: 'g' },
      { name: 'garlic', quantity: '2', unit: 'cloves', note: 'minced' },
      { name: 'dry white wine', quantity: '150', unit: 'ml' },
      { name: 'beef stock', quantity: '1.2', unit: 'L' },
      { name: 'fresh thyme', quantity: '4', unit: 'sprigs' },
      { name: 'bay leaf', quantity: '1', unit: null },
      { name: 'baguette', quantity: '4', unit: 'slices', note: 'toasted' },
      { name: 'gruyère', quantity: '120', unit: 'g', note: 'grated' },
      { name: 'caster sugar', quantity: '1', unit: 'pinch' },
    ],
  },
  {
    title: 'Mango Coconut Chia Pudding',
    description: 'A creamy overnight chia pudding with fresh mango and toasted coconut.',
    baseServings: 2,
    category: 'Breakfast',
    image: 'https://images.unsplash.com/photo-1546039907-7fa05f864c02?w=400&q=80',
    steps: [
      'Whisk chia seeds, coconut milk, maple syrup and vanilla together in a bowl.',
      'Cover and refrigerate overnight or for at least 4 hours.',
      'Stir the pudding and divide between two glasses.',
      'Top with diced mango, toasted coconut flakes and a drizzle of lime juice.',
    ],
    ingredients: [
      { name: 'chia seeds', quantity: '60', unit: 'g' },
      { name: 'coconut milk', quantity: '400', unit: 'ml' },
      { name: 'maple syrup', quantity: '2', unit: 'tbsp' },
      { name: 'vanilla extract', quantity: '1', unit: 'tsp' },
      { name: 'mango', quantity: '1', unit: null, note: 'ripe, diced' },
      { name: 'coconut flakes', quantity: '30', unit: 'g', note: 'toasted' },
      { name: 'lime juice', quantity: null, unit: null, note: 'to finish' },
    ],
  },
  {
    title: 'Pesto Gnocchi',
    description: 'Pillowy potato gnocchi tossed in fresh basil pesto with cherry tomatoes and pine nuts.',
    baseServings: 4,
    category: 'Pasta & Noodles',
    image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&q=80',
    steps: [
      'Cook gnocchi in salted boiling water until they float, about 2–3 minutes. Drain and reserve ½ cup pasta water.',
      'Heat olive oil in a large pan over medium heat. Add halved cherry tomatoes and cook for 3 minutes.',
      'Add gnocchi to the pan and toss to coat. Pour in pesto and a splash of pasta water to loosen.',
      'Toss everything together over low heat for 1 minute.',
      'Serve topped with toasted pine nuts, extra parmesan and fresh basil.',
    ],
    ingredients: [
      { name: 'potato gnocchi', quantity: '500', unit: 'g' },
      { name: 'basil pesto', quantity: '6', unit: 'tbsp' },
      { name: 'cherry tomatoes', quantity: '250', unit: 'g', note: 'halved' },
      { name: 'pine nuts', quantity: '30', unit: 'g', note: 'toasted' },
      { name: 'parmesan', quantity: null, unit: null, note: 'freshly grated, to serve' },
      { name: 'olive oil', quantity: '1', unit: 'tbsp' },
      { name: 'fresh basil', quantity: null, unit: null, note: 'to garnish' },
    ],
  },
  {
    title: 'Pulled Pork Sliders',
    description: 'Slow-cooked pulled pork with a smoky BBQ glaze, piled high on soft brioche buns.',
    baseServings: 8,
    category: 'Mains',
    image: 'https://images.unsplash.com/photo-1586816001966-79b736744398?w=400&q=80',
    steps: [
      'Mix brown sugar, smoked paprika, garlic powder, cumin, salt and pepper. Rub all over the pork.',
      'Place pork in a slow cooker with beef stock and apple cider vinegar. Cook on LOW for 8–10 hours.',
      'Shred the pork using two forks. Stir in BBQ sauce and the cooking juices to taste.',
      'Toast brioche buns. Load with pulled pork and top with coleslaw and pickles.',
    ],
    ingredients: [
      { name: 'pork shoulder', quantity: '1.5', unit: 'kg', note: 'bone-in' },
      { name: 'brown sugar', quantity: '3', unit: 'tbsp' },
      { name: 'smoked paprika', quantity: '2', unit: 'tbsp' },
      { name: 'garlic powder', quantity: '1', unit: 'tsp' },
      { name: 'ground cumin', quantity: '1', unit: 'tsp' },
      { name: 'beef stock', quantity: '250', unit: 'ml' },
      { name: 'apple cider vinegar', quantity: '2', unit: 'tbsp' },
      { name: 'BBQ sauce', quantity: '200', unit: 'ml' },
      { name: 'brioche slider buns', quantity: '8', unit: null },
      { name: 'coleslaw', quantity: null, unit: null, note: 'to serve' },
      { name: 'pickles', quantity: null, unit: null, note: 'to serve' },
    ],
  },
  {
    title: 'Greek Salad',
    description: 'A crisp, vibrant salad of cucumber, tomato, olives and feta with an oregano dressing.',
    baseServings: 4,
    category: 'Salads',
    image: 'https://images.unsplash.com/photo-1505253716362-afaea1d3d1af?w=400&q=80',
    steps: [
      'Chop cucumber, tomatoes and capsicum into large chunks. Slice red onion thinly.',
      'Combine vegetables in a large bowl with olives.',
      'Whisk together olive oil, red wine vinegar, dried oregano, salt and pepper.',
      'Pour dressing over the salad and toss gently.',
      'Top with whole feta block (or crumbled) and a final sprinkle of oregano.',
    ],
    ingredients: [
      { name: 'cucumber', quantity: '1', unit: null, note: 'halved and sliced' },
      { name: 'tomatoes', quantity: '4', unit: null, note: 'quartered' },
      { name: 'green capsicum', quantity: '1', unit: null, note: 'chopped' },
      { name: 'red onion', quantity: '0.5', unit: null, note: 'thinly sliced' },
      { name: 'kalamata olives', quantity: '100', unit: 'g' },
      { name: 'feta', quantity: '200', unit: 'g' },
      { name: 'extra virgin olive oil', quantity: '4', unit: 'tbsp' },
      { name: 'red wine vinegar', quantity: '2', unit: 'tbsp' },
      { name: 'dried oregano', quantity: '1', unit: 'tsp' },
    ],
  },
  {
    title: 'Miso Ramen',
    description: 'A warming miso-based ramen broth with ramen noodles, soft boiled eggs and crispy tofu.',
    baseServings: 2,
    category: 'Soups',
    image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&q=80',
    steps: [
      'Press and cube tofu. Pan-fry in oil over high heat until golden and crispy on all sides.',
      'In a pot, heat sesame oil over medium heat. Fry garlic and ginger for 1 minute.',
      'Whisk in miso paste, soy sauce and chilli paste. Add stock and bring to a simmer.',
      'Cook ramen noodles according to packet instructions. Drain.',
      'Divide noodles between bowls. Ladle hot broth over top.',
      'Top with crispy tofu, soft-boiled egg halves, sliced spring onion and nori.',
    ],
    ingredients: [
      { name: 'ramen noodles', quantity: '200', unit: 'g' },
      { name: 'firm tofu', quantity: '300', unit: 'g' },
      { name: 'white miso paste', quantity: '3', unit: 'tbsp' },
      { name: 'soy sauce', quantity: '2', unit: 'tbsp' },
      { name: 'vegetable stock', quantity: '1', unit: 'L' },
      { name: 'garlic', quantity: '3', unit: 'cloves', note: 'minced' },
      { name: 'fresh ginger', quantity: '1', unit: 'tsp', note: 'grated' },
      { name: 'sesame oil', quantity: '1', unit: 'tbsp' },
      { name: 'chilli paste', quantity: '1', unit: 'tsp', note: 'or to taste' },
      { name: 'eggs', quantity: '2', unit: null, note: 'soft-boiled' },
      { name: 'spring onion', quantity: '2', unit: null, note: 'sliced' },
      { name: 'nori sheets', quantity: '2', unit: null, note: 'to serve' },
    ],
  },
  {
    title: 'Lemon Tart',
    description: 'A silky, tangy lemon curd in a buttery shortcrust shell — simple and show-stopping.',
    baseServings: 8,
    category: 'Desserts',
    image: 'https://images.unsplash.com/photo-1464305795204-6f5bbfc7fb81?w=400&q=80',
    steps: [
      'Blitz flour, icing sugar and butter in a food processor until it resembles breadcrumbs. Add egg yolk and 1–2 tbsp cold water. Pulse until dough comes together.',
      'Wrap and refrigerate dough for 30 minutes.',
      'Roll out and line a 23 cm loose-bottomed tart tin. Refrigerate for another 20 minutes.',
      'Blind bake at 180°C for 15 minutes. Remove weights and bake for a further 10 minutes until golden.',
      'Whisk together lemon juice, zest, eggs, egg yolks, sugar and cream. Pour into the tart shell.',
      'Bake at 150°C for 25–30 minutes until just set with a slight wobble. Cool completely before slicing.',
    ],
    ingredients: [
      { name: 'plain flour', quantity: '200', unit: 'g' },
      { name: 'icing sugar', quantity: '50', unit: 'g' },
      { name: 'butter', quantity: '120', unit: 'g', note: 'cold, cubed' },
      { name: 'egg yolk', quantity: '1', unit: null },
      { name: 'lemon juice', quantity: '150', unit: 'ml', note: 'freshly squeezed (about 4 lemons)' },
      { name: 'lemon zest', quantity: '2', unit: 'tsp' },
      { name: 'eggs', quantity: '3', unit: null },
      { name: 'egg yolks', quantity: '2', unit: null },
      { name: 'caster sugar', quantity: '200', unit: 'g' },
      { name: 'heavy cream', quantity: '100', unit: 'ml' },
    ],
  },
  {
    title: 'Mushroom Risotto',
    description: 'A creamy Arborio rice risotto with mixed mushrooms, white wine and parmesan.',
    baseServings: 4,
    category: 'Mains',
    image: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400&q=80',
    steps: [
      'Heat stock in a saucepan and keep warm over low heat.',
      'In a separate wide pan, heat butter and olive oil over medium heat. Cook onion until soft.',
      'Add garlic and sliced mushrooms. Cook until golden and any liquid has evaporated.',
      'Add Arborio rice and stir for 1–2 minutes until toasted.',
      'Pour in white wine and stir until absorbed.',
      'Add warm stock one ladle at a time, stirring constantly and waiting until each addition is absorbed before adding the next. This will take about 18–20 minutes.',
      'Remove from heat. Stir in parmesan, remaining butter and season well.',
      'Rest for 2 minutes. Serve topped with extra parmesan and fresh thyme.',
    ],
    ingredients: [
      { name: 'arborio rice', quantity: '300', unit: 'g' },
      { name: 'mixed mushrooms', quantity: '400', unit: 'g', note: 'sliced (porcini, cremini, shiitake)' },
      { name: 'vegetable stock', quantity: '1.2', unit: 'L', note: 'warm' },
      { name: 'dry white wine', quantity: '150', unit: 'ml' },
      { name: 'brown onion', quantity: '1', unit: null, note: 'finely diced' },
      { name: 'garlic', quantity: '3', unit: 'cloves', note: 'minced' },
      { name: 'butter', quantity: '60', unit: 'g' },
      { name: 'olive oil', quantity: '2', unit: 'tbsp' },
      { name: 'parmesan', quantity: '80', unit: 'g', note: 'freshly grated' },
      { name: 'fresh thyme', quantity: null, unit: null, note: 'to garnish' },
    ],
  },
  {
    title: 'Buttermilk Pancakes',
    description: 'Fluffy, golden stacks of American-style pancakes — the ultimate weekend breakfast.',
    baseServings: 4,
    category: 'Breakfast',
    image: 'https://images.unsplash.com/photo-1528207776546-365bb710ee93?w=400&q=80',
    steps: [
      'Whisk together flour, sugar, baking powder, baking soda and salt in a large bowl.',
      'In another bowl, whisk buttermilk, eggs and melted butter.',
      'Fold wet ingredients into dry until just combined — lumps are fine, do not overmix.',
      'Heat a non-stick pan over medium heat and lightly grease with butter.',
      'Pour ¼ cup batter per pancake. Cook until bubbles form on the surface and edges look set, about 2 minutes.',
      'Flip and cook for a further 1–2 minutes. Repeat with remaining batter.',
      'Serve in a stack with maple syrup, fresh berries and extra butter.',
    ],
    ingredients: [
      { name: 'plain flour', quantity: '250', unit: 'g' },
      { name: 'caster sugar', quantity: '2', unit: 'tbsp' },
      { name: 'baking powder', quantity: '2', unit: 'tsp' },
      { name: 'baking soda', quantity: '0.5', unit: 'tsp' },
      { name: 'salt', quantity: '0.5', unit: 'tsp' },
      { name: 'buttermilk', quantity: '480', unit: 'ml' },
      { name: 'eggs', quantity: '2', unit: null },
      { name: 'butter', quantity: '60', unit: 'g', note: 'melted, plus extra for pan' },
      { name: 'maple syrup', quantity: null, unit: null, note: 'to serve' },
      { name: 'fresh berries', quantity: null, unit: null, note: 'to serve' },
    ],
  },
];

const COMMENTS: Record<string, string> = {
  'Shakshuka': "Made this for a lazy Saturday brunch and it disappeared in minutes. The smoky tomato base is just perfection.",
  'French Onion Soup': "The caramelisation takes patience but my goodness is it worth it. This is the best soup I've ever made at home.",
  'Mango Coconut Chia Pudding': "Perfect meal prep breakfast — made a big batch Sunday night and had it all week. The mango takes it to the next level.",
  'Pesto Gnocchi': "This comes together in 10 minutes and tastes like you spent hours in the kitchen. The toasted pine nuts are non-negotiable.",
  'Pulled Pork Sliders': "Let this go overnight and woke up to an absolutely incredible smell. Took these to a BBQ and everyone was asking for the recipe.",
  'Greek Salad': "Sometimes simple really is best. This salad is crisp, bright and gone before you know it.",
  'Miso Ramen': "Deeply warming and incredibly satisfying. The crispy tofu makes all the difference — don't skip it.",
  'Lemon Tart': "This tart is stunning to look at and even better to eat. The filling is silky smooth and perfectly balanced.",
  'Mushroom Risotto': "The key is patience with the stock additions. Slow down, stir more, be rewarded with the creamiest risotto of your life.",
  'Buttermilk Pancakes': "Light, fluffy, golden — exactly what Saturday mornings were made for. Made a double batch and the kids demolished them.",
};

async function findOrCreateIngredient(name: string): Promise<string> {
  const normalised = name.toLowerCase().trim();
  const existing = await db.select().from(ingredient).where(eq(ingredient.name, normalised)).limit(1);
  if (existing.length > 0) return existing[0].id;
  const [created] = await db.insert(ingredient).values({ name: normalised }).returning();
  return created.id;
}

async function seed() {
  const [testUser2] = await db.select().from(user).where(eq(user.email, TEST2_EMAIL)).limit(1);
  if (!testUser2) {
    console.error('test2 user not found. Run seed-test-user2.ts first.');
    process.exit(1);
  }

  // Ensure public
  await db.update(user).set({ isPublic: true }).where(eq(user.id, testUser2.id));
  console.log('Set test2 user to public.');

  // Find or create household
  let [existingHu] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, testUser2.id))
    .limit(1);

  let householdId: string;

  if (existingHu) {
    householdId = existingHu.householdId;
    console.log('test2 household already exists.');
  } else {
    const [h] = await db.insert(household).values({ name: "Test Two's Kitchen" }).returning();
    householdId = h.id;
    await db.insert(householdUser).values({ householdId, userId: testUser2.id, role: 'OWNER' });
    await db.insert(pantry).values({ householdId });
    await db.insert(shoppingList).values({ householdId });
    console.log("Created household: Test Two's Kitchen");
  }

  // Get or create recipe book
  let [book] = await db
    .select()
    .from(recipeBook)
    .where(eq(recipeBook.householdId, householdId))
    .limit(1);

  if (!book) {
    [book] = await db.insert(recipeBook).values({ householdId }).returning();
    console.log('Created recipe book.');
  }

  // Create categories
  const categoryNames = [...new Set(RECIPES.map((r) => r.category))];
  const categoryMap: Record<string, string> = {};

  for (const name of categoryNames) {
    const [existing] = await db
      .select()
      .from(recipeCategory)
      .where(and(eq(recipeCategory.recipeBookId, book.id), eq(recipeCategory.name, name)))
      .limit(1);

    if (existing) {
      categoryMap[name] = existing.id;
    } else {
      const [cat] = await db.insert(recipeCategory).values({ recipeBookId: book.id, name }).returning();
      categoryMap[name] = cat.id;
      console.log(`Created category: ${name}`);
    }
  }

  // Create recipes
  const createdRecipeIds: string[] = [];

  for (const r of RECIPES) {
    const [existing] = await db
      .select()
      .from(recipe)
      .where(and(eq(recipe.recipeBookId, book.id), eq(recipe.title, r.title)))
      .limit(1);

    let recipeId: string;

    if (existing) {
      console.log(`Recipe already exists: ${r.title}`);
      recipeId = existing.id;
    } else {
      const [newRecipe] = await db
        .insert(recipe)
        .values({
          recipeBookId: book.id,
          categoryId: categoryMap[r.category],
          title: r.title,
          description: r.description,
          baseServings: r.baseServings,
          steps: (r.steps as string[]).map((s) => ({ text: s, subSteps: [] as string[] })),
        })
        .returning();

      recipeId = newRecipe.id;

      // Add image
      await db.insert(recipeImage).values({ recipeId, url: r.image, sortOrder: 0 });

      // Add ingredients
      for (let i = 0; i < r.ingredients.length; i++) {
        const ing = r.ingredients[i];
        const ingredientId = await findOrCreateIngredient(ing.name);
        await db.insert(recipeIngredient).values({
          recipeId,
          ingredientId,
          quantity: ing.quantity ?? null,
          unit: ing.unit ?? null,
          note: (ing as { note?: string }).note ?? null,
          sortOrder: i,
        });
      }

      console.log(`Created recipe: ${r.title}`);
    }

    createdRecipeIds.push(recipeId);
  }

  // Create community posts
  await db.delete(communityPost).where(eq(communityPost.userId, testUser2.id));
  console.log('Cleared existing community posts for test2.');

  const posts = createdRecipeIds.map((recipeId, i) => ({
    userId: testUser2.id,
    recipeId,
    comment: COMMENTS[RECIPES[i].title] ?? 'A favourite in my household — highly recommend!',
  }));

  await db.insert(communityPost).values(posts);
  console.log(`Created ${posts.length} community posts for test2.`);

  console.log('Done!');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
