const chalk = require('chalk');
const inquirer = require('inquirer');
const config = require('../lib/config');

function registerAccountsCommands(program) {
  const accounts = program.command('accounts').description('Manage multiple accounts/profiles');

  accounts
    .command('list')
    .description('List profiles and show the active one')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const profiles = config.listProfiles();
      const active = config.getActiveProfile();
      if (options.json) {
        console.log(JSON.stringify({ active, profiles }, null, 2));
        return;
      }
      console.log(chalk.bold('\nProfiles:'));
      profiles.forEach((p) => {
        const mark = p === active ? chalk.green('*') : ' ';
        console.log(`${mark} ${chalk.cyan(p)}`);
      });
      console.log('');
    });

  accounts
    .command('add <name>')
    .description('Create a new profile (e.g. client1)')
    .action((name) => {
      try {
        const created = config.createProfile(name);
        console.log(chalk.green(`OK Profile created: ${created}`));
        console.log('');
      } catch (e) {
        console.error(chalk.red(`X ${e.message}`));
        process.exit(1);
      }
    });

  accounts
    .command('switch <name>')
    .description('Switch active profile')
    .action((name) => {
      try {
        config.setActiveProfile(name);
        console.log(chalk.green(`OK Active profile: ${config.getActiveProfile()}`));
        console.log('');
      } catch (e) {
        console.error(chalk.red(`X ${e.message}`));
        process.exit(1);
      }
    });

  accounts
    .command('show [name]')
    .description('Show sanitized config for a profile (defaults to active)')
    .action((name) => {
      config.display({ profile: name || config.getActiveProfile() });
    });

  accounts
    .command('remove <name>')
    .description('Delete a profile (cannot delete active)')
    .action(async (name) => {
      if (!process.stdout.isTTY) {
        console.error(chalk.red('X Refusing to delete profile without a TTY.'));
        process.exit(1);
      }
      const ans = await inquirer.prompt([
        { type: 'confirm', name: 'ok', default: false, message: `Delete profile "${name}"?` }
      ]);
      if (!ans.ok) return;
      try {
        config.deleteProfile(name);
        console.log(chalk.green(`OK Profile deleted: ${name}`));
        console.log('');
      } catch (e) {
        console.error(chalk.red(`X ${e.message}`));
        process.exit(1);
      }
    });
}

module.exports = registerAccountsCommands;

