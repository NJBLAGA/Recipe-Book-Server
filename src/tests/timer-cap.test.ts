import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';

// Isolated file — only the timer cap test runs here so the Neon pool
// is not under pressure from the preceding queries that live in security.test.ts.

const EMAIL = 'timer-cap@test.com';
let cookie: string;

beforeAll(async () => {
  cookie = await signIn(EMAIL, 'TimerCap');
  await createHousehold(cookie, 'Timer Household');
});

afterAll(async () => {
  await deleteUser(EMAIL);
});

describe('Push timers — cap at 20 pending', () => {
  it('allows up to 20 pending timers then rejects the 21st', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post('/api/push/timers')
        .set('Cookie', cookie)
        .send({ label: `Timer ${i + 1}`, duration: 86400 });
      expect(res.status).toBe(201);
    }

    const overLimit = await request(app)
      .post('/api/push/timers')
      .set('Cookie', cookie)
      .send({ label: 'One too many', duration: 86400 });
    expect(overLimit.status).toBe(429);
  }, 60_000);
});
