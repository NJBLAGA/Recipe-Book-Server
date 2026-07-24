import 'dotenv/config';
import { db } from './db';
import { household, householdUser, householdJoinRequest } from './schema/household';
import { user } from './schema/auth';
import { eq, ilike, and, ne } from 'drizzle-orm';

async function main() {
  const allUsers = await db.select({ id: user.id, name: user.name, handle: user.handle }).from(user);
  console.log('All users:', allUsers.map(u => `${u.name} (${u.id})`).join(', '));

  const nathan = allUsers.find(u => u.name?.toLowerCase().includes('nathan') || u.handle?.toLowerCase().includes('nathan'));
  if (!nathan) { console.error('Nathan not found'); process.exit(1); }
  console.log('Nathan:', nathan.name, nathan.id);

  const [nathanHU] = await db.select({ householdId: householdUser.householdId })
    .from(householdUser).where(eq(householdUser.userId, nathan.id));
  if (!nathanHU) { console.error('Nathan has no household'); process.exit(1); }
  const nathanHouseholdId = nathanHU.householdId;

  const [nathanHousehold] = await db.select({ id: household.id, name: household.name })
    .from(household).where(eq(household.id, nathanHouseholdId));
  console.log("Nathan's household:", nathanHousehold.name);

  const otherUsers = allUsers.filter(u => u.id !== nathan.id);
  if (otherUsers.length === 0) { console.error('No other users found'); process.exit(1); }

  const testUser = otherUsers[0];
  console.log('Other user:', testUser.name, testUser.id);

  const [testUserHU] = await db.select({ householdId: householdUser.householdId })
    .from(householdUser).where(eq(householdUser.userId, testUser.id));

  // ── 1. Inbound INVITE: Test User's household invites Nathan to join ─────────
  if (testUserHU) {
    const [existingInvite] = await db.select({ id: householdJoinRequest.id })
      .from(householdJoinRequest)
      .where(and(
        eq(householdJoinRequest.userId, nathan.id),
        eq(householdJoinRequest.type, 'INVITE'),
        eq(householdJoinRequest.status, 'PENDING'),
      )).limit(1);

    if (existingInvite) {
      console.log('Inbound INVITE already exists:', existingInvite.id);
    } else {
      const [invite] = await db.insert(householdJoinRequest).values({
        householdId: testUserHU.householdId,
        userId: nathan.id,
        initiatedByUserId: testUser.id,
        type: 'INVITE',
        status: 'PENDING',
      }).returning();
      console.log(`✓ Created inbound INVITE: ${testUser.name} invites Nathan to join their household (id: ${invite.id})`);
    }
  } else {
    console.log('Other user has no household — skipping inbound INVITE');
  }

  // ── 2. Inbound REQUEST: Test User requests to join Nathan's household ───────
  const [existingRequest] = await db.select({ id: householdJoinRequest.id })
    .from(householdJoinRequest)
    .where(and(
      eq(householdJoinRequest.userId, testUser.id),
      eq(householdJoinRequest.householdId, nathanHouseholdId),
      eq(householdJoinRequest.type, 'REQUEST'),
      eq(householdJoinRequest.status, 'PENDING'),
    )).limit(1);

  if (existingRequest) {
    console.log('Inbound REQUEST already exists:', existingRequest.id);
  } else {
    const [req] = await db.insert(householdJoinRequest).values({
      householdId: nathanHouseholdId,
      userId: testUser.id,
      initiatedByUserId: testUser.id,
      type: 'REQUEST',
      status: 'PENDING',
    }).returning();
    console.log(`✓ Created inbound REQUEST: ${testUser.name} requests to join Nathan's household (id: ${req.id})`);
  }

  console.log('\nDone — recipe sharing notifications (inbound PENDING share + outbound REQUESTED share) were created by the previous seed script.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
