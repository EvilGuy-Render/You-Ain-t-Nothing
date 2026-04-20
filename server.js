"use strict";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");
const path = require("path");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

/* =========================
   BROWSER INSTANCE (your original)
========================= */
let browser;

async function getBrowser() {
  if (browser) return browser;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  return browser;
}

/* =========================
   PAGE POOL (your original)
========================= */
const pages = [];
const MAX_PAGES = 3;

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

/* =========================
   URL FIX (your original)
========================= */
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

/* =========================
   ULTRAVIOLET-STYLE FRONTEND
   (Simple but effective client-side rewriting)
========================= */
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>You Ain't Nothing Proxy</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #111; color: #0f0; text-align: center; padding: 80px 20px; }
        h1 { margin-bottom: 10px; }
        input { width: 520px; padding: 14px; font-size: 18px; border: 2px solid #0f0; background: #222; color: #0f0; }
        button { padding: 14px 28px; font-size: 18px; background: #0f0; color: #111; border: none; cursor: pointer; }
        .info { margin-top: 30px; font-size: 14px; opacity: 0.7; }
      </style>
    </head>
    <body>
      <h1>You Ain't Nothing Proxy</h1>
      <p>Enter any URL (works best with games & modern sites)</p>
      <form id="form">
        <input type="text" id="urlInput" placeholder="https://example.com or just example.com" autofocus required>
        <button type="submit">Go →</button>
      </form>
      <div class="info">
        Powered by Playwright backend + client-side rewriting<br>
        Tip: If a site still breaks, try refreshing or using a different game/site.
      </div>

      <script>
        // Simple client-side URL rewriting (UV-style)
        const form = document.getElementById('form');
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          let input = document.getElementById('urlInput').value.trim();
          if (!input) return;

          if (!input.startsWith('http')) input = 'https://' + input;

          // Encode the target URL and redirect to our backend with the UV prefix
          const encoded = encodeURIComponent(input);
          window.location.href = '/browse?url=' + encoded;
        });
      </script>
    </body>
    </html>
  `);
});

/* =========================
   MAIN PROXY ROUTE (your original + minor improvements)
========================= */
app.get("/browse", async (req, res) => {
  let target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Invalid or missing URL");

  let page;
  try {
    page = await getPage();
    console.log(`[Proxy] Loading: ${target}`);

    await page.goto(target, { 
      waitUntil: "networkidle", 
      timeout: 45000 
    });

    await page.waitForTimeout(1500); // extra time for games/JS

    let html = await page.content();

    // Basic rewriting to make links point back through your proxy
    const baseOrigin = new URL(target).origin;
    html = html.replace(
      /(href|src|action)=["']((?!https?:\/\/)[^"']+)["']/gi,
      (match, attr, value) => {
        const full = value.startsWith('/') ? baseOrigin + value : baseOrigin + '/' + value;
        return `${attr}="/browse?url=${encodeURIComponent(full)}"`;
      }
    );

    release(page);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.send(html);

  } catch (err) {
    release(page);
    console.error(err);
    return res.status(500).send(`Proxy error: ${err.message}`);
  }
});

/* =========================
   START
========================= */
app.listen(PORT, async () => {
  await getBrowser();
  console.log(`✅ You Ain't Nothing Proxy running on port ${PORT}`);
  console.log(`   → Visit http://localhost:${PORT} and enter a URL`);
});
