import { expect } from 'chai';
import { pickDiverseWorkflows, workflowFamily } from '../tutorialGenerator.js';

/**
 * Audit §5.3: tutorial selection filled every slot with trivial reads. The
 * dogfood failure shape — five GETs outscoring the write/enqueue flows —
 * must never fully occupy the selection again.
 */
describe('tutorialGenerator.pickDiverseWorkflows', () => {
  const wf = (title: string, score: number, trigger: string) => ({
    row: title,
    score,
    family: workflowFamily(trigger),
  });

  it('caps read-only families at two and pulls writes up', () => {
    const picked = pickDiverseWorkflows(
      [
        wf('GET a', 0.9, 'HTTP GET'),
        wf('GET b', 0.8, 'HTTP GET'),
        wf('GET c', 0.7, 'HTTP GET'),
        wf('GET d', 0.6, 'HTTP GET'),
        wf('POST analyze', 0.5, 'HTTP POST'),
        wf('page render', 0.4, 'UI page'),
      ],
      4,
    );
    expect(picked).to.deep.equal(['GET a', 'GET b', 'POST analyze', 'page render']);
  });

  it('backfills past the cap when nothing else is left', () => {
    const picked = pickDiverseWorkflows(
      [wf('GET a', 0.9, 'HTTP GET'), wf('GET b', 0.8, 'HTTP GET'), wf('GET c', 0.7, 'HTTP GET')],
      3,
    );
    expect(picked).to.deep.equal(['GET a', 'GET b', 'GET c']);
  });

  it('families: GETs and pages are capped, verbs and jobs are not', () => {
    expect(workflowFamily('HTTP GET')).to.equal('read_route');
    expect(workflowFamily('UI page')).to.equal('ui');
    expect(workflowFamily('HTTP POST')).to.equal('write_route');
    expect(workflowFamily('worker_job')).to.equal('worker_job');
  });
});
