const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MetaAPIClient = require('../lib/api-client');
const { aiParseIntent, heuristicParse, parseJsonPayload, parseDateTimeFromText } = require('../lib/ai/parser');
const { validateIntent } = require('../lib/ai/validator');
const { executeIntent } = require('../lib/ai/executor');
const { parseUserChoice } = require('../lib/ui/confirm');
const { normalizeRisk, confirmationPromptForRisk } = require('../lib/ui/risk-policy');

module.exports = [
  {
    name: 'parser: parseJsonPayload extracts JSON from wrapped text',
    fn: () => {
      const wrapped = 'Here is your JSON:\n{"action":"query_pages","api":"facebook","confidence":0.9}';
      const parsed = parseJsonPayload(wrapped);
      assert.equal(parsed.action, 'query_pages');
      assert.equal(parsed.api, 'facebook');
    }
  },
  {
    name: 'parser: heuristicParse detects whatsapp send',
    fn: () => {
      const intent = heuristicParse("send 'Order confirmed' to +15551234567 via WhatsApp");
      assert.equal(intent.action, 'post_whatsapp');
      assert.equal(intent.phone, '+15551234567');
      assert.equal(intent.message, 'Order confirmed');
    }
  },
  {
    name: 'parser: heuristicParse treats "my Facebook page" as generic page reference',
    fn: () => {
      const intent = heuristicParse("post 'test' to my Facebook page");
      assert.equal(intent.action, 'post_facebook');
      assert.equal(intent.page, null);
    }
  },
  {
    name: 'parser: heuristicParse detects "do I have a Facebook page"',
    fn: () => {
      const intent = heuristicParse('do i have a facebook page?');
      assert.equal(intent.action, 'query_pages');
      assert.equal(intent.api, 'facebook');
    }
  },
  {
    name: 'parser: heuristicParse detects whatsapp phone-number listing intent',
    fn: () => {
      const intent = heuristicParse('do i have any mobile number listed for business id 1234567890');
      assert.equal(intent.action, 'query_whatsapp_phone_numbers');
      assert.equal(intent.api, 'whatsapp');
      assert.equal(intent.businessId, '1234567890');
    }
  },
  {
    name: 'parser: parseDateTimeFromText parses relative time',
    fn: () => {
      const iso = parseDateTimeFromText('schedule tomorrow at 9am');
      assert.equal(Boolean(iso), true);
      assert.equal(Number.isNaN(Date.parse(iso)), false);
    }
  },
  {
    name: 'parser: aiParseIntent requires API key',
    fn: async () => {
      const keyVars = [
        'OPENAI_API_KEY',
        'META_AI_KEY',
        'SOCIAL_AI_KEY',
        'SOCIAL_CHAT_API_KEY',
        'META_CHAT_API_KEY',
        'SOCIAL_AGENT_API_KEY',
        'META_AGENT_API_KEY'
      ];
      const prev = Object.fromEntries(keyVars.map((k) => [k, process.env[k]]));
      keyVars.forEach((k) => { delete process.env[k]; });
      try {
        await assert.rejects(
          () => aiParseIntent("what are my Facebook pages?", { debug: false }),
          /Missing AI API key/i
        );
      } finally {
        keyVars.forEach((k) => {
          if (prev[k] === undefined) delete process.env[k];
          else process.env[k] = prev[k];
        });
      }
    }
  },
  {
    name: 'validator: catches invalid whatsapp phone format',
    fn: async () => {
      const validation = await validateIntent({
        action: 'post_whatsapp',
        message: 'hello',
        phone: '12345',
        phoneId: '123',
        api: 'whatsapp',
        confidence: 0.8
      }, {
        getDefaultWhatsAppPhoneNumberId: () => ''
      });

      assert.equal(validation.valid, false);
      assert.equal(validation.errors.some((e) => e.includes('E.164')), true);
    }
  },
  {
    name: 'validator: create_campaign requires objective and budget',
    fn: async () => {
      const validation = await validateIntent({
        action: 'create_campaign',
        name: 'Summer Sale',
        objective: null,
        budget: null,
        confidence: 0.8
      }, {});
      assert.equal(validation.valid, false);
      assert.equal(validation.errors.some((e) => e.includes('objective')), true);
      assert.equal(validation.errors.some((e) => e.includes('budget')), true);
    }
  },
  {
    name: 'validator: query_whatsapp_phone_numbers requires businessId',
    fn: async () => {
      const validation = await validateIntent({
        action: 'query_whatsapp_phone_numbers',
        api: 'whatsapp',
        businessId: null,
        confidence: 0.8
      }, {});
      assert.equal(validation.valid, false);
      assert.equal(validation.errors.some((e) => e.includes('businessId')), true);
    }
  },
  {
    name: 'executor: query_me maps to MetaAPIClient.getMe',
    fn: async () => {
      const oldGetMe = MetaAPIClient.prototype.getMe;
      try {
        let called = false;
        MetaAPIClient.prototype.getMe = async function patched(fields) {
          called = true;
          assert.equal(fields, 'id,name');
          return { id: '1', name: 'Alice' };
        };

        const result = await executeIntent({
          action: 'query_me',
          api: 'facebook',
          fields: ['id', 'name']
        }, {
          getToken: () => 'fake-token',
          getDefaultApi: () => 'facebook'
        });

        assert.equal(result.success, true);
        assert.equal(called, true);
        assert.equal(result.data.name, 'Alice');
      } finally {
        MetaAPIClient.prototype.getMe = oldGetMe;
      }
    }
  },
  {
    name: 'executor: post_whatsapp maps to sendWhatsAppMessage',
    fn: async () => {
      const oldSend = MetaAPIClient.prototype.sendWhatsAppMessage;
      try {
        let called = false;
        MetaAPIClient.prototype.sendWhatsAppMessage = async function patched(phoneId, body) {
          called = true;
          assert.equal(phoneId, '123456');
          assert.equal(body.to, '+15551234567');
          return { messages: [{ id: 'wamid.1' }] };
        };

        const result = await executeIntent({
          action: 'post_whatsapp',
          message: 'hello',
          phone: '+15551234567',
          phoneId: '123456',
          allowReplay: true
        }, {
          getToken: (api) => (api === 'whatsapp' ? 'fake-token' : '')
        });

        assert.equal(result.success, true);
        assert.equal(called, true);
        assert.equal(result.data.messages[0].id, 'wamid.1');
      } finally {
        MetaAPIClient.prototype.sendWhatsAppMessage = oldSend;
      }
    }
  },
  {
    name: 'executor: query_whatsapp_phone_numbers maps to listWhatsAppPhoneNumbers',
    fn: async () => {
      const oldList = MetaAPIClient.prototype.listWhatsAppPhoneNumbers;
      try {
        let called = false;
        MetaAPIClient.prototype.listWhatsAppPhoneNumbers = async function patched(wabaId) {
          called = true;
          assert.equal(wabaId, '1234567890');
          return {
            data: [
              {
                id: '111',
                display_phone_number: '+15551234567',
                verified_name: 'Test',
                quality_rating: 'GREEN',
                name_status: 'APPROVED'
              }
            ]
          };
        };

        const result = await executeIntent({
          action: 'query_whatsapp_phone_numbers',
          api: 'whatsapp',
          businessId: '1234567890'
        }, {
          getToken: (api) => (api === 'whatsapp' ? 'fake-token' : '')
        });

        assert.equal(result.success, true);
        assert.equal(called, true);
        assert.equal(result.data.businessId, '1234567890');
        assert.equal(result.data.data[0].display_phone_number, '+15551234567');
      } finally {
        MetaAPIClient.prototype.listWhatsAppPhoneNumbers = oldList;
      }
    }
  },
  {
    name: 'executor: unsupported action returns structured failure',
    fn: async () => {
      const result = await executeIntent({ action: 'not_real_action' }, {});
      assert.equal(result.success, false);
      assert.equal(typeof result.error, 'string');
      assert.equal(Boolean(result.metadata), true);
    }
  },
  {
    name: 'executor: write action idempotency skips duplicate execution',
    fn: async () => {
      const oldHome = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-idem-test-'));
      try {
        const cfg = {
          setDefaultFacebookPageId: () => {}
        };
        const intent = {
          action: 'set_default_account',
          platform: 'facebook',
          accountId: '12345'
        };
        const first = await executeIntent(intent, cfg);
        assert.equal(first.success, true);
        const second = await executeIntent(intent, cfg);
        assert.equal(second.success, true);
        assert.equal(second.data.status, 'idempotent_skip');
        assert.equal(Boolean(second.data.idempotencyKey), true);
      } finally {
        process.env.META_CLI_HOME = oldHome;
      }
    }
  },
  {
    name: 'executor: transient write retries are logged in metadata',
    fn: async () => {
      const oldSend = MetaAPIClient.prototype.sendWhatsAppMessage;
      try {
        let attempts = 0;
        MetaAPIClient.prototype.sendWhatsAppMessage = async function patched() {
          attempts += 1;
          if (attempts === 1) {
            const err = new Error('temporary');
            err.code = 'ETIMEDOUT';
            throw err;
          }
          return { messages: [{ id: 'wamid.retry' }] };
        };

        const result = await executeIntent({
          action: 'post_whatsapp',
          message: 'hello',
          phone: '+15551234567',
          phoneId: '123456',
          allowReplay: true
        }, {
          getToken: (api) => (api === 'whatsapp' ? 'fake-token' : '')
        });

        assert.equal(result.success, true);
        assert.equal(attempts, 2);
        const logs = Array.isArray(result.metadata?.runtimeLogs) ? result.metadata.runtimeLogs.join('\n') : '';
        assert.equal(logs.includes('retry 2/3'), true);
      } finally {
        MetaAPIClient.prototype.sendWhatsAppMessage = oldSend;
      }
    }
  },
  {
    name: 'confirmation: parseUserChoice understands shortcuts',
    fn: () => {
      assert.equal(parseUserChoice(''), 'y');
      assert.equal(parseUserChoice('Yes'), 'y');
      assert.equal(parseUserChoice('n'), 'n');
      assert.equal(parseUserChoice('edit'), 'edit');
      assert.equal(parseUserChoice('d'), 'details');
    }
  },
  {
    name: 'risk policy: normalizeRisk maps unknown to low',
    fn: () => {
      assert.equal(normalizeRisk('HIGH'), 'high');
      assert.equal(normalizeRisk('medium'), 'medium');
      assert.equal(normalizeRisk('anything_else'), 'low');
    }
  },
  {
    name: 'risk policy: confirmation copy is explicit for high risk',
    fn: () => {
      const cli = confirmationPromptForRisk('high', { surface: 'cli' });
      const chat = confirmationPromptForRisk('high', { surface: 'chat' });
      assert.equal(cli.toLowerCase().includes('high risk'), true);
      assert.equal(chat.toLowerCase().includes('reply \"yes\"'), true);
    }
  }
];
