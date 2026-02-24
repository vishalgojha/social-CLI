import chalk = require('chalk');
import ora = require('ora');

const inquirer = require('inquirer');
const config = require('../../lib/config');
const MetaAPIClient = require('../../lib/api-client');
const { openUrl } = require('../../lib/open-url');
const { oauthLogin, exchangeForLongLivedToken } = require('../../lib/oauth');

type ApiName = 'facebook' | 'instagram' | 'whatsapp';

type ScopeMap = Record<ApiName, string[]>;

type AuthLoginOptions = {
  api: string;
  token?: string;
  oauth?: boolean;
  scopes?: boolean;
  scope?: string;
  longLived?: boolean;
  open?: boolean;
};

type AuthAppOptions = {
  id?: string;
  secret?: string;
};

type AuthLogoutOptions = {
  api: string;
};

type AuthDebugOptions = {
  token?: string;
};

type BrowserReadyPrompt = {
  api: ApiName;
  url: string;
  canOpen: boolean;
};

const SCOPES: ScopeMap = {
  facebook: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'ads_read',
    'ads_management'
  ],
  instagram: [
    'instagram_basic',
    'instagram_manage_comments',
    'instagram_manage_insights',
    'pages_show_list',
    'pages_read_engagement'
  ],
  whatsapp: [
    'whatsapp_business_messaging',
    'whatsapp_business_management'
  ]
};

function isValidApi(api: string): api is ApiName {
  return ['facebook', 'instagram', 'whatsapp'].includes(api);
}

async function promptScopes(api: ApiName): Promise<string[]> {
  const choices = (SCOPES[api] || []).map((scope) => ({ name: scope, value: scope, checked: true }));
  if (!choices.length) return [];
  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'scopes',
      message: `Select ${api} scopes:`,
      choices
    }
  ]);
  return answers.scopes || [];
}

function tokenHelpUrl(api: ApiName, apiVersion: string): string {
  if (api === 'whatsapp') return '';
  return `https://developers.facebook.com/tools/explorer/?version=${encodeURIComponent(apiVersion)}`;
}

async function confirmBrowserReady({ api, url, canOpen }: BrowserReadyPrompt) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'ready',
        message: `Did you finish browser ${api} login/registration and open Graph Explorer token screen?`,
        default: true
      }
    ]);

    if (answers.ready) return;

    console.log(chalk.yellow('\nComplete this in browser first:'));
    console.log(chalk.gray('  1) Login with your Facebook account'));
    console.log(chalk.gray('  2) If prompted, register as Developer'));
    console.log(chalk.gray('  3) Generate/copy access token'));
    if (url) console.log(chalk.cyan(`  URL: ${url}`));
    console.log('');

    const again = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reopen',
        message: 'Re-open token page in browser now?',
        default: true
      }
    ]);

    if (again.reopen && canOpen && url) {
      // eslint-disable-next-line no-await-in-loop
      await openUrl(url);
    }
  }
}

