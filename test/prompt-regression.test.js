const assert = require('node:assert/strict');
const { aiParseIntent } = require('../lib/ai/parser');

const TOP_PROMPTS = [
  ['show my facebook pages', 'query_pages'],
  ['do i have a facebook page', 'query_pages'],
  ['check my rate limits', 'check_limits'],
  ['who am i on facebook', 'query_me'],
  ['list whatsapp phone numbers for business 1234567890', 'query_whatsapp_phone_numbers'],
  ['post "hello world" to facebook page 12345', 'post_facebook'],
  ['schedule post "launch soon" tomorrow 10am', 'schedule_post'],
  ['send whatsapp message "+14155550123" "hi"', 'post_whatsapp'],
  ['show instagram media for account 178414', 'query_instagram_media'],
  ['get insights for act_123 last 7 days', 'get_analytics'],
  ['list campaigns for act_123', 'list_campaigns'],
  ['create campaign "Spring Sale" objective TRAFFIC budget 5000', 'create_campaign'],
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
    name: 'prompt regression: top 20 agency prompts map deterministically',
    fn: async () => {
      const oldOpenAI = process.env.OPENAI_API_KEY;
      const oldMeta = process.env.META_AI_KEY;
      delete process.env.OPENAI_API_KEY;
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
        if (oldOpenAI) process.env.OPENAI_API_KEY = oldOpenAI;
        if (oldMeta) process.env.META_AI_KEY = oldMeta;
      }
    }
  }
];
