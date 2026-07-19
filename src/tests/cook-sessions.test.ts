import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL = 'cooksessions@test.com';
let cookie: string;
let recipeId: string;
let sessionId: string;
let pantryItemId: string;

beforeAll(async () => {
  cookie = await signIn(EMAIL, 'Cook User');
  await createHousehold(cookie, 'Cook Household');

  // Create a recipe with one measurable ingredient
  const recipeRes = await request(app)
    .post('/api/recipe-book/recipes')
    .set('Cookie', cookie)
    .send({
      title: 'Test Soup',
      baseServings: 2,
      steps: ['Boil water', 'Add ingredients'],
      ingredients: [
        { name: 'water', quantity: 500, unit: 'ml', note: null, sortOrder: 0 },
      ],
    });
  recipeId = recipeRes.body.id;

  // Add that ingredient to the pantry
  const pantryRes = await request(app)
    .post('/api/pantry/items')
    .set('Cookie', cookie)
    .send({ name: 'water', inStock: true });
  pantryItemId = pantryRes.body.id;
});

afterAll(async () => {
  await deleteUser(EMAIL);
});

describe('Cook Sessions', () => {
  it('starts a new cook session', async () => {
    const res = await request(app)
      .post('/api/cook-sessions')
      .set('Cookie', cookie)
      .send({ recipeId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('IN_PROGRESS');
    sessionId = res.body.id;
    expect(res.body.resumed).toBeFalsy();
  });

  it('resuming returns the existing session with resumed: true', async () => {
    const res = await request(app)
      .post('/api/cook-sessions')
      .set('Cookie', cookie)
      .send({ recipeId });

    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
    expect(res.body.id).toBe(sessionId);
  });

  it('GET /active returns the current session', async () => {
    const res = await request(app)
      .get(`/api/cook-sessions/active?recipeId=${recipeId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sessionId);
  });

  it('saves pending changes mid-cook', async () => {
    const pendingChanges = {
      ticked: [],
      pantryChanges: [{ itemId: pantryItemId, inStock: false }],
      extraChanges: [],
    };

    const res = await request(app)
      .patch(`/api/cook-sessions/${sessionId}/pending-changes`)
      .set('Cookie', cookie)
      .send({ pendingChanges });

    expect(res.status).toBe(200);
  });

  it('rejects invalid pending changes shape', async () => {
    const res = await request(app)
      .patch(`/api/cook-sessions/${sessionId}/pending-changes`)
      .set('Cookie', cookie)
      .send({
        pendingChanges: {
          ticked: [],
          pantryChanges: [{ itemId: 'not-a-uuid', inStock: 'maybe' }],
          extraChanges: [],
        },
      });

    expect(res.status).toBe(400);
  });

  it('completes the session and applies pantry changes', async () => {
    const res = await request(app)
      .post(`/api/cook-sessions/${sessionId}/complete`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('COMPLETED');
    expect(res.body.lowStockItems).toBeDefined();

    // Water was marked out of stock, so it appears in lowStockItems
    expect(res.body.lowStockItems.length).toBe(1);
    expect(res.body.lowStockItems[0].name).toBe('water');
  });

  it('completed session appears in cook history', async () => {
    const res = await request(app)
      .get(`/api/cook-sessions?recipeId=${recipeId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].status).toBe('COMPLETED');
  });

  it('adds a note to a completed session', async () => {
    const res = await request(app)
      .patch(`/api/cook-sessions/${sessionId}/note`)
      .set('Cookie', cookie)
      .send({ note: 'Turned out great' });

    expect(res.status).toBe(200);
  });

  it('starts and cancels a second session', async () => {
    const startRes = await request(app)
      .post('/api/cook-sessions')
      .set('Cookie', cookie)
      .send({ recipeId });

    expect(startRes.status).toBe(201);
    const newSessionId = startRes.body.id;

    const cancelRes = await request(app)
      .post(`/api/cook-sessions/${newSessionId}/cancel`)
      .set('Cookie', cookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    // Cancelled sessions do not appear in history
    const historyRes = await request(app)
      .get(`/api/cook-sessions?recipeId=${recipeId}`)
      .set('Cookie', cookie);

    const cancelled = historyRes.body.find((s: any) => s.id === newSessionId);
    expect(cancelled).toBeUndefined();
  });
});
