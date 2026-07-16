import { expect } from "chai";
import {
  deleteAccountTx,
  deleteAuthUser,
  type AuthAdminLike,
  type TxClient,
} from "../../src/api/services/accountDeletion.js";

function fakeAdmin(error: { message: string; status?: number; code?: string } | null): AuthAdminLike {
  return { auth: { admin: { deleteUser: async () => ({ error }) } } };
}

describe("deleteAccountTx", () => {
  it("reassigns cross-project RESTRICT refs, then deletes in FK-safe order", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const client: TxClient = {
      query: async (text, params) => {
        calls.push({ text, params });
        return { rows: [] };
      },
    };

    await deleteAccountTx(client, "user-1");

    const sql = calls.map((c) => c.text.replace(/\s+/g, " ").trim());

    // 1-3. Reassignments target only OTHER people's projects and hand rows
    //      to that project's owner.
    const reassignments = sql.filter((t) => t.startsWith("UPDATE"));
    expect(reassignments).to.have.length(3);
    for (const t of reassignments) {
      expect(t).to.include("p.user_id <> $1");
      expect(t).to.include("= p.user_id");
    }
    expect(reassignments[0]).to.include("analysis_jobs");
    expect(reassignments[1]).to.include("onboarding_packages");
    expect(reassignments[2]).to.include("project_llm_keys");

    // 4-6. Deletes: sent invitations → owned projects (cascade) → user row.
    const deletes = sql.filter((t) => t.startsWith("DELETE"));
    expect(deletes[0]).to.include("project_invitations");
    expect(deletes[1]).to.include("FROM projects WHERE user_id = $1");
    expect(deletes[2]).to.include("FROM public.users WHERE id = $1");

    // Reassignment must happen BEFORE the user delete or RESTRICT FKs abort.
    expect(sql.findIndex((t) => t.includes("public.users"))).to.equal(sql.length - 1);
    for (const c of calls) expect(c.params).to.deep.equal(["user-1"]);
  });
});

describe("deleteAuthUser", () => {
  it("returns 'deleted' on success", async () => {
    expect(await deleteAuthUser("user-1", fakeAdmin(null))).to.equal("deleted");
  });

  it("treats a 404 as already gone (stale-session retry loop fix)", async () => {
    expect(
      await deleteAuthUser("user-1", fakeAdmin({ message: "User not found", status: 404 })),
    ).to.equal("already_gone");
  });

  it("treats the user_not_found code as already gone even without a status", async () => {
    expect(
      await deleteAuthUser("user-1", fakeAdmin({ message: "weird wording", code: "user_not_found" })),
    ).to.equal("already_gone");
  });

  it("rethrows every other auth error", async () => {
    try {
      await deleteAuthUser("user-1", fakeAdmin({ message: "Invalid API key", status: 401 }));
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).to.equal("Invalid API key");
    }
  });
});
