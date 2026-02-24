const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const hub = require('../lib/hub/storage');

function withTempHome(fn) {
  const oldSocial = process.env.SOCIAL_CLI_HOME;
  const oldMeta = process.env.META_CLI_HOME;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-hub-test-'));
  process.env.SOCIAL_CLI_HOME = dir;
  process.env.META_CLI_HOME = '';
  hub.resetCacheForTests();
  try {
    return fn(dir);
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
  },
  {
    name: 'hub publish signs package and trust-enforced install verifies signature',
    fn: () => withTempHome(() => {
      const keys = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      hub.setTrustPolicy({ mode: 'enforce', requireSigned: true });
      hub.allowPublisher('acme-labs');
      hub.setTrustedKey('acme-labs', keys.publicKey);

      const manifest = {
        id: 'connector.acme.alerts',
        name: 'ACME Alerts',
        type: 'connector',
        description: 'ACME signed connector.',
        tags: ['ops', 'connector'],
        version: '1.0.0',
        publisher: 'acme-labs',
        changelog: 'Initial signed release.',
        manifest: {
          entrypoint: 'social ops integrations set --workspace <workspace> --outbound-webhook <url>',
          requiredEnv: ['ACME_WEBHOOK_URL'],
          requiredScopes: [],
          risk: 'medium'
        }
      };

      const pub = hub.publishPackage(manifest, {
        privateKeyPem: keys.privateKey,
        sign: true
      });
      assert.equal(pub.signed, true);
      assert.equal(Boolean(pub.version.signature), true);

      const install = hub.installPackage('connector.acme.alerts@1.0.0');
      assert.equal(install.trust.ok, true);
      assert.equal(install.trust.errors.length, 0);
    })
  },
  {
    name: 'hub trust enforce blocks unsigned package installation',
    fn: () => withTempHome(() => {
      hub.setTrustPolicy({ mode: 'enforce', requireSigned: true });
      assert.throws(
        () => hub.installPackage('connector.slack.alerts'),
        /Trust check failed/
      );
    })
  },
  {
    name: 'hub sync merges catalog entries from file source',
    fn: async () => withTempHome(async (homeDir) => {
      const src = path.join(homeDir, 'hub-source.json');
      fs.writeFileSync(src, JSON.stringify({
        packages: [
          {
            id: 'playbook.weekly-report',
            name: 'Weekly Report Playbook',
            type: 'playbook',
            description: 'Generate weekly report summaries.',
            tags: ['reports', 'playbook'],
            versions: [
              {
                version: '1.0.0',
                publishedAt: '2026-02-16T00:00:00.000Z',
                changelog: 'Initial release.',
                publisher: 'acme-labs',
                manifest: {
                  entrypoint: 'social ops outcomes list --workspace <workspace>',
                  requiredEnv: [],
                  requiredScopes: [],
                  risk: 'low'
                }
              }
            ]
          }
        ]
      }, null, 2), 'utf8');

      const synced = await hub.syncCatalog({ source: src, merge: true });
      assert.equal(synced.incomingCount, 1);
      const rows = hub.searchCatalog({ query: 'weekly report' });
      assert.equal(rows.some((x) => x.id === 'playbook.weekly-report'), true);
    })
  }
];
