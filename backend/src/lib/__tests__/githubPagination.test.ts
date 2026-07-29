import { expect } from 'chai';
import { listBranches, listInstallationRepos } from '../github.js';

type FetchFn = typeof globalThis.fetch;

interface RequestLog { url: string; }

/**
 * Stands in for GitHub's paginated collections: serves `total` synthetic items
 * in pages of 100, honouring `page` and `per_page`, and records every URL asked
 * for. A page shorter than `per_page` is the documented end-of-collection
 * signal, which is what the walker terminates on.
 */
function stubGitHub(total: number, shape: 'repositories' | 'array'): { log: RequestLog[]; restore: () => void } {
  const log: RequestLog[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    log.push({ url });
    const parsed = new URL(url);
    const perPage = Number(parsed.searchParams.get('per_page') ?? 30);
    const page = Number(parsed.searchParams.get('page') ?? 1);
    const start = (page - 1) * perPage;
    const items = Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) => ({
      id: start + i,
      name: `item-${start + i}`,
      full_name: `acme/item-${start + i}`,
      owner: { login: 'acme' },
      private: false,
      default_branch: 'main',
      commit: { sha: 'a'.repeat(40) },
    }));
    const body = shape === 'repositories' ? { total_count: total, repositories: items } : items;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as FetchFn;
  return { log, restore: () => { globalThis.fetch = original; } };
}

/**
 * Bug #67(2) — "large accounts cannot find their repository".
 *
 * Repo listing fetched one page of 100 and branch listing took the API default
 * of 30, with no pagination in either. Everything past that boundary silently
 * did not exist in the import picker — no error, no partial-list notice — which
 * is a hard blocker for exactly the org-scale teams this product targets.
 */
describe('github listings paginate to exhaustion (bug #67)', () => {
  it('returns every repository past the first page of 100', async () => {
    const { log, restore } = stubGitHub(237, 'repositories');
    try {
      const repos = await listInstallationRepos('tok');

      // The regression in one number: the old code returned exactly 100 here.
      expect(repos).to.have.length(237);
      expect(repos[236]!.full_name).to.equal('acme/item-236');
      expect((repos as { truncated?: boolean }).truncated).to.equal(false);

      // Three requests: two full pages and a short one that ends the walk.
      expect(log).to.have.length(3);
      expect(log[0]!.url).to.include('per_page=100').and.include('page=1');
      expect(log[1]!.url).to.include('page=2');
      expect(log[2]!.url).to.include('page=3');
    } finally {
      restore();
    }
  });

  it('returns every branch, not the API default of 30', async () => {
    const { log, restore } = stubGitHub(112, 'array');
    try {
      const branches = await listBranches('tok', 'acme', 'monorepo');

      expect(branches).to.have.length(112);
      // The old call sent no per_page at all and took whatever GitHub gave it.
      expect(log[0]!.url).to.include('per_page=100');
      expect(log).to.have.length(2);
    } finally {
      restore();
    }
  });

  it('stops after one request when the collection fits on a page', async () => {
    const { log, restore } = stubGitHub(12, 'repositories');
    try {
      const repos = await listInstallationRepos('tok');
      expect(repos).to.have.length(12);
      // A small account must not pay 20 round trips to discover it is small.
      expect(log).to.have.length(1);
    } finally {
      restore();
    }
  });

  it('bounds the walk and reports the cut rather than pretending the list is whole', async () => {
    // 20 pages x 100 is the ceiling; this account has more.
    const { log, restore } = stubGitHub(2500, 'repositories');
    try {
      const repos = await listInstallationRepos('tok');
      expect(repos).to.have.length(2000);
      expect((repos as { truncated?: boolean }).truncated, 'a cut list must say so').to.equal(true);
      expect(log).to.have.length(20);
    } finally {
      restore();
    }
  });

  it('surfaces a GitHub error instead of returning a short list', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('rate limited', { status: 403 })) as FetchFn;
    try {
      let threw: unknown;
      await listInstallationRepos('tok').catch((err) => { threw = err; });
      expect(threw).to.be.instanceOf(Error);
      expect((threw as Error).message).to.include('403');
    } finally {
      globalThis.fetch = original;
    }
  });
});
