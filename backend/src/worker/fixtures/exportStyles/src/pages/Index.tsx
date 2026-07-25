import { loadSummary } from '../lib/helpers';

/**
 * The `const X = () => {}` + `export default X` style. Before export
 * reconciliation this symbol was `exported: false`, so it never became a
 * `ui_route` — the whole reason a project written this way reported zero
 * pages while an identically-shaped project reported all of them.
 */
const Index = () => {
  const summary = loadSummary();
  return summary;
};

export default Index;
