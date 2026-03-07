const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const packageJson = require('../package.json');
const chalk = require('chalk');
const { openUrl } = require('../lib/open-url');
const { startGatewayBackground } = require('../lib/gateway/manager');
const { renderPanel, mint } = require('../lib/ui/chrome');

function parseBaseUrl(input) {
  const raw = String(input || 'http://127.0.0.1:1310').trim();
  try {
    return new URL(raw);
  } catch {
    return new URL(`http://${raw}`);
  }
}

function requestJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let data = {};
        try {
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          data = {};
        }
        resolve({
          status: res.statusCode || 0,
          data
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, data: {} });
    });
    req.on('error', () => resolve({ status: 0, data: {} }));
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPort(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return fallback;
  return n;
}

function isHttpUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function hasDevScript(frontendPath) {
  const pkgPath = path.join(frontendPath, 'package.json');
  const pkg = safeReadJson(pkgPath);
  return Boolean(pkg && pkg.scripts && typeof pkg.scripts.dev === 'string' && pkg.scripts.dev.trim());
}

function detectFrontendPath(frontendPath) {
  const resolved = path.resolve(String(frontendPath || '').trim());
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { ok: false, reason: `Path not found: ${resolved}` };
  }

  if (hasDevScript(resolved)) {
    return { ok: true, mode: 'dev', root: resolved, projectRoot: resolved };
  }

  const staticCandidates = [
    path.join(resolved, 'dist', 'public'),
    path.join(resolved, 'dist'),
    resolved
  ];
  for (const candidate of staticCandidates) {
    const indexPath = path.join(candidate, 'index.html');
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return { ok: true, mode: 'static', root: candidate, projectRoot: resolved };
    }
  }

  return {
    ok: false,
    reason: 'No frontend entry found. Expected either a built index.html (dist/public) or package.json scripts.dev.'
  };
}

function studioRuntimeDir() {
  const dir = path.join(process.cwd(), '.social-runtime', 'studio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function waitForUrl(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  let probe = { status: 0, data: {} };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    probe = await requestJson(url);
    if (probe.status >= 200 && probe.status < 500) {
      return { ok: true, probe };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { ok: false, probe };
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(350);
  }
}

function startFrontendStaticServer({ root, port, logFile, gatewayUrl, gatewayApiKey }) {
  const script = `
const fs=require('fs');
const path=require('path');
const http=require('http');
const root=path.resolve(process.argv[1]||'.');
const port=Number(process.argv[2]||4173);
const gatewayUrl=String(process.argv[3]||'');
const gatewayApiKey=String(process.argv[4]||'');
const mime=(filePath)=>{
  const ext=path.extname(filePath).toLowerCase();
  if(ext==='.html')return 'text/html; charset=utf-8';
  if(ext==='.css')return 'text/css; charset=utf-8';
  if(ext==='.js')return 'application/javascript; charset=utf-8';
  if(ext==='.json')return 'application/json; charset=utf-8';
  if(ext==='.svg')return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
};
const htmlPrefix='<!doctype html><html><head><meta charset="utf-8"><title>Social Studio Config</title></head><body><script>';
const htmlSuffix='</script></body></html>';
const configScript='window.__SOCIAL_FLOW_GATEWAY__='+JSON.stringify({url:gatewayUrl,apiKey:gatewayApiKey})+';';
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/', 'http://localhost');
  if(u.pathname==='/studio-config.js'){
    res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'});
    res.end(configScript);
    return;
  }
  const requested=u.pathname==='/'?'/index.html':u.pathname;
  const rel=path.posix.normalize(requested).replace(/^\\/+/, '');
  const candidate=path.resolve(root, rel);
  const relative=path.relative(root, candidate);
  if(relative.startsWith('..') || path.isAbsolute(relative)){
    res.writeHead(403, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ok:false,error:'Forbidden'}, null, 2));
    return;
  }
  if(fs.existsSync(candidate) && fs.statSync(candidate).isFile()){
    const body=fs.readFileSync(candidate);
    res.writeHead(200, {'Content-Type': mime(candidate), 'Cache-Control': candidate.endsWith('.html')?'no-store':'public, max-age=300'});
    res.end(body);
    return;
  }
  const indexPath=path.join(root, 'index.html');
  if(fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()){
    const html=fs.readFileSync(indexPath, 'utf8');
    if(html.includes('</head>')){
      const withConfig=html.replace('</head>', '<script src="/studio-config.js"></script></head>');
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(withConfig);
      return;
    }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(htmlPrefix+configScript+htmlSuffix);
    return;
  }
  res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({ok:false,error:'index.html missing'}, null, 2));
});
server.listen(port, '127.0.0.1');
`;

  const outFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['-e', script, root, String(port), gatewayUrl, gatewayApiKey || ''], {
    cwd: root,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: process.env,
    windowsHide: true
  });
  child.unref();
  fs.closeSync(outFd);
  return child.pid;
}

