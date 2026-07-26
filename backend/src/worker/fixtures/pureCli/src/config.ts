import * as fs from 'node:fs';

export interface TaskrConfig {
  rootDir: string;
  outDir: string;
  tasks: string[];
}

export function loadConfig(dir: string): TaskrConfig {
  const raw = fs.existsSync(`${dir}/taskr.json`) ? fs.readFileSync(`${dir}/taskr.json`, 'utf8') : '{}';
  return { rootDir: dir, outDir: `${dir}/out`, tasks: [], ...(JSON.parse(raw) as Partial<TaskrConfig>) };
}
