import * as ts from 'typescript';
import * as path from 'path';
import type {
  FileAnalysis,
  SymbolInfo,
  ImportRecord,
  ExportRecord,
  NamedImportItem,
  ParameterInfo,
  PropertyInfo,
  MethodInfo,
  ConstructorInfo,
  EnumMember,
  RouteRegistration,
} from '../types/analysis.js';
import {
  ParsedSourceFile,
  getLeadingJsDoc,
  isExported,
  isDefaultExport,
  getNodeLocation,
} from './astParser.js';
import { sha256, hashBody } from './hashUtils.js';
import { symbolKey, normalizePath } from './stableKeys.js';
import { MAX_SNIPPET_CHARS } from './budgets.js';

/**
 * Extraction context threaded to the per-kind extractors so they can produce
 * evidence identity (hashes, snippets, resolved calls) without re-walking.
 */
interface ExtractCtx {
  checker: ts.TypeChecker | null;
  rootPath: string;
}

export function extractFileAnalysis(parsed: ParsedSourceFile, rootPath: string): FileAnalysis {
  const { filePath, sourceFile } = parsed;
  const relativePath = path.relative(rootPath, filePath);
  const ctx: ExtractCtx = { checker: parsed.typeChecker ?? null, rootPath };

  const symbols: SymbolInfo[] = [];
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];

  for (const statement of sourceFile.statements) {
    visitTopLevel(statement);
  }

  // Route registrations (`router.get('/x', handler)`) live anywhere in the
  // file, usually top-level with inline handlers — synthesize real symbol
  // nodes for those handlers so workflow tracing has a seed with a body.
  const routes = extractRouteRegistrations(sourceFile, relativePath, ctx, symbols);

  // Stamp stable keys (repo-local, '/'-separated) on every symbol.
  for (const sym of symbols) {
    sym.stableKey = symbolKey(normalizePath(relativePath), sym.name);
  }

  return {
    filePath,
    relativePath,
    symbols,
    imports,
    exports,
    ...(routes.length > 0 ? { routeRegistrations: routes } : {}),
    hasParseErrors: parsed.hasErrors,
    parseErrors: parsed.errors,
  };

  function visitTopLevel(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
        imports.push(extractImport(node as ts.ImportDeclaration, filePath));
        break;

      case ts.SyntaxKind.ExportDeclaration:
        exports.push(extractExportDeclaration(node as ts.ExportDeclaration, filePath));
        break;

      case ts.SyntaxKind.ExportAssignment: {
        const exportAssign = node as ts.ExportAssignment;
        exports.push({
          fromFile: filePath,
          namedExports: [],
          isReExport: false,
          isDefault: true,
          expression: exportAssign.expression.getText(sourceFile),
        });
        break;
      }

      case ts.SyntaxKind.ClassDeclaration: {
        const sym = extractClass(node as ts.ClassDeclaration, filePath, sourceFile, ctx);
        if (sym) symbols.push(sym);
        break;
      }

      case ts.SyntaxKind.InterfaceDeclaration: {
        const sym = extractInterface(node as ts.InterfaceDeclaration, filePath, sourceFile);
        if (sym) symbols.push(sym);
        break;
      }

      case ts.SyntaxKind.TypeAliasDeclaration: {
        const sym = extractTypeAlias(node as ts.TypeAliasDeclaration, filePath, sourceFile);
        if (sym) symbols.push(sym);
        break;
      }

      case ts.SyntaxKind.FunctionDeclaration: {
        const sym = extractFunction(node as ts.FunctionDeclaration, filePath, sourceFile, ctx);
        if (sym) symbols.push(sym);
        break;
      }

      case ts.SyntaxKind.VariableStatement: {
        const syms = extractVariableStatement(node as ts.VariableStatement, filePath, sourceFile, ctx);
        symbols.push(...syms);
        break;
      }

      case ts.SyntaxKind.EnumDeclaration: {
        const sym = extractEnum(node as ts.EnumDeclaration, filePath, sourceFile);
        if (sym) symbols.push(sym);
        break;
      }
    }
  }
}