function startFrontendDevServer({ root, port, logFile, gatewayUrl, gatewayApiKey }) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const outFd = fs.openSync(logFile, 'a');
  const child = spawn(npmCommand, args, {
    cwd: root,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: {
      ...process.env,
      VITE_API_URL: gatewayUrl,
      VITE_SOCIAL_GATEWAY_URL: gatewayUrl,
      VITE_SOCIAL_GATEWAY_KEY: String(gatewayApiKey || process.env.SOCIAL_GATEWAY_API_KEY || '').trim()
    },
    windowsHide: true
  });
  child.unref();
  fs.closeSync(outFd);
  return child.pid;
}

function frontendStartHint({ projectRoot, port, logFile, mode }) {
  const root = String(projectRoot || '').trim() || '.';
  const launch = mode === 'static'
    ? `py -m http.server ${port} --directory "${root}"`
    : `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`;
  const lines = [
    `Start manually in ${root}:`,
    mode === 'dev' ? '1) npm install' : '',
    mode === 'dev' ? `2) ${launch}` : launch,
    `Then run: social studio --url http://127.0.0.1:1310 --frontend-url http://127.0.0.1:${port}`
  ].filter(Boolean);
  if (logFile) lines.push(`Log file: ${logFile}`);
  return lines.join(' ');
}

function pickStudioLaunchUrl(frontendUrl, studioAppUrl) {
  const external = String(frontendUrl || '').trim();
  if (external) return external;
  return String(studioAppUrl || '').trim();
}

function studioRouteNeedsRecovery(health, studioProbe) {
  const ok = Boolean(health && health.status === 200 && health.data && health.data.ok);
  if (!ok) return false;
  return Number(studioProbe && studioProbe.status) !== 200;
}

async function resolveFrontendUrl({
  frontendUrl,
  frontendPath,
  frontendPort,
  gatewayUrl,
  gatewayApiKey
}) {
  const directUrl = String(frontendUrl || '').trim();
  if (directUrl) {
    if (!isHttpUrl(directUrl)) {
      return { ok: false, reason: `Invalid --frontend-url: ${directUrl}` };
    }
    return { ok: true, url: directUrl, started: false, mode: 'url' };
  }

  const pathInput = String(frontendPath || '').trim();
  if (!pathInput) return { ok: true, url: '', started: false, mode: 'none' };

  const detection = detectFrontendPath(pathInput);
  if (!detection.ok) return { ok: false, reason: detection.reason };

  const port = toPort(frontendPort, 4173);
  const url = `http://127.0.0.1:${port}`;
  const preflight = await requestJson(url);
  if (preflight.status >= 200 && preflight.status < 500) {
    return {
      ok: true,
      url,
      started: false,
      mode: detection.mode,
      note: 'Frontend already running on requested port.'
    };
  }

  const runtimeDir = studioRuntimeDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(runtimeDir, `frontend-${port}-${stamp}.log`);

  try {
    let pid = 0;
    if (detection.mode === 'static') {
      pid = startFrontendStaticServer({
        root: detection.root,
        port,
        logFile,
        gatewayUrl,
        gatewayApiKey
      });
    } else if (detection.mode === 'dev') {
      pid = startFrontendDevServer({
        root: detection.root,
        port,
        logFile,
        gatewayUrl,
        gatewayApiKey
      });
    } else {
      return { ok: false, reason: 'Unsupported frontend mode.' };
    }

    const ready = await waitForUrl(url, 22000);
    if (!ready.ok) {
      const nodeModulesDir = path.join(detection.projectRoot || detection.root, 'node_modules');
      const missingDeps = !fs.existsSync(nodeModulesDir);
      const hint = missingDeps
        ? `Dependencies missing. Run npm install in ${detection.projectRoot || detection.root}.`
        : `Frontend failed to boot. Check log: ${logFile}`;
      return { ok: false, reason: hint, logFile, pid };
    }

    return {
      ok: true,
      url,
      started: true,
      mode: detection.mode,
      logFile,
      pid
    };
  } catch (error) {
    const code = String(error?.code || '').trim().toUpperCase();
    const fallback = String(error?.message || error || 'Failed to launch frontend.');
    const marker = `${code} ${fallback}`.toUpperCase();
    if (marker.includes('EPERM') || marker.includes('EINVAL')) {
      return {
        ok: false,
        reason: `Cannot auto-start frontend in this terminal environment (${code || 'SPAWN_ERROR'}). ${frontendStartHint({
          projectRoot: detection.projectRoot || detection.root,
          port,
          mode: detection.mode
        })}`
      };
    }
    return { ok: false, reason: fallback };
  }
}

