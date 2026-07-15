import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db';
import { user, session, account, verification } from '../schema/auth';
import { sendEmail } from './email';

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,

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
});

export type Auth = typeof auth;
