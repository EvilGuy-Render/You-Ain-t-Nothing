"use strict";

/**
 * 🚨 Force Playwright to use Docker-bundled browsers
 */
process.env.PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

/**
 * Health check route
 */
app.get("/", (req, res) => {
    res.send("✅ Proxy is running. Use /browse?url=");
});

/**
 * Main browser proxy
 */
app.get("/browse", async (req, res) => {
    const target = req.query.url;

    if (!target) {
        return res.status(400).send("Missing ?url=");
    }

    let browser;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]
        });

        const page = await browser.newPage();

        console.log("➡️ Loading:", target);

        // 🌐 More reliable load strategy (fixes blank pages)
        const response = await page.goto(target, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        // ⏳ Wait a bit for JS-heavy sites to render
        await page.waitForTimeout(2000);

        const title = await page.title();
        const status = response ? response.status() : "unknown";

        console.log("📡 Status:", status);
        console.log("📄 Title:", title);

        const html = await page.content();

        await browser.close();

        // 🔥 ALWAYS RETURN SOMETHING VISIBLE (prevents “blank site” issue)
        return res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Proxy Render</title>
    <style>
        body { font-family: Arial; padding: 20px; background: #fff; }
        .box { padding: 10px; border: 1px solid #ccc; margin-bottom: 10px; }
        iframe { width: 100%; height: 80vh; border: 1px solid #000; }
    </style>
</head>
<body>

<div class="box">
    <h2>Proxy Debug Info</h2>
    <p><b>URL:</b> ${target}</p>
    <p><b>Status:</b> ${status}</p>
    <p><b>Title:</b> ${title}</p>
</div>

<div class="box">
    <h3>Rendered Page (HTML Snapshot)</h3>
</div>

<iframe srcdoc="${html.replace(/"/g, "&quot;")}"></iframe>

</body>
</html>
        `);

    } catch (err) {
        if (browser) await browser.close().catch(() => {});

        console.error("❌ Proxy error:", err);

        return res.status(500).send(`
            <h2>Proxy Error</h2>
            <pre>${err.toString()}</pre>
        `);
    }
});

app.listen(PORT, () => {
    console.log("🚀 Proxy running on port", PORT);
});
