import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readConfig, writeConfig } from "../core/config.js";

function withTempHome(fn: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "social-flow-config-"));
  const prevHome = process.env.SOCIAL_FLOW_HOME;

  process.env.SOCIAL_FLOW_HOME = dir;

  const finish = () => {
    if (prevHome === undefined) delete process.env.SOCIAL_FLOW_HOME;
    else process.env.SOCIAL_FLOW_HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    const out = fn(dir);
    if (out && typeof (out as Promise<void>).then === "function") {
      return (out as Promise<void>).finally(finish);
    }
    finish();
    return undefined;
  } catch (error) {
    finish();
    throw error;
  }
}

const tests = [
  {
    name: "readConfig flattens active profile from profile-based store",
    fn: async () => {
      await withTempHome(async (dir) => {
        writeFileSync(
          path.join(dir, "config.json"),
          JSON.stringify({
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
          }, null, 2),
          "utf8"
        );

        const cfg = await readConfig();
        assert.equal(cfg.activeProfile, "clientA");
        assert.equal(cfg.defaultApi, "facebook");
        assert.equal(cfg.token, "fb-client-token-12345678901234567890");
        assert.equal(cfg.defaultPageId, "page_123");
        assert.equal(cfg.defaultAdAccountId, "act_456");
        assert.deepEqual(cfg.scopes, ["pages_manage_posts", "ads_read"]);
        assert.equal(cfg.apiTokens?.facebook, "fb-client-token-12345678901234567890");
        assert.equal(cfg.ai?.provider, "openrouter");
        assert.equal(cfg.ai?.baseUrl, "https://openrouter.ai/api/v1");
      });
    }
  },
  {
    name: "readConfig migrates flat config into profile-based store",
    fn: async () => {
      await withTempHome(async (dir) => {
        writeFileSync(
          path.join(dir, "config.json"),
          JSON.stringify({
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
          }, null, 2),
          "utf8"
        );

        const cfg = await readConfig();
        assert.equal(cfg.token, "meta-token-12345678901234567890");
        assert.equal(cfg.defaultPageId, "page_flat");
        assert.equal(cfg.defaultAdAccountId, "act_flat");

        const stored = JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8")) as Record<string, unknown>;
        assert.equal(typeof stored.activeProfile, "string");
        assert.equal(typeof stored.profiles, "object");
        assert.equal(
          ((stored.profiles as Record<string, Record<string, unknown>>).default.tokens as Record<string, string>).facebook,
          "meta-token-12345678901234567890"
        );
      });
    }
  },
  {
    name: "writeConfig updates active profile without removing sibling profiles",
    fn: async () => {
      await withTempHome(async (dir) => {
        writeFileSync(
          path.join(dir, "config.json"),
          JSON.stringify({
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
          }, null, 2),
          "utf8"
        );

        const cfg = await readConfig();
        cfg.token = "fb-new-token-12345678901234567890";
        cfg.defaultPageId = "page_new";
        cfg.scopes = ["ads_read"];
        await writeConfig(cfg);

        const stored = JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8")) as {
          profiles: Record<string, { tokens?: Record<string, string>; defaults?: Record<string, string>; scopes?: string[] }>;
        };
        assert.equal(stored.profiles.default.tokens?.facebook, "fb-new-token-12345678901234567890");
        assert.equal(stored.profiles.default.defaults?.facebookPageId, "page_new");
        assert.deepEqual(stored.profiles.default.scopes, ["ads_read"]);
        assert.equal(stored.profiles.clientB.tokens?.facebook, "fb-client-b-token");
        assert.equal(stored.profiles.clientB.defaults?.facebookPageId, "page_b");
      });
    }
  }
];

export default tests;
