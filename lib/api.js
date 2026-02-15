const axios = require('axios');
const chalk = require('chalk');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  // 613: Graph API rate limit
  // 17/32: Common Ads API throttling ("User request limit reached", etc.)
  return status === 429 || code === 613 || code === 17 || code === 32;
}

function isTransientServerError(error) {
  const status = error?.response?.status;
  return status >= 500 && status <= 599;
}

function sanitizeForLog(value) {
  if (!value) return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value !== 'object') return value;

  const out = {};
  Object.keys(value).forEach((k) => {
    if (k.toLowerCase().includes('token') || k === 'access_token' || k === 'client_secret') {
      out[k] = '***redacted***';
    } else {
      out[k] = sanitizeForLog(value[k]);
    }
  });
  return out;
}

class MetaApiClient {
  constructor(opts) {
    const { token, apiVersion, baseUrl } = opts || {};
    this.token = token || '';
    this.apiVersion = apiVersion || 'v20.0';
    this.baseUrl = baseUrl || `https://graph.facebook.com/${this.apiVersion}`;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000
    });
  }

  async request(method, endpoint, { params = {}, data = undefined, headers = undefined, maxRetries = 3, verbose = false } = {}) {
    const url = endpoint.startsWith('http') ? endpoint : endpoint;
    const finalParams = { ...(params || {}) };

    if (this.token) {
      finalParams.access_token = this.token;
    }

    const req = {
      method,
      url,
      params: finalParams,
      data,
      headers
    };

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        if (verbose) {
          console.log(chalk.gray('\nRequest:'));
          console.log(chalk.gray(`  ${method.toUpperCase()} ${this.baseUrl}${endpoint}`));
          if (Object.keys(finalParams).length) {
            console.log(chalk.gray('  Params:'));
            console.log(JSON.stringify(sanitizeForLog(finalParams), null, 2));
          }
          if (data !== undefined) {
            console.log(chalk.gray('  Body:'));
            console.log(JSON.stringify(sanitizeForLog(data), null, 2));
          }
          console.log('');
        }

        const res = await this.http.request(req);
        return res.data;
      } catch (error) {
        if ((isRateLimited(error) || isTransientServerError(error)) && attempt < maxRetries - 1) {
          const waitMs = Math.pow(2, attempt) * 1000;
          const label = isTransientServerError(error) ? 'Server error' : 'Rate limited';
          console.warn(chalk.yellow(`${label}. Retrying in ${waitMs / 1000}s...`));
          await sleep(waitMs);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Unreachable');
  }

  get(endpoint, params = {}, opts = {}) {
    return this.request('GET', endpoint, { params, ...opts });
  }

  post(endpoint, data = {}, params = {}, opts = {}) {
    return this.request('POST', endpoint, { params, data, ...opts });
  }

  delete(endpoint, params = {}, opts = {}) {
    return this.request('DELETE', endpoint, { params, ...opts });
  }

  handleError(error, hints = {}) {
    if (error?.response?.data?.error) {
      const meta = error.response.data.error;
      const status = error.response.status;
      const code = meta.code || status;
      const subcode = meta.error_subcode;
      const type = meta.type || 'API Error';
      const message = meta.message || 'Unknown error';
      const trace = meta.fbtrace_id;

      console.error(chalk.red('\nX Meta API Error:'));
      console.error(chalk.yellow(`  Type: ${type}`));
      console.error(chalk.yellow(`  Code: ${code}${subcode ? ` (${subcode})` : ''}`));
      console.error(chalk.yellow(`  Message: ${message}`));
      if (trace) console.error(chalk.gray(`  Trace: ${trace}`));

      if (code === 190) {
        console.error(chalk.cyan('\n  Hint: Token expired/invalid. Re-run: social auth login'));
      } else if (code === 200 || code === 10) {
        console.error(chalk.cyan('\n  Hint: Missing permissions (error #200).'));
        if (hints.scopes && hints.scopes.length) {
          console.error(chalk.cyan(`  Required scopes: ${hints.scopes.join(', ')}`));
          console.error(chalk.cyan('  Re-auth with: social auth login --scopes'));
        }
      } else if (code === 613 || status === 429) {
        console.error(chalk.cyan('\n  Hint: Rate limited. Slow down or retry later.'));
      } else if (code === 17 || code === 32) {
        console.error(chalk.cyan('\n  Hint: Ads API throttling (code 17/32).'));
        console.error(chalk.cyan('  Try: fewer breakdowns, shorter date ranges, async insights, or retry later.'));
      }

      console.error('');
      process.exit(1);
    }

    if (error?.request) {
      console.error(chalk.red('\nX Network Error: No response from Meta API'));
      console.error(chalk.yellow('  Check your internet connection\n'));
      process.exit(1);
    }

    console.error(chalk.red(`\nX Error: ${error?.message || String(error)}\n`));
    process.exit(1);
  }
}

module.exports = {
  MetaApiClient,
  sanitizeForLog
};
