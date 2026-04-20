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
      "--disable-gl-drawing-for-tests"  // extra speed boost (less visual overhead)
    ]
  });

  return browser;
}

const pages = [];
const MAX_PAGES = 1;  // lowered even more for free tier stability

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
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
];

app.get("/browse", async (req, res) => {
  let target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Missing or invalid ?url= parameter");

  let page;
  try {
    page = await getPage();
    console.log(`[Proxy] Loading (faster mode): ${target}`);

    const origin = new URL(target).origin;

    // Stealth (kept light)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      if (!window.chrome) window.chrome = { runtime: {}, app: { isInstalled: false } };
    });

    await page.setExtraHTTPHeaders({
      'User-Agent': userAgents[0],
      'Accept-Language': 'en-US,en;q=0.9'
    });

    await page.goto(target, { 
      waitUntil: "domcontentloaded",   // <<< MUCH FASTER than networkidle
      timeout: 30000 
    });

    await page.waitForTimeout(800); // short wait for basic JS (games still get some time)

    let html = await page.content();

    // Aggressive rewriting (images, CSS, assets)
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
    res.status(500).send(`Proxy error (site may be slow or blocked): ${err.message}`);
  }
});

app.listen(PORT, async () => {
  await getBrowser();
  console.log(`Faster bare proxy running on port ${PORT}`);
});
