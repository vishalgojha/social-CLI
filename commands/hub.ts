const fs = require('fs');
const path = require('path');
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

function parseBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function readTextFile(file) {
  const full = path.resolve(process.cwd(), String(file || '').trim());
  if (!fs.existsSync(full)) {
    throw new Error(`File not found: ${full}`);
  }
  return fs.readFileSync(full, 'utf8');
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

function printTrustResult(trust) {
  if (!trust) return;
  if (Array.isArray(trust.errors) && trust.errors.length) {
    trust.errors.forEach((row) => console.log(chalk.red(`Trust error: ${row}`)));
  }
  if (Array.isArray(trust.warnings) && trust.warnings.length) {
    trust.warnings.forEach((row) => console.log(chalk.yellow(`Trust warning: ${row}`)));
  }
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
        const signed = v.signature ? 'signed' : 'unsigned';
        console.log(`- ${v.version} | ${v.publisher || 'unknown publisher'} | ${signed} | ${v.publishedAt || 'unknown date'} | ${v.changelog || ''}`);
      });
      console.log('');
    });

  cmd
    .command('install <spec>')
    .description('Install package spec (<id> or <id>@<version>)')
    .option('--yes', 'Skip confirmation prompt', false)
    .option('--no-trust', 'Bypass trust-policy enforcement checks')
    .option('--json', 'Output JSON')
    .action(async (spec, options) => {
      if (!options.yes && process.stdout.isTTY) {
        const ok = await confirmInstall(spec);
        if (!ok) {
          console.log(chalk.yellow('\nInstall cancelled.\n'));
          return;
        }
      }
      const result = hub.installPackage(spec, { enforceTrust: Boolean(options.trust) });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK ${result.status}: ${result.package.id}@${result.version.version}`));
      printTrustResult(result.trust);
      console.log('');
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

  cmd
    .command('sync')
    .description('Sync catalog from file or remote URL')
    .requiredOption('--source <source>', 'Catalog source path or URL')
    .option('--replace', 'Replace local catalog instead of merge', false)
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const out = await hub.syncCatalog({
        source: options.source,
        merge: !options.replace
      });
      if (options.json) {
        console.log(JSON.stringify(out, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Synced catalog from ${out.source}`));
      console.log(chalk.gray(`Incoming: ${out.incomingCount} | Total: ${out.totalCount} | Merge: ${out.merge}`));
      console.log('');
    });

  cmd
    .command('publish <file>')
    .description('Publish a package manifest file into the local hub catalog')
    .option('--private-key <pemFile>', 'PEM private key for signature')
    .option('--publisher <id>', 'Publisher override')
    .option('--no-sign', 'Publish without signature')
    .option('--json', 'Output JSON')
    .action((file, options) => {
      const privateKeyPem = options.privateKey ? readTextFile(options.privateKey) : '';
      const out = hub.publishFromFile(file, {
        sign: Boolean(options.sign),
        privateKeyPem,
        publisher: options.publisher || ''
      });
      if (options.json) {
        console.log(JSON.stringify(out, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Published ${out.package.id}@${out.version.version}`));
      console.log(chalk.gray(`Publisher: ${out.version.publisher || 'unknown'} | Signed: ${out.signed}`));
      console.log('');
    });

  const trust = cmd.command('trust').description('Trust policy and publisher key management');

  trust
    .command('show')
    .description('Show current trust policy')
    .option('--json', 'Output JSON')
    .action((options) => {
      const policy = hub.loadTrustPolicy();
      if (options.json) {
        console.log(JSON.stringify(policy, null, 2));
        return;
      }
      console.log(chalk.bold('\nHub Trust Policy'));
      console.log(chalk.gray(`Mode: ${policy.mode}`));
      console.log(chalk.gray(`Require Signed: ${policy.requireSigned}`));
      console.log(chalk.gray(`Allowed Publishers: ${(policy.allowedPublishers || []).join(', ') || '(none)'}`));
      console.log(chalk.gray(`Blocked Publishers: ${(policy.blockedPublishers || []).join(', ') || '(none)'}`));
      console.log(chalk.gray(`Trusted Keys: ${Object.keys(policy.trustedKeys || {}).length}`));
      console.log('');
    });

  trust
    .command('set')
    .description('Set trust mode and signature requirement')
    .option('--mode <mode>', 'warn|enforce')
    .option('--require-signed <bool>', 'Require signatures true|false')
    .option('--json', 'Output JSON')
    .action((options) => {
      const patch = {};
      if (options.mode !== undefined) patch.mode = options.mode;
      if (options.requireSigned !== undefined) patch.requireSigned = parseBool(options.requireSigned, false);
      const policy = hub.setTrustPolicy(patch);
      if (options.json) {
        console.log(JSON.stringify(policy, null, 2));
        return;
      }
      console.log(chalk.green('\nOK Trust policy updated.\n'));
    });

  trust
    .command('allow <publisher>')
    .description('Allow publisher id')
    .option('--json', 'Output JSON')
    .action((publisher, options) => {
      const policy = hub.allowPublisher(publisher);
      if (options.json) {
        console.log(JSON.stringify(policy, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Allowed publisher: ${publisher}\n`));
    });

  trust
    .command('block <publisher>')
    .description('Block publisher id')
    .option('--json', 'Output JSON')
    .action((publisher, options) => {
      const policy = hub.blockPublisher(publisher);
      if (options.json) {
        console.log(JSON.stringify(policy, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Blocked publisher: ${publisher}\n`));
    });

  trust
    .command('import-key <publisher>')
    .description('Import trusted public key PEM for a publisher')
    .requiredOption('--file <pemFile>', 'Public key PEM path')
    .option('--json', 'Output JSON')
    .action((publisher, options) => {
      const pem = readTextFile(options.file);
      const policy = hub.setTrustedKey(publisher, pem);
      if (options.json) {
        console.log(JSON.stringify(policy, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Imported key for publisher: ${publisher}\n`));
    });

  trust
    .command('remove-key <publisher>')
    .description('Remove trusted key for a publisher')
    .option('--json', 'Output JSON')
    .action((publisher, options) => {
      const policy = hub.removeTrustedKey(publisher);
      if (options.json) {
        console.log(JSON.stringify(policy, null, 2));
        return;
      }
      console.log(chalk.green(`\nOK Removed key for publisher: ${publisher}\n`));
    });
}

module.exports = registerHubCommands;
