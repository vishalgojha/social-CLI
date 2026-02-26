"use strict";
const path = require("path");
const fs = require("fs");
const child_process_1 = require("child_process");
const chalk = require("chalk");
const inquirer = require('inquirer');
const config = require('../../lib/config');
const SUPPORTED_PROVIDERS = ['openai', 'openrouter', 'xai'];
function runSubprocess(command, args, env) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(command, args, {
            stdio: 'inherit',
            env
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`TUI exited with code ${code}`));
        });
    });
}
function needsOnboarding() {
    return !config.hasCompletedOnboarding();
}
function normalizeProvider(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'openrouter')
        return 'openrouter';
    if (value === 'xai' || value === 'grok')
        return 'xai';
    return 'openai';
}
function parseExplicitProvider(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value)
        return null;
    if (value === 'openai' || value === 'openrouter' || value === 'xai' || value === 'grok') {
        return normalizeProvider(value);
    }
    return null;
}
function providerLabel(provider) {
    if (provider === 'openrouter')
        return 'OpenRouter';
    if (provider === 'xai')
        return 'xAI (Grok)';
    return 'OpenAI';
}
function providerApiEnvName(provider) {
    if (provider === 'openrouter')
        return 'OPENROUTER_API_KEY';
    if (provider === 'xai')
        return 'XAI_API_KEY';
    return 'OPENAI_API_KEY';
}
function providerBaseUrl(provider) {
    if (provider === 'openrouter') {
        return String(process.env.SOCIAL_OPENROUTER_BASE_URL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim();
    }
    if (provider === 'xai') {
        return String(process.env.SOCIAL_XAI_BASE_URL || process.env.XAI_BASE_URL || 'https://api.x.ai/v1').trim();
    }
    return String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim();
}
function providerModel(provider) {
    if (provider === 'openrouter')
        return 'openai/gpt-4o-mini';
    if (provider === 'xai')
        return 'grok-2-latest';
    return 'gpt-4o-mini';
}
function configuredAgent() {
    const agent = typeof config.getAgentConfig === 'function' ? config.getAgentConfig() : {};
    const provider = normalizeProvider(String(agent?.provider || '').trim().toLowerCase());
    const model = String(agent?.model || '').trim();
    const apiKey = String(agent?.apiKey || '').trim();
    return { provider, model, apiKey };
}
function getProviderApiKeyFromConfig(provider) {
    const agent = configuredAgent();
    if (!agent.apiKey)
        return '';
    if (agent.provider === provider)
        return agent.apiKey;
    return '';
}
function getProviderModelFromConfig(provider) {
    const agent = configuredAgent();
    if (agent.provider !== provider)
        return '';
    return agent.model;
}
function getProviderApiKeyFromEnv(provider) {
    if (provider === 'openrouter') {
        return String(process.env.SOCIAL_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
    }
    if (provider === 'xai') {
        return String(process.env.SOCIAL_XAI_API_KEY || process.env.XAI_API_KEY || '').trim();
    }
    return String(process.env.OPENAI_API_KEY || '').trim();
}
function resolveApiKey(provider, opts) {
    return String(opts.aiApiKey ||
        process.env.SOCIAL_TUI_AI_API_KEY ||
        getProviderApiKeyFromEnv(provider) ||
        getProviderApiKeyFromConfig(provider) ||
        '').trim();
}
function resolveModel(provider, opts) {
    return String(opts.aiModel ||
        process.env.SOCIAL_TUI_AI_MODEL ||
        getProviderModelFromConfig(provider) ||
        providerModel(provider)).trim();
}
function resolveBaseUrl(provider, opts) {
    return String(opts.aiBaseUrl ||
        process.env.SOCIAL_TUI_AI_BASE_URL ||
        providerBaseUrl(provider)).trim();
}
async function promptForProvider(defaultProvider) {
    if (!process.stdout.isTTY || !process.stdin.isTTY)
        return defaultProvider;
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: 'Choose AI provider for Hatch:',
            default: defaultProvider,
            choices: [
                { name: 'OpenAI', value: 'openai' },
                { name: 'OpenRouter', value: 'openrouter' },
                { name: 'xAI (Grok)', value: 'xai' }
            ]
        }
    ]);
    return normalizeProvider(String(answers.provider || defaultProvider));
}
async function promptForApiKey(provider, suggestedModel) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
        return { apiKey: '', model: suggestedModel };
    }
    const label = providerLabel(provider);
    const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
    console.log(chalk.yellow(`\nHatch UI needs ${article} ${label} API key.`));
    console.log(chalk.gray('Enter API key and model once now. You can choose whether to save both.\n'));
    const answers = await inquirer.prompt([
        {
            type: 'password',
            name: 'key',
            mask: '*',
            message: `Enter ${label} API key:`,
            validate: (value) => Boolean(String(value || '').trim()) || 'API key cannot be empty'
        },
        {
            type: 'input',
            name: 'model',
            default: suggestedModel,
            message: `Enter ${label} model (or press Enter for ${suggestedModel}):`,
            filter: (value) => String(value || '').trim()
        },
        {
            type: 'confirm',
            name: 'save',
            default: true,
            message: `Save this ${label} key + model to active profile for future hatch runs?`
        }
    ]);
    const key = String(answers.key || '').trim();
    const model = String(answers.model || suggestedModel || '').trim() || suggestedModel;
    if (key && answers.save && typeof config.setAgentApiKey === 'function') {
        config.setAgentProvider(provider);
        config.setAgentApiKey(key);
        if (typeof config.setAgentModel === 'function') {
            config.setAgentModel(model);
        }
        console.log(chalk.green(`Saved ${label} API key + model (${model}) for active profile.\n`));
    }
    return { apiKey: key, model };
}
function registerTuiCommand(program) {
    program
        .command('tui')
        .alias('hatch')
        .description('Launch agentic terminal UI (chat-first control plane)')
        .option('--ai-provider <provider>', 'AI provider (openai|openrouter|xai)')
        .option('--ai-model <model>', 'AI model override')
        .option('--ai-base-url <url>', 'AI base URL override')
        .option('--ai-api-key <key>', 'AI API key override')
        .option('--verbose', 'Show verbose diagnostic panels in Hatch UI', false)
        .option('--skip-onboard-check', 'Skip onboarding guard and open hatch directly', false)
        .action(async (opts) => {
        const rootDir = path.join(__dirname, '..', '..', '..');
        const distEntry = path.join(rootDir, 'tools', 'agentic-tui', 'dist', 'index.js');
        const srcEntry = path.join(rootDir, 'tools', 'agentic-tui', 'src', 'index.tsx');
        const binPath = path.join(rootDir, 'dist-legacy', 'bin', 'social.js');
        const explicitProvider = String(opts.aiProvider || '').trim().toLowerCase();
        if (explicitProvider && !parseExplicitProvider(explicitProvider)) {
            console.error(chalk.red('\nInvalid --ai-provider value.'));
            console.error(chalk.gray(`Supported values: ${SUPPORTED_PROVIDERS.join(', ')}\n`));
            process.exit(1);
        }
        let provider = normalizeProvider(explicitProvider ||
            process.env.SOCIAL_TUI_AI_VENDOR ||
            String(configuredAgent().provider || '').trim().toLowerCase() ||
            process.env.SOCIAL_TUI_AI_PROVIDER ||
            'openai');
        let resolvedModel = resolveModel(provider, opts);
        let resolvedApiKey = resolveApiKey(provider, opts);
        if (!resolvedApiKey) {
            const allowProviderPrompt = !explicitProvider && !opts.aiApiKey && process.stdout.isTTY && process.stdin.isTTY;
            if (allowProviderPrompt) {
                provider = await promptForProvider(provider);
                resolvedModel = resolveModel(provider, opts);
                resolvedApiKey = resolveApiKey(provider, opts);
            }
        }
        if (!resolvedApiKey) {
            const prompted = await promptForApiKey(provider, resolvedModel);
            resolvedApiKey = prompted.apiKey;
            if (!opts.aiModel) {
                resolvedModel = prompted.model;
            }
        }
        if (!resolvedApiKey) {
            console.error(chalk.red('\nHatch UI requires a valid API key.'));
            console.error(chalk.gray(`Set ${providerApiEnvName(provider)}, pass --ai-api-key, or run \`social hatch\` in a terminal to enter it securely.\n`));
            process.exit(1);
        }
        // TUI parser currently uses OpenAI-compatible transport for AI parsing.
        const runtimeProvider = 'openai';
        const env = {
            ...process.env,
            SOCIAL_TUI_AI_PROVIDER: runtimeProvider,
            SOCIAL_TUI_AI_VENDOR: provider,
            SOCIAL_TUI_AI_MODEL: resolvedModel,
            SOCIAL_TUI_AI_BASE_URL: resolveBaseUrl(provider, opts),
            SOCIAL_TUI_AI_API_KEY: resolvedApiKey,
            SOCIAL_TUI_VERBOSE: opts.verbose ? '1' : String(process.env.SOCIAL_TUI_VERBOSE || '')
        };
        try {
            if (!opts.skipOnboardCheck && needsOnboarding()) {
                console.log(chalk.yellow('\nFirst-run setup required before Hatch UI.'));
                console.log(chalk.gray('Guided path: setup -> status -> hatch.\n'));
                await runSubprocess(process.execPath, [binPath, '--no-banner', 'setup', '--no-start'], env);
                return;
            }
            if (fs.existsSync(distEntry)) {
                await runSubprocess(process.execPath, [distEntry], env);
                return;
            }
            const tsxCli = require.resolve('tsx/dist/cli.mjs');
            await runSubprocess(process.execPath, [tsxCli, srcEntry], env);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`x Failed to start TUI: ${message}`));
            console.error(chalk.yellow('Build hint: npm run build:social-ts && npm --prefix tools/agentic-tui run build'));
            process.exit(1);
        }
    });
}
module.exports = registerTuiCommand;
