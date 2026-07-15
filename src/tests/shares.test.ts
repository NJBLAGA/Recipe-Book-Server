import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

const EMAIL_A = 'shares-a@test.com';
const EMAIL_B = 'shares-b@test.com';

let cookieA: string;
let cookieB: string;
let userBId: string;
let recipeId: string;
let shareId: string;
let copiedRecipeId: string;

beforeAll(async () => {
  cookieA = await signIn(EMAIL_A, 'Shares Alice');
  cookieB = await signIn(EMAIL_B, 'Shares Bob');
  await createHousehold(cookieA, 'Shares Household A');
  await createHousehold(cookieB, 'Shares Household B');

  // Get Bob's user id
  const session = await request(app).get('/api/auth/get-session').set('Cookie', cookieB);
  userBId = session.body.user.id;

  // Alice creates a recipe to share
  const recipeRes = await request(app)
    .post('/api/recipe-book/recipes')
    .set('Cookie', cookieA)
    .send({
      title: 'Shareable Pasta',
      baseServings: 4,
      steps: ['Boil pasta', 'Add sauce'],
      ingredients: [
        { name: 'pasta', quantity: 300, unit: 'g', note: null, sortOrder: 0 },
      ],
    });
  recipeId = recipeRes.body.id;
});

afterAll(async () => {
  await deleteUser(EMAIL_A);
  await deleteUser(EMAIL_B);
});

describe('Shares', () => {
  it('Alice shares a recipe with Bob', async () => {
    const res = await request(app)
      .post('/api/shares')
      .set('Cookie', cookieA)
      .send({ recipeId, toUserId: userBId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    shareId = res.body.id;
  });

  it('cannot share the same recipe with the same person again (still pending)', async () => {
    const res = await request(app)
      .post('/api/shares')
      .set('Cookie', cookieA)
      .send({ recipeId, toUserId: userBId });

    expect(res.status).toBe(409);
  });

  it('cannot share with yourself', async () => {
    const sessionA = await request(app).get('/api/auth/get-session').set('Cookie', cookieA);
    const userAId = sessionA.body.user.id;

    const res = await request(app)
      .post('/api/shares')
      .set('Cookie', cookieA)
      .send({ recipeId, toUserId: userAId });

    expect(res.status).toBe(400);
  });

  it('Bob sees the share in received list', async () => {
    const res = await request(app)
      .get('/api/shares/received')
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].status).toBe('PENDING');
  });

  it('Alice sees it in sent list', async () => {
    const res = await request(app)
      .get('/api/shares/sent')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('Bob accepts the share — a copy lands in his recipe book', async () => {
    const res = await request(app)
      .post(`/api/shares/${shareId}/accept`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');
    expect(res.body.copiedRecipeId).toBeTruthy();
    copiedRecipeId = res.body.copiedRecipeId;
  });

  it("Bob's recipe book now contains the copied recipe", async () => {
    const res = await request(app)
      .get(`/api/recipe-book/recipes/${copiedRecipeId}`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Shareable Pasta');
    expect(res.body.sharedByUserId).toBeTruthy();
    expect(res.body.originalRecipeId).toBe(recipeId);
  });
});

describe('Reviews', () => {
  it('Bob leaves a review on the share', async () => {
    const res = await request(app)
      .post(`/api/shares/${shareId}/review`)
      .set('Cookie', cookieB)
      .send({ rating: 5, comment: 'Really good pasta recipe' });

    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(5);
  });

  it('cannot leave a second review (409)', async () => {
    const res = await request(app)
      .post(`/api/shares/${shareId}/review`)
      .set('Cookie', cookieB)
      .send({ rating: 3 });

    expect(res.status).toBe(409);
  });

  it('can update the review', async () => {
    const res = await request(app)
      .patch(`/api/shares/${shareId}/review`)
      .set('Cookie', cookieB)
      .send({ rating: 4, comment: 'Updated — still a solid recipe' });

    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(4);
  });

  it('fetches the review', async () => {
    const res = await request(app)
      .get(`/api/shares/${shareId}/review`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.comment).toBe('Updated — still a solid recipe');
  });
});

describe('Recopy', () => {
  it('Bob deletes his copy', async () => {
    const res = await request(app)
      .delete(`/api/recipe-book/recipes/${copiedRecipeId}`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
  });

  it('Bob can re-copy from the original via share history', async () => {
    const res = await request(app)
      .post(`/api/shares/${shareId}/recopy`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.copiedRecipeId).toBeTruthy();
  });
});

describe('Follows', () => {
  it('Alice follows Bob', async () => {
    const res = await request(app)
      .post('/api/follows')
      .set('Cookie', cookieA)
      .send({ followingId: userBId });

    expect(res.status).toBe(201);
  });

  it('cannot follow the same person twice', async () => {
    const res = await request(app)
      .post('/api/follows')
      .set('Cookie', cookieA)
      .send({ followingId: userBId });

    expect(res.status).toBe(409);
  });

  it("Alice's following list includes Bob", async () => {
    const res = await request(app)
      .get('/api/follows/following')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.some((u: any) => u.id === userBId)).toBe(true);
  });

  it("Bob's followers list includes Alice", async () => {
    const res = await request(app)
      .get('/api/follows/followers')
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('Alice unfollows Bob', async () => {
    const res = await request(app)
      .delete(`/api/follows/${userBId}`)
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
  });
});
