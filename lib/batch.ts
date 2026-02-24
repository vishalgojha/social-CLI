const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { csvToObjects } = require('./csv');
const { formatTable } = require('./formatters');
const configSingleton = require('./config');
const { getToolRegistry } = require('../tools/registry');

function readFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Handle UTF-8 BOM (common on Windows when generating files).
  return raw.replace(/^\uFEFF/, '');
}

function parseJsonJobs(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.jobs)) return parsed.jobs;
  throw new Error('JSON must be an array of jobs or an object with "jobs": []');
}

function parseCsvJobs(raw) {
  const objs = csvToObjects(raw);
  return objs.map((o) => {
    const job = { ...o };
    return job;
  });
}

function normalizeJobs(jobs) {
  return (jobs || []).map((j, idx) => {
    if (!j || typeof j !== 'object') throw new Error(`Invalid job at index ${idx}`);
    const tool = j.tool || j.Tool || j.TOOL;
    if (!tool) throw new Error(`Missing tool for job at index ${idx}`);
    const profile = j.profile || j.Profile || j.PROFILE || '';

    let args = {};
    if (j.args) {
      if (typeof j.args === 'string') {
        args = JSON.parse(j.args);
      } else if (typeof j.args === 'object') {
        args = { ...j.args };
      }
    } else {
      // CSV-style: take all fields except tool/profile as args.
      Object.keys(j).forEach((k) => {
        if (k === 'tool' || k === 'Tool' || k === 'TOOL') return;
        if (k === 'profile' || k === 'Profile' || k === 'PROFILE') return;
        if (k === 'args') return;
        if (j[k] === undefined || j[k] === null || j[k] === '') return;
        args[k] = j[k];
      });
      if (j.args && typeof j.args === 'string') {
        args = { ...args, ...JSON.parse(j.args) };
      }
    }

    return {
      id: j.id || j.jobId || String(idx + 1),
      tool: String(tool).trim(),
      profile: String(profile || '').trim(),
      args
    };
  });
}

async function runWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= items.length) return;
      // eslint-disable-next-line no-await-in-loop
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = [];
  const c = Math.max(1, Math.min(concurrency, items.length || 1));
  for (let i = 0; i < c; i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function getConfigForJob(profile) {
  const { ConfigManager } = configSingleton;
  const cfg = new ConfigManager();
  if (profile) cfg.useProfile(profile);
  return cfg;
}

async function runBatch({ filePath, concurrency = 3, yes = false, dryRun = false, verbose = false, json = false, profile = '' }) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);

  const raw = readFile(abs);
  const ext = path.extname(abs).toLowerCase();

  let jobs;
  if (ext === '.json') jobs = parseJsonJobs(raw);
  else if (ext === '.csv') jobs = parseCsvJobs(raw);
  else throw new Error('Unsupported batch file. Use .json or .csv');

  const normalized = normalizeJobs(jobs);
  const registry = getToolRegistry();
  const toolsByName = Object.fromEntries(registry.map((t) => [t.name, t]));

  const startedAt = new Date().toISOString();

  const results = await runWithConcurrency(normalized, concurrency, async (job) => {
    const tool = toolsByName[job.tool];
    const jobProfile = job.profile || profile || '';

    if (!tool) {
      return { id: job.id, tool: job.tool, profile: jobProfile, ok: false, error: 'Unknown tool' };
    }

    if (tool.risk === 'high' && !yes) {
      return { id: job.id, tool: job.tool, profile: jobProfile, ok: false, skipped: true, error: 'High-risk tool requires --yes' };
    }

    const cfg = getConfigForJob(jobProfile);
    const ctx = {
      config: cfg,
      options: { dryRun, verbose },
      scope: jobProfile || cfg.getActiveProfile(),
      sanitizeForLog: require('./api').sanitizeForLog // eslint-disable-line global-require
    };

    try {
      const output = await tool.execute(ctx, job.args || {});
      return { id: job.id, tool: job.tool, profile: jobProfile || cfg.getActiveProfile(), ok: true, output };
    } catch (e) {
      return { id: job.id, tool: job.tool, profile: jobProfile || cfg.getActiveProfile(), ok: false, error: e?.message || String(e) };
    }
  });

  const finishedAt = new Date().toISOString();

  if (json) {
    return { startedAt, finishedAt, file: abs, results };
  }

  const rows = results.map((r) => ({
    id: r.id,
    profile: r.profile || '',
    tool: r.tool,
    ok: r.ok ? 'true' : 'false',
    skipped: r.skipped ? 'true' : ''
  }));

  console.log(chalk.bold('\nBatch Results:'));
  console.log(formatTable(rows, ['id', 'profile', 'tool', 'ok', 'skipped']));
  console.log('');

  const failed = results.filter((r) => !r.ok && !r.skipped);
  if (failed.length) {
    console.log(chalk.red('Failures:'));
    failed.slice(0, 20).forEach((f) => {
      console.log(chalk.red(`- [${f.id}] ${f.tool} (${f.profile || 'default'}): ${f.error}`));
    });
    console.log('');
  }

  return { startedAt, finishedAt, file: abs, results };
}

module.exports = {
  runBatch
};
