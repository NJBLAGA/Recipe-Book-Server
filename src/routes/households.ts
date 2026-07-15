import { Router } from 'express';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { household, householdUser, householdJoinRequest } from '../schema/household';
import { recipeBook } from '../schema/recipe';
import { pantry } from '../schema/pantry';
import { shoppingList } from '../schema/shopping';
import { notification } from '../schema/social';
import { user } from '../schema/auth';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, 'Household name is required').max(100),
});

const inviteSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

const transferOwnershipSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

// POST /api/households — create a household (caller becomes OWNER)
router.post('/', async (req, res) => {
  const parsed = createHouseholdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const existing = await db
    .select({ id: householdUser.id })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: 'You already belong to a household' });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [newHousehold] = await tx
      .insert(household)
      .values({ name: parsed.data.name })
      .returning();

    await tx.insert(householdUser).values({
      householdId: newHousehold.id,
      userId: req.user.id,
      role: 'OWNER',
    });

    await tx.insert(recipeBook).values({ householdId: newHousehold.id });
    await tx.insert(pantry).values({ householdId: newHousehold.id });
    await tx.insert(shoppingList).values({ householdId: newHousehold.id });

    return newHousehold;
  });

  res.status(201).json(result);
});

// GET /api/households/mine — return the current user's household + their role
router.get('/mine', async (req, res) => {
  const rows = await db
    .select({
      id: household.id,
      name: household.name,
      createdAt: household.createdAt,
      updatedAt: household.updatedAt,
      role: householdUser.role,
    })
    .from(householdUser)
    .innerJoin(household, eq(householdUser.householdId, household.id))
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'No household found' });
    return;
  }

  res.json(rows[0]);
});

// GET /api/households/pending — pending invites for this user + pending requests to their household
router.get('/pending', async (req, res) => {
  const invites = await db
    .select()
    .from(householdJoinRequest)
    .where(
      and(
        eq(householdJoinRequest.userId, req.user.id),
        eq(householdJoinRequest.type, 'INVITE'),
        eq(householdJoinRequest.status, 'PENDING')
      )
    );

  const membershipRows = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  type JoinRequest = typeof householdJoinRequest.$inferSelect;
  let requests: JoinRequest[] = [];

  if (membershipRows.length > 0) {
    requests = await db
      .select()
      .from(householdJoinRequest)
      .where(
        and(
          eq(householdJoinRequest.householdId, membershipRows[0].householdId),
          eq(householdJoinRequest.type, 'REQUEST'),
          eq(householdJoinRequest.status, 'PENDING')
        )
      );
  }

  res.json({ invites, requests });
});

// POST /api/households/:id/invites — send an invite to a user (must be a household member)
router.post('/:id/invites', async (req, res) => {
  const { id: householdId } = req.params;

  const membership = await db
    .select({ id: householdUser.id })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.userId, req.user.id)
      )
    )
    .limit(1);

  if (membership.length === 0) {
    res.status(403).json({ error: 'You are not a member of this household' });
    return;
  }

  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { userId: targetUserId } = parsed.data;

  if (targetUserId === req.user.id) {
    res.status(400).json({ error: 'You cannot invite yourself' });
    return;
  }

  const [targetUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);

  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const targetMembership = await db
    .select({ id: householdUser.id })
    .from(householdUser)
    .where(eq(householdUser.userId, targetUserId))
    .limit(1);

  if (targetMembership.length > 0) {
    res.status(409).json({ error: 'This user already belongs to a household' });
    return;
  }

  const existingInvite = await db
    .select({ id: householdJoinRequest.id })
    .from(householdJoinRequest)
    .where(
      and(
        eq(householdJoinRequest.householdId, householdId),
        eq(householdJoinRequest.userId, targetUserId),
        eq(householdJoinRequest.type, 'INVITE'),
        eq(householdJoinRequest.status, 'PENDING')
      )
    )
    .limit(1);

  if (existingInvite.length > 0) {
    res.status(409).json({ error: 'A pending invite already exists for this user' });
    return;
  }

  // Cap total pending invites/requests for the target user to prevent inbox flooding
  const pendingForTarget = await db
    .select({ id: householdJoinRequest.id })
    .from(householdJoinRequest)
    .where(
      and(
        eq(householdJoinRequest.userId, targetUserId),
        eq(householdJoinRequest.status, 'PENDING')
      )
    );

  if (pendingForTarget.length >= 10) {
    res.status(429).json({ error: 'This user has too many pending invites — wait for some to resolve first' });
    return;
  }

  const [h] = await db
    .select({ name: household.name })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1);

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .insert(householdJoinRequest)
      .values({
        householdId,
        userId: targetUserId,
        initiatedByUserId: req.user.id,
        type: 'INVITE',
      })
      .returning();

    await tx.insert(notification).values({
      userId: targetUserId,
      type: 'HOUSEHOLD_INVITE',
      payload: {
        joinRequestId: invite.id,
        householdId,
        householdName: h.name,
        invitedByUserId: req.user.id,
        invitedByName: req.user.name,
      },
    });

    return invite;
  });

  res.status(201).json(result);
});

