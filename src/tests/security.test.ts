import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

// ─── Test users ───────────────────────────────────────────────────────────────
// A + B — cross-household isolation
// C     — content moderation + shopping-list validation + SSRF (has household)
// E     — invite-while-in-household (starts with NO household)

const EMAIL_A = 'sec-a@test.com';
const EMAIL_B = 'sec-b@test.com';
const EMAIL_C = 'sec-c@test.com';
const EMAIL_E = 'sec-e@test.com';

let cookieA: string;
let cookieB: string;
let cookieC: string;
let cookieE: string;

let householdIdA: string;
let recipeIdA: string;
let categoryIdB: string;
let pantryCategoryIdB: string;
let slCategoryIdB: string;
let modRecipeId: string;

beforeAll(async () => {
  [cookieA, cookieB, cookieC, cookieE] = await Promise.all([
    signIn(EMAIL_A, 'SecA'),
    signIn(EMAIL_B, 'SecB'),
    signIn(EMAIL_C, 'SecC'),
    signIn(EMAIL_E, 'SecE'),
  ]);

  // E intentionally has no household — used in the invite-while-in-household test
  await Promise.all([
    createHousehold(cookieA, 'Household A'),
    createHousehold(cookieB, 'Household B'),
    createHousehold(cookieC, 'Household C'),
  ]);

  // Fetch A's household ID
  const mineA = await request(app).get('/api/households/mine').set('Cookie', cookieA);
  householdIdA = mineA.body.id;

  // A's recipe — used in cross-household isolation tests
  const rRes = await request(app)
    .post('/api/recipe-book/recipes')
    .set('Cookie', cookieA)
    .send({
      title: "A's Private Recipe",
      source: 'Security test',
      baseServings: 2,
      steps: ['Step 1'],
      ingredients: [{ name: 'flour', quantity: 100, unit: 'g', note: null, sortOrder: 0 }],
    });
  recipeIdA = rRes.body.id;

  // B's categories — used to test cross-household categoryId rejection
  const [rCat, pCat, slCat] = await Promise.all([
    request(app).post('/api/recipe-book/categories').set('Cookie', cookieB).send({ name: 'B Recipe Cat' }),
    request(app).post('/api/pantry/categories').set('Cookie', cookieB).send({ name: 'B Pantry Cat' }),
    request(app).post('/api/shopping-list/categories').set('Cookie', cookieB).send({ name: 'B SL Cat' }),
  ]);
  categoryIdB = rCat.body.id;
  pantryCategoryIdB = pCat.body.id;
  slCategoryIdB = slCat.body.id;

  // C's recipe — used in PATCH moderation tests
  const modRes = await request(app)
    .post('/api/recipe-book/recipes')
    .set('Cookie', cookieC)
    .send({
      title: 'Clean Recipe',
      source: 'Security test',
      baseServings: 2,
      steps: ['Mix well'],
      ingredients: [{ name: 'butter', quantity: 50, unit: 'g', note: null, sortOrder: 0 }],
    });
  modRecipeId = modRes.body.id;
});

afterAll(async () => {
  await Promise.all([
    deleteUser(EMAIL_A),
    deleteUser(EMAIL_B),
    deleteUser(EMAIL_C),
    deleteUser(EMAIL_E),
  ]);
});

// ─── Unauthenticated access ────────────────────────────────────────────────────

describe('Auth — unauthenticated requests return 401', () => {
  it('GET /api/users/me', async () => {
    expect((await request(app).get('/api/users/me')).status).toBe(401);
  });

  it('GET /api/recipe-book/recipes', async () => {
    expect((await request(app).get('/api/recipe-book/recipes')).status).toBe(401);
  });

  it('GET /api/pantry/items', async () => {
    expect((await request(app).get('/api/pantry/items')).status).toBe(401);
  });

  it('GET /api/shopping-list/items', async () => {
    expect((await request(app).get('/api/shopping-list/items')).status).toBe(401);
  });

  it('POST /api/households', async () => {
    expect((await request(app).post('/api/households').send({ name: 'x' })).status).toBe(401);
  });

  it('GET /api/cook-sessions', async () => {
    expect((await request(app).get('/api/cook-sessions')).status).toBe(401);
  });

  it('GET /api/shares/received', async () => {
    expect((await request(app).get('/api/shares/received')).status).toBe(401);
  });
});

