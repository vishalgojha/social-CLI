const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { cloneBuiltinCatalog } = require('./catalog');

const TRUST_POLICY_DEFAULT = {
  mode: 'warn',
  requireSigned: false,
  allowedPublishers: [],
  blockedPublishers: [],
  trustedKeys: {}
};

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

function trustPath() {
  return path.join(hubRoot(), 'trust-policy.json');
}

function sourceMetaPath() {
  return path.join(hubRoot(), 'sources.json');
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

function uniqStrings(rows) {
  const seen = new Set();
  const out = [];
  (rows || []).forEach((row) => {
    const v = String(row || '').trim();
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableStringify(x)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

function manifestHash(pkgId, version, manifest) {
  const canonical = stableStringify(manifest && typeof manifest === 'object' ? manifest : {});
  return crypto
    .createHash('sha256')
    .update(`${pkgId}@${version}:${canonical}`, 'utf8')
    .digest('hex');
}

function signaturePayload(pkgId, version, digest, publisher) {
  return `${pkgId}@${version}:${digest}:${sanitizeId(publisher || '')}`;
}

function signPayload(payload, privateKeyPem) {
  const sig = crypto.sign('sha256', Buffer.from(payload, 'utf8'), privateKeyPem);
  return sig.toString('base64');
}

function verifyPayloadSignature(payload, signature, publicKeyPem) {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(payload, 'utf8'),
      publicKeyPem,
      Buffer.from(String(signature || ''), 'base64')
    );
  } catch {
    return false;
  }
}

function normalizeVersion(row, pkgId = '') {
  if (!row || typeof row !== 'object') return null;
  const version = String(row.version || '').trim();
  if (!version) return null;
  const manifest = row.manifest && typeof row.manifest === 'object' ? row.manifest : {};
  const digest = String(row.manifestHash || '').trim() || manifestHash(pkgId, version, manifest);
  return {
    version,
    publishedAt: String(row.publishedAt || ''),
    changelog: String(row.changelog || ''),
    publisher: sanitizeId(row.publisher || ''),
    manifest,
    manifestHash: digest,
    signature: String(row.signature || '').trim()
  };
}

function normalizePackage(row) {
  if (!row || typeof row !== 'object') return null;
  const id = sanitizeId(row.id);
  if (!id) return null;
  const versions = Array.isArray(row.versions)
    ? row.versions.map((x) => normalizeVersion(x, id)).filter(Boolean)
    : [];
  versions.sort((a, b) => compareSemver(b.version, a.version));
  return {
    id,
    name: String(row.name || id),
    type: String(row.type || 'package').toLowerCase(),
    description: String(row.description || ''),
    tags: uniqStrings(Array.isArray(row.tags)
      ? row.tags.map((x) => String(x || '').trim().toLowerCase())
      : []),
    versions
  };
}

function normalizeCatalog(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return items.map(normalizePackage).filter(Boolean);
}

function catalogFromAny(value) {
  if (Array.isArray(value)) return normalizeCatalog(value);
  if (value && typeof value === 'object' && Array.isArray(value.packages)) {
    return normalizeCatalog(value.packages);
  }
  return [];
}

function loadCatalog() {
  const custom = readJson(catalogPath(), null);
  const fromCustom = catalogFromAny(custom);
  if (fromCustom.length) return fromCustom;
  return normalizeCatalog(cloneBuiltinCatalog());
}

function saveCatalog(rows) {
  writeJsonAtomic(catalogPath(), normalizeCatalog(rows));
}

function mergeCatalog(baseRows, incomingRows) {
  const map = new Map();
  normalizeCatalog(baseRows).forEach((pkg) => {
    map.set(pkg.id, JSON.parse(JSON.stringify(pkg)));
  });

  normalizeCatalog(incomingRows).forEach((incoming) => {
    const existing = map.get(incoming.id);
    if (!existing) {
      map.set(incoming.id, JSON.parse(JSON.stringify(incoming)));
      return;
    }
    existing.name = incoming.name || existing.name;
    existing.type = incoming.type || existing.type;
    existing.description = incoming.description || existing.description;
    existing.tags = uniqStrings([...(existing.tags || []), ...(incoming.tags || [])]);

    const verMap = new Map();
    (existing.versions || []).forEach((v) => verMap.set(v.version, v));
    (incoming.versions || []).forEach((v) => verMap.set(v.version, v));
    existing.versions = [...verMap.values()].sort((a, b) => compareSemver(b.version, a.version));
    map.set(existing.id, existing);
  });

  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
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

function normalizeTrustPolicy(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const mode = String(src.mode || 'warn').trim().toLowerCase() === 'enforce' ? 'enforce' : 'warn';
  const trustedKeys = {};
  if (src.trustedKeys && typeof src.trustedKeys === 'object') {
    Object.keys(src.trustedKeys).forEach((key) => {
      const id = sanitizeId(key);
      const pem = String(src.trustedKeys[key] || '').trim();
      if (!id || !pem) return;
      trustedKeys[id] = pem;
    });
  }
  return {
    mode,
    requireSigned: Boolean(src.requireSigned),
    allowedPublishers: uniqStrings((src.allowedPublishers || []).map((x) => sanitizeId(x))),
    blockedPublishers: uniqStrings((src.blockedPublishers || []).map((x) => sanitizeId(x))),
    trustedKeys
  };
}

function loadTrustPolicy() {
  return normalizeTrustPolicy(readJson(trustPath(), TRUST_POLICY_DEFAULT));
}

function saveTrustPolicy(policy) {
  const normalized = normalizeTrustPolicy(policy);
  writeJsonAtomic(trustPath(), normalized);
  return normalized;
}

function setTrustPolicy(patch = {}) {
  const current = loadTrustPolicy();
  const src = patch && typeof patch === 'object' ? patch : {};
  const next = {
    ...current,
    mode: src.mode !== undefined ? String(src.mode).trim().toLowerCase() : current.mode,
    requireSigned: src.requireSigned !== undefined ? Boolean(src.requireSigned) : current.requireSigned,
    allowedPublishers: src.allowedPublishers !== undefined
      ? uniqStrings((src.allowedPublishers || []).map((x) => sanitizeId(x)))
      : current.allowedPublishers,
    blockedPublishers: src.blockedPublishers !== undefined
      ? uniqStrings((src.blockedPublishers || []).map((x) => sanitizeId(x)))
      : current.blockedPublishers,
    trustedKeys: {
      ...(current.trustedKeys || {}),
      ...(src.trustedKeys && typeof src.trustedKeys === 'object' ? src.trustedKeys : {})
    }
  };
  return saveTrustPolicy(next);
}

function allowPublisher(publisher) {
  const id = sanitizeId(publisher);
  if (!id) throw new Error('Invalid publisher id.');
  const current = loadTrustPolicy();
  current.allowedPublishers = uniqStrings([...(current.allowedPublishers || []), id]);
  current.blockedPublishers = (current.blockedPublishers || []).filter((x) => x !== id);
  return saveTrustPolicy(current);
}

function blockPublisher(publisher) {
  const id = sanitizeId(publisher);
  if (!id) throw new Error('Invalid publisher id.');
  const current = loadTrustPolicy();
  current.blockedPublishers = uniqStrings([...(current.blockedPublishers || []), id]);
  current.allowedPublishers = (current.allowedPublishers || []).filter((x) => x !== id);
  return saveTrustPolicy(current);
}

function setTrustedKey(publisher, pem) {
  const id = sanitizeId(publisher);
  const value = String(pem || '').trim();
  if (!id) throw new Error('Invalid publisher id.');
  if (!value) throw new Error('Trusted key cannot be empty.');
  const current = loadTrustPolicy();
  current.trustedKeys = current.trustedKeys || {};
  current.trustedKeys[id] = value;
  return saveTrustPolicy(current);
}

function removeTrustedKey(publisher) {
  const id = sanitizeId(publisher);
  if (!id) throw new Error('Invalid publisher id.');
  const current = loadTrustPolicy();
  current.trustedKeys = current.trustedKeys || {};
  delete current.trustedKeys[id];
  return saveTrustPolicy(current);
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

function resolvePackage(spec, catalogRows = null) {
  const parsed = parseSpec(spec);
  if (!parsed.id) {
    throw new Error('Invalid package spec. Use <id> or <id>@<version>.');
  }

  const catalog = Array.isArray(catalogRows) ? normalizeCatalog(catalogRows) : loadCatalog();
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

function assessTrust(pkg, versionRow, policy) {
  const trust = policy || loadTrustPolicy();
  const errors = [];
  const warnings = [];
  const publisher = sanitizeId(versionRow.publisher || '');
  const digest = manifestHash(pkg.id, versionRow.version, versionRow.manifest || {});

  if (versionRow.manifestHash && versionRow.manifestHash !== digest) {
    errors.push('Manifest hash mismatch for selected package version.');
  }

  if ((trust.blockedPublishers || []).includes(publisher)) {
    errors.push(`Publisher blocked by trust policy: ${publisher || '(unknown)'}`);
  }

  if ((trust.allowedPublishers || []).length > 0 && !(trust.allowedPublishers || []).includes(publisher)) {
    errors.push(`Publisher not in allowlist: ${publisher || '(unknown)'}`);
  }

  const payload = signaturePayload(pkg.id, versionRow.version, digest, publisher);
  const hasSignature = Boolean(versionRow.signature);
  const trustedKey = (trust.trustedKeys || {})[publisher] || '';

  if (trust.requireSigned && !hasSignature) {
    errors.push('Package is unsigned but trust policy requires signatures.');
  }

  if (hasSignature) {
    if (!trustedKey) {
      const msg = `No trusted key configured for publisher: ${publisher || '(unknown)'}`;
      if (trust.requireSigned) errors.push(msg);
      else warnings.push(msg);
    } else {
      const ok = verifyPayloadSignature(payload, versionRow.signature, trustedKey);
      if (!ok) {
        const msg = `Signature verification failed for publisher: ${publisher || '(unknown)'}`;
        if (trust.requireSigned) errors.push(msg);
        else warnings.push(msg);
      }
    }
  }

  return {
    ok: errors.length === 0,
    mode: trust.mode,
    requireSigned: trust.requireSigned,
    publisher: publisher || '(unknown)',
    computedManifestHash: digest,
    errors,
    warnings
  };
}

function installPackage(spec, options = {}) {
  const resolved = resolvePackage(spec);
  const policy = options.trustPolicy || loadTrustPolicy();
  const trust = assessTrust(resolved.pkg, resolved.versionRow, policy);
  const enforceTrust = options.enforceTrust !== false;

  if (enforceTrust && policy.mode === 'enforce' && trust.errors.length) {
    throw new Error(`Trust check failed: ${trust.errors.join(' | ')}`);
  }

  const lock = loadInstalled();
  const now = new Date().toISOString();
  const hash = manifestHash(resolved.pkg.id, resolved.versionRow.version, resolved.versionRow.manifest);

  const previous = lock.packages[resolved.pkg.id] || null;
  const next = {
    id: resolved.pkg.id,
    name: resolved.pkg.name,
    type: resolved.pkg.type,
    publisher: resolved.versionRow.publisher || '',
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
    publisher: resolved.versionRow.publisher || '',
    manifestHash: hash,
    manifest: resolved.versionRow.manifest,
    trust,
    installedAt: now
  });

  return {
    status: previous ? (previous.version === next.version ? 'already-installed' : 'updated') : 'installed',
    package: resolved.pkg,
    version: resolved.versionRow,
    lock: next,
    trust
  };
}

function updatePackage(id, options = {}) {
  const lock = loadInstalled();
  const target = sanitizeId(id);
  const installed = lock.packages[target];
  if (!installed) {
    throw new Error(`Package not installed: ${target}`);
  }
  return installPackage(target, options);
}

function updateAll(options = {}) {
  const lock = loadInstalled();
  const ids = Object.keys(lock.packages || {});
  return ids.map((id) => updatePackage(id, options));
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

async function loadCatalogFromSource(source) {
  const raw = String(source || '').trim();
  if (!raw) throw new Error('Missing source. Provide --source <file-or-url>.');

  if (/^https?:\/\//i.test(raw)) {
    const res = await axios.get(raw, { timeout: 12000 });
    return res.data;
  }

  const file = path.resolve(process.cwd(), raw);
  if (!fs.existsSync(file)) throw new Error(`Catalog source file not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function appendSourceMeta(meta) {
  const rows = readJson(sourceMetaPath(), []);
  const list = Array.isArray(rows) ? rows : [];
  list.unshift(meta);
  writeJsonAtomic(sourceMetaPath(), list.slice(0, 30));
}

async function syncCatalog({ source, merge = true } = {}) {
  const incomingRaw = await loadCatalogFromSource(source);
  const incoming = catalogFromAny(incomingRaw);
  if (!incoming.length) {
    throw new Error('Source catalog is empty or invalid.');
  }
  const base = merge ? loadCatalog() : [];
  const next = merge ? mergeCatalog(base, incoming) : normalizeCatalog(incoming);
  saveCatalog(next);
  const syncedAt = new Date().toISOString();
  appendSourceMeta({
    source: String(source || ''),
    merge: Boolean(merge),
    incomingCount: incoming.length,
    totalCount: next.length,
    syncedAt
  });
  return {
    source: String(source || ''),
    merge: Boolean(merge),
    incomingCount: incoming.length,
    totalCount: next.length,
    syncedAt
  };
}

function publishPackage(payload, options = {}) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const id = sanitizeId(input.id || options.id || '');
  if (!id) throw new Error('Publish payload missing id.');

  const version = String(input.version || options.version || '').trim();
  if (!parseSemver(version)) throw new Error(`Invalid version: ${version}`);

  const publisher = sanitizeId(input.publisher || options.publisher || '');
  if (!publisher) throw new Error('Publish payload missing publisher.');

  const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : {};
  const digest = manifestHash(id, version, manifest);
  const signEnabled = options.sign !== false;
  const privateKeyPem = String(options.privateKeyPem || '').trim();
  if (signEnabled && !privateKeyPem) {
    throw new Error('Signing enabled but no private key provided.');
  }
  const payloadToSign = signaturePayload(id, version, digest, publisher);
  const signature = signEnabled ? signPayload(payloadToSign, privateKeyPem) : '';

  const catalog = loadCatalog();
  const pkg = catalog.find((x) => x.id === id) || {
    id,
    name: String(input.name || id),
    type: String(input.type || 'package').toLowerCase(),
    description: String(input.description || ''),
    tags: uniqStrings(input.tags || []),
    versions: []
  };

  if (pkg.versions.some((v) => v.version === version)) {
    throw new Error(`Version already exists: ${id}@${version}`);
  }

  if (input.name) pkg.name = String(input.name);
  if (input.type) pkg.type = String(input.type).toLowerCase();
  if (input.description) pkg.description = String(input.description);
  if (Array.isArray(input.tags)) pkg.tags = uniqStrings(input.tags.map((x) => String(x || '').toLowerCase()));

  const versionRow = normalizeVersion({
    version,
    publishedAt: new Date().toISOString(),
    changelog: String(input.changelog || ''),
    publisher,
    manifest,
    manifestHash: digest,
    signature
  }, id);

  pkg.versions.push(versionRow);
  pkg.versions.sort((a, b) => compareSemver(b.version, a.version));

  const next = mergeCatalog(catalog.filter((x) => x.id !== id), [pkg]);
  saveCatalog(next);

  return {
    package: {
      id: pkg.id,
      name: pkg.name,
      type: pkg.type,
      description: pkg.description,
      tags: pkg.tags
    },
    version: versionRow,
    signed: Boolean(signature),
    catalogCount: next.length
  };
}

function publishFromFile(filePath, options = {}) {
  const full = path.resolve(process.cwd(), String(filePath || '').trim());
  if (!full || !fs.existsSync(full)) {
    throw new Error(`Publish manifest file not found: ${full}`);
  }
  const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
  return publishPackage(payload, options);
}

module.exports = {
  hubRoot,
  catalogPath,
  lockPath,
  trustPath,
  loadCatalog,
  saveCatalog,
  loadInstalled,
  listInstalled,
  searchCatalog,
  inspectPackage,
  installPackage,
  updatePackage,
  updateAll,
  parseSpec,
  parseSemver,
  compareSemver,
  manifestHash,
  signaturePayload,
  loadTrustPolicy,
  saveTrustPolicy,
  setTrustPolicy,
  allowPublisher,
  blockPublisher,
  setTrustedKey,
  removeTrustedKey,
  syncCatalog,
  publishPackage,
  publishFromFile,
  assessTrust,
  resetCacheForTests
};
