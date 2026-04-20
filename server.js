"use strict";

const express = require("express");
const compression = require("compression");
const { request } = require("undici");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

/* =========================
   SIMPLE CACHE
========================= */
const cache = new Map();

/* =========================
   URL FIX
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
   UNDICI FETCH (RETRY SAFE)
========================= */
async function fetch(url, attempt = 1) {
  try {
    return await request(url, {
      method: "GET",
      maxRedirections: 10,
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9"
      },
      http2: false
    });
  } catch (err) {
    if (attempt < 3) {
      return fetch(url, attempt + 1);
    }
    throw err;
  }
}

/* =========================
   SMART ROUTE DETECTION
========================= */
function isAsset(url) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico)$/i.test(url);
}

function isApi(url) {
  return url.includes("/api/") || url.includes("graphql");
}

/* =========================
   MAIN PROXY
========================= */
app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Invalid URL");

  const proxyBase = `${req.protocol}://${req.get("host")}/browse?url=`;

  try {
    const response = await fetch(target);

    const ct = response.headers["content-type"] || "";
    const finalUrl = response.url || target;

    /* =========================
       NON-HTML (assets passthrough)
    ========================= */
    if (!ct.includes("text/html")) {
      const buf = await response.body.arrayBuffer();
      res.setHeader("content-type", ct);
      res.setHeader("access-control-allow-origin", "*");
      return res.send(Buffer.from(buf));
    }

    let html = await response.body.text();

    /* =========================
       MINIMAL SAFE LINK REWRITE
    ========================= */
    html = html.replace(
      /(href|src|action)=["']([^"']+)["']/gi,
      (m, attr, link) => {
        if (!link ||
            link.startsWith("#") ||
            link.startsWith("javascript:") ||
            link.startsWith("data:") ||
            link.startsWith("blob:")) {
          return m;
        }

        try {
          const abs = new URL(link, finalUrl).toString();

          // DON'T proxy internal API calls here (critical fix)
          if (isApi(abs)) return m;

          return `${attr}="${proxyBase + encodeURIComponent(abs)}"`;
        } catch {
          return m;
        }
      }
    );

    /* =========================
       HYBRID FETCH PATCH (SAFE MODE)
    ========================= */
    const injection = `
<script>
(() => {
  const PROXY = "${proxyBase}";

  const realFetch = window.fetch;

  window.fetch = (url, opts) => {
    try {
      if (typeof url === "string") {

        // DO NOT break API calls
        if (
          url.startsWith("/api") ||
          url.includes("graphql") ||
          url.includes("socket")
        ) {
          return realFetch(url, opts);
        }

        if (url.startsWith("/")) {
          url = location.origin + url;
        }

        if (url.startsWith("http")) {
          url = PROXY + encodeURIComponent(url);
        }
      }
    } catch {}

    return realFetch(url, opts);
  };
})();
</script>
`;

    html = html.includes("</head>")
      ? html.replace("</head>", injection + "</head>")
      : injection + html;

    cache.set(target, html);

    res.setHeader("content-type", "text/html");
    res.setHeader("access-control-allow-origin", "*");

    return res.send(html);

  } catch (err) {
    return res.status(500).send("Proxy error: " + err.toString());
  }
});

/* =========================
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("Hybrid proxy running");
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log("🔥 Hybrid proxy running on", PORT);
});
