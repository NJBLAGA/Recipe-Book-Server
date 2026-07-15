import { Router } from 'express';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { notification } from '../schema/social';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

// GET /api/notifications — inbox for current user
router.get('/', async (req, res) => {
  const unreadOnly = req.query.unread === 'true';

  const conditions = [eq(notification.userId, req.user.id)];
  if (unreadOnly) conditions.push(isNull(notification.readAt));

  const notifications = await db
    .select()
    .from(notification)
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt))
    .limit(100);

  res.json(notifications);
});

// GET /api/notifications/unread-count — badge count
router.get('/unread-count', async (req, res) => {
  const [result] = await db
    .select({ count: count() })
    .from(notification)
    .where(and(eq(notification.userId, req.user.id), isNull(notification.readAt)));

  res.json({ count: result?.count ?? 0 });
});

// PATCH /api/notifications/read-all — mark everything as read
router.patch('/read-all', async (req, res) => {
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, req.user.id), isNull(notification.readAt)));

  res.json({ message: 'All notifications marked as read' });
});

// PATCH /api/notifications/:id/read — mark a single notification as read
router.patch('/:id/read', async (req, res) => {
  const [notif] = await db
    .select({ id: notification.id })
    .from(notification)
    .where(and(eq(notification.id, req.params.id), eq(notification.userId, req.user.id)))
    .limit(1);

  if (!notif) { res.status(404).json({ error: 'Notification not found' }); return; }

  const [updated] = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(eq(notification.id, notif.id))
    .returning();

  res.json(updated);
});

export default router;
