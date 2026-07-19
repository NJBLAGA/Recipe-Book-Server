import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL = 'pantry@test.com';
let cookie: string;
let categoryId: string;
let itemId: string;

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

describe('Pantry — Items', () => {
  it('adds an ingredient to the pantry as in-stock', async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ name: 'milk', categoryId, inStock: true });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.inStock).toBe(true);
    itemId = res.body.id;
  });

  it('rejects adding the same ingredient twice', async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ name: 'milk' });

    expect(res.status).toBe(409);
  });

  it('adds an item with a quantityNote', async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ name: 'chicken breast', inStock: true, quantityNote: '500g pack' });

    expect(res.status).toBe(201);
    expect(res.body.quantityNote).toBe('500g pack');
  });

  it('lists items with inStock and images', async () => {
    const res = await request(app)
      .get('/api/pantry/items')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(typeof res.body[0].inStock).toBe('boolean');
    expect(Array.isArray(res.body[0].images)).toBe(true);
  });

  it('marks an item out of stock', async () => {
    const res = await request(app)
      .patch(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ inStock: false });

    expect(res.status).toBe(200);
    expect(res.body.inStock).toBe(false);
  });

  it('updates quantityNote on an item', async () => {
    const res = await request(app)
      .patch(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ quantityNote: '2L carton', inStock: true });

    expect(res.status).toBe(200);
    expect(res.body.quantityNote).toBe('2L carton');
    expect(res.body.inStock).toBe(true);
  });

  it('deletes an item', async () => {
    const res = await request(app)
      .delete(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});
