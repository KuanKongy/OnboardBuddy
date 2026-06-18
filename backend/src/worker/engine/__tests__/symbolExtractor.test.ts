import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';
import { createProgram, parseSourceFile } from '../astParser';
import { extractFileAnalysis } from '../symbolExtractor';
import type { FileAnalysis, SymbolInfo } from '../../types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/simple');
const JWT_UTIL = path.join(FIXTURE_DIR, 'utils', 'jwtUtil.ts');
const AUTH_SERVICE = path.join(FIXTURE_DIR, 'services', 'authService.ts');
const INDEX_FILE = path.join(FIXTURE_DIR, 'index.ts');

let jwtAnalysis: FileAnalysis;
let authAnalysis: FileAnalysis;
let indexAnalysis: FileAnalysis;

before(async () => {
  const index = await buildRepoIndex(FIXTURE_DIR);
  const tsFiles = filterByLanguage(index, 'typescript');
  const program = createProgram(tsFiles, FIXTURE_DIR);

  jwtAnalysis = extractFileAnalysis(parseSourceFile(program, JWT_UTIL), FIXTURE_DIR);
  authAnalysis = extractFileAnalysis(parseSourceFile(program, AUTH_SERVICE), FIXTURE_DIR);
  indexAnalysis = extractFileAnalysis(parseSourceFile(program, INDEX_FILE), FIXTURE_DIR);
});

describe('symbolExtractor — jwtUtil.ts', () => {
  it('has no parse errors', () => {
    expect(jwtAnalysis.hasParseErrors).to.be.false;
  });

  it('extracts TokenPayload type alias', () => {
    const sym = jwtAnalysis.symbols.find((s) => s.name === 'TokenPayload');
    expect(sym).to.exist;
    expect(sym!.kind).to.equal('type');
    expect(sym!.exported).to.be.true;
  });

  it('extracts signToken as exported function', () => {
    const sym = jwtAnalysis.symbols.find((s) => s.name === 'signToken');
    expect(sym).to.exist;
    expect(sym!.kind).to.equal('function');
    expect(sym!.exported).to.be.true;
  });

  it('extracts verifyToken as exported arrow-function', () => {
    const sym = jwtAnalysis.symbols.find((s) => s.name === 'verifyToken');
    expect(sym).to.exist;
    expect(sym!.kind).to.equal('arrow-function');
    expect(sym!.exported).to.be.true;
  });

  it('extracts TokenStatus enum', () => {
    const sym = jwtAnalysis.symbols.find((s) => s.name === 'TokenStatus');
    expect(sym).to.exist;
    expect(sym!.kind).to.equal('enum');
    expect(sym!.exported).to.be.true;
  });

  it('all symbols have valid line numbers (> 0)', () => {
    for (const s of jwtAnalysis.symbols) {
      expect(s.start.line).to.be.greaterThan(0);
      expect(s.end.line).to.be.greaterThan(0);
    }
  });

  it('has no imports (no local imports in jwtUtil)', () => {
    expect(jwtAnalysis.imports).to.have.length(0);
  });
});

describe('symbolExtractor — authService.ts', () => {
  it('has no parse errors', () => {
    expect(authAnalysis.hasParseErrors).to.be.false;
  });

  it('extracts ICredentials as exported interface', () => {
    const sym = authAnalysis.symbols.find((s) => s.name === 'ICredentials');
    expect(sym).to.exist;
    expect(sym!.kind).to.equal('interface');
    expect(sym!.exported).to.be.true;
  });

  it('extracts ISession as exported interface', () => {
    const sym = authAnalysis.symbols.find((s) => s.name === 'ISession');
    expect(sym).to.exist;
    expect(sym!.kind).to.equal('interface');
    expect(sym!.exported).to.be.true;
  });

  it('extracts AuthService as exported class', () => {
    const sym = authAnalysis.symbols.find((s) => s.name === 'AuthService');
    expect(sym).to.exist;
    expect(sym!.kind).to.equal('class');
    expect(sym!.exported).to.be.true;
    expect(sym!.isDefault).to.be.false;
  });

  it('AuthService has JSDoc comment', () => {
    const sym = authAnalysis.symbols.find((s) => s.name === 'AuthService');
    expect(sym!.jsDoc).to.include('authentication');
  });

  it('imports signToken, verifyToken, TokenPayload from jwtUtil', () => {
    const imp = authAnalysis.imports.find((i) => i.toSpecifier === '../utils/jwtUtil');
    expect(imp).to.exist;
    const names = imp!.namedImports.map((n) => n.name);
    expect(names).to.include('signToken');
    expect(names).to.include('verifyToken');
    expect(names).to.include('TokenPayload');
  });

  it('import from jwtUtil is not type-only', () => {
    const imp = authAnalysis.imports.find((i) => i.toSpecifier === '../utils/jwtUtil');
    expect(imp!.isTypeOnly).to.be.false;
  });
});

describe('symbolExtractor — index.ts', () => {
  it('has no parse errors', () => {
    expect(indexAnalysis.hasParseErrors).to.be.false;
  });

  it('has 2 imports', () => {
    expect(indexAnalysis.imports).to.have.length(2);
  });

  it('imports AuthService from services/authService', () => {
    const imp = indexAnalysis.imports.find((i) => i.toSpecifier === './services/authService');
    expect(imp).to.exist;
    expect(imp!.namedImports.map((n) => n.name)).to.include('AuthService');
  });

  it('imports signToken from utils/jwtUtil', () => {
    const imp = indexAnalysis.imports.find((i) => i.toSpecifier === './utils/jwtUtil');
    expect(imp).to.exist;
    expect(imp!.namedImports.map((n) => n.name)).to.include('signToken');
  });

  it('exports authService as named variable', () => {
    const sym = indexAnalysis.symbols.find((s) => s.name === 'authService');
    expect(sym).to.exist;
    expect(sym!.exported).to.be.true;
  });
});
