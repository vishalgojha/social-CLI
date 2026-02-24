"use strict";
const chalk = require("chalk");
const ora = require("ora");
const inquirer = require('inquirer');
const config = require('../../lib/config');
const MetaAPIClient = require('../../lib/api-client');
const { sanitizeForLog } = require('../../lib/api');
function getTokenOrExit() {
    const token = config.getToken('whatsapp');
    if (!token) {
        console.error(chalk.red('X No WhatsApp token found. Run: social auth login -a whatsapp'));
        process.exit(1);
    }
    return token;
}
function printRequestDebug({ endpoint, payload }) {
    console.log(chalk.gray('\nRequest:'));
    console.log(chalk.gray(`  POST ${endpoint}`));
    console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
    console.log('');
}
async function pickPhoneNumberId(phoneNumbers, defaultId) {
    const choices = (phoneNumbers || []).map((phone) => ({
        name: `${phone.display_phone_number || phone.verified_name || phone.id} (${phone.id})`,
        value: phone.id
    }));
    if (!choices.length)
        return null;
    const defaultIndex = defaultId ? choices.findIndex((choice) => choice.value === defaultId) : -1;
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'id',
            message: 'Select a WhatsApp Phone Number:',
            choices,
            default: defaultIndex >= 0 ? defaultIndex : 0
        }
    ]);
    return String(answers.id);
}
function registerWhatsAppCommands(program) {
    const whatsapp = program.command('whatsapp').description('WhatsApp Business (Cloud API)');
    whatsapp
        .command('send')
        .description('Send a WhatsApp message (text or image)')
        .requiredOption('--to <e164>', 'Recipient phone number in E.164 format (e.g. +15551234567)')
        .option('--from <phoneNumberId>', 'WhatsApp Phone Number ID (defaults to configured)')
        .option('--type <type>', 'Message type: text|image', 'text')
        .option('--body <text>', 'Text body (for type=text)')
        .option('--url <url>', 'Media URL (for type=image)')
        .option('--caption <text>', 'Caption (for type=image)')
        .option('--json', 'Output as JSON')
        .option('--dry-run', 'Print payload without calling the API')
        .option('--verbose', 'Print payload without secrets')
        .action(async (options) => {
        const token = getTokenOrExit();
        const type = String(options.type || 'text').toLowerCase();
        const to = options.to;
        const from = options.from || config.getDefaultWhatsAppPhoneNumberId();
        if (!from) {
            console.error(chalk.red('X Missing --from phone number id and no default set.'));
            console.error(chalk.gray('  Set one with: social utils config set-default-whatsapp-phone PHONE_NUMBER_ID'));
            process.exit(1);
        }
        const payload = { messaging_product: 'whatsapp', to };
        if (type === 'text') {
            if (!options.body) {
                console.error(chalk.red('X Missing --body for type=text'));
                process.exit(1);
            }
            payload.type = 'text';
            payload.text = { body: options.body };
        }
        else if (type === 'image') {
            if (!options.url) {
                console.error(chalk.red('X Missing --url for type=image'));
                process.exit(1);
            }
            payload.type = 'image';
            payload.image = { link: options.url };
            if (options.caption)
                payload.image.caption = options.caption;
        }
        else {
            console.error(chalk.red('X Invalid --type. Use: text, image'));
            process.exit(1);
        }
        if (options.verbose || options.dryRun) {
            printRequestDebug({ endpoint: `/${from}/messages`, payload });
        }
        if (options.dryRun)
            return;
        const spinner = ora('Sending WhatsApp message...').start();
        const client = new MetaAPIClient(token, 'whatsapp');
        try {
            const result = await client.sendWhatsAppMessage(from, payload);
            spinner.stop();
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            console.log(chalk.green('OK Message sent'));
            const msgId = result?.messages?.[0]?.id;
            if (msgId)
                console.log(chalk.cyan('  Message ID:'), msgId);
            console.log(chalk.cyan('  To:'), to);
            console.log('');
        }
        catch (error) {
            spinner.stop();
            client.handleError(error, { scopes: ['whatsapp_business_messaging'] });
        }
    });
    const templates = whatsapp.command('templates').description('Manage message templates');
    templates
        .command('list')
        .description('List message templates for a WhatsApp Business Account')
        .requiredOption('--business-id <id>', 'WABA ID')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        const token = getTokenOrExit();
        const spinner = ora('Fetching templates...').start();
        const client = new MetaAPIClient(token, 'whatsapp');
        try {
            const result = await client.listWhatsAppTemplates(options.businessId);
            spinner.stop();
            console.log(JSON.stringify(result, null, 2));
        }
        catch (error) {
            spinner.stop();
            client.handleError(error, { scopes: ['whatsapp_business_management'] });
        }
    });
    templates
        .command('create')
        .description('Create a simple BODY-only template')
        .requiredOption('--business-id <id>', 'WABA ID')
        .requiredOption('--name <name>', 'Template name (lowercase, underscore)')
        .requiredOption('--language <code>', 'Language code (e.g. en_US)')
        .requiredOption('--body <text>', 'BODY text')
        .option('--category <cat>', 'Category (e.g. TRANSACTIONAL)', 'TRANSACTIONAL')
        .option('--json', 'Output as JSON')
        .option('--dry-run', 'Print payload without calling the API')
        .option('--verbose', 'Print payload without secrets')
        .action(async (options) => {
        const token = getTokenOrExit();
        const payload = {
            name: options.name,
            language: options.language,
            category: options.category,
            components: [
                {
                    type: 'BODY',
                    text: options.body
                }
            ]
        };
        if (options.verbose || options.dryRun) {
            console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
        }
        if (options.dryRun)
            return;
        const spinner = ora('Creating template...').start();
        const client = new MetaAPIClient(token, 'whatsapp');
        try {
            const result = await client.createWhatsAppTemplate(options.businessId, payload);
            spinner.stop();
            console.log(JSON.stringify(result, null, 2));
        }
        catch (error) {
            spinner.stop();
            client.handleError(error, { scopes: ['whatsapp_business_management'] });
        }
    });
    const phoneNumbers = whatsapp.command('phone-numbers').description('Manage phone numbers');
    phoneNumbers
        .command('list')
        .description('List phone numbers for a WhatsApp Business Account')
        .requiredOption('--business-id <id>', 'WABA ID')
        .option('--set-default', 'Pick and save default phone number id')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        const token = getTokenOrExit();
        const spinner = ora('Fetching phone numbers...').start();
        const client = new MetaAPIClient(token, 'whatsapp');
        try {
            const result = await client.listWhatsAppPhoneNumbers(options.businessId);
            spinner.stop();
            const items = Array.isArray(result?.data) ? result.data : [];
            if (options.setDefault) {
                const picked = await pickPhoneNumberId(items, config.getDefaultWhatsAppPhoneNumberId());
                if (picked) {
                    config.setDefaultWhatsAppPhoneNumberId(picked);
                    console.log(chalk.green(`OK Default WhatsApp phone set to: ${picked}\n`));
                }
                return;
            }
            console.log(JSON.stringify(result, null, 2));
        }
        catch (error) {
            spinner.stop();
            client.handleError(error, { scopes: ['whatsapp_business_management'] });
        }
    });
}
module.exports = registerWhatsAppCommands;
