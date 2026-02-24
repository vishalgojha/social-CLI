const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const config = require('./config');
const { sanitizeForLog } = require('./api');
const {
  detectScopeCandidates,
  sanitizeScope,
  listScopes,
  loadScopeSummary,
  loadScopeMemory,
  appendScopeMemory,
  forgetScope,
  clearAllScopes,
  getMemoryStalenessDays
} = require('./memory');
const { getToolRegistry, validatePlanSteps } = require('../tools/registry');
const { planWithLLM } = require('./llm');

function toIsoNow() {
  return new Date().toISOString();
}

function printPlanMarkdown({ scope, staleDays, usedMemory, planMarkdown, risk }) {
  console.log('');
  console.log(chalk.bold('Proposed Plan'));
  console.log(chalk.gray('Scope: ') + chalk.cyan(scope) + (usedMemory ? chalk.gray(' (memory loaded)') : chalk.gray(' (no memory)')));
  if (staleDays !== null && staleDays > 7) {
    console.log(chalk.yellow(`Warning: Memory looks stale (last update ~${staleDays} days ago).`));
  }
  console.log(chalk.gray('Risk: ') + (risk === 'high' ? chalk.red(risk) : risk === 'medium' ? chalk.yellow(risk) : chalk.green(risk)));
  console.log('');
  console.log(planMarkdown.trimEnd());
  console.log('');
}

async function pickScopeOrAsk({ intent, forcedScope }) {
  if (forcedScope) return sanitizeScope(forcedScope);

  const candidates = detectScopeCandidates(intent, config.getAppCredentials?.().appId);
  if (candidates.length === 1) return sanitizeScope(candidates[0]);

  // If any candidate already exists on disk, prefer it.
  const existing = new Set(listScopes());
  const existingHits = candidates.filter((c) => existing.has(sanitizeScope(c)));
  if (existingHits.length === 1) return sanitizeScope(existingHits[0]);

  // Non-interactive: pick the best guess to avoid crashing on prompts.
  if (!process.stdout.isTTY) {
    return sanitizeScope(candidates[0] || 'default');
  }

  const ans = await inquirer.prompt([
    {
      type: 'input',
      name: 'scope',
      message: 'Agent scope name (used for memory folder):',
      default: candidates[0] ? sanitizeScope(candidates[0]) : 'default',
      validate: (v) => Boolean(String(v || '').trim()) || 'Scope cannot be empty'
    }
  ]);
  return sanitizeScope(ans.scope);
}

async function confirmProceed() {
  const ans = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Proceed?',
      choices: [
        { name: 'y (execute)', value: 'y' },
        { name: 'edit (revise plan)', value: 'edit' },
        { name: 'n (cancel)', value: 'n' }
      ]
    }
  ]);
  return ans.choice;
}

async function confirmHighRiskStep(step) {
  const ans = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ok',
      default: false,
      message: `High-risk step: "${step.tool}". Execute this step?`
    }
  ]);
  return Boolean(ans.ok);
}

async function editPlanFlow({ intent, plan }) {
  const ans = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'Edit mode:',
      choices: [
        { name: 'Re-plan (add a short instruction)', value: 'replan' },
        { name: 'Remove steps', value: 'remove' },
        { name: 'Cancel', value: 'cancel' }
      ]
    }
  ]);

  if (ans.mode === 'cancel') return { intent, plan, cancelled: true };

  if (ans.mode === 'remove') {
    const choices = (plan.steps || []).map((s, idx) => ({
      name: `${idx + 1}. ${s.tool}${s.why ? ` (${s.why})` : ''}`,
      value: idx,
      checked: true
    }));
    const picked = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'keep',
        message: 'Keep which steps?',
        choices
      }
    ]);
    const keepIdx = new Set(picked.keep || []);
    const nextSteps = (plan.steps || []).filter((_, idx) => keepIdx.has(idx));
    return {
      intent,
      plan: { ...plan, steps: nextSteps },
      cancelled: false
    };
  }

  const instruction = await inquirer.prompt([
    {
      type: 'input',
      name: 'extra',
      message: 'Add instruction for the replanner:',
      validate: (v) => Boolean(String(v || '').trim()) || 'Instruction cannot be empty'
    }
  ]);

  return {
    intent: `${intent}\n\nAdditional instruction: ${instruction.extra}`,
    plan: null,
    cancelled: false
  };
}

