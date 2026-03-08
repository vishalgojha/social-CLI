import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AiProvider, ApiName, SocialConfig } from "./types.js";

const CONFIG_DIR_NAME = ".social-flow";
const LEGACY_CONFIG_DIRS = [".social-cli", ".meta-cli"];

type JsonObject = Record<string, unknown>;

type StoredAgentConfig = {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
};

type StoredProfile = JsonObject & {
  apiVersion: string;
  defaultApi: ApiName;
  agent: StoredAgentConfig;
  tokens: Record<ApiName, string>;
  defaults: {
    facebookPageId: string;
    igUserId: string;
    whatsappPhoneNumberId: string;
    marketingAdAccountId: string;
  };
  scopes: string[];
};

type StoredConfig = JsonObject & {
  activeProfile: string;
  profiles: Record<string, StoredProfile>;
};

function defaultModelForProvider(provider: AiProvider): string {
  if (provider === "openrouter") return "openai/gpt-4o-mini";
  if (provider === "xai") return "grok-2-latest";
  if (provider === "openai") return "gpt-4o-mini";
  return "qwen2.5:7b";
}

function defaultBaseUrlForProvider(provider: AiProvider): string {
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  if (provider === "xai") return "https://api.x.ai/v1";
  if (provider === "openai") return "https://api.openai.com/v1";
  return "http://127.0.0.1:11434";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dedupeStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const item = cleanString(value);
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeProfileName(value: unknown): string {
  const raw = cleanString(value).replace(/^@/, "");
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "default";
}

function normalizeApiName(value: unknown): ApiName {
  const raw = cleanString(value).toLowerCase();
  if (raw === "instagram") return "instagram";
  if (raw === "whatsapp") return "whatsapp";
  return "facebook";
}

function normalizeAiProvider(value: unknown): AiProvider {
  const raw = cleanString(value).toLowerCase();
  if (raw === "openrouter") return "openrouter";
  if (raw === "xai" || raw === "grok") return "xai";
  if (raw === "openai") return "openai";
  return "ollama";
}

function defaultStoredProfile(): StoredProfile {
  const provider: AiProvider = "ollama";
  return {
    apiVersion: "v20.0",
    defaultApi: "facebook",
    agent: {
      provider,
      model: defaultModelForProvider(provider),
      baseUrl: defaultBaseUrlForProvider(provider),
      apiKey: ""
    },
    tokens: {
      facebook: "",
      instagram: "",
      whatsapp: ""
    },
    defaults: {
      facebookPageId: "",
      igUserId: "",
      whatsappPhoneNumberId: "",
      marketingAdAccountId: ""
    },
    scopes: []
  };
}

function defaultStoredConfig(): StoredConfig {
  return {
    activeProfile: "default",
    profiles: {
      default: defaultStoredProfile()
    }
  };
}

function normalizeStoredProfile(raw: unknown): StoredProfile {
  const source = isObject(raw) ? raw : {};
  const defaults = isObject(source.defaults) ? source.defaults : {};
  const tokens = isObject(source.tokens) ? source.tokens : {};
  const agent = isObject(source.agent) ? source.agent : {};
  const provider = normalizeAiProvider(agent.provider);

  return {
    ...source,
    apiVersion: cleanString(source.apiVersion) || "v20.0",
    defaultApi: normalizeApiName(source.defaultApi),
    agent: {
      ...agent,
      provider,
      model: cleanString(agent.model) || defaultModelForProvider(provider),
      baseUrl: cleanString(agent.baseUrl) || defaultBaseUrlForProvider(provider),
      apiKey: cleanString(agent.apiKey)
    },
    tokens: {
      facebook: cleanString(tokens.facebook),
      instagram: cleanString(tokens.instagram),
      whatsapp: cleanString(tokens.whatsapp)
    },
    defaults: {
      facebookPageId: cleanString(defaults.facebookPageId),
      igUserId: cleanString(defaults.igUserId),
      whatsappPhoneNumberId: cleanString(defaults.whatsappPhoneNumberId),
      marketingAdAccountId: cleanString(defaults.marketingAdAccountId)
    },
    scopes: Array.isArray(source.scopes) ? dedupeStrings(source.scopes) : []
  };
}

function normalizeStoredConfig(raw: unknown): StoredConfig {
  const source = isObject(raw) ? raw : {};
  const profilesInput = isObject(source.profiles) ? source.profiles : {};
  const profiles: Record<string, StoredProfile> = {};

  for (const [name, value] of Object.entries(profilesInput)) {
    profiles[normalizeProfileName(name)] = normalizeStoredProfile(value);
  }

  if (!profiles.default) profiles.default = defaultStoredProfile();

  const activeProfile = normalizeProfileName(source.activeProfile);
  if (!profiles[activeProfile]) profiles[activeProfile] = defaultStoredProfile();

  return {
    ...source,
    activeProfile,
    profiles
  };
}

function hasProfileConfig(raw: unknown): raw is StoredConfig {
  return isObject(raw) && isObject(raw.profiles);
}

function migrateFlatConfig(raw: unknown): StoredConfig {
  const source = isObject(raw) ? raw : {};
  const ai = isObject(source.ai) ? source.ai : {};
  const provider = normalizeAiProvider(ai.provider);
  const defaultApi = normalizeApiName(source.defaultApi);
  const profile = defaultStoredProfile();

  profile.apiVersion = cleanString(source.graphVersion) || "v20.0";
  profile.defaultApi = defaultApi;
  profile.tokens[defaultApi] = cleanString(source.token);
  if (!profile.tokens.facebook && profile.tokens[defaultApi] && defaultApi !== "facebook") {
    profile.tokens.facebook = profile.tokens[defaultApi];
  }
  profile.defaults.facebookPageId = cleanString(source.defaultPageId);
  profile.defaults.marketingAdAccountId = cleanString(source.defaultAdAccountId);
  profile.scopes = Array.isArray(source.scopes) ? dedupeStrings(source.scopes) : [];
  profile.agent = {
    provider,
    model: cleanString(ai.model) || defaultModelForProvider(provider),
    baseUrl: cleanString(ai.baseUrl) || defaultBaseUrlForProvider(provider),
    apiKey: cleanString(ai.apiKey)
  };

  return {
    activeProfile: "default",
    profiles: {
      default: profile
    }
  };
}

async function readJsonFile(file: string): Promise<JsonObject | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tempFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempFile, file);
}

