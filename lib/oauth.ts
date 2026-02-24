const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const axios = require('axios');
const { openUrl } = require('./open-url');

function pickPort() {
  // 0 lets the OS pick a free port.
  return 0;
}

async function oauthLogin({ apiVersion, appId, appSecret, scopes }) {
  const state = crypto.randomBytes(16).toString('hex');

  const server = http.createServer();

  const codePromise = new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }

        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Auth failed. You can close this window.');
          reject(new Error(`${error}: ${errorDesc || 'unknown error'}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid callback. You can close this window.');
          reject(new Error('Invalid OAuth callback (missing code or state mismatch).'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Authenticated. You can close this window.');
        resolve(code);
      } catch (e) {
        reject(e);
      }
    });
  });

  await new Promise((resolve) => server.listen(pickPort(), '127.0.0.1', resolve));
  const address = server.address();
  const port = address.port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(`https://www.facebook.com/${apiVersion}/dialog/oauth`);
  authUrl.searchParams.set('client_id', appId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', (scopes || []).join(','));

  await openUrl(authUrl.toString());

  let code;
  try {
    code = await codePromise;
  } finally {
    server.close();
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${apiVersion}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('code', code);

  const tokenRes = await axios.get(tokenUrl.toString());
  return tokenRes.data;
}

async function exchangeForLongLivedToken({ apiVersion, appId, appSecret, shortLivedToken }) {
  const url = new URL(`https://graph.facebook.com/${apiVersion}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', shortLivedToken);

  const res = await axios.get(url.toString());
  return res.data;
}

module.exports = {
  oauthLogin,
  exchangeForLongLivedToken
};

