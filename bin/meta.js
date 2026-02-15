#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');

const program = new Command();

// Import command modules
const authCommands = require('../commands/auth');
const queryCommands = require('../commands/query');
const appCommands = require('../commands/app');
const limitsCommands = require('../commands/limits');

const asciiBanner = `
 __  __      _          ____ _     ___
|  \\/  | ___| |_ __ _  / ___| |   |_ _|
| |\\/| |/ _ \\ __/ _\` | |   | |    | |
| |  | |  __/ || (_| | |___| |___ | |
|_|  |_|\\___|\\__\\__,_|  \\____|_____|___|
`;

function showBanner() {
  console.log(chalk.cyanBright(asciiBanner));
  console.log(chalk.yellow('For devs tired of token gymnastics'));
  console.log(chalk.green('Built by Chaos Craft Labs.'));
  console.log('');
}

const shouldShowBanner = process.argv.length <= 2 ||
  process.argv.includes('--help') ||
  process.argv.includes('-h');

if (shouldShowBanner) {
  showBanner();
}

program
  .name('meta')
  .description(chalk.gray('A CLI for Meta\'s APIs. For devs tired of token gymnastics.'))
  .version(packageJson.version);

// Register command groups
authCommands(program);
queryCommands(program);
appCommands(program);
limitsCommands(program);

// Custom help
program.on('--help', () => {
  console.log('');
  console.log(chalk.yellow('Examples:'));
  console.log('  $ meta auth login              ' + chalk.gray('# Authenticate with Meta'));
  console.log('  $ meta query me                ' + chalk.gray('# Get your profile info'));
  console.log('  $ meta app info                ' + chalk.gray('# View app configuration'));
  console.log('  $ meta limits check            ' + chalk.gray('# Check rate limits'));
  console.log('');
  console.log(chalk.cyan('Documentation: https://github.com/vishalgojha/meta-cli'));
});

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
