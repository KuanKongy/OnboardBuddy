import { InsightFacade } from '../../src/controller/InsightFacade.js';

// A spec file under test/controller/ — its path matches the /controller/i
// convention, but test files must never become http_route entrypoints.
export function runFacadeSpec(): Promise<string[]> {
  const facade = new InsightFacade();
  return facade.addDataset('courses', 'sections', '["cpsc310"]');
}
