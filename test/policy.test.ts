const assert = require('node:assert/strict');

const { preflightFor } = require('../lib/policy/preflight');
const { listProfilesForCountry } = require('../lib/policy/region-packs');
const i18n = require('../lib/i18n');

module.exports = [
  {
    name: 'policy preflight strict mode escalates high-risk warnings to blockers',
    fn: () => {
      const report = preflightFor({
        action: 'whatsapp bulk send campaign',
        region: {
          country: 'IN',
          timezone: 'Asia/Kolkata',
          regulatoryMode: 'strict',
          useCase: 'commerce',
          policyProfile: 'commerce'
        }
      });
      assert.equal(report.ok, false);
      assert.equal(report.summary.blockers >= 1, true);
      assert.equal(report.policyProfile, 'commerce');
    }
  },
  {
    name: 'policy profile catalog is available by country',
    fn: () => {
      const rows = listProfilesForCountry('US');
      assert.equal(rows.some((x) => x.id === 'default'), true);
      assert.equal(rows.some((x) => x.id === 'support'), true);
    }
  },
  {
    name: 'i18n supports top locales with quality check',
    fn: () => {
      assert.equal(i18n.normalizeLang('pt-BR'), 'pt');
      const text = i18n.t('doctor_next_steps', {}, 'es');
      assert.equal(text.toLowerCase().includes('siguientes'), true);
      const quality = i18n.qualityCheck('token', 'es');
      assert.equal(quality.ok, false);
      assert.equal(quality.issues.includes('likely_unlocalized_copy'), true);
    }
  }
];
