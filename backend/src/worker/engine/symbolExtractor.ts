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
} from '../types/analysis.js';
import {
  ParsedSourceFile,
  getLeadingJsDoc,
  isExported,
  isDefaultExport,
  getNodeLocation,
} from './astParser.js';

export function extractFileAnalysis(parsed: ParsedSourceFile, rootPath: string): FileAnalysis {
  const { filePath, sourceFile } = parsed;
  const relativePath = path.relative(rootPath, filePath);

  const symbols: SymbolInfo[] = [];
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];

  visitNode(sourceFile);

  return {
    filePath,
    relativePath,
    symbols,
    imports,
    exports,
    hasParseErrors: parsed.hasErrors,
    parseErrors: parsed.errors,
  };

  function visitNode(node: ts.Node): void {
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
        imports.push(extractImport(node as ts.ImportDeclaration, filePath));
        break;

      case ts.SyntaxKind.ExportDeclaration:
        exports.push(extractExportDeclaration(node as ts.ExportDeclaration, filePath));
        break;

      case ts.SyntaxKind.ClassDeclaration: {
        const sym = extractClass(node as ts.ClassDeclaration, filePath, sourceFile);
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
        const sym = extractFunction(node as ts.FunctionDeclaration, filePath, sourceFile);
        if (sym) symbols.push(sym);
        break;
      }

      case ts.SyntaxKind.VariableStatement: {
        const syms = extractVariableStatement(node as ts.VariableStatement, filePath, sourceFile);
        symbols.push(...syms);
        break;
      }

      case ts.SyntaxKind.EnumDeclaration: {
        const sym = extractEnum(node as ts.EnumDeclaration, filePath, sourceFile);
        if (sym) symbols.push(sym);
        break;
      }
    }

    ts.forEachChild(node, visitNode);
  }
}

// ─── Import extraction ────────────────────────────────────────────────────────

function extractImport(node: ts.ImportDeclaration, filePath: string): ImportRecord {
  const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
  const isTypeOnly = node.importClause?.isTypeOnly ?? false;
  const named: NamedImportItem[] = [];
  let defaultImport: string | undefined;

  const clause = node.importClause;
  if (clause) {
    if (clause.name) {
      defaultImport = clause.name.text;
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        named.push({
          name: el.propertyName?.text ?? el.name.text,
          isTypeOnly: el.isTypeOnly,
          alias: el.propertyName ? el.name.text : null,
        });
      }
    }
  }

  return {
    fromFile: filePath,
    toSpecifier: specifier,
    namedImports: named,
    defaultImport,
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

// ─── Symbol extractors ────────────────────────────────────────────────────────

function extractClass(
  node: ts.ClassDeclaration,
  filePath: string,
  sf: ts.SourceFile,
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
      return {
        name: m.name.getText(sf),
        signature: buildSignature(params, retType),
        parameters: params,
        returnType: retType,
        accessibility: getAccessibility(m),
        static: hasModifier(m, ts.SyntaxKind.StaticKeyword),
        isAsync: hasModifier(m, ts.SyntaxKind.AsyncKeyword),
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
  };
}

function extractTypeAlias(
  node: ts.TypeAliasDeclaration,
  filePath: string,
  sf: ts.SourceFile,
): SymbolInfo | null {
  const loc = getNodeLocation(node, sf);
  return {
    name: node.name.text,
    kind: 'type',
    filePath,
    ...loc,
    exported: isExported(node),
    isDefault: false,
    definition: node.type.getText(sf),
  };
}

function extractFunction(
  node: ts.FunctionDeclaration,
  filePath: string,
  sf: ts.SourceFile,
): SymbolInfo | null {
  if (!node.name) return null;
  const loc = getNodeLocation(node, sf);
  const params = extractParameters(node.parameters, sf);
  const retType = node.type?.getText(sf) ?? 'void';
  const calls = extractCallSymbols(node.body, sf);

  return {
    name: node.name.text,
    kind: 'function',
    filePath,
    ...loc,
    exported: isExported(node),
    isDefault: isDefaultExport(node),
    jsDoc: getLeadingJsDoc(node, sf),
    signature: buildSignature(params, retType),
    parameters: params,
    returnType: retType,
    isAsync: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    ...(calls.length > 0 ? { callsSymbols: calls } : {}),
  };
}

function extractVariableStatement(
  node: ts.VariableStatement,
  filePath: string,
  sf: ts.SourceFile,
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
    } else {
      if (decl.type) base.typeAnnotation = decl.type.getText(sf);
      if (decl.initializer) base.initializer = decl.initializer.getText(sf);
    }

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
  };
}
