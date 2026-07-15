import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db';
import { user, session, account, verification } from '../schema/auth';
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
    sendResetPasswordEmail: async (opts: { user: { email: string }; url: string }) => {
      await sendEmail({
        to: opts.user.email,
        subject: 'Reset your password',
        html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
               <a href="${opts.url}">Reset password</a>`,
      });
    },
  },

  emailVerification: {
    sendVerificationEmail: async (opts: { user: { email: string }; url: string }) => {
      await sendEmail({
        to: opts.user.email,
        subject: 'Verify your email address',
        html: `<p>Welcome! Click the link below to verify your email address.</p>
               <a href="${opts.url}">Verify email</a>`,
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
  // resolve to the same canonical address.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = ctx.body as Record<string, unknown> | undefined;
      if (body && typeof body.email === 'string') {
        body.email = normalizeEmail(body.email);
      }
    }),
  },

  // Belt-and-suspenders: also normalise at the DB write level so even internal
  // paths that bypass the request hook can't store a denormalised address.
  databaseHooks: {
    user: {
      create: {
        before: async (userData) => ({
          data: { ...userData, email: normalizeEmail(userData.email) },
        }),
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
