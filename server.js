"use strict";

const express = require("express");
const compression = require("compression");
const { request } = require("undici");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

const cache = new Map();

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

async function fetchWithUndici(url) {
  return await request(url, {
    method: "GET",
    maxRedirections: 10,
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "*/*"
    },
    http2: false
  });
}

app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Invalid URL");

  if (cache.has(target)) {
    return res.send(cache.get(target));
  }

  const proxyBase =
    req.protocol + "://" + req.get("host") + "/browse?url=";

  try {
    const response = await fetchWithUndici(target);

    const ct = response.headers["content-type"] || "";

    /* =========================
       NON-HTML
    ========================= */
    if (!ct.includes("text/html")) {
      const buf = await response.body.arrayBuffer();
      return res.send(Buffer.from(buf));
    }

    let html = await response.body.text();

    /* =========================
       SAFE REWRITE ONLY
    ========================= */
    html = html.replace(
      /(href|src|action)=["']([^"']+)["']/gi,
      (m, attr, link) => {
        if (
          !link ||
          link.startsWith("#") ||
          link.startsWith("javascript:") ||
          link.startsWith("data:") ||
          link.startsWith("blob:")
        ) return m;

        try {
          const abs = new URL(link, target).toString();
          return `${attr}="${proxyBase + encodeURIComponent(abs)}"`;
        } catch {
          return m;
        }
      }
    );

    /* =========================
       MINIMAL FETCH PATCH
    ========================= */
    html = html.replace(
      "</head>",
      `
<script>
const PROXY = "${proxyBase}";
const realFetch = window.fetch;

window.fetch = (url, opts) => {
  try {
    if (typeof url === "string" && url.startsWith("http")) {
      url = PROXY + encodeURIComponent(url);
    }
  } catch {}
  return realFetch(url, opts);
};
</script>
</head>`
    );

    cache.set(target, html);

    res.setHeader("content-type", "text/html");
    return res.send(html);

  } catch (err) {
    return res.status(500).send("Proxy error: " + err.toString());
  }
});

app.get("/", (req, res) => {
  res.send("OK proxy running");
});

app.listen(PORT, () => {
  console.log("running on", PORT);
});
