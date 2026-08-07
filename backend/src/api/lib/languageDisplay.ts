/**
 * Display names for the analyzer's language-inventory keys.
 *
 * `buildLanguageInventory` keys its maps on the lowercase slugs from
 * repoIngester's extension table ("typescript", "csharp", "cpp"). The reader
 * renders those beside GitHub's linguist colours, and that palette is keyed by
 * GitHub's own display names — so "Typescript" or "Csharp" would silently lose
 * its colour dot. This map is the one place the two spellings meet.
 *
 * An unmapped slug (a new extension, a key from an older snapshot) falls back
 * to a capitalized first letter rather than vanishing from the card.
 */

const DISPLAY_NAMES: Record<string, string> = {
  // Everything repoIngester classifies as a programming language, i.e. every
  // key that can reach language_inventory.supported / .unsupported.
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  php: "PHP",
  rust: "Rust",
  swift: "Swift",
  scala: "Scala",
  c: "C",
  cpp: "C++",
  vue: "Vue",
  svelte: "Svelte",
  html: "HTML",
  css: "CSS",
  // evidenceOnly keys are not project languages and the cards exclude them,
  // but any caller that does show one deserves the right casing: these are the
  // slugs the capitalize-first fallback gets visibly wrong.
  sql: "SQL",
  prisma: "Prisma",
  json: "JSON",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
  markdown: "Markdown",
  restructuredtext: "reStructuredText",
  shell: "Shell",
  powershell: "PowerShell",
  dockerfile: "Dockerfile",
};

export function languageDisplayName(key: string): string {
  if (!key) return key;
  return DISPLAY_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
