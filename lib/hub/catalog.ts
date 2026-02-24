const BUILTIN_CATALOG = [
  {
    id: 'connector.slack.alerts',
    name: 'Slack Alerts Connector',
    type: 'connector',
    description: 'Routes Ops alerts and approvals into Slack channels.',
    tags: ['ops', 'slack', 'alerts', 'connector'],
    versions: [
      {
        version: '1.1.0',
        publishedAt: '2026-02-16T00:00:00.000Z',
        changelog: 'Adds dedupe metadata and improved approval notifications.',
        publisher: 'chaos-craft-labs',
        manifest: {
          entrypoint: 'social ops integrations set --workspace <workspace> --slack-webhook <url>',
          requiredEnv: ['SLACK_WEBHOOK_URL'],
          requiredScopes: [],
          risk: 'medium'
        }
      },
      {
        version: '1.0.0',
        publishedAt: '2026-02-10T00:00:00.000Z',
        changelog: 'Initial Slack alerts connector release.',
        publisher: 'chaos-craft-labs',
        manifest: {
          entrypoint: 'social ops integrations set --workspace <workspace> --slack-webhook <url>',
          requiredEnv: ['SLACK_WEBHOOK_URL'],
          requiredScopes: [],
          risk: 'medium'
        }
      }
    ]
  },
  {
    id: 'playbook.morning-ops',
    name: 'Morning Ops Playbook',
    type: 'playbook',
    description: 'Daily automation playbook for token health, spend checks, and lead follow-up.',
    tags: ['ops', 'playbook', 'scheduler'],
    versions: [
      {
        version: '1.0.0',
        publishedAt: '2026-02-15T00:00:00.000Z',
        changelog: 'Initial production-ready morning run playbook.',
        publisher: 'chaos-craft-labs',
        manifest: {
          entrypoint: 'social ops morning-run --workspace <workspace> --spend <amount>',
          requiredEnv: [],
          requiredScopes: [],
          risk: 'medium'
        }
      }
    ]
  },
  {
    id: 'skill.whatsapp-followup',
    name: 'WhatsApp Follow-up Skill',
    type: 'skill',
    description: 'Automates follow-up messaging for no-reply leads after approval.',
    tags: ['whatsapp', 'skill', 'ops', 'leads'],
    versions: [
      {
        version: '1.0.0',
        publishedAt: '2026-02-14T00:00:00.000Z',
        changelog: 'Initial release with safe approval-first workflow.',
        publisher: 'chaos-craft-labs',
        manifest: {
          entrypoint: 'social chat --agentic',
          requiredEnv: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
          requiredScopes: ['whatsapp_business_messaging'],
          risk: 'high'
        }
      }
    ]
  }
];

function cloneBuiltinCatalog() {
  return JSON.parse(JSON.stringify(BUILTIN_CATALOG));
}

module.exports = {
  cloneBuiltinCatalog
};
