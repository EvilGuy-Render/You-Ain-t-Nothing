"use strict";
const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   ROOT (TEST)
========================= */
app.get("/", (req, res) => {
  res.send("✅ Proxy is running. Use /browse?url=");
});

/* =========================
   MIDDLEMAN PROXY
========================= */
app.get("/browse", async (req, res) => {
  try {
    let target = req.query.url;
    if (!target) return res.send("Missing url");

    if (!target.startsWith("http")) {
      target = "https://" + target;
    }

    const targetURL = new URL(target);
    const origin = targetURL.origin;

    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const contentType = response.headers.get("content-type") || "";

    /* =========================
       NON-HTML
    ========================= */
    if (!contentType.includes("text/html")) {
      const buffer = await response.arrayBuffer();

      res.setHeader("content-type", contentType);
      res.setHeader("access-control-allow-origin", "*");
      return res.send(Buffer.from(buffer));
    }

    /* =========================
       HTML
    ========================= */
    let html = await response.text();

    const proxyBase =
      req.protocol + "://" + req.get("host") + "/browse?url=";

    const rewrite = (url) => {
      try {
        if (url.startsWith("http")) {
          return proxyBase + encodeURIComponent(url);
        }
        if (url.startsWith("//")) {
          return proxyBase + encodeURIComponent("https:" + url);
        }
        if (url.startsWith("/")) {
          return proxyBase + encodeURIComponent(origin + url);
        }
        return proxyBase + encodeURIComponent(origin + "/" + url);
      } catch {
        return url;
      }
    };

    /* =========================
       REWRITE HTML ATTRIBUTES
    ========================= */
    html = html.replace(
      /(href|src|action)=["']([^"']+)["']/gi,
      (m, attr, link) => `${attr}="${rewrite(link)}"`
    );

    /* =========================
       REWRITE CSS url()
    ========================= */
    html = html.replace(
      /url\(["']?([^"')]+)["']?\)/gi,
      (m, link) => `url("${rewrite(link)}")`
    );

    /* =========================
       BASE TAG
    ========================= */
    html = html.replace(
      /<head>/i,
      `<head><base href="${proxyBase + encodeURIComponent(origin + "/")}">`
    );

    /* =========================
       INJECTION (FETCH + XHR)
    ========================= */
    const injection = `
<script>
const PROXY = "${proxyBase}";

/* FETCH PATCH */
const originalFetch = window.fetch;
window.fetch = function(url, options) {
  try {
    if (typeof url === "string") {
      if (url.startsWith("/")) {
        url = location.origin + url;
      }
      if (url.startsWith("http")) {
        url = PROXY + encodeURIComponent(url);
      }
    }
  } catch {}
  return originalFetch(url, options);
};

/* XHR PATCH */
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  try {
    if (url.startsWith("/")) {
      url = location.origin + url;
    }
    if (url.startsWith("http")) {
      url = PROXY + encodeURIComponent(url);
    }
  } catch {}
  return origOpen.apply(this, [method, url]);
};
</script>
`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${injection}`);
    } else {
      html = injection + html;
    }

    /* =========================
       HEADERS
    ========================= */
    res.setHeader("content-type", "text/html");
    res.setHeader("access-control-allow-origin", "*");

    res.send(html);

  } catch (err) {
    res.send("Proxy error: " + err.toString());
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log("🔥 Proxy running on port " + PORT);
});
