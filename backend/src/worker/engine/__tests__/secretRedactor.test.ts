import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { redactSecrets, detectSecrets } from '../secretRedactor.js';
import { buildRepoIndex, filterByLanguage } from '../repoIngester.js';
import { createProgram, parseSourceFile } from '../astParser.js';
import { extractFileAnalysis } from '../symbolExtractor.js';
import { MAX_SNIPPET_CHARS } from '../budgets.js';
import type { FileAnalysis } from '../../types/analysis.js';

/** Fake-but-well-formed credentials — shape matters, these are not real. */
const SAMPLES: Array<{ rule: string; secret: string }> = [
  { rule: 'aws-access-key-id', secret: 'AKIAIOSFODNN7EXAMPLE' },
  { rule: 'github-token', secret: `ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}` },
  { rule: 'stripe-key', secret: 'sk_live_4eC39HqLyjWDarjtT1zdp7dc' },
  { rule: 'google-api-key', secret: `AIza${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r'}` },
  { rule: 'slack-token', secret: 'xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx' },
  // npm tokens are exactly 36 chars after the prefix — the rule is `{36}`, so
  // the sample has to be too.
  { rule: 'npm-token', secret: `npm_${'a1B2c3D4e5F6g7H8i9J0K1l2M3n4O5p6Q7r8'}` },
  { rule: 'supabase-secret-key', secret: 'sb_secret_AbCdEfGhIjKlMnOpQrStUv' },
  { rule: 'openrouter-key', secret: `sk-or-v1-${'0123456789abcdef'.repeat(2)}` },
  { rule: 'jwt', secret: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' },
];

describe('secretRedactor — detection and replacement', () => {
  for (const { rule, secret } of SAMPLES) {
    it(`redacts ${rule}`, () => {
      const src = `export const CONFIG = { key: "${secret}" };`;
      const out = redactSecrets(src);
      expect(out, 'secret value removed').to.not.contain(secret);
      expect(out, 'marker inserted').to.contain('«redacted:');
      expect(out, 'surrounding code preserved').to.contain('export const CONFIG');
    });
  }

  it('redacts a whole PEM block, not just its header', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAx7Kj8mNqPl2vRt4WuYz6BcDeFgHiJkLmNoPqRsTuVwXyZ012',
      'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz01',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const out = redactSecrets(`const KEY = \`${pem}\`;`);
    expect(out).to.not.contain('MIIEowIBAAKCAQEA');
    expect(out).to.not.contain('AbCdEfGhIjKlMnOpQrStUvWxYz01');
    expect(out).to.contain('«redacted:private-key»');
  });

  it('preserves line count so receipt line ranges stay correct', () => {
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNNOOOOPPPP',
      'QQQQRRRRSSSSTTTTUUUUVVVVWWWWXXXXYYYYZZZZ0000111122223333444455556',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const src = `line1\n${pem}\nlastline`;
    const out = redactSecrets(src);
    const lines = (s: string) => s.split('\n').length;
    expect(lines(out), 'line count unchanged').to.equal(lines(src));
    expect(out.split('\n').at(-1)).to.equal('lastline');
  });

  it('keeps scheme and host in a connection string, drops only the password', () => {
    const out = redactSecrets('const DB = "postgresql://appuser:sup3rS3cretPw@db.example.com:5432/prod";');
    expect(out).to.not.contain('sup3rS3cretPw');
    expect(out, 'host still documents the dependency').to.contain('db.example.com:5432/prod');
    expect(out).to.contain('postgresql://appuser:');
  });

  it('leaves ordinary source untouched', () => {
    const ordinary = fs.readFileSync(path.resolve(__dirname, '../symbolExtractor.ts'), 'utf8');
    expect(redactSecrets(ordinary)).to.equal(ordinary);
  });

  it('does not fire on lookalike non-secrets', () => {
    for (const benign of [
      'const skater = "sk_live";',                 // prefix without a payload
      'import { AKIA } from "./constants.js";',    // bare identifier
      'const url = "https://example.com/path";',   // scheme with no credentials
      'const hash = "a".repeat(40);',
    ]) {
      expect(detectSecrets(benign), benign).to.deep.equal([]);
      expect(redactSecrets(benign)).to.equal(benign);
    }
  });
});

describe('secretRedactor — wired into extraction (the producer chokepoints)', () => {
  let analyses: FileAnalysis[];
  let dir: string;
  const SECRET = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';
  const AWS = 'AKIAIOSFODNN7EXAMPLE';
  const GH = `ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`;

  before(async function () {
    this.timeout(30000);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obb-secrets-'));
    fs.writeFileSync(
      path.join(dir, 'config.ts'),
      `/**
 * Billing config.
 * @example const c = charge("${GH}");
 */
export const STRIPE_KEY = "${SECRET}";

export function charge(token = "${AWS}") {
  return fetch("https://api.stripe.com", { headers: { auth: "${SECRET}" } });
}

export enum Keys {
  Live = "${SECRET}",
}
`,
    );
    const index = await buildRepoIndex(dir);
    const tsFiles = filterByLanguage(index, 'typescript');
    const program = createProgram(tsFiles, dir);
    analyses = tsFiles.map((e) => extractFileAnalysis(parseSourceFile(program, e.absolutePath), dir));
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function sym(name: string) {
    return analyses[0]!.symbols.find((s) => s.name === name)!;
  }

  it('scrubs the snippet (graph_nodes.snippet / source_receipts.snippet)', () => {
    for (const s of analyses[0]!.symbols) {
      expect(s.snippet ?? '', `snippet of ${s.name}`).to.not.contain(SECRET);
    }
  });

  it('scrubs the initializer — the field snippetOf does not cover', () => {
    const key = sym('STRIPE_KEY');
    expect(key.initializer ?? '').to.not.contain(SECRET);
    expect(key.initializer ?? '').to.contain('«redacted:stripe-key»');
  });

  it('scrubs a parameter default', () => {
    const fn = sym('charge');
    const def = (fn.parameters ?? []).map((p) => p.default ?? '').join(' ');
    expect(def).to.not.contain(AWS);
    expect(def).to.contain('«redacted:aws-access-key-id»');
  });

  it('scrubs enum member values', () => {
    const members = sym('Keys').members ?? [];
    expect(members.map((m) => m.value).join(' ')).to.not.contain(SECRET);
  });

  it('scrubs jsDoc, which reaches prompts via the serializer', () => {
    const doc = sym('STRIPE_KEY').jsDoc ?? sym('charge').jsDoc ?? '';
    expect(doc).to.not.contain(GH);
  });

  it('leaves no trace of any secret anywhere in the extracted analysis', () => {
    // The real assertion: whatever the field, nothing serialized downstream
    // may carry the value.
    const serialized = JSON.stringify(analyses);
    for (const s of [SECRET, AWS, GH]) expect(serialized).to.not.contain(s);
  });
});

describe('secretRedactor — redaction runs before the snippet cap', () => {
  it('does not leave a partial credential straddling MAX_SNIPPET_CHARS', () => {
    const SECRET = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';
    // Place the secret so it spans the cap boundary.
    const filler = 'x'.repeat(MAX_SNIPPET_CHARS - 10);
    const text = redactSecrets(`${filler}${SECRET}tail`);
    const capped = text.length > MAX_SNIPPET_CHARS ? text.slice(0, MAX_SNIPPET_CHARS) : text;
    expect(capped).to.not.contain('sk_live_4eC39');
  });
});
