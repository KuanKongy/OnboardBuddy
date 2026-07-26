/**
 * Secret redaction for repo text.
 *
 * `privacyFilter` drops files whose PATH looks secret (`.env`, `id_rsa`,
 * `*.pem`). That covers secrets everyone already knows about — and those are
 * usually gitignored, so they never reach the zipball anyway. It cannot cover
 * the case that actually leaks: a credential ACCIDENTALLY committed into
 * ordinary source (`export const STRIPE_KEY = "sk_live_…"` in `config.ts`).
 * Nobody adds that to `ignored_paths`, because nobody noticed it.
 *
 * Left alone, that value is copied into `graph_nodes.snippet` and
 * `source_receipts.snippet`, sent to OpenRouter inside generation prompts, and
 * rendered in the onboarding doc. The durable problem is the copy: the secret
 * now lives in Postgres under different access control and different retention
 * than the repo, so rotating the key and purging git history does not remove
 * it from here.
 *
 * Redaction removes the VALUE and keeps everything else — the symbol, its
 * line range, its call edges — so the graph is unaffected.
 *
 * Scope, stated honestly: these are prefix-anchored rules for well-known
 * credential formats (the gitleaks approach — modern tokens carry deliberate
 * prefixes, which is what makes matching precise instead of guesswork). This
 * does NOT catch a plain password, an internal token with no distinctive
 * shape, or a bespoke format. It reduces exposure; it is not a guarantee, and
 * nothing downstream should be described as "secret-free" because of it.
 */

interface SecretRule {
  id: string;
  pattern: RegExp;
}

/**
 * Ported from the gitleaks rule set (data, not logic — no Go binary in the
 * worker image; that dependency is the shape of problem that produced the
 * BusyBox `unzip` incident). Every pattern is anchored on a issuer-assigned
 * prefix, so false positives require text that already looks like a token.
 *
 * `g` is required — `replaceAll` throws without it. Each is used with a fresh
 * `lastIndex` per call via `String.replaceAll`, which resets it.
 */
const RULES: SecretRule[] = [
  // ── cloud providers ──────────────────────────────────────────────────────
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { id: 'gcp-service-account-key', pattern: /"private_key_id"\s*:\s*"[0-9a-f]{40}"/g },

  // ── source hosts / package registries ────────────────────────────────────
  { id: 'github-token', pattern: /\bgh[pousr]_[0-9A-Za-z]{36,255}\b/g },
  { id: 'github-fine-grained-pat', pattern: /\bgithub_pat_[0-9A-Za-z_]{20,255}\b/g },
  { id: 'gitlab-token', pattern: /\bglpat-[0-9A-Za-z\-_]{20,22}\b/g },
  { id: 'npm-token', pattern: /\bnpm_[0-9A-Za-z]{36}\b/g },

  // ── payment / comms ──────────────────────────────────────────────────────
  { id: 'stripe-key', pattern: /\b[sSrRpP]k_(?:live|test)_[0-9A-Za-z]{10,99}\b/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,255}\b/g },
  { id: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9+/]{40,}/g },
  { id: 'twilio-api-key', pattern: /\bSK[0-9a-fA-F]{32}\b/g },
  { id: 'sendgrid-api-key', pattern: /\bSG\.[0-9A-Za-z\-_]{22}\.[0-9A-Za-z\-_]{43}\b/g },

  // ── services this project itself uses ────────────────────────────────────
  { id: 'supabase-secret-key', pattern: /\bsb_secret_[0-9A-Za-z\-_]{20,}\b/g },
  { id: 'supabase-access-token', pattern: /\bsbp_[0-9a-f]{40}\b/g },
  { id: 'openrouter-key', pattern: /\bsk-or-v1-[0-9a-f]{32,}\b/g },
  { id: 'anthropic-key', pattern: /\bsk-ant-[0-9A-Za-z\-_]{20,}\b/g },
  { id: 'openai-key', pattern: /\bsk-(?:proj-)?[0-9A-Za-z\-_]{32,}\b/g },

  // ── generic shapes ───────────────────────────────────────────────────────
  // Whole PEM block, not just the header: the key material is the payload.
  {
    id: 'private-key',
    pattern: /-----BEGIN[ A-Z0-9]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END[ A-Z0-9]*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Credentials embedded in a connection string. The password is the capture;
  // host and scheme stay readable because they are useful documentation.
  {
    id: 'connection-string-password',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s:/@]{3,})@/gi,
  },
];

/**
 * Cheap pre-filter. `redactSecrets` runs on every snippet of every symbol in
 * the repo — tens of thousands of calls — so the overwhelmingly common case
 * (no secret anywhere) must cost one regex test, not twenty. Every fragment
 * here appears in at least one rule above; if none is present, no rule can
 * match.
 */
const SNIFF = /AKIA|ASIA|ABIA|ACCA|AIza|gh[pousr]_|github_pat_|glpat-|npm_|[sSrRpP]k_(?:live|test)_|xox[baprs]-|hooks\.slack\.com|\bSK[0-9a-fA-F]{32}\b|SG\.|sb_secret_|sbp_|sk-|private_key_id|BEGIN[ A-Z0-9]*PRIVATE KEY|eyJ|:\/\//;

/**
 * Replacement marker. Keeps the match's LINE COUNT so every line number
 * recorded against this text stays correct — receipts cite exact ranges, and a
 * multi-line PEM block collapsing to one line would shift every symbol below
 * it in the file.
 */
function markerFor(match: string, ruleId: string): string {
  const newlines = match.length - match.replace(/\n/g, '').length;
  return `«redacted:${ruleId}»${'\n'.repeat(newlines)}`;
}

/**
 * Replaces well-known credential formats in `text` with an inert marker.
 * Returns the input unchanged when nothing matches (the common case).
 */
export function redactSecrets(text: string): string {
  if (!text || !SNIFF.test(text)) return text;

  let out = text;
  for (const rule of RULES) {
    if (rule.id === 'connection-string-password') {
      // Keep scheme + host: `postgres://user:pass@host` documents a real
      // dependency, and only the password needs to go.
      out = out.replaceAll(rule.pattern, (_m, prefix: string) => `${prefix}:«redacted:${rule.id}»@`);
      continue;
    }
    out = out.replaceAll(rule.pattern, (m: string) => markerFor(m, rule.id));
  }
  return out;
}

/** Test/diagnostic helper: which rules fire on `text`. */
export function detectSecrets(text: string): string[] {
  if (!text || !SNIFF.test(text)) return [];
  return RULES.filter((r) => r.pattern.test(text) && (r.pattern.lastIndex = 0) === 0).map((r) => r.id);
}
