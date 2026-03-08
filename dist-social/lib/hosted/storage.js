"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const appPaths = require('../app-paths');
function ensureDir(dirPath) {
    const resolved = path.resolve(String(dirPath || ''));
    if (!resolved)
        throw new Error('Directory path is required.');
    if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
function homeRoot() {
    return appPaths.migrateLegacyAppHome();
}
function hostedRoot() {
    if (process.env.SOCIAL_HOSTED_HOME) {
        return ensureDir(path.resolve(process.env.SOCIAL_HOSTED_HOME));
    }
    const current = path.join(homeRoot(), 'hosted');
    if (fs.existsSync(current))
        return ensureDir(current);
    const legacy = appPaths.candidatePaths(['hosted']).slice(1).find((candidate) => fs.existsSync(candidate));
    if (legacy) {
        try {
            ensureDir(path.dirname(current));
            fs.renameSync(legacy, current);
            return ensureDir(current);
        }
        catch {
            return ensureDir(legacy);
        }
    }
    return ensureDir(current);
}
function hasWriteAccess(dirPath) {
    const dir = ensureDir(dirPath);
    const probe = path.join(dir, `.probe_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`);
    try {
        fs.writeFileSync(probe, 'ok', 'utf8');
        fs.rmSync(probe, { force: true });
        return true;
    }
    catch {
        try {
            fs.rmSync(probe, { force: true });
        }
        catch {
            // ignore
        }
        return false;
    }
}
function resolveVersionedDir(relativeDir, envKey = '') {
    const envValue = envKey ? String(process.env[envKey] || '').trim() : '';
    if (envValue) {
        const candidate = path.resolve(envValue);
        if (hasWriteAccess(candidate))
            return candidate;
    }
    const cwdCandidate = path.resolve(process.cwd(), String(relativeDir || ''));
    if (hasWriteAccess(cwdCandidate))
        return cwdCandidate;
    const hostedCandidate = path.resolve(hostedRoot(), String(relativeDir || ''));
    ensureDir(hostedCandidate);
    return hostedCandidate;
}
function readJson(filePath, fallback) {
    const target = path.resolve(String(filePath || ''));
    if (!target || !fs.existsSync(target))
        return fallback;
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    }
    catch {
        return fallback;
    }
}
function writeJsonAtomic(filePath, value) {
    const target = path.resolve(String(filePath || ''));
    ensureDir(path.dirname(target));
    const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, target);
}
function sanitizeId(value, fallback = 'default') {
    const raw = String(value || '').trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || fallback;
}
function nowIso() {
    return new Date().toISOString();
}
function genId(prefix = 'id') {
    return `${sanitizeId(prefix, 'id')}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
async function withFileLock(lockPath, fn, options = {}) {
    const target = path.resolve(String(lockPath || ''));
    const timeoutMs = Math.max(250, Number(options.timeoutMs || 5000));
    const staleMs = Math.max(1000, Number(options.staleMs || 30_000));
    const pollMs = Math.max(20, Number(options.pollMs || 60));
    ensureDir(path.dirname(target));
    const started = Date.now();
    let fd = null;
    while (fd === null) {
        try {
            fd = fs.openSync(target, 'wx');
            fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: nowIso() }), 'utf8');
            break;
        }
        catch (error) {
            if (error && error.code === 'EEXIST') {
                try {
                    const stat = fs.statSync(target);
                    const age = Date.now() - Number(stat.mtimeMs || 0);
                    if (age > staleMs) {
                        fs.rmSync(target, { force: true });
                    }
                }
                catch {
                    // ignore lock stat failures
                }
                if (Date.now() - started > timeoutMs) {
                    throw new Error(`Timed out waiting for lock: ${target}`);
                }
                // eslint-disable-next-line no-await-in-loop
                await sleep(pollMs + Math.floor(Math.random() * 25));
                continue;
            }
            throw error;
        }
    }
    try {
        return await fn();
    }
    finally {
        try {
            if (fd !== null)
                fs.closeSync(fd);
        }
        catch {
            // ignore
        }
        try {
            fs.rmSync(target, { force: true });
        }
        catch {
            // ignore
        }
    }
}
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function stableSortObject(value) {
    if (Array.isArray(value))
        return value.map((item) => stableSortObject(item));
    if (!isPlainObject(value))
        return value;
    const out = {};
    Object.keys(value).sort().forEach((key) => {
        out[key] = stableSortObject(value[key]);
    });
    return out;
}
function stableHash(value) {
    const normalized = stableSortObject(value);
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
function sha256Hex(text) {
    return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}
function maskSecret(secret) {
    const raw = String(secret || '');
    if (!raw)
        return '';
    if (raw.length <= 8)
        return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
    return `${raw.slice(0, 4)}...${raw.slice(-3)}`;
}
module.exports = {
    ensureDir,
    sleep,
    homeRoot,
    hostedRoot,
    resolveVersionedDir,
    readJson,
    writeJsonAtomic,
    sanitizeId,
    nowIso,
    genId,
    withFileLock,
    isPlainObject,
    stableSortObject,
    stableHash,
    sha256Hex,
    maskSecret
};
