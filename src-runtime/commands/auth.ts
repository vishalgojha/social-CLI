import chalk = require('chalk');
import ora = require('ora');

const inquirer = require('inquirer');
const config = require('../../lib/config');
const MetaAPIClient = require('../../lib/api-client');
const { openUrl } = require('../../lib/open-url');
const { createBrowserAssistSession } = require('../../lib/browser-assist');
const { oauthLogin, exchangeForLongLivedToken } = require('../../lib/oauth');

type ApiName = 'facebook' | 'instagram' | 'whatsapp';

type ScopeMap = Record<ApiName, string[]>;

type AuthLoginOptions = {
  api: string;
  token?: string;
  oauth?: boolean;
  manual?: boolean;
  scopes?: boolean;
  scope?: string;
  longLived?: boolean;
  open?: boolean;
  browserAgent?: boolean;
};

type AuthAppOptions = {
  id?: string;
  secret?: string;
  open?: boolean;
  browserAgent?: boolean;
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
  browserSession?: {
    via?: string;
    goto?: (url: string) => Promise<boolean>;
  } | null;
};

type LoginFlowResolution = {
  mode: 'manual' | 'oauth';
  shouldPromptForAppSetup: boolean;
  reason: string;
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

function whatsappTokenHelpUrl(appId?: string): string {
  if (!appId) return '';
  return `https://developers.facebook.com/apps/${encodeURIComponent(appId)}/whatsapp-business/wa-dev-console/`;
}

function supportsAutomaticOauth(api: ApiName) {
  return api === 'facebook' || api === 'instagram';
}

function resolveLoginFlow(options: {
  api: ApiName;
  token?: string;
  oauth?: boolean;
  manual?: boolean;
  hasAppCredentials?: boolean;
}): LoginFlowResolution {
  if (String(options.token || '').trim()) {
    return {
      mode: 'manual',
      shouldPromptForAppSetup: false,
      reason: 'token_provided'
    };
  }

  if (!supportsAutomaticOauth(options.api)) {
    return {
      mode: 'manual',
      shouldPromptForAppSetup: false,
      reason: 'manual_only_api'
    };
  }

  if (options.manual) {
    return {
      mode: 'manual',
      shouldPromptForAppSetup: false,
      reason: 'manual_requested'
    };
  }

  if (options.oauth && options.hasAppCredentials) {
    return {
      mode: 'oauth',
      shouldPromptForAppSetup: false,
      reason: 'explicit_oauth'
    };
  }

  if (options.oauth && !options.hasAppCredentials) {
    return {
      mode: 'manual',
      shouldPromptForAppSetup: true,
      reason: 'oauth_requested_missing_app_credentials'
    };
  }

  if (options.hasAppCredentials) {
    return {
      mode: 'oauth',
      shouldPromptForAppSetup: false,
      reason: 'auto_oauth_available'
    };
  }

  return {
    mode: 'manual',
    shouldPromptForAppSetup: true,
    reason: 'missing_app_credentials'
  };
}

async function openBrowserPage(url: string, options: {
  canOpen?: boolean;
  browserSession?: {
    goto?: (target: string) => Promise<boolean>;
  } | null;
} = {}) {
  if (options.canOpen === false || !url) return false;
  if (options.browserSession && typeof options.browserSession.goto === 'function') {
    return options.browserSession.goto(url);
  }
  return openUrl(url);
}

async function confirmBrowserReady({ api, url, canOpen, browserSession }: BrowserReadyPrompt) {
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
      await openBrowserPage(url, {
        canOpen,
        browserSession
      });
    }
  }
}

async function waitForAppSecretReveal(appId: string, canOpen: boolean, browserSession?: BrowserReadyPrompt['browserSession']) {
  const appSettingsUrl = `https://developers.facebook.com/apps/${encodeURIComponent(appId)}/settings/basic/`;
  if (canOpen) {
    console.log(chalk.gray('\nOpening your app Basic settings page...'));
    const opened = await openBrowserPage(appSettingsUrl, {
      canOpen,
      browserSession
    });
    if (!opened) {
      console.log(chalk.yellow('Could not auto-open browser. Open this URL manually:'));
    }
  } else {
    console.log(chalk.gray('\nApp Basic settings URL:'));
  }

  console.log(chalk.cyan(`  ${appSettingsUrl}`));
  console.log(chalk.gray('  Find: App Secret -> click "Show" -> complete password/2FA -> copy secret.\n'));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ready = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'ok',
        message: 'Were you able to reveal App Secret and are ready to paste it?',
        default: true
      }
    ]);

    if (ready.ok) return;

    console.log(chalk.yellow('\nNo problem. Quick path:'));
    console.log(chalk.gray('  1) Open App Dashboard'));
    console.log(chalk.gray('  2) Go to Settings -> Basic'));
    console.log(chalk.gray('  3) Click Show beside App Secret'));
    console.log(chalk.gray('  4) Complete password/2FA and copy\n'));

    const reopen = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'again',
        message: 'Re-open the App Basic settings page now?',
        default: true
      }
    ]);

    if (reopen.again && canOpen) {
      // eslint-disable-next-line no-await-in-loop
      await openBrowserPage(appSettingsUrl, {
        canOpen,
        browserSession
      });
    }
  }
}

