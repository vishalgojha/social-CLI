const chalk = require('chalk');
const inquirer = require('inquirer');
const axios = require('axios');
const config = require('../lib/config');
const { runAgent, memoryCommands } = require('../lib/agent');
const { normalizeProvider, defaultModelForProvider } = require('../lib/llm-providers');

function registerAgentCommands(program) {
  const agent = program
    .command('agent')
    .description('Meta DevOps co-pilot (safe, tool-based, with scoped memory)')
    .argument('[intent...]', 'Intent to plan+execute (e.g. "fix whatsapp webhook for clientA")')
    .option('--scope <scope>', 'Memory scope (overrides auto-detection)')
    .option('--no-memory', 'Disable auto-loading/saving memory')
    .option('--provider <provider>', 'LLM provider: openai|anthropic|openrouter|xai|ollama|gemini', 'openai')
    .option('--model <model>', 'LLM model (provider-specific)')
    .option('--json', 'JSON output (plan + results)')
    .option('--yes', 'Auto-approve plan (still prompts for high-risk steps)')
    .option('--plan-only', 'Generate plan only (no execution)')
    .action(async (intentParts, options) => {
      const intent = (intentParts || []).join(' ').trim();
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
    .option('--provider <provider>', 'openai|anthropic|openrouter|xai|ollama|gemini', 'ollama')
    .option('--model <model>', 'Model name for selected provider')
    .option('--api-key <key>', 'API key for cloud providers (optional)')
    .option('--ollama-base-url <url>', 'Ollama URL', process.env.SOCIAL_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434')
    .option('--pull', 'Pull missing Ollama model automatically', false)
    .action(async (opts) => {
      const provider = normalizeProvider(opts.provider);
      const model = String(opts.model || defaultModelForProvider(provider));

      if (provider === 'ollama') {
        const base = String(opts.ollamaBaseUrl || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
        let tags = [];
        try {
          const tagsRes = await axios.get(`${base}/api/tags`, { timeout: 4000 });
          tags = Array.isArray(tagsRes?.data?.models) ? tagsRes.data.models.map((m) => String(m.name || '')) : [];
          const installed = tags.includes(model);

          if (!installed && opts.pull) {
            console.log(chalk.cyan(`\nPulling model ${model} from Ollama...\n`));
            await axios.post(`${base}/api/pull`, { model, stream: false }, { timeout: 15 * 60 * 1000 });
          }

          config.setAgentProvider('ollama');
          config.setAgentModel(model);
          config.setAgentApiKey('');

          console.log(chalk.green('\nConfigured agent for local Ollama.'));
          console.log(chalk.gray(`Provider: ollama`));
          console.log(chalk.gray(`Model: ${model}`));
          console.log(chalk.gray(`Base URL: ${base}`));
          if (!tags.includes(model) && !opts.pull) {
            console.log(chalk.yellow(`Model "${model}" is not installed yet. Run: ollama pull ${model}`));
          }
          console.log('');
          return;
        } catch (error) {
          console.error(chalk.red('\nCould not reach Ollama at:'), base);
          console.error(chalk.yellow('Start Ollama first, then retry.'));
          console.error(chalk.gray(`Suggested model for 16GB RAM: ${model}`));
          console.error(chalk.gray(`Pull command: ollama pull ${model}\n`));
          if (process.env.DEBUG) {
            console.error(chalk.gray(String(error?.message || error || '')));
          }
          process.exit(1);
        }
      }

      const key = String(opts.apiKey || '').trim();
      if (!key) {
        console.error(chalk.red('\nMissing --api-key for cloud provider setup.\n'));
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
    .action(async (options) => {
      await memoryCommands.list({ json: Boolean(options.json) });
    });

  mem
    .command('show <scope>')
    .description('Show summary and recent memory entries for a scope')
    .option('--json', 'JSON output')
    .option('--limit <n>', 'How many recent entries to show', '20')
    .action(async (scope, options) => {
      await memoryCommands.show({
        scope,
        json: Boolean(options.json),
        limit: parseInt(options.limit, 10)
      });
    });

  mem
    .command('forget <scope>')
    .description('Delete a scope memory folder')
    .action(async (scope) => {
      const ans = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'ok',
          default: false,
          message: `Delete ALL agent memory for scope "${scope}"?`
        }
      ]);
      if (!ans.ok) return;
      await memoryCommands.forget({ scope });
    });

  mem
    .command('clear')
    .description('Delete all scope memory folders')
    .action(async () => {
      const ans1 = await inquirer.prompt([
        { type: 'confirm', name: 'ok', default: false, message: 'Delete ALL agent memory for ALL scopes?' }
      ]);
      if (!ans1.ok) return;
      const ans2 = await inquirer.prompt([
        { type: 'confirm', name: 'ok', default: false, message: 'Really sure? This cannot be undone.' }
      ]);
      if (!ans2.ok) return;
      await memoryCommands.clear();
    });
}

module.exports = registerAgentCommands;
