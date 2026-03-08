const { openUrl } = require('./open-url');
const { loadPlaywrightOrThrow } = require('./playwright-runtime');

function noOpClose() {
  return Promise.resolve();
}

async function createBrowserAssistSession(options = {}) {
  const browserAgent = options.browserAgent !== false;
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || 20_000));

  if (!browserAgent) {
    return {
      via: 'system-browser',
      async goto(url) {
        return openUrl(url);
      },
      close: noOpClose
    };
  }

  try {
    const playwright = await loadPlaywrightOrThrow({ stdio: 'pipe' });
    const browser = await playwright.chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    return {
      via: 'browser-agent',
      async goto(url) {
        await page.goto(String(url || '').trim(), {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs
        });
        return true;
      },
      async close() {
        await browser.close();
      }
    };
  } catch (error) {
    return {
      via: 'system-browser',
      error,
      async goto(url) {
        return openUrl(url);
      },
      close: noOpClose
    };
  }
}

module.exports = {
  createBrowserAssistSession
};