function registerStudioCommand(program) {
  program
    .command('studio')
    .description('Open bundled Social Flow Studio (or external/local frontend) and verify gateway status')
    .option('--url <url>', 'Gateway base URL', 'http://127.0.0.1:1310')
    .option('--frontend-url <url>', 'External Studio/frontend URL to open', process.env.SOCIAL_STUDIO_URL || '')
    .option('--frontend-path <path>', 'Local frontend path (Vite project root or built static directory)')
    .option('--frontend-port <port>', 'Local Studio frontend port when using --frontend-path', '4173')
    .option('--gateway-api-key <key>', 'Optional gateway key to pass to local frontend as VITE env')
    .option('--no-open', 'Do not open Studio page in browser')
    .option('--no-auto-start', 'Do not auto-start gateway when health is down')
    .action(async (opts) => {
      const baseUrl = parseBaseUrl(opts.url);
      const healthUrl = new URL('/api/health', baseUrl).toString();
      const statusUrl = new URL('/api/status?doctor=1', baseUrl).toString();
      const studioContextUrl = new URL('/studio', baseUrl).toString();
      const studioAppUrl = new URL('/studio/app', baseUrl).toString();
      const studioFullUrl = new URL('/studio/full/', baseUrl).toString();
      const gatewayUrl = baseUrl.toString().replace(/\/$/, '');
      const frontendPath = String(opts.frontendPath || '').trim();
      const frontendPort = toPort(opts.frontendPort, 4173);
      const gatewayApiKey = String(opts.gatewayApiKey || process.env.SOCIAL_GATEWAY_API_KEY || '').trim();
      const host = String(baseUrl.hostname || '127.0.0.1').trim();
      const fallbackPort = baseUrl.protocol === 'https:' ? 443 : 80;
      const port = Number(baseUrl.port || fallbackPort);

      let health = await requestJson(healthUrl);
      let autoStarted = false;
      let replacedExternal = false;
      let staleReplaceFailed = false;

      const localVersion = String(packageJson?.version || '').trim();
      const remoteService = String(health?.data?.service || '').trim().toLowerCase();
      const remoteVersion = String(health?.data?.version || '').trim();
      const versionMismatch = Boolean(
        health?.status === 200 &&
        health?.data?.ok &&
        remoteService === 'social-api-gateway' &&
        localVersion &&
        remoteVersion &&
        localVersion !== remoteVersion
      );
      const studioProbe = health?.status === 200 && health?.data?.ok
        ? await requestJson(studioAppUrl)
        : null;
      const studioRouteUnavailable = studioRouteNeedsRecovery(health, studioProbe);

      if (((!health || !health.data || !health.data.ok) || versionMismatch || studioRouteUnavailable) && opts.autoStart !== false) {
        const started = await startGatewayBackground({
          host,
          port,
          replaceOnVersionMismatch: true,
          requireStudioRoute: true
        });
        autoStarted = Boolean(started.started);
        replacedExternal = Boolean(started.replacedExternal);
        const replaceReason = String(started?.replaceDecision?.reason || '').trim();
        staleReplaceFailed = Boolean(
          started.external &&
          started.replaceDecision &&
          (replaceReason === 'version_mismatch' || replaceReason === 'studio_route_unavailable') &&
          !started.replacedExternal
        );
        health = started.health && started.health.ok
          ? { status: 200, data: started.health.data || { ok: true } }
          : await requestJson(healthUrl);
      }

      const frontend = await resolveFrontendUrl({
        frontendUrl: opts.frontendUrl,
        frontendPath,
        frontendPort,
        gatewayUrl,
        gatewayApiKey
      });
      const frontendUrl = frontend.ok ? String(frontend.url || '').trim() : '';
      const openTarget = pickStudioLaunchUrl(frontendUrl, studioAppUrl);

      const rows = [];
      if (health.status === 200 && health.data && health.data.ok) {
        rows.push(chalk.green(`Gateway reachable: ${baseUrl.toString().replace(/\/$/, '')}`));
        rows.push(chalk.gray(`Health endpoint: ${healthUrl}`));
        rows.push(chalk.gray(`Status page: ${statusUrl}`));
        rows.push(chalk.gray(`Studio switcher: ${studioContextUrl}`));
        rows.push(chalk.gray(`Studio bundled app: ${studioAppUrl}`));
        rows.push(chalk.gray(`Studio full function-calling app: ${studioFullUrl}`));
        if (frontendUrl) rows.push(chalk.gray(`Studio frontend: ${frontendUrl}`));
        if (replacedExternal && versionMismatch) {
          rows.push(chalk.yellow(`Replaced stale gateway version ${remoteVersion} with ${localVersion}.`));
        } else if (replacedExternal) {
          rows.push(chalk.yellow('Replaced stale gateway process because Studio route was unavailable.'));
        } else if (staleReplaceFailed) {
          rows.push(chalk.yellow('Detected stale gateway process, but auto-replace could not complete in this terminal.'));
          rows.push(chalk.gray(`Stop the process on port ${port}, then rerun social studio.`));
        } else if (studioRouteUnavailable && opts.autoStart === false) {
          rows.push(chalk.yellow('Gateway is running, but /studio/app is unavailable. Re-run without --no-auto-start to replace the stale process.'));
        } else if (versionMismatch && opts.autoStart === false) {
          rows.push(chalk.yellow(`Gateway version mismatch (${remoteVersion} vs local ${localVersion}). Re-run without --no-auto-start to auto-replace.`));
        }
        if (autoStarted) rows.push(chalk.green('Gateway auto-started for Studio flow.'));
      } else {
        rows.push(chalk.red(`Gateway not reachable at ${baseUrl.toString().replace(/\/$/, '')}`));
        rows.push(chalk.yellow('Start it first: social start'));
        rows.push(chalk.gray('For debugging: social logs --lines 120'));
      }

      if (!frontend.ok) {
        rows.push(chalk.yellow(`Frontend wiring warning: ${frontend.reason}`));
      } else if (frontend.mode === 'none') {
        rows.push(chalk.gray('Frontend not specified. Opening bundled Studio app.'));
      } else if (frontend.started) {
        rows.push(chalk.green(`Frontend started (${frontend.mode}) on port ${frontendPort}.`));
        if (frontend.logFile) rows.push(chalk.gray(`Frontend log: ${frontend.logFile}`));
      } else if (frontend.note) {
        rows.push(chalk.gray(frontend.note));
      }

      rows.push('');
      rows.push('Fast checks:');
      rows.push(`1. curl ${healthUrl}`);
      rows.push(`2. social status`);
      rows.push('3. social logs');
      rows.push(`4. open ${openTarget}`);

      console.log('');
      console.log(renderPanel({
        title: ' Studio Mode ',
        rows,
        minWidth: 88,
        borderColor: (value) => mint(value)
      }));
      console.log('');

      if (opts.open !== false && health.status === 200 && health.data && health.data.ok) {
        await openUrl(openTarget);
      }
    });
}

module.exports = registerStudioCommand;
module.exports._private = {
  detectFrontendPath,
  hasDevScript,
  pickStudioLaunchUrl,
  studioRouteNeedsRecovery
};
