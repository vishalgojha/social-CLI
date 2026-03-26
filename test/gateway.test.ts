const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { createGatewayServer } = require('../lib/gateway/server');
const config = require('../lib/config');
const opsStorage = require('../lib/ops/storage');

function requestJson({ port, method, pathName, body, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function requestRaw({ port, method, pathName, body, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const AI_KEY_ENV_VARS = [
  'OPENAI_API_KEY',
  'META_AI_KEY',
  'SOCIAL_AI_KEY',
  'SOCIAL_CHAT_API_KEY',
  'META_CHAT_API_KEY',
  'SOCIAL_AGENT_API_KEY',
  'META_AGENT_API_KEY'
];

function snapshotAiKeyEnv() {
  return Object.fromEntries(AI_KEY_ENV_VARS.map((k) => [k, process.env[k]]));
}

function clearAiKeyEnv() {
  AI_KEY_ENV_VARS.forEach((k) => { delete process.env[k]; });
}

function restoreAiKeyEnv(prev) {
  AI_KEY_ENV_VARS.forEach((k) => {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  });
}

function snapshotAgentConfig() {
  const cfg = typeof config.getAgentConfig === 'function' ? config.getAgentConfig() : {};
  return {
    provider: String(cfg.provider || 'openai'),
    model: String(cfg.model || ''),
    apiKey: String(cfg.apiKey || ''),
    modelTiers: {
      cheap: String(((cfg.modelTiers || {}).cheap) || ''),
      balanced: String(((cfg.modelTiers || {}).balanced) || ''),
      premium: String(((cfg.modelTiers || {}).premium) || '')
    }
  };
}

function restoreAgentConfig(prev) {
  if (typeof config.setAgentProvider === 'function') {
    config.setAgentProvider(String(prev.provider || 'openai'));
  }
  if (typeof config.setAgentModel === 'function') {
    config.setAgentModel(String(prev.model || ''));
  }
  if (typeof config.setAgentApiKey === 'function') {
    config.setAgentApiKey(String(prev.apiKey || ''));
  }
  if (typeof config.setAgentModelTier === 'function') {
    config.setAgentModelTier('cheap', String(((prev.modelTiers || {}).cheap) || ''));
    config.setAgentModelTier('balanced', String(((prev.modelTiers || {}).balanced) || ''));
    config.setAgentModelTier('premium', String(((prev.modelTiers || {}).premium) || ''));
  }
}

function clearAgentApiConfig() {
  if (typeof config.setAgentProvider === 'function') {
    config.setAgentProvider('openai');
  }
  if (typeof config.setAgentApiKey === 'function') {
    config.setAgentApiKey('');
  }
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WS connect timeout: ${url}`));
    }, 2000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = [
  {
    name: 'gateway health endpoint returns ok',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const res = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/health'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway root endpoint returns deprecation response and points to studio routes',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const root = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/'
        });
        assert.equal(root.status, 410);
        assert.equal(String(root.headers['content-type'] || '').includes('application/json'), true);
        assert.equal(
          String(root.raw || '').includes('Open /studio or /studio/app/ for Studio'),
          true
        );

        const staticCss = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/styles.css'
        });
        assert.equal(staticCss.status, 404);
        assert.equal(String(staticCss.headers['content-type'] || '').includes('application/json'), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway studio route redirects to studio app',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const studio = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/studio'
        });
        assert.equal(studio.status, 302);
        assert.equal(String(studio.headers.location || ''), '/studio/app/');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway studio app route redirects to trailing slash',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const app = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/studio/app'
        });
        assert.equal(app.status, 302);
        assert.equal(String(app.headers.location || ''), '/studio/app/');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway studio app route serves working frontend by default',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const app = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/studio/app/'
        });
        assert.equal(app.status, 200);
        assert.equal(String(app.headers['content-type'] || '').includes('text/html'), true);
        assert.equal(String(app.raw || '').includes('Social Flow Studio'), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway studio app route works when cwd is outside repo root',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldStudioDirs = process.env.SOCIAL_STUDIO_ASSET_DIRS;
      const oldCwd = process.cwd();
      const externalCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-cwd-'));
      const externalStudioDir = path.join(externalCwd, 'studio-assets');
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      fs.mkdirSync(externalStudioDir, { recursive: true });
      fs.writeFileSync(path.join(externalStudioDir, 'index.html'), '<!doctype html><html><body>external studio app</body></html>', 'utf8');
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        process.chdir(externalCwd);
        process.env.SOCIAL_STUDIO_ASSET_DIRS = externalStudioDir;
        await server.start();
        const app = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/studio/app/'
        });
        assert.equal(app.status, 200);
        assert.equal(String(app.headers['content-type'] || '').includes('text/html'), true);
        assert.equal(String(app.raw || '').includes('external studio app'), true);
      } finally {
        await server.stop();
        process.chdir(oldCwd);
        fs.rmSync(externalCwd, { recursive: true, force: true });
        process.env.META_CLI_HOME = oldHome;
        if (oldStudioDirs === undefined) delete process.env.SOCIAL_STUDIO_ASSET_DIRS;
        else process.env.SOCIAL_STUDIO_ASSET_DIRS = oldStudioDirs;
      }
    }
  },
  {
    name: 'gateway studio app route returns missing-frontend error when explicit asset roots have no frontend',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldStudioDirs = process.env.SOCIAL_STUDIO_ASSET_DIRS;
      const emptyStudioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-empty-studio-'));
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.SOCIAL_STUDIO_ASSET_DIRS = emptyStudioDir;
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const app = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/studio/app/'
        });
        assert.equal(app.status, 404);
        assert.equal(String(app.headers['content-type'] || '').includes('application/json'), true);
        assert.equal(String(app.raw || '').includes('Studio app frontend is not installed'), true);
      } finally {
        await server.stop();
        fs.rmSync(emptyStudioDir, { recursive: true, force: true });
        process.env.META_CLI_HOME = oldHome;
        if (oldStudioDirs === undefined) delete process.env.SOCIAL_STUDIO_ASSET_DIRS;
        else process.env.SOCIAL_STUDIO_ASSET_DIRS = oldStudioDirs;
      }
    }
  },
  {
    name: 'gateway studio route keeps redirect behavior even when static asset roots are configured',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldStudioDirs = process.env.SOCIAL_STUDIO_ASSET_DIRS;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.SOCIAL_STUDIO_ASSET_DIRS = path.resolve(process.cwd(), 'docs', 'agentic-frontend');
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const studio = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/studio'
        });
        assert.equal(studio.status, 302);
        assert.equal(String(studio.headers.location || ''), '/studio/app/');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        if (oldStudioDirs === undefined) delete process.env.SOCIAL_STUDIO_ASSET_DIRS;
        else process.env.SOCIAL_STUDIO_ASSET_DIRS = oldStudioDirs;
      }
    }
  },
  {
    name: 'gateway sdk routes expose action catalog and approval-safe plan/execute flow',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const actions = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/sdk/actions'
        });
        assert.equal(actions.status, 200);
        assert.equal(actions.data.ok, true);
        assert.equal(Array.isArray(actions.data.data.actions), true);

        const plan = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/sdk/actions/plan',
          body: {
            action: 'create_post',
            params: { message: 'hello world', pageId: '123' }
          }
        });
        assert.equal(plan.status, 200);
        assert.equal(plan.data.ok, true);
        assert.equal(plan.data.meta.action, 'create_post');
        assert.equal(plan.data.meta.requiresApproval, true);
        assert.equal(Boolean(plan.data.meta.approvalToken), true);

        const executeWithoutApproval = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/sdk/actions/execute',
          body: {
            action: 'create_post',
            params: { message: 'hello world', pageId: '123' }
          }
        });
        assert.equal(executeWithoutApproval.status, 428);
        assert.equal(executeWithoutApproval.data.ok, false);
        assert.equal(executeWithoutApproval.data.error.code, 'APPROVAL_REQUIRED');

        const executeLowRisk = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/sdk/actions/execute',
          body: { action: 'status', params: {} }
        });
        assert.equal(executeLowRisk.status, 200);
        assert.equal(executeLowRisk.data.ok, true);
        assert.equal(executeLowRisk.data.meta.action, 'status');
        assert.equal(executeLowRisk.data.meta.requiresApproval, false);
        assert.equal(executeLowRisk.data.data.service, 'social-api-gateway');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway config endpoint returns sanitized snapshot',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const res = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        assert.equal(res.status, 200);
        assert.equal(Boolean(res.data.config), true);
        assert.equal(Boolean(res.data.readiness), true);
        assert.equal(typeof res.data.config.tokens.facebook.configured, 'boolean');
        assert.equal(typeof res.data.config.agent.apiKeyConfigured, 'boolean');
        assert.equal(typeof res.data.config.onboarding.completed, 'boolean');
        assert.equal(typeof res.data.config.industry.legacySelected, 'string');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway self-host admin endpoint exposes deployment snapshot',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const envKeys = [
        'SOCIAL_HOSTED_MASTER_KEY',
        'SOCIAL_HOSTED_BOOTSTRAP_API_KEY',
        'SOCIAL_HOSTED_BOOTSTRAP_USER_ID',
        'SOCIAL_HOSTED_HOME'
      ];
      const prevEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_HOSTED_MASTER_KEY = 'master-key-test-value';
      process.env.SOCIAL_HOSTED_BOOTSTRAP_API_KEY = 'bootstrap-key-test-value';
      process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_ID = 'default';
      process.env.SOCIAL_HOSTED_HOME = path.join(tempHome, 'hosted-home');
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        apiKey: 'test-secret',
        requireApiKey: true,
        corsOrigins: 'https://studio.local'
      });
      try {
        await server.start();
        const res = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/self-host/admin',
          headers: { 'X-Gateway-Key': 'test-secret' }
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.ok, true);
        assert.equal(res.data.system.service, 'social-api-gateway');
        assert.equal(res.data.system.version, require('../package.json').version);
        assert.equal(res.data.system.security.apiKeyRequired, true);
        assert.equal(res.data.system.security.apiKeyConfigured, true);
        assert.equal(res.data.system.security.corsRestricted, true);
        assert.equal(res.data.system.setup.studioFrontendInstalled, true);
        assert.equal(Array.isArray(res.data.system.paths), true);
        assert.equal(res.data.system.paths.some((row) => row.key === 'configFile' && String(row.path || '').includes('.social-flow')), true);
        assert.equal(Array.isArray(res.data.system.checks), true);
        assert.equal(res.data.system.checks.some((row) => row.key === 'gateway_access'), true);
        assert.equal(typeof res.data.system.commands.upgrade, 'string');
        assert.equal(String(res.data.system.urls.studio || '').includes('/studio/app/'), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        envKeys.forEach((key) => {
          if (prevEnv[key] === undefined) delete process.env[key];
          else process.env[key] = prevEnv[key];
        });
      }
    }
  },
  {
    name: 'gateway config update endpoint saves tokens and agent credentials',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const saveRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/config/update',
          body: {
            tokens: {
              facebook: 'fb_test_token_123456',
              instagram: 'ig_test_token_123456'
            },
            app: {
              appId: '123456789',
              appSecret: 'secret_test_value'
            },
            defaultApi: 'instagram',
            agent: {
              provider: 'openai',
              model: 'gpt-4.1-mini',
              modelTiers: {
                cheap: 'gpt-4.1-nano',
                balanced: 'gpt-4.1-mini',
                premium: 'gpt-4.1'
              },
              apiKey: 'sk-test-1234'
            },
            onboarding: {
              completed: true
            }
          }
        });
        assert.equal(saveRes.status, 200);
        assert.equal(saveRes.data.ok, true);
        assert.equal(Array.isArray(saveRes.data.updated), true);
        assert.equal(saveRes.data.updated.includes('tokens.facebook'), true);
        assert.equal(saveRes.data.updated.includes('tokens.instagram'), true);
        assert.equal(saveRes.data.updated.includes('app.appId'), true);
        assert.equal(saveRes.data.updated.includes('app.appSecret'), true);
        assert.equal(saveRes.data.updated.includes('defaultApi'), true);
        assert.equal(saveRes.data.updated.includes('agent.provider'), true);
        assert.equal(saveRes.data.updated.includes('agent.model'), true);
        assert.equal(saveRes.data.updated.includes('agent.modelTiers.cheap'), true);
        assert.equal(saveRes.data.updated.includes('agent.modelTiers.balanced'), true);
        assert.equal(saveRes.data.updated.includes('agent.modelTiers.premium'), true);
        assert.equal(saveRes.data.updated.includes('agent.apiKey'), true);
        assert.equal(saveRes.data.updated.includes('onboarding.completed'), true);
        assert.equal(Boolean(saveRes.data.readiness), true);

        const configRes = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        assert.equal(configRes.status, 200);
        assert.equal(configRes.data.config.tokens.facebook.configured, true);
        assert.equal(configRes.data.config.tokens.instagram.configured, true);
        assert.equal(configRes.data.config.tokens.whatsapp.configured, false);
        assert.equal(configRes.data.config.app.appId, '123456789');
        assert.equal(configRes.data.config.app.appSecretConfigured, true);
        assert.equal(configRes.data.config.defaultApi, 'instagram');
        assert.equal(configRes.data.config.agent.provider, 'openai');
        assert.equal(configRes.data.config.agent.model, 'gpt-4.1-mini');
        assert.equal(configRes.data.config.agent.modelTiers.cheap, 'gpt-4.1-nano');
        assert.equal(configRes.data.config.agent.modelTiers.balanced, 'gpt-4.1-mini');
        assert.equal(configRes.data.config.agent.modelTiers.premium, 'gpt-4.1');
        assert.equal(configRes.data.config.agent.apiKeyConfigured, true);
        assert.equal(configRes.data.config.onboarding.completed, true);
        assert.equal(configRes.data.readiness.ok, true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway auth middleware enforces x-gateway-key when required',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        apiKey: 'test-secret',
        requireApiKey: true
      });
      try {
        await server.start();

        const denied = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        assert.equal(denied.status, 401);
        assert.equal(denied.data.ok, false);

        const allowed = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config',
          headers: { 'X-Gateway-Key': 'test-secret' }
        });
        assert.equal(allowed.status, 200);
        assert.equal(Boolean(allowed.data.config), true);

        const health = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/health'
        });
        assert.equal(health.status, 200);
        assert.equal(health.data.ok, true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway blocks disallowed CORS origins',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        corsOrigins: 'http://allowed.local'
      });
      try {
        await server.start();

        const blocked = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config',
          headers: { Origin: 'http://evil.local' }
        });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.data.ok, false);

        const preflight = await requestJson({
          port: server.port,
          method: 'OPTIONS',
          pathName: '/api/config',
          headers: {
            Origin: 'http://allowed.local',
            'Access-Control-Request-Method': 'GET'
          }
        });
        assert.equal(preflight.status, 204);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway rate limiter rejects excessive requests',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        rateLimitMax: 2,
        rateLimitWindowMs: 60 * 1000
      });
      try {
        await server.start();

        const one = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        const two = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });
        const three = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/config'
        });

        assert.equal(one.status, 200);
        assert.equal(two.status, 200);
        assert.equal(three.status, 429);
        assert.equal(three.data.ok, false);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway team operator route bootstraps local owner then enforces admin role',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldSocialHome = process.env.SOCIAL_CLI_HOME;
      const oldSocialUser = process.env.SOCIAL_USER;
      const oldOperator = typeof config.getOperator === 'function'
        ? config.getOperator()
        : { id: '', name: '' };
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_CLI_HOME = tempHome;
      process.env.SOCIAL_USER = 'local-user';

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const bootstrap = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator',
          body: { workspace: 'default', id: 'owner_1', name: 'Owner One' }
        });
        assert.equal(bootstrap.status, 200);
        assert.equal(bootstrap.data.ok, true);
        assert.equal(bootstrap.data.bootstrapped, true);
        assert.equal(opsStorage.getRole({ workspace: 'default', user: 'owner_1' }), 'owner');

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'viewer' });
        const setViewerOperator = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator',
          body: { workspace: 'default', id: 'local-user', name: 'Local Viewer' }
        });
        assert.equal(setViewerOperator.status, 200);
        assert.equal(setViewerOperator.data.ok, true);

        const clearOperator = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator/clear',
          body: { workspace: 'default' }
        });
        assert.equal(clearOperator.status, 400);
        assert.equal(clearOperator.data.ok, false);
        assert.equal(String(clearOperator.data.error || '').includes('Permission denied'), true);

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'owner' });
        const clearByOwner = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator/clear',
          body: { workspace: 'default' }
        });
        assert.equal(clearByOwner.status, 200);
        assert.equal(clearByOwner.data.ok, true);

        const setByOwner = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/operator',
          body: { workspace: 'default', id: 'owner_2', name: 'Owner Two' }
        });
        assert.equal(setByOwner.status, 200);
        assert.equal(setByOwner.data.ok, true);
        assert.equal(setByOwner.data.bootstrapped, false);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        process.env.SOCIAL_CLI_HOME = oldSocialHome;
        if (oldSocialUser === undefined) delete process.env.SOCIAL_USER;
        else process.env.SOCIAL_USER = oldSocialUser;
        if (typeof config.setOperator === 'function') {
          config.setOperator({
            id: String(oldOperator.id || ''),
            name: String(oldOperator.name || '')
          });
        }
      }
    }
  },
  {
    name: 'gateway websocket upgrade enforces api key and session isolation',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const server = createGatewayServer({
        host: '127.0.0.1',
        port: 0,
        apiKey: 'ws-secret',
        requireApiKey: true
      });
      try {
        await server.start();

        const denied = await new Promise((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?sessionId=s-denied`);
          let opened = false;
          ws.once('open', () => {
            opened = true;
            ws.close();
          });
          ws.once('close', () => resolve(!opened));
          ws.once('error', () => {});
          setTimeout(() => resolve(!opened), 1200);
        });
        assert.equal(denied, true);

        const ws = await connectWs(`ws://127.0.0.1:${server.port}/ws?sessionId=s-1&gatewayKey=ws-secret`);
        ws.close();

        const ws1 = await connectWs(`ws://127.0.0.1:${server.port}/ws?sessionId=s-1&gatewayKey=ws-secret`);
        const ws2 = await connectWs(`ws://127.0.0.1:${server.port}/ws?sessionId=s-2&gatewayKey=ws-secret`);
        const messages1 = [];
        const messages2 = [];
        ws1.on('message', (buf) => {
          try {
            messages1.push(JSON.parse(String(buf)));
          } catch {
            // ignore malformed test payloads
          }
        });
        ws2.on('message', (buf) => {
          try {
            messages2.push(JSON.parse(String(buf)));
          } catch {
            // ignore malformed test payloads
          }
        });
        await wait(120);
        messages1.length = 0;
        messages2.length = 0;

        const chatRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          headers: { 'X-Gateway-Key': 'ws-secret' },
          body: { sessionId: 's-1', message: 'hello' }
        });
        assert.equal(chatRes.status, 200);
        assert.equal(chatRes.data.ok, true);
        await wait(300);

        assert.equal(messages1.some((x) => x.sessionId === 's-1' && x.type === 'output'), true);
        assert.equal(messages2.some((x) => x.sessionId === 's-1'), false);

        ws1.close();
        ws2.close();
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'gateway chat endpoints create session and process message',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldKeys = snapshotAiKeyEnv();
      const oldAgent = snapshotAgentConfig();
      clearAiKeyEnv();
      clearAgentApiConfig();

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const startRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/start',
          body: {}
        });
        assert.equal(startRes.status, 200);
        assert.equal(Boolean(startRes.data.sessionId), true);

        const msgRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: {
            sessionId: startRes.data.sessionId,
            message: 'hello'
          }
        });

        assert.equal(msgRes.status, 200);
        assert.equal(msgRes.data.ok, true);
        assert.equal(typeof msgRes.data.response.message, 'string');
        assert.equal(msgRes.data.response.actions.length, 0);
        assert.equal(msgRes.data.response.mode, 'clarify');
        assert.equal(String(msgRes.data.response.message || '').toLowerCase().includes('valid api key'), true);
        assert.equal(msgRes.data.summary.activeResponseMode, 'clarify');
        assert.equal(Array.isArray(msgRes.data.timeline), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAgentConfig(oldAgent);
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway chat deterministic command requires explicit approval before execution',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldKeys = snapshotAiKeyEnv();
      process.env.OPENAI_API_KEY = 'test-gateway-key';
      delete process.env.META_AI_KEY;

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const startRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/start',
          body: {}
        });
        assert.equal(startRes.status, 200);
        assert.equal(Boolean(startRes.data.sessionId), true);

        const msgRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: {
            sessionId: startRes.data.sessionId,
            message: 'social auth status'
          }
        });

        assert.equal(msgRes.status, 200);
        assert.equal(msgRes.data.ok, true);
        assert.equal(Array.isArray(msgRes.data.executed), true);
        assert.equal(msgRes.data.executed.length, 0);
        assert.equal(Array.isArray(msgRes.data.pendingActions), true);
        assert.equal(msgRes.data.pendingActions.length, 1);
        assert.equal(msgRes.data.response.needsInput, true);
        assert.equal(msgRes.data.response.actions[0].tool, 'auth.status');
        assert.equal(Array.isArray(msgRes.data.timeline), true);

        const approveRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: {
            sessionId: startRes.data.sessionId,
            message: 'yes'
          }
        });

        assert.equal(approveRes.status, 200);
        assert.equal(approveRes.data.ok, true);
        assert.equal(Array.isArray(approveRes.data.executed), true);
        assert.equal(approveRes.data.executed.length, 1);
        assert.equal(approveRes.data.executed[0].tool, 'auth.status');
        assert.equal(Array.isArray(approveRes.data.pendingActions), true);
        assert.equal(approveRes.data.pendingActions.length, 0);
        assert.equal(approveRes.data.response.needsInput, false);
        assert.equal(Array.isArray(approveRes.data.timeline), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway session replay endpoint returns timeline',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldKeys = snapshotAiKeyEnv();
      const oldAgent = snapshotAgentConfig();
      clearAiKeyEnv();
      clearAgentApiConfig();

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        const startRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/start',
          body: {}
        });
        const sid = startRes.data.sessionId;
        await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: { sessionId: sid, message: 'hello' }
        });
        const replay = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: `/api/sessions/${sid}/replay?limit=30`
        });
        assert.equal(replay.status, 200);
        assert.equal(replay.data.ok, true);
        assert.equal(replay.data.sessionId, sid);
        assert.equal(Array.isArray(replay.data.timeline), true);
        assert.equal(replay.data.timeline.length > 0, true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAgentConfig(oldAgent);
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway chat requires API key before ambiguous intent fallback',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      const oldKeys = snapshotAiKeyEnv();
      const oldAgent = snapshotAgentConfig();
      clearAiKeyEnv();
      clearAgentApiConfig();

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const startRes = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/start',
          body: {}
        });
        assert.equal(startRes.status, 200);
        assert.equal(Boolean(startRes.data.sessionId), true);

        const first = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/chat/message',
          body: {
            sessionId: startRes.data.sessionId,
            message: 'totally unknown request text'
          }
        });
        assert.equal(first.status, 200);
        assert.equal(first.data.ok, true);
        assert.equal(Array.isArray(first.data.response?.actions), true);
        assert.equal(first.data.response.actions.length, 0);
        assert.equal(String(first.data.response?.message || '').toLowerCase().includes('valid api key'), true);
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        restoreAgentConfig(oldAgent);
        restoreAiKeyEnv(oldKeys);
      }
    }
  },
  {
    name: 'gateway ops endpoints support summary, guard policy, runs, lists, and resolution',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      const oldSocialHome = process.env.SOCIAL_CLI_HOME;
      const oldSocialUser = process.env.SOCIAL_USER;
      const oldOperator = typeof config.getOperator === 'function'
        ? config.getOperator()
        : { id: '', name: '' };
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-gw-test-'));
      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_CLI_HOME = tempHome;
      process.env.SOCIAL_USER = 'local-user';

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();
        if (typeof config.setOperator === 'function') {
          config.setOperator({ id: 'local-user', name: 'Local User' });
        }
        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'owner' });

        const summary1 = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/summary?workspace=default'
        });
        assert.equal(summary1.status, 200);
        assert.equal(summary1.data.ok, true);
        assert.equal(typeof summary1.data.summary.alertsOpen, 'number');
        assert.equal(typeof summary1.data.summary.guardPolicy.mode, 'string');

        const readiness1 = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/readiness?workspace=default'
        });
        assert.equal(readiness1.status, 200);
        assert.equal(readiness1.data.ok, true);
        assert.equal(Array.isArray(readiness1.data.report.checks), true);

        const guardGet = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/guard/policy?workspace=default'
        });
        assert.equal(guardGet.status, 200);
        assert.equal(guardGet.data.ok, true);
        assert.equal(guardGet.data.guardPolicy.mode, 'approval');

        const guardMode = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/guard/mode',
          body: { workspace: 'default', mode: 'auto_safe' }
        });
        assert.equal(guardMode.status, 200);
        assert.equal(guardMode.data.ok, true);
        assert.equal(guardMode.data.mode, 'auto_safe');

        const guardSet = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/guard/policy',
          body: {
            workspace: 'default',
            thresholds: { spendSpikePct: 44 },
            limits: { maxCampaignsPerRun: 3 }
          }
        });
        assert.equal(guardSet.status, 200);
        assert.equal(guardSet.data.ok, true);
        assert.equal(guardSet.data.guardPolicy.thresholds.spendSpikePct, 44);
        assert.equal(guardSet.data.guardPolicy.limits.maxCampaignsPerRun, 3);

        const sourceUpsert = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/upsert',
          body: {
            workspace: 'default',
            name: 'Campaign Source',
            connector: 'csv_upload',
            syncMode: 'manual',
            enabled: true
          }
        });
        assert.equal(sourceUpsert.status, 200);
        assert.equal(sourceUpsert.data.ok, true);
        assert.equal(sourceUpsert.data.source.connector, 'csv_upload');

        const sources = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/sources?workspace=default'
        });
        assert.equal(sources.status, 200);
        assert.equal(sources.data.ok, true);
        assert.equal(Array.isArray(sources.data.sources), true);
        assert.equal(sources.data.sources.length > 0, true);

        const sourceSync = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/sync',
          body: { workspace: 'default' }
        });
        assert.equal(sourceSync.status, 200);
        assert.equal(sourceSync.data.ok, true);
        assert.equal(Array.isArray(sourceSync.data.result), true);
        assert.equal(sourceSync.data.result.length > 0, true);
        assert.equal(sourceSync.data.result[0].source.status, 'ready');

        const onboardWorkspace = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/onboard/workspace',
          body: { workspace: 'default' }
        });
        assert.equal(onboardWorkspace.status, 200);
        assert.equal(onboardWorkspace.data.ok, true);
        assert.equal(Boolean(onboardWorkspace.data.schedule), true);

        const onboardingComplete = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/onboarding/complete',
          body: { workspace: 'default', completed: true }
        });
        assert.equal(onboardingComplete.status, 200);
        assert.equal(onboardingComplete.data.ok, true);
        assert.equal(Boolean(onboardingComplete.data.state.onboardingCompletedAt), true);

        const weeklyReport = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/report/weekly',
          body: { workspace: 'default', days: 7, outDir: path.join(tempHome, 'reports') }
        });
        assert.equal(weeklyReport.status, 200);
        assert.equal(weeklyReport.data.ok, true);
        assert.equal(fs.existsSync(weeklyReport.data.reportPath), true);

        const slackSourceUpsert = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/upsert',
          body: {
            workspace: 'default',
            name: 'Slack Routing',
            connector: 'slack_channels',
            syncMode: 'manual',
            enabled: true
          }
        });
        assert.equal(slackSourceUpsert.status, 200);
        assert.equal(slackSourceUpsert.data.ok, true);
        assert.equal(slackSourceUpsert.data.source.connector, 'slack_channels');

        const slackSourceSync = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/sources/sync',
          body: { workspace: 'default', id: slackSourceUpsert.data.source.id }
        });
        assert.equal(slackSourceSync.status, 200);
        assert.equal(slackSourceSync.data.ok, true);
        assert.equal(Array.isArray(slackSourceSync.data.result), true);
        assert.equal(slackSourceSync.data.result.length, 1);
        assert.equal(slackSourceSync.data.result[0].source.status, 'error');
        assert.equal(String(slackSourceSync.data.result[0].source.lastError || '').includes('slackWebhook'), true);

        const run = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/morning-run',
          body: { workspace: 'default', spend: 1000, force: true }
        });
        assert.equal(run.status, 200);
        assert.equal(run.data.ok, true);
        assert.equal(Boolean(run.data.snapshot), true);

        const alerts = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/alerts?workspace=default&open=1'
        });
        assert.equal(alerts.status, 200);
        assert.equal(alerts.data.ok, true);
        assert.equal(Array.isArray(alerts.data.alerts), true);
        assert.equal(alerts.data.alerts.length > 0, true);

        const approvals = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/ops/approvals?workspace=default&open=1'
        });
        assert.equal(approvals.status, 200);
        assert.equal(approvals.data.ok, true);
        assert.equal(Array.isArray(approvals.data.approvals), true);
        assert.equal(approvals.data.approvals.length > 0, true);

        const exportJson = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/activity/export?workspace=default&format=json&limit=10'
        });
        assert.equal(exportJson.status, 200);
        assert.equal(exportJson.data.ok, true);
        assert.equal(Array.isArray(exportJson.data.activity), true);

        const exportCsv = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/activity/export?workspace=default&format=csv&limit=10'
        });
        assert.equal(exportCsv.status, 200);
        assert.equal(String(exportCsv.headers['content-type'] || '').includes('text/csv'), true);
        assert.equal(exportCsv.raw.includes('createdAt,workspace,actor,action,status,summary,meta'), true);

        const handoffOutDir = path.join(tempHome, 'handoff-pack-default');
        const handoffPack = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/handoff/pack',
          body: { workspace: 'default', template: 'enterprise', outDir: handoffOutDir }
        });
        assert.equal(handoffPack.status, 200);
        assert.equal(handoffPack.data.ok, true);
        assert.equal(handoffPack.data.template, 'enterprise');
        assert.equal(fs.existsSync(handoffPack.data.files.handoff), true);
        assert.equal(fs.existsSync(handoffPack.data.files.runbook), true);
        assert.equal(fs.existsSync(handoffPack.data.files.accessMatrix), true);
        assert.equal(fs.existsSync(handoffPack.data.files.incidentPlaybook), true);

        const fileDownload = await requestRaw({
          port: server.port,
          method: 'GET',
          pathName: `/api/ops/handoff/file?path=${encodeURIComponent(handoffPack.data.files.handoff)}`
        });
        assert.equal(fileDownload.status, 200);
        assert.equal(String(fileDownload.headers['content-disposition'] || '').includes('handoff.md'), true);
        assert.equal(String(fileDownload.raw || '').includes('# Social Flow Agency Handoff - default'), true);

        const outsidePath = path.join(os.tmpdir(), 'gateway-outside-file.txt');
        fs.writeFileSync(outsidePath, 'outside', 'utf8');
        const deniedOutside = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: `/api/ops/handoff/file?workspace=default&path=${encodeURIComponent(outsidePath)}`
        });
        assert.equal(deniedOutside.status, 400);
        assert.equal(deniedOutside.data.ok, false);
        assert.equal(String(deniedOutside.data.error || '').includes('Path not allowed'), true);

        const setViewerRole = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/role',
          body: { workspace: 'default', user: 'local-user', role: 'viewer' }
        });
        assert.equal(setViewerRole.status, 200);
        assert.equal(setViewerRole.data.ok, true);

        const rolesList = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/roles?workspace=default'
        });
        assert.equal(rolesList.status, 200);
        assert.equal(rolesList.data.ok, true);
        assert.equal(Array.isArray(rolesList.data.roles), true);
        assert.equal(rolesList.data.roles.some((x) => x.user === 'local-user' && x.role === 'viewer'), true);

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'owner' });
        const inviteCreate = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites',
          body: { workspace: 'default', role: 'operator', expiresInHours: 72, baseUrl: 'http://127.0.0.1:1310' }
        });
        assert.equal(inviteCreate.status, 200);
        assert.equal(inviteCreate.data.ok, true);
        assert.equal(typeof inviteCreate.data.invite.token, 'string');
        assert.equal(String(inviteCreate.data.invite.acceptUrl || '').includes('?invite='), true);

        const inviteList = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/invites?workspace=default'
        });
        assert.equal(inviteList.status, 200);
        assert.equal(inviteList.data.ok, true);
        assert.equal(Array.isArray(inviteList.data.invites), true);
        assert.equal(inviteList.data.invites.length > 0, true);
        assert.equal(String(inviteList.data.invites[0].token || ''), '');

        const inviteStats = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/team/invites/stats?workspace=default&days=30'
        });
        assert.equal(inviteStats.status, 200);
        assert.equal(inviteStats.data.ok, true);
        assert.equal(typeof inviteStats.data.stats.active, 'number');
        assert.equal(typeof inviteStats.data.stats.avgAcceptMs, 'number');

        const inviteResend = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites/resend',
          body: { workspace: 'default', id: inviteCreate.data.invite.id, baseUrl: 'http://127.0.0.1:1310' }
        });
        assert.equal(inviteResend.status, 200);
        assert.equal(inviteResend.data.ok, true);
        assert.equal(typeof inviteResend.data.invite.token, 'string');
        assert.equal(String(inviteResend.data.invite.acceptUrl || '').includes('?invite='), true);

        const inviteAcceptOld = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites/accept',
          body: { token: inviteCreate.data.invite.token, user: 'invite-user-old' }
        });
        assert.equal(inviteAcceptOld.status, 400);
        assert.equal(inviteAcceptOld.data.ok, false);

        const inviteAccept = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/team/invites/accept',
          body: { token: inviteResend.data.invite.token, user: 'invite-user' }
        });
        assert.equal(inviteAccept.status, 200);
        assert.equal(inviteAccept.data.ok, true);
        assert.equal(inviteAccept.data.invite.status, 'accepted');
        assert.equal(opsStorage.getRole({ workspace: 'default', user: 'invite-user' }), 'operator');
        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'viewer' });

        const deniedResolve = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/approvals/resolve',
          body: { workspace: 'default', id: approvals.data.approvals[0].id, decision: 'approve' }
        });
        assert.equal(deniedResolve.status, 400);
        assert.equal(deniedResolve.data.ok, false);
        assert.equal(String(deniedResolve.data.error || '').includes('Permission denied'), true);

        opsStorage.setRole({ workspace: 'default', user: 'local-user', role: 'operator' });

        const ack = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/alerts/ack',
          body: { workspace: 'default', id: alerts.data.alerts[0].id }
        });
        assert.equal(ack.status, 200);
        assert.equal(ack.data.ok, true);
        assert.equal(ack.data.alert.status, 'acked');

        const resolve = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/ops/approvals/resolve',
          body: { workspace: 'default', id: approvals.data.approvals[0].id, decision: 'approve' }
        });
        assert.equal(resolve.status, 200);
        assert.equal(resolve.data.ok, true);
        assert.equal(resolve.data.approval.status, 'approved');
      } finally {
        await server.stop();
        process.env.META_CLI_HOME = oldHome;
        process.env.SOCIAL_CLI_HOME = oldSocialHome;
        if (oldSocialUser === undefined) delete process.env.SOCIAL_USER;
        else process.env.SOCIAL_USER = oldSocialUser;
        if (typeof config.setOperator === 'function') {
          config.setOperator({
            id: String(oldOperator.id || ''),
            name: String(oldOperator.name || '')
          });
        }
      }
    }
  },
  {
    name: 'gateway hosted endpoints support BYOK vault, orchestration, recipes, and triggers',
    fn: async () => {
      const oldMetaHome = process.env.META_CLI_HOME;
      const oldHostedMaster = process.env.SOCIAL_HOSTED_MASTER_KEY;
      const oldBootstrapKey = process.env.SOCIAL_HOSTED_BOOTSTRAP_API_KEY;
      const oldBootstrapUser = process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_ID;
      const oldAutoProvision = process.env.SOCIAL_HOSTED_AUTO_PROVISION;
      const oldRecipesDir = process.env.SOCIAL_HOSTED_RECIPES_DIR;
      const oldTriggersDir = process.env.SOCIAL_HOSTED_TRIGGERS_DIR;

      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'social-hosted-gw-'));
      const recipesDir = path.join(tempHome, 'recipes');
      const triggersDir = path.join(tempHome, 'triggers');
      fs.mkdirSync(recipesDir, { recursive: true });
      fs.mkdirSync(triggersDir, { recursive: true });

      process.env.META_CLI_HOME = tempHome;
      process.env.SOCIAL_HOSTED_MASTER_KEY = 'test-hosted-master-key-001';
      process.env.SOCIAL_HOSTED_BOOTSTRAP_API_KEY = 'user-hosted-api-key';
      process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_ID = 'hosted-user';
      process.env.SOCIAL_HOSTED_AUTO_PROVISION = '0';
      process.env.SOCIAL_HOSTED_RECIPES_DIR = recipesDir;
      process.env.SOCIAL_HOSTED_TRIGGERS_DIR = triggersDir;

      const server = createGatewayServer({ host: '127.0.0.1', port: 0 });
      try {
        await server.start();

        const hostedHeaders = { 'x-api-key': 'user-hosted-api-key' };

        const unauthKeys = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/keys'
        });
        assert.equal(unauthKeys.status, 401);

        const addKey = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/keys',
          headers: hostedHeaders,
          body: { service: 'openai', key: 'sk-hosted-example-key', label: 'primary-llm' }
        });
        assert.equal(addKey.status, 200);
        assert.equal(addKey.data.ok, true);
        assert.equal(addKey.data.key.service, 'openai');

        const keys = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/keys',
          headers: hostedHeaders
        });
        assert.equal(keys.status, 200);
        assert.equal(keys.data.ok, true);
        assert.equal(Array.isArray(keys.data.keys), true);
        assert.equal(keys.data.keys.length >= 1, true);
        assert.equal(String(keys.data.keys[0].keyMask || '').includes('...'), true);
        assert.equal(JSON.stringify(keys.data).includes('sk-hosted-example-key'), false);

        const tools = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/tools',
          headers: hostedHeaders
        });
        assert.equal(tools.status, 200);
        assert.equal(tools.data.ok, true);
        assert.equal(Array.isArray(tools.data.tools), true);
        assert.equal(tools.data.tools.some((row) => row.key === 'meta.status'), true);
        assert.equal(tools.data.tools.some((row) => row.key === 'browser.fetch_page'), true);
        assert.equal(tools.data.tools.some((row) => row.key === 'browser.session_create'), true);
        assert.equal(tools.data.tools.some((row) => row.key === 'browser.goto'), true);

        const agents = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/agents',
          headers: hostedHeaders
        });
        assert.equal(agents.status, 200);
        assert.equal(agents.data.ok, true);
        assert.equal(Array.isArray(agents.data.agents), true);
        assert.equal(agents.data.agents.some((row) => row.slug === 'ops-agent'), true);
        assert.equal(agents.data.agents.some((row) => row.slug === 'browser-agent'), true);

        const addAgent = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/agents',
          headers: hostedHeaders,
          body: {
            slug: 'custom-ops',
            name: 'Custom Ops',
            description: 'Status + logs',
            tools: ['meta.status', 'gateway.logs']
          }
        });
        assert.equal(addAgent.status, 200);
        assert.equal(addAgent.data.ok, true);
        assert.equal(addAgent.data.agent.slug, 'custom-ops');

        const saveRecipe = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/recipes',
          headers: hostedHeaders,
          body: {
            format: 'json',
            recipe: {
              slug: 'daily-status',
              name: 'Daily Status',
              mode: 'sequential',
              steps: [
                { agent_slug: 'ops-agent', action_key: 'status', action_props: {} },
                { agent_slug: 'analytics-agent', action_key: 'logs', action_props: { limit: 1 } }
              ]
            }
          }
        });
        assert.equal(saveRecipe.status, 200);
        assert.equal(saveRecipe.data.ok, true);
        assert.equal(saveRecipe.data.recipe.slug, 'daily-status');

        const runRecipe = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/recipes/daily-status/run',
          headers: hostedHeaders,
          body: { input: {} }
        });
        assert.equal(runRecipe.status, 200);
        assert.equal(runRecipe.data.ok, true);
        assert.equal(runRecipe.data.recipe_slug, 'daily-status');
        assert.equal(Array.isArray(runRecipe.data.results), true);
        assert.equal(runRecipe.data.results.length >= 1, true);

        const orchestrate = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/orchestrate',
          headers: hostedHeaders,
          body: {
            task: 'Run hosted status pipeline',
            pipeline: {
              mode: 'sequential',
              steps: [
                { agent_slug: 'ops-agent', action_key: 'status', action_props: {} },
                { agent_slug: 'analytics-agent', action_key: 'logs', action_props: { limit: 1 } }
              ]
            }
          }
        });
        assert.equal(orchestrate.status, 200);
        assert.equal(orchestrate.data.ok, true);
        assert.equal(orchestrate.data.byok.provider, 'openai');
        assert.equal(Array.isArray(orchestrate.data.results), true);
        assert.equal(orchestrate.data.results.length, 2);

        const createWebhookTrigger = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/triggers',
          headers: hostedHeaders,
          body: {
            name: 'Daily Status Webhook',
            type: 'webhook',
            recipe_slug: 'daily-status'
          }
        });
        assert.equal(createWebhookTrigger.status, 200);
        assert.equal(createWebhookTrigger.data.ok, true);
        assert.equal(createWebhookTrigger.data.trigger.type, 'webhook');
        assert.equal(typeof createWebhookTrigger.data.trigger.webhook_token, 'string');
        assert.equal(createWebhookTrigger.data.trigger.webhook_token.length > 8, true);

        const fireWebhook = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: `/api/triggers/webhook/${encodeURIComponent(createWebhookTrigger.data.trigger.webhook_token)}`,
          body: { source: 'test-webhook' }
        });
        assert.equal(fireWebhook.status, 200);
        assert.equal(fireWebhook.data.ok, true);
        assert.equal(fireWebhook.data.trigger.type, 'webhook');

        const cliExecute = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/cli/execute',
          headers: hostedHeaders,
          body: {
            argv: ['--help'],
            timeoutMs: 20000
          }
        });
        assert.equal(cliExecute.status, 200);
        assert.equal(cliExecute.data.ok, true);
        assert.equal(typeof cliExecute.data.result.exitCode, 'number');

        const createWidgetKey = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/channels/webchat/widget-keys',
          headers: hostedHeaders,
          body: { label: 'site-widget' }
        });
        assert.equal(createWidgetKey.status, 200);
        assert.equal(createWidgetKey.data.ok, true);
        assert.equal(typeof createWidgetKey.data.key.id, 'string');
        assert.equal(typeof createWidgetKey.data.key.key, 'string');
        assert.equal(createWidgetKey.data.key.key.startsWith('wk_'), true);

        const startPublicWebchat = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/webchat/public/session/start',
          body: {
            widgetKey: createWidgetKey.data.key.key,
            visitorId: 'visitor-test-01'
          }
        });
        assert.equal(startPublicWebchat.status, 200);
        assert.equal(startPublicWebchat.data.ok, true);
        assert.equal(typeof startPublicWebchat.data.session.id, 'string');
        assert.equal(typeof startPublicWebchat.data.sessionToken, 'string');
        assert.equal(startPublicWebchat.data.sessionToken.length > 12, true);

        const publicWebchatMessage = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/webchat/public/session/message',
          body: {
            sessionToken: startPublicWebchat.data.sessionToken,
            text: 'Hello from public widget'
          }
        });
        assert.equal(publicWebchatMessage.status, 200);
        assert.equal(publicWebchatMessage.data.ok, true);
        assert.equal(publicWebchatMessage.data.session.id, startPublicWebchat.data.session.id);

        const webchatSessions = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/channels/webchat/sessions?limit=20',
          headers: hostedHeaders
        });
        assert.equal(webchatSessions.status, 200);
        assert.equal(webchatSessions.data.ok, true);
        assert.equal(Array.isArray(webchatSessions.data.sessions), true);
        assert.equal(webchatSessions.data.sessions.length > 0, true);

        const webchatReply = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: `/api/channels/webchat/sessions/${encodeURIComponent(startPublicWebchat.data.session.id)}/reply`,
          headers: hostedHeaders,
          body: { text: 'Operator reply test' }
        });
        assert.equal(webchatReply.status, 200);
        assert.equal(webchatReply.data.ok, true);

        const webchatMessages = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: `/api/channels/webchat/sessions/${encodeURIComponent(startPublicWebchat.data.session.id)}/messages?limit=20`,
          headers: hostedHeaders
        });
        assert.equal(webchatMessages.status, 200);
        assert.equal(webchatMessages.data.ok, true);
        assert.equal(Array.isArray(webchatMessages.data.messages), true);
        assert.equal(webchatMessages.data.messages.length >= 2, true);

        const webchatClose = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: `/api/channels/webchat/sessions/${encodeURIComponent(startPublicWebchat.data.session.id)}/status`,
          headers: hostedHeaders,
          body: { status: 'closed' }
        });
        assert.equal(webchatClose.status, 200);
        assert.equal(webchatClose.data.ok, true);
        assert.equal(webchatClose.data.session.status, 'closed');

        const createBaileysSession = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: '/api/channels/baileys/sessions',
          headers: hostedHeaders,
          body: {
            label: 'wa-web-primary',
            phone: '+14155550123'
          }
        });
        assert.equal(createBaileysSession.status, 200);
        assert.equal(createBaileysSession.data.ok, true);
        assert.equal(typeof createBaileysSession.data.session.id, 'string');

        const baileysSessions = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/channels/baileys/sessions?limit=20',
          headers: hostedHeaders
        });
        assert.equal(baileysSessions.status, 200);
        assert.equal(baileysSessions.data.ok, true);
        assert.equal(Array.isArray(baileysSessions.data.sessions), true);
        assert.equal(
          baileysSessions.data.sessions.some((row) => row.id === createBaileysSession.data.session.id),
          true
        );

        const connectBaileysSession = await requestJson({
          port: server.port,
          method: 'POST',
          pathName: `/api/channels/baileys/sessions/${encodeURIComponent(createBaileysSession.data.session.id)}/connect`,
          headers: hostedHeaders,
          body: {}
        });
        assert.equal([200, 503].includes(connectBaileysSession.status), true);
        if (connectBaileysSession.status === 503) {
          assert.equal(String(connectBaileysSession.data.error || '').includes('Baileys dependency'), true);
        } else {
          assert.equal(connectBaileysSession.data.ok, true);
        }

        const baileysMessages = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: `/api/channels/baileys/sessions/${encodeURIComponent(createBaileysSession.data.session.id)}/messages?limit=20`,
          headers: hostedHeaders
        });
        assert.equal(baileysMessages.status, 200);
        assert.equal(baileysMessages.data.ok, true);
        assert.equal(Array.isArray(baileysMessages.data.messages), true);

        const deleteBaileysSession = await requestJson({
          port: server.port,
          method: 'DELETE',
          pathName: `/api/channels/baileys/sessions/${encodeURIComponent(createBaileysSession.data.session.id)}`,
          headers: hostedHeaders
        });
        assert.equal(deleteBaileysSession.status, 200);
        assert.equal(deleteBaileysSession.data.ok, true);
        assert.equal(deleteBaileysSession.data.deleted, true);

        const logs = await requestJson({
          port: server.port,
          method: 'GET',
          pathName: '/api/logs?limit=20',
          headers: hostedHeaders
        });
        assert.equal(logs.status, 200);
        assert.equal(logs.data.ok, true);
        assert.equal(Array.isArray(logs.data.logs), true);
        assert.equal(logs.data.logs.length > 0, true);
      } finally {
        await server.stop();

        if (oldMetaHome === undefined) delete process.env.META_CLI_HOME;
        else process.env.META_CLI_HOME = oldMetaHome;
        if (oldHostedMaster === undefined) delete process.env.SOCIAL_HOSTED_MASTER_KEY;
        else process.env.SOCIAL_HOSTED_MASTER_KEY = oldHostedMaster;
        if (oldBootstrapKey === undefined) delete process.env.SOCIAL_HOSTED_BOOTSTRAP_API_KEY;
        else process.env.SOCIAL_HOSTED_BOOTSTRAP_API_KEY = oldBootstrapKey;
        if (oldBootstrapUser === undefined) delete process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_ID;
        else process.env.SOCIAL_HOSTED_BOOTSTRAP_USER_ID = oldBootstrapUser;
        if (oldAutoProvision === undefined) delete process.env.SOCIAL_HOSTED_AUTO_PROVISION;
        else process.env.SOCIAL_HOSTED_AUTO_PROVISION = oldAutoProvision;
        if (oldRecipesDir === undefined) delete process.env.SOCIAL_HOSTED_RECIPES_DIR;
        else process.env.SOCIAL_HOSTED_RECIPES_DIR = oldRecipesDir;
        if (oldTriggersDir === undefined) delete process.env.SOCIAL_HOSTED_TRIGGERS_DIR;
        else process.env.SOCIAL_HOSTED_TRIGGERS_DIR = oldTriggersDir;
      }
    }
  }
];