// ─── Import extraction ────────────────────────────────────────────────────────

function extractImport(node: ts.ImportDeclaration, filePath: string): ImportRecord {
  const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
  const isTypeOnly = node.importClause?.isTypeOnly ?? false;
  const named: NamedImportItem[] = [];
  let defaultImport: string | undefined;
  let namespaceImport: string | undefined;

  const clause = node.importClause;
  if (clause) {
    if (clause.name) {
      defaultImport = clause.name.text;
    }
    const bindings = clause.namedBindings;
    if (bindings) {
      if (ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          named.push({
            name: el.propertyName?.text ?? el.name.text,
            isTypeOnly: el.isTypeOnly,
            alias: el.propertyName ? el.name.text : null,
          });
        }
      } else if (ts.isNamespaceImport(bindings)) {
        namespaceImport = bindings.name.text;
      }
    }
  }

  return {
    fromFile: filePath,
    toSpecifier: specifier,
    namedImports: named,
    defaultImport,
    namespaceImport,
    isTypeOnly,
  };
}

// ─── Export extraction ────────────────────────────────────────────────────────

function extractExportDeclaration(node: ts.ExportDeclaration, filePath: string): ExportRecord {
  const isReExport = node.moduleSpecifier !== undefined;
  const sourceSpecifier = isReExport
    ? (node.moduleSpecifier as ts.StringLiteral).text
    : undefined;

  const named: string[] = [];
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const el of node.exportClause.elements) {
      named.push(el.name.text);
    }
  }

  return {
    fromFile: filePath,
    namedExports: named,
    isReExport,
    sourceSpecifier,
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getAccessibility(node: ts.Node): 'public' | 'private' | 'protected' {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!mods) return 'public';
  if (mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
  if (mods.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  return 'public';
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === kind) ?? false;
}

function extractParameters(
  params: ts.NodeArray<ts.ParameterDeclaration>,
  sf: ts.SourceFile,
): ParameterInfo[] {
  return Array.from(params).map((p) => {
    const mods = ts.canHaveModifiers(p) ? ts.getModifiers(p) : undefined;
    const hasAccessMod = mods?.some(
      (m) =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword ||
        m.kind === ts.SyntaxKind.PublicKeyword,
    );

    const result: ParameterInfo = {
      name: p.name.getText(sf),
      type: p.type?.getText(sf) ?? 'any',
      optional: p.questionToken !== undefined,
      default: p.initializer?.getText(sf) ?? null,
    };

    if (hasAccessMod) {
      result.accessibility = getAccessibility(p);
    }

    return result;
  });
}

function buildSignature(params: ParameterInfo[], returnType: string): string {
  const paramStr = params
    .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`)
    .join(', ');
  return `(${paramStr}) => ${returnType}`;
}

function extractCallSymbols(body: ts.Node | undefined, sf: ts.SourceFile): string[] {
  if (!body) return [];
  const calls: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      calls.push(node.expression.getText(sf));
    }
    ts.forEachChild(node, visit);
  }

  visit(body);
  return [...new Set(calls)];
}

// ─── Evidence enrichment (hashes, snippets, resolved calls, triviality) ──────

/** Capped source snippet for prompts and receipts. */
function snippetOf(node: ts.Node, sf: ts.SourceFile): string {
  const text = node.getText(sf);
  return text.length > MAX_SNIPPET_CHARS ? text.slice(0, MAX_SNIPPET_CHARS) : text;
}

/**
 * Resolves each CallExpression's callee through the TypeChecker to a
 * repo-local declaration. External/library targets return no entry — they
 * become `external` handling elsewhere, never guessed edges.
 */
function extractResolvedCalls(
  body: ts.Node | undefined,
  sf: ts.SourceFile,
  ctx: ExtractCtx,
): import('../types/analysis.js').ResolvedCall[] {
  const checker = ctx.checker;
  if (!body || !checker) return [];
  const resolved: import('../types/analysis.js').ResolvedCall[] = [];
  const seen = new Set<string>();

  function record(expr: ts.Expression, calleeText: string): void {
    const target = resolveCallTarget(expr, checker!, ctx.rootPath);
    if (!target) return;
    const dedupe = `${target.targetRelativePath}#${target.targetParentName ?? ''}.${target.targetName}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    resolved.push({ callee: calleeText, ...target });
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      record(node.expression, node.expression.getText(sf));
    }
    // JSX usage is a call in flow terms: <UserCard/> runs UserCard. This is
    // what connects frontend components into the call graph.
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)) {
        record(tag, tag.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(body);
  return resolved;
}

// ─── Route registrations ─────────────────────────────────────────────────────

const ROUTE_METHOD_NAMES = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

/**
 * Finds Express-style route registrations anywhere in the file:
 * `router.get('/path', ...handlers)` with a string path starting with '/'.
 * Inline handlers become synthesized symbols (named `GET /path`) with real
 * bodies, hashes and resolved calls, so entrypoint detection gets a precise
 * seed instead of guessing from `*.get(...)` name matches (old bug: every
 * `map.get(...)` counted as an HTTP route).
 */
function extractRouteRegistrations(
  sourceFile: ts.SourceFile,
  relativePath: string,
  ctx: ExtractCtx,
  symbols: SymbolInfo[],
): RouteRegistration[] {
  const routes: RouteRegistration[] = [];
  const usedNames = new Set(symbols.map((s) => s.name));
  const normalizedPath = normalizePath(relativePath);

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ROUTE_METHOD_NAMES.has(node.expression.name.text) &&
      node.arguments.length >= 2 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.arguments[0] as ts.StringLiteralLike).text.startsWith('/')
    ) {
      const method = node.expression.name.text.toUpperCase();
      const routePath = (node.arguments[0] as ts.StringLiteralLike).text;
      const handler = node.arguments[node.arguments.length - 1]!;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

      if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
        let name = `${method} ${routePath}`;
        for (let i = 2; usedNames.has(name); i++) name = `${method} ${routePath} (${i})`;
        usedNames.add(name);
        const loc = getNodeLocation(node, sourceFile);
        const params = extractParameters(handler.parameters, sourceFile);
        const calls = extractCallSymbols(handler.body, sourceFile);
        const resolvedCalls = extractResolvedCalls(handler.body, sourceFile, ctx);
        const signature = buildSignature(params, 'void');
        symbols.push({
          name,
          kind: 'arrow-function',
          filePath: sourceFile.fileName,
          ...loc,
          exported: false,
          isDefault: false,
          signature,
          parameters: params,
          returnType: 'void',
          isAsync: hasModifier(handler, ts.SyntaxKind.AsyncKeyword),
          ...(calls.length > 0 ? { callsSymbols: calls } : {}),
          ...(resolvedCalls.length > 0 ? { resolvedCalls } : {}),
          signatureHash: sha256(`${method} ${routePath}${signature}`),
          bodyHash: hashBody(handler.getText(sourceFile)),
          snippet: snippetOf(node, sourceFile),
          isTrivial: false,
        });
        routes.push({ method, routePath, handlerSymbolName: name, handlerRelativePath: normalizedPath, line });
      } else if (ts.isIdentifier(handler) || ts.isPropertyAccessExpression(handler)) {
        const target = ctx.checker ? resolveCallTarget(handler, ctx.checker, ctx.rootPath) : null;
        routes.push({
          method,
          routePath,
          ...(target ? { handlerSymbolName: target.targetName, handlerRelativePath: target.targetRelativePath } : {}),
          line,
        });
      } else {
        routes.push({ method, routePath, line });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

function resolveCallTarget(
  expr: ts.Expression,
  checker: ts.TypeChecker,
  rootPath: string,
): Omit<import('../types/analysis.js').ResolvedCall, 'callee'> | null {
  try {
    const nameNode = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
    let sym = checker.getSymbolAtLocation(nameNode);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decl = sym.declarations?.[0];
    if (!decl) return null;
    const declFile = decl.getSourceFile();
    if (declFile.isDeclarationFile || declFile.fileName.includes('node_modules')) return null;
    const rel = path.relative(rootPath, declFile.fileName);
    if (rel.startsWith('..')) return null;

    let targetParentName: string | undefined;
    let current: ts.Node | undefined = decl.parent;
    while (current) {
      if (ts.isClassDeclaration(current) && current.name) {
        targetParentName = current.name.text;
        break;
      }
      current = current.parent;
    }

    return {
      targetRelativePath: rel.replace(/\\/g, '/'),
      targetName: sym.getName(),
      ...(targetParentName ? { targetParentName } : {}),
    };
  } catch {
    return null;
  }
}

const BRANCHING_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.ConditionalExpression,
]);

