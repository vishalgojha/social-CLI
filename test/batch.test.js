const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runBatch } = require('../lib/batch');

module.exports = [
  {
    name: 'batch runner reads JSON with UTF-8 BOM',
    fn: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-cli-batch-'));
      const prev = process.env.META_CLI_HOME;
      process.env.META_CLI_HOME = dir;

      try {
        const file = path.join(dir, 'jobs.json');
        const jobs = '[{"id":"1","tool":"auth.status","profile":"default","args":{}}]';
        fs.writeFileSync(file, `\uFEFF${jobs}`, 'utf8');

        const out = await runBatch({ filePath: file, json: true });
        assert.equal(out.results.length, 1);
        assert.equal(out.results[0].ok, true);
        assert.equal(out.results[0].tool, 'auth.status');
      } finally {
        if (prev === undefined) delete process.env.META_CLI_HOME;
        else process.env.META_CLI_HOME = prev;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
];

