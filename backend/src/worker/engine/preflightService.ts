import * as fs from 'node:fs';
import type { LanguageInventory, RepoFileRecord, ScopeProposal } from '../types/analysis.js';
import {
  scanRepositoryFiles,
  buildLanguageInventory,
  detectRepoInventory,
} from './repoIngester.js';
import { proposeScopes } from './scopeProposal.js';
import {
  budgetForDepth,
  classifyScopeSize,
  costTierForUsd,
  CONFIRMATION_THRESHOLDS,
  DEPTH_SELECTION_RATIO,
  AVG_TOKENS_PER_CHEAP_CALL,
  AVG_TOKENS_PER_STRONG_CALL,
  SECTION_COUNT_ESTIMATE,
  TUTORIAL_COUNT_ESTIMATE,
  MAX_SYMBOLS_PER_CALL,
  EST_PRICE_PER_MTOK_CHEAP_USD,
  EST_PRICE_PER_MTOK_STRONG_USD,
  type SemanticDepth,
  type CostTier,
  type ScopeSizeClass,
} from './budgets.js';

/**
 * Preflight analysis preview (doc/Pipeline.md "Analysis preview"):
 * inventory + shallow syntactic parse ONLY — no TypeChecker, no call graph,
 * no ranking. Estimates are coarse by design so preflight stays fast.
 */

export interface PreflightPreview {
  scope: { pathPrefix: string };
  proposedScopes: ScopeProposal[];
  languageInventory: LanguageInventory;
  detectedFrameworks: string[];
  privacy: {
    mode: string;
    codeSnippetsLeaveSystem: boolean;
    llmCallsPlanned: boolean;
    evidenceSentToLlm: string[];
  };
  estimates: {
    files: number;
    supportedFiles: number;
    symbols: number;
    symbolsSelectedForLlm: number;
    llmCalls: number;
    inputTokens: { min: number; max: number };
    estimatedUsd: number;
    costTier: CostTier;
  };
  depth: SemanticDepth;
  sizeClass: ScopeSizeClass;
  warnings: string[];
  confirmationsRequired: string[];
  limitations: string;
}

export interface PreflightOptions {
  pathPrefix?: string;
  ignoredPaths?: string[];
  depth: SemanticDepth;
  privacyMode: 'full_ai' | 'facts_only_ai' | 'ai_disabled';
  budgetOverrides?: Partial<Record<'maxFiles' | 'maxSymbolsToLlm' | 'maxLlmCalls' | 'maxInputTokens' | 'maxRuntimeMs', number>>;
}