/**
 * Deterministic trivial-symbol classification (doc/Pipeline.md): no
 * branching, and either a single-expression pass-through body (chained calls
 * count as one delegation) or <= 3 statements with at most one call. Trivial
 * symbols get facts-only semantic records — no LLM call — except at full depth.
 */
function isTrivialBody(body: ts.Node | undefined, callCount: number): boolean {
  if (!body) return true;
  let statementCount = 0;
  let branching = false;

  function visit(node: ts.Node): void {
    if (branching) return;
    if (BRANCHING_KINDS.has(node.kind)) { branching = true; return; }
    if (ts.isStatement(node)) statementCount++;
    ts.forEachChild(node, visit);
  }
  visit(body);

  if (branching) return false;
  return statementCount <= 1 || (statementCount <= 3 && callCount <= 1);
}

/** Trivial type alias: short, no conditional/mapped/infer machinery. */
function isTrivialTypeAlias(definition: string): boolean {
  return definition.length < 200 && !/\b(extends|infer|keyof|in\b)/.test(definition);
}

// ─── Symbol extractors ────────────────────────────────────────────────────────

function extractClass(
  node: ts.ClassDeclaration,
  filePath: string,
  sf: ts.SourceFile,
  ctx: ExtractCtx,
): SymbolInfo | null {
  if (!node.name) return null;
  const loc = getNodeLocation(node, sf);

  let extendsClass: string | null = null;
  const implementsList: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      extendsClass = clause.types[0]?.expression.getText(sf) ?? null;
    } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
      for (const t of clause.types) {
        implementsList.push(t.expression.getText(sf));
      }
    }
  }

  const constructors: ConstructorInfo[] = node.members
    .filter(ts.isConstructorDeclaration)
    .map((ctor) => ({ parameters: extractParameters(ctor.parameters, sf) }));

  const properties: PropertyInfo[] = node.members
    .filter(ts.isPropertyDeclaration)
    .map((prop) => ({
      name: prop.name.getText(sf),
      type: prop.type?.getText(sf) ?? 'any',
      accessibility: getAccessibility(prop),
      readonly: hasModifier(prop, ts.SyntaxKind.ReadonlyKeyword),
      static: hasModifier(prop, ts.SyntaxKind.StaticKeyword),
    }));

  const methods: MethodInfo[] = node.members
    .filter(ts.isMethodDeclaration)
    .map((m) => {
      const params = extractParameters(m.parameters, sf);
      const retType = m.type?.getText(sf) ?? 'void';
      const mLoc = getNodeLocation(m, sf);
      const mCalls = extractCallSymbols(m.body, sf);
      const mResolved = extractResolvedCalls(m.body, sf, ctx);
      const signature = buildSignature(params, retType);
      const name = m.name.getText(sf);
      return {
        name,
        signature,
        parameters: params,
        returnType: retType,
        accessibility: getAccessibility(m),
        static: hasModifier(m, ts.SyntaxKind.StaticKeyword),
        isAsync: hasModifier(m, ts.SyntaxKind.AsyncKeyword),
        lineStart: mLoc.start.line,
        lineEnd: mLoc.end.line,
        ...(mCalls.length > 0 ? { callsSymbols: mCalls } : {}),
        ...(mResolved.length > 0 ? { resolvedCalls: mResolved } : {}),
        signatureHash: sha256(signature),
        bodyHash: hashBody(m.getText(sf)),
        snippet: snippetOf(m, sf),
        isTrivial: isTrivialBody(m.body, mCalls.length) || /^(get|set)[A-Z_]/.test(name),
      };
    });

  return {
    name: node.name.text,
    kind: 'class',
    filePath,
    ...loc,
    exported: isExported(node),
    isDefault: isDefaultExport(node),
    jsDoc: getLeadingJsDoc(node, sf),
    implements: implementsList,
    extendsClass,
    constructors,
    properties,
    methods,
    signatureHash: sha256(`class ${node.name.text}${extendsClass ? ` extends ${extendsClass}` : ''}`),
    bodyHash: hashBody(node.getText(sf)),
    snippet: snippetOf(node, sf),
    isTrivial: false,
  };
}