// POST /api/households/:id/requests — request to join a household (must have no household)
router.post('/:id/requests', async (req, res) => {
  const { id: householdId } = req.params;

  const existing = await db
    .select({ id: householdUser.id })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: 'You already belong to a household' });
    return;
  }

  const [h] = await db
    .select({ name: household.name })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1);

  if (!h) {
    res.status(404).json({ error: 'Household not found' });
    return;
  }

  const existingRequest = await db
    .select({ id: householdJoinRequest.id })
    .from(householdJoinRequest)
    .where(
      and(
        eq(householdJoinRequest.householdId, householdId),
        eq(householdJoinRequest.userId, req.user.id),
        eq(householdJoinRequest.type, 'REQUEST'),
        eq(householdJoinRequest.status, 'PENDING')
      )
    )
    .limit(1);

  if (existingRequest.length > 0) {
    res.status(409).json({ error: 'You already have a pending request to this household' });
    return;
  }

  // Cap total pending requests from this user to prevent spam
  const pendingFromUser = await db
    .select({ id: householdJoinRequest.id })
    .from(householdJoinRequest)
    .where(
      and(
        eq(householdJoinRequest.userId, req.user.id),
        eq(householdJoinRequest.status, 'PENDING'),
        eq(householdJoinRequest.type, 'REQUEST')
      )
    );

  if (pendingFromUser.length >= 10) {
    res.status(429).json({ error: 'Too many pending requests — cancel some before sending more' });
    return;
  }

  const members = await db
    .select({ userId: householdUser.userId })
    .from(householdUser)
    .where(eq(householdUser.householdId, householdId));

  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .insert(householdJoinRequest)
      .values({
        householdId,
        userId: req.user.id,
        initiatedByUserId: req.user.id,
        type: 'REQUEST',
      })
      .returning();

    if (members.length > 0) {
      await tx.insert(notification).values(
        members.map((m) => ({
          userId: m.userId,
          type: 'JOIN_REQUEST' as const,
          payload: {
            joinRequestId: request.id,
            householdId,
            householdName: h.name,
            requesterId: req.user.id,
            requesterName: req.user.name,
          },
        }))
      );
    }

    return request;
  });

  res.status(201).json(result);
});

