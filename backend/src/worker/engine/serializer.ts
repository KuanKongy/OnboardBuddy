import type {
  AnalysisSnapshot,
  SymbolInfo,
  ParameterInfo,
  SlimSnapshot,
  SlimSymbol,
  SlimImport,
  SlimParameter,
} from '../types/analysis.js';

export function slimSnapshot(snapshot: AnalysisSnapshot): SlimSnapshot {
  return {
    projectId: snapshot.projectId,
    triggeredBy: snapshot.triggeredBy,
    repoIndex: {
      files: snapshot.repoIndex.files.map((f) => ({
        relativePath: f.relativePath,
        language: f.language,
        sizeBytes: f.sizeBytes,
      })),
      detectedLanguage: snapshot.repoIndex.detectedLanguage,
      scannedAt: snapshot.repoIndex.scannedAt,
    },
    fileAnalyses: snapshot.fileAnalyses.map((fa) => ({
      relativePath: fa.relativePath,
      symbols: fa.symbols.map(toSlimSymbol),
      imports: fa.imports.map((imp) => {
        const slim: SlimImport = {
          toSpecifier: imp.toSpecifier,
          namedImports: imp.namedImports.map((n) => n.name),
        };
        if (imp.isTypeOnly) slim.isTypeOnly = true;
        return slim;
      }),
    })),
    graph: {
      nodes: snapshot.graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        metadata: {
          exportedSymbols: n.metadata.exportedSymbols,
          importCount: n.metadata.importCount,
          dependentCount: n.metadata.dependentCount,
        },
      })),
      edges: snapshot.graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
      })),
      entryPoints: snapshot.graph.entryPoints,
    },
    createdAt: snapshot.createdAt,
  };
}

function stripJsDoc(raw: string): string {
  return raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '')
    .trim();
}

function toSlimParam(p: ParameterInfo): SlimParameter {
  const slim: SlimParameter = { name: p.name, type: p.type };
  if (p.optional) slim.optional = true;
  if (p.default !== null) slim.default = p.default;
  if (p.accessibility) slim.accessibility = p.accessibility;
  return slim;
}

function toSlimSymbol(s: SymbolInfo): SlimSymbol {
  const slim: SlimSymbol = {
    name: s.name,
    kind: s.kind,
    exported: s.exported,
  };

  if (s.jsDoc) slim.jsDoc = stripJsDoc(s.jsDoc);
  if (s.typeAnnotation) slim.typeAnnotation = s.typeAnnotation;
  if (s.initializer) slim.initializer = s.initializer;

  if (s.kind === 'function' || s.kind === 'arrow-function') {
    if (s.signature) slim.signature = s.signature;
    if (s.parameters && s.parameters.length > 0) slim.parameters = s.parameters.map(toSlimParam);
    slim.isAsync = s.isAsync ?? false;
    if (s.callsSymbols && s.callsSymbols.length > 0) slim.callsSymbols = s.callsSymbols;
  }

  if (s.properties && s.properties.length > 0) {
    slim.properties = s.properties.map((p) => ({ name: p.name, type: p.type }));
  }

  if (s.extends && s.extends.length > 0) slim.extends = s.extends;
  if (s.extendsClass) slim.extendsClass = s.extendsClass;
  if (s.implements && s.implements.length > 0) slim.implements = s.implements;

  if (s.constructors && s.constructors.length > 0) {
    slim.constructors = s.constructors.map((c) => ({
      parameters: c.parameters.map(toSlimParam),
    }));
  }

  if (s.methods && s.methods.length > 0) {
    slim.methods = s.methods.map((m) => ({
      name: m.name,
      signature: m.signature,
      parameters: m.parameters.map(toSlimParam),
      isAsync: m.isAsync,
      accessibility: m.accessibility,
    }));
  }

  if (s.definition) slim.definition = s.definition;
  if (s.members && s.members.length > 0) slim.members = s.members;

  return slim;
}
