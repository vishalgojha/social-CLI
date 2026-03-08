"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const config_js_1 = require("../core/config.js");
function withTempHome(fn) {
    const dir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join(node_os_1.default.tmpdir(), "social-flow-config-"));
    const prevHome = process.env.SOCIAL_FLOW_HOME;
    process.env.SOCIAL_FLOW_HOME = dir;
    const finish = () => {
        if (prevHome === undefined)
            delete process.env.SOCIAL_FLOW_HOME;
        else
            process.env.SOCIAL_FLOW_HOME = prevHome;
        (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
    };
    try {
        const out = fn(dir);
        if (out && typeof out.then === "function") {
            return out.finally(finish);
        }
        finish();
        return undefined;
    }
    catch (error) {
        finish();
        throw error;
    }
}
const tests = [
    {
        name: "readConfig flattens active profile from profile-based store",
        fn: async () => {
            await withTempHome(async (dir) => {
                (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, "config.json"), JSON.stringify({
                    activeProfile: "clientA",
                    profiles: {
                        default: {
                            apiVersion: "v20.0",
                            defaultApi: "facebook",
                            tokens: { facebook: "fb-default-token" }
                        },
                        clientA: {
                            apiVersion: "v21.0",
                            defaultApi: "facebook",
                            scopes: ["pages_manage_posts", "ads_read", "pages_manage_posts"],
                            tokens: {
                                facebook: "fb-client-token-12345678901234567890",
                                instagram: "ig-client-token"
                            },
                            defaults: {
                                facebookPageId: "page_123",
                                marketingAdAccountId: "act_456"
                            },
                            agent: {
                                provider: "openrouter",
                                model: "openai/gpt-4o-mini",
                                baseUrl: "https://openrouter.ai/api/v1",
                                apiKey: "or-key"
                            }
                        }
                    }
                }, null, 2), "utf8");
                const cfg = await (0, config_js_1.readConfig)();
                strict_1.default.equal(cfg.activeProfile, "clientA");
                strict_1.default.equal(cfg.defaultApi, "facebook");
                strict_1.default.equal(cfg.token, "fb-client-token-12345678901234567890");
                strict_1.default.equal(cfg.defaultPageId, "page_123");
                strict_1.default.equal(cfg.defaultAdAccountId, "act_456");
                strict_1.default.deepEqual(cfg.scopes, ["pages_manage_posts", "ads_read"]);
                strict_1.default.equal(cfg.apiTokens?.facebook, "fb-client-token-12345678901234567890");
                strict_1.default.equal(cfg.ai?.provider, "openrouter");
                strict_1.default.equal(cfg.ai?.baseUrl, "https://openrouter.ai/api/v1");
            });
        }
    },
    {
        name: "readConfig migrates flat config into profile-based store",
        fn: async () => {
            await withTempHome(async (dir) => {
                (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, "config.json"), JSON.stringify({
                    token: "meta-token-12345678901234567890",
                    graphVersion: "v21.0",
                    scopes: ["pages_read_engagement"],
                    defaultPageId: "page_flat",
                    defaultAdAccountId: "act_flat",
                    ai: {
                        provider: "ollama",
                        model: "qwen2.5:7b",
                        baseUrl: "http://127.0.0.1:11434",
                        apiKey: ""
                    }
                }, null, 2), "utf8");
                const cfg = await (0, config_js_1.readConfig)();
                strict_1.default.equal(cfg.token, "meta-token-12345678901234567890");
                strict_1.default.equal(cfg.defaultPageId, "page_flat");
                strict_1.default.equal(cfg.defaultAdAccountId, "act_flat");
                const stored = JSON.parse((0, node_fs_1.readFileSync)(node_path_1.default.join(dir, "config.json"), "utf8"));
                strict_1.default.equal(typeof stored.activeProfile, "string");
                strict_1.default.equal(typeof stored.profiles, "object");
                strict_1.default.equal(stored.profiles.default.tokens.facebook, "meta-token-12345678901234567890");
            });
        }
    },
    {
        name: "writeConfig updates active profile without removing sibling profiles",
        fn: async () => {
            await withTempHome(async (dir) => {
                (0, node_fs_1.writeFileSync)(node_path_1.default.join(dir, "config.json"), JSON.stringify({
                    activeProfile: "default",
                    profiles: {
                        default: {
                            apiVersion: "v20.0",
                            defaultApi: "facebook",
                            tokens: { facebook: "fb-old-token-12345678901234567890" },
                            defaults: { facebookPageId: "page_old" }
                        },
                        clientB: {
                            apiVersion: "v20.0",
                            defaultApi: "facebook",
                            tokens: { facebook: "fb-client-b-token" },
                            defaults: { facebookPageId: "page_b" }
                        }
                    }
                }, null, 2), "utf8");
                const cfg = await (0, config_js_1.readConfig)();
                cfg.token = "fb-new-token-12345678901234567890";
                cfg.defaultPageId = "page_new";
                cfg.scopes = ["ads_read"];
                await (0, config_js_1.writeConfig)(cfg);
                const stored = JSON.parse((0, node_fs_1.readFileSync)(node_path_1.default.join(dir, "config.json"), "utf8"));
                strict_1.default.equal(stored.profiles.default.tokens?.facebook, "fb-new-token-12345678901234567890");
                strict_1.default.equal(stored.profiles.default.defaults?.facebookPageId, "page_new");
                strict_1.default.deepEqual(stored.profiles.default.scopes, ["ads_read"]);
                strict_1.default.equal(stored.profiles.clientB.tokens?.facebook, "fb-client-b-token");
                strict_1.default.equal(stored.profiles.clientB.defaults?.facebookPageId, "page_b");
            });
        }
    }
];
exports.default = tests;
