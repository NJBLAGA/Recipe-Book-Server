import 'dotenv/config';
import { db } from './db';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { pantry, pantryItem, pantryCategory } from './schema/pantry';
import { ingredient } from './schema/ingredient';
import { eq, ilike, and } from 'drizzle-orm';

// Maps category name → keywords that appear in ingredient names
const CATEGORY_RULES: Array<{ name: string; keywords: string[] }> = [
  {
    name: 'Produce',
    keywords: [
      'banana', 'apple', 'lemon', 'lime', 'orange', 'tomato', 'onion', 'garlic',
      'ginger', 'potato', 'carrot', 'celery', 'spinach', 'lettuce', 'kale',
      'broccoli', 'cabbage', 'cucumber', 'zucchini', 'courgette', 'capsicum',
      'pepper', 'chilli', 'pumpkin', 'squash', 'mushroom', 'avocado', 'mango',
      'pineapple', 'berry', 'strawberry', 'blueberry', 'raspberry', 'grape',
      'peach', 'pear', 'plum', 'cherry', 'watermelon', 'melon', 'leek',
      'spring onion', 'scallion', 'shallot', 'beet', 'parsnip', 'radish',
      'asparagus', 'artichoke', 'corn', 'pea', 'bean', 'edamame', 'herb',
      'basil', 'mint', 'parsley', 'coriander', 'cilantro', 'dill', 'chive',
      'thyme', 'rosemary', 'sage', 'oregano',
    ],
  },
  {
    name: 'Dairy & Eggs',
    keywords: [
      'milk', 'cream', 'butter', 'cheese', 'yoghurt', 'yogurt', 'egg',
      'ricotta', 'mozzarella', 'parmesan', 'cheddar', 'brie', 'feta',
      'sour cream', 'crème fraîche', 'creme fraiche', 'ghee', 'whey',
      'condensed milk', 'evaporated milk', 'half and half', 'buttermilk',
    ],
  },
  {
    name: 'Meat & Seafood',
    keywords: [
      'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck', 'veal', 'venison',
      'bacon', 'ham', 'sausage', 'mince', 'ground', 'steak', 'fillet',
      'breast', 'thigh', 'drumstick', 'wing', 'rib', 'brisket', 'chorizo',
      'prosciutto', 'pancetta', 'salami', 'fish', 'salmon', 'tuna', 'cod',
      'prawns', 'shrimp', 'lobster', 'crab', 'scallop', 'mussel', 'oyster',
      'squid', 'anchovy', 'sardine', 'tilapia', 'snapper', 'barramundi',
    ],
  },
  {
    name: 'Grains & Cereals',
    keywords: [
      'flour', 'rice', 'pasta', 'noodle', 'bread', 'oat', 'barley', 'quinoa',
      'couscous', 'semolina', 'cornmeal', 'polenta', 'wheat', 'rye',
      'breadcrumb', 'cracker', 'tortilla', 'wrap', 'pita', 'bagel',
      'cereal', 'muesli', 'granola',
    ],
  },
  {
    name: 'Baking',
    keywords: [
      'sugar', 'baking powder', 'baking soda', 'bicarbonate', 'vanilla',
      'cocoa', 'chocolate', 'yeast', 'gelatin', 'gelatine', 'cornstarch',
      'cornflour', 'icing', 'food colouring', 'food coloring', 'extract',
      'molasses', 'treacle', 'syrup', 'honey', 'maple', 'caramel',
    ],
  },
  {
    name: 'Spices & Herbs',
    keywords: [
      'salt', 'pepper', 'cumin', 'turmeric', 'paprika', 'cinnamon', 'nutmeg',
      'clove', 'cardamom', 'star anise', 'bay leaf', 'cayenne', 'chili powder',
      'curry powder', 'garam masala', 'allspice', 'fennel seed', 'mustard seed',
      'coriander seed', 'caraway', 'saffron', 'sumac', 'za\'atar', 'smoked',
      'dried', 'ground', 'powder',
    ],
  },
  {
    name: 'Condiments & Sauces',
    keywords: [
      'oil', 'vinegar', 'soy sauce', 'fish sauce', 'oyster sauce', 'hoisin',
      'sriracha', 'hot sauce', 'ketchup', 'tomato sauce', 'mustard', 'mayonnaise',
      'mayo', 'relish', 'worcestershire', 'tabasco', 'pesto', 'tahini',
      'teriyaki', 'mirin', 'sake', 'rice wine', 'coconut aminos', 'tamari',
    ],
  },
  {
    name: 'Canned & Pantry Goods',
    keywords: [
      'canned', 'tinned', 'stock', 'broth', 'coconut milk', 'coconut cream',
      'tomato paste', 'tomato puree', 'passata', 'diced tomato', 'lentil',
      'chickpea', 'kidney bean', 'black bean', 'white bean', 'cannellini',
      'lentils', 'chickpeas', 'beans', 'pulse',
    ],
  },
  {
    name: 'Nuts & Seeds',
    keywords: [
      'almond', 'walnut', 'cashew', 'pecan', 'pistachio', 'hazelnut', 'pine nut',
      'peanut', 'macadamia', 'brazil nut', 'sesame', 'sunflower seed',
      'pumpkin seed', 'chia', 'flaxseed', 'linseed', 'hemp seed', 'poppy seed',
    ],
  },
  {
    name: 'Beverages',
    keywords: [
      'coffee', 'tea', 'juice', 'wine', 'beer', 'spirit', 'vodka', 'rum',
      'brandy', 'whisky', 'bourbon', 'water', 'soda', 'cola', 'lemonade',
      'kombucha', 'smoothie', 'milkshake',
    ],
  },
];

