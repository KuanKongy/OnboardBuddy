/**
 * The three per-project privacy modes, single-sourced so settings, the
 * analyze dialog, help and the public landing page all describe them
 * identically. Lives in lib so public pages don't import the authed
 * settings page.
 */
export interface PrivacyMode {
  key: "full_ai" | "facts_only_ai" | "ai_disabled";
  label: string;
  hint: string;
}

export const PRIVACY_MODES: readonly PrivacyMode[] = [
  { key: "full_ai", label: "Full AI", hint: "Code snippets + facts go to the LLM: best quality." },
  { key: "facts_only_ai", label: "Facts-only AI", hint: "No code leaves the system; only extracted facts and structure." },
  { key: "ai_disabled", label: "AI disabled", hint: "No LLM calls at all; deterministic outputs only." },
];
