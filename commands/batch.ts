const chalk = require('chalk');
const ora = require('ora');
const { runBatch } = require('../lib/batch');

function registerBatchCommands(program) {
  const batch = program.command('batch').description('Batch runner for tool-based jobs (JSON/CSV)');

  batch
    .command('run <file>')
    .description('Run a batch file (.json or .csv) with jobs using registered tools')
    .option('-c, --concurrency <n>', 'Concurrency (default 3)', '3')
    .option('--profile <name>', 'Force profile for all jobs (optional)')
    .option('--yes', 'Allow high-risk tools (otherwise they are skipped)')
    .option('--dry-run', 'Simulate (tools that support it will not write)')
    .option('--verbose', 'Verbose tool logging (no secrets)')
    .option('--json', 'Output JSON (results only)')
    .action(async (file, options) => {
      const spinner = options.json ? null : ora('Running batch...').start();
      try {
        const out = await runBatch({
          filePath: file,
          concurrency: parseInt(options.concurrency, 10) || 3,
          yes: Boolean(options.yes),
          dryRun: Boolean(options.dryRun),
          verbose: Boolean(options.verbose),
          json: Boolean(options.json),
          profile: options.profile || ''
        });
        if (spinner) spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        console.log(chalk.green('OK Batch complete'));
      } catch (e) {
        if (spinner) spinner.stop();
        console.error(chalk.red(`X Batch failed: ${e.message}`));
        process.exit(1);
      }
    });
}

module.exports = registerBatchCommands;

