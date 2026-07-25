const SUPPORT_EMAIL = 'hello@thesharedpantryexperience.com';

const LOGO = `
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="background:#f97316;border-radius:10px;width:42px;height:42px;text-align:center;vertical-align:middle;font-size:22px;line-height:42px;">
        📖
      </td>
      <td style="padding-left:12px;vertical-align:middle;">
        <span style="font-size:15px;font-weight:700;color:#1c1917;letter-spacing:-0.3px;white-space:nowrap;">The Shared Pantry Experience</span>
      </td>
    </tr>
  </table>`;

function button(url: string, label: string): string {
  return `
    <table cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background:#f97316;border-radius:10px;">
          <a href="${url}"
             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

function wrap(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:48px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Logo header -->
          <tr>
            <td style="padding:28px 36px 24px;border-bottom:1px solid #e7e5e4;">
              ${LOGO}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 36px;border-top:1px solid #e7e5e4;background:#fafaf9;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a8a29e;line-height:1.6;">
                © ${new Date().getFullYear()} The Shared Pantry Experience &nbsp;·&nbsp;
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#a8a29e;text-decoration:none;">${SUPPORT_EMAIL}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function verifyEmailHtml(url: string): string {
  return wrap(`
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1c1917;letter-spacing:-0.4px;">
      Verify your email address
    </h1>
    <p style="margin:0 0 28px;font-size:15px;color:#57534e;line-height:1.65;">
      Welcome to The Shared Pantry Experience! Click the button below to verify your email address and activate your account.
      This link expires in <strong>24 hours</strong>.
    </p>
    ${button(url, 'Verify My Email')}
    <p style="margin:28px 0 0;font-size:13px;color:#a8a29e;line-height:1.6;">
      If you didn't create an account, you can safely ignore this email.
    </p>`);
}

export function resetPasswordHtml(url: string): string {
  return wrap(`
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1c1917;letter-spacing:-0.4px;">
      Reset your password
    </h1>
    <p style="margin:0 0 28px;font-size:15px;color:#57534e;line-height:1.65;">
      We received a request to reset the password on your account.
      Click the button below to choose a new one. This link expires in <strong>1 hour</strong>.
    </p>
    ${button(url, 'Reset My Password')}
    <p style="margin:28px 0 0;font-size:13px;color:#a8a29e;line-height:1.6;">
      If you didn't request a password reset, you can safely ignore this email — your password won't change.
    </p>`);
}

export function passwordChangedHtml(): string {
  return wrap(`
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1c1917;letter-spacing:-0.4px;">
      Your password has been changed
    </h1>
    <p style="margin:0 0 16px;font-size:15px;color:#57534e;line-height:1.65;">
      Your password was successfully updated. If you made this change, no action is needed.
    </p>
    <p style="margin:0;font-size:15px;color:#57534e;line-height:1.65;">
      If you didn't make this change, contact us immediately at
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#f97316;text-decoration:none;font-weight:600;">${SUPPORT_EMAIL}</a>.
    </p>`);
}

export function confirmEmailChangeHtml(newEmail: string, url: string): string {
  return wrap(`
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1c1917;letter-spacing:-0.4px;">
      Confirm your email change
    </h1>
    <p style="margin:0 0 28px;font-size:15px;color:#57534e;line-height:1.65;">
      You requested to change your email address to <strong>${newEmail}</strong>.
      Click the button below to confirm. If you didn't request this, ignore this email — your address won't change.
    </p>
    ${button(url, 'Confirm Email Change')}`);
}
