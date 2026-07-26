import * as fs from 'node:fs';
import { loadConfig } from '../config';

export function runInit(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/taskr.json`, JSON.stringify(loadConfig(dir), null, 2));
}
