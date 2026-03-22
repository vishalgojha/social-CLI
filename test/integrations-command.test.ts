const assert = require('node:assert/strict');

const integrations = require('../commands/integrations');

module.exports = [
  {
    name: 'integrations formats WABA check labels',
    fn: () => {
      const label = integrations._private.formatCheckLabel('waba_id');
      assert.equal(label, 'WhatsApp Business account (WABA) ID');
    }
  },
  {
    name: 'integrations normalizes expired token errors',
    fn: () => {
      const msg = integrations._private.normalizeMetaError('Error validating access token: Session has expired on 2026-01-01.');
      assert.equal(msg, 'Access token expired.');
    }
  },
  {
    name: 'integrations normalizes unauthorized app errors',
    fn: () => {
      const msg = integrations._private.normalizeMetaError('Error validating access token: The user has not authorized application 123');
      assert.equal(msg, 'App not authorized for this token.');
    }
  },
  {
    name: 'integrations normalizes unsupported get request errors',
    fn: () => {
      const msg = integrations._private.normalizeMetaError('Unsupported get request.');
      assert.equal(msg, 'Token valid but resource not found or insufficient permissions.');
    }
  },
  {
    name: 'integrations recommends scopes when missing',
    fn: () => {
      const fix = integrations._private.fixForCheck('required_scopes');
      assert.match(fix, /whatsapp_business_messaging/);
      assert.match(fix, /whatsapp_business_management/);
    }
  }
];
