const assert = require('node:assert/strict');
const { aiParseIntent } = require('../lib/ai/parser');

const TOP_PROMPTS = [
  ['connect facebook account account id act_123', 'connect_account'],
  ['set default account facebook account id act_123', 'set_default_account'],
  ['refresh token for facebook account id act_123', 'refresh_token'],
  ['verify trust package social-ops', 'verify_trust'],
  ['install package social-ops', 'install_hub_package'],
  ['update packages', 'update_hub_packages'],
  ['rollback social-ops', 'rollback_update'],
  ['inspect intent create_campaign', 'inspect_intent']
];

module.exports = [
  {
    name: 'prompt regression: contract prompts map deterministically',
    fn: async () => {
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      process.env.OPENAI_API_KEY = 'prompt-regression-key';
      delete process.env.META_AI_KEY;
      try {
        // eslint-disable-next-line no-restricted-syntax
        for (const [prompt, expected] of TOP_PROMPTS) {
          // eslint-disable-next-line no-await-in-loop
          const intent = await aiParseIntent(prompt);
          assert.equal(
            intent.action,
            expected,
            `Prompt "${prompt}" mapped to "${intent.action}" instead of "${expected}"`
          );
        }
      } finally {
        if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta === undefined) delete process.env.META_AI_KEY;
        else process.env.META_AI_KEY = oldMeta;
      }
    }
  }
];
