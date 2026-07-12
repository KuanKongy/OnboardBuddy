import * as fs from 'fs';

export class DatasetProcessor {
  public async processAddDataset(id: string, content: string): Promise<string[]> {
    const rows = JSON.parse(content) as string[];
    if (rows.length === 0) {
      throw new Error('dataset is empty');
    }
    fs.writeFileSync(`data/${id}.json`, JSON.stringify(rows));
    return rows.map((r) => `${id}:${r}`);
  }
}
