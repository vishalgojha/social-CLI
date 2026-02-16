const chalk = require('chalk');
const inquirer = require('inquirer');
const hub = require('../lib/hub/storage');

function printRows(title, rows) {
  console.log(chalk.bold(`\n${title}`));
  if (!rows.length) {
    console.log(chalk.gray('(none)\n'));
    return;
  }
  rows.forEach((line) => console.log(`- ${line}`));
  console.log('');
}

function rowSummary(pkg) {
  const latest = Array.isArray(pkg.versions) && pkg.versions.length ? pkg.versions[0].version : 'n/a';
  return `${pkg.id} | ${pkg.type} | latest=${latest} | ${pkg.description}`;
}

async function confirmInstall(spec) {
  const ans = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ok',
      default: false,
      message: `Install package "${spec}"?`
    }
  ]);
  return Boolean(ans.ok);
}

function registerHubCommands(program) {
  const cmd = program
    .command('hub')
    .description('Package hub for connectors, playbooks, and agent skills');

  cmd
    .command('search [query]')
    .description('Search package catalog')
    .option('--tag <tag>', 'Filter by tag')
    .option('--type <type>', 'Filter by type: connector|playbook|skill')
    .option('--json', 'Output JSON')
    .action((query, options) => {
      const rows = hub.searchCatalog({
        query: query || '',
        tag: options.tag || '',
        type: options.type || ''
      });
      if (options.json) {
        console.log(JSON.stringify({ count: rows.length, packages: rows }, null, 2));
        return;
      }
      printRows('Hub Search Results', rows.map(rowSummary));
    });

  cmd
    .command('inspect <spec>')
    .description('Inspect package metadata and versions')
    .option('--json', 'Output JSON')
    .action((spec, options) => {
      const data = hub.inspectPackage(spec);
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(chalk.bold(`\n${data.name} (${data.id})`));
      console.log(chalk.gray(`Type: ${data.type}`));
      console.log(chalk.gray(`Tags: ${(data.tags || []).join(', ') || '(none)'}`));
      console.log(chalk.gray(`Description: ${data.description || '(none)'}`));
      console.log(chalk.bold('\nVersions:'));
      data.versions.forEach((v) => {
        console.log(`- ${v.version} | ${v.publishedAt || 'unknown date'} | ${v.changelog || ''}`);
      });
      console.log('');
    });

  cmd
    .command('install <spec>')
    .description('Install package spec (<id> or <id>@<version>)')
    .option('--yes', 'Skip confirmation prompt', false)
    .option('--json', 'Output JSON')
    .action(async (spec, options) => {
      if (!options.yes && process.stdout.isTTY) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await confirmInstall(spec);
        if (!ok) {
          console.log(chalk.yellow('\nInstall cancelled.\n'));
          return;
        }
      }
      const result = hub.installPackage(spec);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK ${result.status}: ${result.package.id}@${result.version.version}\n`));
    });

  cmd
    .command('list')
    .description('List installed packages')
    .option('--json', 'Output JSON')
    .action((options) => {
      const rows = hub.listInstalled();
      if (options.json) {
        console.log(JSON.stringify({ count: rows.length, packages: rows }, null, 2));
        return;
      }
      printRows(
        'Installed Packages',
        rows.map((x) => `${x.id} | ${x.type} | ${x.version} | ${x.installedAt}`)
      );
    });

  cmd
    .command('update [id]')
    .description('Update one installed package, or all packages when id is omitted')
    .option('--json', 'Output JSON')
    .action((id, options) => {
      const result = id ? [hub.updatePackage(id)] : hub.updateAll();
      if (options.json) {
        console.log(JSON.stringify({ count: result.length, updates: result }, null, 2));
        return;
      }
      printRows(
        'Hub Updates',
        result.map((x) => `${x.package.id}@${x.version.version} (${x.status})`)
      );
    });
}

module.exports = registerHubCommands;
