"use strict";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 10000;

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

function fixUrl(url) {
  if (!url) return null;
  if (!url.startsWith("http")) url = "https://" + url;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

app.get("/", (req, res) => {
  res.send("Proxy running. Use /browse?url=");
});

app.get("/browse", async (req, res) => {
  const target = fixUrl(req.query.url);
  if (!target) return res.status(400).send("Invalid URL");

  let page;

  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const html = await page.content();
    const title = await page.title();
    const finalUrl = page.url();

    await page.close();

    res.send(`
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
<div style="padding:8px;background:#eee;font-family:Arial;">
${finalUrl}
</div>
<iframe style="width:100%;height:95vh;border:none;" srcdoc="${html.replace(/"/g, "&quot;")}"></iframe>
</body>
</html>
    `);

  } catch (err) {
    if (page) await page.close().catch(() => {});
    res.status(500).send("Proxy error: " + err.toString());
  }
});

app.listen(PORT, () => {
  console.log("Proxy running on port", PORT);
});
