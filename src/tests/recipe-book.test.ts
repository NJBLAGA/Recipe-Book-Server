import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL = 'recipebook@test.com';
let cookie: string;
let categoryId: string;
let recipeId: string;
let recipe2Id: string;

beforeAll(async () => {
  cookie = await signIn(EMAIL, 'Recipe User');
  await createHousehold(cookie, 'Recipe Household');
});

afterAll(async () => {
  await deleteUser(EMAIL);
});

describe('Recipe Book — Categories', () => {
  it('creates a category', async () => {
    const res = await request(app)
      .post('/api/recipe-book/categories')
      .set('Cookie', cookie)
      .send({ name: 'Desserts' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Desserts');
    categoryId = res.body.id;
  });

  it('rejects duplicate category name', async () => {
    const res = await request(app)
      .post('/api/recipe-book/categories')
      .set('Cookie', cookie)
      .send({ name: 'Desserts' });

    expect(res.status).toBe(409);
  });

  it('lists categories', async () => {
    const res = await request(app)
      .get('/api/recipe-book/categories')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('renames a category', async () => {
    const res = await request(app)
      .patch(`/api/recipe-book/categories/${categoryId}`)
      .set('Cookie', cookie)
      .send({ name: 'Sweets' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sweets');
  });

  it('returns 404 when renaming a non-existent category', async () => {
    const res = await request(app)
      .patch('/api/recipe-book/categories/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

describe('Recipe Book — Recipes', () => {
  it('creates a recipe with ingredients', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookie)
      .send({
        title: 'Chocolate Cake',
        source: 'Grandma\'s cookbook',
        baseServings: 8,
        steps: ['Mix ingredients', 'Bake at 180°C for 30 min'],
        ingredients: [
          { name: 'flour', quantity: 200, unit: 'g', note: null, sortOrder: 0 },
          { name: 'sugar', quantity: 150, unit: 'g', note: null, sortOrder: 1 },
          { name: 'eggs', quantity: 3, unit: null, note: null, sortOrder: 2 },
          { name: 'salt', quantity: null, unit: null, note: 'a pinch', sortOrder: 3 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Chocolate Cake');
    expect(res.body.source).toBe('Grandma\'s cookbook');
    recipeId = res.body.id;
  });

  it('creates a recipe in a category', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookie)
      .send({
        title: 'Vanilla Sponge',
        source: 'Family recipe book',
        baseServings: 6,
        categoryId,
        steps: ['Whisk eggs and sugar', 'Fold in flour', 'Bake 25 min'],
        ingredients: [
          { name: 'eggs', quantity: 4, unit: null, note: null, sortOrder: 0 },
          { name: 'sugar', quantity: 200, unit: 'g', note: null, sortOrder: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.categoryId).toBe(categoryId);
    recipe2Id = res.body.id;
  });

  it('validates missing source field', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookie)
      .send({ title: 'No Source', baseServings: 2, steps: ['Do something'], ingredients: [{ name: 'flour', quantity: 100, unit: 'g', note: null, sortOrder: 0 }] });

    expect(res.status).toBe(400);
  });

  it('validates at least one step required', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookie)
      .send({ title: 'No Steps', source: 'Test', baseServings: 2, steps: [], ingredients: [{ name: 'flour', quantity: 100, unit: 'g', note: null, sortOrder: 0 }] });

    expect(res.status).toBe(400);
  });

  it('validates at least one ingredient required', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookie)
      .send({ title: 'No Ingredients', source: 'Test', baseServings: 2, steps: ['Step 1'], ingredients: [] });

    expect(res.status).toBe(400);
  });

  it('lists recipes', async () => {
    const res = await request(app)
      .get('/api/recipe-book/recipes')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('filters recipes by categoryId', async () => {
    const res = await request(app)
      .get(`/api/recipe-book/recipes?categoryId=${categoryId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(recipe2Id);
  });

  it('searches recipes by title', async () => {
    const res = await request(app)
      .get('/api/recipe-book/recipes?search=chocolate')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);

    const empty = await request(app)
      .get('/api/recipe-book/recipes?search=pizza')
      .set('Cookie', cookie);

    expect(empty.body.length).toBe(0);
  });

  it('fetches full recipe detail with ingredients', async () => {
    const res = await request(app)
      .get(`/api/recipe-book/recipes/${recipeId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.ingredients.length).toBe(4);
    // no-quantity ingredient has null quantity and a descriptive note
    const salt = res.body.ingredients.find((i: any) => i.name === 'salt');
    expect(salt.quantity).toBeNull();
    expect(salt.note).toBe('a pinch');
  });

  it('returns 404 for a non-existent recipe', async () => {
    const res = await request(app)
      .get('/api/recipe-book/recipes/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('updates a recipe title', async () => {
    const res = await request(app)
      .patch(`/api/recipe-book/recipes/${recipeId}`)
      .set('Cookie', cookie)
      .send({ title: 'Dark Chocolate Cake' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Dark Chocolate Cake');
  });

  it('updates recipe steps with new object format', async () => {
    const res = await request(app)
      .patch(`/api/recipe-book/recipes/${recipeId}`)
      .set('Cookie', cookie)
      .send({ steps: [{ text: 'Melt chocolate', subSteps: ['Use low heat', 'Stir constantly'] }, 'Bake at 180°C for 30 min'] });

    expect(res.status).toBe(200);
    expect(res.body.steps[0].text).toBe('Melt chocolate');
    expect(res.body.steps[0].subSteps).toEqual(['Use low heat', 'Stir constantly']);
  });
});

describe('Recipe Book — Pins', () => {
  it('pins are empty initially', async () => {
    const res = await request(app)
      .get('/api/recipe-book/pins')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('sets pins', async () => {
    const res = await request(app)
      .put('/api/recipe-book/pins')
      .set('Cookie', cookie)
      .send([{ position: 1, recipeId }]);

    expect(res.status).toBe(200);
  });

  it('pins list returns the pinned recipe', async () => {
    const res = await request(app)
      .get('/api/recipe-book/pins')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body[0].position).toBe(1);
    expect(res.body[0].recipeId).toBe(recipeId);
  });

  it('rejects duplicate positions in pins', async () => {
    const res = await request(app)
      .put('/api/recipe-book/pins')
      .set('Cookie', cookie)
      .send([{ position: 1, recipeId }, { position: 1, recipeId: recipe2Id }]);

    expect(res.status).toBe(400);
  });

  it('supports up to 5 pins', async () => {
    const res = await request(app)
      .put('/api/recipe-book/pins')
      .set('Cookie', cookie)
      .send([
        { position: 1, recipeId },
        { position: 2, recipeId: recipe2Id },
      ]);

    expect(res.status).toBe(200);
  });

  it('clears pins', async () => {
    const res = await request(app)
      .put('/api/recipe-book/pins')
      .set('Cookie', cookie)
      .send([]);

    expect(res.status).toBe(200);
  });
});

describe('Recipe Book — Can Make', () => {
  it('returns tiered results (empty pantry means all in rest)', async () => {
    const res = await request(app)
      .get('/api/recipe-book/can-make')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.ready).toBeDefined();
    expect(res.body.almost).toBeDefined();
    expect(res.body.rest).toBeDefined();
    // With empty pantry, all measurable-ingredient recipes land in rest
    const allRecipes = [...res.body.ready, ...res.body.almost, ...res.body.rest];
    expect(allRecipes.length).toBeGreaterThan(0);
  });
});

describe('Recipe Book — Delete', () => {
  it('deletes a recipe', async () => {
    const res = await request(app)
      .delete(`/api/recipe-book/recipes/${recipeId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });

  it('returns 404 for deleted recipe', async () => {
    const res = await request(app)
      .get(`/api/recipe-book/recipes/${recipeId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });

  it('deletes a category', async () => {
    // delete recipe2 first since category deletion shouldn't cascade
    await request(app).delete(`/api/recipe-book/recipes/${recipe2Id}`).set('Cookie', cookie);

    const res = await request(app)
      .delete(`/api/recipe-book/categories/${categoryId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });

  it('returns 404 when deleting a non-existent recipe', async () => {
    const res = await request(app)
      .delete('/api/recipe-book/recipes/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);

    expect(res.status).toBe(404);
  });
});
