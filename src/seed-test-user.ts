import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { auth } from './lib/auth';

const EMAIL = 'test@gmail.com';
const PASSWORD = 'test-123';
const FIRST = 'Test';
const LAST = 'User';

async function seed() {
  // Check if already exists
  const existing = await db.select().from(user).where(eq(user.email, EMAIL)).limit(1);

  if (existing.length > 0) {
    // Already exists — just ensure emailVerified is true
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, EMAIL));
    console.log('Test user already exists — emailVerified set to true.');
    process.exit(0);
  }

  // Create via better-auth internal API so the password is hashed correctly
  const res = await auth.api.signUpEmail({
    body: {
      email: EMAIL,
      password: PASSWORD,
      name: `${FIRST} ${LAST}`,
      firstName: FIRST,
      lastName: LAST,
    },
  });

  if (!res) {
    console.error('Sign-up returned null — check auth config.');
    process.exit(1);
  }

  // Flip emailVerified and set handle so the account is usable immediately
  await db.update(user).set({ emailVerified: true, handle: 'testuser' }).where(eq(user.email, EMAIL));

  console.log(`Test user created: ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
