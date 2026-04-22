const express = require("express");
const compression = require("compression");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

// Homepage
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Proxy</title></head>
    <body style="background:#111;color:#0f0;text-align:center;padding:80px;font-family:sans-serif;">
      <h1>Universal Game Proxy</h1>
      <p>All assets fetched server-side (CORS + WiFi stable)</p>
      <form action="/" method="get">
        <input type="text" name="url" placeholder="Paste full game URL" style="width:500px;padding:12px;" required autofocus>
        <button type="submit">Go</button>
      </form>
    </body>
    </html>
  `);
});

// Main proxy route
app.get("/", async (req, res) => {
  let target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url= parameter");

  if (!target.startsWith("http")) target = "https://" + target;

  try {
    const targetUrl = new URL(target);
    const origin = targetUrl.origin;

    const response = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    const contentType = response.headers.get("content-type") || "";
    const headers = new Headers(response.headers);

    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Accept-Ranges", "bytes");
    headers.delete("Content-Security-Policy");
    headers.delete("X-Frame-Options");
    headers.delete("Content-Encoding");

    // Game MIME fixes
    const path = targetUrl.pathname.toLowerCase();
    if (path.endsWith(".wasm")) headers.set("Content-Type", "application/wasm");
    if (path.endsWith(".data") || path.includes(".unityweb") || path.includes(".bundle") || path.includes(".part")) {
      headers.set("Content-Type", "application/octet-stream");
    }

    if (contentType.includes("text/html")) {
      let text = await response.text();

      // Rewrite all asset links to go through proxy
      text = text.replace(
        /(src|href|action|data)=["']([^"']+)["']/gi,
        (m, attr, val) => {
          if (val.startsWith("http") || val.startsWith("data:") || val.startsWith("#")) return m;
          const full = val.startsWith("/") ? origin + val : origin + "/" + val;
          return `${attr}="/?url=${encodeURIComponent(full)}"`;
        }
      );

      return res.set(headers).send(text);
    }

    // CSS url() rewrite
    if (contentType.includes("css")) {
      let css = await response.text();
      css = css.replace(/url\(([^)]+)\)/gi, (m, v) => {
        let val = v.replace(/["']/g, "");
        if (val.startsWith("data:") || val.startsWith("http")) return m;
        const full = val.startsWith("/") ? origin + val : origin + "/" + val;
        return `url("/?url=${encodeURIComponent(full)}")`;
      });
      return res.set(headers).send(css);
    }

    // Everything else (JS, WASM, images, .partN files, etc.)
    return res.set(headers).send(Buffer.from(await response.arrayBuffer()));

  } catch (err) {
    console.error(err);
    return res.status(500).send(`Proxy error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
