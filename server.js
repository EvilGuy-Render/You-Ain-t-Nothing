"use strict";

const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("✅ Proxy is running. Use /browse?url=");
});

/* =========================
   BROWSER STATE
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
   MAIN ROUTE
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
       BASIC LINK REWRITE
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
       INJECTION (FETCH PATCH)
    ========================= */
    const injection = `
<script>
const PROXY = "${proxyBase}";

const origFetch = window.fetch;
window.fetch = function(url, opts) {
  try {
    if (typeof url === "string" && url.startsWith("http")) {
      url = PROXY + encodeURIComponent(url);
    }
  } catch {}
  return origFetch(url, opts);
};

const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(m, url) {
  try {
    if (url.startsWith("http")) {
      url = PROXY + encodeURIComponent(url);
    }
  } catch {}
  return origOpen.apply(this, [m, url]);
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
   START
========================= */
app.listen(PORT, () => {
  console.log("🔥 Proxy running on port " + PORT);
});
