import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL = 'shoppinglist@test.com';
let cookie: string;
let categoryId: string;
let category2Id: string;
let itemId: string;
let item2Id: string;

beforeAll(async () => {
  cookie = await signIn(EMAIL, 'Shopping User');
  await createHousehold(cookie, 'Shopping Household');
});

afterAll(async () => {
  await deleteUser(EMAIL);
});

describe('Shopping List — Categories', () => {
  it('creates a category', async () => {
    const res = await request(app)
      .post('/api/shopping-list/categories')
      .set('Cookie', cookie)
      .send({ name: 'Produce' });

    expect(res.status).toBe(201);
    categoryId = res.body.id;
  });

  it('creates a second category', async () => {
    const res = await request(app)
      .post('/api/shopping-list/categories')
      .set('Cookie', cookie)
      .send({ name: 'Dairy' });

    expect(res.status).toBe(201);
    category2Id = res.body.id;
  });

  it('rejects duplicate category name', async () => {
    const res = await request(app)
      .post('/api/shopping-list/categories')
      .set('Cookie', cookie)
      .send({ name: 'Produce' });

    expect(res.status).toBe(409);
  });

  it('lists categories', async () => {
    const res = await request(app)
      .get('/api/shopping-list/categories')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('renames a category', async () => {
    const res = await request(app)
      .patch(`/api/shopping-list/categories/${category2Id}`)
      .set('Cookie', cookie)
      .send({ name: 'Fridge' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Fridge');
  });

  it('returns 404 when renaming a non-existent category', async () => {
    const res = await request(app)
      .patch('/api/shopping-list/categories/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

describe('Shopping List — Items', () => {
  it('adds an item to a category', async () => {
    const res = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookie)
      .send({ name: 'Apples', categoryId, quantity: 6, unit: 'pcs', source: 'DIRECT' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Apples');
    itemId = res.body.id;
  });

  it('adds a second item to the same category', async () => {
    const res = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookie)
      .send({ name: 'Bananas', categoryId, quantity: 3, unit: 'pcs', source: 'DIRECT' });

    expect(res.status).toBe(201);
    item2Id = res.body.id;
  });

  it('adds an item with a note', async () => {
    const res = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookie)
      .send({ name: 'Milk', categoryId: category2Id, quantity: 2, unit: 'L', note: 'Full fat', source: 'DIRECT' });

    expect(res.status).toBe(201);
    expect(res.body.note).toBe('Full fat');
  });

  it('lists all items with images array', async () => {
    const res = await request(app)
      .get('/api/shopping-list/items')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body[0].isChecked).toBe(false);
    expect(Array.isArray(res.body[0].images)).toBe(true);
  });

  it('filters items by categoryId', async () => {
    const res = await request(app)
      .get(`/api/shopping-list/items?categoryId=${categoryId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.every((i: any) => i.categoryId === categoryId)).toBe(true);
  });

  it('filters items by isChecked=false', async () => {
    const res = await request(app)
      .get('/api/shopping-list/items?isChecked=false')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.every((i: any) => i.isChecked === false)).toBe(true);
  });

  it('marks an item as checked', async () => {
    const res = await request(app)
      .patch(`/api/shopping-list/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ isChecked: true });

    expect(res.status).toBe(200);
    expect(res.body.isChecked).toBe(true);
  });

  it('filters items by isChecked=true returns only checked items', async () => {
    const res = await request(app)
      .get('/api/shopping-list/items?isChecked=true')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((i: any) => i.isChecked === true)).toBe(true);
  });

  it('updates item name and note', async () => {
    const res = await request(app)
      .patch(`/api/shopping-list/items/${item2Id}`)
      .set('Cookie', cookie)
      .send({ name: 'Ripe Bananas', note: 'Check ripeness' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ripe Bananas');
    expect(res.body.note).toBe('Check ripeness');
  });

  it('moves an item up in sort order', async () => {
    const res = await request(app)
      .patch(`/api/shopping-list/items/${item2Id}/move`)
      .set('Cookie', cookie)
      .send({ direction: 'up' });

    // Either 'Moved' or 'Already at boundary' is valid since item2 may already be first
    expect(res.status).toBe(200);
  });

  it('moves an item down in sort order', async () => {
    const res = await request(app)
      .patch(`/api/shopping-list/items/${item2Id}/move`)
      .set('Cookie', cookie)
      .send({ direction: 'down' });

    expect(res.status).toBe(200);
  });

  it('returns 404 when patching a non-existent item', async () => {
    const res = await request(app)
      .patch('/api/shopping-list/items/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie)
      .send({ isChecked: true });

    expect(res.status).toBe(404);
  });

  it('deletes a single item by id', async () => {
    const addRes = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookie)
      .send({ name: 'Temporary Item', categoryId, source: 'DIRECT' });
    const tmpId = addRes.body.id;

    const res = await request(app)
      .delete(`/api/shopping-list/items/${tmpId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    // Confirm it's gone
    const listRes = await request(app)
      .get('/api/shopping-list/items')
      .set('Cookie', cookie);
    expect(listRes.body.every((i: any) => i.id !== tmpId)).toBe(true);
  });

  it('returns 404 when deleting a non-existent item', async () => {
    const res = await request(app)
      .delete('/api/shopping-list/items/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('clears all checked items', async () => {
    const res = await request(app)
      .delete('/api/shopping-list/items/checked')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    const listRes = await request(app)
      .get('/api/shopping-list/items?isChecked=true')
      .set('Cookie', cookie);

    expect(listRes.body.length).toBe(0);
  });
});

describe('Shopping List — Category deletion', () => {
  it('deleting a category without targetCategoryId moves items to Misc', async () => {
    // Add an item to category2 first
    const addRes = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookie)
      .send({ name: 'Cheese', categoryId: category2Id, source: 'DIRECT' });
    expect(addRes.status).toBe(201);

    const res = await request(app)
      .delete(`/api/shopping-list/categories/${category2Id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    // The Misc category should now exist (auto-created by the route)
    const categories = await request(app)
      .get('/api/shopping-list/categories')
      .set('Cookie', cookie);
    const misc = categories.body.find((c: any) => c.name === 'Misc');
    expect(misc).toBeDefined();
  });

  it('returns 404 when deleting a non-existent category', async () => {
    const res = await request(app)
      .delete('/api/shopping-list/categories/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('deletes the produce category', async () => {
    const res = await request(app)
      .delete(`/api/shopping-list/categories/${categoryId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});
