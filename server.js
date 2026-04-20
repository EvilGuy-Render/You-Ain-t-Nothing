"use strict";

const express = require("express");
const compression = require("compression");
const { request } = require("undici");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

/* =========================
   CACHE (simple + fast)
========================= */
const cache = new Map();

/* =========================
   FIX URL
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
   UNDICI FETCH (HARDENED)
========================= */
async function fetchWithUndici(url, attempt = 1) {
  try {
    return await request(url, {
      method: "GET",
      maxRedirections: 10,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "upgrade-insecure-requests": "1"
      },
      http2: false
    });
  } catch (err) {
    // retry once for transient ECONN issues
    if (attempt === 1) {
      return fetchWithUndici(url, 2);
    }
    throw err;
  }
}

/* =========================
   MAIN ROUTE
========================= */
app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);

  if (!target) return res.status(400).send("Invalid URL");

  const proxyBase =
    req.protocol + "://" + req.get("host") + "/browse?url=";

  try {
    const response = await fetchWithUndici(target);

    const contentType = response.headers["content-type"] || "";

    /* =========================
       NON-HTML (pass-through)
    ========================= */
    if (!contentType.includes("text/html")) {
      const buffer = await response.body.arrayBuffer();

      res.setHeader("content-type", contentType);
      res.setHeader("access-control-allow-origin", "*");

      return res.send(Buffer.from(buffer));
    }

    let html = await response.body.text();

    /* =========================
       MINIMAL REWRITE ONLY
       (DO NOT BREAK JS APIS)
    ========================= */
    html = html.replace(
      /(href|src|action)=["'](.*?)["']/gi,
      (match, attr, link) => {
        if (
          !link ||
          link.startsWith("#") ||
          link.startsWith("javascript:") ||
          link.startsWith("data:") ||
          link.startsWith("blob:")
        ) {
          return match;
        }

        try {
          const abs = new URL(link, target).toString();

          // IMPORTANT: only rewrite absolute navigation links
          // NOT API endpoints or internal JS fetch calls
          if (
            abs.includes("/api/") ||
            abs.includes("fetch") ||
            abs.includes("socket")
          ) {
            return match;
          }

          return `${attr}="${proxyBase + encodeURIComponent(abs)}"`;
        } catch {
          return match;
        }
      }
    );

    /* =========================
       CRITICAL FIX: preserve fetch/XHR origin
    ========================= */
    const injection = `
<script>
(() => {
  const PROXY = "${proxyBase}";

  const realFetch = window.fetch;

  window.fetch = function(url, opts) {
    try {
      if (typeof url === "string") {

        // DON'T break API calls
        if (
          url.startsWith("/api") ||
          url.startsWith("/socket") ||
          url.includes("ws")
        ) {
          return realFetch(url, opts);
        }

        if (!url.startsWith("http")) {
          url = new URL(url, location.href).href;
        }

        url = PROXY + encodeURIComponent(url);
      }
    } catch {}

    return realFetch(url, opts);
  };

})();
</script>
`;

    if (html.includes("</head>")) {
      html = html.replace("</head>", injection + "</head>");
    } else {
      html = injection + html;
    }

    res.setHeader("content-type", "text/html");
    res.setHeader("access-control-allow-origin", "*");

    return res.send(html);

  } catch (err) {
    return res.status(500).send("Proxy error: " + err.toString());
  }
});

    /* =========================
       NON-HTML (binary safe)
    ========================= */
    if (!contentType.includes("text/html")) {
      const buffer = await response.body.arrayBuffer();

      res.setHeader("content-type", contentType);
      res.setHeader("access-control-allow-origin", "*");

      return res.send(Buffer.from(buffer));
    }

    /* =========================
       HTML
    ========================= */
    let html = await response.body.text();

    /* =========================
       BASIC LINK REWRITE
    ========================= */
    html = html.replace(
      /(href|src|action)=["']([^"']+)["']/gi,
      (match, attr, link) => {
        try {
          if (!link ||
              link.startsWith("#") ||
              link.startsWith("javascript:") ||
              link.startsWith("data:")) {
            return match;
          }

          const abs = new URL(link, target).toString();
          return `${attr}="${proxyBase + encodeURIComponent(abs)}"`;
        } catch {
          return match;
        }
      }
    );

    /* =========================
       SAFE INJECTION (minimal)
    ========================= */
    const injection = `
<script>
const PROXY = "${proxyBase}";
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

    cache.set(target, html);

    return res.send(html);

  } catch (err) {
    return res.status(500).send("Proxy error: " + err.toString());
  }
});

/* =========================
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("✅ Undici proxy running. Use /browse?url=");
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log("🔥 Undici proxy running on port", PORT);
});
