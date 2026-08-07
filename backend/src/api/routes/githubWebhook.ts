/**
 * GitHub App push webhook → auto re-analysis (doc/DEVOPS.md "GitHub App
 * webhook"). Opt-in per project via project_settings.auto_reanalyze_on_push
 * (default OFF). A push to branch X triggers one incremental run per scope
 * that has onboarding packages on X — pushes to branches nobody generated
 * docs for are ignored, and incremental runs stale-flag sections without
 * rebuilding packages (existing semantics).
 *
 * A push whose commit is no longer the branch's HEAD is dropped before any run
 * is prepared — see "Superseded-push guard" below. Ref shapes are settled
 * before the guard is ever consulted, so it cannot misfire on them: tag and
 * other non-`refs/heads/` refs exit at `not_a_branch`, branch deletions at
 * `branch_deleted`, and the all-zero SHA at `no_head_commit` (a deleted
 * branch's HEAD lookup would 404, and a tag's would resolve the wrong ref).
 * A force-push is deliberately NOT skipped: `after` is where the branch now
 * points, so it equals HEAD and the guard passes it through — the rewritten
 * history is the branch's truth and must be analyzed.
 *
 * Mounted with express.raw BEFORE the global JSON parser (app.ts) so the
 * HMAC signature is verified against the exact raw bytes. Unauthenticated by
 * design; the signature is the auth. Runs are attributed to the project
 * owner (analysis_jobs.requested_by is NOT NULL).
 */

import crypto from "node:crypto";
import { Router } from "express";
import { pool, query } from "../../lib/db.js";
import { envInt } from "../../lib/env.js";
import { getCommitSha, getInstallationToken } from "../../lib/github.js";
import type { AnalysisJobData } from "../../lib/queue.js";
import { enqueueAnalysisRun, prepareAnalysisRun } from "../services/analysisStarter.js";

/** Constant-time check of GitHub's `X-Hub-Signature-256: sha256=<hex>` header. */
export function verifyGithubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

interface PushPayload {
  ref?: string;
  after?: string;
  deleted?: boolean;
  /** The pushed commit itself; its message is what the package card shows. */
  head_commit?: { message?: string };
  repository?: { name?: string; owner?: { login?: string; name?: string } };
  installation?: { id?: number | string };
}

/* ── Superseded-push guard ──────────────────────────────────────────────────
 *
 * A webhook delivery can arrive AFTER the commit it describes has already been
 * replaced on the branch: GitHub retries a delivery that timed out, an operator
 * hits "Redeliver", or two pushes land seconds apart and their deliveries are
 * processed out of order. Analyzing that push writes a snapshot for a commit
 * nobody will ever look at, and — because every stored column (both
 * analysis_jobs.created_at and analysis_snapshots.created_at) records when the
 * run was SEEN, not when the commit was authored — that snapshot outranks the
 * newer one and the whole project starts serving stale docs.
 *
 * Observed live on project 4b0c28ca-73dd-433a-a2e8-e9fc664df3ec
 * (ng-eugene/onboardbuddy-webhook-mock): `92d55be1` is the PARENT of `fb5a2146`
 * yet its job row was inserted five minutes later, so lib/snapshotOrdering.ts
 * — which is right about everything it can see — ranks the parent as latest.
 * No ordering over stored rows can detect this; the discriminator is git
 * ancestry, which we never persist (the worker ingests a zipball, not history).
 *
 * So we ask GitHub instead, at webhook time, while the answer still exists:
 * is the pushed commit still the branch's HEAD? If it is not, this push has
 * been superseded and running it is pure waste (LLM spend included).
 *
 * Deliberately NOT a general "is this commit old" check. Only push-triggered
 * runs are guarded — POST /projects/:id/analyze (projects.ts) is untouched, so
 * a human deliberately re-analyzing an old commit still gets exactly that.
 *
 * Residual risk, accepted: the skipped push relies on the newer commit's own
 * delivery to cover the branch. If GitHub never delivers that one at all (not
 * merely late — never), the branch stays un-analyzed until the next push or a
 * manual run. That is the same exposure as any single dropped delivery today,
 * and GitHub retries failed deliveries.
 */

/** Bound the two GitHub calls so a slow API can never push a delivery toward
 *  GitHub's ~10s timeout — a timed-out delivery gets REDELIVERED later, which
 *  is the very bug class this guard exists to fix. Expiry = analyze anyway. */
const HEAD_CHECK_TIMEOUT_MS = envInt("WEBHOOK_HEAD_CHECK_TIMEOUT_MS", 3000);

