import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { signIn, createHousehold, deleteUser } from './helpers';
import { db } from '../db';
import { notification } from '../schema/social';
import { eq } from 'drizzle-orm';
import { user } from '../schema/auth';

const EMAIL_A = 'notifications-a@test.com';
const EMAIL_B = 'notifications-b@test.com';

let cookieA: string;
let cookieB: string;
let notifId: string;

beforeAll(async () => {
  cookieA = await signIn(EMAIL_A, 'Notif Alice');
  cookieB = await signIn(EMAIL_B, 'Notif Bob');
  await createHousehold(cookieA, 'Notif Household A');
  await createHousehold(cookieB, 'Notif Household B');

  // Seed a notification for Alice directly so we can test the read flows
  const [alice] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL_A)).limit(1);
  const [notif] = await db.insert(notification).values({
    userId: alice.id,
    type: 'JOIN_REQUEST',
    payload: { message: 'test notification' },
  }).returning();
  notifId = notif.id;
});

afterAll(async () => {
  await deleteUser(EMAIL_A);
  await deleteUser(EMAIL_B);
});

describe('Notifications', () => {
  it('lists all notifications', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('returns unread count', async () => {
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('marks a single notification as read', async () => {
    const res = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.readAt).not.toBeNull();
  });

  it('unread count drops after marking read', async () => {
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', cookieA);

    expect(res.body.count).toBe(0);
  });

  it('filters to unread only', async () => {
    // Seed another unread notification
    const [alice] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL_A)).limit(1);
    await db.insert(notification).values({
      userId: alice.id,
      type: 'JOIN_REQUEST',
      payload: { message: 'second notification' },
    });

    const res = await request(app)
      .get('/api/notifications?unread=true')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].readAt).toBeNull();
  });

  it('marks all notifications as read', async () => {
    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Cookie', cookieA);

    expect(res.status).toBe(200);

    const countRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Cookie', cookieA);

    expect(countRes.body.count).toBe(0);
  });

  it('cannot access another user\'s notification', async () => {
    const res = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set('Cookie', cookieB);

    expect(res.status).toBe(404);
  });
});
