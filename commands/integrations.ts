const chalk = require('chalk');
const inquirer = require('inquirer');
const ora = require('ora');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');
const { openUrl } = require('../lib/open-url');

const REQUIRED_WABA_SCOPES = [
  'whatsapp_business_messaging',
  'whatsapp_business_management'
];

const WABA_SETUP_URL = 'https://developers.facebook.com/docs/whatsapp/embedded-signup/';

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

async function promptIfMissing(options) {
  const questions = [];
  if (!options.token) {
    questions.push({
      type: 'password',
      name: 'token',
      message: 'WhatsApp access token:'
    });
  }
  if (!options.businessId && !options.wabaId) {
    questions.push({
      type: 'input',
      name: 'businessId',
      message: 'Business ID (optional, press enter to skip):'
    });
  }
  if (!options.wabaId) {
    questions.push({
      type: 'input',
      name: 'wabaId',
      message: 'WABA ID (optional, press enter to auto-detect):'
    });
  }
  if (!options.phoneNumberId) {
    questions.push({
      type: 'input',
      name: 'phoneNumberId',
      message: 'Phone Number ID (optional, press enter to auto-detect):'
    });
  }
  if (!questions.length) return {};
  return inquirer.prompt(questions);
}

async function resolveWabaId(client, businessId) {
  if (!businessId) return '';
  try {
    const rows = await client.get(`/${businessId}/owned_whatsapp_business_accounts`, {
      fields: 'id,name',
      limit: 10
    });
    const first = asArray(rows?.data)[0];
    return String(first?.id || '');
  } catch {
    return '';
  }
}

async function resolvePhoneId(client, wabaId) {
  if (!wabaId) return '';
  try {
    const out = await client.listWhatsAppPhoneNumbers(wabaId);
    const first = asArray(out?.data)[0];
    return String(first?.id || '');
  } catch {
    return '';
  }
}

async function runWabaDoctor({ token, businessId, wabaId, phoneNumberId, callbackUrl, verifyToken, testTo }) {
  const checks = [];
  const client = new MetaAPIClient(token, 'whatsapp');
  let me = null;
  let debug = null;

  try {
    me = await client.getMe('id,name');
    checks.push({ key: 'token_valid', ok: true, detail: me.name || me.id || 'ok' });
  } catch (error) {
    checks.push({ key: 'token_valid', ok: false, detail: String(error?.message || error || '') });
    return { ok: false, checks };
  }

  const { appId, appSecret } = config.getAppCredentials();
  if (appId && appSecret) {
    try {
      const fb = new MetaAPIClient(`${appId}|${appSecret}`, 'facebook');
      debug = await fb.debugToken(token);
      const scopes = asArray(debug?.data?.scopes);
      const missing = REQUIRED_WABA_SCOPES.filter((s) => !scopes.includes(s));
      checks.push({
        key: 'required_scopes',
        ok: missing.length === 0,
        detail: missing.length ? `Missing: ${missing.join(', ')}` : 'ok'
      });
    } catch (error) {
      checks.push({ key: 'required_scopes', ok: false, detail: String(error?.message || error || '') });
    }
  } else {
    checks.push({ key: 'required_scopes', ok: null, detail: 'Skipped (set app id/secret for debug_token).' });
  }

  if (businessId) {
    checks.push({ key: 'business_id', ok: true, detail: businessId });
  } else {
    checks.push({ key: 'business_id', ok: false, detail: 'Missing business id.' });
  }
  if (wabaId) {
    checks.push({ key: 'waba_id', ok: true, detail: wabaId });
  } else {
    checks.push({ key: 'waba_id', ok: false, detail: 'Missing waba id.' });
  }

  if (wabaId) {
    try {
      const nums = await client.listWhatsAppPhoneNumbers(wabaId);
      const count = asArray(nums?.data).length;
      checks.push({
        key: 'phone_access',
        ok: count > 0,
        detail: count > 0 ? `${count} phone number(s) accessible` : 'No phone numbers returned'
      });
    } catch (error) {
      checks.push({ key: 'phone_access', ok: false, detail: String(error?.message || error || '') });
    }
  }

  if (phoneNumberId && testTo) {
    try {
      await client.sendWhatsAppMessage(phoneNumberId, {
        messaging_product: 'whatsapp',
        to: testTo,
        type: 'text',
        text: { body: 'Social CLI test message' }
      });
      checks.push({ key: 'test_send', ok: true, detail: `Sent to ${testTo}` });
    } catch (error) {
      checks.push({ key: 'test_send', ok: false, detail: String(error?.message || error || '') });
    }
  } else {
    checks.push({ key: 'test_send', ok: null, detail: 'Skipped (provide --test-to and phoneNumberId).' });
  }

  checks.push({
    key: 'webhook_config',
    ok: Boolean(callbackUrl && verifyToken),
    detail: callbackUrl && verifyToken ? 'configured' : 'Missing callback URL and/or verify token'
  });

  const hardFails = checks.filter((c) => c.ok === false && ['token_valid', 'required_scopes', 'phone_access'].includes(c.key));
  return {
    ok: hardFails.length === 0,
    me,
    debug,
    checks
  };
}

function printDoctor(result) {
  result.checks.forEach((c) => {
    const state = c.ok === true ? chalk.green('OK') : c.ok === false ? chalk.red('FAIL') : chalk.yellow('SKIP');
    console.log(`- ${c.key}: ${state} ${chalk.gray(c.detail || '')}`);
  });
  console.log('');
}