function categorise(name: string): string {
  const lower = name.toLowerCase();
  for (const { name: catName, keywords } of CATEGORY_RULES) {
    if (keywords.some((kw) => lower.includes(kw))) return catName;
  }
  return 'Misc';
}

async function main() {
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(ilike(user.name, '%nathan%'));
  if (!users.length) { console.error('No user matching "nathan" found'); process.exit(1); }
  const u = users[0];
  console.log('Found user:', u.name);

  const hus = await db.select({ householdId: householdUser.householdId }).from(householdUser).where(eq(householdUser.userId, u.id));
  if (!hus.length) { console.error('User has no household'); process.exit(1); }
  const householdId = hus[0].householdId;

  const pantries = await db.select({ id: pantry.id }).from(pantry).where(eq(pantry.householdId, householdId));
  if (!pantries.length) { console.error('No pantry found'); process.exit(1); }
  const pantryId = pantries[0].id;

  // Build category map (create if not exists)
  const allCategoryNames = [...new Set(CATEGORY_RULES.map((r) => r.name)), 'Misc'];
  const categoryMap = new Map<string, string>();

  for (const name of allCategoryNames) {
    const [existing] = await db
      .select({ id: pantryCategory.id })
      .from(pantryCategory)
      .where(and(eq(pantryCategory.pantryId, pantryId), eq(pantryCategory.name, name)));

    if (existing) {
      categoryMap.set(name, existing.id);
    } else {
      const [created] = await db
        .insert(pantryCategory)
        .values({ pantryId, name })
        .returning();
      categoryMap.set(name, created.id);
      console.log('Created category:', name);
    }
  }

  // Get all pantry items with their ingredient names
  const items = await db
    .select({
      id: pantryItem.id,
      ingredientName: ingredient.name,
    })
    .from(pantryItem)
    .innerJoin(ingredient, eq(pantryItem.ingredientId, ingredient.id))
    .where(eq(pantryItem.pantryId, pantryId));

  console.log(`\nCategorising ${items.length} pantry items…`);

  for (const item of items) {
    const catName = categorise(item.ingredientName);
    const catId = categoryMap.get(catName)!;
    await db.update(pantryItem).set({ categoryId: catId }).where(eq(pantryItem.id, item.id));
    console.log(`  ${item.ingredientName} → ${catName}`);
  }

  console.log(`\nDone — all ${items.length} items assigned to categories`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
