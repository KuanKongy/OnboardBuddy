/**
 * Git-ref validation and URL construction for the GitHub API
 * (doc/SECURITY_XSS_PROMPT_INJECTION.md finding P4).
 *
 * The vulnerability was shape, not just missing validation: a branch was
 * interpolated straight into `…/commits/${branch}` and `…/zipball/${branch}`.
 * `fetch` normalizes `..` in a path before sending, so a crafted ref could
 * reach OTHER api.github.com endpoints while carrying our repo-scoped
 * installation token — a constrained authenticated SSRF — and `?`/`#` could
 * bolt a query or fragment onto the request.
 *
 * These tests assert on the URL that actually leaves the process, by
 * intercepting `fetch`. Asserting only on the validator would not prove the
 * call site uses it.
 */

import { expect } from 'chai';
import { downloadZipball, getCommitSha, isValidGitRef } from '../github.js';

describe('isValidGitRef', () => {
  it('accepts ordinary branch, tag, and namespaced ref names', () => {
    for (const ref of ['main', 'develop', 'feature/add-auth', 'release/v1.2.3', 'v1.0.0', '2026-fix', 'user_branch', 'a.b.c']) {
      expect(isValidGitRef(ref), ref).to.equal(true);
    }
  });

  it('rejects path traversal — the actual SSRF primitive', () => {
    for (const ref of ['../../user/repos', 'main/../../../app', '..', 'a/../b', 'main/..']) {
      expect(isValidGitRef(ref), ref).to.equal(false);
    }
  });

  it('rejects characters that end the URL path', () => {
    for (const ref of ['main?per_page=100', 'main#frag', 'main%2f..', 'main%00']) {
      expect(isValidGitRef(ref), ref).to.equal(false);
    }
  });

  it('rejects git-illegal refs and control characters', () => {
    for (const ref of ['main~1', 'main^', 'ref:with:colons', 'star*', 'brack[et]', 'back\\slash', 'main@{upstream}', 'main.lock', 'has space', 'nl\nref', 'tab\tref']) {
      expect(isValidGitRef(ref), ref).to.equal(false);
    }
  });

  it('rejects empty, over-long, and non-string refs', () => {
    expect(isValidGitRef('')).to.equal(false);
    expect(isValidGitRef('a'.repeat(256))).to.equal(false);
    expect(isValidGitRef(undefined as unknown as string)).to.equal(false);
    expect(isValidGitRef(null as unknown as string)).to.equal(false);
    expect(isValidGitRef('a/'.repeat(30))).to.equal(false, 'absurd segment count');
  });

  it('rejects segments that do not start with an alphanumeric or underscore', () => {
    for (const ref of ['.hidden', '-flag', 'ok/.hidden', 'ok/-flag']) {
      expect(isValidGitRef(ref), ref).to.equal(false);
    }
  });
});

describe('GitHub API URLs built from a ref', () => {
  const originalFetch = globalThis.fetch;
  let requested: string[] = [];

  beforeEach(() => {
    requested = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response('abc123', { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('a legitimate namespaced branch keeps its slash (it is a path, not a segment)', async () => {
    await getCommitSha('tok', 'owner', 'repo', 'feature/add-auth');
    expect(requested[0]).to.equal('https://api.github.com/repos/owner/repo/commits/feature/add-auth');
  });

  it('rejects a traversal ref before any request is made — commits endpoint', async () => {
    let threw = false;
    try {
      await getCommitSha('tok', 'owner', 'repo', '../../user/repos');
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.include('Invalid git ref');
    }
    expect(threw, 'should have thrown').to.equal(true);
    expect(requested, 'no request may leave the process').to.have.length(0);
  });

  it('rejects a traversal ref before any request is made — zipball endpoint', async () => {
    let threw = false;
    try {
      await downloadZipball('tok', 'owner', 'repo', '../../../app/installations', '/dev/null');
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.include('Invalid git ref');
    }
    expect(threw, 'should have thrown').to.equal(true);
    expect(requested).to.have.length(0);
  });

  it('encodes owner and repo rather than trusting them', async () => {
    await getCommitSha('tok', 'own er', 're/po', 'main');
    expect(requested[0]).to.equal('https://api.github.com/repos/own%20er/re%2Fpo/commits/main');
  });

  it('no accepted ref can produce a path outside the repo scope', async () => {
    // Property check: for every ref the validator accepts, the resulting URL
    // must still be under /repos/{owner}/{repo}/.
    for (const ref of ['main', 'feature/add-auth', 'release/v1.2.3', 'a/b/c/d']) {
      requested = [];
      await getCommitSha('tok', 'owner', 'repo', ref);
      const url = new URL(requested[0]!);
      expect(url.origin).to.equal('https://api.github.com');
      expect(url.pathname.startsWith('/repos/owner/repo/'), ref).to.equal(true);
      expect(url.search, ref).to.equal('');
      expect(url.hash, ref).to.equal('');
    }
  });
});
