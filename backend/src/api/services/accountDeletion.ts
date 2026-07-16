/**
 * Account deletion (DELETE /api/auth/account). Owned projects cascade away
 * with everything under them; the subtlety is rows this user created inside
 * OTHER people's projects, which carry ON DELETE RESTRICT FKs
 * (analysis_jobs.requested_by, onboarding_packages.generated_by,
 * project_llm_keys.created_by). Those are project-level audit artifacts, so
 * they are REASSIGNED to the project's owner rather than destroyed — no DDL
 * needed and run history/cost attribution stays meaningful.
 *
 * Takes a transactional client (not the pool) so a test can pass a fake and
 * the caller controls BEGIN/COMMIT.
 */

import { supabaseAdmin } from "../../lib/supabase.js";

export interface TxClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export async function deleteAccountTx(client: TxClient, userId: string): Promise<void> {
  // 1. Reassign cross-project RESTRICT references to that project's owner.
  //    Rows inside projects the user OWNS are excluded — the project cascade
  //    below removes them wholesale.
  await client.query(
    `UPDATE analysis_jobs aj SET requested_by = p.user_id
     FROM projects p
     WHERE aj.project_id = p.id AND aj.requested_by = $1 AND p.user_id <> $1`,
    [userId],
  );
  await client.query(
    `UPDATE onboarding_packages op SET generated_by = p.user_id
     FROM projects p
     WHERE op.project_id = p.id AND op.generated_by = $1 AND p.user_id <> $1`,
    [userId],
  );
  await client.query(
    `UPDATE project_llm_keys k SET created_by = p.user_id
     FROM projects p
     WHERE k.project_id = p.id AND k.created_by = $1 AND p.user_id <> $1`,
    [userId],
  );

  // 2. Invitations this user sent (invited_by is RESTRICT; accepted_by is
  //    SET NULL and needs nothing).
  await client.query(`DELETE FROM project_invitations WHERE invited_by = $1`, [userId]);

  // 3. Owned projects — cascades settings, members, scopes, snapshots, jobs,
  //    packages, sections, receipts, invitations, llm keys, the lot.
  await client.query(`DELETE FROM projects WHERE user_id = $1`, [userId]);

  // 4. The user row — cascades github_connections/installations, remaining
  //    project_members rows, and user_progress; SET NULLs the soft refs
  //    (reviewed_by, accepted_by, updated_by, created_by on scopes).
  await client.query(`DELETE FROM public.users WHERE id = $1`, [userId]);
}

/** Shape of the one admin-auth call we make, injectable for tests. */
export interface AuthAdminLike {
  auth: {
    admin: {
      deleteUser: (id: string) => Promise<{
        error: { message: string; status?: number; code?: string } | null;
      }>;
    };
  };
}

/**
 * Deletes the Supabase auth user, treating "user not found" as success:
 * JWT verification is stateless (JWKS), so a session can outlive its auth
 * user — e.g. an earlier deletion attempt, or a dashboard-side removal.
 * Retrying such an account used to 500 forever ("removing the sign-in
 * failed") even though the goal state (auth user gone) was already reached.
 */
export async function deleteAuthUser(
  userId: string,
  admin: AuthAdminLike = supabaseAdmin,
): Promise<"deleted" | "already_gone"> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (!error) return "deleted";
  const alreadyGone =
    error.status === 404 || error.code === "user_not_found" || /not found/i.test(error.message);
  if (alreadyGone) {
    console.warn(`Auth user ${userId} already absent — treating deletion as complete`);
    return "already_gone";
  }
  throw new Error(error.message);
}
