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
      "--disable-web-security",
      "--ignore-certificate-errors",
      "--disable-extensions",
      "--disable-gl-drawing-for-tests",
      "--disable-background-networking"  // reduce extra requests
    ]
  });

  return browser;
}

const pages = [];
const MAX_PAGES = 1;  // minimal for stability

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

app.get("/browse", async (req, res) => {
  let target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Missing or invalid ?url= parameter");

  let page;
  try {
    page = await getPage();
    console.log(`[Proxy] Loading with extra GoGuardian stealth: ${target}`);

    const origin = new URL(target).origin;

    // Extra stealth for GoGuardian / managed Chromebooks
    await page.addInitScript(() => {
      // Core patches
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      if (!window.chrome) window.chrome = { runtime: {}, app: { isInstalled: false } };

      // Spoof more properties
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(screen, 'width', { get: () => 1920 });
      Object.defineProperty(screen, 'height', { get: () => 1080 });
      Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
      Object.defineProperty(screen, 'availHeight', { get: () => 1040 });

      // Random small mouse movement simulation (human-like)
      setTimeout(() => {
        if (window.dispatchEvent) {
          const event = new MouseEvent('mousemove', { clientX: Math.random() * 100, clientY: Math.random() * 100 });
          document.dispatchEvent(event);
        }
      }, 300);
    });

    // Realistic context
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    });

    await page.goto(target, { 
      waitUntil: "domcontentloaded", 
      timeout: 25000 
    });

    await page.waitForTimeout(600 + Math.random() * 400); // slight random delay

    let html = await page.content();

    // Rewriting (images, CSS, assets)
    html = html.replace(
      /(src|href|action|data-src)=["']([^"']+)["']/gi,
      (match, attr, value) => {
        if (value.startsWith('data:') || value.startsWith('#') || value.startsWith('javascript:')) return match;
        let full = value.startsWith('http') ? value : (value.startsWith('/') ? origin + value : origin + '/' + value);
        return `${attr}="/browse?url=${encodeURIComponent(full)}"`;
      }
    );

    html = html.replace(
      /url\(["']?([^"')]+)["']?\)/gi,
      (match, value) => {
        if (value.startsWith('data:')) return match;
        let full = value.startsWith('http') ? value : (value.startsWith('/') ? origin + value : origin + '/' + value);
        return `url("/browse?url=${encodeURIComponent(full)}")`;
      }
    );

    release(page);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(html);

  } catch (err) {
    release(page);
    console.error(err);
    res.status(500).send(`Proxy error: ${err.message}`);
  }
});

app.listen(PORT, async () => {
  await getBrowser();
  console.log(`GoGuardian-hardened bare proxy running on port ${PORT}`);
});
