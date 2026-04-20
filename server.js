const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

app.get("/", async (req, res) => {

    const target = req.query.url;

    if (!target) {
        return res.send("Headless Browser Proxy Running");
    }

    let browser;

    try {

        // 🧠 Launch Chromium (Docker-safe config)
        browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]
        });

        const page = await browser.newPage();

        // ⚡ Load page like real browser
        await page.goto(target, {
            waitUntil: "networkidle",
            timeout: 30000
        });

        // 🌐 Get fully rendered HTML (this fixes JS/UI/fonts issues)
        const content = await page.content();

        await browser.close();

        res.setHeader("Content-Type", "text/html");
        return res.send(content);

    } catch (err) {

        if (browser) await browser.close().catch(() => {});

        return res.status(500).send("Proxy error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log("Headless proxy running on port " + PORT);
});
