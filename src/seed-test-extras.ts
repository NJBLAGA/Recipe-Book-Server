import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { householdUser, household } from './schema/household';
import { recipeBook, recipe, recipeImage } from './schema/recipe';
import { recipeShare, review } from './schema/social';

const TEST_EMAIL = 'test@gmail.com';
const REVIEWER_EMAIL = 'nathanblaga90@gmail.com';

const TEST_BIO =
  'Home cook and food lover. Obsessed with finding the perfect weeknight dinner. Always experimenting in the kitchen — one disaster at a time.';

const IMAGES: Record<string, string> = {
  'Spaghetti Bolognese':
    'https://images.unsplash.com/photo-1551892374-ecf8754cf8b0?w=400&q=80',
  'Chicken Tikka Masala':
    'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&q=80',
  'Banana Bread':
    'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400&q=80',
  'Classic Caesar Salad':
    'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80',
  'Beef Tacos':
    'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&q=80',
};

const REVIEWS: Record<string, { rating: number; comment: string }> = {
  'Spaghetti Bolognese': {
    rating: 5,
    comment:
      'Absolutely delicious! The sauce is so rich and flavourful. This is now a staple in our house.',
  },
  'Chicken Tikka Masala': {
    rating: 4,
    comment:
      'Restaurant quality! The marinade makes such a difference to the chicken. Will make again.',
  },
  'Banana Bread': {
    rating: 5,
    comment:
      "Best banana bread I've ever made. So moist and the perfect level of sweetness.",
  },
  'Classic Caesar Salad': {
    rating: 3,
    comment:
      'Good flavours but the dressing was a touch too salty for me. Would reduce the anchovy next time.',
  },
  'Beef Tacos': {
    rating: 4,
    comment:
      'Quick, easy and packed with flavour. Perfect for a busy weeknight. Definitely making again.',
  },
};

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

  // 1. Update bio
  await db.update(user).set({ bio: TEST_BIO }).where(eq(user.id, testUser.id));
  console.log('Updated bio for testuser.');

  // 2. Find recipe book
  const [hu] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, testUser.id))
    .limit(1);

  if (!hu) {
    console.error('Testuser has no household. Run seed-test-recipes.ts first.');
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
    .select()
    .from(recipe)
    .where(eq(recipe.recipeBookId, book.id));

  // 3. Add images (replace any existing for these recipes)
  for (const r of recipes) {
    const url = IMAGES[r.title];
    if (!url) continue;

    const existing = await db
      .select()
      .from(recipeImage)
      .where(eq(recipeImage.recipeId, r.id))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(recipeImage)
        .set({ url, sortOrder: 0 })
        .where(eq(recipeImage.recipeId, r.id));
      console.log(`Updated image for: ${r.title}`);
    } else {
      await db.insert(recipeImage).values({ recipeId: r.id, url, sortOrder: 0 });
      console.log(`Added image for: ${r.title}`);
    }
  }

  // 4. Add reviews — need a reviewer user (not testuser)
  const [reviewer] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, REVIEWER_EMAIL))
    .limit(1);

  if (!reviewer) {
    console.log(
      `Reviewer user (${REVIEWER_EMAIL}) not found — skipping reviews.`,
    );
    console.log('Done!');
    process.exit(0);
  }

  for (const r of recipes) {
    const reviewData = REVIEWS[r.title];
    if (!reviewData) continue;

    // Upsert share
    const existingShare = await db
      .select({ id: recipeShare.id })
      .from(recipeShare)
      .where(
        and(
          eq(recipeShare.recipeId, r.id),
          eq(recipeShare.fromUserId, testUser.id),
          eq(recipeShare.toUserId, reviewer.id),
        ),
      )
      .limit(1);

    let shareId: string;
    if (existingShare.length > 0) {
      shareId = existingShare[0].id;
    } else {
      const [share] = await db
        .insert(recipeShare)
        .values({
          recipeId: r.id,
          fromUserId: testUser.id,
          toUserId: reviewer.id,
          status: 'ACCEPTED',
        })
        .returning();
      shareId = share.id;
      console.log(`Created share for: ${r.title}`);
    }

    // Upsert review
    const existingReview = await db
      .select({ id: review.id })
      .from(review)
      .where(eq(review.shareId, shareId))
      .limit(1);

    if (existingReview.length > 0) {
      await db
        .update(review)
        .set({ rating: reviewData.rating, comment: reviewData.comment })
        .where(eq(review.shareId, shareId));
      console.log(`Updated review (${reviewData.rating}★) for: ${r.title}`);
    } else {
      await db.insert(review).values({
        shareId,
        rating: reviewData.rating,
        comment: reviewData.comment,
      });
      console.log(`Added review (${reviewData.rating}★) for: ${r.title}`);
    }
  }

  console.log('Done!');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