// POST /api/households/join-requests/:id/accept
router.post('/join-requests/:id/accept', async (req, res) => {
  const [joinRequest] = await db
    .select()
    .from(householdJoinRequest)
    .where(eq(householdJoinRequest.id, req.params.id))
    .limit(1);

  if (!joinRequest) {
    res.status(404).json({ error: 'Join request not found' });
    return;
  }

  if (joinRequest.status !== 'PENDING') {
    res.status(409).json({ error: 'This request is no longer pending' });
    return;
  }

  if (joinRequest.type === 'INVITE') {
    if (req.user.id !== joinRequest.userId) {
      res.status(403).json({ error: 'Only the invited user can accept this invite' });
      return;
    }
  } else {
    const membership = await db
      .select({ id: householdUser.id })
      .from(householdUser)
      .where(
        and(
          eq(householdUser.householdId, joinRequest.householdId),
          eq(householdUser.userId, req.user.id)
        )
      )
      .limit(1);

    if (membership.length === 0) {
      res.status(403).json({ error: 'Only household members can accept join requests' });
      return;
    }
  }

  const joiningUserId = joinRequest.userId;

  // Check that the joining user hasn't joined another household since the request was created.
  // This must happen inside the transaction so the unique constraint on householdUser.userId
  // can still catch the narrow concurrent-accept race as a DB-level safety net.
  let joiningUserAlreadyInHousehold = false;
  try {
    await db.transaction(async (tx) => {
      const [alreadyMember] = await tx
        .select({ id: householdUser.id })
        .from(householdUser)
        .where(eq(householdUser.userId, joiningUserId))
        .limit(1);

      if (alreadyMember) {
        joiningUserAlreadyInHousehold = true;
        return;
      }

      await tx.insert(householdUser).values({
        householdId: joinRequest.householdId,
        userId: joiningUserId,
        role: 'USER',
      });

      await tx
        .update(householdJoinRequest)
        .set({ status: 'ACCEPTED' })
        .where(eq(householdJoinRequest.id, joinRequest.id));

      // Cancel every other pending invite/request for the joining user
      await tx
        .update(householdJoinRequest)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(householdJoinRequest.userId, joiningUserId),
            eq(householdJoinRequest.status, 'PENDING'),
            ne(householdJoinRequest.id, joinRequest.id)
          )
        );

      const notifyUserId =
        joinRequest.type === 'REQUEST' ? joiningUserId : joinRequest.initiatedByUserId;

      await tx.insert(notification).values({
        userId: notifyUserId,
        type: joinRequest.type === 'REQUEST' ? 'JOIN_REQUEST' : 'HOUSEHOLD_INVITE',
        payload: {
          joinRequestId: joinRequest.id,
          householdId: joinRequest.householdId,
          status: 'ACCEPTED',
          actingUserId: req.user.id,
          actingUserName: req.user.name,
        },
      });
    });
  } catch (e: any) {
    if (e?.code === '23505') {
      res.status(409).json({ error: 'This user has already joined another household' });
      return;
    }
    throw e;
  }

  if (joiningUserAlreadyInHousehold) {
    res.status(409).json({ error: 'This user has already joined another household' });
    return;
  }

  res.json({ message: 'Accepted' });
});

// POST /api/households/join-requests/:id/decline
router.post('/join-requests/:id/decline', async (req, res) => {
  const [joinRequest] = await db
    .select()
    .from(householdJoinRequest)
    .where(eq(householdJoinRequest.id, req.params.id))
    .limit(1);

  if (!joinRequest) {
    res.status(404).json({ error: 'Join request not found' });
    return;
  }

  if (joinRequest.status !== 'PENDING') {
    res.status(409).json({ error: 'This request is no longer pending' });
    return;
  }

  if (joinRequest.type === 'INVITE') {
    if (req.user.id !== joinRequest.userId) {
      res.status(403).json({ error: 'Only the invited user can decline this invite' });
      return;
    }
  } else {
    const membership = await db
      .select({ id: householdUser.id })
      .from(householdUser)
      .where(
        and(
          eq(householdUser.householdId, joinRequest.householdId),
          eq(householdUser.userId, req.user.id)
        )
      )
      .limit(1);

    if (membership.length === 0) {
      res.status(403).json({ error: 'Only household members can decline join requests' });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(householdJoinRequest)
      .set({ status: 'DECLINED' })
      .where(eq(householdJoinRequest.id, joinRequest.id));

    const notifyUserId =
      joinRequest.type === 'REQUEST' ? joinRequest.userId : joinRequest.initiatedByUserId;

    await tx.insert(notification).values({
      userId: notifyUserId,
      type: joinRequest.type === 'REQUEST' ? 'JOIN_REQUEST' : 'HOUSEHOLD_INVITE',
      payload: {
        joinRequestId: joinRequest.id,
        householdId: joinRequest.householdId,
        status: 'DECLINED',
        actingUserId: req.user.id,
        actingUserName: req.user.name,
      },
    });
  });

  res.json({ message: 'Declined' });
});

// POST /api/households/join-requests/:id/cancel — only the sender can cancel
router.post('/join-requests/:id/cancel', async (req, res) => {
  const [joinRequest] = await db
    .select()
    .from(householdJoinRequest)
    .where(eq(householdJoinRequest.id, req.params.id))
    .limit(1);

  if (!joinRequest) {
    res.status(404).json({ error: 'Join request not found' });
    return;
  }

  if (joinRequest.status !== 'PENDING') {
    res.status(409).json({ error: 'This request is no longer pending' });
    return;
  }

  if (req.user.id !== joinRequest.initiatedByUserId) {
    res.status(403).json({ error: 'Only the sender can cancel this request' });
    return;
  }

  await db
    .update(householdJoinRequest)
    .set({ status: 'CANCELLED' })
    .where(eq(householdJoinRequest.id, joinRequest.id));

  res.json({ message: 'Cancelled' });
});

