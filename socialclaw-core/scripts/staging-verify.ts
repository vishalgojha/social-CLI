import fs from 'node:fs';
import path from 'node:path';

function getEnv(name: string, fallback = ''): string {
  const v = String(process.env[name] || '').trim();
  return v || fallback;
}

async function main() {
  const baseUrl = getEnv('SOCIALCLAW_API_BASE', 'http://127.0.0.1:8080');
  const token = getEnv('SOCIALCLAW_BEARER');
  const clientId = getEnv('SOCIALCLAW_CLIENT_ID');
  const mode = (getEnv('SOCIALCLAW_VERIFY_MODE', 'dry_run') === 'live') ? 'live' : 'dry_run';
  const whatsappTestRecipient = getEnv('SOCIALCLAW_WA_TEST_RECIPIENT');
  const emailTestRecipient = getEnv('SOCIALCLAW_EMAIL_TEST_RECIPIENT');

  if (!token || !clientId || !whatsappTestRecipient || !emailTestRecipient) {
    throw new Error('Missing required env: SOCIALCLAW_BEARER, SOCIALCLAW_CLIENT_ID, SOCIALCLAW_WA_TEST_RECIPIENT, SOCIALCLAW_EMAIL_TEST_RECIPIENT');
  }

  const body = {
    mode,
    whatsappTestRecipient,
    whatsappTemplate: getEnv('SOCIALCLAW_WA_TEMPLATE', 'hello_world'),
    whatsappLanguage: getEnv('SOCIALCLAW_WA_LANGUAGE', 'en_US'),
    emailTestRecipient,
    emailSubject: getEnv('SOCIALCLAW_EMAIL_SUBJECT', 'SocialClaw Staging Verification'),
    emailText: getEnv('SOCIALCLAW_EMAIL_TEXT', 'Staging verification test from SocialClaw.')
  };

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/clients/${encodeURIComponent(clientId)}/credentials/diagnose/all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const payload = await res.json().catch(() => ({}));
  const report = {
    ranAt: new Date().toISOString(),
    mode,
    ok: Boolean(payload && payload.ok),
    statusCode: res.status,
    request: {
      clientId,
      mode,
      whatsappTestRecipient,
      emailTestRecipient
    },
    response: payload
  };

  const outDir = path.resolve(process.cwd(), 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `staging-verification-${clientId}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: report.ok, statusCode: res.status, reportPath: outPath }, null, 2));
  if (!res.ok || !report.ok) process.exitCode = 1;
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error && (error as Error).message ? (error as Error).message : String(error));
  process.exit(1);
});
