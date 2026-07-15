import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { pushSubscription, pushTimer } from '../schema/push';
import { requireAuth } from '../middleware/requireAuth';
import { scheduleTimer, cancelTimer } from '../lib/timer-scheduler';

const router = Router();
router.use(requireAuth);

// GET /api/push/vapid-public-key — frontend needs this to create a PushSubscription
router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — store a browser push subscription
router.post('/subscribe', async (req, res) => {
  const parsed = z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const { endpoint, keys } = parsed.data;

  await db
    .insert(pushSubscription)
    .values({ userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoNothing();

  res.status(201).json({ message: 'Subscribed' });
});

// DELETE /api/push/subscribe — remove a subscription when user revokes permission
router.delete('/subscribe', async (req, res) => {
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  await db
    .delete(pushSubscription)
    .where(and(
      eq(pushSubscription.userId, req.user.id),
      eq(pushSubscription.endpoint, parsed.data.endpoint),
    ));

  res.json({ message: 'Unsubscribed' });
});

// GET /api/push/timers — current user's pending timers (for showing active timers in UI)
router.get('/timers', async (req, res) => {
  const timers = await db
    .select()
    .from(pushTimer)
    .where(and(eq(pushTimer.userId, req.user.id), eq(pushTimer.status, 'PENDING')));

  res.json(timers);
});

// POST /api/push/timers — schedule a push notification
router.post('/timers', async (req, res) => {
  const parsed = z.object({
    label: z.string().trim().min(1).max(200).default('Timer'),
    duration: z.number().int().positive().max(86400), // seconds, max 24 hours
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }

  const fireAt = new Date(Date.now() + parsed.data.duration * 1000);

  const [timer] = await db
    .insert(pushTimer)
    .values({ userId: req.user.id, label: parsed.data.label, fireAt })
    .returning();

  scheduleTimer(timer.id, req.user.id, fireAt);

  res.status(201).json(timer);
});

// DELETE /api/push/timers/:id — cancel a pending timer
router.delete('/timers/:id', async (req, res) => {
  const [timer] = await db
    .select({ id: pushTimer.id, status: pushTimer.status })
    .from(pushTimer)
    .where(and(eq(pushTimer.id, req.params.id), eq(pushTimer.userId, req.user.id)))
    .limit(1);

  if (!timer) { res.status(404).json({ error: 'Timer not found' }); return; }
  if (timer.status !== 'PENDING') { res.status(400).json({ error: 'Timer is no longer pending' }); return; }

  cancelTimer(timer.id);

  await db.update(pushTimer).set({ status: 'CANCELLED' }).where(eq(pushTimer.id, timer.id));

  res.json({ message: 'Timer cancelled' });
});

export default router;
