/**
 * Orchestrates pipeline phases 7-12 (doc/Pipeline.md "Pipeline Phases"):
 * semantic_symbols -> synthesis -> capabilities -> refinement -> critique
 * -> semantic_ranking and embeddings, which are the one pair that runs
 * concurrently (see `concurrentTail`). Each phase gets a snapshot_phases row.
 * A budget
 * 'degrade' stops LLM work and skips the remaining phases (what exists is
 * kept; un-critiqued records stay 'pending' and are not used). Pause /
 * kill-switch / fail errors mark the phase and bubble up to the worker,
 * which owns job/snapshot status.
 */

import { markPhase } from '../ai/checkpoints.js';
import { AiPausedError } from '../ai/aiClient.js';
import { BudgetExceededError, KillSwitchError } from '../ai/budgetEnforcer.js';
import type { SemanticContext } from './context.js';
import { runSymbolPass, type SymbolPassResult } from './symbolPass.js';
import { runSynthesisPass, type SynthesisResult } from './synthesisPass.js';
import { runCapabilityPass } from './capabilityPass.js';
import { runRefinementPass } from './refinementPass.js';
import { runCritiquePass } from './critiquePass.js';
import { runSemanticReranking } from './semanticReranker.js';
import { runEmbeddingPass } from './embeddingPass.js';

export const SEMANTIC_PHASES = [
  'semantic_symbols', 'synthesis', 'capabilities', 'refinement', 'critique', 'semantic_ranking', 'embeddings',
] as const;

export interface SemanticPipelineOutcome {
  status: 'complete' | 'degraded';
  metrics: Record<string, Record<string, unknown>>;
}

