import * as ts from 'typescript';
import * as path from 'path';
import type { FileEntry } from '../types/analysis.js';

export interface ParsedSourceFile {
  filePath: string;
  sourceFile: ts.SourceFile;
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  hasErrors: boolean;
  errors: string[];
}

export function createProgram(files: FileEntry[], rootPath: string): ts.Program {
  const filePaths = files.map((f) => f.absolutePath);

  const configPath = ts.findConfigFile(rootPath, ts.sys.fileExists, 'tsconfig.json');
  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    allowJs: true,
    jsx: ts.JsxEmit.React,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
  };

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
    compilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true };
  }

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
  return match ? match[0].trim() : undefined;
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
