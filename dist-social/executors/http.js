"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaHttpExecutor = void 0;
const axios_1 = __importDefault(require("axios"));
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function shouldRetry(error) {
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;
    if (status === 429)
        return true;
    if (status && status >= 500 && status <= 599)
        return true;
    if (code === 613 || code === 17 || code === 32)
        return true;
    const networkCodes = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN"]);
    return Boolean(error.code && networkCodes.has(String(error.code)));
}
function retryDelayMs(attempt) {
    const base = Number.parseInt(process.env.SOCIAL_META_RETRY_BASE_MS || "1000", 10) || 1000;
    const max = Number.parseInt(process.env.SOCIAL_META_RETRY_MAX_MS || "8000", 10) || 8000;
    const backoff = Math.min(max, base * Math.pow(2, attempt));
    const jitter = Math.floor(backoff * 0.3 * Math.random());
    return backoff + jitter;
}
class MetaHttpExecutor {
    client;
    token;
    maxRetries;
    constructor(config) {
        this.token = config.token;
        this.client = axios_1.default.create({
            baseURL: `https://graph.facebook.com/${config.graphVersion}`,
            timeout: 30_000
        });
        const parsed = Number.parseInt(process.env.SOCIAL_META_RETRY_MAX || "3", 10);
        this.maxRetries = Number.isFinite(parsed) ? Math.max(1, parsed) : 3;
    }
    async requestWithRetry(fn) {
        for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
            try {
                return await fn();
            }
            catch (error) {
                const err = error;
                if (attempt < this.maxRetries - 1 && shouldRetry(err)) {
                    await sleep(retryDelayMs(attempt));
                    continue;
                }
                throw error;
            }
        }
        throw new Error("Unreachable");
    }
    async get(path, params) {
        return this.requestWithRetry(async () => {
            const { data } = await this.client.get(path, {
                params: { ...params, access_token: this.token }
            });
            return data;
        });
    }
    async post(path, params) {
        return this.requestWithRetry(async () => {
            const { data } = await this.client.post(path, null, {
                params: { ...params, access_token: this.token }
            });
            return data;
        });
    }
}
exports.MetaHttpExecutor = MetaHttpExecutor;
