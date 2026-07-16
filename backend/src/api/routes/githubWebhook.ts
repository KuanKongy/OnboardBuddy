/**
 * GitHub App push webhook → auto re-analysis (doc/DEVOPS.md "GitHub App
 * webhook"). Opt-in per project via project_settings.auto_reanalyze_on_push
 * (default OFF). A push to branch X triggers one incremental run per scope
 * that has onboarding packages on X — pushes to branches nobody generated
 * docs for are ignored, and incremental runs stale-flag sections without
 * rebuilding packages (existing semantics).
 *
 * Mounted with express.raw BEFORE the global JSON parser (app.ts) so the
 * HMAC signature is verified against the exact raw bytes. Unauthenticated by
 * design; the signature is the auth. Runs are attributed to the project
 * owner (analysis_jobs.requested_by is NOT NULL).
 */

import crypto from "node:crypto";
import { Router } from "express";
import { pool, query } from "../../lib/db.js";
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
  repository?: { name?: string; owner?: { login?: string; name?: string } };
  installation?: { id?: number | string };
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
      `SELECT p.id, p.user_id, p.branch AS default_branch
       FROM projects p
       JOIN project_settings ps ON ps.project_id = p.id
       WHERE p.repo_owner = $1 AND p.repo_name = $2
         AND ($3 = '' OR p.github_installation_id = $3)
         AND ps.auto_reanalyze_on_push = true`,
      [owner, repo, installationId],
    )).rows as Array<{ id: string; user_id: string; default_branch: string }>;

    if (projects.length === 0) {
      res.json({ ok: true, skipped: "no_matching_projects" });
      return;
    }

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

    for (const { jobId, data } of enqueued) {
      await enqueueAnalysisRun(jobId, data);
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
