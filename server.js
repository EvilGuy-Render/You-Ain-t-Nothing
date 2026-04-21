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

    const origin = new URL(target).origin;

    /* =========================
       INTERCEPT EVERYTHING
       (this replaces undici)
    ========================= */
    await page.route("**/*", async (route) => {
      try {
        const request = route.request();

        const response = await page.request.fetch(request);

        const headers = response.headers();

        route.fulfill({
          status: response.status(),
          headers,
          body: await response.body()
        });
      } catch (err) {
        route.continue();
      }
    });

    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    let html = await page.content();

    /* =========================
       BASIC REWRITE
    ========================= */
    html = html.replace(
      /(src|href|action)=["']([^"']+)["']/gi,
      (match, attr, link) => {
        if (
          !link ||
          link.startsWith("data:") ||
          link.startsWith("#") ||
          link.startsWith("javascript:")
        ) return match;

        try {
          const abs = new URL(link, target).toString();
          return `${attr}="/browse?url=${encodeURIComponent(abs)}"`;
        } catch {
          return match;
        }
      }
    );

    res.setHeader("content-type", "text/html");
    res.setHeader("access-control-allow-origin", "*");

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
  res.send("🔥 Playwright-only proxy running");
});

/* =========================
   START
========================= */
app.listen(PORT, async () => {
  await getBrowser();
  console.log("🚀 Proxy running on port", PORT);
});
