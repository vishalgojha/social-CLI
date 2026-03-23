const assert = require('node:assert/strict');

const ops = require('../commands/ops');

module.exports = [
  {
    name: 'ops center picks approvals as next action',
    fn: () => {
      const next = ops._private.deriveNextOpsAction({ approvalsOpen: 1, alertsOpen: 0, lastMorningRunDate: '' });
      assert.equal(next, 'Review approvals');
    }
  },
  {
    name: 'ops center picks alerts as next action',
    fn: () => {
      const next = ops._private.deriveNextOpsAction({ approvalsOpen: 0, alertsOpen: 2, lastMorningRunDate: '' });
      assert.equal(next, 'Review alerts');
    }
  },
  {
    name: 'ops center recommends morning check when nothing ran',
    fn: () => {
      const next = ops._private.deriveNextOpsAction({ approvalsOpen: 0, alertsOpen: 0, lastMorningRunDate: '' });
      assert.equal(next, 'Run morning check');
    }
  },
  {
    name: 'ops center returns all clear when no blockers',
    fn: () => {
      const next = ops._private.deriveNextOpsAction({ approvalsOpen: 0, alertsOpen: 0, lastMorningRunDate: '2026-03-23' });
      assert.equal(next, 'All clear');
    }
  },
  {
    name: 'ops center snapshot counts open items',
    fn: () => {
      const snap = ops._private.buildOpsCenterSnapshot({
        workspace: 'alpha',
        approvals: [
          { status: 'pending' },
          { status: 'approved' }
        ],
        alerts: [
          { status: 'open' },
          { status: 'acked' }
        ],
        actions: [
          { when: '2026-03-22T10:00:00.000Z', summary: 'Action A' }
        ],
        outcomes: [
          { createdAt: '2026-03-23T10:00:00.000Z', summary: 'Outcome B' }
        ],
        state: { lastMorningRunDate: '2026-03-23' }
      });
      assert.equal(snap.approvalsOpen, 1);
      assert.equal(snap.alertsOpen, 1);
      assert.equal(snap.lastMorningRunDate, '2026-03-23');
      assert.equal(Boolean(snap.lastActivity), true);
    }
  }
];