function extractInterface(
  node: ts.InterfaceDeclaration,
  filePath: string,
  sf: ts.SourceFile,
): SymbolInfo | null {
  const loc = getNodeLocation(node, sf);

  const extendsList: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    for (const t of clause.types) {
      extendsList.push(t.expression.getText(sf));
    }
  }

  const properties: PropertyInfo[] = [];
  for (const member of node.members) {
    if (ts.isPropertySignature(member)) {
      properties.push({
        name: member.name.getText(sf),
        type: member.type?.getText(sf) ?? 'any',
        optional: member.questionToken !== undefined,
        readonly:
          (ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined)?.some(
            (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
          ) ?? false,
      });
    } else if (ts.isMethodSignature(member)) {
      const params = Array.from(member.parameters).map(
        (p) =>
          `${p.name.getText(sf)}${p.questionToken ? '?' : ''}: ${p.type?.getText(sf) ?? 'any'}`,
      );
      const retType = member.type?.getText(sf) ?? 'void';
      properties.push({
        name: member.name.getText(sf),
        type: `(${params.join(', ')}) => ${retType}`,
        optional: member.questionToken !== undefined,
        readonly: false,
      });
    }
  }

  return {
    name: node.name.text,
    kind: 'interface',
    filePath,
    ...loc,
    exported: isExported(node),
    isDefault: false,
    jsDoc: getLeadingJsDoc(node, sf),
    properties,
    extends: extendsList,
    signatureHash: sha256(`interface ${node.name.text}`),
    bodyHash: hashBody(node.getText(sf)),
    snippet: snippetOf(node, sf),
    isTrivial: properties.length <= 3,
  };
}

