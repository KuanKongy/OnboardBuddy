import * as fs from 'fs';

export class QueryRunner {
  public async runQuery(queryText: string): Promise<string[]> {
    const datasets = fs.readFileSync('data/index.json', 'utf-8');
    const ids = JSON.parse(datasets) as string[];
    if (ids.length === 0) {
      throw new Error('no datasets loaded');
    }
    return ids.filter((id) => queryText.includes(id));
  }
}
