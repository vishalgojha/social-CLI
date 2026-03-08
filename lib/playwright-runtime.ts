// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const appPaths = require('./app-paths');
const storage = require('./hosted/storage');

let PLAYWRIGHT_INSTANCE = null;

function browserInstallCommandText() {
  return 'npx playwright install chromium';
}

function browserDriverMissingError(cause = null, details = {}) {
  const reason = String(details.reason || '').trim();
  const message = reason
    ? `Playwright Chromium runtime unavailable. ${reason}. Fix: rerun social setup or ${browserInstallCommandText()}`
    : `Playwright Chromium runtime unavailable. Fix: rerun social setup or ${browserInstallCommandText()}`;
  const error = new Error(message);
  error.code = 'BROWSER_DRIVER_MISSING';
  error.status = 503;
  if (cause) error.cause = cause;
  if (details.stdout) error.stdout = String(details.stdout);
  if (details.stderr) error.stderr = String(details.stderr);
  return error;
}

function chromiumExecutablePath(playwright) {
  try {
    return String(playwright?.chromium?.executablePath?.() || '').trim();
  } catch {
    return '';
  }
}

function chromiumExecutableExists(playwright, existsSyncImpl = fs.existsSync) {
  const executablePath = chromiumExecutablePath(playwright);
  return Boolean(executablePath && existsSyncImpl(executablePath));
}

function extractPlaywrightExport(loaded) {
  if (loaded && loaded.chromium && typeof loaded.chromium.launch === 'function') return loaded;
  if (loaded && loaded.default && loaded.default.chromium && typeof loaded.default.chromium.launch === 'function') {
    return loaded.default;
  }
  return null;
}

function loadPlaywrightPackage(options = {}) {
  if (PLAYWRIGHT_INSTANCE && !options.forceReload) return PLAYWRIGHT_INSTANCE;

  const candidates = Array.isArray(options.candidates) && options.candidates.length
    ? options.candidates
    : ['playwright', 'playwright-core'];
  let lastError = null;

  for (let i = 0; i < candidates.length; i += 1) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded = require(candidates[i]);
      const resolved = extractPlaywrightExport(loaded);
      if (resolved) {
        PLAYWRIGHT_INSTANCE = resolved;
        return PLAYWRIGHT_INSTANCE;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw browserDriverMissingError(lastError, { reason: 'Playwright package could not be loaded' });
}

function resolveInstallLockPath(env = process.env) {
  const home = appPaths.ensureAppHome(env);
  return path.join(home, 'locks', 'playwright-chromium.lock');
}

function resolvePlaywrightCliCommand(options = {}) {
  const existsSyncImpl = options.existsSync || fs.existsSync;
  const resolveFn = options.requireResolve || require.resolve;
  const repoRoot = path.resolve(__dirname, '..');
  const cliCandidates = ['playwright/cli', 'playwright/cli.js'];

  for (let i = 0; i < cliCandidates.length; i += 1) {
    try {
      const cliPath = resolveFn(cliCandidates[i]);
      if (cliPath && existsSyncImpl(cliPath)) {
        return {
          command: process.execPath,
          args: [cliPath, 'install', 'chromium'],
          cwd: repoRoot
        };
      }
    } catch {
      // try next candidate
    }
  }

  const fallbackCli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');
  if (existsSyncImpl(fallbackCli)) {
    return {
      command: process.execPath,
      args: [fallbackCli, 'install', 'chromium'],
      cwd: repoRoot
    };
  }

  throw browserDriverMissingError(null, { reason: 'Playwright CLI was not found' });
}

async function ensurePlaywrightChromium(options = {}) {
  const env = options.env || process.env;
  const existsSyncImpl = options.existsSync || fs.existsSync;
  const spawnSyncImpl = options.spawnSync || spawnSync;
  const loadFn = options.loadPlaywright || loadPlaywrightPackage;
  const withLock = options.withFileLock || storage.withFileLock;
  const stdio = options.stdio || 'pipe';
  const lockPath = String(options.lockPath || resolveInstallLockPath(env));
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs || 10 * 60_000));
  const staleMs = Math.max(30_000, Number(options.staleMs || 15 * 60_000));
  const force = Boolean(options.force);

  let playwright = loadFn(options);
  let executablePath = chromiumExecutablePath(playwright);
  if (!force && chromiumExecutableExists(playwright, existsSyncImpl)) {
    return {
      ok: true,
      installed: false,
      executablePath,
      command: browserInstallCommandText()
    };
  }

  return withLock(lockPath, async () => {
    playwright = loadFn(options);
    executablePath = chromiumExecutablePath(playwright);
    if (!force && chromiumExecutableExists(playwright, existsSyncImpl)) {
      return {
        ok: true,
        installed: false,
        executablePath,
        command: browserInstallCommandText()
      };
    }

    const cli = (options.resolveCliCommand || resolvePlaywrightCliCommand)(options);
    const result = spawnSyncImpl(cli.command, cli.args, {
      cwd: cli.cwd,
      env,
      stdio,
      encoding: 'utf8',
      maxBuffer: Number(options.maxBuffer || 32 * 1024 * 1024)
    });

    if (result.error) {
      throw browserDriverMissingError(result.error, {
        reason: 'Automatic Chromium install failed to start',
        stdout: result.stdout,
        stderr: result.stderr
      });
    }
    if (Number(result.status || 0) !== 0) {
      throw browserDriverMissingError(null, {
        reason: `Automatic Chromium install exited with code ${result.status}`,
        stdout: result.stdout,
        stderr: result.stderr
      });
    }

    playwright = loadFn({ ...options, forceReload: true });
    executablePath = chromiumExecutablePath(playwright);
    if (!executablePath || !existsSyncImpl(executablePath)) {
      throw browserDriverMissingError(null, {
        reason: 'Chromium install completed but no executable was found',
        stdout: result.stdout,
        stderr: result.stderr
      });
    }

    return {
      ok: true,
      installed: true,
      executablePath,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      command: `${cli.command} ${cli.args.join(' ')}`
    };
  }, {
    timeoutMs,
    staleMs,
    pollMs: Math.max(50, Number(options.pollMs || 125))
  });
}

