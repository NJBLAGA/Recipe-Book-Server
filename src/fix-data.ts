import 'dotenv/config';
import { eq, ilike, inArray, and } from 'drizzle-orm';
import { db } from './db';
import { ingredient } from './schema/ingredient';
import { pantryItem } from './schema/pantry';
import { recipeIngredient } from './schema/recipe';
import { shoppingListItem } from './schema/shopping';
import { householdUser, household } from './schema/household';
import { user } from './schema/auth';
import { recipeCook } from './schema/recipe';

async function main() {
  // ── 1. Rename "ripe bananas" to "bananas" ────────────────────────────────────
  const [ripeBanana] = await db
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(ilike(ingredient.name, 'ripe banana%'))
    .limit(1);

  if (ripeBanana) {
    const [existingBanana] = await db
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(ilike(ingredient.name, 'banana'))
      .limit(1);

    if (existingBanana) {
      // Merge: re-point references then delete the duplicate
      await db.update(recipeIngredient).set({ ingredientId: existingBanana.id }).where(eq(recipeIngredient.ingredientId, ripeBanana.id));
      await db.update(pantryItem).set({ ingredientId: existingBanana.id }).where(eq(pantryItem.ingredientId, ripeBanana.id));
      await db.update(shoppingListItem).set({ ingredientId: existingBanana.id }).where(eq(shoppingListItem.ingredientId, ripeBanana.id));
      await db.delete(ingredient).where(eq(ingredient.id, ripeBanana.id));
      console.log('✓ Merged "ripe bananas" into existing "banana" ingredient');
    } else {
      await db.update(ingredient).set({ name: 'bananas' }).where(eq(ingredient.id, ripeBanana.id));
      console.log('✓ Renamed "ripe bananas" to "bananas"');
    }
  } else {
    console.log('— No "ripe bananas" ingredient found, skipping');
  }

  // ── 2. Clear cook history for Nathan's household ──────────────────────────────
  const [nathanUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(ilike(user.email, '%nathanblaga%'))
    .limit(1);

  if (nathanUser) {
    const householdRows = await db
      .select({ householdId: householdUser.householdId })
      .from(householdUser)
      .where(eq(householdUser.userId, nathanUser.id));

    const householdIds = householdRows.map((r) => r.householdId);
    if (householdIds.length > 0) {
      const members = await db
        .select({ userId: householdUser.userId })
        .from(householdUser)
        .where(inArray(householdUser.householdId, householdIds));

      const memberIds = members.map((m) => m.userId);
      if (memberIds.length > 0) {
        await db.delete(recipeCook).where(inArray(recipeCook.userId, memberIds));
        console.log(`✓ Cleared cook history for ${memberIds.length} household member(s)`);
      }
    }
  } else {
    console.log('— Nathan user not found, skipping cook history clear');
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
