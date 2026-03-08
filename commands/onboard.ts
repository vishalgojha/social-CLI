const path = require('path');
const { spawn } = require('child_process');
const inquirer = require('inquirer');
const chalk = require('chalk');
const config = require('../lib/config');
const packageJson = require('../package.json');
const { readyLines } = require('../lib/ui/onboarding-ready');
const {
  renderPanel,
  formatBadge,
  kv,
  formatTokenPreview
} = require('../lib/ui/chrome');

const API_ORDER = ['facebook', 'instagram', 'whatsapp'];
const API_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp'
};

function runSubprocess(args) {
  return new Promise((resolve, reject) => {
    const binPath = path.join(__dirname, '..', 'bin', 'social.js');
    const child = spawn(process.execPath, [binPath, ...args], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: social ${args.join(' ')} (code ${code})`));
    });
  });
}

function slugifyOperatorId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'operator';
}

function planApiOrder(primaryApi, extraApis = []) {
  const extras = Array.isArray(extraApis) ? extraApis : [];
  const selected = [primaryApi, ...extras]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => API_ORDER.includes(value));

  const deduped = [];
  selected.forEach((api) => {
    if (!deduped.includes(api)) deduped.push(api);
  });

  return deduped;
}

function recommendedLoginMode(api, snapshot) {
  if (api === 'whatsapp') return 'manual';
  return snapshot && snapshot.appConfigured ? 'oauth' : 'manual';
}

function tokenTone(connected) {
  return connected ? 'success' : 'warn';
}

function tokenBadge(connected) {
  return formatBadge(connected ? 'LINKED' : 'NEEDS LOGIN', { tone: tokenTone(connected) });
}

function printStage(title) {
  const line = '─'.repeat(Math.max(12, 78 - String(title || '').length));
  console.log(`${chalk.green('◇')} ${chalk.yellow.bold(String(title || ''))} ${chalk.gray(line)}`);
}

function printPanel(title, rows, minWidth = 78) {
  console.log(renderPanel({
    title: ` ${title} `,
    rows,
    minWidth,
    borderColor: (value) => chalk.gray(value)
  }));
  console.log('');
}

function buildOnboardingSnapshot() {
  const operator = typeof config.getOperator === 'function'
    ? config.getOperator()
    : { id: '', name: '' };
  const onboarding = typeof config.getOnboardingStatus === 'function'
    ? config.getOnboardingStatus()
    : { completed: false, completedAt: '', version: '' };
  const app = typeof config.getAppCredentials === 'function'
    ? config.getAppCredentials()
    : { appId: '', appSecret: '' };

  const tokenMap = {};
  API_ORDER.forEach((api) => {
    tokenMap[api] = String(config.getToken(api) || '').trim();
  });

  return {
    profile: String(config.getActiveProfile() || 'default').trim() || 'default',
    operator: {
      id: String(operator.id || '').trim(),
      name: String(operator.name || '').trim()
    },
    onboarding: {
      completed: Boolean(onboarding.completed),
      completedAt: String(onboarding.completedAt || '').trim(),
      version: String(onboarding.version || '').trim()
    },
    appConfigured: Boolean(String(app.appId || '').trim() && String(app.appSecret || '').trim()),
    appId: String(app.appId || '').trim(),
    tokenMap
  };
}

function buildWorkspaceRows(snapshot) {
  return [
    kv('Profile', chalk.cyan(snapshot.profile), { labelWidth: 18 }),
    kv(
      'Operator',
      snapshot.operator.name
        ? `${chalk.cyan(snapshot.operator.name)} ${chalk.gray(`(${snapshot.operator.id || 'pending'})`)}`
        : snapshot.operator.id
          ? chalk.cyan(snapshot.operator.id)
          : '',
      { labelWidth: 18 }
    ),
    kv(
      'Onboarding',
      snapshot.onboarding.completed
        ? `${formatBadge('DONE', { tone: 'success' })} ${chalk.gray(snapshot.onboarding.completedAt || '')}`
        : formatBadge('PENDING', { tone: 'warn' }),
      { labelWidth: 18 }
    ),
    kv(
      'Meta app',
      snapshot.appConfigured
        ? `${formatBadge('READY', { tone: 'success' })} ${chalk.gray(formatTokenPreview(snapshot.appId || ''))}`
        : formatBadge('OPTIONAL', { tone: 'neutral' }),
      { labelWidth: 18 }
    ),
    ...API_ORDER.map((api) => {
      const token = String(snapshot.tokenMap[api] || '').trim();
      const preview = token ? chalk.gray(formatTokenPreview(token)) : chalk.gray('not linked');
      return kv(API_LABELS[api], `${tokenBadge(Boolean(token))} ${preview}`, { labelWidth: 18 });
    })
  ];
}

function buildApiChoiceLabel(snapshot, api) {
  const token = String(snapshot.tokenMap[api] || '').trim();
  const suffix = token ? chalk.gray(`(${formatTokenPreview(token)})`) : chalk.gray('(new connection)');
  return `${API_LABELS[api]} ${suffix}`;
}

async function promptSecurityAcknowledgement() {
  printStage('Security');
  printPanel('Security warning', [
    chalk.gray('Social Flow stores tokens locally for the active operator profile.'),
    chalk.gray('Only connect accounts you control and avoid pasting secrets into shared terminals.'),
    chalk.gray('If this workstation is shared, lock it down before enabling WhatsApp or ads access.')
  ]);

  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ok',
      message: 'I understand this workspace is operator-owned and tokens should stay local. Continue?',
      default: true
    }
  ]);

  if (!answer.ok) {
    console.log(chalk.yellow('\nOnboarding canceled before any changes were made.\n'));
    process.exit(1);
  }
}

async function promptOperator(snapshot, opts) {
  const currentName = snapshot.operator.name || snapshot.operator.id;
  if (opts.quick && currentName) return;

  printStage('Operator identity');
  printPanel('Operator', [
    chalk.gray('This name is used for audit trails, approvals, and activity attribution inside Social Flow.')
  ]);

  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Who is operating this workspace?',
      default: currentName || process.env.SOCIAL_USER || process.env.USERNAME || process.env.USER || ''
    }
  ]);

  const name = String(answer.name || '').trim();
  if (!name) return;

  const next = typeof config.setOperator === 'function'
    ? config.setOperator({ id: slugifyOperatorId(name), name })
    : { id: slugifyOperatorId(name), name };

  printPanel('Operator saved', [
    kv('Name', chalk.cyan(next.name || name), { labelWidth: 14 }),
    kv('ID', chalk.cyan(next.id || slugifyOperatorId(name)), { labelWidth: 14 })
  ], 62);
}

async function promptPrimaryApi(snapshot) {
  printStage('Primary channel');
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'api',
      message: 'Which surface should Social Flow connect first?',
      choices: API_ORDER.map((api) => ({
        name: buildApiChoiceLabel(snapshot, api),
        value: api
      }))
    }
  ]);

  return String(answer.api || 'facebook').trim().toLowerCase();
}

async function promptExtraApis(primaryApi) {
  printStage('Additional channels');
  const answer = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'apis',
      message: 'Connect anything else in this pass?',
      choices: API_ORDER
        .filter((api) => api !== primaryApi)
        .map((api) => ({
          name: API_LABELS[api],
          value: api
        }))
    }
  ]);

  return Array.isArray(answer.apis) ? answer.apis : [];
}

async function promptExistingTokenAction(api) {
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `${API_LABELS[api]} is already linked. What do you want to do?`,
      choices: [
        { name: 'Keep current connection', value: 'keep' },
        { name: 'Re-link now', value: 'relink' },
        { name: 'Skip for now', value: 'skip' }
      ],
      default: 'keep'
    }
  ]);

  return String(answer.action || 'keep');
}

async function promptMissingTokenAction(api) {
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: `${API_LABELS[api]} is not linked yet.`,
      choices: [
        { name: 'Connect now (recommended)', value: 'connect' },
        { name: 'Skip for now', value: 'skip' }
      ],
      default: 'connect'
    }
  ]);

  return String(answer.action || 'connect');
}

async function promptLoginMode(api, snapshot, opts) {
  if (opts.quick) return recommendedLoginMode(api, snapshot);
  const recommended = recommendedLoginMode(api, snapshot);

  if (api === 'whatsapp') {
    return 'manual';
  }

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: `How should Social Flow connect ${API_LABELS[api]}?`,
      choices: snapshot.appConfigured
        ? [
            { name: 'Use browser OAuth (recommended)', value: 'oauth' },
            { name: 'Paste token manually', value: 'manual' }
          ]
        : [
            { name: 'Paste token manually', value: 'manual' },
            { name: 'Let login flow help configure Meta app + OAuth', value: 'oauth' }
          ],
      default: recommended
    }
  ]);

  return String(answer.mode || recommended);
}

function buildLoginArgs(api, mode) {
  const args = ['auth', 'login', '-a', api];
  if (mode === 'oauth') args.push('--oauth');
  else args.push('--manual');
  return args;
}

async function connectApi(api, opts) {
  let snapshot = buildOnboardingSnapshot();
  const existingToken = String(snapshot.tokenMap[api] || '').trim();

  printStage(`${API_LABELS[api]} connection`);
  printPanel(`${API_LABELS[api]} status`, [
    kv('Current state', tokenBadge(Boolean(existingToken)), { labelWidth: 16 }),
    kv('Profile', chalk.cyan(snapshot.profile), { labelWidth: 16 }),
    kv('Meta app', snapshot.appConfigured ? formatBadge('READY', { tone: 'success' }) : formatBadge('OPTIONAL', { tone: 'neutral' }), { labelWidth: 16 })
  ], 66);

  const action = existingToken
    ? await promptExistingTokenAction(api)
    : await promptMissingTokenAction(api);
  if (action === 'keep' || action === 'skip') return;

  const mode = await promptLoginMode(api, snapshot, opts);
  await runSubprocess(buildLoginArgs(api, mode));

  snapshot = buildOnboardingSnapshot();
  const updatedToken = String(snapshot.tokenMap[api] || '').trim();
  printPanel(`${API_LABELS[api]} updated`, [
    kv('Mode', mode === 'oauth' ? 'browser oauth' : 'manual token', { labelWidth: 16 }),
    kv('Connection', tokenBadge(Boolean(updatedToken)), { labelWidth: 16 }),
    kv('Token preview', updatedToken ? chalk.gray(formatTokenPreview(updatedToken)) : chalk.gray('not linked'), { labelWidth: 16 })
  ], 66);
}

function hasAnyConnectedToken(snapshot) {
  return API_ORDER.some((api) => Boolean(String(snapshot.tokenMap[api] || '').trim()));
}

function printCompletion(snapshot) {
  printStage('Ready');
  printPanel('Workspace ready', readyLines({ profile: snapshot.profile }).map((line) => {
    if (/^\d+\./.test(line)) return chalk.cyan(line);
    if (line === 'You are now ready.') return chalk.green.bold(line);
    return chalk.gray(line);
  }));
}

function registerOnboardCommand(program) {
  program
    .command('onboard')
    .description('Interactive onboarding wizard (tokens + operator identity + health checks)')
    .option('--quick', 'Only connect one API and skip optional prompts', false)
    .option('--no-hatch', 'Do not auto-start hatch UI after onboarding')
    .action(async (opts) => {
      const initialSnapshot = buildOnboardingSnapshot();

      printStage('Social Flow onboarding');
      printPanel('Workspace snapshot', buildWorkspaceRows(initialSnapshot));

      await promptSecurityAcknowledgement();
      await promptOperator(initialSnapshot, opts);

      const currentSnapshot = buildOnboardingSnapshot();
      const primaryApi = await promptPrimaryApi(currentSnapshot);
      const extraApis = opts.quick ? [] : await promptExtraApis(primaryApi);
      const apiPlan = planApiOrder(primaryApi, extraApis);

      printStage('Selected channels');
      printPanel('Channels', apiPlan.map((api, index) => {
        const token = String(buildOnboardingSnapshot().tokenMap[api] || '').trim();
        return `${index + 1}. ${API_LABELS[api]} ${token ? chalk.gray(`(${formatTokenPreview(token)})`) : chalk.gray('(pending login)')}`;
      }), 66);

      for (const api of apiPlan) {
        // eslint-disable-next-line no-await-in-loop
        await connectApi(api, opts);
      }

      printStage('Diagnostics');
      await runSubprocess(['doctor']);

      const finalSnapshot = buildOnboardingSnapshot();
      if (!hasAnyConnectedToken(finalSnapshot)) {
        printPanel('Onboarding incomplete', [
          chalk.yellow('No platform was linked in this pass.'),
          chalk.gray('Run `social onboard` again or connect one API with `social auth login -a <api>`.'),
          chalk.gray('Hatch will stay locked until at least one API is configured.')
        ]);
        process.exit(1);
      }

      config.markOnboardingComplete({ version: packageJson.version });
      const completedSnapshot = buildOnboardingSnapshot();
      printCompletion(completedSnapshot);

      if (process.stdout.isTTY && opts.hatch !== false) {
        console.log(chalk.yellow('Launching Hatch...\n'));
        await runSubprocess(['hatch', '--skip-onboard-check']);
      }
    });
}

const exported = registerOnboardCommand;
exported._private = {
  slugifyOperatorId,
  planApiOrder,
  recommendedLoginMode,
  buildWorkspaceRows,
  buildApiChoiceLabel
};

module.exports = exported;
