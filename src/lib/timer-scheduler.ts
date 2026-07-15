import { eq } from 'drizzle-orm';
import { db } from '../db';
import { pushSubscription, pushTimer } from '../schema/push';
import { sendPush } from './webpush';

// In-memory map of timerId → Node timeout handle
const active = new Map<string, NodeJS.Timeout>();

async function fire(timerId: string, userId: string): Promise<void> {
  const [[timer], subscriptions] = await Promise.all([
    db.select().from(pushTimer).where(eq(pushTimer.id, timerId)).limit(1),
    db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId)),
  ]);

  if (!timer || timer.status !== 'PENDING') return;

  await db.update(pushTimer).set({ status: 'FIRED' }).where(eq(pushTimer.id, timerId));

  for (const sub of subscriptions) {
    try {
      await sendPush(sub, { title: '⏰ Timer done!', body: timer.label, tag: `timer-${timerId}` });
    } catch (err: any) {
      // Subscription expired or revoked — clean it up so we don't keep trying
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
      }
    }
  }

  active.delete(timerId);
}

export function scheduleTimer(timerId: string, userId: string, fireAt: Date): void {
  const delay = Math.max(0, fireAt.getTime() - Date.now());
  active.set(timerId, setTimeout(() => fire(timerId, userId), delay));
}

export function cancelTimer(timerId: string): void {
  const timeout = active.get(timerId);
  if (timeout) {
    clearTimeout(timeout);
    active.delete(timerId);
  }
}

// Called once on server startup — reschedules any timers that survived a restart.
// Past-due timers (fireAt already passed) fire immediately via the Math.max(0) guard.
export async function restoreTimers(): Promise<void> {
  const pending = await db
    .select()
    .from(pushTimer)
    .where(eq(pushTimer.status, 'PENDING'));

  for (const timer of pending) {
    scheduleTimer(timer.id, timer.userId, timer.fireAt);
  }
}