async function collectAppCredentials(options: {
  id?: string;
  secret?: string;
  open?: boolean;
  browserSession?: BrowserReadyPrompt['browserSession'];
}) {
  let { id, secret } = options;
  const canOpen = options.open !== false;
  const appsUrl = 'https://developers.facebook.com/apps/';

  if (!id || !secret) {
    if (canOpen) {
      console.log(chalk.gray('\nOpening Meta App Dashboard...'));
      const opened = await openBrowserPage(appsUrl, {
        canOpen,
        browserSession: options.browserSession
      });
      if (!opened) {
        console.log(chalk.yellow('Could not auto-open browser. Open this URL manually:'));
      }
      if (options.browserSession && options.browserSession.via === 'browser-agent') {
        console.log(chalk.gray('  Browser agent is ready. Login there if needed, then continue here.'));
      }
    } else {
      console.log(chalk.gray('\nMeta App Dashboard URL:'));
    }

    console.log(chalk.cyan(`  ${appsUrl}`));
    console.log(chalk.gray('  Steps: Login if needed -> select your app -> Settings -> Basic -> copy App ID.\n'));

    if (!id) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'appId',
          message: 'Enter your App ID:',
          validate: (input: string) => input.length > 0 || 'App ID cannot be empty'
        }
      ]);
      id = answers.appId;
    }

    if (!secret) {
      await waitForAppSecretReveal(String(id || '').trim(), canOpen, options.browserSession);
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'appSecret',
          message: 'Enter your App Secret:',
          validate: (input: string) => input.length > 0 || 'App Secret cannot be empty'
        }
      ]);
      secret = answers.appSecret;
    }
  }

  return {
    appId: String(id || '').trim(),
    appSecret: String(secret || '').trim()
  };
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
    .description('Login and store an access token (auto OAuth when app credentials exist, otherwise guided/manual)')
    .option('-a, --api <api>', 'API to authenticate (facebook, instagram, whatsapp)', 'facebook')
    .option('-t, --token <token>', 'Access token (prompts if not provided)')
    .option('--oauth', 'Force OAuth browser flow (requires app id/secret and valid redirect URI)')
    .option('--manual', 'Always use manual token entry even if OAuth app credentials exist')
    .option('--scopes', 'Prompt for scopes (used for OAuth or guidance)')
    .option('--scope <scopes>', 'Comma-separated scopes (overrides --scopes)')
    .option('--long-lived', 'Exchange for long-lived token (OAuth only; requires app secret)')
    .option('--no-open', 'Do not open the token page in your browser')
    .option('--no-browser-agent', 'Disable the Playwright browser assistant and use the system browser instead')
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
      const canOpen = options.open !== false;
      let browserSession: Awaited<ReturnType<typeof createBrowserAssistSession>> | null = null;
      let browserAgentAnnounced = false;

      const ensureBrowserSession = async () => {
        if (!canOpen) return null;
        if (browserSession) return browserSession;
        browserSession = await createBrowserAssistSession({
          browserAgent: options.browserAgent !== false
        });
        if (browserSession && browserSession.via === 'browser-agent' && !browserAgentAnnounced) {
          console.log(chalk.gray('\nBrowser agent launched a dedicated auth window.\n'));
          browserAgentAnnounced = true;
        }
        return browserSession;
      };

      try {
        let { appId, appSecret } = config.getAppCredentials();
        let flow = resolveLoginFlow({
          api,
          token,
          oauth: options.oauth,
          manual: options.manual,
          hasAppCredentials: Boolean(appId && appSecret)
        });

        if (flow.shouldPromptForAppSetup && !token) {
          const answers = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'configureApp',
              default: true,
              message: 'Automatic token capture needs Meta app credentials. Configure them now and continue?'
            }
          ]);

          if (answers.configureApp) {
            const session = await ensureBrowserSession();
            const collected = await collectAppCredentials({
              open: options.open,
              browserSession: session
            });
            appId = collected.appId;
            appSecret = collected.appSecret;
            config.setAppCredentials(appId, appSecret);
            console.log(chalk.green('OK App credentials saved'));
            console.log('');
            flow = resolveLoginFlow({
              api,
              token,
              oauth: true,
              manual: options.manual,
              hasAppCredentials: Boolean(appId && appSecret)
            });
          } else if (options.oauth) {
            console.error(chalk.red('X OAuth requested, but app credentials were not configured.'));
            process.exit(1);
          }
        }

        if (flow.mode === 'oauth' && !token) {
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
              scopes,
              browserSession: await ensureBrowserSession()
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
            const appUrl = whatsappTokenHelpUrl(appId);
            const fallbackUrl = 'https://developers.facebook.com/apps/';

            console.log(chalk.gray('\nWhatsApp token setup:'));
            if (canOpen) {
              console.log(chalk.gray('Opening Meta App Dashboard...'));
              console.log(chalk.cyan(`  ${appUrl || fallbackUrl}\n`));
              await openBrowserPage(appUrl || fallbackUrl, {
                canOpen,
                browserSession: await ensureBrowserSession()
              });
            } else {
              console.log(chalk.gray('Meta App Dashboard URL:'));
              console.log(chalk.cyan(`  ${appUrl || fallbackUrl}`));
            }
            console.log(chalk.gray('  Steps: Meta App Dashboard -> WhatsApp -> API Setup -> Generate access token.'));
            if (!appUrl) {
              console.log(chalk.gray('  Tip: Configure App ID to jump directly next time (social auth app).\n'));
            } else {
              console.log('');
            }
          } else if (api === 'instagram') {
            if (url) {
              if (canOpen) {
                console.log(chalk.gray('\nOpening Instagram token page...'));
                console.log(chalk.cyan(`  ${url}\n`));
                await openBrowserPage(url, {
                  canOpen,
                  browserSession: await ensureBrowserSession()
                });
              } else {
                console.log(chalk.gray('\nInstagram token page:'));
                console.log(chalk.cyan(`  ${url}\n`));
              }
              console.log(chalk.gray('  Steps: Graph API Explorer -> select your app -> add Instagram scopes -> Generate access token.'));
              await confirmBrowserReady({
                api,
                url,
                canOpen,
                browserSession: await ensureBrowserSession()
              });
            }
          } else if (url) {
            if (canOpen) {
              console.log(chalk.gray(`\nOpening ${api} token page...`));
              console.log(chalk.cyan(`  ${url}\n`));
              await openBrowserPage(url, {
                canOpen,
                browserSession: await ensureBrowserSession()
              });
            } else {
              console.log(chalk.gray(`\nToken page (${api}):`));
              console.log(chalk.cyan(`  ${url}\n`));
            }

            await confirmBrowserReady({
              api,
              url,
              canOpen,
              browserSession: await ensureBrowserSession()
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
      } finally {
        if (browserSession && typeof browserSession.close === 'function') {
          await browserSession.close();
        }
      }
    });

  auth
    .command('app')
    .description('Configure app credentials (App ID and Secret)')
    .option('--id <appId>', 'App ID')
    .option('--secret <appSecret>', 'App Secret')
    .option('--no-open', 'Do not open Meta App Dashboard in browser')
    .option('--no-browser-agent', 'Disable the Playwright browser assistant and use the system browser instead')
    .action(async (options: AuthAppOptions) => {
      let browserSession: Awaited<ReturnType<typeof createBrowserAssistSession>> | null = null;
      try {
        if (options.open !== false) {
          browserSession = await createBrowserAssistSession({
            browserAgent: options.browserAgent !== false
          });
          if (browserSession && browserSession.via === 'browser-agent') {
            console.log(chalk.gray('\nBrowser agent launched a dedicated auth window.\n'));
          }
        }

        const collected = await collectAppCredentials({
          id: options.id,
          secret: options.secret,
          open: options.open,
          browserSession
        });

        config.setAppCredentials(collected.appId, collected.appSecret);
        console.log(chalk.green('OK App credentials saved'));
        console.log('');
      } finally {
        if (browserSession && typeof browserSession.close === 'function') {
          await browserSession.close();
        }
      }
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

(registerAuthCommands as any)._private = {
  resolveLoginFlow,
  supportsAutomaticOauth
};

export = registerAuthCommands;
