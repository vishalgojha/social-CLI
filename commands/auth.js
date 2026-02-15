const chalk = require('chalk');
const inquirer = require('inquirer');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');
const { openUrl } = require('../lib/open-url');

function registerAuthCommands(program) {
  const auth = program.command('auth').description('Manage authentication tokens');

  const tokenHelpUrls = {
    facebook: 'https://developers.facebook.com/tools/explorer/',
    instagram: 'https://developers.facebook.com/tools/explorer/',
    whatsapp: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started'
  };

  // Login - set token
  auth
    .command('login')
    .description('Add an access token')
    .option('-a, --api <api>', 'API to authenticate (facebook, instagram, whatsapp)', 'facebook')
    .option('-t, --token <token>', 'Access token (will prompt if not provided)')
    .option('--no-open', 'Do not open the token page in your browser')
    .action(async (options) => {
      let { api, token } = options;

      // Validate API
      if (!['facebook', 'instagram', 'whatsapp'].includes(api)) {
        console.error(chalk.red('✖ Invalid API. Choose: facebook, instagram, or whatsapp'));
        process.exit(1);
      }

      // Prompt for token if not provided
      if (!token) {
        const url = tokenHelpUrls[api];
        if (url) {
          if (options.open !== false) {
            console.log(chalk.gray(`\nOpening ${api} token page...`));
            console.log(chalk.cyan(`  ${url}\n`));
            await openUrl(url);
          } else {
            console.log(chalk.gray(`\nToken page (${api}):`));
            console.log(chalk.cyan(`  ${url}\n`));
          }
        }

        const answers = await inquirer.prompt([
          {
            type: 'password',
            name: 'token',
            message: `Enter your ${api} access token:`,
            validate: (input) => input.length > 0 || 'Token cannot be empty'
          }
        ]);
        token = answers.token;
      }

      // Validate token by making a test request
      console.log(chalk.gray('\nValidating token...'));
      try {
        const client = new MetaAPIClient(token, api);
        const me = await client.getMe();
        
        config.setToken(api, token);
        config.setDefaultApi(api);
        
        console.log(chalk.green('✓ Successfully authenticated!'));
        console.log(chalk.gray(`  User: ${me.name || me.id}`));
        console.log(chalk.gray(`  API: ${api}`));
        console.log('');
      } catch (error) {
        console.error(chalk.red('✖ Token validation failed'));
        process.exit(1);
      }
    });

  // Set app credentials
  auth
    .command('app')
    .description('Configure app credentials (App ID and Secret)')
    .option('--id <appId>', 'App ID')
    .option('--secret <appSecret>', 'App Secret')
    .action(async (options) => {
      let { id, secret } = options;

      if (!id || !secret) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'appId',
            message: 'Enter your App ID:',
            when: !id,
            validate: (input) => input.length > 0 || 'App ID cannot be empty'
          },
          {
            type: 'password',
            name: 'appSecret',
            message: 'Enter your App Secret:',
            when: !secret,
            validate: (input) => input.length > 0 || 'App Secret cannot be empty'
          }
        ]);
        
        id = id || answers.appId;
        secret = secret || answers.appSecret;
      }

      config.setAppCredentials(id, secret);
      console.log(chalk.green('✓ App credentials saved!'));
      console.log('');
    });

  // Logout - remove token
  auth
    .command('logout')
    .description('Remove stored tokens')
    .option('-a, --api <api>', 'API to logout from (or "all")', 'all')
    .action((options) => {
      const { api } = options;

      if (api === 'all') {
        config.clearAllTokens();
        console.log(chalk.green('✓ All tokens removed'));
      } else if (['facebook', 'instagram', 'whatsapp'].includes(api)) {
        config.removeToken(api);
        console.log(chalk.green(`✓ ${api} token removed`));
      } else {
        console.error(chalk.red('✖ Invalid API. Choose: facebook, instagram, whatsapp, or all'));
        process.exit(1);
      }
      console.log('');
    });

  // Status - show current auth status
  auth
    .command('status')
    .description('Show authentication status')
    .action(() => {
      config.display();
    });

  // Debug token
  auth
    .command('debug')
    .description('Debug an access token')
    .option('-a, --api <api>', 'API to use', config.getDefaultApi())
    .option('-t, --token <token>', 'Token to debug (defaults to stored token)')
    .action(async (options) => {
      const { api, token: tokenToDebug } = options;
      
      const token = config.getToken(api);
      if (!token) {
        console.error(chalk.red(`✖ No ${api} token found. Run: meta auth login -a ${api}`));
        process.exit(1);
      }

      const client = new MetaAPIClient(token, api);
      const debugInfo = await client.debugToken(tokenToDebug || token);

      console.log(chalk.bold('\nToken Debug Info:'));
      console.log(chalk.gray('─'.repeat(50)));
      
      const data = debugInfo.data;
      console.log(chalk.cyan('App ID:'), data.app_id);
      console.log(chalk.cyan('User ID:'), data.user_id);
      console.log(chalk.cyan('Valid:'), data.is_valid ? chalk.green('Yes') : chalk.red('No'));
      console.log(chalk.cyan('Type:'), data.type);
      
      if (data.expires_at) {
        const expiresAt = new Date(data.expires_at * 1000);
        console.log(chalk.cyan('Expires:'), expiresAt.toLocaleString());
      } else {
        console.log(chalk.cyan('Expires:'), chalk.green('Never'));
      }
      
      if (data.scopes) {
        console.log(chalk.cyan('Scopes:'), data.scopes.join(', '));
      }
      
      console.log('');
    });
}

module.exports = registerAuthCommands;