export async function runSemanticPipeline(ctx: SemanticContext): Promise<SemanticPipelineOutcome> {
  const metrics: SemanticPipelineOutcome['metrics'] = {};
  let synthesis: SynthesisResult | null = null;

  // Phase 7 is special: the symbol pass degrades internally (facts-only
  // fallback for remaining targets) instead of throwing, so it completes
  // even on a budget trip — and the strong-tier phases are then skipped.
  await markPhase(ctx.snapshotId, 'semantic_symbols', 'running');
  let symbols: SymbolPassResult;
  try {
    symbols = await runSymbolPass(ctx);
  } catch (err) {
    await markPhaseForError(ctx, 'semantic_symbols', err);
    throw err;
  }
  metrics.semantic_symbols = symbolMetrics(symbols);
  await markPhase(ctx.snapshotId, 'semantic_symbols', 'complete', metrics.semantic_symbols);
  await ctx.ai.budget.flush();

  const phases: Array<{ name: (typeof SEMANTIC_PHASES)[number]; run: () => Promise<Record<string, unknown>> }> = [
    {
      name: 'synthesis',
      run: async () => {
        synthesis = await runSynthesisPass(ctx, symbols.records);
        return {
          fileRecords: synthesis.fileRecords.size, moduleRecords: synthesis.moduleRecords.size,
          serviceRecords: synthesis.serviceRecords.size, systemRecord: synthesis.systemRecord !== null,
          workflowRecords: synthesis.workflowRecords.size, cacheHits: synthesis.cacheHits,
        };
      },
    },
    {
      name: 'capabilities',
      run: async () => {
        const result = await runCapabilityPass(ctx, synthesis!);
        return { capabilities: result.capabilities, cacheHit: result.cacheHit };
      },
    },
    {
      name: 'refinement',
      run: async () => {
        const result = await runRefinementPass(ctx, symbols.records, synthesis!);
        return { refined: result.refined, cacheHits: result.cacheHits };
      },
    },
    {
      name: 'critique',
      run: async () => {
        const result = await runCritiquePass(ctx);
        return { reviewed: result.reviewed, usable: result.usable, rejected: result.rejected, regenerated: result.regenerated };
      },
    },
  ];

  /**
   * The last two phases run CONCURRENTLY, not head to tail: they are
   * write-disjoint (the reranker writes criticality_scores only, the embedding
   * pass writes embeddings only) and neither reads the other's output — both
   * consume the symbol records and synthesis that critique already gated.
   * Worth the special case because embeddings is the long pole: 673s of a
   * 15-minute job on snapshot 252239a3 (2026-07-27), against a rerank phase
   * that is mostly cheap-tier LLM latency.
   */
  const concurrentTail: typeof phases = [
    {
      name: 'semantic_ranking',
      run: async () => {
        const result = await runSemanticReranking(ctx, symbols.records, synthesis!);
        return { targets: result.targets, rowsWritten: result.rowsWritten, llmCalls: result.llmCalls };
      },
    },
    {
      name: 'embeddings',
      run: async () => {
        const result = await runEmbeddingPass(ctx);
        return { embedded: result.embedded, skippedExisting: result.skippedExisting, records: result.records, batches: result.batches };
      },
    },
  ];

  if (symbols.degraded) {
    // Budget already tripped during the cheap tier — don't start strong-tier work.
    for (const phase of [...phases, ...concurrentTail]) {
      await markPhase(ctx.snapshotId, phase.name, 'skipped', { reason: 'budget_degraded' });
    }
    return { status: 'degraded', metrics };
  }

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;
    await markPhase(ctx.snapshotId, phase.name, 'running');
    try {
      metrics[phase.name] = await phase.run();
      await markPhase(ctx.snapshotId, phase.name, 'complete', metrics[phase.name]);
      // Amortized budget counters land durably at every phase boundary.
      await ctx.ai.budget.flush();
    } catch (err) {
      if (err instanceof BudgetExceededError && err.behavior === 'degrade') {
        // Keep what exists; skip this phase's remainder and every later phase.
        for (const rest of [...phases.slice(i), ...concurrentTail]) {
          await markPhase(ctx.snapshotId, rest.name, 'skipped', { reason: 'budget_degraded' });
        }
        return { status: 'degraded', metrics };
      }
      await markPhaseForError(ctx, phase.name, err);
      throw err;
    }
  }

  // Each tail phase owns its own running/complete marks and its own metrics.
  // allSettled rather than all: whichever phase survives must not be left
  // sitting at 'running' because its sibling threw first, so both are allowed
  // to settle before anything is decided.
  const outcomes = await Promise.allSettled(concurrentTail.map(async (phase) => {
    await markPhase(ctx.snapshotId, phase.name, 'running');
    metrics[phase.name] = await phase.run();
    await markPhase(ctx.snapshotId, phase.name, 'complete', metrics[phase.name]);
  }));

  const rejected: Array<{ name: (typeof SEMANTIC_PHASES)[number]; err: unknown }> = [];
  for (let i = 0; i < concurrentTail.length; i++) {
    const outcome = outcomes[i]!;
    if (outcome.status === 'rejected') rejected.push({ name: concurrentTail[i]!.name, err: outcome.reason });
  }
  if (rejected.length === 0) {
    // One flush for the pair, where the sequential loop flushed per phase.
    await ctx.ai.budget.flush();
    return { status: 'complete', metrics };
  }
  // A phase that COMPLETED beside a failing sibling still has counters that
  // must survive, and a flush error here must not mask the real failure.
  await ctx.ai.budget.flush().catch(() => {});

  // Same bookkeeping as the sequential degrade branch above, applied per phase
  // because the pair can now fail independently: a budget degrade marks the
  // phase that tripped skipped and keeps whatever its sibling produced.
  for (const r of rejected) {
    if (r.err instanceof BudgetExceededError && r.err.behavior === 'degrade') {
      await markPhase(ctx.snapshotId, r.name, 'skipped', { reason: 'budget_degraded' });
    }
  }
  // A non-budget error is the louder failure and keeps today's surface: mark
  // it and rethrow, so a real fault is never reported as a budget degrade.
  const hard = rejected.find((r) => !(r.err instanceof BudgetExceededError && r.err.behavior === 'degrade'));
  if (hard) {
    await markPhaseForError(ctx, hard.name, hard.err);
    throw hard.err;
  }
  return { status: 'degraded', metrics };
}

async function markPhaseForError(ctx: SemanticContext, phase: string, err: unknown): Promise<void> {
  // Terminal path: whatever the in-memory counters say must survive.
  await ctx.ai.budget.flush().catch(() => {});
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof AiPausedError || err instanceof KillSwitchError ||
      (err instanceof BudgetExceededError && err.behavior === 'pause')) {
    await markPhase(ctx.snapshotId, phase, 'paused', {}, { errorMessage: message.slice(0, 300) });
  } else {
    await markPhase(ctx.snapshotId, phase, 'failed', {}, { errorMessage: message.slice(0, 500) });
  }
}

function symbolMetrics(symbols: SymbolPassResult): Record<string, unknown> {
  return {
    llmRecords: symbols.llmRecords, factsOnlyRecords: symbols.factsOnlyRecords,
    cacheHits: symbols.cacheHits, carriedForward: symbols.carriedForward,
    retriedSymbols: symbols.retriedSymbols,
    failedSymbols: symbols.failedSymbols, budgetDegraded: symbols.degraded,
  };
}
