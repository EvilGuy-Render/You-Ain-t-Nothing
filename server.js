const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

// simple cache
const cache = new Map();

app.get("/", async (req, res) => {

    const target = req.query.url;

    if (!target) {
        return res.send("Headless Browser Proxy Running");
    }

    try {

        // ⚡ CACHE HIT
        if (cache.has(target)) {
            return res.send(cache.get(target));
        }

        const browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox"
            ]
        });

        const page = await browser.newPage();

        await page.goto(target, {
            waitUntil: "networkidle",
            timeout: 30000
        });

        // 🧠 GET FULL RENDERED HTML (NOT RAW HTML)
        let content = await page.content();

        await browser.close();

        cache.set(target, content);

        res.setHeader("Content-Type", "text/html");
        res.send(content);

    } catch (err) {
        res.status(500).send("Render error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log("Headless proxy running on port " + PORT);
});
