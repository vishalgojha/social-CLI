const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { exportInsights } = require('../lib/marketing');

module.exports = [
  {
    name: 'exportInsights writes and appends CSV without duplicating headers',
    fn: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-cli-export-'));
      try {
        const file = path.join(dir, 'out.csv');
        const rows1 = [{ a: '1', b: 'x' }, { a: '2', b: 'y' }];
        const rows2 = [{ a: '3', b: 'z' }];

        exportInsights({ rows: rows1, exportPath: file, format: 'csv', append: false });
        exportInsights({ rows: rows2, exportPath: file, format: 'csv', append: true });

        const text = fs.readFileSync(file, 'utf8');
        const lines = text.trim().split('\n');
        assert.equal(lines[0], 'a,b');
        assert.equal(lines.length, 1 + rows1.length + rows2.length);
        assert.equal(lines.filter((l) => l === 'a,b').length, 1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'exportInsights appends JSON into an array when possible',
    fn: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-cli-export-'));
      try {
        const file = path.join(dir, 'out.json');
        exportInsights({ rows: [{ a: 1 }], exportPath: file, format: 'json', append: false });
        exportInsights({ rows: [{ a: 2 }], exportPath: file, format: 'json', append: true });

        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(Array.isArray(parsed), true);
        assert.equal(parsed.length, 2);
        assert.equal(parsed[0].a, 1);
        assert.equal(parsed[1].a, 2);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
];