function registerAuthCommands(program: any) {
  const auth = program.command('auth').description('Authentication and token management');

  auth
    .command('scopes')
    .description('List recommended scopes')
    .option('-a, --api <api>', 'API (facebook, instagram, whatsapp)')
    .action((options: { api?: string }) => {
      const apis = options.api ? [options.api] : ['facebook', 'instagram', 'whatsapp'];
      apis.forEach((apiName) => {
        if (!isValidApi(apiName)) return;
        console.log(chalk.bold(`\n${apiName} scopes:`));
        (SCOPES[apiName] || []).forEach((scope) => console.log(`  - ${scope}`));
      });
      console.log('');
    });

  auth
    .command('login')
    .description('Login and store an access token (manual or OAuth)')
    .option('-a, --api <api>', 'API to authenticate (facebook, instagram, whatsapp)', 'facebook')
    .option('-t, --token <token>', 'Access token (prompts if not provided)')
    .option('--oauth', 'Use OAuth browser flow (requires app id/secret and valid redirect URI)')
    .option('--scopes', 'Prompt for scopes (used for OAuth or guidance)')
    .option('--scope <scopes>', 'Comma-separated scopes (overrides --scopes)')
    .option('--long-lived', 'Exchange for long-lived token (OAuth only; requires app secret)')
    .option('--no-open', 'Do not open the token page in your browser')
    .action(async (options: AuthLoginOptions) => {
      const api = options.api;
      if (!isValidApi(api)) {
        console.error(chalk.red('X Invalid API. Choose: facebook, instagram, whatsapp'));
        process.exit(1);
      }

      const apiVersion = config.getApiVersion();

      let scopes: string[] = [];
      if (options.scope) {
        scopes = String(options.scope)
          .split(',')
          .map((scope) => scope.trim())
          .filter(Boolean);
      } else if (options.scopes) {
        scopes = await promptScopes(api);
      }

      let token = options.token || '';

      if (options.oauth) {
        const { appId, appSecret } = config.getAppCredentials();
        if (!appId || !appSecret) {
          console.error(chalk.red('X Missing app credentials. Run: social auth app'));
          process.exit(1);
        }

        console.log(chalk.gray('\nStarting OAuth flow...'));
        console.log(chalk.gray('  Note: Your Meta app must allow the redirect URI shown in your browser.\n'));

        try {
          const tokenData = await oauthLogin({
            apiVersion,
            appId,
            appSecret,
            scopes
          });

          token = tokenData.access_token;

          if (options.longLived) {
            const exchanged = await exchangeForLongLivedToken({
              apiVersion,
              appId,
              appSecret,
              shortLivedToken: token
            });
            token = exchanged.access_token;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`X OAuth failed: ${message}`));
          process.exit(1);
        }
      }

      if (!token) {
        const url = tokenHelpUrl(api, apiVersion);
        if (api === 'whatsapp') {
          console.log(chalk.gray('\nWhatsApp token hint:'));
          console.log(chalk.cyan('  Meta App Dashboard -> WhatsApp -> API Setup -> Generate access token'));
          console.log(chalk.gray('  Then paste the token below.\n'));
        } else if (url) {
          if (options.open !== false) {
            console.log(chalk.gray(`\nOpening ${api} token page...`));
            console.log(chalk.cyan(`  ${url}\n`));
            await openUrl(url);
          } else {
            console.log(chalk.gray(`\nToken page (${api}):`));
            console.log(chalk.cyan(`  ${url}\n`));
          }

          await confirmBrowserReady({
            api,
            url,
            canOpen: options.open !== false
          });
        }

        const answers = await inquirer.prompt([
          {
            type: 'password',
            name: 'token',
            message: `Enter your ${api} access token:`,
            validate: (input: string) => input.length > 0 || 'Token cannot be empty'
          }
        ]);
        token = answers.token;
      }

      const spinner = ora('Validating token...').start();
      try {
        const client = new MetaAPIClient(token, api);
        const me = await client.getMe('id,name');
        spinner.stop();

        config.setToken(api, token);
        config.setDefaultApi(api);

        console.log(chalk.green('OK Authenticated'));
        console.log(chalk.gray(`  User: ${me.name || me.id}`));
        console.log(chalk.gray(`  API: ${api}`));
        console.log(chalk.gray(`  Version: ${apiVersion}`));
        if (scopes.length) console.log(chalk.gray(`  Scopes requested: ${scopes.join(', ')}`));
        console.log('');
      } catch (error) {
        spinner.stop();
        const client = new MetaAPIClient(token, api);
        client.handleError(error);
      }
    });

  auth
    .command('app')
    .description('Configure app credentials (App ID and Secret)')
    .option('--id <appId>', 'App ID')
    .option('--secret <appSecret>', 'App Secret')
    .action(async (options: AuthAppOptions) => {
      let { id, secret } = options;

      if (!id || !secret) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'appId',
            message: 'Enter your App ID:',
            when: !id,
            validate: (input: string) => input.length > 0 || 'App ID cannot be empty'
          },
          {
            type: 'password',
            name: 'appSecret',
            message: 'Enter your App Secret:',
            when: !secret,
            validate: (input: string) => input.length > 0 || 'App Secret cannot be empty'
          }
        ]);

        id = id || answers.appId;
        secret = secret || answers.appSecret;
      }

      config.setAppCredentials(id, secret);
      console.log(chalk.green('OK App credentials saved'));
      console.log('');
    });

  auth
    .command('logout')
    .description('Remove stored tokens')
    .option('-a, --api <api>', 'API to logout from (or "all")', 'all')
    .action((options: AuthLogoutOptions) => {
      const { api } = options;
      if (api === 'all') {
        config.clearAllTokens();
        console.log(chalk.green('OK All tokens removed'));
        console.log('');
        return;
      }

      if (!isValidApi(api)) {
        console.error(chalk.red('X Invalid API. Choose: facebook, instagram, whatsapp, or all'));
        process.exit(1);
      }
      config.removeToken(api);
      console.log(chalk.green(`OK ${api} token removed`));
      console.log('');
    });

  auth
    .command('debug')
    .description('Debug a token (requires app secret for best results)')
    .option('-t, --token <token>', 'Token to debug (defaults to stored facebook token)')
    .action(async (options: AuthDebugOptions) => {
      const { appId, appSecret } = config.getAppCredentials();
      const appAccessToken = appId && appSecret ? `${appId}|${appSecret}` : '';
      const inputToken = options.token || config.getToken('facebook');

      if (!inputToken) {
        console.error(chalk.red('X No token provided and no stored facebook token found.'));
        process.exit(1);
      }

      if (!appAccessToken) {
        console.log(chalk.yellow('Warning: No app credentials configured. /debug_token may fail.'));
        console.log(chalk.gray('  Configure with: social auth app\n'));
      }

      const client = new MetaAPIClient(appAccessToken || inputToken, 'facebook');
      try {
        const debugInfo = await client.debugToken(inputToken);
        console.log(JSON.stringify(debugInfo, null, 2));
      } catch (error) {
        client.handleError(error);
      }
    });

  auth
    .command('status')
    .description('Show authentication/config status')
    .action(() => {
      config.display();
    });
}

export = registerAuthCommands;
