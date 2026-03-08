const assert = require('node:assert/strict');
const onboardCommand = require('../commands/onboard');
const { stripAnsi } = require('../lib/ui/chrome');

const {
  slugifyOperatorId,
  planApiOrder,
  recommendedLoginMode,
  buildApiChoiceLabel
} = onboardCommand._private;

module.exports = [
  {
    name: 'onboard command slugifies operator names for stable ids',
    fn: () => {
      assert.equal(slugifyOperatorId('Vishal Gojha'), 'vishal_gojha');
      assert.equal(slugifyOperatorId('  Social Flow Ops  '), 'social_flow_ops');
      assert.equal(slugifyOperatorId('!!!'), 'operator');
    }
  },
  {
    name: 'onboard command keeps primary api first and removes duplicates',
    fn: () => {
      const planned = planApiOrder('instagram', ['facebook', 'instagram', 'whatsapp', 'facebook']);
      assert.deepEqual(planned, ['instagram', 'facebook', 'whatsapp']);
    }
  },
  {
    name: 'onboard command recommends oauth only when supported and app is configured',
    fn: () => {
      assert.equal(recommendedLoginMode('facebook', { appConfigured: true }), 'oauth');
      assert.equal(recommendedLoginMode('instagram', { appConfigured: false }), 'manual');
      assert.equal(recommendedLoginMode('whatsapp', { appConfigured: true }), 'manual');
    }
  },
  {
    name: 'onboard command api labels surface token previews when already linked',
    fn: () => {
      const label = stripAnsi(buildApiChoiceLabel({
        tokenMap: {
          facebook: 'EAAB0123456789TOKENVALUE',
          instagram: '',
          whatsapp: ''
        }
      }, 'facebook'));

      assert.equal(label.includes('Facebook'), true);
      assert.equal(label.includes('EAAB01...ALUE'), true);
    }
  }
];
