"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const chalk = require("chalk");
const ora = require("ora");
const axios_1 = __importDefault(require("axios"));
const config = require('../../lib/config');
const MetaAPIClient = require('../../lib/api-client');
function getTokenOrExit(api) {
    const token = config.getToken(api);
    if (!token) {
        console.error(chalk.red(`X No ${api} token found. Run: social auth login -a ${api}`));
        process.exit(1);
    }
    return token;
}
function registerUtilsCommands(program) {
    const utils = program.command('utils').description('Utilities: config, version, limits');
    const version = utils.command('version').description('API version management');
    version
        .command('set <apiVersion>')
        .description('Set Graph API version (e.g. v19.0 or v20.0)')
        .action((apiVersion) => {
        if (!/^v\d+\.\d+$/.test(apiVersion)) {
            console.error(chalk.red('X Invalid version format. Use like v20.0'));
            process.exit(1);
        }
        config.setApiVersion(apiVersion);
        console.log(chalk.green(`OK API version set to: ${apiVersion}\n`));
    });
    const cfg = utils.command('config').description('Configuration helpers');
    cfg
        .command('show')
        .description('Show current configuration (sanitized)')
        .action(() => config.display());
    cfg
        .command('set-default-page <pageId>')
        .description('Set default Facebook Page ID')
        .action((pageId) => {
        config.setDefaultFacebookPageId(pageId);
        console.log(chalk.green(`OK Default Facebook Page set to: ${pageId}\n`));
    });
    cfg
        .command('set-default-ig-user <igUserId>')
        .description('Set default Instagram user ID')
        .action((igUserId) => {
        config.setDefaultIgUserId(igUserId);
        console.log(chalk.green(`OK Default IG user set to: ${igUserId}\n`));
    });
    cfg
        .command('set-default-whatsapp-phone <phoneNumberId>')
        .description('Set default WhatsApp Phone Number ID')
        .action((phoneNumberId) => {
        config.setDefaultWhatsAppPhoneNumberId(phoneNumberId);
        console.log(chalk.green(`OK Default WhatsApp phone set to: ${phoneNumberId}\n`));
    });
    const limits = utils.command('limits').description('Rate limit helpers');
    limits
        .command('check')
        .description('Check current rate limit status (from response headers)')
        .option('-a, --api <api>', 'API to use', config.getDefaultApi())
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        const token = getTokenOrExit(options.api);
        const spinner = ora('Checking rate limits...').start();
        const client = new MetaAPIClient(token, options.api);
        try {
            const response = await axios_1.default.get(`${client.baseUrl}/me`, {
                params: { access_token: token, fields: 'id' },
                validateStatus: () => true
            });
            spinner.stop();
            const headers = response.headers || {};
            const usage = headers['x-app-usage'] ? JSON.parse(String(headers['x-app-usage'])) : null;
            const businessUsage = headers['x-business-use-case-usage']
                ? JSON.parse(String(headers['x-business-use-case-usage']))
                : null;
            const payload = { usage, businessUsage };
            if (options.json) {
                console.log(JSON.stringify(payload, null, 2));
                return;
            }
            console.log(chalk.bold('\nRate Limit Status:'));
            console.log(chalk.gray('─'.repeat(50)));
            if (usage) {
                console.log(chalk.bold('\nApp Usage:'));
                Object.entries(usage).forEach(([key, value]) => {
                    const pct = Number(value);
                    const color = pct > 75 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
                    console.log(chalk.cyan(`  ${key}:`), color(`${pct}%`));
                });
            }
            else {
                console.log(chalk.yellow('\nNo rate limit info available (headers missing).'));
            }
            console.log('');
        }
        catch (error) {
            spinner.stop();
            client.handleError(error);
        }
    });
}
module.exports = registerUtilsCommands;
