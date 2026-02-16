const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hub = require('../lib/hub/storage');

function withTempHome(fn) {
  const oldSocial = process.env.SOCIAL_CLI_HOME;
  const oldMeta = process.env.META_CLI_HOME;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-hub-test-'));
  process.env.SOCIAL_CLI_HOME = dir;
  process.env.META_CLI_HOME = '';
  hub.resetCacheForTests();
  try {
    return fn();
  } finally {
    if (oldSocial === undefined) delete process.env.SOCIAL_CLI_HOME;
    else process.env.SOCIAL_CLI_HOME = oldSocial;
    if (oldMeta === undefined) delete process.env.META_CLI_HOME;
    else process.env.META_CLI_HOME = oldMeta;
    hub.resetCacheForTests();
  }
}

module.exports = [
  {
    name: 'hub search filters built-in catalog by query and type',
    fn: () => withTempHome(() => {
      const rows = hub.searchCatalog({ query: 'slack', type: 'connector' });
      assert.equal(rows.length >= 1, true);
      assert.equal(rows[0].id.includes('connector.'), true);
    })
  },
  {
    name: 'hub install writes lockfile and lists installed packages',
    fn: () => withTempHome(() => {
      const result = hub.installPackage('connector.slack.alerts');
      assert.equal(result.package.id, 'connector.slack.alerts');
      assert.equal(result.version.version, '1.1.0');
      const installed = hub.listInstalled();
      assert.equal(installed.length, 1);
      assert.equal(installed[0].id, 'connector.slack.alerts');
      assert.equal(installed[0].version, '1.1.0');
    })
  },
  {
    name: 'hub install supports explicit version spec',
    fn: () => withTempHome(() => {
      const result = hub.installPackage('connector.slack.alerts@1.0.0');
      assert.equal(result.version.version, '1.0.0');
      const installed = hub.listInstalled();
      assert.equal(installed[0].version, '1.0.0');
    })
  },
  {
    name: 'hub update upgrades installed package to latest',
    fn: () => withTempHome(() => {
      hub.installPackage('connector.slack.alerts@1.0.0');
      const update = hub.updatePackage('connector.slack.alerts');
      assert.equal(update.version.version, '1.1.0');
      assert.equal(update.status, 'updated');
      const installed = hub.listInstalled();
      assert.equal(installed[0].version, '1.1.0');
    })
  },
  {
    name: 'hub semver compare orders versions correctly',
    fn: () => {
      assert.equal(hub.compareSemver('1.2.0', '1.1.9') > 0, true);
      assert.equal(hub.compareSemver('2.0.0', '10.0.0') < 0, true);
      assert.equal(hub.compareSemver('1.0.0', '1.0.0'), 0);
    }
  }
];
