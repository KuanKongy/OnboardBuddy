import * as path from 'node:path';
import type * as ts from 'typescript';
import type { FileEntry, FileAnalysis } from '../types/analysis.js';
import { createProgram, parseSourceFile } from './astParser.js';
import { extractFileAnalysis } from './symbolExtractor.js';

/**
 * Language parser abstraction (doc/Pipeline.md "Parser interface"). The
 * pipeline talks to this interface only; TypeScript/JavaScript via the TS
 * Compiler API (`allowJs`) is the sole implementation today, future languages
 * plug in without touching the pipeline.
 */
export interface ParserContext {
  parserId: string;
  rootPath: string;
  /** Implementation-specific state; the TS parser stores its Program here. */
  state: unknown;
}

export interface LanguageParser {
  id: string;
  supportedExtensions: string[];
  supports(filePath: string): boolean;
  /** One context per run — the TS Program must span all files for cross-file resolution. */
  createContext(files: FileEntry[], rootPath: string): Promise<ParserContext>;
  parseFile(ctx: ParserContext, file: FileEntry): FileAnalysis;
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export const typescriptParser: LanguageParser = {
  id: 'typescript',
  supportedExtensions: TS_EXTENSIONS,

  supports(filePath: string): boolean {
    return TS_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
  },

  async createContext(files: FileEntry[], rootPath: string): Promise<ParserContext> {
    const program = createProgram(files, rootPath);
    return { parserId: 'typescript', rootPath, state: program };
  },

  parseFile(ctx: ParserContext, file: FileEntry): FileAnalysis {
    const program = ctx.state as ts.Program;
    const parsed = parseSourceFile(program, file.absolutePath);
    return extractFileAnalysis(parsed, ctx.rootPath);
  },
};

const REGISTERED_PARSERS: LanguageParser[] = [typescriptParser];

export function parserFor(filePath: string): LanguageParser | null {
  return REGISTERED_PARSERS.find((p) => p.supports(filePath)) ?? null;
}

export function registeredParsers(): LanguageParser[] {
  return [...REGISTERED_PARSERS];
}
