import 'dotenv/config';
import { randomUUID } from 'crypto';
import { db } from './db';
import { user, account } from './schema/auth';
import { hashPassword } from '@better-auth/utils/password';
import { eq } from 'drizzle-orm';

async function main() {
  const email = 'demo1@gmail.com';
  const password = 'test-123';
  const firstName = 'Demo';
  const lastName = 'User';

  // Clean up any existing user with this email first
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing) {
    console.log('User already exists, deleting and recreating...');
    await db.delete(user).where(eq(user.id, existing.id));
  }

  const userId = randomUUID();
  const hashed = await hashPassword(password);

  await db.insert(user).values({
    id: userId,
    name: `${firstName} ${lastName}`,
    email,
    emailVerified: true,
    firstName,
    lastName,
    isDemoUser: false,
    isPublic: true,
    onboardingComplete: false,
  });

  await db.insert(account).values({
    id: randomUUID(),
    userId,
    accountId: userId,
    providerId: 'credential',
    password: hashed,
  });

  console.log(`\nTest user created:`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(`  User ID:  ${userId}`);
  console.log(`\nThis user has no household — you will see the onboarding page first.`);

  process.exit(0);
}

main().catch(e => { console.error('Failed:', e.message); process.exit(1); });