async function executePlan({ scope, toolsByName, steps, options, memoryEnabled }) {
  const results = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const tool = toolsByName[step.tool];
    const stepLabel = `Step ${i + 1}/${steps.length}: ${step.tool}`;

    if (!tool) {
      console.log(chalk.red(`✘ ${stepLabel}: Unknown tool (skipped)`));
      results.push({ step: i + 1, tool: step.tool, ok: false, error: 'Unknown tool' });
      continue;
    }

    if (tool.risk === 'high') {
      const ok = await confirmHighRiskStep(step);
      if (!ok) {
        console.log(chalk.yellow(`! ${stepLabel}: skipped by user`));
        results.push({ step: i + 1, tool: step.tool, ok: false, skipped: true });
        continue;
      }
    }

    const spinner = (!options.json && process.stdout.isTTY) ? ora(stepLabel).start() : null;
    try {
      const output = await tool.execute({
        config,
        options,
        scope,
        // Redact before any logging/memory writes.
        sanitizeForLog
      }, step.args || {});
      if (spinner) spinner.stop();
      if (!options.json) console.log(chalk.green(`✔ ${stepLabel}: Success`));
      results.push({ step: i + 1, tool: step.tool, ok: true, output });

      if (memoryEnabled) {
        await appendScopeMemory(scope, {
          timestamp: toIsoNow(),
          type: 'status',
          content: {
            step: i + 1,
            tool: step.tool,
            ok: true
          }
        });
      }
    } catch (e) {
      if (spinner) spinner.stop();
      const msg = e?.message || String(e);
      if (!options.json) console.log(chalk.red(`✘ ${stepLabel}: ${msg}`));
      results.push({ step: i + 1, tool: step.tool, ok: false, error: msg });

      if (memoryEnabled) {
        await appendScopeMemory(scope, {
          timestamp: toIsoNow(),
          type: 'status',
          content: {
            step: i + 1,
            tool: step.tool,
            ok: false,
            error: msg
          }
        });
      }

      // Fail-fast: agent should not keep making changes after an error.
      break;
    }
  }

  return results;
}

