import * as fs from 'node:fs';
import { loadConfig } from './config';

/** The `report` command's handler. Lives outside `commands/` on purpose: the
 *  registration, not the directory, is what makes it a command. */
export function printReport(): void {
  const config = loadConfig(process.cwd());
  const built = fs.existsSync(config.outDir) ? fs.readdirSync(config.outDir) : [];
  process.stdout.write(`${built.length} task outputs in ${config.outDir}\n`);
}
