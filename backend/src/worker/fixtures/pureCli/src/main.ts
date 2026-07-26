#!/usr/bin/env node
// The `bin` target. Five subcommands registered on one builder — the old rule
// ("first exported symbol of a file under cli|bin|commands/") reported this
// entire tool as a single entrypoint, and reported nothing at all for a tool
// without one of those directories in its path.
import { runInit } from './commands/init';
import { runBuild } from './commands/build';
import { runWatch } from './commands/watch';
import { runClean } from './commands/clean';
import { printReport } from './report';

interface Builder {
  command(spec: string): Builder;
  option(spec: string): Builder;
  description(text: string): Builder;
  action(handler: (...args: string[]) => unknown): Builder;
  parse(argv: string[]): void;
}

declare function createProgram(): Builder;

const program = createProgram();

program
  .command('init <dir>')
  .description('create a taskr workspace')
  .action(runInit);

program
  .command('build')
  .option('--minify')
  .description('build every task in the workspace')
  .action(runBuild);

program
  .command('watch')
  .description('rebuild on change')
  .action(runWatch);

program
  .command('clean')
  .description('remove build output')
  .action(runClean);

program
  .command('report')
  .description('summarize the last run')
  .action(printReport);

program.parse(process.argv);
