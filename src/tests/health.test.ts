import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';

describe('Health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('unauthenticated request to protected route returns 401', async () => {
    const res = await request(app).get('/api/recipe-book/recipes');
    expect(res.status).toBe(401);
  });
});
