import { DatasetProcessor } from '../datasetProcessor/DatasetProcessor.js';
import { QueryRunner } from '../queryProcessor/QueryRunner.js';

export class InsightFacade {
  private processor = new DatasetProcessor();
  private queryRunner = new QueryRunner();

  public async addDataset(id: string, kind: string, content: string): Promise<string[]> {
    if (!id || id.includes('_') || kind.length === 0) {
      throw new Error('invalid dataset id');
    }
    return this.processor.processAddDataset(id, content);
  }

  public async performQuery(queryText: string): Promise<string[]> {
    if (queryText.length === 0) {
      throw new Error('empty query');
    }
    return this.queryRunner.runQuery(queryText);
  }
}
