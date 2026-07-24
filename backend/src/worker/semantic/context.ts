/**
 * Shared inputs threaded through every semantic pass. Built once by the
 * worker after the deterministic phases complete.
 */

import type { AiClient } from '../ai/aiClient.js';
import type { PrivacyMode } from '../ai/privacy.js';
import type { SemanticDepth } from '../engine/budgets.js';
import type { PriorSymbolRecord } from './recordStore.js';
import type { EvidenceGraph, RepoInventory } from '../types/analysis.js';
import type { DetectedEntrypoint } from '../engine/entrypointDetector.js';
import type { DetectedSideEffect } from '../engine/sideEffectDetector.js';
import type { ExtractedWorkflow } from '../engine/workflowExtractor.js';
import type { CandidateRanking, DepthGatingResult } from '../engine/candidateRanker.js';
import type { ArchitectureMap } from '../engine/architectureClusterer.js';

export interface SemanticContext {
  ai: AiClient;
  projectId: string;
  snapshotId: string;
  commitHash: string;
  depth: SemanticDepth;
  privacyMode: PrivacyMode;
  /** model_family per tier = the configured primary model id. */
  modelFamily: { cheap: string; strong: string };
  graph: EvidenceGraph;
  /** stableKey -> graph_nodes.id for this snapshot. */
  nodeIdMap: Map<string, string>;
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
  workflows: ExtractedWorkflow[];
  /** workflow stableKey -> workflows.id */
  workflowIdMap: Map<string, string>;
  architecture: ArchitectureMap;
  rankings: CandidateRanking[];
  gating: DepthGatingResult;
  inventory: RepoInventory;
  /**
   * Symbol records the previous scan mapped, captured before the mapping
   * delete (Track E): exact identity matches re-map without lookups or LLM.
   */
  priorSymbolRecords?: Map<string, PriorSymbolRecord>;
  /**
   * Batch-level progress callback (Track F): passes report done/total so
   * the job stops sitting at an opaque percentage for the whole semantic
   * phase. The worker throttles and maps phases onto the progress band.
   */
  onProgress?: (info: { phase: string; done: number; total: number; detail?: string }) => Promise<void>;
}
