const assert = require('node:assert/strict');

const { MetaApiClient, sanitizeForLog } = require('../lib/api');

module.exports = [
  {
    name: 'sanitizeForLog redacts tokens and secrets recursively',
    fn: () => {
      const input = {
        access_token: 'EAAB123',
        client_secret: 'shh',
        nested: {
          token: 'secret',
          other: 1,
          arr: [{ access_token: 'x' }, { ok: true }]
        }
      };

      const out = sanitizeForLog(input);
      assert.equal(out.access_token, '***redacted***');
      assert.equal(out.client_secret, '***redacted***');
      assert.equal(out.nested.token, '***redacted***');
      assert.equal(out.nested.other, 1);
      assert.equal(out.nested.arr[0].access_token, '***redacted***');
      assert.equal(out.nested.arr[1].ok, true);
    }
  },
  {
    name: 'MetaApiClient retries on 429 without sleeping in tests (setTimeout patched)',
    fn: async () => {
      const realSetTimeout = global.setTimeout;
      const realWarn = console.warn;
      global.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);
      console.warn = () => {};

      try {
        const client = new MetaApiClient({ token: 't', apiVersion: 'v20.0' });

        let calls = 0;
        client.http.request = async () => {
          calls += 1;
          if (calls === 1) {
            const err = new Error('rate limited');
            err.response = { status: 429, data: { error: { code: 613, message: 'rate limit' } } };
            throw err;
          }
          return { data: { ok: true } };
        };

        const res = await client.request('GET', '/me', { maxRetries: 3 });
        assert.equal(res.ok, true);
        assert.equal(calls, 2);
      } finally {
        global.setTimeout = realSetTimeout;
        console.warn = realWarn;
      }
    }
  }
];
