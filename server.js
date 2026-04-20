"use strict";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

let browser;

async function getBrowser() {
  if (browser) return browser;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-web-security",
      "--ignore-certificate-errors",
      "--disable-extensions"
    ]
  });

  return browser;
}

const pages = [];
const MAX_PAGES = 2;

async function getPage() {
  const b = await getBrowser();
  let page = pages.find(p => !p.busy);
  if (!page && pages.length < MAX_PAGES) {
    page = await b.newPage();
    pages.push(page);
  }
  if (!page) page = pages[0];
  page.busy = true;
  return page;
}

function release(page) {
  if (page) page.busy = false;
}

function fixUrl(url) {
  if (!url) return null;
  url = url.trim()
    .replace("https//", "https://")
    .replace("http//", "http://");
  if (!url.startsWith("http")) url = "https://" + url;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
];

app.get("/browse", async (req, res) => {
  let target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Missing or invalid ?url= parameter");

  let page;
  try {
    page = await getPage();
    console.log(`[Proxy] Loading with WS support (GoGuardian/Sophos): ${target}`);

    const origin = new URL(target).origin;
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    // Strong stealth (unchanged)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      if (!window.chrome) window.chrome = { runtime: {}, app: { isInstalled: false } };
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({ query: () => Promise.resolve({ state: 'granted' }) })
      });
    });

    await page.setExtraHTTPHeaders({
      'User-Agent': randomUA,
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // === WEB SOCKET SUPPORT ===
    // Route WebSockets and forward to real server when possible
    await page.routeWebSocket(/.*/, async (ws) => {
      console.log(`[WS] Intercepted: ${ws.url()}`);
      const server = ws.connectToServer();   // Connect to the real target WS
      // Forward messages both ways (basic bidirectional)
      ws.onMessage((message) => {
        console.log(`[WS → Server] ${message}`);
        server.send(message);
      });
      server.onMessage((message) => {
        console.log(`[Server → WS] ${message}`);
        ws.send(message);
      });
      // Optional: handle close
      ws.onClose(() => console.log(`[WS] Closed: ${ws.url()}`));
    });

    await page.goto(target, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500); // extra for WS-heavy games

    let html = await page.content();

    // Aggressive rewriting for images, CSS, scripts, WebGL assets + WS URLs
    html = html.replace(
      /(src|href|action|data-src)=["']([^"']+)["']/gi,
      (match, attr, value) => {
        if (value.startsWith('data:') || value.startsWith('#') || value.startsWith('javascript:')) return match;
        let full = value.startsWith('http') ? value : (value.startsWith('/') ? origin + value : origin + '/' + value);
        return `${attr}="/browse?url=${encodeURIComponent(full)}"`;
      }
    );

    // Fix CSS url() and potential ws:// in inline scripts
    html = html.replace(
      /url\(["']?([^"')]+)["']?\)/gi,
      (match, value) => {
        if (value.startsWith('data:')) return match;
        let full = value.startsWith('http') ? value : (value.startsWith('/') ? origin + value : origin + '/' + value);
        return `url("/browse?url=${encodeURIComponent(full)}")`;
      }
    );

    // Optional: rewrite ws:// or wss:// to go through proxy (limited effect)
    html = html.replace(
      /(wss?:\/\/[^"'\s]+)/gi,
      (match) => `/browse?url=${encodeURIComponent(match)}`
    );

    release(page);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST");
    res.send(html);

  } catch (err) {
    release(page);
    console.error(err);
    res.status(500).send(`Proxy error: ${err.message}`);
  }
});

app.listen(PORT, async () => {
  await getBrowser();
  console.log(`Bare proxy with WebSocket support running on port ${PORT}`);
  console.log(`→ Use: /browse?url=https://your-target.com`);
});
