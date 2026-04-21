"use strict";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

let browser;

/* =========================
   BROWSER
========================= */
async function getBrowser() {
  if (browser) return browser;

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  return browser;
}

/* =========================
   URL FIX
========================= */
function fixUrl(url) {
  if (!url) return null;

  url = url.trim()
    .replace("https//", "https://")
    .replace("http//", "http://");

  if (!url.startsWith("http")) {
    url = "https://" + url;
  }

  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

/* =========================
   MAIN ROUTE
========================= */
app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Invalid URL");

  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    /* =========================
       CRITICAL: DO NOT BREAK REQUESTS
    ========================= */
    await page.route("**/*", async (route) => {
      const request = route.request();

      try {
        const response = await page.request.fetch(request);

        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: await response.body()
        });
      } catch {
        route.continue();
      }
    });

    await page.goto(target, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    let html = await page.content();

    /* =========================
       VERY LIGHT REWRITE ONLY
       (navigation only, not APIs)
    ========================= */
    html = html.replace(
      /(href)=["']([^"']+)["']/gi,
      (match, attr, link) => {
        if (
          !link ||
          link.startsWith("#") ||
          link.startsWith("javascript:") ||
          link.startsWith("data:")
        ) return match;

        try {
          const abs = new URL(link, target).toString();
          return `${attr}="/browse?url=${encodeURIComponent(abs)}"`;
        } catch {
          return match;
        }
      }
    );

    /* =========================
       HEADERS (important for WASM)
    ========================= */
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

    await page.close();

    res.send(html);

  } catch (err) {
    if (page) await page.close();
    res.status(500).send("Proxy error: " + err.toString());
  }
});

/* =========================
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("🔥 Full JS/WASM proxy running");
});

/* =========================
   START
========================= */
app.listen(PORT, async () => {
  await getBrowser();
  console.log("🚀 Proxy running on port", PORT);
});
