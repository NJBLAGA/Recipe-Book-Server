import 'dotenv/config';
import { isNull, eq, and } from 'drizzle-orm';
import { db } from './db/index';
import { recipeBook, recipeCategory, recipe } from './schema/recipe';

async function fix() {
  const books = await db.select({ id: recipeBook.id }).from(recipeBook);
  let totalFixed = 0;

  for (const book of books) {
    const uncategorised = await db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(eq(recipe.recipeBookId, book.id), isNull(recipe.categoryId)));

    if (uncategorised.length === 0) {
      console.log(`Book ${book.id}: all recipes categorised — skipping.`);
      continue;
    }

    // Use the first existing category, or create "General" if none exist
    const [existingCat] = await db
      .select({ id: recipeCategory.id, name: recipeCategory.name })
      .from(recipeCategory)
      .where(eq(recipeCategory.recipeBookId, book.id))
      .limit(1);

    let targetCatId: string;
    if (existingCat) {
      targetCatId = existingCat.id;
      console.log(`Book ${book.id}: assigning ${uncategorised.length} recipe(s) to existing category "${existingCat.name}" (${targetCatId})`);
    } else {
      const [newCat] = await db
        .insert(recipeCategory)
        .values({ recipeBookId: book.id, name: 'General' })
        .returning({ id: recipeCategory.id });
      targetCatId = newCat.id;
      console.log(`Book ${book.id}: created "General" category, assigning ${uncategorised.length} recipe(s)`);
    }

    for (const r of uncategorised) {
      await db.update(recipe).set({ categoryId: targetCatId }).where(eq(recipe.id, r.id));
    }

    totalFixed += uncategorised.length;
  }

  console.log(`\nDone — fixed ${totalFixed} uncategorised recipe(s) across ${books.length} book(s).`);
  process.exit(0);
}

fix().catch((err) => {
  console.error(err);
  process.exit(1);
});
