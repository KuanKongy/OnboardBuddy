import * as fs from 'node:fs';
import { loadConfig } from '../config';

export function runBuild(): void {
  const config = loadConfig(process.cwd());
  for (const task of config.tasks) {
    fs.writeFileSync(`${config.outDir}/${task}.out`, compileTask(task));
  }
}

function compileTask(task: string): string {
  return `# ${task}\n`;
}
