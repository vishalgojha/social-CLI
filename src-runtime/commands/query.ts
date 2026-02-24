import chalk = require('chalk');
import ora = require('ora');

const config = require('../../lib/config');
const MetaAPIClient = require('../../lib/api-client');
const { formatTable } = require('../../lib/formatters');

type CliOptions = {
  api: string;
  fields: string;
  verbose?: boolean;
  json?: boolean;
  table?: boolean;
  limit: string;
  igUserId?: string;
  pageId?: string;
};

type UnknownRecord = Record<string, unknown>;

function getTokenOrExit(api: string): string {
  const token = config.getToken(api);
  if (!token) {
    console.error(chalk.red(`X No ${api} token found. Run: social auth login -a ${api}`));
    process.exit(1);
  }
  return token as string;
}

function asRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === 'object');
}

function registerQueryCommands(program: any) {
  const query = program.command('query').description('Read-only queries across Meta APIs');

  query
    .command('me')
    .description('Get your profile information')
    .option('-a, --api <api>', 'API to use', config.getDefaultApi())
    .option('-f, --fields <fields>', 'Fields to retrieve (comma-separated)', 'id,name')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Log request details (no secrets)')
    .action(async (options: CliOptions) => {
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
        Object.entries((data as UnknownRecord) || {}).forEach(([k, v]) => {
          console.log(chalk.cyan(`${k}:`), v as string | number | boolean | null);
        });
        console.log('');
      } catch (error) {
        spinner.stop();
        client.handleError(error);
      }
    });

  query
    .command('pages')
    .description('List your Facebook Pages (/me/accounts)')
    .option('-l, --limit <n>', 'Limit', '25')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .action(async (options: CliOptions) => {
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

        const rows = asRecordArray((result as UnknownRecord)?.data).map((page) => ({
          id: String(page.id || ''),
          name: String(page.name || ''),
          category: String(page.category || ''),
          fan_count: page.fan_count ?? ''
        }));

        if (options.table) {
          console.log(formatTable(rows, ['name', 'id', 'category', 'fan_count']));
          console.log('');
          return;
        }

        console.log(chalk.bold('\nYour Facebook Pages:'));
        console.log(chalk.gray('─'.repeat(50)));
        rows.forEach((page, i) => {
          console.log(chalk.bold(`${i + 1}. ${page.name}`));
          console.log(chalk.cyan('   ID:'), page.id);
          if (page.category) console.log(chalk.cyan('   Category:'), page.category);
          if (page.fan_count !== '') console.log(chalk.cyan('   Fans:'), page.fan_count);
        });
        console.log('');
      } catch (error) {
        spinner.stop();
        client.handleError(error, { scopes: ['pages_show_list'] });
      }
    });

  query
    .command('instagram-media')
    .description('List Instagram media for an IG user')
    .option('--ig-user-id <id>', 'IG User ID (defaults to configured)')
    .option('-l, --limit <n>', 'Limit', '10')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .action(async (options: CliOptions) => {
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

        const rows = asRecordArray((result as UnknownRecord)?.data).map((media) => ({
          id: String(media.id || ''),
          media_type: String(media.media_type || ''),
          permalink: String(media.permalink || ''),
          timestamp: String(media.timestamp || '')
        }));

        if (options.table) {
          console.log(formatTable(rows, ['media_type', 'id', 'timestamp', 'permalink']));
          console.log('');
          return;
        }

        console.log(chalk.bold('\nInstagram Media:'));
        console.log(chalk.gray('─'.repeat(50)));
        rows.forEach((media, i) => {
          console.log(chalk.bold(`${i + 1}. ${media.media_type}`));
          console.log(chalk.cyan('   ID:'), media.id);
          console.log(chalk.cyan('   URL:'), media.permalink);
          console.log(chalk.cyan('   Posted:'), new Date(media.timestamp).toLocaleString());
        });
        console.log('');
      } catch (error) {
        spinner.stop();
        client.handleError(error, { scopes: ['instagram_basic'] });
      }
    });

  query
    .command('feed')
    .description('List recent posts for a Page (/PAGE_ID/feed)')
    .requiredOption('--page-id <id>', 'Facebook Page ID')
    .option('-l, --limit <n>', 'Limit', '10')
    .option('--json', 'Output as JSON')
    .option('--table', 'Output as table')
    .action(async (options: CliOptions) => {
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

        const rows = asRecordArray((result as UnknownRecord)?.data).map((post) => ({
          id: String(post.id || ''),
          created_time: String(post.created_time || ''),
          message: String(post.message || '').slice(0, 80),
          permalink_url: String(post.permalink_url || '')
        }));

        if (options.table) {
          console.log(formatTable(rows, ['created_time', 'id', 'message']));
          console.log('');
          return;
        }

        console.log(chalk.bold('\nPage Feed:'));
        console.log(chalk.gray('─'.repeat(50)));
        rows.forEach((post, i) => {
          console.log(chalk.bold(`${i + 1}. ${post.created_time}`));
          console.log(chalk.cyan('   ID:'), post.id);
          if (post.message) console.log(chalk.cyan('   Message:'), post.message);
          if (post.permalink_url) console.log(chalk.cyan('   URL:'), post.permalink_url);
        });
        console.log('');
      } catch (error) {
        spinner.stop();
        client.handleError(error, { scopes: ['pages_read_engagement'] });
      }
    });
}

export = registerQueryCommands;