async function runAgent({ intent, options }) {
  let currentIntent = intent;
  const tools = getToolRegistry();
  const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const scope = await pickScopeOrAsk({ intent: currentIntent, forcedScope: options.scope });
  const memoryEnabled = options.memory !== false;

  const usedMemory = memoryEnabled && listScopes().includes(scope);
  const summary = memoryEnabled ? loadScopeSummary(scope) : '';
  const staleDays = memoryEnabled ? getMemoryStalenessDays(scope) : null;

  const llmProvider = options.provider || 'openai';
  const llmModel = options.model || '';

  let plan = null;
  const spinner = (!options.json && process.stdout.isTTY) ? ora('Planning...').start() : null;
  try {
    plan = await planWithLLM({
      provider: llmProvider,
      model: llmModel,
      intent: currentIntent,
      scope,
      tools,
      memorySummary: options.memory === false ? '' : summary
    });
    if (spinner) spinner.stop();
  } catch (e) {
    if (spinner) spinner.stop();
    throw new Error(`AI planning failed: ${e?.message || String(e)}`);
  }

  // Validate: strict tool registry.
  const validation = validatePlanSteps(plan.steps || [], toolsByName);
  if (validation.invalid.length) {
    if (!options.json) {
      console.log(chalk.yellow('\n! Plan contained unknown tools and was sanitized.'));
      validation.invalid.forEach((x) => console.log(chalk.yellow(`  - ${x.tool}`)));
      console.log('');
    }
    plan.steps = validation.valid;
  }

  // Track decisions/status in memory (never secrets).
  if (memoryEnabled) {
    await appendScopeMemory(scope, {
      timestamp: toIsoNow(),
      type: 'decision',
      content: {
        intent: currentIntent,
        risk: plan.risk,
        steps: (plan.steps || []).map((s) => ({ tool: s.tool, args: sanitizeForLog(s.args || {}), why: s.why || '' }))
      }
    });
  }

  if (options.json) {
    const out = {
      scope,
      risk: plan.risk,
      usedMemory,
      staleDays,
      plan: {
        intent: currentIntent,
        steps: plan.steps || []
      }
    };
    if (options.planOnly) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
  } else {
    printPlanMarkdown({
      scope,
      staleDays,
      usedMemory,
      planMarkdown: plan.markdown,
      risk: plan.risk
    });
  }

  if (options.planOnly) return;

  if (!process.stdout.isTTY && !options.yes) {
    throw new Error('Refusing to execute without TTY. Re-run with --yes or use --plan-only.');
  }

  while (true) {
    const choice = options.yes ? 'y' : await confirmProceed();
    if (choice === 'n') return;
    if (choice === 'edit') {
      const edited = await editPlanFlow({ intent: currentIntent, plan });
      if (edited.cancelled) return;
      if (edited.plan) {
        plan = edited.plan;
        if (!options.json) {
          printPlanMarkdown({
            scope,
            staleDays,
            usedMemory,
            planMarkdown: plan.markdown || '(custom plan)',
            risk: plan.risk || 'low'
          });
        }
        continue;
      }

      // Re-plan with updated intent.
      currentIntent = edited.intent;
      const reSpinner = (!options.json && process.stdout.isTTY) ? ora('Re-planning...').start() : null;
      try {
        plan = await planWithLLM({
          provider: llmProvider,
          model: llmModel,
          intent: currentIntent,
          scope,
          tools,
          memorySummary: options.memory === false ? '' : summary
        });
        if (reSpinner) reSpinner.stop();
      } catch (e) {
        if (reSpinner) reSpinner.stop();
        throw new Error(`AI re-planning failed: ${e?.message || String(e)}`);
      }
      continue;
    }

    // Execute
    const execResults = await executePlan({
      scope,
      toolsByName,
      steps: plan.steps || [],
      options,
      memoryEnabled
    });

    if (options.json) {
      console.log(JSON.stringify({ scope, risk: plan.risk, results: execResults }, null, 2));
    } else {
      console.log('');
      console.log(chalk.bold('Run Complete'));
      const okCount = execResults.filter((r) => r.ok).length;
      console.log(chalk.gray(`  ${okCount}/${execResults.length} steps succeeded`));
      console.log('');
    }

    if (memoryEnabled) {
      await appendScopeMemory(scope, {
        timestamp: toIsoNow(),
        type: 'status',
        content: {
          run: 'complete',
          ok: execResults.every((r) => r.ok)
        }
      });
    }

    return;
  }
}

const memoryCommands = {
  async list({ json }) {
    const scopes = listScopes();
    if (json) {
      console.log(JSON.stringify({ scopes }, null, 2));
      return;
    }
    if (!scopes.length) {
      console.log(chalk.gray('\n(no memory scopes found)\n'));
      return;
    }
    console.log(chalk.bold('\nAgent Memory Scopes:'));
    scopes.forEach((s) => console.log('  - ' + chalk.cyan(s)));
    console.log('');
  },

  async show({ scope, json, limit }) {
    const safe = sanitizeScope(scope);
    const summary = loadScopeSummary(safe);
    const mem = loadScopeMemory(safe);
    const recent = mem.slice(Math.max(0, mem.length - (limit || 20)));
    if (json) {
      console.log(JSON.stringify({ scope: safe, summary, recent }, null, 2));
      return;
    }
    console.log(chalk.bold(`\nScope: ${safe}`));
    if (summary) {
      console.log(chalk.gray('\nSummary:\n'));
      console.log(summary.trimEnd());
      console.log('');
    }
    if (!recent.length) {
      console.log(chalk.gray('(no entries)\n'));
      return;
    }
    console.log(chalk.bold('Recent Entries:'));
    recent.forEach((e) => {
      console.log(chalk.gray(`- ${e.timestamp} [${e.type}]`));
      const content = typeof e.content === 'string' ? e.content : JSON.stringify(sanitizeForLog(e.content), null, 2);
      console.log(chalk.gray(content.split('\n').map((l) => '  ' + l).join('\n')));
    });
    console.log('');
  },

  async forget({ scope }) {
    await forgetScope(scope);
    console.log(chalk.green(`OK Forgot scope: ${sanitizeScope(scope)}`));
    console.log('');
  },

  async clear() {
    await clearAllScopes();
    console.log(chalk.green('OK Cleared all agent memory'));
    console.log('');
  }
};

module.exports = {
  runAgent,
  memoryCommands
};
