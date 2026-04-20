"use strict";

const express = require("express");
const compression = require("compression");
const { request } = require("undici");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

/* =========================
   URL FIXER
========================= */
function fixUrl(url) {
  if (!url) return null;

  url = url.trim();

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
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("⚡ Ultra-Fast Streaming Proxy running. Use /browse?url=");
});

/* =========================
   STREAMING PROXY CORE
========================= */
app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);

  if (!target) {
    return res.status(400).send("Invalid URL");
  }

  try {
    console.log("➡️ Streaming:", target);

    const response = await request(target, {
      method: "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9"
      }
    });

    const contentType = response.headers["content-type"] || "";

    /* =========================
       PASS HEADERS
    ========================= */
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("content-type", contentType);

    /* =========================
       STREAM RAW BODY
    ========================= */
    if (response.body) {
      response.body.pipe(res);
    } else {
      res.status(502).send("No response body");
    }

  } catch (err) {
    res.status(500).send("Proxy error: " + err.toString());
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log("⚡ Ultra-fast proxy running on port", PORT);
});
