import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL = 'pantry@test.com';
let cookie: string;
let categoryId: string;
let itemId: string;
let batchId: string;

beforeAll(async () => {
  cookie = await signIn(EMAIL, 'Pantry User');
  await createHousehold(cookie, 'Pantry Household');
});

afterAll(async () => {
  await deleteUser(EMAIL);
});

describe('Pantry — Categories', () => {
  it('creates a category', async () => {
    const res = await request(app)
      .post('/api/pantry/categories')
      .set('Cookie', cookie)
      .send({ name: 'Dairy' });

    expect(res.status).toBe(201);
    categoryId = res.body.id;
  });

  it('rejects duplicate category name', async () => {
    const res = await request(app)
      .post('/api/pantry/categories')
      .set('Cookie', cookie)
      .send({ name: 'Dairy' });

    expect(res.status).toBe(409);
  });
});

describe('Pantry — Items & Batches', () => {
  it('adds an ingredient to the pantry with an initial batch at 100%', async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ ingredientName: 'milk', categoryId, fillLevel: 100 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.batches[0].fillLevel).toBe(100);
    itemId = res.body.id;
    batchId = res.body.batches[0].id;
  });

  it('rejects adding the same ingredient twice', async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ ingredientName: 'milk', fillLevel: 75 });

    expect(res.status).toBe(409);
  });

  it('rejects an invalid fill level', async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ ingredientName: 'butter', fillLevel: 33 });

    expect(res.status).toBe(400);
  });

  it('lists items with effectiveStock', async () => {
    const res = await request(app)
      .get('/api/pantry/items')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].effectiveStock).toBe(100);
  });

  it('adds a second batch to an item', async () => {
    const res = await request(app)
      .post(`/api/pantry/items/${itemId}/batches`)
      .set('Cookie', cookie)
      .send({ fillLevel: 50 });

    expect(res.status).toBe(201);

    const listRes = await request(app)
      .get('/api/pantry/items')
      .set('Cookie', cookie);

    // effectiveStock = 100 + 50 = 150
    expect(listRes.body[0].effectiveStock).toBe(150);
  });

  it('updates a batch fill level', async () => {
    const res = await request(app)
      .patch(`/api/pantry/batches/${batchId}`)
      .set('Cookie', cookie)
      .send({ fillLevel: 25 });

    expect(res.status).toBe(200);
    expect(res.body.fillLevel).toBe(25);
  });

  it('blocks deleting the last batch — delete the item instead', async () => {
    // Get the second batch
    const itemRes = await request(app)
      .get(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie);

    const batches = itemRes.body.batches;
    expect(batches.length).toBe(2);

    // Delete one — should succeed
    const secondBatchId = batches.find((b: any) => b.id !== batchId).id;
    const del1 = await request(app)
      .delete(`/api/pantry/batches/${secondBatchId}`)
      .set('Cookie', cookie);
    expect(del1.status).toBe(200);

    // Delete the last — should be blocked
    const del2 = await request(app)
      .delete(`/api/pantry/batches/${batchId}`)
      .set('Cookie', cookie);
    expect(del2.status).toBe(400);
  });

  it('deletes an item', async () => {
    const res = await request(app)
      .delete(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});