function extractTypeAlias(
  node: ts.TypeAliasDeclaration,
  filePath: string,
  sf: ts.SourceFile,
): SymbolInfo | null {
  const loc = getNodeLocation(node, sf);
  const definition = node.type.getText(sf);
  return {
    name: node.name.text,
    kind: 'type',
    filePath,
    ...loc,
    exported: isExported(node),
    isDefault: false,
    definition,
    signatureHash: sha256(`type ${node.name.text}`),
    bodyHash: hashBody(node.getText(sf)),
    snippet: snippetOf(node, sf),
    isTrivial: isTrivialTypeAlias(definition),
  };
}

function extractFunction(
  node: ts.FunctionDeclaration,
  filePath: string,
  sf: ts.SourceFile,
  ctx: ExtractCtx,
): SymbolInfo | null {
  if (!node.name) return null;
  const loc = getNodeLocation(node, sf);
  const params = extractParameters(node.parameters, sf);
  const retType = node.type?.getText(sf) ?? 'void';
  const calls = extractCallSymbols(node.body, sf);
  const resolvedCalls = extractResolvedCalls(node.body, sf, ctx);
  const signature = buildSignature(params, retType);

  return {
    name: node.name.text,
    kind: 'function',
    filePath,
    ...loc,
    exported: isExported(node),
    isDefault: isDefaultExport(node),
    jsDoc: getLeadingJsDoc(node, sf),
    signature,
    parameters: params,
    returnType: retType,
    isAsync: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    ...(calls.length > 0 ? { callsSymbols: calls } : {}),
    ...(resolvedCalls.length > 0 ? { resolvedCalls } : {}),
    signatureHash: sha256(signature),
    bodyHash: hashBody(node.getText(sf)),
    snippet: snippetOf(node, sf),
    isTrivial: isTrivialBody(node.body, calls.length),
  };
}

