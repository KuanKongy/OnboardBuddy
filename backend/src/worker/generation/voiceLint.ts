/**
 * Voice lint for generated onboarding prose.
 *
 * The audit counted "crucial" ×16, "essential" ×15, "seamless" ×4 across
 * one package, plus invented product consequences ("leading to poor first
 * impression and potential user drop-off") attached to code symbols. That
 * register is the #1 reason senior engineers close AI-generated docs.
 * The prompt forbids it; this lint catches what the prompt misses and
 * feeds the generator's single stricter retry.
 */

const BANNED_PHRASES: Array<{ re: RegExp; label: string }> = [
  { re: /\bcrucial(?:ly)?\b/gi, label: 'crucial' },
  { re: /\bessential(?:ly)?\b/gi, label: 'essential' },
  { re: /\bseamless(?:ly)?\b/gi, label: 'seamless' },
  { re: /\bvital(?:ly)?\b/gi, label: 'vital' },
  { re: /\bpowerful\b/gi, label: 'powerful' },
  { re: /\brobust(?:ly|ness)?\b/gi, label: 'robust' },
  { re: /\bcomprehensive\b/gi, label: 'comprehensive' },
  { re: /\bcutting[- ]edge\b/gi, label: 'cutting-edge' },
  { re: /\bstate[- ]of[- ]the[- ]art\b/gi, label: 'state-of-the-art' },
  { re: /\benhanc(?:e|es|ing|ed|ement)\b[^.\n]*\buser\b/gi, label: 'enhance … user' },
  { re: /\buser (?:satisfaction|engagement|retention|drop-?off)\b/gi, label: 'user-metric speculation' },
  { re: /\b(?:poor|great) first impression\b/gi, label: 'first-impression speculation' },
  { re: /\bboost(?:s|ing)?\b/gi, label: 'boost' },
  { re: /\bensur(?:e|es|ing)\s+(?:high performance|scalability|reliability|efficiency)\b/gi, label: 'ensuring-quality claim' },
  { re: /\bplays? (?:an?|the) (?:integral|key|critical|vital) role\b/gi, label: 'plays-a-role filler' },
];

export interface VoiceLintResult {
  issues: string[];
  /** Distinct banned labels found (for generation_context). */
  hits: string[];
}

/** Fenced code is exempt — identifiers may legitimately contain anything. */
function withoutCodeFences(markdown: string): string {
  return markdown
    .split('\n')
    .reduce<{ out: string[]; fence: boolean }>(
      (acc, line) => {
        if (/^\s*(```|~~~)/.test(line)) return { out: acc.out, fence: !acc.fence };
        if (!acc.fence) acc.out.push(line);
        return acc;
      },
      { out: [], fence: false },
    )
    .out.join('\n');
}

export function lintVoice(markdown: string): VoiceLintResult {
  const prose = withoutCodeFences(markdown ?? '');
  const hits: string[] = [];
  let total = 0;
  for (const { re, label } of BANNED_PHRASES) {
    const count = (prose.match(re) ?? []).length;
    if (count > 0) {
      hits.push(label);
      total += count;
    }
  }
  const issues =
    hits.length > 0
      ? [
          `marketing/filler voice: ${total} hit(s) of banned phrasing (${hits.join(', ')}) — ` +
            `rewrite in flat engineering prose; state facts from evidence, no invented product consequences`,
        ]
      : [];
  return { issues, hits };
}
