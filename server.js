"use strict";

process.env.PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

/* =========================
   PERSISTENT BROWSER (FAST MODE)
========================= */
let browser;
let page;

/* launch ONCE */
async function initBrowser() {
    if (browser) return;

    browser = await chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    });

    page = await browser.newPage();
}

/* =========================
   URL FIXER (IMPORTANT)
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
   MAIN ROUTE (REAL BROWSER MODE)
========================= */
app.get("/browse", async (req, res) => {

    let target = fixUrl(req.query.url);

    if (!target) {
        return res.status(400).send("Invalid URL");
    }

    try {
        await initBrowser();

        console.log("➡️ NAVIGATING:", target);

        // 🔥 reuse same tab = HUGE speed boost
        await page.goto(target, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        // wait for JS + fonts to settle slightly
        await page.waitForTimeout(1000);

        const finalUrl = page.url();
        const title = await page.title();

        return res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body {
    margin:0;
    padding:0;
    height:100%;
    background:#fff;
}
iframe {
    width:100%;
    height:100vh;
    border:none;
}
.topbar {
    padding:6px;
    background:#eee;
    font-family:Arial;
}
</style>
</head>

<body>

<div class="topbar">
    <b>URL:</b> ${finalUrl} | <b>Title:</b> ${title}
</div>

<!-- REAL LIVE PAGE -->
<iframe src="${finalUrl}"></iframe>

</body>
</html>
        `);

    } catch (err) {
        return res.status(500).send("Proxy error: " + err.toString());
    }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
    console.log("🚀 Fast browser proxy running on port", PORT);
});