function appHomeDir(): string {
  if (process.env.SOCIAL_FLOW_HOME) return path.resolve(process.env.SOCIAL_FLOW_HOME);
  if (process.env.SOCIAL_CLI_HOME) return path.join(path.resolve(process.env.SOCIAL_CLI_HOME), CONFIG_DIR_NAME);
  if (process.env.META_CLI_HOME) return path.join(path.resolve(process.env.META_CLI_HOME), CONFIG_DIR_NAME);
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

function legacyConfigFiles(): string[] {
  const current = appHomeDir();
  const parent = path.dirname(current);
  const out = [path.join(current, "config.json")];
  for (const legacyDir of LEGACY_CONFIG_DIRS) {
    out.push(path.join(parent, legacyDir, "config.json"));
  }
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = process.platform === "win32" ? item.toLowerCase() : item;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const DEFAULT_CONFIG: SocialConfig = {
  token: "",
  graphVersion: "v20.0",
  scopes: [],
  defaultApi: "facebook",
  activeProfile: "default",
  apiTokens: {
    facebook: "",
    instagram: "",
    whatsapp: ""
  },
  ai: {
    provider: "ollama",
    model: "qwen2.5:7b",
    baseUrl: "http://127.0.0.1:11434",
    apiKey: ""
  }
};

type LoadedConfigState = {
  currentFile: string;
  stored: StoredConfig;
};

export async function configPath(): Promise<string> {
  const dir = appHomeDir();
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "config.json");
}

async function loadStoredConfig(): Promise<LoadedConfigState> {
  const currentFile = await configPath();
  const candidates = legacyConfigFiles();

  for (const file of candidates) {
    const raw = await readJsonFile(file);
    if (!raw) continue;

    const stored = hasProfileConfig(raw) ? normalizeStoredConfig(raw) : migrateFlatConfig(raw);
    if (file !== currentFile || !hasProfileConfig(raw)) {
      await writeJsonAtomic(currentFile, stored);
    }
    return { currentFile, stored };
  }

  const stored = defaultStoredConfig();
  await writeJsonAtomic(currentFile, stored);
  return { currentFile, stored };
}

function flattenStoredConfig(currentFile: string, stored: StoredConfig): SocialConfig {
  const activeProfile = normalizeProfileName(stored.activeProfile);
  const profile = normalizeStoredProfile(stored.profiles[activeProfile] || stored.profiles.default);
  const defaultApi = normalizeApiName(profile.defaultApi);
  const apiTokens = {
    facebook: cleanString(profile.tokens.facebook),
    instagram: cleanString(profile.tokens.instagram),
    whatsapp: cleanString(profile.tokens.whatsapp)
  };
  const provider = normalizeAiProvider(profile.agent.provider);

  return {
    token: apiTokens[defaultApi] || apiTokens.facebook || apiTokens.instagram || apiTokens.whatsapp || "",
    graphVersion: cleanString(profile.apiVersion) || DEFAULT_CONFIG.graphVersion,
    scopes: dedupeStrings(profile.scopes),
    defaultApi,
    activeProfile,
    configPath: currentFile,
    apiTokens,
    defaultPageId: cleanString(profile.defaults.facebookPageId) || undefined,
    defaultAdAccountId: cleanString(profile.defaults.marketingAdAccountId) || undefined,
    ai: {
      provider,
      model: cleanString(profile.agent.model) || defaultModelForProvider(provider),
      baseUrl: cleanString(profile.agent.baseUrl) || defaultBaseUrlForProvider(provider),
      apiKey: cleanString(profile.agent.apiKey)
    }
  };
}

export async function readConfig(): Promise<SocialConfig> {
  const { currentFile, stored } = await loadStoredConfig();
  return flattenStoredConfig(currentFile, stored);
}

export async function writeConfig(config: SocialConfig): Promise<void> {
  const { currentFile, stored } = await loadStoredConfig();
  const activeProfile = normalizeProfileName(config.activeProfile || stored.activeProfile);

  if (!stored.profiles[activeProfile]) {
    stored.profiles[activeProfile] = defaultStoredProfile();
  }
  stored.activeProfile = activeProfile;

  const profile = normalizeStoredProfile(stored.profiles[activeProfile]);
  const defaultApi = normalizeApiName(config.defaultApi || profile.defaultApi);
  const currentTokens = { ...profile.tokens };
  const nextTokenMap = isObject(config.apiTokens) ? config.apiTokens : {};

  (["facebook", "instagram", "whatsapp"] as ApiName[]).forEach((api) => {
    if (Object.prototype.hasOwnProperty.call(nextTokenMap, api)) {
      currentTokens[api] = cleanString(nextTokenMap[api]);
    }
  });
  currentTokens[defaultApi] = cleanString(config.token);

  const provider = normalizeAiProvider(config.ai?.provider || profile.agent.provider);
  const ai = config.ai;

  profile.apiVersion = cleanString(config.graphVersion) || "v20.0";
  profile.defaultApi = defaultApi;
  profile.tokens = currentTokens;
  profile.defaults = {
    ...profile.defaults,
    facebookPageId: cleanString(config.defaultPageId),
    marketingAdAccountId: cleanString(config.defaultAdAccountId)
  };
  profile.scopes = dedupeStrings(config.scopes);
  profile.agent = {
    ...profile.agent,
    provider,
    model: ai ? cleanString(ai.model) || defaultModelForProvider(provider) : profile.agent.model,
    baseUrl: ai ? cleanString(ai.baseUrl) || defaultBaseUrlForProvider(provider) : profile.agent.baseUrl,
    apiKey: ai ? cleanString(ai.apiKey) : profile.agent.apiKey
  };

  stored.profiles[activeProfile] = profile;
  await writeJsonAtomic(currentFile, stored);
}
