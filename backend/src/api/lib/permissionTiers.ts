/**
 * Permission tiers, in one place, because two routes disagreed about them.
 *
 * `PATCH /members/:userId` validated against a whitelist; the invitation
 * routes did not, so `"owner"` was accepted from the request body and inserted
 * verbatim (bug #66). Accepting such an invitation minted a *second* owner,
 * which walks around both guards that exist to prevent exactly that: "use
 * ownership transfer" on the member PATCH, and "you cannot remove the owner"
 * on the member DELETE — leaving an owner nobody could remove.
 */

/** Every tier a `project_members` row may hold. */
export const PERMISSION_TIERS = ["owner", "admin", "developer"] as const;

/**
 * Tiers an invitation may grant. Ownership is deliberately absent: there is
 * exactly one owner per project and it changes by transfer, never by invite.
 */
export const INVITABLE_TIERS = ["admin", "developer"] as const;

/** Developer roles the generator knows how to write onboarding for. */
export const DEVELOPER_ROLES = ["backend", "frontend", "devops", "qa", "general"] as const;

export function isPermissionTier(value: unknown): boolean {
  return typeof value === "string" && (PERMISSION_TIERS as readonly string[]).includes(value);
}

export function isInvitableTier(value: unknown): boolean {
  return typeof value === "string" && (INVITABLE_TIERS as readonly string[]).includes(value);
}

export function isDeveloperRole(value: unknown): boolean {
  return typeof value === "string" && (DEVELOPER_ROLES as readonly string[]).includes(value);
}
