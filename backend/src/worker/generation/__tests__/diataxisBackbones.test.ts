import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db';
import { topologyDiagram, erDiagram, envExternalServices } from '../diagrams';
import { buildRoutesJobsBackbone, buildDataModelBackbone } from '../referenceBackbones';

/**
 * Step-2 deterministic surfaces: anchor diagrams (topology, ER) and CONSULT
 * backbones. Everything asserted here must be reproducible byte-for-byte
 * from the same facts — that IS the contract.
 */

describe('anchor diagrams (Diátaxis presentation rule 1)', () => {
  it('topologyDiagram draws services, depends_on wiring, and env-derived externals', () => {
    const mermaid = topologyDiagram(
      [
        { name: 'backend-api', ports: ['3000:3000'] },
        { name: 'backend-worker' },
        { name: 'frontend', ports: ['5173:80'], dependsOn: ['backend-api'] },
      ],
      ['Supabase (Postgres + Auth)', 'Redis', 'GitHub App/API', 'OpenRouter'],
    );
    expect(mermaid).to.contain('subgraph runtime');
    expect(mermaid).to.contain('backend-api :3000');
    expect(mermaid).to.contain('-->|depends on|');
    expect(mermaid).to.contain('subgraph external');
    expect(mermaid).to.contain('Supabase');
    expect(mermaid).to.contain('runtime -.-> external');
  });

  it('envExternalServices maps env names to services and never draws Postgres beside Supabase', () => {
    const labels = envExternalServices([
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL',
      'UPSTASH_REDIS_URL', 'GITHUB_APP_ID', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY',
      'IRRELEVANT_FLAG',
    ]);
    expect(labels).to.include.members([
      'Supabase (Postgres + Auth)', 'Redis', 'GitHub App/API', 'OpenRouter', 'OpenAI',
    ]);
    expect(labels).to.not.include('Postgres');
  });

  it('erDiagram draws parent ||--o{ child from parsed FK references', () => {
    const mermaid = erDiagram([
      { name: 'users', references: [] },
      { name: 'projects', references: ['users'] },
      { name: 'analysis_snapshots', references: ['projects', 'analysis_scopes'] },
      { name: 'analysis_scopes', references: ['projects'] },
      { name: 'isolated_table', references: [] },
    ]);
    expect(mermaid).to.contain('erDiagram');
    expect(mermaid).to.contain('users ||--o{ projects');
    expect(mermaid).to.contain('projects ||--o{ analysis_snapshots');
    expect(mermaid).to.not.contain('isolated_table');
  });

  it('erDiagram returns empty when no relationships exist (section states it instead)', () => {
    expect(erDiagram([{ name: 'a', references: [] }])).to.equal('');
  });
});

describe('CONSULT backbones (deterministic-first reference)', () => {
  afterEach(() => __setQueryForTests(null));

  it('routes backbone groups by path prefix with handlers, queues, and webhooks', async () => {
    __setQueryForTests(async (text) => {
      if (text.includes("trigger_type = 'http_route'")) {
        return { rows: [
          { method: 'POST', route_path: '/api/auth/login', file_path: 'src/api/routes/auth.ts', line_start: 20, symbol: 'POST /login', workflow_title: 'POST /api/auth/login' },
          { method: 'POST', route_path: '/api/auth/signup', file_path: 'src/api/routes/auth.ts', line_start: 10, symbol: 'POST /signup', workflow_title: null },
          { method: 'POST', route_path: '/api/webhooks/github', file_path: 'src/api/routes/webhooks.ts', line_start: 5, symbol: null, workflow_title: null },
        ] } as never;
      }
      if (text.includes("trigger_type = 'worker_job'")) {
        return { rows: [{ queue_name: 'SUMMARY_QUEUE', file_path: 'src/worker/summaryWorker.ts', symbol: 'processSummaryJob' }] } as never;
      }
      if (text.includes("type = 'queue_enqueue'")) {
        return { rows: [{ job: 'generate_summary', hint: 'summary' }] } as never;
      }
      return { rows: [] } as never;
    });
    const md = await buildRoutesJobsBackbone('snap-1');
    expect(md).to.contain('#### `/api/auth`');
    expect(md).to.contain('| POST | `/api/auth/login` |');
    expect(md).to.contain('`src/api/routes/auth.ts:20`');
    expect(md).to.contain('#### Queues & background jobs');
    // Queue-token match: SUMMARY_QUEUE consumer <- 'summary' hint.
    expect(md).to.contain('`generate_summary`');
    expect(md).to.contain('#### Webhooks (externally triggered)');
    expect(md).to.contain('/api/webhooks/github');
  });

  it('data-model backbone lists tables with FK references and top accessors', async () => {
    __setQueryForTests(async (text) => {
      if (text.includes("type = 'schema'")) {
        return { rows: [
          { name: 'users', file_path: 'migrations/001.sql', line_start: 10, refs: null },
          { name: 'projects', file_path: 'migrations/001.sql', line_start: 30, refs: ['users'] },
        ] } as never;
      }
      if (text.includes("e.type = 'touches_schema'")) {
        return { rows: [
          { table_name: 'projects', accessor: 'src/api/routes/projects.ts', n: 5 },
        ] } as never;
      }
      return { rows: [] } as never;
    });
    const md = await buildDataModelBackbone('snap-1');
    expect(md).to.contain('Source of truth: `migrations/001.sql` (2 tables');
    expect(md).to.contain('| `projects` | migrations/001.sql:30 | `users` | `src/api/routes/projects.ts` |');
    expect(md).to.contain('| `users` |');
  });

  it('regenerating from the same facts is byte-identical', async () => {
    const stub = async (text: string) => {
      if (text.includes("trigger_type = 'http_route'")) {
        return { rows: [{ method: 'GET', route_path: '/api/health', file_path: 'src/api/routes/health.ts', line_start: 1, symbol: null, workflow_title: null }] } as never;
      }
      return { rows: [] } as never;
    };
    __setQueryForTests(stub as never);
    const first = await buildRoutesJobsBackbone('snap-1');
    const second = await buildRoutesJobsBackbone('snap-1');
    expect(first).to.equal(second);
  });
});
