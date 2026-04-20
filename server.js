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
      "--disable-blink-features=AutomationControlled",   // hides automation
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-web-security",                         // helps with some mixed content
      "--ignore-certificate-errors"
    ]
  });

  return browser;
}

const pages = [];
const MAX_PAGES = 2;   // keep low for Render free tier

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

// Random realistic User-Agent (helps against Sophos fingerprinting)
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
    console.log(`[Proxy] Loading for Sophos bypass: ${target}`);

    // Apply stealth on the page
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };   // spoof Chrome object
    });

    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    await page.setExtraHTTPHeaders({
      'User-Agent': randomUA,
      'Accept-Language': 'en-US,en;q=0.9'
    });

    await page.goto(target, { 
      waitUntil: "networkidle", 
      timeout: 45000 
    });

    await page.waitForTimeout(1500);   // give JS time to run (helps games/sites Sophos might scan)

    let html = await page.content();

    // Minimal rewriting to keep navigation inside proxy
    const origin = new URL(target).origin;
    html = html.replace(
      /(href|src|action)=["']((?!https?:\/\/)[^"']+)["']/gi,
      (match, attr, value) => {
        const full = value.startsWith('/') ? origin + value : origin + '/' + value;
        return `${attr}="/browse?url=${encodeURIComponent(full)}"`;
      }
    );

    release(page);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(html);

  } catch (err) {
    release(page);
    console.error(err);
    res.status(500).send(`Proxy error (Sophos may be blocking): ${err.message}`);
  }
});

app.listen(PORT, async () => {
  await getBrowser();
  console.log(`Bare Sophos-bypass proxy running on port ${PORT}`);
});