function registerIntegrationsCommand(program) {
  const integrations = program
    .command('integrations')
    .description('External integrations (1-click style setup for agency workflows)');

  integrations
    .command('connect <target>')
    .description('Connect an integration (currently: waba)')
    .option('--token <token>', 'Access token')
    .option('--business-id <id>', 'Meta business id')
    .option('--waba-id <id>', 'WhatsApp Business Account id')
    .option('--phone-number-id <id>', 'WhatsApp phone number id')
    .option('--webhook-callback-url <url>', 'Webhook callback URL')
    .option('--webhook-verify-token <token>', 'Webhook verify token')
    .option('--test-to <phone>', 'Optional test send destination in E.164')
    .option('--no-open', 'Do not open setup docs page in browser')
    .option('--json', 'Output JSON')
    .action(async (target, options) => {
      if (String(target || '').toLowerCase() !== 'waba') {
        console.error(chalk.red('X Unsupported target. Use: waba'));
        process.exit(1);
      }

      if (options.open !== false) {
        await openUrl(WABA_SETUP_URL);
      }

      const prompted = await promptIfMissing(options);
      const token = String(options.token || prompted.token || config.getToken('whatsapp') || '').trim();
      if (!token) {
        console.error(chalk.red('X Missing token. Run: social auth login -a whatsapp or pass --token.'));
        process.exit(1);
      }

      const client = new MetaAPIClient(token, 'whatsapp');
      const businessId = String(options.businessId || prompted.businessId || '').trim();
      let wabaId = String(options.wabaId || prompted.wabaId || '').trim();
      if (!wabaId) {
        wabaId = await resolveWabaId(client, businessId);
      }

      let phoneNumberId = String(options.phoneNumberId || prompted.phoneNumberId || '').trim();
      if (!phoneNumberId) {
        phoneNumberId = await resolvePhoneId(client, wabaId);
      }

      const spinner = ora('Running WABA checks...').start();
      const report = await runWabaDoctor({
        token,
        businessId,
        wabaId,
        phoneNumberId,
        callbackUrl: options.webhookCallbackUrl,
        verifyToken: options.webhookVerifyToken,
        testTo: options.testTo
      });
      spinner.stop();

      config.setToken('whatsapp', token);
      if (phoneNumberId) {
        config.setDefaultWhatsAppPhoneNumberId(phoneNumberId);
      }
      const saved = config.setWabaIntegration({
        connected: Boolean(report.ok),
        businessId,
        wabaId,
        phoneNumberId,
        webhookCallbackUrl: String(options.webhookCallbackUrl || ''),
        webhookVerifyToken: String(options.webhookVerifyToken || ''),
        connectedAt: new Date().toISOString(),
        provider: 'meta'
      });

      if (options.json) {
        console.log(JSON.stringify({ ok: report.ok, integration: saved, checks: report.checks }, null, 2));
        return;
      }

      console.log(chalk.bold('\nWABA Integration'));
      console.log(chalk.gray(`  profile: ${config.getActiveProfile()}`));
      console.log(chalk.gray(`  business: ${saved.businessId || '(not set)'}`));
      console.log(chalk.gray(`  waba: ${saved.wabaId || '(not set)'}`));
      console.log(chalk.gray(`  phone_number_id: ${saved.phoneNumberId || '(not set)'}`));
      console.log(chalk.gray(`  connected: ${saved.connected ? 'yes' : 'partial'}`));
      console.log('');
      printDoctor(report);
    });

  integrations
    .command('status <target>')
    .description('Show integration status (currently: waba)')
    .option('--json', 'Output JSON')
    .action((target, options) => {
      if (String(target || '').toLowerCase() !== 'waba') {
        console.error(chalk.red('X Unsupported target. Use: waba'));
        process.exit(1);
      }
      const data = config.getWabaIntegration();
      if (options.json) {
        console.log(JSON.stringify({ profile: config.getActiveProfile(), waba: data }, null, 2));
        return;
      }
      console.log(chalk.bold('\nWABA Status'));
      console.log(chalk.gray(`  profile: ${config.getActiveProfile()}`));
      console.log(chalk.gray(`  connected: ${data.connected ? 'yes' : 'no'}`));
      console.log(chalk.gray(`  business: ${data.businessId || '(not set)'}`));
      console.log(chalk.gray(`  waba: ${data.wabaId || '(not set)'}`));
      console.log(chalk.gray(`  phone_number_id: ${data.phoneNumberId || '(not set)'}`));
      console.log(chalk.gray(`  callback_url: ${data.webhookCallbackUrl || '(not set)'}`));
      console.log(chalk.gray(`  connected_at: ${data.connectedAt || '(not set)'}\n`));
    });

  integrations
    .command('disconnect <target>')
    .description('Disconnect integration (currently: waba)')
    .option('--clear-token', 'Also remove stored WhatsApp token', false)
    .option('--json', 'Output JSON')
    .action((target, options) => {
      if (String(target || '').toLowerCase() !== 'waba') {
        console.error(chalk.red('X Unsupported target. Use: waba'));
        process.exit(1);
      }
      const before = config.getWabaIntegration();
      config.clearWabaIntegration();
      if (options.clearToken) {
        config.removeToken('whatsapp');
      }
      if (options.json) {
        console.log(JSON.stringify({ ok: true, before, clearedToken: Boolean(options.clearToken) }, null, 2));
        return;
      }
      console.log(chalk.green('\nOK WABA integration disconnected.\n'));
    });
}

module.exports = registerIntegrationsCommand;
