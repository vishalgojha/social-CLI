const chalk = require('chalk');
const ora = require('ora');
const axios = require('axios');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');

function parseHeaderJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function checkRateLimits(options) {
  const { api, json } = options;
  const token = config.getToken(api);

  if (!token) {
    console.error(chalk.red(`X No ${api} token found. Run: meta auth login -a ${api}`));
    process.exit(1);
  }

  const spinner = ora('Checking rate limits...').start();
  const client = new MetaAPIClient(token, api);

  try {
    // Make a simple request to get headers.
    const response = await axios.get(`${client.baseUrl}/me`, {
      params: { access_token: token, fields: 'id' },
      validateStatus: () => true
    });

    spinner.stop();

    const headers = response.headers || {};
    const usage = parseHeaderJson(headers['x-app-usage']);
    const businessUsage = parseHeaderJson(headers['x-business-use-case-usage']);

    const payload = { usage, businessUsage };
    if (json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(chalk.bold('\nRate Limit Status:'));
    console.log(chalk.gray('-'.repeat(50)));

    if (usage) {
      console.log(chalk.bold('\nApp Usage:'));
      const keys = ['call_count', 'total_time', 'total_cputime'];
      keys.forEach((k) => {
        if (usage[k] === undefined) return;
        const pct = Number(usage[k]);
        const color = pct > 75 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
        const label = k === 'call_count' ? 'Call Count' : k === 'total_time' ? 'Total Time' : 'Total CPU Time';
        console.log(chalk.cyan(`  ${label}:`), color(`${pct}%`));
      });
    } else {
      console.log(chalk.yellow('\nNo rate limit information available in response.'));
      console.log(chalk.gray('(Rate limits are typically returned after making API calls)'));
    }

    if (businessUsage && typeof businessUsage === 'object') {
      console.log(chalk.bold('\nBusiness Usage:'));
      Object.entries(businessUsage).forEach(([key, value]) => {
        console.log(chalk.cyan(`  ${key}:`));
        if (!value || typeof value !== 'object') return;
        const keys = ['call_count', 'total_time', 'total_cputime'];
        keys.forEach((k) => {
          if (value[k] === undefined) return;
          const pct = Number(value[k]);
          const color = pct > 75 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
          const label = k === 'call_count' ? 'Call Count' : k === 'total_time' ? 'Total Time' : 'Total CPU Time';
          console.log(chalk.cyan(`    ${label}:`), color(`${pct}%`));
        });
      });
    }

    console.log(chalk.bold('\nRate Limit Info:'));
    console.log(chalk.gray('  Meta uses sliding window rate limits.'));
    console.log(chalk.gray('  Limits reset gradually over time.'));
    console.log(chalk.gray('  User/app limits vary by app tier and endpoints.'));
    console.log('');

    const nearLimit = usage && (
      Number(usage.call_count) > 75 ||
      Number(usage.total_time) > 75 ||
      Number(usage.total_cputime) > 75
    );
    if (nearLimit) {
      console.log(chalk.red('! Warning: You are approaching rate limits.'));
      console.log(chalk.yellow('  Consider slowing down requests or batching where possible.'));
      console.log('');
    }
  } catch (error) {
    spinner.stop();
    console.error(chalk.red('X Failed to check rate limits'));
    throw error;
  }
}

function showRateLimitDocs() {
  console.log(chalk.bold('\nMeta API Rate Limits:'));
  console.log(chalk.gray('-'.repeat(50)));
  console.log('\n' + chalk.cyan('User-level limits:'));
  console.log('  - Sliding window; resets gradually over time');
  console.log('\n' + chalk.cyan('Headers returned (when available):'));
  console.log('  - x-app-usage: App-level usage percentage');
  console.log('  - x-business-use-case-usage: Business usage');
  console.log('\n' + chalk.cyan('Tips:'));
  console.log('  - Implement exponential backoff for retries');
  console.log('  - Cache responses when possible');
  console.log('  - Use batch requests for multiple operations');
  console.log('  - Monitor usage with: meta limits check');
  console.log('\n' + chalk.gray('Documentation:'));
  console.log('  https://developers.facebook.com/docs/graph-api/overview/rate-limiting');
  console.log('');
}

function registerLimitsGroup(cmd) {
  cmd
    .command('check')
    .description('Check current rate limit status')
    .option('-a, --api <api>', 'API to use', config.getDefaultApi())
    .option('--json', 'Output as JSON')
    .action(checkRateLimits);

  cmd
    .command('checks')
    .description('Alias for "check"')
    .option('-a, --api <api>', 'API to use', config.getDefaultApi())
    .option('--json', 'Output as JSON')
    .action(checkRateLimits);

  cmd
    .command('docs')
    .description('Show rate limit documentation')
    .action(showRateLimitDocs);
}

function registerLimitsCommands(program) {
  const limits = program.command('limits').description('Check rate limits and usage');
  registerLimitsGroup(limits);

  const limit = program.command('limit').description('Alias for "limits"');
  registerLimitsGroup(limit);
}

module.exports = registerLimitsCommands;

