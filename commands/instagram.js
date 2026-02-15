const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const config = require('../lib/config');
const MetaAPIClient = require('../lib/api-client');
const { formatTable } = require('../lib/formatters');

function getToken() {
  // Many apps reuse the same user token for FB + IG Graph.
  return config.getToken('instagram') || config.getToken('facebook') || '';
}

async function pickIgUser(accounts, defaultId) {
  const choices = accounts.map((a) => ({
    name: `${a.username || a.page_name} (${a.id})`,
    value: a.id
  }));
  const idx = defaultId ? choices.findIndex((c) => c.value === defaultId) : -1;
  const ans = await inquirer.prompt([{ type: 'list', name: 'id', message: 'Select an IG user:', choices, default: idx >= 0 ? idx : 0 }]);
  return ans.id;
}

function registerInstagramCommands(program) {
  const instagram = program.command('instagram').description('Instagram Graph API helpers');

  const accounts = instagram.command('accounts').description('Manage connected Instagram business accounts');

  accounts
    .command('list')
    .description('List connected Instagram business accounts')
    .option('--json', 'Output as JSON')
    .option('--set-default', 'Pick and save default IG user id')
    .action(async (options) => {
      const token = getToken();
      if (!token) {
        console.error(chalk.red('X No instagram/facebook token found. Run: social auth login -a facebook'));
        process.exit(1);
      }

      const spinner = ora('Fetching Pages...').start();
      const client = new MetaAPIClient(token, 'facebook');
      try {
        const pages = await client.getFacebookPages(100);
        spinner.stop();

        const accounts = (pages.data || [])
          .filter((p) => p.instagram_business_account && p.instagram_business_account.id)
          .map((p) => ({
            page_id: p.id,
            page_name: p.name,
            id: p.instagram_business_account.id,
            username: p.instagram_business_account.username
          }));

        if (options.setDefault) {
          if (!accounts.length) {
            console.error(chalk.red('X No connected IG business accounts found.'));
            process.exit(1);
          }
          const picked = await pickIgUser(accounts, config.getDefaultIgUserId());
          config.setDefaultIgUserId(picked);
          console.log(chalk.green(`OK Default IG user set to: ${picked}\n`));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify({ data: accounts }, null, 2));
          return;
        }

        if (!accounts.length) {
          console.log(chalk.yellow('\nNo connected IG business accounts found.\n'));
          return;
        }

        console.log(formatTable(accounts, ['username', 'id', 'page_name', 'page_id']));
        console.log('');
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['instagram_basic', 'pages_show_list'] });
      }
    });

  const media = instagram.command('media').description('Instagram media');

  media
    .command('list')
    .description('List media for an IG user')
    .option('--ig-user-id <id>', 'IG user id (defaults to configured)')
    .option('-l, --limit <n>', 'Limit', '10')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = getToken();
      if (!token) {
        console.error(chalk.red('X No instagram/facebook token found. Run: social auth login -a facebook'));
        process.exit(1);
      }
      const igUserId = options.igUserId || config.getDefaultIgUserId();
      if (!igUserId) {
        console.error(chalk.red('X Missing IG user id. Use --ig-user-id or set default via social instagram accounts --set-default'));
        process.exit(1);
      }

      const spinner = ora('Fetching media...').start();
      const client = new MetaAPIClient(token, 'instagram');
      try {
        const result = await client.getInstagramMedia(igUserId, parseInt(options.limit, 10));
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['instagram_basic'] });
      }
    });

  instagram
    .command('insights')
    .description('Get media insights')
    .requiredOption('--ig-media-id <id>', 'IG media id')
    .requiredOption('--metric <metrics>', 'Comma-separated metrics (e.g. reach,impressions)')
    .option('--period <period>', 'Period (if required by metric)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = getToken();
      if (!token) {
        console.error(chalk.red('X No instagram/facebook token found. Run: social auth login -a facebook'));
        process.exit(1);
      }

      const spinner = ora('Fetching insights...').start();
      const client = new MetaAPIClient(token, 'instagram');
      try {
        const metrics = String(options.metric).split(',').map((s) => s.trim()).filter(Boolean).join(',');
        const result = await client.getInstagramInsights(options.igMediaId, metrics, options.period);
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['instagram_manage_insights'] });
      }
    });

  const comments = instagram.command('comments').description('Instagram comments');

  comments
    .command('list')
    .description('List comments for a media id')
    .requiredOption('--media-id <id>', 'IG media id')
    .option('-l, --limit <n>', 'Limit', '50')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = getToken();
      if (!token) {
        console.error(chalk.red('X No instagram/facebook token found. Run: social auth login -a facebook'));
        process.exit(1);
      }
      const spinner = ora('Fetching comments...').start();
      const client = new MetaAPIClient(token, 'instagram');
      try {
        const result = await client.listInstagramComments(options.mediaId, parseInt(options.limit, 10));
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['instagram_manage_comments'] });
      }
    });

  comments
    .command('reply')
    .description('Reply to a comment')
    .requiredOption('--comment-id <id>', 'Comment id to reply to')
    .requiredOption('--message <text>', 'Reply text')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = getToken();
      if (!token) {
        console.error(chalk.red('X No instagram/facebook token found. Run: social auth login -a facebook'));
        process.exit(1);
      }
      const spinner = ora('Replying...').start();
      const client = new MetaAPIClient(token, 'instagram');
      try {
        const result = await client.replyToInstagramComment(options.commentId, options.message);
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['instagram_manage_comments'] });
      }
    });

  instagram
    .command('publish')
    .description('Publish a previously created IG container')
    .requiredOption('--container-id <id>', 'IG creation container id')
    .option('--ig-user-id <id>', 'IG user id (defaults to configured)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const token = getToken();
      if (!token) {
        console.error(chalk.red('X No instagram/facebook token found. Run: social auth login -a facebook'));
        process.exit(1);
      }
      const igUserId = options.igUserId || config.getDefaultIgUserId();
      if (!igUserId) {
        console.error(chalk.red('X Missing IG user id. Use --ig-user-id or set default via social instagram accounts --set-default'));
        process.exit(1);
      }
      const spinner = ora('Publishing...').start();
      const client = new MetaAPIClient(token, 'instagram');
      try {
        const result = await client.publishInstagramContainer(igUserId, options.containerId);
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        spinner.stop();
        client.handleError(e, { scopes: ['instagram_basic'] });
      }
    });
}

module.exports = registerInstagramCommands;
