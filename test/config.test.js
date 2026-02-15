const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configSingleton = require('../lib/config');

function withTempHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-cli-test-'));
  const prev = process.env.META_CLI_HOME;
  process.env.META_CLI_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.META_CLI_HOME;
    else process.env.META_CLI_HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = [
  {
    name: 'profiles isolate tokens and defaults',
    fn: () => withTempHome(() => {
      const { ConfigManager } = configSingleton;
      const cfg = new ConfigManager();

      assert.equal(cfg.getActiveProfile(), 'default');
      assert.equal(cfg.listProfiles().includes('default'), true);

      const p = cfg.createProfile('clientA');
      assert.equal(p, 'clientA');

      cfg.setActiveProfile('clientA');
      cfg.setToken('facebook', 'EAABxxxx');
      cfg.setDefaultMarketingAdAccountId('act_123');

      cfg.setActiveProfile('default');
      assert.equal(cfg.getToken('facebook'), '');
      assert.equal(cfg.getDefaultMarketingAdAccountId(), '');
    })
  },
  {
    name: 'legacy config migrates into profiles.default',
    fn: () => withTempHome((dir) => {
      const legacy = {
        apiVersion: 'v19.0',
        defaultApi: 'facebook',
        tokens: { facebook: 'EAABLEGACY' },
        defaults: { marketingAdAccountId: 'act_999' }
      };

      const cfgPath = path.join(dir, '.meta-cli', 'config.json');
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, JSON.stringify(legacy, null, 2), 'utf8');

      const { ConfigManager } = configSingleton;
      const cfg = new ConfigManager();
      assert.equal(cfg.getActiveProfile(), 'default');
      assert.equal(cfg.getApiVersion(), 'v19.0');
      assert.equal(cfg.getToken('facebook'), 'EAABLEGACY');
      assert.equal(cfg.getDefaultMarketingAdAccountId(), 'act_999');
    })
  }
];

