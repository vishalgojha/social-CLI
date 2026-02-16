const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { cloneBuiltinCatalog } = require('./catalog');

let cachedHubRoot = '';
let cachedHubHome = '';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function homeRoot() {
  if (process.env.SOCIAL_CLI_HOME) return path.resolve(process.env.SOCIAL_CLI_HOME);
  if (process.env.META_CLI_HOME) return path.resolve(process.env.META_CLI_HOME);
  return os.homedir();
}

function hubRoot() {
  const home = homeRoot();
  if (cachedHubRoot && cachedHubHome === home) return cachedHubRoot;
  const candidates = [
    path.join(home, '.social-cli', 'hub'),
    path.join(home, '.meta-cli', 'hub'),
    path.join(process.cwd(), '.social-cli-hub')
  ];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      ensureDir(candidate);
      cachedHubRoot = candidate;
      cachedHubHome = home;
      return cachedHubRoot;
    } catch {
      // try next location
    }
  }

  throw new Error('Unable to initialize hub storage directory.');
}

function resetCacheForTests() {
  cachedHubRoot = '';
  cachedHubHome = '';
}

function catalogPath() {
  return path.join(hubRoot(), 'catalog.json');
}

function lockPath() {
  return path.join(hubRoot(), 'installed.json');
}

function manifestDir() {
  const dir = path.join(hubRoot(), 'installed');
  ensureDir(dir);
  return dir;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sanitizeId(id) {
  return String(id || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

function parseSemver(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

function normalizeVersion(row) {
  if (!row || typeof row !== 'object') return null;
  const version = String(row.version || '').trim();
  if (!version) return null;
  return {
    version,
    publishedAt: String(row.publishedAt || ''),
    changelog: String(row.changelog || ''),
    manifest: row.manifest && typeof row.manifest === 'object' ? row.manifest : {}
  };
}

function normalizePackage(row) {
  if (!row || typeof row !== 'object') return null;
  const id = sanitizeId(row.id);
  if (!id) return null;
  const versions = Array.isArray(row.versions)
    ? row.versions.map(normalizeVersion).filter(Boolean)
    : [];
  versions.sort((a, b) => compareSemver(b.version, a.version));
  return {
    id,
    name: String(row.name || id),
    type: String(row.type || 'package').toLowerCase(),
    description: String(row.description || ''),
    tags: Array.isArray(row.tags)
      ? row.tags.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
      : [],
    versions
  };
}

function normalizeCatalog(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return items.map(normalizePackage).filter(Boolean);
}

function loadCatalog() {
  const custom = readJson(catalogPath(), null);
  if (Array.isArray(custom)) {
    const normalized = normalizeCatalog(custom);
    if (normalized.length) return normalized;
  }
  return normalizeCatalog(cloneBuiltinCatalog());
}

function loadInstalled() {
  const raw = readJson(lockPath(), { packages: {} });
  if (!raw || typeof raw !== 'object') return { packages: {} };
  const packages = raw.packages && typeof raw.packages === 'object' ? raw.packages : {};
  return { packages };
}

function saveInstalled(data) {
  const safe = data && typeof data === 'object' ? data : { packages: {} };
  writeJsonAtomic(lockPath(), safe);
}

function parseSpec(spec) {
  const raw = String(spec || '').trim();
  const match = raw.match(/^([^@]+?)(?:@([^@]+))?$/);
  if (!match) return { id: '', version: '' };
  return {
    id: sanitizeId(match[1]),
    version: String(match[2] || '').trim()
  };
}

function latestVersion(pkg) {
  if (!pkg || !Array.isArray(pkg.versions) || !pkg.versions.length) return null;
  return pkg.versions[0];
}

function resolvePackage(spec) {
  const parsed = parseSpec(spec);
  if (!parsed.id) {
    throw new Error('Invalid package spec. Use <id> or <id>@<version>.');
  }

  const catalog = loadCatalog();
  const pkg = catalog.find((x) => x.id === parsed.id);
  if (!pkg) {
    throw new Error(`Package not found: ${parsed.id}`);
  }

  const versionRow = parsed.version
    ? pkg.versions.find((v) => v.version === parsed.version)
    : latestVersion(pkg);
  if (!versionRow) {
    throw new Error(`Version not found for ${pkg.id}: ${parsed.version}`);
  }

  return {
    parsed,
    pkg,
    versionRow
  };
}

function manifestHash(pkgId, version, manifest) {
  return crypto
    .createHash('sha256')
    .update(`${pkgId}@${version}:${JSON.stringify(manifest || {})}`, 'utf8')
    .digest('hex');
}

function installPackage(spec) {
  const resolved = resolvePackage(spec);
  const lock = loadInstalled();
  const now = new Date().toISOString();
  const hash = manifestHash(resolved.pkg.id, resolved.versionRow.version, resolved.versionRow.manifest);

  const previous = lock.packages[resolved.pkg.id] || null;
  const next = {
    id: resolved.pkg.id,
    name: resolved.pkg.name,
    type: resolved.pkg.type,
    version: resolved.versionRow.version,
    manifestHash: hash,
    installedAt: now
  };

  lock.packages[resolved.pkg.id] = next;
  saveInstalled(lock);

  const manifestPath = path.join(manifestDir(), `${sanitizeId(resolved.pkg.id)}.json`);
  writeJsonAtomic(manifestPath, {
    id: resolved.pkg.id,
    version: resolved.versionRow.version,
    manifest: resolved.versionRow.manifest,
    installedAt: now
  });

  return {
    status: previous ? (previous.version === next.version ? 'already-installed' : 'updated') : 'installed',
    package: resolved.pkg,
    version: resolved.versionRow,
    lock: next
  };
}

function updatePackage(id) {
  const lock = loadInstalled();
  const target = sanitizeId(id);
  const installed = lock.packages[target];
  if (!installed) {
    throw new Error(`Package not installed: ${target}`);
  }
  return installPackage(target);
}

function updateAll() {
  const lock = loadInstalled();
  const ids = Object.keys(lock.packages || {});
  return ids.map((id) => updatePackage(id));
}

function listInstalled() {
  const lock = loadInstalled();
  return Object.values(lock.packages || {})
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
}

function searchCatalog({ query = '', tag = '', type = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const wantedTag = String(tag || '').trim().toLowerCase();
  const wantedType = String(type || '').trim().toLowerCase();
  const rows = loadCatalog();

  return rows.filter((row) => {
    if (wantedType && row.type !== wantedType) return false;
    if (wantedTag && !row.tags.includes(wantedTag)) return false;
    if (!q) return true;
    const hay = `${row.id} ${row.name} ${row.description} ${(row.tags || []).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

function inspectPackage(spec) {
  const resolved = resolvePackage(spec);
  return {
    id: resolved.pkg.id,
    name: resolved.pkg.name,
    type: resolved.pkg.type,
    description: resolved.pkg.description,
    tags: resolved.pkg.tags,
    versions: resolved.pkg.versions,
    selectedVersion: resolved.versionRow
  };
}

module.exports = {
  hubRoot,
  catalogPath,
  lockPath,
  loadCatalog,
  loadInstalled,
  listInstalled,
  searchCatalog,
  inspectPackage,
  installPackage,
  updatePackage,
  updateAll,
  parseSpec,
  compareSemver,
  resetCacheForTests
};
