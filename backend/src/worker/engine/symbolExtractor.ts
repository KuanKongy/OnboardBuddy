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
  UiRouteDeclaration,
  SocketHandler,
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

  // Sub-router mounts (`app.use('/api', router)`) — entrypoint detection
  // chains these so routes get their FULL path ("/api/projects/:id/…"),
  // not the ambiguous sub-router path ("GET /").
  const mounts = extractRouterMounts(sourceFile, ctx);

  // UI routes declared in a router config — the only source of a page's real
  // path, and of pages that live outside a conventional pages/ directory.
  const uiRoutes = extractUiRouteDeclarations(sourceFile);

  // Socket.IO events. Passed `symbols` for the same reason routes are: inline
  // handlers need synthesized symbol nodes so workflow tracing has a body to
  // trace from.
  const socketHandlers = extractSocketHandlers(sourceFile, relativePath, ctx, symbols);

  // A symbol can be exported by a later statement rather than an inline
  // modifier; only this pass sees both halves, so it runs before anything
  // downstream reads `exported`.
  reconcileExports(symbols, exports);

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
    ...(mounts.length > 0 ? { routerMounts: mounts } : {}),
    ...(uiRoutes.length > 0 ? { uiRouteDeclarations: uiRoutes } : {}),
    ...(socketHandlers.length > 0 ? { socketHandlers } : {}),
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
        const local = defaultExportLocalName(exportAssign.expression);
        exports.push({
          fromFile: filePath,
          namedExports: [],
          isReExport: false,
          isDefault: true,
          expression: exportAssign.expression.getText(sourceFile),
          ...(local ? { defaultLocalName: local } : {}),
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
  const locals: string[] = [];
  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const el of node.exportClause.elements) {
      named.push(el.name.text);
      // `export { load as loadUser }` — propertyName is the local declaration,
      // name is the public alias. Without the local name, reconciliation looks
      // up "loadUser" and finds nothing.
      locals.push((el.propertyName ?? el.name).text);
    }
  }

  return {
    fromFile: filePath,
    namedExports: named,
    isReExport,
    sourceSpecifier,
    ...(locals.length > 0 ? { localBindings: locals } : {}),
  };
}

/** Matches a bare JS identifier — anything else names no single declaration. */
const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// ─── Socket.IO event handlers ─────────────────────────────────────────────────

/**
 * Socket.IO event handlers, which for a realtime app are the entire
 * interaction surface. Skribbl registers eleven of them
 * (`create-room`, `draw-ops`, `chat-message`, …) and previously produced one
 * workflow, from a `/health` route.
 *
 * `.on` is far too common to match on its own — `process.on`, `emitter.on` and
 * every EventEmitter in the repo would qualify. So the anchor is
 * `X.on('connection', cb)`: 'connection' is reserved by Socket.IO and is
 * effectively unambiguous. Only `.on` calls **lexically inside that callback**,
 * on the callback's own socket parameter, are then treated as events. That
 * keeps the false-positive surface at essentially zero without needing to know
 * whether the file imports socket.io (Skribbl's handlers.js does not — it takes
 * `io` as a parameter).
 */
