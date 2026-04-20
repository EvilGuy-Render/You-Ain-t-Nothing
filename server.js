"use strict";

/**
 * 🚨 CRITICAL FIX:
 * Forces Playwright to use Docker-bundled browsers (/ms-playwright)
 * instead of falling back to playwright-core local paths.
 */
process.env.PLAYWRIGHT_BROWSERS_PATH = "/ms-playwright";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

/**
 * Simple health check
 */
app.get("/", (req, res) => {
    if (!req.query.url) {
        return res.send("✅ Headless Proxy is running");
    }
});

/**
 * Main proxy route
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

        await page.goto(target, {
            waitUntil: "networkidle",
            timeout: 30000
        });

        const html = await page.content();

        await browser.close();

        res.setHeader("Content-Type", "text/html");
        return res.send(html);

    } catch (err) {
        if (browser) {
            await browser.close().catch(() => {});
        }

        return res.status(500).send("Proxy error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Proxy running on port ${PORT}`);
});