export type PushHeadVerdict =
  /** The branch has moved past this commit — skip the run. */
  | { superseded: true; head: string }
  /** Analyze. `at_head` = confirmed current; `lookup_failed` = we could not tell. */
  | { superseded: false; reason: "at_head" | "lookup_failed"; detail?: string };

/** Rejects with a timeout error instead of waiting forever; the losing promise
 *  keeps its handlers attached so a late rejection can't go unhandled. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err as Error); },
    );
  });
}

/**
 * Is the pushed commit still `branch`'s HEAD on GitHub?
 *
 * FAIL-OPEN BY CONSTRUCTION: every failure mode — missing installation id,
 * token error, rate limit, network blip, timeout, unparseable response —
 * returns `superseded: false` so the push is analyzed. Dropping a legitimate
 * push because an auxiliary check errored is strictly worse than the staleness
 * this guards against, and the caller has no way to retry it later.
 */
export async function checkPushSuperseded(opts: {
  installationId: string;
  owner: string;
  repo: string;
  branch: string;
  commit: string;
}): Promise<PushHeadVerdict> {
  const { installationId, owner, repo, branch, commit } = opts;
  const failOpen = (detail: string): PushHeadVerdict => {
    console.warn(`[webhook] HEAD check unavailable for ${owner}/${repo}@${branch} — analyzing anyway: ${detail}`);
    return { superseded: false, reason: "lookup_failed", detail };
  };

  if (!/^\d+$/.test(installationId)) return failOpen("no GitHub App installation id");

  let head: string;
  try {
    head = (await withTimeout(
      (async () => {
        const token = await getInstallationToken(Number(installationId));
        return getCommitSha(token, owner, repo, branch);
      })(),
      HEAD_CHECK_TIMEOUT_MS,
      "HEAD lookup",
    )).trim().toLowerCase();
  } catch (err) {
    return failOpen(err instanceof Error ? err.message : String(err));
  }

  // A 40-hex SHA is the only answer we can act on. Anything else (HTML error
  // page, empty body, short SHA) means we did not really learn the HEAD.
  if (!/^[0-9a-f]{40}$/.test(head)) return failOpen(`unexpected HEAD response ${JSON.stringify(head.slice(0, 60))}`);
  if (head === commit.toLowerCase()) return { superseded: false, reason: "at_head" };
  return { superseded: true, head };
}

export const githubWebhookRouter = Router();