function extractSocketHandlers(
  sourceFile: ts.SourceFile,
  relativePath: string,
  ctx: ExtractCtx,
  symbols: SymbolInfo[],
): SocketHandler[] {
  const handlers: SocketHandler[] = [];
  const usedNames = new Set(symbols.map((s) => s.name));
  const normalizedPath = normalizePath(relativePath);

  /** `<recv>.on('<event>', <handler>)` — the shape shared by both levels. */
  const asOnCall = (node: ts.Node): { recv: string; event: string; handler: ts.Expression } | null => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
    if (node.expression.name.text !== 'on' || node.arguments.length < 2) return null;
    const first = node.arguments[0];
    const handler = node.arguments[node.arguments.length - 1];
    if (!first || !handler || !ts.isStringLiteralLike(first)) return null;
    return { recv: node.expression.expression.getText(sourceFile), event: first.text, handler };
  };

  /** Records the handler, synthesizing a symbol for an inline function body. */
  const record = (event: string, handler: ts.Expression, callNode: ts.Node, isConnection: boolean): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(callNode.getStart(sourceFile)).line + 1;

    if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
      let name = `on ${event}`;
      for (let i = 2; usedNames.has(name); i++) name = `on ${event} (${i})`;
      usedNames.add(name);
      const params = extractParameters(handler.parameters, sourceFile);
      const calls = extractCallSymbols(handler.body, sourceFile);
      const resolvedCalls = extractResolvedCalls(handler.body, sourceFile, ctx);
      const signature = buildSignature(params, 'void');
      symbols.push({
        name,
        kind: 'arrow-function',
        filePath: sourceFile.fileName,
        ...getNodeLocation(callNode, sourceFile),
        exported: false,
        isDefault: false,
        signature,
        parameters: params,
        returnType: 'void',
        isAsync: hasModifier(handler, ts.SyntaxKind.AsyncKeyword),
        ...(calls.length > 0 ? { callsSymbols: calls } : {}),
        ...(resolvedCalls.length > 0 ? { resolvedCalls } : {}),
        signatureHash: sha256(`on ${event}${signature}`),
        bodyHash: hashBody(handler.getText(sourceFile)),
        snippet: snippetOf(callNode, sourceFile),
        isTrivial: false,
      });
      handlers.push({ event, handlerSymbolName: name, handlerRelativePath: normalizedPath, isConnection, line });
      return;
    }

    if (ts.isIdentifier(handler) || ts.isPropertyAccessExpression(handler)) {
      const target = ctx.checker ? resolveCallTarget(handler, ctx.checker, ctx.rootPath) : null;
      handlers.push({
        event,
        ...(target ? {
          handlerSymbolName: target.targetName,
          handlerRelativePath: target.targetRelativePath,
          ...(target.targetParentName ? { handlerParentName: target.targetParentName } : {}),
        } : {}),
        isConnection,
        line,
      });
      return;
    }

    handlers.push({ event, isConnection, line });
  };

  function visit(node: ts.Node): void {
    const call = asOnCall(node);
    if (call && call.event === 'connection') {
      record('connection', call.handler, node, true);

      // Bind the callback's socket parameter, then treat only ITS `.on` calls
      // as events. Anything else inside the callback stays untouched.
      if (ts.isArrowFunction(call.handler) || ts.isFunctionExpression(call.handler)) {
        const socketParam = call.handler.parameters[0]?.name;
        const socketName = socketParam && ts.isIdentifier(socketParam) ? socketParam.text : null;
        if (socketName) {
          const walkInner = (inner: ts.Node): void => {
            const evt = asOnCall(inner);
            // 'disconnect' is a lifecycle event, not a client action, but it
            // still runs cleanup with real side effects — keep it.
            if (evt && evt.recv === socketName && evt.event !== 'connection') {
              record(evt.event, evt.handler, inner, false);
            }
            ts.forEachChild(inner, walkInner);
          };
          walkInner(call.handler.body);
        }
      }
      return; // inner `.on`s already handled
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return handlers;
}

// ─── UI route declarations ────────────────────────────────────────────────────

/** '/app' + 'settings' -> '/app/settings'; tolerates either side's slashes. */
function joinUiPath(prefix: string, segment: string): string {
  if (segment.startsWith('/')) return segment.replace(/\/{2,}/g, '/');
  const joined = `${prefix}/${segment}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined || '/';
}

/**
 * UI routes declared in a router config. Two shapes cover React Router,
 * TanStack Router and Vue Router:
 *
 *   <Route path="/projects/:id" element={<ProjectPage />} />
 *   createBrowserRouter([{ path: '/projects/:id', element: <ProjectPage /> }])
 *
 * Nested routes are parent-joined, so a child declared as `path="settings"`
 * under `path="/app"` is recorded as `/app/settings` rather than the relative
 * fragment, which on its own is not a navigable address.
 *
 * Only a bare component reference yields `componentName`: inline JSX bodies
 * (`element={<div>…</div>}`) name no declaration, so they record the path
 * alone rather than inventing a symbol.
 */
function extractUiRouteDeclarations(sourceFile: ts.SourceFile): UiRouteDeclaration[] {
  const routes: UiRouteDeclaration[] = [];
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  /** The component a route's `element`/`Component` slot renders, if it names one. */
  const componentOf = (expr: ts.Expression | undefined): string | undefined => {
    if (!expr) return undefined;
    let node: ts.Node = expr;
    if (ts.isJsxExpression(node)) {
      if (!node.expression) return undefined;
      node = node.expression;
    }
    if (ts.isJsxElement(node)) node = node.openingElement;
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      // Lowercase tags are host elements (`<div>`), not page components.
      return /^[A-Z]/.test(tag) ? tag.split('.').pop() : undefined;
    }
    if (ts.isIdentifier(node)) return node.text;
    return undefined;
  };

  /** `<Route path="…" element={…}>` — attribute lookup, string or expression. */
  const jsxAttr = (
    el: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
    name: string,
  ): ts.Expression | undefined => {
    for (const prop of el.attributes.properties) {
      if (!ts.isJsxAttribute(prop) || prop.name.getText(sourceFile) !== name) continue;
      const init = prop.initializer;
      if (!init) return undefined;
      if (ts.isStringLiteral(init)) return init;
      if (ts.isJsxExpression(init)) return init.expression;
    }
    return undefined;
  };

  const isRouteTag = (el: ts.JsxSelfClosingElement | ts.JsxOpeningElement): boolean =>
    /(^|\.)Route$/.test(el.tagName.getText(sourceFile));

  function visitJsx(node: ts.Node, prefix: string): void {
    let childPrefix = prefix;

    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (opening && isRouteTag(opening)) {
      const pathExpr = jsxAttr(opening, 'path');
      const declared = pathExpr && ts.isStringLiteralLike(pathExpr) ? pathExpr.text : undefined;
      if (declared !== undefined) {
        const full = joinUiPath(prefix, declared);
        const component = componentOf(
          jsxAttr(opening, 'element') ?? jsxAttr(opening, 'Component') ?? jsxAttr(opening, 'component'),
        );
        routes.push({ routePath: full, ...(component ? { componentName: component } : {}), line: lineOf(opening) });
        childPrefix = full;
      }
    }

    ts.forEachChild(node, (child) => visitJsx(child, childPrefix));
  }

  /** `{ path: '…', element: <X/>, children: [...] }` route objects. */
  function visitRouteObject(obj: ts.ObjectLiteralExpression, prefix: string): boolean {
    let declared: string | undefined;
    let component: ts.Expression | undefined;
    let children: ts.Expression | undefined;

    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
      if (key === 'path' && ts.isStringLiteralLike(prop.initializer)) declared = prop.initializer.text;
      else if (key === 'element' || key === 'Component' || key === 'component') component = prop.initializer;
      else if (key === 'children') children = prop.initializer;
    }

    // A `path` alone is not a route — plenty of config objects have one. The
    // element/children slot is what makes this a router entry.
    if (declared === undefined || (!component && !children)) return false;

    const full = joinUiPath(prefix, declared);
    const name = componentOf(component);
    routes.push({ routePath: full, ...(name ? { componentName: name } : {}), line: lineOf(obj) });

    if (children && ts.isArrayLiteralExpression(children)) {
      for (const el of children.elements) {
        if (ts.isObjectLiteralExpression(el)) visitRouteObject(el, full);
      }
    }
    return true;
  }

  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node) && visitRouteObject(node, '')) return; // children handled
    ts.forEachChild(node, visit);
  }

  visitJsx(sourceFile, '');
  visit(sourceFile);
  return routes;
}

/**
 * The local declaration a default-export expression points at, if any.
 *
 *   export default Index               → "Index"
 *   export default memo(Index)         → "Index"   (an HOC-wrapped page is still that page)
 *   export default React.memo(Index)   → "Index"
 *   export default { a, b }            → null
 *   export default makeThing(a, b)     → null      (two args name no single declaration)
 *
 * Deliberately conservative: guessing here would mark private helpers as
 * public API and inflate the ranker's `exportedSurface` signal.
 */
function defaultExportLocalName(expr: ts.Expression): string | null {
  let node: ts.Node = expr;
  for (let depth = 0; depth < 4; depth++) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isCallExpression(node) && node.arguments.length === 1 && node.arguments[0]) {
      node = node.arguments[0];
      continue;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      node = node.expression;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Marks symbols exported by a *separate statement* rather than an inline
 * modifier. `isExported()` (astParser.ts) reads only `ts.getModifiers()`, so
 * these three equally-public declarations disagreed:
 *
 *   export default function Index() {}          // exported: true
 *   const Index = () => {}; export default Index;   // exported: FALSE
 *   function load() {}      export { load };        // exported: FALSE
 *
 * `entrypointDetector` gates `ui_route`, `cli_command` and `event_handler` on
 * `s.exported`, and `candidateRanker` scores an `exportedSurface` signal — so
 * the modifier-only reading made an entire `src/pages/` directory invisible in
 * a project written with the second style while an identically-laid-out
 * project using the first style reported every page.
 *
 * Re-exports (`export { x } from './y'`) are skipped on purpose: that name
 * belongs to another module, and a local symbol sharing it is a different
 * declaration.
 */
function reconcileExports(symbols: SymbolInfo[], exports: ExportRecord[]): void {
  if (symbols.length === 0 || exports.length === 0) return;

  const byName = new Map<string, SymbolInfo[]>();
  for (const sym of symbols) {
    const bucket = byName.get(sym.name);
    if (bucket) bucket.push(sym);
    else byName.set(sym.name, [sym]);
  }

  const mark = (name: string, asDefault: boolean): void => {
    for (const sym of byName.get(name) ?? []) {
      sym.exported = true;
      if (asDefault) sym.isDefault = true;
    }
  };

  for (const rec of exports) {
    if (rec.isReExport) continue;

    // `localBindings` is absent on records built before this field existed and
    // on `export *`; falling back to the public names is right for the
    // unaliased case, which is the overwhelming majority.
    const locals = rec.localBindings ?? rec.namedExports;
    locals.forEach((local, i) => {
      // `export { Index as default }` is a default export spelled the long way.
      mark(local, rec.namedExports[i] === 'default');
    });

    const defaultLocal =
      rec.defaultLocalName ??
      (rec.expression && BARE_IDENTIFIER.test(rec.expression) ? rec.expression : undefined);
    if (rec.isDefault && defaultLocal) mark(defaultLocal, true);
  }
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
          ...(target ? {
            handlerSymbolName: target.targetName,
            handlerRelativePath: target.targetRelativePath,
            ...(target.targetParentName ? { handlerParentName: target.targetParentName } : {}),
          } : {}),
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

/**
 * `app.use('/api', apiRouter)` / `router.use('/x', requireAuth, childRouter)`
 * — records where each repo-local router file is mounted and under what
 * prefix. The mounted router is taken as the LAST argument that resolves to
 * a repo file (middleware and external routers resolve to null and drop out).
 * `use(router)` with no path literal is a mount at ''.
 */
function extractRouterMounts(
  sourceFile: ts.SourceFile,
  ctx: ExtractCtx,
): import('../types/analysis.js').RouterMount[] {
  if (!ctx.checker) return [];
  const mounts: import('../types/analysis.js').RouterMount[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'use' &&
      node.arguments.length >= 1
    ) {
      const first = node.arguments[0]!;
      const hasPath = ts.isStringLiteralLike(first) && first.text.startsWith('/');
      const prefix = hasPath ? first.text : '';
      const last = node.arguments[node.arguments.length - 1]!;
      if (
        (ts.isIdentifier(last) || ts.isPropertyAccessExpression(last)) &&
        (hasPath || node.arguments.length === 1)
      ) {
        const target = resolveCallTarget(last, ctx.checker!, ctx.rootPath);
        if (target) {
          mounts.push({
            prefix,
            targetRelativePath: target.targetRelativePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return mounts;
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
    // Function-valued properties are extracted as methods below, not data.
    .filter((prop) => !(prop.initializer && (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))))
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

  // Arrow-function class properties (`private addDataset = async (req, res) =>
  // {...}`) ARE methods for evidence purposes — Express handlers are commonly
  // declared this way (CourseInsights shape). Without this, such handlers had
  // no symbol node, no calls edges, and route entrypoints couldn't seed.
  for (const prop of node.members.filter(ts.isPropertyDeclaration)) {
    const init = prop.initializer;
    if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
    const params = extractParameters(init.parameters, sf);
    const retType = init.type?.getText(sf) ?? 'void';
    const mLoc = getNodeLocation(prop, sf);
    const mCalls = extractCallSymbols(init.body, sf);
    const mResolved = extractResolvedCalls(init.body, sf, ctx);
    const signature = buildSignature(params, retType);
    const name = prop.name.getText(sf);
    methods.push({
      name,
      signature,
      parameters: params,
      returnType: retType,
      accessibility: getAccessibility(prop),
      static: hasModifier(prop, ts.SyntaxKind.StaticKeyword),
      isAsync: hasModifier(init, ts.SyntaxKind.AsyncKeyword),
      lineStart: mLoc.start.line,
      lineEnd: mLoc.end.line,
      ...(mCalls.length > 0 ? { callsSymbols: mCalls } : {}),
      ...(mResolved.length > 0 ? { resolvedCalls: mResolved } : {}),
      signatureHash: sha256(signature),
      bodyHash: hashBody(prop.getText(sf)),
      snippet: snippetOf(prop, sf),
      isTrivial: isTrivialBody(init.body, mCalls.length) || /^(get|set)[A-Z_]/.test(name),
    });
  }

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
      if (decl.initializer) {
        base.initializer = decl.initializer.getText(sf);
        // `const worker = new Worker(QUEUE, async (job) => run(job))`
        // carries real control flow in its closure argument — without
        // these calls the queue-consumer entrypoint seeds a dead node and
        // the background pipeline never traces as a workflow (audit P2 §15).
        const calls = extractCallSymbols(decl.initializer, sf);
        if (calls.length > 0) {
          base.callsSymbols = calls;
          const resolvedCalls = extractResolvedCalls(decl.initializer, sf, ctx);
          if (resolvedCalls.length > 0) base.resolvedCalls = resolvedCalls;
        }
      }
      // Plain constants/values are trivial — call-bearing initializers are not.
      base.isTrivial = base.callsSymbols === undefined;
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