async function loadPlaywrightOrThrow(options = {}) {
  const existsSyncImpl = options.existsSync || fs.existsSync;
  const playwright = (options.loadPlaywright || loadPlaywrightPackage)(options);
  if (chromiumExecutableExists(playwright, existsSyncImpl)) return playwright;
  if (options.autoInstall === false) {
    throw browserDriverMissingError(null, { reason: 'Chromium executable is not installed' });
  }

  await ensurePlaywrightChromium(options);
  const reloaded = (options.loadPlaywright || loadPlaywrightPackage)({ ...options, forceReload: true });
  if (chromiumExecutableExists(reloaded, existsSyncImpl)) return reloaded;
  throw browserDriverMissingError(null, { reason: 'Chromium executable is not installed' });
}

function getPlaywrightRuntimeStatus(options = {}) {
  const existsSyncImpl = options.existsSync || fs.existsSync;
  try {
    const playwright = (options.loadPlaywright || loadPlaywrightPackage)(options);
    const executablePath = chromiumExecutablePath(playwright);
    const chromiumInstalled = Boolean(executablePath && existsSyncImpl(executablePath));
    return {
      packageInstalled: true,
      chromiumInstalled,
      executablePath: chromiumInstalled ? executablePath : '',
      installCommand: browserInstallCommandText()
    };
  } catch (error) {
    return {
      packageInstalled: false,
      chromiumInstalled: false,
      executablePath: '',
      installCommand: browserInstallCommandText(),
      error: String(error && error.message ? error.message : error)
    };
  }
}

const _private = {
  browserInstallCommandText,
  chromiumExecutablePath,
  chromiumExecutableExists,
  extractPlaywrightExport,
  loadPlaywrightPackage,
  resolveInstallLockPath,
  resolvePlaywrightCliCommand,
  browserDriverMissingError
};

module.exports = {
  browserInstallCommandText,
  browserDriverMissingError,
  ensurePlaywrightChromium,
  loadPlaywrightOrThrow,
  getPlaywrightRuntimeStatus,
  _private
};
