/**
 * Orchestrates pipeline phases 7-12 (doc/Pipeline.md "Pipeline Phases"):
 * semantic_symbols -> synthesis -> capabilities -> refinement -> critique
 * -> semantic_ranking. Each phase gets a snapshot_phases row. A budget
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
    for (const phase of phases) {
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
    } catch (err) {
      if (err instanceof BudgetExceededError && err.behavior === 'degrade') {
        // Keep what exists; skip this phase's remainder and every later phase.
        for (const rest of phases.slice(i)) {
          await markPhase(ctx.snapshotId, rest.name, 'skipped', { reason: 'budget_degraded' });
        }
        return { status: 'degraded', metrics };
      }
      await markPhaseForError(ctx, phase.name, err);
      throw err;
    }
  }

  return { status: 'complete', metrics };
}

async function markPhaseForError(ctx: SemanticContext, phase: string, err: unknown): Promise<void> {
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
    cacheHits: symbols.cacheHits, retriedSymbols: symbols.retriedSymbols,
    failedSymbols: symbols.failedSymbols, budgetDegraded: symbols.degraded,
  };
}
