"use strict";
const chalk = require("chalk");
const ora = require("ora");
const config = require('../../lib/config');
const MetaAPIClient = require('../../lib/api-client');
function registerAppCommands(program) {
    const app = program.command('app').description('Manage app information');
    app
        .command('info')
        .description('Get app information')
        .option('-i, --id <appId>', 'App ID (uses configured app if not provided)')
        .option('-a, --api <api>', 'API to use', config.getDefaultApi())
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        const { id, api, json } = options;
        const token = config.getToken(api);
        if (!token) {
            console.error(chalk.red(`✖ No ${api} token found. Run: social auth login -a ${api}`));
            process.exit(1);
        }
        let appId = id;
        if (!appId) {
            const credentials = config.getAppCredentials();
            appId = credentials.appId;
            if (!appId) {
                console.error(chalk.red('✖ No App ID configured. Use --id flag or run: social auth app'));
                process.exit(1);
            }
        }
        const spinner = ora('Fetching app info...').start();
        const client = new MetaAPIClient(token, api);
        try {
            const data = await client.getAppInfo(appId);
            spinner.stop();
            if (json) {
                console.log(JSON.stringify(data, null, 2));
                return;
            }
            console.log(chalk.bold('\nApp Information:'));
            console.log(chalk.gray('─'.repeat(50)));
            console.log(chalk.cyan('ID:'), data.id);
            console.log(chalk.cyan('Name:'), data.name);
            if (data.namespace)
                console.log(chalk.cyan('Namespace:'), data.namespace);
            if (data.category)
                console.log(chalk.cyan('Category:'), data.category);
            if (data.link)
                console.log(chalk.cyan('Link:'), data.link);
            if (data.daily_active_users !== undefined) {
                console.log(chalk.cyan('\nActive Users:'));
                console.log(chalk.cyan('  Daily:'), data.daily_active_users.toLocaleString());
                if (data.weekly_active_users !== undefined) {
                    console.log(chalk.cyan('  Weekly:'), data.weekly_active_users.toLocaleString());
                }
                if (data.monthly_active_users !== undefined) {
                    console.log(chalk.cyan('  Monthly:'), data.monthly_active_users.toLocaleString());
                }
            }
            console.log('');
        }
        catch (error) {
            spinner.stop();
            throw error;
        }
    });
    app
        .command('list')
        .description('List configured app credentials')
        .action(() => {
        const credentials = config.getAppCredentials();
        console.log(chalk.bold('\nConfigured App:'));
        console.log(chalk.gray('─'.repeat(50)));
        if (credentials.appId) {
            console.log(chalk.cyan('App ID:'), credentials.appId);
            console.log(chalk.cyan('App Secret:'), chalk.green('***configured***'));
        }
        else {
            console.log(chalk.yellow('No app credentials configured'));
            console.log(chalk.gray('\nTo configure: social auth app'));
        }
        console.log('');
    });
    app
        .command('set-default <appId>')
        .description('Set default app ID')
        .action((appId) => {
        const credentials = config.getAppCredentials();
        config.setAppCredentials(appId, credentials.appSecret || '');
        console.log(chalk.green(`✓ Default app ID set to: ${appId}`));
        console.log('');
    });
}
module.exports = registerAppCommands;
