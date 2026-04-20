"use strict";

const express = require("express");
const { chromium } = require("playwright-core");

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("✅ Proxy is running. Use /browse?url=");
});

/* =========================
   URL FIXER
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
   BROWSER INIT
========================= */
let browser;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });
  }
  return browser;
}

/* =========================
   MAIN PROXY ROUTE
========================= */
app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);

  if (!target) {
    return res.status(400).send("Invalid URL");
  }

  let context;
  let page;

  try {
    const b = await getBrowser();
    context = await b.newContext();
    page = await context.newPage();

    console.log("➡️ Loading:", target);

    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const html = await page.content();

    const proxyBase =
      req.protocol + "://" + req.get("host") + "/browse?url=";

    /* =========================
       LINK REWRITER
    ========================= */
    let rewritten = html.replace(
      /(href|src|action)=["']([^"']+)["']/gi,
      (match, attr, link) => {
        if (
          link.startsWith("#") ||
          link.startsWith("javascript:") ||
          link.startsWith("data:") ||
          link.startsWith("blob:")
        ) return match;

        try {
          const abs = new URL(link, target).href;
          return `${attr}="${proxyBase + encodeURIComponent(abs)}"`;
        } catch {
          return match;
        }
      }
    );

    /* =========================
       JS INJECTION (FETCH + XHR)
    ========================= */
    const injection = `
<script>
const PROXY = "${proxyBase}";

const originalFetch = window.fetch;
window.fetch = function(url, opts) {
  try {
    if (typeof url === "string" && url.startsWith("http")) {
      url = PROXY + encodeURIComponent(url);
    }
  } catch {}
  return originalFetch(url, opts);
};

const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  try {
    if (url.startsWith("http")) {
      url = PROXY + encodeURIComponent(url);
    }
  } catch {}
  return origOpen.apply(this, [method, url]);
};
</script>
`;

    if (rewritten.includes("</head>")) {
      rewritten = rewritten.replace("</head>", injection + "</head>");
    } else {
      rewritten = injection + rewritten;
    }

    await page.close();
    await context.close();

    res.setHeader("content-type", "text/html");
    return res.send(rewritten);

  } catch (err) {
    try {
      if (page) await page.close();
      if (context) await context.close();
    } catch {}

    return res.status(500).send("Proxy error: " + err.toString());
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log("🔥 Proxy running on port " + PORT);
});
