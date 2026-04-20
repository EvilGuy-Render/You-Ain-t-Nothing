"use strict";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

/* =========================
   BROWSER INSTANCE
========================= */
let browser;

/* launch once */
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
   PAGE POOL (lightweight)
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
   MAIN PROXY
========================= */
app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);

  if (!target) {
    return res.status(400).send("Invalid URL");
  }

  let page;

  try {
    page = await getPage();

    console.log("🌐 Loading in browser:", target);

    await page.goto(target, {
      waitUntil: "networkidle",
      timeout: 45000
    });

    // wait extra for JS-heavy games
    await page.waitForTimeout(1000);

    const html = await page.content();

    release(page);

    res.setHeader("content-type", "text/html");
    res.setHeader("access-control-allow-origin", "*");

    return res.send(html);

  } catch (err) {
    release(page);
    return res.status(500).send("Browser proxy error: " + err.toString());
  }
});

/* =========================
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("✅ Browser relay proxy running. Use /browse?url=");
});

/* =========================
   START
========================= */
app.listen(PORT, async () => {
  await getBrowser();
  console.log("🔥 Browser proxy running on port", PORT);
});
