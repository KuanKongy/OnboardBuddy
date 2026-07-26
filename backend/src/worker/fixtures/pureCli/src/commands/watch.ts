import * as fs from 'node:fs';
import { loadConfig } from '../config';
import { runBuild } from './build';

export function runWatch(): void {
  const config = loadConfig(process.cwd());
  fs.watch(config.rootDir, { recursive: true }, () => runBuild());
}