// ─── Cross-household isolation ─────────────────────────────────────────────────

describe('Cross-household isolation', () => {
  it("user B cannot see user A's recipe in the list", async () => {
    const res = await request(app).get('/api/recipe-book/recipes').set('Cookie', cookieB);
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.id)).not.toContain(recipeIdA);
  });

  it("user B cannot fetch user A's recipe by ID", async () => {
    const res = await request(app)
      .get(`/api/recipe-book/recipes/${recipeIdA}`)
      .set('Cookie', cookieB);
    expect(res.status).toBe(404);
  });

  it("user B cannot delete user A's recipe", async () => {
    const res = await request(app)
      .delete(`/api/recipe-book/recipes/${recipeIdA}`)
      .set('Cookie', cookieB);
    expect(res.status).toBe(404);
  });

  it("user B cannot update user A's recipe", async () => {
    const res = await request(app)
      .patch(`/api/recipe-book/recipes/${recipeIdA}`)
      .set('Cookie', cookieB)
      .send({ title: 'Stolen Recipe' });
    expect(res.status).toBe(404);
  });

  it("rejects recipe creation with another household's categoryId", async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookieA)
      .send({
        title: 'Cross Cat Recipe',
        source: 'Security test',
        baseServings: 2,
        steps: ['Step 1'],
        categoryId: categoryIdB,
        ingredients: [{ name: 'sugar', quantity: 50, unit: 'g', note: null, sortOrder: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it("rejects pantry item creation with another household's categoryId", async () => {
    const res = await request(app)
      .post('/api/pantry/items')
      .set('Cookie', cookieA)
      .send({ name: 'eggs', categoryId: pantryCategoryIdB });
    expect(res.status).toBe(400);
  });

  it("rejects shopping list item creation with another household's categoryId", async () => {
    const res = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookieA)
      .send({ name: 'milk', categoryId: slCategoryIdB });
    expect(res.status).toBe(400);
  });
});

// ─── Content moderation — recipe POST ─────────────────────────────────────────

describe('Content moderation — recipe POST', () => {
  const validBase = {
    source: 'Moderation test',
    baseServings: 2,
    steps: ['Mix well'],
    ingredients: [{ name: 'flour', quantity: 100, unit: 'g', note: null, sortOrder: 0 }],
  };

  it('rejects inappropriate title', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookieC)
      .send({ ...validBase, title: 'fucking great cake' });
    expect(res.status).toBe(400);
  });

  it('rejects inappropriate ingredient name', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookieC)
      .send({
        ...validBase,
        title: 'Good Cake',
        ingredients: [{ name: 'shit flavouring', quantity: 1, unit: 'tsp', note: null, sortOrder: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects inappropriate ingredient note', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookieC)
      .send({
        ...validBase,
        title: 'Good Cake',
        ingredients: [{ name: 'flour', quantity: null, unit: null, note: 'a fucking pinch', sortOrder: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects inappropriate step text', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookieC)
      .send({ ...validBase, title: 'Good Cake', steps: ['Mix the shit together'] });
    expect(res.status).toBe(400);
  });

  it('does not block legitimate food words (shiitake, canal)', async () => {
    const res = await request(app)
      .post('/api/recipe-book/recipes')
      .set('Cookie', cookieC)
      .send({
        ...validBase,
        title: 'Shiitake Stir Fry',
        steps: ['Sauté shiitake mushrooms', 'Drain the canal water'],
        ingredients: [{ name: 'shiitake mushrooms', quantity: 100, unit: 'g', note: 'stems removed', sortOrder: 0 }],
      });
    expect(res.status).toBe(201);
    if (res.body.id) await request(app).delete(`/api/recipe-book/recipes/${res.body.id}`).set('Cookie', cookieC);
  });
});

// ─── Content moderation — recipe PATCH ────────────────────────────────────────

describe('Content moderation — recipe PATCH', () => {
  it('rejects inappropriate title on update', async () => {
    const res = await request(app)
      .patch(`/api/recipe-book/recipes/${modRecipeId}`)
      .set('Cookie', cookieC)
      .send({ title: 'porn recipe' });
    expect(res.status).toBe(400);
  });

  it('rejects inappropriate ingredient name on update', async () => {
    const res = await request(app)
      .patch(`/api/recipe-book/recipes/${modRecipeId}`)
      .set('Cookie', cookieC)
      .send({
        ingredients: [{ name: 'cunt', quantity: 1, unit: 'tbsp', note: null, sortOrder: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects inappropriate step on update', async () => {
    const res = await request(app)
      .patch(`/api/recipe-book/recipes/${modRecipeId}`)
      .set('Cookie', cookieC)
      .send({ steps: ['Whisk until fuck'] });
    expect(res.status).toBe(400);
  });

  it('recipe is unchanged after all rejected updates', async () => {
    const res = await request(app)
      .get(`/api/recipe-book/recipes/${modRecipeId}`)
      .set('Cookie', cookieC);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Clean Recipe');
  });
});

// ─── Shopping list — ingredientId validation ───────────────────────────────────

describe('Shopping list — non-existent ingredientId returns 400', () => {
  it('rejects a non-existent ingredientId UUID', async () => {
    const res = await request(app)
      .post('/api/shopping-list/items')
      .set('Cookie', cookieC)
      .send({ name: 'mystery item', ingredientId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });
});

// ─── SSRF / URL content checks ─────────────────────────────────────────────────

describe('Import URL — SSRF protection', () => {
  it('blocks localhost', async () => {
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'http://localhost/recipe' });
    expect(res.status).toBe(400);
  });

  it('blocks 127.0.0.1', async () => {
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'http://127.0.0.1/recipe' });
    expect(res.status).toBe(400);
  });

  it('blocks private IP range 192.168.x.x', async () => {
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'http://192.168.1.1/recipe' });
    expect(res.status).toBe(400);
  });

  it('blocks private IP range 10.x.x.x', async () => {
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'http://10.0.0.1/secret' });
    expect(res.status).toBe(400);
  });

  it('blocks AWS metadata endpoint 169.254.169.254', async () => {
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(res.status).toBe(400);
  });

  it('blocks non-http/https protocols', async () => {
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
  });
});

describe('Import URL — inappropriate content in URL string', () => {
  it('rejects a URL containing a blocked term in the path', async () => {
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'https://example.com/porn-recipes' });
    expect(res.status).toBe(422);
  });

  it('rejects a percent-encoded blocked term in the URL', async () => {
    // %66uck decodes to "fuck" — verify the decode-before-check logic catches it
    const res = await request(app)
      .post('/api/recipe-book/import-url')
      .set('Cookie', cookieA)
      .send({ url: 'https://example.com/%66uck-recipes' });
    expect(res.status).toBe(422);
  });
});


// ─── Accept invite while already in a household ───────────────────────────────

describe('Households — accept invite while already in a household', () => {
  it('returns 409 if the invitee joined a household after the invite was created', async () => {
    // Get E's user ID
    const eSession = await request(app).get('/api/auth/get-session').set('Cookie', cookieE);
    const eUserId = eSession.body.user.id;

    // A invites E — valid because E has no household yet
    const inviteRes = await request(app)
      .post(`/api/households/${householdIdA}/invites`)
      .set('Cookie', cookieA)
      .send({ userId: eUserId });
    expect(inviteRes.status).toBe(201);
    const inviteId = inviteRes.body.id;

    // E creates their own household — now E is in a household
    await createHousehold(cookieE, "E's Household");

    // E tries to accept A's invite — should be rejected
    const acceptRes = await request(app)
      .post(`/api/households/join-requests/${inviteId}/accept`)
      .set('Cookie', cookieE);
    expect(acceptRes.status).toBe(409);
  });
});
