import 'dotenv/config';
import { eq, and } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { ingredient } from './schema/ingredient';
import { pantry, pantryItem, pantryItemImage, pantryCategory } from './schema/pantry';
import { shoppingList, shoppingListCategory, shoppingListItem, shoppingListItemImage } from './schema/shopping';

const EMAIL = process.argv[2] ?? 'nathanblaga90@gmail.com';

const PANTRY_SEED: Array<{
  name: string; category: string; inStock: boolean;
  quantity: number | null; unit: string | null; notes: string | null; images: string[];
}> = [
  // Dairy & Eggs (17 items)
  { name: 'Eggs', category: 'Dairy & Eggs', inStock: true, quantity: 12, unit: 'pack', notes: 'Free range, size 7',
    images: ['https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=600&q=80', 'https://images.unsplash.com/photo-1607690424560-35d967d6ad7b?w=600&q=80'] },
  { name: 'Milk', category: 'Dairy & Eggs', inStock: true, quantity: 2, unit: 'L', notes: 'Full cream',
    images: ['https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&q=80', 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&q=80'] },
  { name: 'Butter', category: 'Dairy & Eggs', inStock: false, quantity: 1, unit: 'block', notes: null,
    images: ['https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=600&q=80', 'https://images.unsplash.com/photo-1550399105-c4db5fb85c18?w=600&q=80'] },
  { name: 'Cheddar Cheese', category: 'Dairy & Eggs', inStock: true, quantity: 400, unit: 'g', notes: 'Vintage cheddar',
    images: ['https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=600&q=80', 'https://images.unsplash.com/photo-1618428740699-d88e09fddfe0?w=600&q=80'] },
  { name: 'Greek Yoghurt', category: 'Dairy & Eggs', inStock: true, quantity: 500, unit: 'g', notes: 'Full fat',
    images: ['https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80', 'https://images.unsplash.com/photo-1571212515416-fca7b2e61b12?w=600&q=80', 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=600&q=80'] },
  { name: 'Sour Cream', category: 'Dairy & Eggs', inStock: false, quantity: null, unit: null, notes: 'Need to restock',
    images: ['https://images.unsplash.com/photo-1631893682905-59b0ca64edd3?w=600&q=80', 'https://images.unsplash.com/photo-1614236224990-4bf0a5dc2519?w=600&q=80'] },
  { name: 'Parmesan', category: 'Dairy & Eggs', inStock: true, quantity: 200, unit: 'g', notes: 'Freshly grated',
    images: ['https://images.unsplash.com/photo-1447338073979-b2b2b77e0f29?w=600&q=80', 'https://images.unsplash.com/photo-1634487359989-3e90c9432133?w=600&q=80'] },
  { name: 'Cream', category: 'Dairy & Eggs', inStock: true, quantity: 300, unit: 'ml', notes: 'Thickened cream',
    images: ['https://images.unsplash.com/photo-1587657566038-cdbc1e3e7ade?w=600&q=80', 'https://images.unsplash.com/photo-1559181567-c3190bbbbd7b?w=600&q=80'] },
  { name: 'Ricotta', category: 'Dairy & Eggs', inStock: true, quantity: 500, unit: 'g', notes: 'Fresh from deli',
    images: ['https://images.unsplash.com/photo-1631193816258-28b44b21e78f?w=600&q=80', 'https://images.unsplash.com/photo-1574087988627-bae5a7a93f5c?w=600&q=80'] },
  { name: 'Mozzarella', category: 'Dairy & Eggs', inStock: true, quantity: 200, unit: 'g', notes: 'Buffalo, fresh',
    images: ['https://images.unsplash.com/photo-1565600444102-a7fe05db8fe0?w=600&q=80', 'https://images.unsplash.com/photo-1534353341086-5b6082c75beb?w=600&q=80'] },
  { name: 'Cream Cheese', category: 'Dairy & Eggs', inStock: false, quantity: 250, unit: 'g', notes: null,
    images: ['https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=600&q=80'] },
  { name: 'Feta Cheese', category: 'Dairy & Eggs', inStock: true, quantity: 200, unit: 'g', notes: 'Greek, in brine',
    images: ['https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=80', 'https://images.unsplash.com/photo-1601056879863-10bbcdb4f34c?w=600&q=80'] },
  { name: 'Kefir', category: 'Dairy & Eggs', inStock: false, quantity: 1, unit: 'bottle', notes: 'Plain, probiotic',
    images: ['https://images.unsplash.com/photo-1571212515416-fca7b2e61b12?w=600&q=80'] },
  { name: 'Cottage Cheese', category: 'Dairy & Eggs', inStock: true, quantity: 250, unit: 'g', notes: null,
    images: ['https://images.unsplash.com/photo-1567983369643-4dd1a97b8126?w=600&q=80', 'https://images.unsplash.com/photo-1609501676725-7186f734b669?w=600&q=80'] },
  { name: 'Brie', category: 'Dairy & Eggs', inStock: true, quantity: 125, unit: 'g', notes: 'Ripe, perfect for board',
    images: ['https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=600&q=80', 'https://images.unsplash.com/photo-1452195100486-9cc805987862?w=600&q=80'] },
  { name: 'Double Cream', category: 'Dairy & Eggs', inStock: false, quantity: 200, unit: 'ml', notes: 'For desserts', images: [] },
  { name: 'Oat Milk', category: 'Dairy & Eggs', inStock: true, quantity: 1, unit: 'L', notes: 'Barista blend',
    images: ['https://images.unsplash.com/photo-1600718374662-0483d2b9da44?w=600&q=80', 'https://images.unsplash.com/photo-1612540139150-1c7a26d14099?w=600&q=80'] },

  // Fruit & Veg (15 items)
  { name: 'Bananas', category: 'Fruit & Veg', inStock: true, quantity: 6, unit: null, notes: 'Cavendish, starting to ripen',
    images: ['https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=600&q=80', 'https://images.unsplash.com/photo-1603833665858-e61d17a86224?w=600&q=80', 'https://images.unsplash.com/photo-1543218024-57a70143c369?w=600&q=80'] },
  { name: 'Spinach', category: 'Fruit & Veg', inStock: true, quantity: 1, unit: 'bag', notes: 'Baby leaf',
    images: ['https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=600&q=80', 'https://images.unsplash.com/photo-1535189043414-47a3c49a0bed?w=600&q=80'] },
  { name: 'Cherry Tomatoes', category: 'Fruit & Veg', inStock: true, quantity: 1, unit: 'punnet', notes: null,
    images: ['https://images.unsplash.com/photo-1558818498-28c1e002b655?w=600&q=80', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80'] },
  { name: 'Avocados', category: 'Fruit & Veg', inStock: false, quantity: null, unit: null, notes: 'Out — buy ripe ones',
    images: ['https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&q=80', 'https://images.unsplash.com/photo-1519162808019-7de1683fa2ad?w=600&q=80', 'https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=600&q=80'] },
  { name: 'Garlic', category: 'Fruit & Veg', inStock: true, quantity: 3, unit: 'bulbs', notes: null,
    images: ['https://images.unsplash.com/photo-1544105779-c1a56a536c1f?w=600&q=80', 'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=600&q=80'] },
  { name: 'Brown Onions', category: 'Fruit & Veg', inStock: true, quantity: 5, unit: null, notes: null,
    images: ['https://images.unsplash.com/photo-1508747703725-719777637510?w=600&q=80', 'https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?w=600&q=80', 'https://images.unsplash.com/photo-1580208895613-9c89bd4ae7ae?w=600&q=80'] },
  { name: 'Lemons', category: 'Fruit & Veg', inStock: true, quantity: 4, unit: null, notes: null,
    images: ['https://images.unsplash.com/photo-1587486913049-53fc88980cfc?w=600&q=80', 'https://images.unsplash.com/photo-1571566882372-1598d88abd90?w=600&q=80'] },
  { name: 'Sweet Potato', category: 'Fruit & Veg', inStock: false, quantity: null, unit: null, notes: null,
    images: ['https://images.unsplash.com/photo-1596097557175-bc6f8fbb6a36?w=600&q=80', 'https://images.unsplash.com/photo-1627843240167-b1f9d28f732a?w=600&q=80'] },
  { name: 'Zucchini', category: 'Fruit & Veg', inStock: true, quantity: 3, unit: null, notes: null,
    images: ['https://images.unsplash.com/photo-1563565453-e5bc17a8a5c0?w=600&q=80', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=600&q=80'] },
  { name: 'Red Capsicum', category: 'Fruit & Veg', inStock: true, quantity: 2, unit: null, notes: null,
    images: ['https://images.unsplash.com/photo-1563565453-e5bc17a8a5c0?w=600&q=80', 'https://images.unsplash.com/photo-1525607551316-4a8e16d1f9ba?w=600&q=80'] },
  { name: 'Broccoli', category: 'Fruit & Veg', inStock: true, quantity: 1, unit: 'head', notes: null,
    images: ['https://images.unsplash.com/photo-1459411621453-7b03977f4bfc?w=600&q=80', 'https://images.unsplash.com/photo-1584270354949-c26b0d5b4a0c?w=600&q=80'] },
  { name: 'Mushrooms', category: 'Fruit & Veg', inStock: false, quantity: 200, unit: 'g', notes: 'Swiss brown',
    images: ['https://images.unsplash.com/photo-1552825914-ca3326695520?w=600&q=80', 'https://images.unsplash.com/photo-1601387561777-ac84a3dd4ab1?w=600&q=80'] },
  { name: 'Cucumber', category: 'Fruit & Veg', inStock: true, quantity: 2, unit: null, notes: 'Continental',
    images: ['https://images.unsplash.com/photo-1589621316382-008455b857cd?w=600&q=80', 'https://images.unsplash.com/photo-1568584711271-6c929fb49b60?w=600&q=80'] },
  { name: 'Kale', category: 'Fruit & Veg', inStock: false, quantity: 1, unit: 'bunch', notes: 'Tuscan / Cavolo nero',
    images: ['https://images.unsplash.com/photo-1519996529931-28324d5a630e?w=600&q=80', 'https://images.unsplash.com/photo-1562547256-2c5ee93b60b7?w=600&q=80'] },
  { name: 'Strawberries', category: 'Fruit & Veg', inStock: true, quantity: 1, unit: 'punnet', notes: 'In season',
    images: ['https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=600&q=80', 'https://images.unsplash.com/photo-1518635017498-87f514b751ba?w=600&q=80', 'https://images.unsplash.com/photo-1587393855524-087f83d95bc9?w=600&q=80'] },

  // Meat & Seafood (16 items)
  { name: 'Chicken Breast', category: 'Meat & Seafood', inStock: true, quantity: 500, unit: 'g', notes: 'Free range, skin off',
    images: ['https://images.unsplash.com/photo-1604503468506-a8da13d11d36?w=600&q=80', 'https://images.unsplash.com/photo-1603048675657-11f5f4b74d64?w=600&q=80', 'https://images.unsplash.com/photo-1612697517741-c42e7e1c3e67?w=600&q=80'] },
  { name: 'Salmon Fillets', category: 'Meat & Seafood', inStock: true, quantity: 2, unit: 'fillets', notes: 'Atlantic, skin on',
    images: ['https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80', 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=600&q=80'] },
  { name: 'Beef Mince', category: 'Meat & Seafood', inStock: false, quantity: null, unit: null, notes: 'Buy 500g lean',
    images: ['https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=600&q=80', 'https://images.unsplash.com/photo-1558030006-450675393462?w=600&q=80'] },
  { name: 'Chicken Thighs', category: 'Meat & Seafood', inStock: true, quantity: 1, unit: 'kg', notes: 'Bone-in',
    images: ['https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?w=600&q=80', 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600&q=80'] },
  { name: 'Prawns', category: 'Meat & Seafood', inStock: false, quantity: null, unit: null, notes: 'Buy fresh from market',
    images: ['https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=600&q=80', 'https://images.unsplash.com/photo-1533477359781-0be811f8a498?w=600&q=80'] },
  { name: 'Lamb Cutlets', category: 'Meat & Seafood', inStock: true, quantity: 4, unit: 'cutlets', notes: 'French trimmed',
    images: ['https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=600&q=80', 'https://images.unsplash.com/photo-1599225745889-5697cb05e2cd?w=600&q=80'] },
  { name: 'Bacon', category: 'Meat & Seafood', inStock: true, quantity: 1, unit: 'pack', notes: 'Middle rashers',
    images: ['https://images.unsplash.com/photo-1528607929212-2636ec44253e?w=600&q=80', 'https://images.unsplash.com/photo-1551615593-ef5fe247e8f7?w=600&q=80'] },
  { name: 'Pork Belly', category: 'Meat & Seafood', inStock: true, quantity: 500, unit: 'g', notes: 'Skin on, scored',
    images: ['https://images.unsplash.com/photo-1529042410759-befb1204b468?w=600&q=80', 'https://images.unsplash.com/photo-1544025162-d76538485353?w=600&q=80'] },
  { name: 'Tuna Steaks', category: 'Meat & Seafood', inStock: false, quantity: 2, unit: 'steaks', notes: null,
    images: ['https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80'] },
  { name: 'Chorizo', category: 'Meat & Seafood', inStock: true, quantity: 1, unit: 'pack', notes: 'Hot variety, sliced',
    images: ['https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&q=80', 'https://images.unsplash.com/photo-1528607929212-2636ec44253e?w=600&q=80'] },
  { name: 'Turkey Breast', category: 'Meat & Seafood', inStock: false, quantity: 500, unit: 'g', notes: 'Sliced, deli style',
    images: ['https://images.unsplash.com/photo-1574926054069-6aa8f7faf93c?w=600&q=80', 'https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?w=600&q=80'] },
  { name: 'Duck Breast', category: 'Meat & Seafood', inStock: true, quantity: 2, unit: 'breasts', notes: 'Skin on, score and render',
    images: ['https://images.unsplash.com/photo-1604503468506-a8da13d11d36?w=600&q=80', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80'] },
  { name: 'Squid', category: 'Meat & Seafood', inStock: false, quantity: 300, unit: 'g', notes: 'Cleaned tubes and rings', images: [] },
  { name: 'Mussels', category: 'Meat & Seafood', inStock: true, quantity: 500, unit: 'g', notes: 'Fresh, cleaned',
    images: ['https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=600&q=80', 'https://images.unsplash.com/photo-1504607798333-52a30db54a5d?w=600&q=80'] },
  { name: 'Snapper', category: 'Meat & Seafood', inStock: true, quantity: 1, unit: 'whole', notes: 'Ask fishmonger to scale',
    images: ['https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=600&q=80', 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80'] },
  { name: 'Pork Mince', category: 'Meat & Seafood', inStock: false, quantity: 500, unit: 'g', notes: null, images: [] },

  // Pantry Staples (10 items)
  { name: 'Olive Oil', category: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bottle', notes: 'Extra virgin, cold pressed',
    images: ['https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&q=80'] },
  { name: 'Flour', category: 'Pantry Staples', inStock: true, quantity: 1, unit: 'kg', notes: 'Plain flour',
    images: ['https://images.unsplash.com/photo-1606914501449-5a96b6ce24ca?w=600&q=80', 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=600&q=80'] },
  { name: 'Sugar', category: 'Pantry Staples', inStock: false, quantity: null, unit: null, notes: 'Ran out — buy white caster', images: [] },
  { name: 'Salt', category: 'Pantry Staples', inStock: true, quantity: 1, unit: 'box', notes: 'Murray River pink salt',
    images: ['https://images.unsplash.com/photo-1533038590840-1cde6e668a91?w=600&q=80'] },
  { name: 'Black Pepper', category: 'Pantry Staples', inStock: true, quantity: 1, unit: 'grinder', notes: null, images: [] },
  { name: 'Soy Sauce', category: 'Pantry Staples', inStock: true, quantity: 1, unit: 'bottle', notes: 'Kikkoman',
    images: ['https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=600&q=80'] },
  { name: 'Honey', category: 'Pantry Staples', inStock: true, quantity: 500, unit: 'g', notes: 'Raw manuka',
    images: ['https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=600&q=80'] },
  { name: 'Tinned Tomatoes', category: 'Pantry Staples', inStock: true, quantity: 3, unit: 'cans', notes: '400g each',
    images: ['https://images.unsplash.com/photo-1548247416-ec66f4900b2e?w=600&q=80'] },
  { name: 'Coconut Milk', category: 'Pantry Staples', inStock: false, quantity: null, unit: null, notes: null, images: [] },
  { name: 'Chicken Stock', category: 'Pantry Staples', inStock: true, quantity: 2, unit: 'cartons', notes: '1L each',
    images: ['https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600&q=80'] },
];

const SHOPPING_SEED: Array<{
  name: string; category: string; quantity: number | null; unit: string | null; note: string | null; images: string[];
}> = [
  // Produce (8 items)
  { name: 'Avocados', category: 'Produce', quantity: 3, unit: null, note: 'Hass, ripe',
    images: ['https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&q=80', 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80', 'https://images.unsplash.com/photo-1519162808019-7de1683fa2ad?w=600&q=80'] },
  { name: 'Cherry Tomatoes', category: 'Produce', quantity: 1, unit: 'punnet', note: null,
    images: ['https://images.unsplash.com/photo-1558818498-28c1e002b655?w=600&q=80', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&q=80'] },
  { name: 'Garlic', category: 'Produce', quantity: 1, unit: 'bulb', note: null,
    images: ['https://images.unsplash.com/photo-1544105779-c1a56a536c1f?w=600&q=80', 'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=600&q=80', 'https://images.unsplash.com/photo-1501200291289-c5a76c232e5f?w=600&q=80'] },
  { name: 'Lemons', category: 'Produce', quantity: 4, unit: null, note: 'For the roast chicken',
    images: ['https://images.unsplash.com/photo-1587486913049-53fc88980cfc?w=600&q=80', 'https://images.unsplash.com/photo-1571566882372-1598d88abd90?w=600&q=80', 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=600&q=80'] },
  { name: 'Spinach', category: 'Produce', quantity: 1, unit: 'bag', note: 'Baby leaf for salads',
    images: ['https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=600&q=80', 'https://images.unsplash.com/photo-1535189043414-47a3c49a0bed?w=600&q=80', 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=80'] },
  { name: 'Brown Onions', category: 'Produce', quantity: 3, unit: null, note: null,
    images: ['https://images.unsplash.com/photo-1508747703725-719777637510?w=600&q=80', 'https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?w=600&q=80', 'https://images.unsplash.com/photo-1580208895613-9c89bd4ae7ae?w=600&q=80'] },
  { name: 'Sweet Potato', category: 'Produce', quantity: 2, unit: 'large', note: null,
    images: ['https://images.unsplash.com/photo-1596097557175-bc6f8fbb6a36?w=600&q=80', 'https://images.unsplash.com/photo-1627843240167-b1f9d28f732a?w=600&q=80', 'https://images.unsplash.com/photo-1562159278-1253a58da141?w=600&q=80'] },
  { name: 'Zucchini', category: 'Produce', quantity: 4, unit: null, note: null,
    images: ['https://images.unsplash.com/photo-1563565453-e5bc17a8a5c0?w=600&q=80', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=600&q=80', 'https://images.unsplash.com/photo-1596457395977-f9cac2f49048?w=600&q=80'] },

  // Dairy & Eggs (9 items)
  { name: 'Greek Yoghurt', category: 'Dairy & Eggs', quantity: 1, unit: 'tub', note: 'Full fat, 500g',
    images: ['https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80', 'https://images.unsplash.com/photo-1571212515416-fca7b2e61b12?w=600&q=80', 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=600&q=80'] },
  { name: 'Cheddar Cheese', category: 'Dairy & Eggs', quantity: 400, unit: 'g', note: 'Vintage',
    images: ['https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=600&q=80', 'https://images.unsplash.com/photo-1618428740699-d88e09fddfe0?w=600&q=80', 'https://images.unsplash.com/photo-1452195100486-9cc805987862?w=600&q=80'] },
  { name: 'Butter', category: 'Dairy & Eggs', quantity: 2, unit: 'blocks', note: 'Unsalted',
    images: ['https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=600&q=80', 'https://images.unsplash.com/photo-1550399105-c4db5fb85c18?w=600&q=80', 'https://images.unsplash.com/photo-1603048588665-a06b9c5f7c92?w=600&q=80'] },
  { name: 'Cream', category: 'Dairy & Eggs', quantity: 600, unit: 'ml', note: 'Thickened',
    images: ['https://images.unsplash.com/photo-1587657566038-cdbc1e3e7ade?w=600&q=80', 'https://images.unsplash.com/photo-1559181567-c3190bbbbd7b?w=600&q=80', 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&q=80'] },
  { name: 'Eggs', category: 'Dairy & Eggs', quantity: 1, unit: 'dozen', note: 'Free range',
    images: ['https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=600&q=80', 'https://images.unsplash.com/photo-1607690424560-35d967d6ad7b?w=600&q=80', 'https://images.unsplash.com/photo-1506484381205-f7945653044d?w=600&q=80'] },
  { name: 'Parmesan', category: 'Dairy & Eggs', quantity: 200, unit: 'g', note: 'Block, not grated',
    images: ['https://images.unsplash.com/photo-1447338073979-b2b2b77e0f29?w=600&q=80', 'https://images.unsplash.com/photo-1634487359989-3e90c9432133?w=600&q=80', 'https://images.unsplash.com/photo-1564894809611-1742fc40ed80?w=600&q=80'] },
  { name: 'Sour Cream', category: 'Dairy & Eggs', quantity: 200, unit: 'g', note: 'Light',
    images: ['https://images.unsplash.com/photo-1631893682905-59b0ca64edd3?w=600&q=80', 'https://images.unsplash.com/photo-1614236224990-4bf0a5dc2519?w=600&q=80'] },
  { name: 'Mozzarella', category: 'Dairy & Eggs', quantity: 200, unit: 'g', note: 'Fresh buffalo',
    images: ['https://images.unsplash.com/photo-1565600444102-a7fe05db8fe0?w=600&q=80', 'https://images.unsplash.com/photo-1534353341086-5b6082c75beb?w=600&q=80', 'https://images.unsplash.com/photo-1574087988627-bae5a7a93f5c?w=600&q=80'] },
  { name: 'Ricotta', category: 'Dairy & Eggs', quantity: 500, unit: 'g', note: 'For lasagna',
    images: ['https://images.unsplash.com/photo-1631193816258-28b44b21e78f?w=600&q=80', 'https://images.unsplash.com/photo-1609501676725-7186f734b669?w=600&q=80', 'https://images.unsplash.com/photo-1567983369643-4dd1a97b8126?w=600&q=80'] },

  // Meat & Seafood (9 items)
  { name: 'Chicken Thighs', category: 'Meat & Seafood', quantity: 1, unit: 'kg', note: 'Bone-in for the roast',
    images: ['https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?w=600&q=80', 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600&q=80', 'https://images.unsplash.com/photo-1614926857083-7be149266cda?w=600&q=80'] },
  { name: 'Salmon Fillets', category: 'Meat & Seafood', quantity: 4, unit: 'fillets', note: 'Skin on',
    images: ['https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80', 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=600&q=80', 'https://images.unsplash.com/photo-1574781330855-d0db8cc6a79c?w=600&q=80'] },
  { name: 'Beef Mince', category: 'Meat & Seafood', quantity: 500, unit: 'g', note: 'Lean',
    images: ['https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=600&q=80', 'https://images.unsplash.com/photo-1558030006-450675393462?w=600&q=80', 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=600&q=80'] },
  { name: 'Bacon', category: 'Meat & Seafood', quantity: 1, unit: 'pack', note: 'Middle rashers',
    images: ['https://images.unsplash.com/photo-1528607929212-2636ec44253e?w=600&q=80', 'https://images.unsplash.com/photo-1551615593-ef5fe247e8f7?w=600&q=80', 'https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=600&q=80'] },
  { name: 'Prawns', category: 'Meat & Seafood', quantity: 500, unit: 'g', note: 'Peeled and deveined',
    images: ['https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=600&q=80', 'https://images.unsplash.com/photo-1533477359781-0be811f8a498?w=600&q=80', 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=600&q=80'] },
  { name: 'Lamb Cutlets', category: 'Meat & Seafood', quantity: 8, unit: 'cutlets', note: null,
    images: ['https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=600&q=80', 'https://images.unsplash.com/photo-1599225745889-5697cb05e2cd?w=600&q=80', 'https://images.unsplash.com/photo-1544025162-d76538485353?w=600&q=80'] },
  { name: 'Pork Shoulder', category: 'Meat & Seafood', quantity: 1, unit: 'kg', note: 'For slow cook',
    images: ['https://images.unsplash.com/photo-1529042410759-befb1204b468?w=600&q=80', 'https://images.unsplash.com/photo-1544025162-d76538485353?w=600&q=80', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80'] },
  { name: 'Turkey Mince', category: 'Meat & Seafood', quantity: 500, unit: 'g', note: null,
    images: ['https://images.unsplash.com/photo-1574926054069-6aa8f7faf93c?w=600&q=80', 'https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?w=600&q=80'] },
  { name: 'Tuna (canned)', category: 'Meat & Seafood', quantity: 3, unit: 'cans', note: 'In spring water',
    images: ['https://images.unsplash.com/photo-1625943553852-781c6dd46faa?w=600&q=80', 'https://images.unsplash.com/photo-1535400255456-984e3eb3b9a0?w=600&q=80', 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&q=80'] },

  // Pantry (10 items)
  { name: 'Brown Rice', category: 'Pantry', quantity: 1, unit: 'bag', note: null,
    images: ['https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&q=80', 'https://images.unsplash.com/photo-1536304447766-da0ed4ce1b73?w=600&q=80', 'https://images.unsplash.com/photo-1516684669134-de6f7c473a2a?w=600&q=80'] },
  { name: 'Pasta', category: 'Pantry', quantity: 2, unit: 'packs', note: 'Penne or rigatoni',
    images: ['https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=600&q=80', 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&q=80', 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=600&q=80'] },
  { name: 'Tinned Tomatoes', category: 'Pantry', quantity: 4, unit: 'cans', note: '400g',
    images: ['https://images.unsplash.com/photo-1548247416-ec66f4900b2e?w=600&q=80', 'https://images.unsplash.com/photo-1546554137-f86b9593a222?w=600&q=80', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80'] },
  { name: 'Coconut Milk', category: 'Pantry', quantity: 2, unit: 'cans', note: 'Full fat',
    images: ['https://images.unsplash.com/photo-1559181567-c3190bbbbd7b?w=600&q=80', 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=600&q=80', 'https://images.unsplash.com/photo-1560707303-4e980ce876ad?w=600&q=80'] },
  { name: 'Chicken Stock', category: 'Pantry', quantity: 2, unit: 'cartons', note: '1L each',
    images: ['https://images.unsplash.com/photo-1547592166-23ac45744acd?w=600&q=80', 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80', 'https://images.unsplash.com/photo-1516684669134-de6f7c473a2a?w=600&q=80'] },
  { name: 'Soy Sauce', category: 'Pantry', quantity: 1, unit: 'bottle', note: 'Kikkoman',
    images: ['https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=600&q=80', 'https://images.unsplash.com/photo-1526470608268-f674ce90ebd4?w=600&q=80', 'https://images.unsplash.com/photo-1547592180-85f173990554?w=600&q=80'] },
  { name: 'Olive Oil', category: 'Pantry', quantity: 1, unit: 'bottle', note: 'Extra virgin',
    images: ['https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&q=80', 'https://images.unsplash.com/photo-1601560496309-e56c6f47116c?w=600&q=80', 'https://images.unsplash.com/photo-1559181567-c3190bbbbd7b?w=600&q=80'] },
  { name: 'Balsamic Vinegar', category: 'Pantry', quantity: 1, unit: 'bottle', note: 'Aged',
    images: ['https://images.unsplash.com/photo-1601560496309-e56c6f47116c?w=600&q=80', 'https://images.unsplash.com/photo-1526470608268-f674ce90ebd4?w=600&q=80'] },
  { name: 'Panko Breadcrumbs', category: 'Pantry', quantity: 1, unit: 'pack', note: null,
    images: ['https://images.unsplash.com/photo-1606914501449-5a96b6ce24ca?w=600&q=80', 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=600&q=80'] },
  { name: 'Dried Oregano', category: 'Pantry', quantity: 1, unit: 'jar', note: null,
    images: ['https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80', 'https://images.unsplash.com/photo-1533038590840-1cde6e668a91?w=600&q=80'] },
];

async function main() {
  const [targetUser] = await db.select({ id: user.id, name: user.name })
    .from(user).where(eq(user.email, EMAIL)).limit(1);
  if (!targetUser) { console.error(`User ${EMAIL} not found`); process.exit(1); }
  console.log('User:', targetUser.name, targetUser.id);

  const [hu] = await db.select({ householdId: householdUser.householdId })
    .from(householdUser).where(eq(householdUser.userId, targetUser.id)).limit(1);
  if (!hu) { console.error('User has no household'); process.exit(1); }
  const { householdId } = hu;

  // ── Pantry ──────────────────────────────────────────────────────────────────

  const [pantryRow] = await db.select({ id: pantry.id }).from(pantry)
    .where(eq(pantry.householdId, householdId)).limit(1);
  if (!pantryRow) { console.error('No pantry found'); process.exit(1); }
  const pantryId = pantryRow.id;

  const pantryCategories: Record<string, string> = {};
  for (const { category } of PANTRY_SEED) {
    if (pantryCategories[category]) continue;
    const [existing] = await db.select({ id: pantryCategory.id }).from(pantryCategory)
      .where(and(eq(pantryCategory.pantryId, pantryId), eq(pantryCategory.name, category))).limit(1);
    if (existing) {
      pantryCategories[category] = existing.id;
    } else {
      const [created] = await db.insert(pantryCategory).values({ pantryId, name: category }).returning();
      pantryCategories[category] = created.id;
      console.log(`Created pantry category: ${category}`);
    }
  }

  for (const seed of PANTRY_SEED) {
    const [existingIng] = await db.select({ id: ingredient.id }).from(ingredient)
      .where(eq(ingredient.name, seed.name)).limit(1);
    let ingredientId: string;
    if (existingIng) {
      ingredientId = existingIng.id;
    } else {
      const [created] = await db.insert(ingredient).values({ name: seed.name }).returning();
      ingredientId = created.id;
    }

    const [existingItem] = await db.select({ id: pantryItem.id }).from(pantryItem)
      .where(and(eq(pantryItem.pantryId, pantryId), eq(pantryItem.ingredientId, ingredientId))).limit(1);

    let itemId: string;
    if (existingItem) {
      await db.update(pantryItem).set({
        inStock: seed.inStock, quantity: seed.quantity, unit: seed.unit,
        notes: seed.notes, categoryId: pantryCategories[seed.category],
      }).where(eq(pantryItem.id, existingItem.id));
      itemId = existingItem.id;
    } else {
      const [created] = await db.insert(pantryItem).values({
        pantryId, ingredientId, inStock: seed.inStock, quantity: seed.quantity,
        unit: seed.unit, notes: seed.notes, categoryId: pantryCategories[seed.category],
      }).returning();
      itemId = created.id;
      console.log(`Added pantry: ${seed.name}`);
    }

    if (seed.images.length > 0) {
      await db.delete(pantryItemImage).where(eq(pantryItemImage.pantryItemId, itemId));
      for (let i = 0; i < seed.images.length; i++) {
        await db.insert(pantryItemImage).values({ pantryItemId: itemId, url: seed.images[i], sortOrder: i });
      }
    }
  }

  // ── Shopping List ────────────────────────────────────────────────────────────

  const [listRow] = await db.select({ id: shoppingList.id }).from(shoppingList)
    .where(eq(shoppingList.householdId, householdId)).limit(1);
  if (!listRow) { console.error('No shopping list found'); process.exit(1); }
  const listId = listRow.id;

  const shopCategories: Record<string, string> = {};
  for (const { category } of SHOPPING_SEED) {
    if (shopCategories[category]) continue;
    const [existing] = await db.select({ id: shoppingListCategory.id }).from(shoppingListCategory)
      .where(and(eq(shoppingListCategory.shoppingListId, listId), eq(shoppingListCategory.name, category))).limit(1);
    if (existing) {
      shopCategories[category] = existing.id;
    } else {
      const [created] = await db.insert(shoppingListCategory).values({ shoppingListId: listId, name: category }).returning();
      shopCategories[category] = created.id;
      console.log(`Created shopping category: ${category}`);
    }
  }

  for (let i = 0; i < SHOPPING_SEED.length; i++) {
    const seed = SHOPPING_SEED[i];
    const [existing] = await db.select({ id: shoppingListItem.id }).from(shoppingListItem)
      .where(and(eq(shoppingListItem.shoppingListId, listId), eq(shoppingListItem.name, seed.name))).limit(1);

    let itemId: string;
    if (existing) {
      await db.update(shoppingListItem).set({
        quantity: seed.quantity != null ? String(seed.quantity) : null,
        unit: seed.unit, note: seed.note, categoryId: shopCategories[seed.category],
      }).where(eq(shoppingListItem.id, existing.id));
      itemId = existing.id;
    } else {
      const [created] = await db.insert(shoppingListItem).values({
        shoppingListId: listId, name: seed.name, categoryId: shopCategories[seed.category],
        addedByUserId: targetUser.id, quantity: seed.quantity != null ? String(seed.quantity) : null,
        unit: seed.unit, note: seed.note, sortOrder: i,
      }).returning();
      itemId = created.id;
      console.log(`Added shopping: ${seed.name}`);
    }

    if (seed.images.length > 0) {
      await db.delete(shoppingListItemImage).where(eq(shoppingListItemImage.itemId, itemId));
      for (let j = 0; j < seed.images.length; j++) {
        await db.insert(shoppingListItemImage).values({ itemId, url: seed.images[j], sortOrder: j });
      }
    }
  }

  console.log('\nAll done.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
