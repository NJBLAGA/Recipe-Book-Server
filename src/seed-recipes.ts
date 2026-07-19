import 'dotenv/config';
import { db } from './db';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { recipeBook, recipeCategory, recipe, recipeIngredient } from './schema/recipe';
import { pantry, pantryCategory, pantryItem } from './schema/pantry';
import { ingredient } from './schema/ingredient';
import { eq, ilike, and } from 'drizzle-orm';
import { findOrCreateIngredient } from './lib/ingredient';

async function main() {
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(ilike(user.name, '%nathan%'));
  if (!users.length) { console.error('No user matching "nathan" found'); process.exit(1); }
  const u = users[0];
  console.log('Found user:', u.name, u.id);

  const hus = await db.select({ householdId: householdUser.householdId }).from(householdUser).where(eq(householdUser.userId, u.id));
  if (!hus.length) { console.error('User has no household'); process.exit(1); }
  const householdId = hus[0].householdId;

  const [book] = await db.select({ id: recipeBook.id }).from(recipeBook).where(eq(recipeBook.householdId, householdId));
  if (!book) { console.error('No recipe book'); process.exit(1); }

  // Create categories
  const catNames = ['Breakfast', 'Pasta & Grains', 'Salads', 'Soups & Stews', 'Baking', 'Quick Dinners', 'Desserts', 'Snacks'];
  const catMap: Record<string, string> = {};
  for (const name of catNames) {
    const [existing] = await db.select({ id: recipeCategory.id }).from(recipeCategory)
      .where(and(eq(recipeCategory.recipeBookId, book.id), eq(recipeCategory.name, name))).limit(1);
    if (existing) { catMap[name] = existing.id; continue; }
    const [created] = await db.insert(recipeCategory).values({ recipeBookId: book.id, name }).returning({ id: recipeCategory.id });
    catMap[name] = created.id;
    console.log(`Created category: ${name}`);
  }

  // Also create pantry categories for pantry seed
  const [pantryRow] = await db.select({ id: pantry.id }).from(pantry).where(eq(pantry.householdId, householdId));
  const pantryCatNames = ['Dairy & Eggs', 'Meat & Fish', 'Vegetables', 'Fruit', 'Pantry Staples', 'Herbs & Spices', 'Bakery', 'Frozen'];
  const pantryCatMap: Record<string, string> = {};
  if (pantryRow) {
    for (const name of pantryCatNames) {
      const [existing] = await db.select({ id: pantryCategory.id }).from(pantryCategory)
        .where(and(eq(pantryCategory.pantryId, pantryRow.id), eq(pantryCategory.name, name))).limit(1);
      if (existing) { pantryCatMap[name] = existing.id; continue; }
      const [created] = await db.insert(pantryCategory).values({ pantryId: pantryRow.id, name }).returning({ id: pantryCategory.id });
      pantryCatMap[name] = created.id;
    }
    console.log('Pantry categories ready');
  }

  const recipes = [
    {
      title: 'Classic Spaghetti Bolognese',
      description: 'A rich Italian meat sauce slow-cooked to perfection, served over al dente spaghetti.',
      baseServings: 4,
      categoryId: catMap['Pasta & Grains'],
      steps: [
        { text: 'Heat olive oil in a large heavy-based pan over medium heat. Add diced onion and cook until softened, about 5 minutes.', subSteps: [] },
        { text: 'Add minced garlic, diced carrot, and celery. Cook for another 3 minutes until fragrant.', subSteps: [] },
        { text: 'Increase heat to high and add minced beef. Break up the meat and cook until well browned.', subSteps: ['Season well with salt and pepper as you brown', 'Drain excess fat if needed'] },
        { text: 'Pour in red wine and let it reduce by half, scraping up any browned bits from the bottom.', subSteps: [] },
        { text: 'Add crushed tomatoes, tomato paste, bay leaves, and dried oregano. Stir to combine.', subSteps: [] },
        { text: 'Reduce heat to low, cover partially, and simmer for at least 1 hour, stirring occasionally.', subSteps: ['The longer it simmers, the richer the flavour', 'Add a splash of water if it looks too thick'] },
        { text: 'Cook spaghetti in well-salted boiling water until al dente. Reserve 1 cup pasta water before draining.', subSteps: [] },
        { text: 'Toss drained pasta through the bolognese sauce, adding pasta water to loosen if needed. Serve with grated parmesan.', subSteps: [] },
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
        { name: 'bay leaves', quantity: 2, unit: null, note: null },
        { name: 'olive oil', quantity: 2, unit: 'tbsp', note: null },
        { name: 'parmesan', quantity: null, unit: null, note: 'to serve, freshly grated' },
      ],
    },
    {
      title: 'Avocado Toast with Poached Eggs',
      description: 'The classic café brunch made at home — creamy avocado on sourdough with perfectly poached eggs.',
      baseServings: 2,
      categoryId: catMap['Breakfast'],
      steps: [
        { text: 'Toast sourdough slices until golden and crisp.', subSteps: [] },
        { text: 'Halve the avocados, remove stones, and scoop flesh into a bowl. Mash with a fork, leaving some texture.', subSteps: ['Season with salt, pepper, and a squeeze of lemon', 'Add chilli flakes if you like heat'] },
        { text: 'Bring a wide pan of water to a gentle simmer. Add a splash of white vinegar.', subSteps: [] },
        { text: 'Crack each egg into a small cup first. Create a gentle whirlpool in the water and slide the eggs in one at a time.', subSteps: ['Cook for 3 minutes for runny yolks', 'Lift out with a slotted spoon and drain on paper towel'] },
        { text: 'Spread mashed avocado over toast. Top with poached eggs, extra seasoning, and fresh herbs.', subSteps: [] },
      ],
      ingredients: [
        { name: 'sourdough bread', quantity: 4, unit: 'slices', note: 'thick cut' },
        { name: 'avocado', quantity: 2, unit: null, note: 'ripe' },
        { name: 'eggs', quantity: 4, unit: null, note: 'free-range' },
        { name: 'lemon', quantity: 0.5, unit: null, note: null },
        { name: 'chilli flakes', quantity: null, unit: null, note: 'to taste' },
        { name: 'white vinegar', quantity: 1, unit: 'tbsp', note: 'for poaching' },
        { name: 'fresh herbs', quantity: null, unit: null, note: 'chives or coriander, to serve' },
      ],
    },
    {
      title: 'Lemon Herb Roast Chicken',
      description: 'A classic Sunday roast with crispy golden skin and tender, juicy meat perfumed with lemon and herbs.',
      baseServings: 4,
      categoryId: catMap['Quick Dinners'],
      steps: [
        { text: 'Remove chicken from fridge 30 minutes before cooking. Preheat oven to 220°C.', subSteps: [] },
        { text: 'Mix softened butter with lemon zest, garlic, thyme, and rosemary. Season generously with salt and pepper.', subSteps: [] },
        { text: 'Gently loosen the skin over the breast and push most of the butter underneath. Rub the rest all over the outside.', subSteps: [] },
        { text: 'Stuff the cavity with the halved lemon, a few sprigs of thyme, and a head of garlic cut in half.', subSteps: [] },
        { text: 'Roast on a rack for 20 minutes, then reduce to 190°C and continue for 40–50 minutes until juices run clear.', subSteps: ['Baste every 20 minutes for the best skin', 'Rest uncovered for 15 minutes before carving'] },
      ],
      ingredients: [
        { name: 'whole chicken', quantity: 1.8, unit: 'kg', note: null },
        { name: 'butter', quantity: 80, unit: 'g', note: 'softened' },
        { name: 'lemon', quantity: 1, unit: null, note: null },
        { name: 'garlic', quantity: 1, unit: 'head', note: null },
        { name: 'fresh thyme', quantity: 6, unit: 'sprigs', note: null },
        { name: 'fresh rosemary', quantity: 2, unit: 'sprigs', note: null },
      ],
    },
    {
      title: 'Creamy Mushroom Risotto',
      description: 'Velvety, rich risotto packed with earthy mushrooms — the ultimate comfort food that rewards patience.',
      baseServings: 4,
      categoryId: catMap['Pasta & Grains'],
      steps: [
        { text: 'Warm the stock in a saucepan and keep it at a gentle simmer throughout.', subSteps: [] },
        { text: 'In a wide, heavy-based pan, melt butter with olive oil over medium heat. Sauté shallots until translucent.', subSteps: [] },
        { text: 'Add sliced mushrooms and cook until golden and most moisture has evaporated.', subSteps: [] },
        { text: 'Add arborio rice and stir for 2 minutes until the edges turn translucent.', subSteps: [] },
        { text: 'Pour in white wine and stir until absorbed.', subSteps: [] },
        { text: 'Add hot stock one ladle at a time, stirring constantly and waiting until each ladle is absorbed before adding the next.', subSteps: ['This takes about 18–20 minutes', 'Never stop stirring — this is what makes it creamy'] },
        { text: 'When rice is al dente and risotto is creamy, remove from heat. Stir in cold butter and parmesan. Season generously.', subSteps: [] },
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
        { name: 'fresh thyme', quantity: 4, unit: 'sprigs', note: null },
      ],
    },
    {
      title: 'Greek Salad',
      description: 'A vibrant, refreshing salad with salty feta, crisp vegetables, and a simple olive oil dressing.',
      baseServings: 4,
      categoryId: catMap['Salads'],
      steps: [
        { text: 'Cut cucumber in half lengthways and slice into chunky half-moons. Halve the cherry tomatoes.', subSteps: [] },
        { text: 'Slice red onion very thin and soak in cold water for 5 minutes to mellow the bite.', subSteps: [] },
        { text: 'Combine cucumber, tomatoes, drained onion, olives, and capsicum in a large bowl.', subSteps: [] },
        { text: 'Whisk together olive oil, red wine vinegar, dried oregano, salt, and pepper to make the dressing.', subSteps: [] },
        { text: 'Pour dressing over salad and toss gently. Top with crumbled feta and a final pinch of oregano.', subSteps: [] },
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
      title: 'Banana Pancakes',
      description: 'Fluffy, naturally sweet pancakes made with ripe bananas — a weekend breakfast favourite.',
      baseServings: 2,
      categoryId: catMap['Breakfast'],
      steps: [
        { text: 'Mash the ripe bananas in a bowl until smooth.', subSteps: [] },
        { text: 'Whisk in eggs, milk, and vanilla extract. In another bowl, combine flour, baking powder, and a pinch of salt.', subSteps: [] },
        { text: 'Fold wet ingredients into dry until just combined. A few lumps are fine — don\'t overmix.', subSteps: [] },
        { text: 'Heat a non-stick pan with butter over medium heat. Pour ¼ cup batter per pancake.', subSteps: ['Cook until bubbles form on the surface and edges look set, about 2 minutes', 'Flip and cook for another minute until golden'] },
        { text: 'Serve stacked with maple syrup, fresh banana slices, and a dusting of cinnamon.', subSteps: [] },
      ],
      ingredients: [
        { name: 'ripe bananas', quantity: 2, unit: null, note: null },
        { name: 'eggs', quantity: 2, unit: null, note: null },
        { name: 'milk', quantity: 120, unit: 'ml', note: null },
        { name: 'plain flour', quantity: 120, unit: 'g', note: null },
        { name: 'baking powder', quantity: 1.5, unit: 'tsp', note: null },
        { name: 'vanilla extract', quantity: 1, unit: 'tsp', note: null },
        { name: 'butter', quantity: 1, unit: 'tbsp', note: 'for frying' },
        { name: 'maple syrup', quantity: null, unit: null, note: 'to serve' },
        { name: 'cinnamon', quantity: null, unit: null, note: 'to serve' },
      ],
    },
    {
      title: 'Chicken Tikka Masala',
      description: 'Tender marinated chicken in a rich, spiced tomato and cream sauce — the nation\'s favourite curry.',
      baseServings: 4,
      categoryId: catMap['Quick Dinners'],
      steps: [
        { text: 'Marinate chicken in yoghurt, lemon juice, garam masala, cumin, and chilli. Refrigerate for at least 2 hours.', subSteps: ['Overnight marinade gives best results', 'Score the chicken pieces for deeper flavour'] },
        { text: 'Grill or bake marinated chicken at 220°C for 15–20 minutes until lightly charred.', subSteps: [] },
        { text: 'In a large pan, melt butter and sauté onion until deeply golden, about 15 minutes.', subSteps: [] },
        { text: 'Add garlic, ginger, and spices. Cook until fragrant, about 2 minutes.', subSteps: [] },
        { text: 'Add crushed tomatoes and simmer for 10 minutes until sauce thickens.', subSteps: [] },
        { text: 'Stir in cream and add the cooked chicken. Simmer for 5 minutes to let the flavours meld.', subSteps: [] },
        { text: 'Garnish with fresh coriander and serve with basmati rice and warm naan.', subSteps: [] },
      ],
      ingredients: [
        { name: 'chicken thighs', quantity: 800, unit: 'g', note: 'boneless, cut into chunks' },
        { name: 'yoghurt', quantity: 150, unit: 'g', note: 'full fat' },
        { name: 'crushed tomatoes', quantity: 400, unit: 'g', note: null },
        { name: 'heavy cream', quantity: 200, unit: 'ml', note: null },
        { name: 'onion', quantity: 2, unit: null, note: 'finely sliced' },
        { name: 'garlic', quantity: 4, unit: 'cloves', note: 'minced' },
        { name: 'fresh ginger', quantity: 2, unit: 'tsp', note: 'grated' },
        { name: 'garam masala', quantity: 2, unit: 'tsp', note: null },
        { name: 'ground cumin', quantity: 1, unit: 'tsp', note: null },
        { name: 'ground coriander', quantity: 1, unit: 'tsp', note: null },
        { name: 'turmeric', quantity: 0.5, unit: 'tsp', note: null },
        { name: 'chilli powder', quantity: 0.5, unit: 'tsp', note: null },
        { name: 'butter', quantity: 2, unit: 'tbsp', note: null },
        { name: 'fresh coriander', quantity: null, unit: null, note: 'to garnish' },
        { name: 'basmati rice', quantity: 300, unit: 'g', note: 'to serve' },
      ],
    },
    {
      title: 'French Onion Soup',
      description: 'A deeply comforting classic with sweet caramelised onions in rich beef broth, topped with a cheesy crouton.',
      baseServings: 4,
      categoryId: catMap['Soups & Stews'],
      steps: [
        { text: 'Slice onions very thinly. Melt butter with oil in a wide heavy pot over medium-low heat.', subSteps: [] },
        { text: 'Add onions and a pinch of salt. Cook low and slow, stirring every 10 minutes, for 45–60 minutes until deeply caramelised and golden.', subSteps: ['Don\'t rush this step — the sweetness comes from time', 'If they catch, add a splash of water and scrape the bottom'] },
        { text: 'Add garlic and thyme, cook 2 minutes. Pour in brandy and let it cook off.', subSteps: [] },
        { text: 'Add beef stock and simmer for 20 minutes. Season with salt and pepper.', subSteps: [] },
        { text: 'Toast baguette slices. Ladle soup into oven-safe bowls, top with toast, then pile on grated gruyère.', subSteps: [] },
        { text: 'Grill under a hot broiler until cheese is golden and bubbling. Serve immediately.', subSteps: [] },
      ],
      ingredients: [
        { name: 'brown onions', quantity: 1.5, unit: 'kg', note: 'thinly sliced' },
        { name: 'beef stock', quantity: 1.5, unit: 'L', note: null },
        { name: 'butter', quantity: 60, unit: 'g', note: null },
        { name: 'olive oil', quantity: 1, unit: 'tbsp', note: null },
        { name: 'garlic', quantity: 3, unit: 'cloves', note: 'minced' },
        { name: 'fresh thyme', quantity: 4, unit: 'sprigs', note: null },
        { name: 'brandy', quantity: 3, unit: 'tbsp', note: null },
        { name: 'baguette', quantity: 8, unit: 'slices', note: null },
        { name: 'gruyère cheese', quantity: 150, unit: 'g', note: 'grated' },
      ],
    },
    {
      title: 'Chocolate Lava Cake',
      description: 'Impossibly decadent individual chocolate cakes with a molten flowing centre. Ready in 20 minutes.',
      baseServings: 4,
      categoryId: catMap['Desserts'],
      steps: [
        { text: 'Preheat oven to 220°C. Grease four ramekins with butter and dust with cocoa powder.', subSteps: [] },
        { text: 'Melt dark chocolate and butter together in a heatproof bowl over simmering water. Stir until smooth, then remove from heat.', subSteps: [] },
        { text: 'Whisk eggs, egg yolks, and sugar until pale and thick, about 3 minutes.', subSteps: [] },
        { text: 'Fold egg mixture into the chocolate, then sift in flour and fold gently until just combined.', subSteps: [] },
        { text: 'Divide batter between prepared ramekins. Refrigerate until needed (up to 24 hours).', subSteps: [] },
        { text: 'Bake for exactly 12 minutes — the edges should be set but the centre still jiggly.', subSteps: ['Test with a skewer — it should come out with wet batter on it', 'Every oven is different; first batch is a test run'] },
        { text: 'Run a knife around the edge, invert onto a plate, and serve immediately with vanilla ice cream.', subSteps: [] },
      ],
      ingredients: [
        { name: 'dark chocolate', quantity: 200, unit: 'g', note: '70% cocoa' },
        { name: 'butter', quantity: 150, unit: 'g', note: 'plus extra for greasing' },
        { name: 'eggs', quantity: 3, unit: null, note: null },
        { name: 'egg yolks', quantity: 3, unit: null, note: null },
        { name: 'caster sugar', quantity: 100, unit: 'g', note: null },
        { name: 'plain flour', quantity: 50, unit: 'g', note: null },
        { name: 'cocoa powder', quantity: 1, unit: 'tbsp', note: 'for dusting' },
        { name: 'vanilla ice cream', quantity: null, unit: null, note: 'to serve' },
      ],
    },
    {
      title: 'Homemade Hummus',
      description: 'Silky smooth chickpea dip that puts shop-bought to shame. The secret is spending time blending.',
      baseServings: 6,
      categoryId: catMap['Snacks'],
      steps: [
        { text: 'Drain and rinse the canned chickpeas. Reserve the liquid (aquafaba).', subSteps: [] },
        { text: 'In a food processor, blend tahini and lemon juice for 1 minute. This lightens the tahini.', subSteps: [] },
        { text: 'Add garlic and olive oil, blend for another 30 seconds.', subSteps: [] },
        { text: 'Add chickpeas and blend for 3–4 minutes, scraping down the sides. Add aquafaba gradually to reach desired consistency.', subSteps: ['The more you blend, the silkier it gets', 'Taste and adjust lemon, salt, and garlic'] },
        { text: 'Serve in a bowl with a swirl of olive oil, paprika, and toasted pine nuts. Warm pita on the side.', subSteps: [] },
      ],
      ingredients: [
        { name: 'canned chickpeas', quantity: 400, unit: 'g', note: 'drained, liquid reserved' },
        { name: 'tahini', quantity: 80, unit: 'g', note: null },
        { name: 'lemon juice', quantity: 3, unit: 'tbsp', note: 'freshly squeezed' },
        { name: 'garlic', quantity: 1, unit: 'clove', note: null },
        { name: 'olive oil', quantity: 3, unit: 'tbsp', note: 'extra virgin, plus more to serve' },
        { name: 'paprika', quantity: null, unit: null, note: 'to serve' },
        { name: 'pine nuts', quantity: null, unit: null, note: 'toasted, to serve' },
        { name: 'pita bread', quantity: null, unit: null, note: 'to serve' },
      ],
    },
    {
      title: 'Sourdough Focaccia',
      description: 'Dimpled, pillowy focaccia with a crisp olive oil crust and a tender, chewy crumb.',
      baseServings: 8,
      categoryId: catMap['Baking'],
      steps: [
        { text: 'Mix flour, yeast, salt, and water into a rough dough. Rest for 30 minutes.', subSteps: [] },
        { text: 'Stretch and fold the dough every 30 minutes for 2 hours. It should become smooth and elastic.', subSteps: [] },
        { text: 'Pour ¼ cup olive oil into a large baking tray. Transfer dough, flip to coat in oil, and spread gently.', subSteps: [] },
        { text: 'Cover and refrigerate overnight (8–18 hours) for best flavour.', subSteps: [] },
        { text: 'Remove from fridge 2 hours before baking. Dimple aggressively with your fingers all over.', subSteps: [] },
        { text: 'Drizzle generously with olive oil and add toppings. Bake at 230°C for 20–25 minutes until deeply golden.', subSteps: [] },
      ],
      ingredients: [
        { name: 'plain flour', quantity: 500, unit: 'g', note: null },
        { name: 'warm water', quantity: 450, unit: 'ml', note: null },
        { name: 'instant yeast', quantity: 7, unit: 'g', note: null },
        { name: 'salt', quantity: 10, unit: 'g', note: null },
        { name: 'olive oil', quantity: 120, unit: 'ml', note: null },
        { name: 'rosemary', quantity: 4, unit: 'sprigs', note: null },
        { name: 'flaky sea salt', quantity: null, unit: null, note: 'for topping' },
      ],
    },
    {
      title: 'Tom Yum Soup',
      description: 'Bold, fragrant Thai soup with a sour, spicy, and aromatic broth. Ready in 30 minutes.',
      baseServings: 2,
      categoryId: catMap['Soups & Stews'],
      steps: [
        { text: 'Bring stock to a boil. Add lemongrass, galangal, kaffir lime leaves, and chillies. Simmer for 10 minutes.', subSteps: [] },
        { text: 'Add sliced mushrooms and simmer 3 minutes.', subSteps: [] },
        { text: 'Add prawns or tofu and cook until just done, about 2–3 minutes.', subSteps: [] },
        { text: 'Remove from heat. Stir in fish sauce, lime juice, and sugar. Taste and adjust seasoning.', subSteps: ['More fish sauce for saltiness', 'More lime for sourness', 'Chilli for heat'] },
        { text: 'Ladle into bowls, garnish with fresh coriander and spring onion. Serve with steamed rice.', subSteps: [] },
      ],
      ingredients: [
        { name: 'chicken stock', quantity: 750, unit: 'ml', note: null },
        { name: 'prawns', quantity: 300, unit: 'g', note: 'peeled and deveined' },
        { name: 'lemongrass', quantity: 2, unit: 'stalks', note: 'bruised and cut' },
        { name: 'galangal', quantity: 3, unit: 'slices', note: null },
        { name: 'kaffir lime leaves', quantity: 4, unit: null, note: 'torn' },
        { name: 'thai chillies', quantity: 3, unit: null, note: 'bruised' },
        { name: 'mushrooms', quantity: 150, unit: 'g', note: 'sliced' },
        { name: 'fish sauce', quantity: 3, unit: 'tbsp', note: null },
        { name: 'lime juice', quantity: 3, unit: 'tbsp', note: null },
        { name: 'palm sugar', quantity: 1, unit: 'tsp', note: null },
        { name: 'fresh coriander', quantity: null, unit: null, note: 'to garnish' },
        { name: 'spring onion', quantity: 2, unit: null, note: 'sliced' },
      ],
    },
    {
      title: 'Classic Caesar Salad',
      description: 'Crisp romaine lettuce with a rich, savoury dressing, crunchy croutons, and shaved parmesan.',
      baseServings: 4,
      categoryId: catMap['Salads'],
      steps: [
        { text: 'Make the dressing: whisk together minced garlic, anchovy paste, lemon juice, dijon mustard, and worcestershire sauce. Gradually whisk in olive oil until emulsified. Add parmesan and season with pepper.', subSteps: ['You can blend this for an even smoother result', 'Taste and add a pinch of salt if needed'] },
        { text: 'Tear or chop romaine into large pieces. Wash and dry well — wet leaves dilute the dressing.', subSteps: [] },
        { text: 'For croutons: toss torn bread with olive oil, salt, and garlic. Bake at 190°C for 12 minutes until golden.', subSteps: [] },
        { text: 'Toss romaine with dressing until well coated. Add croutons and finish with shaved parmesan.', subSteps: [] },
      ],
      ingredients: [
        { name: 'romaine lettuce', quantity: 2, unit: 'heads', note: null },
        { name: 'parmesan', quantity: 80, unit: 'g', note: 'freshly grated, plus shavings to serve' },
        { name: 'sourdough bread', quantity: 3, unit: 'slices', note: 'for croutons' },
        { name: 'garlic', quantity: 2, unit: 'cloves', note: 'minced' },
        { name: 'anchovy paste', quantity: 1, unit: 'tsp', note: null },
        { name: 'lemon juice', quantity: 2, unit: 'tbsp', note: null },
        { name: 'dijon mustard', quantity: 1, unit: 'tsp', note: null },
        { name: 'worcestershire sauce', quantity: 0.5, unit: 'tsp', note: null },
        { name: 'olive oil', quantity: 80, unit: 'ml', note: 'extra virgin' },
      ],
    },
    {
      title: 'Vegetable Minestrone',
      description: 'A hearty Italian vegetable soup loaded with seasonal vegetables, beans, and pasta.',
      baseServings: 6,
      categoryId: catMap['Soups & Stews'],
      steps: [
        { text: 'Heat olive oil in a large pot. Sauté diced onion, carrot, and celery until softened, about 8 minutes.', subSteps: [] },
        { text: 'Add garlic, tomato paste, and dried herbs. Cook 2 minutes.', subSteps: [] },
        { text: 'Add diced tomatoes, vegetable stock, and zucchini. Bring to a boil then simmer 15 minutes.', subSteps: [] },
        { text: 'Add cannellini beans, cavolo nero, and pasta. Cook until pasta is al dente, about 10 minutes.', subSteps: [] },
        { text: 'Season generously. Serve with crusty bread and a drizzle of good olive oil.', subSteps: [] },
      ],
      ingredients: [
        { name: 'onion', quantity: 1, unit: null, note: null },
        { name: 'carrot', quantity: 2, unit: null, note: null },
        { name: 'celery', quantity: 3, unit: 'stalks', note: null },
        { name: 'garlic', quantity: 3, unit: 'cloves', note: null },
        { name: 'canned diced tomatoes', quantity: 400, unit: 'g', note: null },
        { name: 'vegetable stock', quantity: 1.5, unit: 'L', note: null },
        { name: 'zucchini', quantity: 2, unit: null, note: 'diced' },
        { name: 'cannellini beans', quantity: 400, unit: 'g', note: 'canned, drained' },
        { name: 'cavolo nero', quantity: 100, unit: 'g', note: 'or kale, roughly chopped' },
        { name: 'small pasta', quantity: 100, unit: 'g', note: 'ditalini or macaroni' },
        { name: 'tomato paste', quantity: 2, unit: 'tbsp', note: null },
        { name: 'dried mixed herbs', quantity: 1, unit: 'tsp', note: null },
        { name: 'olive oil', quantity: 3, unit: 'tbsp', note: null },
      ],
    },
    {
      title: 'Sticky Toffee Pudding',
      description: 'Britain\'s most beloved dessert — a moist date sponge drenched in a buttery toffee sauce.',
      baseServings: 6,
      categoryId: catMap['Desserts'],
      steps: [
        { text: 'Soak chopped dates in boiling water with baking soda for 15 minutes.', subSteps: [] },
        { text: 'Beat butter and sugar until pale. Add eggs one at a time, then vanilla.', subSteps: [] },
        { text: 'Fold in flour and then the date mixture. Pour into a greased 23cm square tin.', subSteps: [] },
        { text: 'Bake at 180°C for 30–35 minutes until a skewer comes out clean.', subSteps: [] },
        { text: 'For the sauce: melt butter, brown sugar, and cream together in a saucepan. Simmer 3 minutes until thickened.', subSteps: [] },
        { text: 'Poke the hot pudding all over with a skewer and pour half the sauce over it. Serve slices with remaining warm sauce and cream.', subSteps: [] },
      ],
      ingredients: [
        { name: 'medjool dates', quantity: 200, unit: 'g', note: 'pitted and chopped' },
        { name: 'boiling water', quantity: 250, unit: 'ml', note: null },
        { name: 'baking soda', quantity: 1, unit: 'tsp', note: null },
        { name: 'butter', quantity: 60, unit: 'g', note: 'softened' },
        { name: 'caster sugar', quantity: 140, unit: 'g', note: null },
        { name: 'eggs', quantity: 2, unit: null, note: null },
        { name: 'vanilla extract', quantity: 1, unit: 'tsp', note: null },
        { name: 'self-raising flour', quantity: 175, unit: 'g', note: null },
        { name: 'brown sugar', quantity: 175, unit: 'g', note: 'for sauce' },
        { name: 'heavy cream', quantity: 200, unit: 'ml', note: 'for sauce, plus extra to serve' },
      ],
    },
  ];

  let added = 0;
  for (const r of recipes) {
    const existing = await db.select({ id: recipe.id }).from(recipe)
      .where(and(eq(recipe.recipeBookId, book.id), eq(recipe.title, r.title))).limit(1);
    if (existing.length > 0) { console.log(`  Skip (exists): ${r.title}`); continue; }

    await db.transaction(async (tx) => {
      const [newRecipe] = await tx.insert(recipe).values({
        recipeBookId: book.id,
        title: r.title,
        description: r.description,
        baseServings: r.baseServings,
        categoryId: r.categoryId,
        steps: r.steps,
      }).returning();

      const rows = await Promise.all(r.ingredients.map(async (ing, i) => {
        const ingredientId = await findOrCreateIngredient(tx, ing.name);
        return {
          recipeId: newRecipe.id,
          ingredientId,
          quantity: ing.quantity != null ? String(ing.quantity) : null,
          unit: ing.unit,
          note: ing.note,
          sortOrder: i,
        };
      }));
      await tx.insert(recipeIngredient).values(rows);
    });

    console.log(`  Added: ${r.title}`);
    added++;
  }

  // Seed pantry items in the correct categories if pantry exists
  if (pantryRow && Object.keys(pantryCatMap).length > 0) {
    const pantrySeeds: Array<{ name: string; cat: string; inStock: boolean; quantity?: number; unit?: string }> = [
      { name: 'eggs', cat: 'Dairy & Eggs', inStock: true, quantity: 12, unit: 'pack' },
      { name: 'butter', cat: 'Dairy & Eggs', inStock: true, quantity: 2, unit: 'block' },
      { name: 'milk', cat: 'Dairy & Eggs', inStock: true, quantity: 2, unit: 'litre' },
      { name: 'parmesan', cat: 'Dairy & Eggs', inStock: true },
      { name: 'heavy cream', cat: 'Dairy & Eggs', inStock: false },
      { name: 'chicken thighs', cat: 'Meat & Fish', inStock: true, quantity: 1, unit: 'pack' },
      { name: 'minced beef', cat: 'Meat & Fish', inStock: false },
      { name: 'prawns', cat: 'Meat & Fish', inStock: true, quantity: 1, unit: 'bag' },
      { name: 'garlic', cat: 'Vegetables', inStock: true, quantity: 1, unit: 'bulb' },
      { name: 'onion', cat: 'Vegetables', inStock: true, quantity: 1, unit: 'bag' },
      { name: 'carrot', cat: 'Vegetables', inStock: true },
      { name: 'celery', cat: 'Vegetables', inStock: false },
      { name: 'mushrooms', cat: 'Vegetables', inStock: true },
      { name: 'zucchini', cat: 'Vegetables', inStock: false },
      { name: 'cherry tomatoes', cat: 'Vegetables', inStock: true },
      { name: 'avocado', cat: 'Fruit', inStock: true, quantity: 2, unit: 'loose' },
      { name: 'lemon', cat: 'Fruit', inStock: true, quantity: 4, unit: 'loose' },
      { name: 'ripe bananas', cat: 'Fruit', inStock: true, quantity: 1, unit: 'bunch' },
      { name: 'olive oil', cat: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bottle' },
      { name: 'plain flour', cat: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bag' },
      { name: 'canned chickpeas', cat: 'Pantry Staples', inStock: true, quantity: 3, unit: 'can' },
      { name: 'crushed tomatoes', cat: 'Pantry Staples', inStock: true, quantity: 4, unit: 'can' },
      { name: 'cannellini beans', cat: 'Pantry Staples', inStock: true, quantity: 2, unit: 'can' },
      { name: 'tomato paste', cat: 'Pantry Staples', inStock: true },
      { name: 'spaghetti', cat: 'Pantry Staples', inStock: true, quantity: 2, unit: 'pack' },
      { name: 'arborio rice', cat: 'Pantry Staples', inStock: false },
      { name: 'basmati rice', cat: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bag' },
      { name: 'dried oregano', cat: 'Herbs & Spices', inStock: true },
      { name: 'garam masala', cat: 'Herbs & Spices', inStock: true },
      { name: 'ground cumin', cat: 'Herbs & Spices', inStock: true },
      { name: 'turmeric', cat: 'Herbs & Spices', inStock: true },
      { name: 'chilli powder', cat: 'Herbs & Spices', inStock: true },
      { name: 'cinnamon', cat: 'Herbs & Spices', inStock: true },
      { name: 'sourdough bread', cat: 'Bakery', inStock: true, quantity: 1, unit: 'loaf' },
      { name: 'baguette', cat: 'Bakery', inStock: false },
    ];

    for (const seed of pantrySeeds) {
      const catId = pantryCatMap[seed.cat];
      if (!catId) continue;

      const ingredientId = await findOrCreateIngredient(db, seed.name);
      const [existing] = await db.select({ id: pantryItem.id }).from(pantryItem)
        .where(and(eq(pantryItem.pantryId, pantryRow.id), eq(pantryItem.ingredientId, ingredientId))).limit(1);
      if (existing) continue;

      await db.insert(pantryItem).values({
        pantryId: pantryRow.id,
        ingredientId,
        categoryId: catId,
        inStock: seed.inStock,
        quantity: seed.quantity ?? null,
        unit: seed.unit ?? null,
      });
    }
    console.log('Pantry seeded');
  }

  console.log(`\nDone — added ${added} recipes`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
