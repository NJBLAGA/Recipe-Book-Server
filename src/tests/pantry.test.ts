import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL = 'pantry@test.com';
let cookie: string;
let categoryId: string;
let categoryId2: string;
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
    expect(res.body.name).toBe('Dairy');
    categoryId = res.body.id;
  });

  it('creates a second category', async () => {
    const res = await request(app)
      .post('/api/pantry/categories')
      .set('Cookie', cookie)
      .send({ name: 'Produce' });

    expect(res.status).toBe(201);
    categoryId2 = res.body.id;
  });

  it('rejects duplicate category name', async () => {
    const res = await request(app)
      .post('/api/pantry/categories')
      .set('Cookie', cookie)
      .send({ name: 'Dairy' });

    expect(res.status).toBe(409);
  });

  it('lists categories', async () => {
    const res = await request(app)
      .get('/api/pantry/categories')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('renames a category', async () => {
    const res = await request(app)
      .patch(`/api/pantry/categories/${categoryId2}`)
      .set('Cookie', cookie)
      .send({ name: 'Fresh Produce' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Fresh Produce');
  });

  it('returns 404 when renaming a non-existent category', async () => {
    const res = await request(app)
      .patch('/api/pantry/categories/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
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
      .send({ name: 'milk', categoryId });

    expect(res.status).toBe(409);
  });

  it('adds an item with quantity, unit, and notes', async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ name: 'chicken breast', categoryId, inStock: true, quantity: 2, unit: 'kg', notes: '500g packs' });

    expect(res.status).toBe(201);
    expect(res.body.notes).toBe('500g packs');
    expect(res.body.quantity).toBe(2);
    expect(res.body.unit).toBe('kg');
  });

  it('lists items with inStock and images', async () => {
    const res = await request(app)
      .get('/api/pantry/items')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(typeof res.body[0].inStock).toBe('boolean');
    expect(Array.isArray(res.body[0].images)).toBe(true);
  });

  it('filters items by categoryId', async () => {
    const res = await request(app)
      .get(`/api/pantry/items?categoryId=${categoryId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.every((i: any) => i.categoryId === categoryId)).toBe(true);
  });

  it('fetches a single item by id', async () => {
    const res = await request(app)
      .get(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(itemId);
    expect(res.body.ingredientName).toBe('milk');
    expect(Array.isArray(res.body.images)).toBe(true);
  });

  it('returns 404 for a non-existent item', async () => {
    const res = await request(app)
      .get('/api/pantry/items/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('marks an item out of stock', async () => {
    const res = await request(app)
      .patch(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ inStock: false });

    expect(res.status).toBe(200);
    expect(res.body.inStock).toBe(false);
  });

  it('updates notes and quantity on an item', async () => {
    const res = await request(app)
      .patch(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ notes: '2L carton', quantity: 1, unit: 'L', inStock: true });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('2L carton');
    expect(res.body.inStock).toBe(true);
  });

  it('moves an item to a different category', async () => {
    const res = await request(app)
      .patch(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ categoryId: categoryId2 });

    expect(res.status).toBe(200);
    expect(res.body.categoryId).toBe(categoryId2);
  });

  it('rejects moving item to a non-existent category', async () => {
    const res = await request(app)
      .patch(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ categoryId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(400);
  });

  it('deletes an item', async () => {
    const res = await request(app)
      .delete(`/api/pantry/items/${itemId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });

  it('returns 404 when deleting a non-existent item', async () => {
    const res = await request(app)
      .delete('/api/pantry/items/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });
});

describe('Pantry — Category deletion', () => {
  it('deletes a category (items move to Misc automatically)', async () => {
    const catRes = await request(app)
      .post('/api/pantry/categories')
      .set('Cookie', cookie)
      .send({ name: 'Temp Category' });
    const tempCatId = catRes.body.id;

    await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookie)
      .send({ name: 'butter', categoryId: tempCatId });

    const res = await request(app)
      .delete(`/api/pantry/categories/${tempCatId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });

  it('returns 404 when deleting a non-existent category', async () => {
    const res = await request(app)
      .delete('/api/pantry/categories/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });
});
