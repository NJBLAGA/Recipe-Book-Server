import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL_A = 'users-a@test.com';
const EMAIL_B = 'users-b@test.com';

let cookieA: string;
let cookieB: string;

beforeAll(async () => {
  cookieA = await signIn(EMAIL_A, 'Alice User');
  cookieB = await signIn(EMAIL_B, 'Bob User');
  await createHousehold(cookieA, 'Users Household A');
  await createHousehold(cookieB, 'Users Household B');
});

afterAll(async () => {
  await deleteUser(EMAIL_A);
  await deleteUser(EMAIL_B);
});

describe('Users', () => {
  it('GET /users/me returns the current user profile', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(EMAIL_A);
  });

  it('PATCH /users/me updates profile fields', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookieA)
      .send({ firstName: 'Alice', lastName: 'Smith', bio: 'I love cooking' });

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Alice');
    expect(res.body.lastName).toBe('Smith');
    expect(res.body.bio).toBe('I love cooking');
  });

  it('sets a handle', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookieA)
      .send({ handle: 'alicesmith' });

    expect(res.status).toBe(200);
    expect(res.body.handle).toBe('alicesmith');
  });

  it('rejects a duplicate handle', async () => {
    // Bob tries to claim Alice's handle
    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookieB)
      .send({ handle: 'alicesmith' });

    expect(res.status).toBe(409);
  });

  it('rejects an invalid handle (spaces)', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookieA)
      .send({ handle: 'alice smith' });

    expect(res.status).toBe(400);
  });

  it('updates theme preference', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Cookie', cookieA)
      .send({ theme: 'dark' });

    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('dark');
  });

  it('GET /users/:handle returns a public profile', async () => {
    const res = await request(app)
      .get('/api/users/alicesmith')
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.handle).toBe('alicesmith');
    expect(res.body.pins).toBeDefined();
    // Email must not be exposed on the public profile
    expect(res.body.email).toBeUndefined();
  });

  it('GET /users/:handle returns 404 for unknown handle', async () => {
    const res = await request(app)
      .get('/api/users/doesnotexist99')
      .set('Cookie', cookieA);

    expect(res.status).toBe(404);
  });

  it('GET /users/search finds user by partial handle', async () => {
    const res = await request(app)
      .get('/api/users/search?handle=alice')
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].handle).toBe('alicesmith');
  });
});
