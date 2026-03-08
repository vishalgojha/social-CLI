// @ts-nocheck
const fs = require('fs');
const os = require('os');
const path = require('path');

const CURRENT_APP_DIRNAME = '.social-flow';
const LEGACY_APP_DIRNAMES = ['.social-cli', '.meta-cli'];
const HOME_ENV_KEYS = ['SOCIAL_FLOW_HOME', 'SOCIAL_CLI_HOME', 'META_CLI_HOME'];

function resolvePath(input) {
  const raw = String(input || '').trim();
  return raw ? path.resolve(raw) : '';
}

function uniquePaths(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach((item) => {
    const resolved = resolvePath(item);
    if (!resolved) return;
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolved);
  });
  return out;
}

function legacyHomeRoot(env = process.env, homeDir = os.homedir()) {
  const social = resolvePath(env.SOCIAL_CLI_HOME);
  if (social) return social;
  const meta = resolvePath(env.META_CLI_HOME);
  if (meta) return meta;
  return resolvePath(homeDir) || os.homedir();
}

function explicitAppHome(env = process.env) {
  return resolvePath(env.SOCIAL_FLOW_HOME);
}

function resolveAppHome(env = process.env, homeDir = os.homedir()) {
  const explicit = explicitAppHome(env);
  if (explicit) return explicit;
  return path.join(legacyHomeRoot(env, homeDir), CURRENT_APP_DIRNAME);
}

function legacyAppHomes(env = process.env, homeDir = os.homedir()) {
  const current = resolveAppHome(env, homeDir);
  const parent = path.dirname(current);
  const explicitLegacyRoots = [];
  const socialRoot = resolvePath(env.SOCIAL_CLI_HOME);
  if (socialRoot) explicitLegacyRoots.push(path.join(socialRoot, '.social-cli'));
  const metaRoot = resolvePath(env.META_CLI_HOME);
  if (metaRoot) explicitLegacyRoots.push(path.join(metaRoot, '.meta-cli'));
  return uniquePaths([
    ...LEGACY_APP_DIRNAMES.map((name) => path.join(parent, name)),
    ...explicitLegacyRoots
  ]).filter((item) => item !== current);
}

function pathExists(target, fsImpl = fs) {
  try {
    return fsImpl.existsSync(target);
  } catch {
    return false;
  }
}

function isDirectory(target, fsImpl = fs) {
  try {
    return fsImpl.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function ensureDir(target, fsImpl = fs) {
  const resolved = resolvePath(target);
  if (!resolved) return '';
  if (!pathExists(resolved, fsImpl)) {
    fsImpl.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function copyRecursive(source, destination, fsImpl = fs) {
  if (typeof fsImpl.cpSync === 'function') {
    fsImpl.cpSync(source, destination, { recursive: true, force: false, errorOnExist: false });
    return true;
  }

  if (!isDirectory(source, fsImpl)) {
    fsImpl.copyFileSync(source, destination);
    return true;
  }

  ensureDir(destination, fsImpl);
  fsImpl.readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to, fsImpl);
      return;
    }
    fsImpl.copyFileSync(from, to);
  });
  return true;
}

function migrateLegacyAppHome(env = process.env, homeDir = os.homedir(), fsImpl = fs) {
  const current = resolveAppHome(env, homeDir);
  if (pathExists(current, fsImpl)) return current;

  const legacy = legacyAppHomes(env, homeDir).find((candidate) => pathExists(candidate, fsImpl));
  if (!legacy) return current;

  try {
    ensureDir(path.dirname(current), fsImpl);
  } catch {
    return current;
  }

  if (pathExists(current, fsImpl)) return current;

  try {
    fsImpl.renameSync(legacy, current);
    return current;
  } catch {
    try {
      copyRecursive(legacy, current, fsImpl);
      return current;
    } catch {
      return current;
    }
  }
}

function ensureAppHome(env = process.env, homeDir = os.homedir(), fsImpl = fs) {
  const current = migrateLegacyAppHome(env, homeDir, fsImpl);
  return ensureDir(current, fsImpl);
}

function appPath(...segments) {
  return path.join(ensureAppHome(), ...segments);
}

function candidateAppHomes(env = process.env, homeDir = os.homedir()) {
  return uniquePaths([migrateLegacyAppHome(env, homeDir), ...legacyAppHomes(env, homeDir)]);
}

function candidatePaths(segments = [], env = process.env, homeDir = os.homedir()) {
  const parts = Array.isArray(segments) ? segments : [segments];
  return candidateAppHomes(env, homeDir).map((root) => path.join(root, ...parts));
}

module.exports = {
  CURRENT_APP_DIRNAME,
  LEGACY_APP_DIRNAMES,
  HOME_ENV_KEYS,
  resolveAppHome,
  legacyHomeRoot,
  legacyAppHomes,
  migrateLegacyAppHome,
  ensureAppHome,
  appPath,
  candidateAppHomes,
  candidatePaths,
  uniquePaths
};
