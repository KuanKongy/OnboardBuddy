import { Router } from "express";
import { requireProjectAccess } from "../middleware/project-access.js";
import { answerQuestion, NoSnapshotError } from "../../qa/askService.js";
import { AiDisabledError } from "../../worker/ai/privacy.js";
import { BudgetExceededError } from "../../worker/ai/budgetEnforcer.js";
import type { DeveloperRole } from "../../worker/semantic/projections.js";
import { BadPackageParamError, PackageNotFoundError, readPackageParam, resolvePackageContext } from "../services/packageResolver.js";

/**
 * Grounded Q&A evaluation endpoint (doc/Pipeline.md) — a dev tool for
 * answer-quality evaluation, not a product feature. Answers are audited
 * in ai_generation_runs but never persisted as content.
 */
export const askRouter = Router({ mergeParams: true });

const ROLES = new Set(["backend", "frontend", "devops", "qa", "general"]);

askRouter.post("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = String(req.params.id);
    const { question, scope_id, role, snapshot_id, package_id } = (req.body ?? {}) as {
      question?: string;
      scope_id?: string;
      role?: string;
      snapshot_id?: string;
      package_id?: string;
    };

    if (typeof question !== "string" || question.trim().length < 3) {
      res.status(400).json({ error: "question must be a non-trivial string" });
      return;
    }
    if (role !== undefined && !ROLES.has(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    // package_id (the sidebar selection) grounds the answer in that
    // package's snapshot; explicit snapshot_id/scope_id still win.
    let effectiveSnapshotId = snapshot_id;
    if (!effectiveSnapshotId && package_id !== undefined) {
      try {
        const ctx = await resolvePackageContext({
          projectId,
          userId: req.user?.id ?? null,
          packageId: readPackageParam(package_id),
        });
        effectiveSnapshotId = ctx?.snapshotId;
      } catch (err) {
        if (err instanceof BadPackageParamError) {
          res.status(400).json({ error: err.message });
          return;
        }
        if (err instanceof PackageNotFoundError) {
          res.status(404).json({ error: "Package not found" });
          return;
        }
        throw err;
      }
    }

    const answer = await answerQuestion({
      projectId,
      question: question.trim(),
      scopeId: scope_id,
      role: role as DeveloperRole | undefined,
      snapshotId: effectiveSnapshotId,
    });
    res.json({ answer });
  } catch (err) {
    if (err instanceof NoSnapshotError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof AiDisabledError) {
      res.status(403).json({ error: "AI features are disabled for this project" });
      return;
    }
    if (err instanceof BudgetExceededError) {
      res.status(429).json({ error: `Analysis budget exhausted (${err.limit}) — raise the budget to keep asking` });
      return;
    }
    console.error("Ask error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
