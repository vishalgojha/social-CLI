const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const studio = require('../commands/studio');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-studio-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = [
  {
    name: 'studio frontend detection prefers dev mode for project root with scripts.dev',
    fn: () => withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'studio-dev-test',
        scripts: {
          dev: 'vite'
        }
      }, null, 2), 'utf8');
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body></body></html>', 'utf8');
      fs.mkdirSync(path.join(dir, 'dist', 'public'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'dist', 'public', 'index.html'), '<!doctype html><html><body>built</body></html>', 'utf8');

      const result = studio._private.detectFrontendPath(dir);
      assert.equal(result.ok, true);
      assert.equal(result.mode, 'dev');
      assert.equal(path.resolve(result.root), path.resolve(dir));
    })
  },
  {
    name: 'studio frontend detection serves static mode for built output path',
    fn: () => withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, 'dist', 'public'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'dist', 'public', 'index.html'), '<!doctype html><html><body>static</body></html>', 'utf8');

      const result = studio._private.detectFrontendPath(dir);
      assert.equal(result.ok, true);
      assert.equal(result.mode, 'static');
      assert.equal(path.resolve(result.root), path.resolve(path.join(dir, 'dist', 'public')));
    })
  },
  {
    name: 'studio frontend detection rejects missing path',
    fn: () => {
      const missing = path.join(os.tmpdir(), `social-studio-missing-${Date.now()}`);
      const result = studio._private.detectFrontendPath(missing);
      assert.equal(result.ok, false);
      assert.equal(String(result.reason || '').includes('Path not found'), true);
    }
  },
  {
    name: 'studio launch target defaults to bundled app when no frontend override is supplied',
    fn: () => {
      const result = studio._private.pickStudioLaunchUrl('', 'http://127.0.0.1:1310/studio/app');
      assert.equal(result, 'http://127.0.0.1:1310/studio/app');
    }
  },
  {
    name: 'studio launch target prefers explicit frontend override when supplied',
    fn: () => {
      const result = studio._private.pickStudioLaunchUrl(
        'http://127.0.0.1:4173',
        'http://127.0.0.1:1310/studio/app'
      );
      assert.equal(result, 'http://127.0.0.1:4173');
    }
  },
  {
    name: 'studio route recovery triggers when gateway health is ok but bundled route is missing',
    fn: () => {
      const result = studio._private.studioRouteNeedsRecovery(
        { status: 200, data: { ok: true } },
        { status: 404, data: {} }
      );
      assert.equal(result, true);
    }
  },
  {
    name: 'studio route recovery does not trigger when bundled route responds 200',
    fn: () => {
      const result = studio._private.studioRouteNeedsRecovery(
        { status: 200, data: { ok: true } },
        { status: 200, data: {} }
      );
      assert.equal(result, false);
    }
  }
];
