import chalk = require('chalk');
const inquirer = require('inquirer');

const config = require('../../lib/config');
const { runAgent, memoryCommands } = require('../../lib/agent');
const { normalizeProvider, defaultModelForProvider } = require('../../lib/llm-providers');

type AgentSetupOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
};

type AgentMemoryListOptions = {
  json?: boolean;
};

type AgentMemoryShowOptions = {
  json?: boolean;
  limit?: string;
};

type AgentActionOptions = Record<string, unknown>;

function registerAgentCommands(program: any) {
  const agent = program
    .command('agent')
    .description('Meta DevOps co-pilot (safe, tool-based, with scoped memory)')
    .argument('[intent...]', 'Intent to plan+execute (e.g. "fix whatsapp webhook for clientA")')
    .option('--scope <scope>', 'Memory scope (overrides auto-detection)')
    .option('--no-memory', 'Disable auto-loading/saving memory')
    .option('--provider <provider>', 'LLM provider: openai|anthropic|openrouter|xai|gemini', 'openai')
    .option('--model <model>', 'LLM model (provider-specific)')
    .option('--json', 'JSON output (plan + results)')
    .option('--yes', 'Auto-approve plan (still prompts for high-risk steps)')
    .option('--plan-only', 'Generate plan only (no execution)')
    .action(async (intentParts: string[] = [], options: AgentActionOptions) => {
      const intent = intentParts.join(' ').trim();
      if (!intent) {
        console.log(chalk.yellow('\nProvide an intent, or use memory subcommands.\n'));
        agent.help();
        return;
      }
      await runAgent({ intent, options });
    });

  agent
    .command('setup')
    .description('Configure default LLM provider/model for social agent/chat')
    .option('--provider <provider>', 'openai|anthropic|openrouter|xai|gemini', 'openai')
    .option('--model <model>', 'Model name for selected provider')
    .option('--api-key <key>', 'API key for selected provider (required)')
    .action(async (opts: AgentSetupOptions) => {
      const provider = normalizeProvider(opts.provider);
      const model = String(opts.model || defaultModelForProvider(provider));
      if (provider === 'ollama') {
        console.error(chalk.red('\nProvider "ollama" is disabled. Use a cloud provider with a valid API key.\n'));
        process.exit(1);
      }

      const key = String(opts.apiKey || '').trim();
      if (!key) {
        console.error(chalk.red('\nMissing --api-key for provider setup.\n'));
        process.exit(1);
      }

      config.setAgentProvider(provider);
      config.setAgentModel(model);
      config.setAgentApiKey(key);

      console.log(chalk.green('\nAgent provider configured.'));
      console.log(chalk.gray(`Provider: ${provider}`));
      console.log(chalk.gray(`Model: ${model}`));
      console.log(chalk.gray('API key: configured\n'));
    });

  const mem = agent.command('memory').description('Manage agent memory scopes');

  mem
    .command('list')
    .description('List available memory scopes')
    .option('--json', 'JSON output')
    .action(async (options: AgentMemoryListOptions) => {
      await memoryCommands.list({ json: Boolean(options.json) });
    });

  mem
    .command('show <scope>')
    .description('Show summary and recent memory entries for a scope')
    .option('--json', 'JSON output')
    .option('--limit <n>', 'How many recent entries to show', '20')
    .action(async (scope: string, options: AgentMemoryShowOptions) => {
      await memoryCommands.show({
        scope,
        json: Boolean(options.json),
        limit: parseInt(String(options.limit || '20'), 10)
      });
    });

  mem
    .command('forget <scope>')
    .description('Delete a scope memory folder')
    .action(async (scope: string) => {
      const answer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'ok',
          default: false,
          message: `Delete ALL agent memory for scope "${scope}"?`
        }
      ]);
      if (!answer.ok) return;
      await memoryCommands.forget({ scope });
    });

  mem
    .command('clear')
    .description('Delete all scope memory folders')
    .action(async () => {
      const answer1 = await inquirer.prompt([
        { type: 'confirm', name: 'ok', default: false, message: 'Delete ALL agent memory for ALL scopes?' }
      ]);
      if (!answer1.ok) return;
      const answer2 = await inquirer.prompt([
        { type: 'confirm', name: 'ok', default: false, message: 'Really sure? This cannot be undone.' }
      ]);
      if (!answer2.ok) return;
      await memoryCommands.clear();
    });
}

export = registerAgentCommands;
