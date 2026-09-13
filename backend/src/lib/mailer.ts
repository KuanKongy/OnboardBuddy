/**
 * Minimal outbound email via Resend's HTTP API. No SDK - a single fetch keeps
 * the dependency surface flat. A missing RESEND_API_KEY makes send a logged
 * no-op so local/dev and tests never fail on it (this is the only outbound
 * email in the app).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendEmailFn = (msg: EmailMessage, env?: NodeJS.ProcessEnv) => Promise<boolean>;

export async function sendEmail(msg: EmailMessage, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    console.warn(`[mailer] RESEND_API_KEY unset - skipping email: ${msg.subject}`);
    return false;
  }
  // Resend requires a verified sender domain in production; the resend.dev
  // sandbox sender works for the account owner's own testing.
  const from = env.ALERT_EMAIL_FROM?.trim() || 'OnboardBuddy <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) {
      console.error(`[mailer] Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[mailer] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
