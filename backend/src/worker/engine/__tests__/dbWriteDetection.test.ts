import { expect } from 'chai';
import { detectSideEffects } from '../sideEffectDetector';
import { deriveBehaviorSignals } from '../behaviorSignals';
import type { FileAnalysis } from '../../types/analysis';

/**
 * Audit §5.4 regression: repos using a bare `query()` db helper (this one,
 * and the dogfood fork) had zero database_write detections because every
 * pattern required a dot-method call — so UPDATE/INSERT handlers shipped as
 * "Data Read" workflow steps.
 */

const bareQueryWrite = `export async function acceptInvite(token: string) {
  await query(
    \`UPDATE project_invitations SET status = 'accepted' WHERE token = $1\`,
    [token],
  );
  await query(\`INSERT INTO project_members (user_id) VALUES ($1)\`, [token]);
}`;

const bareQueryRead = `export async function listInvites() {
  return query(\`SELECT * FROM project_invitations\`);
}`;

function analysisWith(snippet: string): FileAnalysis[] {
  return [
    {
      relativePath: 'backend/src/api/routes/invitations.ts',
      symbols: [{ name: 'acceptInvite', callsSymbols: ['query'], snippet }],
    } as unknown as FileAnalysis,
  ];
}

describe('database write detection for bare query() helpers (audit §5.4)', () => {
  it('sideEffectDetector flags bare-query UPDATE/INSERT as database_write', () => {
    const effects = detectSideEffects(analysisWith(bareQueryWrite));
    const dbWrites = effects.filter((e) => e.kind === 'database_write');
    expect(dbWrites).to.have.length(1);
    expect(dbWrites[0]!.symbolStableKey).to.equal('backend/src/api/routes/invitations.ts#acceptInvite');
  });

  it('bare-query SELECT is not a write', () => {
    const effects = detectSideEffects(analysisWith(bareQueryRead));
    expect(effects.filter((e) => e.kind === 'database_write')).to.have.length(0);
  });

  it('behaviorSignals: bare-query writes carry database_write, reads only database_read', () => {
    const write = deriveBehaviorSignals({ callsSymbols: ['query'], snippet: bareQueryWrite });
    expect(write).to.include('database_write');
    expect(write).to.include('database_read'); // bare query( is also a read surface

    const read = deriveBehaviorSignals({ callsSymbols: ['query'], snippet: bareQueryRead });
    expect(read).to.include('database_read');
    expect(read).to.not.include('database_write');
  });

  it('prose "update the … set" never counts as SQL', () => {
    const signals = deriveBehaviorSignals({
      callsSymbols: [],
      snippet: 'function noteKeeper() { /* update the flag set by the caller */ }',
    });
    expect(signals).to.not.include('database_write');
  });
});
