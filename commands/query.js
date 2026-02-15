const chalk = require('chalk');
const ora = require('ora');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');
const { formatTable } = require('../lib/formatters');

function getTokenOrExit(api) {
  const token = config.getToken(api);
  if (!token) {
    console.error(chalk.red(`X No ${api} token found. Run: social auth login -a ${api}`));
    process.exit(1);
  }
  return token;
}

function registerQueryCommands(program) {
  const query = program.command('query').description('Read-only queries across Meta APIs');

  query
    .command('me')
    .description('Get your profile information')
    .option('-a, --api <api>', 'API to use', config.getDefaultApi())
    .option('-f, --fields <fields>', 'Fields to retrieve (comma-separated)', 'id,name')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Log request details (no secrets)')
    .action(async (options) => {
      const token = getTokenOrExit(options.api);
      const spinner = ora('Fetching profile...').start();
      const client = new MetaAPIClient(token, options.api);
      try {
        const data = await client.getMe(options.fields, { verbose: options.verbose });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        console.log(chalk.bold('\nProfile:'));
        console.log(chalk.gray('─'.repeat(50)));
        Object.entries(data || {}).forEach(([k, v]) => console.log(chalk.cyan(`${k}:`), v));
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e);
      }
    });

  query
    .command('pages')
    .description('List your Facebook Pages (/me/accounts)')
    .option('-l, --limit <n>', 'Limit', '25')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .action(async (options) => {
      const token = getTokenOrExit('facebook');
      const spinner = ora('Fetching pages...').start();
      const client = new MetaAPIClient(token, 'facebook');
      try {
        const result = await client.getFacebookPages(parseInt(options.limit, 10));
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const rows = (result.data || []).map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category || '',
          fan_count: p.fan_count || ''
        }));
        if (options.table) {
          console.log(formatTable(rows, ['name', 'id', 'category', 'fan_count']));
          console.log('');
          return;
        }
        console.log(chalk.bold('\nYour Facebook Pages:'));
        console.log(chalk.gray('─'.repeat(50)));
        rows.forEach((p, i) => {
          console.log(chalk.bold(`${i + 1}. ${p.name}`));
          console.log(chalk.cyan('   ID:'), p.id);
          if (p.category) console.log(chalk.cyan('   Category:'), p.category);
          if (p.fan_count !== '') console.log(chalk.cyan('   Fans:'), p.fan_count);
        });
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['pages_show_list'] });
      }
    });

  query
    .command('instagram-media')
    .description('List Instagram media for an IG user')
    .option('--ig-user-id <id>', 'IG User ID (defaults to configured)')
    .option('-l, --limit <n>', 'Limit', '10')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .action(async (options) => {
      // Many setups reuse the same token; fall back to facebook if instagram token missing.
      const token = config.getToken('instagram') || getTokenOrExit('facebook');
      const igUserId = options.igUserId || config.getDefaultIgUserId();
      if (!igUserId) {
        console.error(chalk.red('X Missing IG user id. Provide --ig-user-id or set a default via social utils config set-default-ig-user'));
        process.exit(1);
      }

      const spinner = ora('Fetching Instagram media...').start();
      const client = new MetaAPIClient(token, 'instagram');
      try {
        const result = await client.getInstagramMedia(igUserId, parseInt(options.limit, 10));
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const rows = (result.data || []).map((m) => ({
          id: m.id,
          media_type: m.media_type,
          permalink: m.permalink,
          timestamp: m.timestamp
        }));
        if (options.table) {
          console.log(formatTable(rows, ['media_type', 'id', 'timestamp', 'permalink']));
          console.log('');
          return;
        }
        console.log(chalk.bold('\nInstagram Media:'));
        console.log(chalk.gray('─'.repeat(50)));
        rows.forEach((m, i) => {
          console.log(chalk.bold(`${i + 1}. ${m.media_type}`));
          console.log(chalk.cyan('   ID:'), m.id);
          console.log(chalk.cyan('   URL:'), m.permalink);
          console.log(chalk.cyan('   Posted:'), new Date(m.timestamp).toLocaleString());
        });
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['instagram_basic'] });
      }
    });

  query
    .command('feed')
    .description('List recent posts for a Page (/PAGE_ID/feed)')
    .requiredOption('--page-id <id>', 'Facebook Page ID')
    .option('-l, --limit <n>', 'Limit', '10')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .action(async (options) => {
      const token = getTokenOrExit('facebook');
      const spinner = ora('Fetching page feed...').start();
      const client = new MetaAPIClient(token, 'facebook');
      try {
        const result = await client.get(`/${options.pageId}/feed`, {
          fields: 'id,message,created_time,permalink_url',
          limit: parseInt(options.limit, 10)
        });
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const rows = (result.data || []).map((p) => ({
          id: p.id,
          created_time: p.created_time,
          message: (p.message || '').slice(0, 80),
          permalink_url: p.permalink_url || ''
        }));
        if (options.table) {
          console.log(formatTable(rows, ['created_time', 'id', 'message']));
          console.log('');
          return;
        }
        console.log(chalk.bold('\nPage Feed:'));
        console.log(chalk.gray('─'.repeat(50)));
        rows.forEach((p, i) => {
          console.log(chalk.bold(`${i + 1}. ${p.created_time}`));
          console.log(chalk.cyan('   ID:'), p.id);
          if (p.message) console.log(chalk.cyan('   Message:'), p.message);
          if (p.permalink_url) console.log(chalk.cyan('   URL:'), p.permalink_url);
        });
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['pages_read_engagement'] });
      }
    });
}

module.exports = registerQueryCommands;

