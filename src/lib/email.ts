import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM = `The Shared Pantry Experience <${process.env.RESEND_FROM_EMAIL ?? 'hello@admin.thesharedpantryexperience.com'}>`;

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  await resend.emails.send({ from: FROM, to, subject, html });
}
