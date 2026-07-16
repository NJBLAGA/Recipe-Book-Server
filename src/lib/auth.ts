import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { user, session, account, verification } from '../schema/auth';
import { household, householdUser } from '../schema/household';
import { sendEmail } from './email';

// Domains where +tag addressing is supported (strips the tag before uniqueness check)
const PLUS_TAG_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com',
]);

// Gmail ignores dots in the local part — u.s.e.r@gmail.com === user@gmail.com.
// Dots are significant on all other providers so we only strip here.
const DOT_NORMALIZE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex === -1) return trimmed;

  let local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  if (PLUS_TAG_DOMAINS.has(domain)) {
    const plusIndex = local.indexOf('+');
    if (plusIndex !== -1) local = local.slice(0, plusIndex);
  }

  if (DOT_NORMALIZE_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
  }

  return `${local}@${domain}`;
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  trustedOrigins: [process.env.CLIENT_URL ?? 'http://localhost:5173'],

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string; token: string }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your password',
        html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
               <a href="${url}">Reset password</a>`,
      });
    },
    onPasswordReset: async ({ user }: { user: { email: string } }) => {
      await sendEmail({
        to: user.email,
        subject: 'Your password has been changed',
        html: `<p>Your password was successfully reset. If you did not make this change, contact support immediately.</p>`,
      });
    },
  },

  emailVerification: {
    sendVerificationEmail: async (opts: { user: { email: string }; url: string }) => {
      const verificationUrl = new URL(opts.url);
      verificationUrl.searchParams.set(
        'callbackURL',
        `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/sign-in?verified=true`,
      );
      await sendEmail({
        to: opts.user.email,
        subject: 'Verify your email address',
        html: `<p>Welcome! Click the link below to verify your email address.</p>
               <a href="${verificationUrl.toString()}">Verify email</a>`,
      });
    },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  user: {
    changeEmail: {
      enabled: true,
      // Sends a confirmation link to the current (old) email address. The user
      // must click it before the email is actually switched. Errors from email
      // delivery are caught by better-auth's runInBackgroundOrAwait and do not
      // fail the request.
      sendChangeEmailConfirmation: async ({ user: u, newEmail, url }) => {
        const confirmUrl = new URL(url);
        confirmUrl.searchParams.set(
          'callbackURL',
          `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/sign-in`,
        );
        await sendEmail({
          to: u.email,
          subject: 'Confirm your email change',
          html: `<p>You requested to change your email to <strong>${newEmail}</strong>.</p>
                 <p>Click the link below to confirm. If you did not request this, ignore this email.</p>
                 <a href="${confirmUrl.toString()}">Confirm email change</a>`,
        });
      },
    },

    deleteUser: {
      enabled: true,
      // Enforce household ownership rules before deletion:
      // - sole owner → delete the household first (cascades all data)
      // - owner with other members → blocked (must transfer ownership first)
      // - regular member → household_user row cascades on user delete, household stays
      beforeDelete: async (userData) => {
        const [membership] = await db
          .select({ role: householdUser.role, householdId: householdUser.householdId })
          .from(householdUser)
          .where(eq(householdUser.userId, userData.id))
          .limit(1);

        if (!membership) return;

        if (membership.role === 'OWNER') {
          const otherMembers = await db
            .select({ id: householdUser.id })
            .from(householdUser)
            .where(
              and(
                eq(householdUser.householdId, membership.householdId),
                ne(householdUser.userId, userData.id)
              )
            );

          if (otherMembers.length > 0) {
            throw new APIError('BAD_REQUEST', {
              message: 'Transfer ownership to another member before deleting your account',
            });
          }

          // Sole owner — delete the household; cascades to recipe book, pantry,
          // shopping list, and all join requests for this household.
          await db.delete(household).where(eq(household.id, membership.householdId));
        }
      },
    },

    additionalFields: {
      handle: { type: 'string', required: false, input: true },
      firstName: { type: 'string', required: false, input: true },
      lastName: { type: 'string', required: false, input: true },
      bio: { type: 'string', required: false, input: true },
      theme: { type: 'string', required: false, input: true },
    },
  },

  // Normalise the email on every auth request (sign-up, sign-in, password reset,
  // change-email) so variants like user+tag@gmail.com and User@Gmail.com all
  // resolve to the same canonical address. Also normalises newEmail on change-email.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = ctx.body as Record<string, unknown> | undefined;
      if (body && typeof body.email === 'string') {
        body.email = normalizeEmail(body.email);
      }
      if (body && typeof body.newEmail === 'string') {
        body.newEmail = normalizeEmail(body.newEmail);
      }
    }),
  },

  // Belt-and-suspenders: also normalise at the DB write level so even internal
  // paths that bypass the request hook can't store a denormalised address.
  // Also derives the full name from firstName + lastName when both are provided
  // (e.g. via the signup form), so the session always shows the correct name.
  databaseHooks: {
    user: {
      create: {
        before: async (userData) => {
          const email = normalizeEmail(userData.email);
          const first = ((userData as Record<string, unknown>).firstName as string | null | undefined)?.trim() ?? '';
          const last = ((userData as Record<string, unknown>).lastName as string | null | undefined)?.trim() ?? '';
          const derivedName = [first, last].filter(Boolean).join(' ') || userData.name;
          return { data: { ...userData, email, name: derivedName } };
        },
      },
      update: {
        before: async (data) => {
          if (typeof data.email === 'string') {
            return { data: { ...data, email: normalizeEmail(data.email) } };
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
