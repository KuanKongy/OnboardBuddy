import * as fs from 'node:fs';
import type { RepoFileRecord, EvidenceNode, EvidenceEdge } from '../types/analysis.js';
import { docKey, slugify } from './stableKeys.js';
import { sha256 } from './hashUtils.js';
import { MAX_SNIPPET_CHARS } from './budgets.js';

/**
 * README/docs ingestion (doc/Pipeline.md "Docs ingestion"): markdown files
 * become `doc` graph nodes with trust level 'docs' — one node per heading
 * section — plus `documents` edges to repo files the section mentions.
 * Docs are lower-trust evidence: they feed synthesis prompts with explicit
 * "docs may be stale, code wins" framing and never prove code behavior alone.
 * (JSDoc travels on the symbol itself via SymbolInfo.jsDoc.)
 */

const MAX_SECTIONS_PER_FILE = 40;
const MAX_DOC_EDGES_PER_SECTION = 10;

export interface DocsIngestResult {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
}

export function ingestDocs(files: RepoFileRecord[], knownFilePaths: Set<string>): DocsIngestResult {
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];
  const seen = new Set<string>();

  const docFiles = files.filter(
    (f) => f.category === 'doc' && (f.language === 'markdown' || f.language === 'restructuredtext' || f.language === 'text'),
  );

  for (const file of docFiles) {
    let text: string;
    try {
      text = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }

    for (const section of splitSections(text).slice(0, MAX_SECTIONS_PER_FILE)) {
      const slug = slugify(section.heading);
      let key = docKey(file.relativePath, slug);
      // Duplicate headings in one file: disambiguate by start line.
      if (seen.has(key)) key = docKey(file.relativePath, `${slug}-l${section.lineStart}`);
      if (seen.has(key)) continue;
      seen.add(key);

      nodes.push({
        stableKey: key,
        type: 'doc',
        name: section.heading,
        filePath: file.relativePath,
        lineStart: section.lineStart,
        lineEnd: section.lineEnd,
        hash: sha256(section.body),
        trustLevel: 'docs',
        snippet: section.body.slice(0, MAX_SNIPPET_CHARS),
        metadata: { docFile: file.relativePath, heading: section.heading },
      });

      for (const mentioned of findMentionedFiles(section.body, knownFilePaths).slice(0, MAX_DOC_EDGES_PER_SECTION)) {
        edges.push({
          sourceKey: key,
          targetKey: mentioned,
          type: 'documents',
          confidence: 'medium',
          metadata: { detectedFrom: 'path_mention' },
        });
      }
    }
  }

  return { nodes, edges };
}

interface DocSection {
  heading: string;
  body: string;
  lineStart: number;
  lineEnd: number;
}

function splitSections(text: string): DocSection[] {
  const lines = text.split('\n');
  const sections: DocSection[] = [];
  let current: DocSection | null = null;
  const bodyLines: string[] = [];

  const flush = (endLine: number) => {
    if (current) {
      current.body = bodyLines.join('\n').trim();
      current.lineEnd = endLine;
      if (current.body.length > 0 || sections.length === 0) sections.push(current);
    }
    bodyLines.length = 0;
  };

  lines.forEach((line, i) => {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flush(i);
      current = { heading: heading[1]!.trim(), body: '', lineStart: i + 1, lineEnd: i + 1 };
    } else {
      if (!current) {
        current = { heading: 'Introduction', body: '', lineStart: 1, lineEnd: 1 };
      }
      bodyLines.push(line);
    }
  });
  flush(lines.length);

  return sections;
}

/** Finds repo-file paths mentioned in doc text (backticks, links, or bare). */
function findMentionedFiles(body: string, knownFilePaths: Set<string>): string[] {
  const mentioned = new Set<string>();
  const candidates = body.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
  for (const c of candidates) {
    const cleaned = c.replace(/^\.\//, '');
    if (knownFilePaths.has(cleaned)) mentioned.add(cleaned);
  }
  return [...mentioned];
}
