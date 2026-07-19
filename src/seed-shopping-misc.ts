import 'dotenv/config';
import { db } from './db';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { pantry, pantryItem, pantryCategory } from './schema/pantry';
import { shoppingList, shoppingListCategory, shoppingListItem } from './schema/shopping';
import { eq, ilike, and } from 'drizzle-orm';

async function main() {
  // Find Nathan
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(ilike(user.name, '%nathan%'));
  if (!users.length) { console.error('No user matching "nathan" found'); process.exit(1); }
  const u = users[0];
  console.log('Found user:', u.name, u.id);

  // Find household
  const hus = await db.select({ householdId: householdUser.householdId }).from(householdUser).where(eq(householdUser.userId, u.id));
  if (!hus.length) { console.error('User has no household'); process.exit(1); }
  const householdId = hus[0].householdId;

  // ─── Pantry: create Misc category and assign all but 5 items ─────────────────

  const pantries = await db.select({ id: pantry.id }).from(pantry).where(eq(pantry.householdId, householdId));
  if (!pantries.length) { console.error('No pantry found'); process.exit(1); }
  const pantryId = pantries[0].id;

  // Find or create Misc pantry category
  let [miscCat] = await db
    .select({ id: pantryCategory.id })
    .from(pantryCategory)
    .where(and(eq(pantryCategory.pantryId, pantryId), eq(pantryCategory.name, 'Misc')));

  if (!miscCat) {
    const [created] = await db.insert(pantryCategory).values({ pantryId, name: 'Misc' }).returning();
    miscCat = created;
    console.log('Created Misc pantry category:', miscCat.id);
  } else {
    console.log('Misc pantry category already exists:', miscCat.id);
  }

  // Get all pantry items without a category
  const uncategorised = await db
    .select({ id: pantryItem.id })
    .from(pantryItem)
    .where(and(eq(pantryItem.pantryId, pantryId)));

  // Keep 5 without a category, assign the rest to Misc
  const toAssign = uncategorised.filter((item) => true).slice(5);
  let assignedCount = 0;
  for (const item of toAssign) {
    await db.update(pantryItem).set({ categoryId: miscCat.id }).where(eq(pantryItem.id, item.id));
    assignedCount++;
  }
  console.log(`Assigned ${assignedCount} pantry items to Misc (kept ${Math.min(5, uncategorised.length)} uncategorised)`);

  // ─── Shopping list: seed categories and items ─────────────────────────────────

  const lists = await db.select({ id: shoppingList.id }).from(shoppingList).where(eq(shoppingList.householdId, householdId));
  if (!lists.length) { console.error('No shopping list found'); process.exit(1); }
  const listId = lists[0].id;

  const categoryNames = ['Produce', 'Dairy & Eggs', 'Meat & Seafood', 'Pantry', 'Misc'];
  const categoryMap: Record<string, string> = {};

  for (const name of categoryNames) {
    const [existing] = await db
      .select({ id: shoppingListCategory.id })
      .from(shoppingListCategory)
      .where(and(eq(shoppingListCategory.shoppingListId, listId), eq(shoppingListCategory.name, name)));

    if (existing) {
      categoryMap[name] = existing.id;
      console.log(`Category already exists: ${name}`);
    } else {
      const [created] = await db
        .insert(shoppingListCategory)
        .values({ shoppingListId: listId, name })
        .returning();
      categoryMap[name] = created.id;
      console.log(`Created category: ${name}`);
    }
  }

  const seedItems = [
    { name: 'Bananas', category: 'Produce', quantity: 6, unit: null },
    { name: 'Spinach', category: 'Produce', quantity: 1, unit: 'bag' },
    { name: 'Avocados', category: 'Produce', quantity: 3, unit: null },
    { name: 'Milk', category: 'Dairy & Eggs', quantity: 2, unit: 'L' },
    { name: 'Eggs', category: 'Dairy & Eggs', quantity: 12, unit: null },
    { name: 'Greek yoghurt', category: 'Dairy & Eggs', quantity: 1, unit: 'tub' },
    { name: 'Chicken breast', category: 'Meat & Seafood', quantity: 500, unit: 'g' },
    { name: 'Salmon fillets', category: 'Meat & Seafood', quantity: 2, unit: null },
    { name: 'Olive oil', category: 'Pantry', quantity: 1, unit: 'bottle' },
    { name: 'Brown rice', category: 'Pantry', quantity: 1, unit: 'bag' },
    { name: 'Washing powder', category: 'Misc', quantity: 1, unit: 'box' },
    { name: 'Dishwasher tablets', category: 'Misc', quantity: 1, unit: 'pack' },
  ];

  // Check existing items to avoid full duplicates
  const existingItems = await db
    .select({ name: shoppingListItem.name })
    .from(shoppingListItem)
    .where(eq(shoppingListItem.shoppingListId, listId));
  const existingNames = new Set(existingItems.map((i) => i.name.toLowerCase()));

  let addedItems = 0;
  for (let i = 0; i < seedItems.length; i++) {
    const { name, category, quantity, unit } = seedItems[i];
    if (existingNames.has(name.toLowerCase())) {
      console.log(`  Skip (exists): ${name}`);
      continue;
    }
    await db.insert(shoppingListItem).values({
      shoppingListId: listId,
      name,
      categoryId: categoryMap[category],
      addedByUserId: u.id,
      quantity: quantity != null ? String(quantity) : null,
      unit,
      sortOrder: i,
    });
    console.log(`  Added: ${name} → ${category}`);
    addedItems++;
  }

  console.log(`\nDone — added ${addedItems} shopping list items`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
