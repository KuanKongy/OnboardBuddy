import * as fs from 'node:fs';
import { loadConfig } from '../config';

export function runClean(): void {
  const config = loadConfig(process.cwd());
  fs.rmSync(config.outDir, { recursive: true, force: true });
}
