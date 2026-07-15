import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL = 'shoppinglist@test.com';
let cookie: string;
let categoryId: string;
let itemId: string;

beforeAll(async () => {
  cookie = await signIn(EMAIL, 'Shopping User');
  await createHousehold(cookie, 'Shopping Household');
});

afterAll(async () => {
  await deleteUser(EMAIL);
});

describe('Shopping List', () => {
  it('creates a category', async () => {
    const res = await request(app)
      .post('/api/shopping-list/categories')
      .set('Cookie', cookie)
      .send({ name: 'Produce' });

    expect(res.status).toBe(201);
    categoryId = res.body.id;
  });

  it('adds an item', async () => {
    const res = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookie)
      .send({ name: 'Apples', categoryId, quantity: 6, unit: 'pcs', source: 'DIRECT' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Apples');
    itemId = res.body.id;
  });

  it('lists items', async () => {
    const res = await request(app)
      .get('/api/shopping-list/items')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].isChecked).toBe(false);
  });

  it('marks an item as checked', async () => {
    const res = await request(app)
      .patch(`/api/shopping-list/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ isChecked: true });

    expect(res.status).toBe(200);
    expect(res.body.isChecked).toBe(true);
  });

  it('clears all checked items', async () => {
    const res = await request(app)
      .delete('/api/shopping-list/items/checked')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);

    const listRes = await request(app)
      .get('/api/shopping-list/items')
      .set('Cookie', cookie);

    expect(listRes.body.length).toBe(0);
  });

  it('deletes a category', async () => {
    const res = await request(app)
      .delete(`/api/shopping-list/categories/${categoryId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });
});