githubWebhookRouter.post("/", async (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[webhook] delivery received but GITHUB_WEBHOOK_SECRET is not set");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!verifyGithubSignature(rawBody, req.headers["x-hub-signature-256"] as string | undefined, secret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.headers["x-github-event"];
  if (event === "ping") {
    res.json({ ok: true, pong: true });
    return;
  }
  if (event !== "push") {
    // 2xx so GitHub doesn't mark unrelated event deliveries as failed.
    res.json({ ok: true, ignored: String(event ?? "unknown") });
    return;
  }

  let payload: PushPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as PushPayload;
  } catch {
    res.status(400).json({ error: "Malformed JSON payload" });
    return;
  }

  if (payload.deleted === true) {
    res.json({ ok: true, skipped: "branch_deleted" });
    return;
  }
  if (!payload.ref?.startsWith("refs/heads/")) {
    res.json({ ok: true, skipped: "not_a_branch" });
    return;
  }
  const commit = payload.after ?? "";
  if (!/^[0-9a-f]{40}$/i.test(commit) || /^0+$/.test(commit)) {
    res.json({ ok: true, skipped: "no_head_commit" });
    return;
  }
  const branch = payload.ref.slice("refs/heads/".length);
  const owner = payload.repository?.owner?.login ?? payload.repository?.owner?.name ?? "";
  const repo = payload.repository?.name ?? "";
  const installationId = String(payload.installation?.id ?? "");
  if (!owner || !repo) {
    res.json({ ok: true, skipped: "no_repository" });
    return;
  }

  try {
    // Every project importing this repo with the setting ON (a repo can be
    // imported by several users — each is its own onboarding context).
    const projects = (await query(
      `SELECT p.id, p.user_id, p.branch AS default_branch, p.github_installation_id
       FROM projects p
       JOIN project_settings ps ON ps.project_id = p.id
       WHERE p.repo_owner = $1 AND p.repo_name = $2
         AND ($3 = '' OR p.github_installation_id = $3)
         AND ps.auto_reanalyze_on_push = true`,
      [owner, repo, installationId],
    )).rows as Array<{ id: string; user_id: string; default_branch: string; github_installation_id: string | null }>;

    if (projects.length === 0) {
      res.json({ ok: true, skipped: "no_matching_projects" });
      return;
    }

    // One HEAD lookup per delivery at most, and only once we know there is real
    // work to enqueue: the verdict depends on (repo, branch) alone, so it is
    // shared by every matching project, and the cheap "nobody opted in" /
    // "no packages on this branch" exits stay free of GitHub latency.
    let headVerdict: Promise<PushHeadVerdict> | undefined;
    const isSuperseded = (fallbackInstallationId: string | null) =>
      (headVerdict ??= checkPushSuperseded({
        // The payload carries the installation for App deliveries; the project
        // row is the fallback for a delivery that omits it.
        installationId: installationId || String(fallbackInstallationId ?? ""),
        owner, repo, branch, commit,
      }));

    const enqueued: Array<{ jobId: string; data: AnalysisJobData }> = [];
    let matchedProjects = 0;

    for (const project of projects) {
      // Only scopes someone actually generated docs for on this branch.
      const scopes = (await query(
        `SELECT DISTINCT op.scope_id FROM onboarding_packages op
         WHERE op.project_id = $1 AND op.branch = $2`,
        [project.id, branch],
      )).rows as Array<{ scope_id: string }>;
      if (scopes.length === 0) continue;
      matchedProjects += 1;

      // Checked BEFORE the first transaction, so a superseded delivery inserts
      // no analysis_jobs row for any project and leaves nothing to clean up.
      const verdict = await isSuperseded(project.github_installation_id);
      if (verdict.superseded) {
        // Structured console line, not an analysis_jobs row: `status` is
        // CHECK-constrained to queued/running/paused/complete/failed
        // (001_initial_schema.sql), so a "skipped" row would need a production
        // migration — the option explicitly ruled out — and any of the allowed
        // states would lie to the run history and to snapshotOrdering's
        // MIN(analysis_jobs.created_at) push clock. Logs are how the rest of
        // this handler records its decisions.
        console.log(
          `[webhook] skipped superseded push ${owner}/${repo}@${branch} ` +
          `commit=${commit} head=${verdict.head} ` +
          `— branch HEAD moved on before this delivery was processed, no run enqueued`,
        );
        res.json({ ok: true, skipped: "superseded_commit", commit, head: verdict.head });
        return;
      }

      const client = await pool.connect();
      const prepared: Array<{ jobId: string; scopeId: string }> = [];
      try {
        await client.query("BEGIN");
        await client.query(`SELECT id FROM projects WHERE id = $1 FOR UPDATE`, [project.id]);
        for (const { scope_id } of scopes) {
          const result = await prepareAnalysisRun(client, {
            projectId: project.id,
            requestedBy: project.user_id,
            projectDefaultBranch: project.default_branch,
            scopeId: scope_id,
            branch,
            commit,
            // GitHub already told us what this push was; a run started from a
            // webhook has no other chance to learn its commit subject.
            commitMessage: payload.head_commit?.message ?? null,
          });
          // active_twin = an identical run is already queued/running (e.g. a
          // redelivered webhook) — skipping keeps deliveries idempotent.
          if (result.ok) prepared.push({ jobId: result.jobId, scopeId: scope_id });
        }
        if (prepared.length > 0) {
          await client.query(`UPDATE projects SET status = 'analyzing' WHERE id = $1`, [project.id]);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[webhook] enqueue failed for project ${project.id}:`, err instanceof Error ? err.message : err);
        continue;
      } finally {
        client.release();
      }

      for (const { jobId, scopeId } of prepared) {
        enqueued.push({
          jobId,
          // autoGenerate=false: pushes stale-flag existing packages, they
          // never trigger LLM generation spend on their own.
          data: { jobId, projectId: project.id, scopeId, branch, commit, autoGenerate: false } satisfies AnalysisJobData,
        });
      }
    }

    // Bug #69(1): each submission fails its own row when it throws
    // (enqueueAnalysisRun). Keep going regardless — one unreachable-queue
    // error must not strand the sibling scopes' rows on 'queued' forever.
    for (const { jobId, data } of enqueued) {
      await enqueueAnalysisRun(jobId, data).catch((err) => {
        console.error(`[webhook] could not queue run ${jobId}:`, err instanceof Error ? err.message : err);
      });
    }

    if (enqueued.length === 0) {
      res.json({ ok: true, skipped: matchedProjects === 0 ? "no_packages_on_branch" : "runs_already_active" });
      return;
    }
    console.log(`[webhook] push ${owner}/${repo}@${branch} → ${enqueued.length} incremental run(s)`);
    res.status(202).json({ ok: true, projects: matchedProjects, jobs: enqueued.map((e) => e.jobId) });
  } catch (err) {
    console.error("[webhook] push handling error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error" });
  }
});