/** Declaration-counting regex — the "shallow syntactic parse". */
const DECLARATION_RE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+[A-Za-z_$]/gm;
const METHOD_RE = /^\s{2,}(public\s+|private\s+|protected\s+|static\s+|async\s+)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*[:{]/gm;

export async function runPreflight(rootPath: string, opts: PreflightOptions): Promise<PreflightPreview> {
  const fileRecords = await scanRepositoryFiles(rootPath, {
    ignoredPaths: opts.ignoredPaths,
    pathPrefix: opts.pathPrefix,
  });
  const languageInventory = buildLanguageInventory(fileRecords);
  const inventory = await detectRepoInventory(rootPath, fileRecords);
  const proposedScopes = proposeScopes(inventory, fileRecords);

  const supportedFiles = fileRecords.filter((r) => r.supported);
  const estSymbols = estimateSymbolCount(supportedFiles);

  const budget = budgetForDepth(opts.depth, opts.budgetOverrides);
  const selectionRatio = DEPTH_SELECTION_RATIO[opts.depth];
  const symbolsSelected = Math.min(Math.round(estSymbols * selectionRatio), budget.maxSymbolsToLlm);

  const aiDisabled = opts.privacyMode === 'ai_disabled';
  const symbolCalls = aiDisabled ? 0 : Math.ceil(symbolsSelected / MAX_SYMBOLS_PER_CALL);
  const synthesisCalls = aiDisabled
    ? 0
    : Math.ceil(supportedFiles.length / 10) + SECTION_COUNT_ESTIMATE + TUTORIAL_COUNT_ESTIMATE + 5;
  const llmCalls = symbolCalls + synthesisCalls;

  const inputTokensMax = symbolCalls * AVG_TOKENS_PER_CHEAP_CALL + synthesisCalls * AVG_TOKENS_PER_STRONG_CALL;
  const inputTokensMin = Math.round(inputTokensMax * 0.4);
  const estimatedUsd =
    (symbolCalls * AVG_TOKENS_PER_CHEAP_CALL * EST_PRICE_PER_MTOK_CHEAP_USD +
      synthesisCalls * AVG_TOKENS_PER_STRONG_CALL * EST_PRICE_PER_MTOK_STRONG_USD) /
    1_000_000;
  const costTier = costTierForUsd(estimatedUsd);

  const sizeClass = classifyScopeSize(supportedFiles.length, estSymbols);

  const warnings: string[] = [];
  const confirmations: string[] = [];

  if (languageInventory.supportedFileCount === 0) {
    warnings.push(
      'No supported source files (TypeScript/JavaScript) in this scope. Analysis will fail transparently instead of guessing.',
    );
  } else if (languageInventory.unsupportedFileCount > languageInventory.supportedFileCount) {
    warnings.push(
      `Most source files (${languageInventory.unsupportedFileCount}) are in unsupported languages; only TypeScript/JavaScript will be analyzed.`,
    );
  }
  if (sizeClass === 'large' || sizeClass === 'very_large') {
    warnings.push(`This scope is ${sizeClass === 'very_large' ? 'very large' : 'large'}; consider a smaller scope or a cheaper depth.`);
  }

  if (fileRecords.length > CONFIRMATION_THRESHOLDS.maxFiles) {
    confirmations.push(`File count ${fileRecords.length} exceeds ${CONFIRMATION_THRESHOLDS.maxFiles}`);
  }
  if (symbolsSelected > CONFIRMATION_THRESHOLDS.maxSymbolsToLlm) {
    confirmations.push(`Symbols selected for LLM (${symbolsSelected}) exceeds ${CONFIRMATION_THRESHOLDS.maxSymbolsToLlm}`);
  }
  if (llmCalls > CONFIRMATION_THRESHOLDS.maxLlmCalls) {
    confirmations.push(`Estimated LLM calls (${llmCalls}) exceeds ${CONFIRMATION_THRESHOLDS.maxLlmCalls}`);
  }
  if (costTier === 'high') {
    confirmations.push('Estimated cost tier is high');
  }
  if (opts.depth === 'full' && sizeClass === 'large') {
    confirmations.push('Full depth on a large scope requires explicit confirmation');
  }
  if (opts.depth === 'full' && sizeClass === 'very_large') {
    confirmations.push('Full depth on a very large scope requires a smaller scope, a raised budget, or a BYO key');
  }

  const evidenceSentToLlm = aiDisabled
    ? []
    : opts.privacyMode === 'facts_only_ai'
      ? ['extracted facts', 'signatures', 'graph metadata', 'doc/config facts']
      : ['code snippets (capped)', 'extracted facts', 'signatures', 'graph metadata', 'doc/config snippets'];

  return {
    scope: { pathPrefix: opts.pathPrefix ?? '' },
    proposedScopes,
    languageInventory,
    detectedFrameworks: inventory.detectedFrameworks,
    privacy: {
      mode: opts.privacyMode,
      codeSnippetsLeaveSystem: opts.privacyMode === 'full_ai',
      llmCallsPlanned: !aiDisabled,
      evidenceSentToLlm,
    },
    estimates: {
      files: fileRecords.length,
      supportedFiles: supportedFiles.length,
      symbols: estSymbols,
      symbolsSelectedForLlm: aiDisabled ? 0 : symbolsSelected,
      llmCalls,
      inputTokens: { min: inputTokensMin, max: inputTokensMax },
      estimatedUsd: Math.round(estimatedUsd * 100) / 100,
      costTier,
    },
    depth: opts.depth,
    sizeClass,
    warnings,
    confirmationsRequired: confirmations,
    limitations:
      'Preflight uses inventory and a shallow syntactic parse only (no TypeChecker, call graph, or ranking), so estimates are coarse by design.',
  };
}

function estimateSymbolCount(supportedFiles: RepoFileRecord[]): number {
  let count = 0;
  for (const file of supportedFiles) {
    try {
      const text = fs.readFileSync(file.absolutePath, 'utf8');
      count += (text.match(DECLARATION_RE) ?? []).length;
      count += Math.round((text.match(METHOD_RE) ?? []).length / 2); // methods over-match; damp
    } catch {
      // Unreadable file: fall back to a size-based guess (1 symbol / 40 lines).
      count += Math.max(1, Math.round((file.lineCount ?? 0) / 40));
    }
  }
  return count;
}
