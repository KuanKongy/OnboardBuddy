export function formatUser(name: string): string {
  return name.trim().toLowerCase();
}

export const MAX_USERS = 100;

export type UserId = string;
