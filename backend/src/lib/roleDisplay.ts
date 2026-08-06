/**
 * Display names for developer roles. Stored values are frozen ('general'
 * etc.); these are the human-readable forms for exports and prose. Mirrors
 * frontend/src/lib/roles.ts.
 */
const ROLE_TITLES: Record<string, string> = {
  backend: 'Backend Developer',
  frontend: 'Frontend Developer',
  devops: 'DevOps Engineer',
  qa: 'QA Engineer',
  general: 'Full-Stack',
};

/** "a {descriptor} developer" reads correctly for every role. */
const ROLE_DESCRIPTORS: Record<string, string> = {
  backend: 'backend',
  frontend: 'frontend',
  devops: 'DevOps',
  qa: 'QA',
  general: 'full-stack',
};

/** Unknown roles render as themselves rather than as a guess. */
export function roleTitle(role: string): string {
  return ROLE_TITLES[role] ?? role;
}

export function roleDescriptor(role: string): string {
  return ROLE_DESCRIPTORS[role] ?? role;
}
