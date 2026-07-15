import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, deleteUser } from './helpers';

const EMAIL_A = 'households-a@test.com';
const EMAIL_B = 'households-b@test.com';

let cookieA: string;
let cookieB: string;
let householdId: string;

beforeAll(async () => {
  cookieA = await signIn(EMAIL_A, 'Alice');
  cookieB = await signIn(EMAIL_B, 'Bob');
});

afterAll(async () => {
  await deleteUser(EMAIL_A);
  await deleteUser(EMAIL_B);
});

describe('Households', () => {
  it('creates a household', async () => {
    const res = await request(app)
      .post('/api/households')
      .set('Cookie', cookieA)
      .send({ name: 'Alice Household' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Alice Household');
    householdId = res.body.id;
  });

  it('cannot create a second household while already in one', async () => {
    const res = await request(app)
      .post('/api/households')
      .set('Cookie', cookieA)
      .send({ name: 'Another Household' });

    expect(res.status).toBe(409);
  });

  it('GET /households/mine returns the household and role', async () => {
    const res = await request(app)
      .get('/api/households/mine')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(householdId);
    expect(res.body.role).toBe('OWNER');
  });

  it('owner can invite another user', async () => {
    const meRes = await request(app).get('/api/auth/get-session').set('Cookie', cookieB);
    const bobId = meRes.body.user.id;

    const res = await request(app)
      .post(`/api/households/${householdId}/invites`)
      .set('Cookie', cookieA)
      .send({ userId: bobId });

    expect(res.status).toBe(201);
  });

  it('invited user can see the pending invite', async () => {
    const res = await request(app)
      .get('/api/households/pending')
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.invites.length).toBeGreaterThan(0);
  });

  it('invited user can accept the invite and join the household', async () => {
    const pendingRes = await request(app)
      .get('/api/households/pending')
      .set('Cookie', cookieB);

    const inviteId = pendingRes.body.invites[0].id;

    const res = await request(app)
      .post(`/api/households/join-requests/${inviteId}/accept`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
  });

  it('household now has two members', async () => {
    const res = await request(app)
      .get(`/api/households/${householdId}/members`)
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('owner must transfer ownership before leaving when other members exist', async () => {
    const res = await request(app)
      .post(`/api/households/${householdId}/leave`)
      .set('Cookie', cookieA);

    expect(res.status).toBe(400);
  });

  it('owner can transfer ownership to a member', async () => {
    const meRes = await request(app).get('/api/auth/get-session').set('Cookie', cookieB);
    const bobId = meRes.body.user.id;

    const res = await request(app)
      .post(`/api/households/${householdId}/transfer-ownership`)
      .set('Cookie', cookieA)
      .send({ userId: bobId });

    expect(res.status).toBe(200);
  });

  it('previous owner can now leave', async () => {
    const res = await request(app)
      .post(`/api/households/${householdId}/leave`)
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
  });

  it('last member leaving deletes the household', async () => {
    const pendingRes = await request(app)
      .get('/api/households/mine')
      .set('Cookie', cookieB);

    const hId = pendingRes.body.id;

    const res = await request(app)
      .post(`/api/households/${hId}/leave`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);

    const mineRes = await request(app)
      .get('/api/households/mine')
      .set('Cookie', cookieB);

    expect(mineRes.status).toBe(404);
  });
});