function extractVariableStatement(
  node: ts.VariableStatement,
  filePath: string,
  sf: ts.SourceFile,
  ctx: ExtractCtx,
): SymbolInfo[] {
  const exported = isExported(node);
  const results: SymbolInfo[] = [];

  for (const decl of node.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name)) continue;

    const isArrow =
      decl.initializer !== undefined &&
      (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));

    const loc = getNodeLocation(decl, sf);
    const base: SymbolInfo = {
      name: decl.name.text,
      kind: isArrow ? 'arrow-function' : 'variable',
      filePath,
      ...loc,
      exported,
      isDefault: false,
      jsDoc: getLeadingJsDoc(node, sf),
    };

    if (
      isArrow &&
      decl.initializer &&
      (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
    ) {
      const fn = decl.initializer as ts.ArrowFunction | ts.FunctionExpression;
      const params = extractParameters(fn.parameters, sf);
      const retType = fn.type?.getText(sf) ?? decl.type?.getText(sf) ?? 'void';
      base.signature = buildSignature(params, retType);
      base.parameters = params;
      base.returnType = retType;
      base.isAsync = hasModifier(fn, ts.SyntaxKind.AsyncKeyword);
      const calls = extractCallSymbols(fn.body, sf);
      if (calls.length > 0) base.callsSymbols = calls;
      const resolvedCalls = extractResolvedCalls(fn.body, sf, ctx);
      if (resolvedCalls.length > 0) base.resolvedCalls = resolvedCalls;
      base.signatureHash = sha256(base.signature);
      base.isTrivial = isTrivialBody(fn.body, calls.length);
    } else {
      if (decl.type) base.typeAnnotation = decl.type.getText(sf);
      if (decl.initializer) base.initializer = decl.initializer.getText(sf);
      // Plain constants/values are trivial by definition — facts say it all.
      base.isTrivial = true;
    }

    base.bodyHash = hashBody(decl.getText(sf));
    base.snippet = snippetOf(node, sf);
    results.push(base);
  }

  return results;
}

function extractEnum(
  node: ts.EnumDeclaration,
  filePath: string,
  sf: ts.SourceFile,
): SymbolInfo | null {
  const loc = getNodeLocation(node, sf);
  const members: EnumMember[] = node.members.map((m) => {
    const rawValue = m.initializer?.getText(sf) ?? m.name.getText(sf);
    const value =
      (rawValue.startsWith('"') || rawValue.startsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    return { name: m.name.getText(sf), value };
  });

  return {
    name: node.name.text,
    kind: 'enum',
    filePath,
    ...loc,
    exported: isExported(node),
    isDefault: false,
    members,
    signatureHash: sha256(`enum ${node.name.text}`),
    bodyHash: hashBody(node.getText(sf)),
    snippet: snippetOf(node, sf),
    isTrivial: true,
  };
}
