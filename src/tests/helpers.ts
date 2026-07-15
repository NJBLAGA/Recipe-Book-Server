import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../app';
import { db } from '../db';
import { user } from '../schema/auth';

const PASSWORD = 'TestPassword123!';

/**
 * Signs up a new user, bypasses email verification directly in the DB,
 * then signs in and returns the session cookie for use in subsequent requests.
 */
export async function signIn(email: string, name = 'Test User'): Promise<string> {
  await request(app).post('/api/auth/sign-up/email').send({ email, password: PASSWORD, name });

  // Email verification is required in auth config — bypass it in tests by
  // directly marking the user as verified in the DB.
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));

  const res = await request(app).post('/api/auth/sign-in/email').send({ email, password: PASSWORD });

  const raw = res.headers['set-cookie'] as string | string[];
  return Array.isArray(raw) ? raw.join('; ') : raw ?? '';
}

/**
 * Creates a household for the given user and returns its id.
 */
export async function createHousehold(cookie: string, name = 'Test Household'): Promise<string> {
  const res = await request(app)
    .post('/api/households')
    .set('Cookie', cookie)
    .send({ name });
  return res.body.id;
}

/**
 * Deletes a user by email — cascades to household, recipe book, pantry, shopping list, etc.
 */
export async function deleteUser(email: string): Promise<void> {
  await db.delete(user).where(eq(user.email, email));
}
