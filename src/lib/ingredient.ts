import { eq } from 'drizzle-orm';
import { ingredient } from '../schema/ingredient';

export async function findOrCreateIngredient(tx: any, name: string): Promise<string> {
  const normalized = name.trim().toLowerCase();

  const [created] = await tx
    .insert(ingredient)
    .values({ name: normalized })
    .onConflictDoNothing()
    .returning({ id: ingredient.id });

  if (created) return created.id;

  const [existing] = await tx
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.name, normalized))
    .limit(1);

  if (!existing) throw new Error(`Ingredient '${normalized}' not found after insert conflict`);
  return existing.id;
}