// GET /api/households/:id/members — list members with user details (must be a member)
router.get('/:id/members', async (req, res) => {
  const { id: householdId } = req.params;

  const membership = await db
    .select({ id: householdUser.id })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.userId, req.user.id)
      )
    )
    .limit(1);

  if (membership.length === 0) {
    res.status(403).json({ error: 'You are not a member of this household' });
    return;
  }

  const members = await db
    .select({
      userId: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
      role: householdUser.role,
      joinedAt: householdUser.joinedAt,
    })
    .from(householdUser)
    .innerJoin(user, eq(householdUser.userId, user.id))
    .where(eq(householdUser.householdId, householdId));

  res.json(members);
});

// POST /api/households/:id/transfer-ownership — owner promotes another member to owner
router.post('/:id/transfer-ownership', async (req, res) => {
  const { id: householdId } = req.params;

  const myMembership = await db
    .select({ role: householdUser.role })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.userId, req.user.id)
      )
    )
    .limit(1);

  if (myMembership.length === 0) {
    res.status(403).json({ error: 'You are not a member of this household' });
    return;
  }

  if (myMembership[0].role !== 'OWNER') {
    res.status(403).json({ error: 'Only the owner can transfer ownership' });
    return;
  }

  const parsed = transferOwnershipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { userId: targetUserId } = parsed.data;

  if (targetUserId === req.user.id) {
    res.status(400).json({ error: 'You are already the owner' });
    return;
  }

  const targetMembership = await db
    .select({ id: householdUser.id })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.userId, targetUserId)
      )
    )
    .limit(1);

  if (targetMembership.length === 0) {
    res.status(404).json({ error: 'User is not a member of this household' });
    return;
  }

  // Atomic swap — current owner becomes USER, target becomes OWNER
  await db.transaction(async (tx) => {
    await tx
      .update(householdUser)
      .set({ role: 'USER' })
      .where(
        and(
          eq(householdUser.householdId, householdId),
          eq(householdUser.userId, req.user.id)
        )
      );

    await tx
      .update(householdUser)
      .set({ role: 'OWNER' })
      .where(
        and(
          eq(householdUser.householdId, householdId),
          eq(householdUser.userId, targetUserId)
        )
      );
  });

  res.json({ message: 'Ownership transferred' });
});

// POST /api/households/:id/leave
router.post('/:id/leave', async (req, res) => {
  const { id: householdId } = req.params;

  const myMembership = await db
    .select({ role: householdUser.role })
    .from(householdUser)
    .where(
      and(
        eq(householdUser.householdId, householdId),
        eq(householdUser.userId, req.user.id)
      )
    )
    .limit(1);

  if (myMembership.length === 0) {
    res.status(403).json({ error: 'You are not a member of this household' });
    return;
  }

  if (myMembership[0].role === 'OWNER') {
    const otherMembers = await db
      .select({ id: householdUser.id })
      .from(householdUser)
      .where(
        and(
          eq(householdUser.householdId, householdId),
          ne(householdUser.userId, req.user.id)
        )
      );

    if (otherMembers.length > 0) {
      res.status(400).json({
        error: 'Transfer ownership to another member before leaving',
      });
      return;
    }

    // Last member — delete the household atomically. Re-checking inside the
    // transaction prevents a concurrent invite-accept from racing in between
    // the member-count check above and the delete below.
    let concurrentJoin = false;
    await db.transaction(async (tx) => {
      const [raceEntry] = await tx
        .select({ id: householdUser.id })
        .from(householdUser)
        .where(
          and(
            eq(householdUser.householdId, householdId),
            ne(householdUser.userId, req.user.id)
          )
        )
        .limit(1);

      if (raceEntry) {
        concurrentJoin = true;
        return;
      }

      await tx.delete(household).where(eq(household.id, householdId));
    });

    if (concurrentJoin) {
      res.status(400).json({ error: 'Transfer ownership to another member before leaving' });
      return;
    }
  } else {
    await db.transaction(async (tx) => {
      await tx
        .delete(householdUser)
        .where(
          and(
            eq(householdUser.householdId, householdId),
            eq(householdUser.userId, req.user.id)
          )
        );

      // Cancel any pending invites this user sent from this household
      await tx
        .update(householdJoinRequest)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(householdJoinRequest.householdId, householdId),
            eq(householdJoinRequest.initiatedByUserId, req.user.id),
            eq(householdJoinRequest.type, 'INVITE'),
            eq(householdJoinRequest.status, 'PENDING')
          )
        );
    });
  }

  res.json({ message: 'You have left the household' });
});

export default router;
