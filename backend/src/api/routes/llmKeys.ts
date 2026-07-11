import { Router } from "express";
import { query } from "../../lib/db.js";
import { encrypt } from "../../lib/encryption.js";
import { requireProjectAccess } from "../middleware/project-access.js";
import { resolveTierConfig } from "../../worker/ai/modelTiers.js";

/**
 * Per-project BYO LLM key (doc/Pipeline.md "BYO LLM keys"): editable only
 * by owner/admin; teammates may see provider name, model names, key
 * existence, and token usage/cost — never the key value.
 */
export const llmKeysRouter = Router({ mergeParams: true });

llmKeysRouter.get("/", requireProjectAccess(), async (req, res) => {
  try {
    const projectId = req.params.id;

    const [keyResult, settingsResult, usageResult] = await Promise.all([
      query(
        `SELECT k.provider, k.created_at, k.updated_at, u.email AS created_by_email
         FROM project_llm_keys k
         LEFT JOIN users u ON u.id = k.created_by
         WHERE k.project_id = $1`,
        [projectId],
      ),
      query(
        `SELECT model_tier_overrides, model_failure_behavior FROM project_settings WHERE project_id = $1`,
        [projectId],
      ),
      query(
        `SELECT r.key_source,
                COUNT(*)::int AS calls,
                COALESCE(SUM((r.token_usage->>'inputTokens')::bigint), 0)::bigint AS input_tokens,
                COALESCE(SUM((r.token_usage->>'outputTokens')::bigint), 0)::bigint AS output_tokens,
                COALESCE(SUM(r.estimated_cost_usd), 0)::numeric AS estimated_cost_usd
         FROM ai_generation_runs r
         JOIN analysis_snapshots s ON s.id = r.snapshot_id
         WHERE s.project_id = $1 AND r.status = 'complete'
         GROUP BY r.key_source`,
        [projectId],
      ),
    ]);

    const settings = settingsResult.rows[0] as
      | { model_tier_overrides: unknown; model_failure_behavior: unknown }
      | undefined;
    const tierConfig = resolveTierConfig({
      modelTierOverrides: settings?.model_tier_overrides,
      modelFailureBehavior: settings?.model_failure_behavior,
    });

    const keyRow = keyResult.rows[0] as
      | { provider: string; created_at: string; updated_at: string; created_by_email: string | null }
      | undefined;

    // The key value itself is never returned — existence and metadata only.
    res.json({
      key: keyRow
        ? {
            exists: true,
            provider: keyRow.provider,
            created_by: keyRow.created_by_email,
            created_at: keyRow.created_at,
            updated_at: keyRow.updated_at,
          }
        : { exists: false, provider: "openrouter" },
      models: tierConfig.models,
      usage_by_key_source: usageResult.rows,
    });
  } catch (err) {
    console.error("Get LLM key error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

llmKeysRouter.put("/", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.user!.id;
    const { api_key, provider = "openrouter" } = (req.body ?? {}) as { api_key?: string; provider?: string };

    if (typeof api_key !== "string" || api_key.trim().length < 8) {
      res.status(400).json({ error: "api_key must be a non-trivial string" });
      return;
    }
    if (provider !== "openrouter") {
      res.status(400).json({ error: "Only the 'openrouter' provider is supported" });
      return;
    }

    await query(
      `INSERT INTO project_llm_keys (project_id, provider, api_key_encrypted, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, provider) DO UPDATE
         SET api_key_encrypted = EXCLUDED.api_key_encrypted,
             created_by = EXCLUDED.created_by,
             updated_at = NOW()`,
      [projectId, provider, encrypt(api_key.trim()), userId],
    );

    res.json({ key: { exists: true, provider } });
  } catch (err) {
    console.error("Set LLM key error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

llmKeysRouter.delete("/", requireProjectAccess("owner", "admin"), async (req, res) => {
  try {
    const projectId = req.params.id;
    const { provider = "openrouter" } = (req.body ?? {}) as { provider?: string };

    await query(`DELETE FROM project_llm_keys WHERE project_id = $1 AND provider = $2`, [projectId, provider]);

    res.json({ key: { exists: false, provider } });
  } catch (err) {
    console.error("Delete LLM key error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
