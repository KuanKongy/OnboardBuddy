import * as ts from 'typescript';
import type { FileEntry } from '../types/analysis.js';
import { collectPathAliases } from './tsconfigPaths.js';
import { redactSecrets } from './secretRedactor.js';

export interface ParsedSourceFile {
  filePath: string;
  sourceFile: ts.SourceFile;
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  hasErrors: boolean;
  errors: string[];
}

/**
 * One program over the whole scope with deterministic compiler options.
 * We deliberately do NOT load the repo's own tsconfig wholesale: the worker
 * analyzes a zipball extract (no node_modules, monorepos often have no root
 * tsconfig.json, and findConfigFile's upward walk can escape the extraction
 * dir). Bundler resolution handles extensionless, `.js`→`.ts` and index
 * imports; `paths` are merged from every workspace tsconfig so alias imports
 * (`@/components/x`) resolve to repo files instead of fake packages.
 */
export function createProgram(files: FileEntry[], rootPath: string): ts.Program {
  const filePaths = files.map((f) => f.absolutePath);
  const aliases = collectPathAliases(rootPath);

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    experimentalDecorators: true,
    baseUrl: rootPath,
    ...(Object.keys(aliases.paths).length > 0 ? { paths: aliases.paths } : {}),
  };

  return ts.createProgram(filePaths, compilerOptions);
}

export function parseSourceFile(
  program: ts.Program,
  filePath: string,
): ParsedSourceFile {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`Source file not found in program: ${filePath}`);
  }

  const typeChecker = program.getTypeChecker();
  const diagnostics = program.getSyntacticDiagnostics(sourceFile);

  const errors = diagnostics.map((d) =>
    typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText,
  );

  return {
    filePath,
    sourceFile,
    program,
    typeChecker,
    hasErrors: errors.length > 0,
    errors,
  };
}

export function getLeadingJsDoc(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const fullText = sourceFile.getFullText();
  const triviaStart = node.getFullStart();
  const triviaEnd = node.getStart(sourceFile);
  const trivia = fullText.slice(triviaStart, triviaEnd);

  const match = trivia.match(/\/\*\*([\s\S]*?)\*\//);
  // Doc comments reach prompts via serializer.toSlimSymbol, and `@example`
  // blocks are a common place for a real key to be pasted.
  return match ? redactSecrets(match[0].trim()) : undefined;
}

export function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

export function isDefaultExport(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

export function getNodeLocation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { start: { line: number; column: number }; end: { line: number; column: number } } {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    start: { line: start.line + 1, column: start.character },
    end: { line: end.line + 1, column: end.character },
  };
}
