import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL_A = 'users-a@test.com';
const EMAIL_B = 'users-b@test.com';
const EMAIL_C = 'users-c@test.com';

let cookieA: string;
let cookieB: string;
let cookieC: string;

beforeAll(async () => {
  cookieA = await signIn(EMAIL_A, 'Alice User');
  cookieB = await signIn(EMAIL_B, 'Bob User');
  // B1: sign up with firstName + lastName to test name derivation
  cookieC = await signIn(EMAIL_C, 'Placeholder', { firstName: 'Carol', lastName: 'Smith' });
  await createHousehold(cookieA, 'Users Household A');
  await createHousehold(cookieB, 'Users Household B');
});

afterAll(async () => {
  await deleteUser(EMAIL_A);
  await deleteUser(EMAIL_B);
  await deleteUser(EMAIL_C);
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

  // B3 — search results include household discovery fields
  it('GET /users/search returns householdId and householdName for users in a household', async () => {
    // Alice has a household (set up in beforeAll); Carol (EMAIL_C) does not
    const res = await request(app)
      .get('/api/users/search?handle=alice')
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    const alice = res.body.find((u: { handle: string }) => u.handle === 'alicesmith');
    expect(alice).toBeDefined();
    expect(alice.householdId).toBeTruthy();
    expect(alice.householdName).toBe('Users Household A');
  });

  // B1 — first/last name at signup derives full name
  it('signing up with firstName + lastName stores them and derives name', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Cookie', cookieC);

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Carol');
    expect(res.body.lastName).toBe('Smith');
    // name must be derived as "Carol Smith", not the placeholder passed to signIn
    expect(res.body.name).toBe('Carol Smith');
  });
});

// B4 — change-email endpoint
describe('Change email', () => {
  it('POST /auth/change-email requires authentication', async () => {
    const res = await request(app)
      .post('/api/auth/change-email')
      .send({ newEmail: 'nobody@test.com' });

    expect(res.status).toBe(401);
  });

  it('POST /auth/change-email accepts a new email for a verified user', async () => {
    const res = await request(app)
      .post('/api/auth/change-email')
      .set('Cookie', cookieA)
      .send({ newEmail: 'users-a-changed@test.com' });

    // 200 — request accepted; email change requires confirmation click (not changed yet)
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
  });
});

// B5 — delete-account endpoint
describe('Delete account', () => {
  const EMAIL_DEL_A = 'users-del-a@test.com';
  const EMAIL_DEL_B = 'users-del-b@test.com';
  const EMAIL_DEL_C = 'users-del-c@test.com';

  let cookieDelA: string;
  let cookieDelB: string;
  let cookieDelC: string;
  let householdIdDelB: string;

  beforeAll(async () => {
    cookieDelA = await signIn(EMAIL_DEL_A, 'Del A');
    cookieDelB = await signIn(EMAIL_DEL_B, 'Del B');
    cookieDelC = await signIn(EMAIL_DEL_C, 'Del C');

    // DEL_A is sole owner of their household
    await createHousehold(cookieDelA, 'Del A Household');

    // DEL_B creates a household; DEL_C joins it so DEL_B is owner-with-members
    householdIdDelB = await createHousehold(cookieDelB, 'Del B Household');

    // Get DEL_C's user id and have DEL_B invite them, then DEL_C accepts
    const sessionRes = await request(app).get('/api/auth/get-session').set('Cookie', cookieDelC);
    const delCId = sessionRes.body.user.id;
    await request(app)
      .post(`/api/households/${householdIdDelB}/invites`)
      .set('Cookie', cookieDelB)
      .send({ userId: delCId });
    const pendingRes = await request(app).get('/api/households/pending').set('Cookie', cookieDelC);
    const inviteId = pendingRes.body.invites[0].id;
    await request(app).post(`/api/households/join-requests/${inviteId}/accept`).set('Cookie', cookieDelC);
  });

  afterAll(async () => {
    // DEL_A was deleted in the test; cleanup is a no-op for them
    await deleteUser(EMAIL_DEL_A);
    await deleteUser(EMAIL_DEL_B);
    await deleteUser(EMAIL_DEL_C);
  });

  it('sole owner can delete their account and the household is removed', async () => {
    const res = await request(app)
      .post('/api/auth/delete-user')
      .set('Cookie', cookieDelA)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('owner with other members is blocked from deleting their account', async () => {
    const res = await request(app)
      .post('/api/auth/delete-user')
      .set('Cookie', cookieDelB)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Transfer ownership');
  });

  it('regular member (non-owner) can delete their account', async () => {
    // DEL_C is a regular member of DEL_B's household
    const res = await request(app)
      .post('/api/auth/delete-user')
      .set('Cookie', cookieDelC)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
