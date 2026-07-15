import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { householdUser } from '../schema/household';

export async function requireHousehold(req: Request, res: Response, next: NextFunction) {
  const [row] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, req.user.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: 'You do not belong to a household' });
    return;
  }

  req.householdId = row.householdId;
  next();
}
