import { expect } from 'chai';
import * as path from 'path';
import { scanRepositoryFiles, detectRepoInventory } from '../repoIngester';
import { scanConfigNodes } from '../configScanner';
import {
  extractConfigFlows,
  parseCompose,
  parseCiWorkflow,
  parseEnvExample,
} from '../configFlowExtractor';

const MIXED_DIR = path.resolve(__dirname, '../../fixtures/mixed');

/**
 * Config-as-flow (DETECTION_COVERAGE.md §3): "flow is not just code" — the
 * DevOps journeys live in compose/CI/env files and must extract
 * deterministically, with the topology stamped on the compose config node
 * (big_picture's anchor diagram reads it).
 */

describe('configFlowExtractor', () => {
  describe('on the mixed fixture (integration)', () => {
    let result: ReturnType<typeof extractConfigFlows>;
    let configNodes: ReturnType<typeof scanConfigNodes>;

    before(async () => {
      const fileRecords = await scanRepositoryFiles(MIXED_DIR);
      const inventory = await detectRepoInventory(MIXED_DIR, fileRecords);
      configNodes = scanConfigNodes(fileRecords, inventory);
      result = extractConfigFlows({ fileRecords, inventory, configNodes });
    });

    it('parses the main compose into a topology with wiring', () => {
      expect(result.topology, 'main topology').to.exist;
      const api = result.topology!.services.find((s) => s.name === 'api')!;
      expect(api.buildContext).to.equal('src');
      expect(api.ports).to.deep.equal(['3000:3000']);
      expect(api.dependsOn).to.deep.equal(['db']);
      expect(api.envFiles).to.deep.equal(['.env']);
      const db = result.topology!.services.find((s) => s.name === 'db')!;
      expect(db.image).to.equal('postgres:16');
    });

    it('separates the test compose and reads its command', () => {
      expect(result.testTopology, 'test topology').to.exist;
      expect(result.testTopology!.composePath).to.equal('docker-compose.test.yml');
      const test = result.testTopology!.services[0]!;
      expect(test.dockerfile).to.equal('Dockerfile.test');
      expect(test.command).to.equal('npm test');
    });

    it('emits dev-workflow journeys: compose up, test run, CI', () => {
      const titles = result.workflows.map((w) => w.title);
      expect(titles).to.include('Local dev: docker compose up');
      expect(titles).to.include('Run the test suite (one command)');
      expect(titles.some((t) => t.startsWith('CI: on'))).to.equal(true);

      const up = result.workflows.find((w) => w.title === 'Local dev: docker compose up')!;
      expect(up.triggerType).to.equal('dev_command');
      expect(up.steps[0]!.stepKind).to.equal('trigger');
      // depends_on order: db starts before api.
      const serviceOrder = up.steps.slice(1).map((s) => s.deterministicDescription);
      expect(serviceOrder[0]).to.contain('db');
      expect(serviceOrder[1]).to.contain('api');
      // Steps reference the compose config node (receipts resolve).
      expect(up.steps[0]!.nodeStableKey).to.equal('config:docker-compose.yml');
    });

    it('orders CI jobs by their needs-graph', () => {
      const ci = result.workflows.find((w) => w.title.startsWith('CI: on'))!;
      const jobSteps = ci.steps.slice(1).map((s) => s.deterministicDescription);
      expect(jobSteps[0]).to.contain('lint');
      expect(jobSteps[1]).to.contain('test');
      expect(jobSteps[1]).to.contain('needs: lint');
      expect(ci.title).to.contain('push');
    });

    it('stamps topology/ci/env/scripts into the config nodes for the sections', () => {
      const composeNode = configNodes.find((n) => n.filePath === 'docker-compose.yml')!;
      expect(composeNode.metadata.topology, 'topology on compose node').to.exist;
      const envNode = configNodes.find((n) => n.filePath === '.env.example')!;
      const envVars = envNode.metadata.envVars as Array<{ name: string; comment?: string }>;
      expect(envVars.map((v) => v.name)).to.deep.equal(['SECRET_TOKEN', 'DATABASE_URL']);
      expect(envVars[0]!.comment).to.contain('Auth token');
      const pkgNode = configNodes.find((n) => n.filePath === 'package.json')!;
      expect((pkgNode.metadata.scripts as Record<string, string>).dev).to.equal('node src/app.js');
    });

    it('never captures env values, only names and comments', () => {
      for (const { vars } of result.envVars) {
        for (const v of vars) {
          expect(Object.keys(v)).to.not.include('value');
        }
      }
    });
  });

  describe('parsers (unit)', () => {
    it('parseCompose handles build blocks, comments, and map-style depends_on', () => {
      const topo = parseCompose('docker-compose.yml', [
        'services:',
        '  backend-api:',
        '    build:',
        '      context: .',
        '      dockerfile: backend/Dockerfile.api',
        '    env_file:',
        '      - backend/.env',
        '    ports:',
        '      - "3000:3000"',
        '  # a comment between services',
        '  frontend:',
        '    build:',
        '      context: .',
        '    depends_on:',
        '      backend-api:',
        '        condition: service_started',
        'volumes:',
        '  data:',
      ].join('\n'))!;
      expect(topo.services.map((s) => s.name)).to.deep.equal(['backend-api', 'frontend']);
      const api = topo.services[0]!;
      expect(api.dockerfile).to.equal('backend/Dockerfile.api');
      expect(api.envFiles).to.deep.equal(['backend/.env']);
      const fe = topo.services[1]!;
      expect(fe.dependsOn).to.deep.equal(['backend-api']);
    });

    it('parseCiWorkflow handles inline on-lists and inline needs-lists', () => {
      const ci = parseCiWorkflow('.github/workflows/deploy.yml', [
        'name: Deploy',
        'on: [push, workflow_dispatch]',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '  deploy:',
        '    needs: [build]',
        '    runs-on: ubuntu-latest',
      ].join('\n'))!;
      expect(ci.triggers).to.deep.equal(['push', 'workflow_dispatch']);
      expect(ci.jobs.find((j) => j.name === 'deploy')!.needs).to.deep.equal(['build']);
    });

    it('parseEnvExample attaches multi-line comments and skips blanks', () => {
      const vars = parseEnvExample([
        '# Postgres pooler URL',
        '# (transaction mode)',
        'DATABASE_URL=postgres://x',
        '',
        'PLAIN=',
        'lowercase_ignored_value_line',
      ].join('\n'));
      expect(vars.map((v) => v.name)).to.deep.equal(['DATABASE_URL', 'PLAIN']);
      expect(vars[0]!.comment).to.equal('Postgres pooler URL (transaction mode)');
      expect(vars[1]!.comment).to.equal(undefined);
    });
  });
});
