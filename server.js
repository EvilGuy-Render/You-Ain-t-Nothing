"use strict";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");
const { request } = require("undici");

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
   🔥 RAW STREAM (CRITICAL)
========================= */
app.get("/raw", async (req, res) => {
  const target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Bad URL");

  try {
    const upstream = await request(target, {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "*/*"
      }
    });

    res.setHeader(
      "content-type",
      upstream.headers["content-type"] || "application/octet-stream"
    );

    res.setHeader("access-control-allow-origin", "*");

    upstream.body.pipe(res);

  } catch (err) {
    res.status(500).send("RAW error: " + err.toString());
  }
});

/* =========================
   MAIN BROWSER ROUTE
========================= */
app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Invalid URL");

  const proxyBase =
    req.protocol + "://" + req.get("host");

  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 25000
    });

    let html = await page.content();

    /* =========================
       REWRITE EVERYTHING → /raw
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
          return `${attr}="${proxyBase}/raw?url=${encodeURIComponent(abs)}"`;
        } catch {
          return match;
        }
      }
    );

    /* =========================
       CSS url()
    ========================= */
    html = html.replace(
      /url\(["']?([^"')]+)["']?\)/gi,
      (match, link) => {
        if (link.startsWith("data:")) return match;

        try {
          const abs = new URL(link, target).toString();
          return `url("${proxyBase}/raw?url=${encodeURIComponent(abs)}")`;
        } catch {
          return match;
        }
      }
    );

    /* =========================
       FETCH/XHR FIX (CRITICAL)
    ========================= */
    const injection = `
<script>
const RAW = "${proxyBase}/raw?url=";

const origFetch = window.fetch;
window.fetch = function(url, opts) {
  try {
    if (typeof url === "string") {
      if (!url.startsWith("data:") && !url.startsWith("blob:")) {
        url = new URL(url, location.href).href;
        url = RAW + encodeURIComponent(url);
      }
    }
  } catch {}
  return origFetch(url, opts);
};

const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  try {
    url = new URL(url, location.href).href;
    url = RAW + encodeURIComponent(url);
  } catch {}
  return origOpen.apply(this, [method, url]);
};
</script>
`;

    if (html.includes("</head>")) {
      html = html.replace("</head>", injection + "</head>");
    } else {
      html = injection + html;
    }

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
  res.send("🔥 Hybrid proxy running");
});

/* =========================
   START
========================= */
app.listen(PORT, async () => {
  await getBrowser();
  console.log("🚀 Proxy running on port", PORT);
});
