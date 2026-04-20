"use strict";

const express = require("express");
const compression = require("compression");
const { chromium } = require("playwright");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

/* =========================
   SPEED CACHE
========================= */
const cache = new Map();

/* =========================
   BROWSER + PAGE POOL
========================= */
let browser;
let pages = [];
const MAX_PAGES = 4;

/* =========================
   LAUNCH BROWSER ONCE
========================= */
async function initBrowser() {
    if (browser) return;

    browser = await chromium.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",

            // ⚡ SPEED BOOST FLAGS
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding"
        ]
    });
}

/* =========================
   PAGE POOL SYSTEM
========================= */
async function getPage() {
    await initBrowser();

    let page = pages.find(p => !p.busy);

    if (!page && pages.length < MAX_PAGES) {
        page = await browser.newPage();
        pages.push(page);
    }

    if (!page) {
        page = pages[0];
    }

    page.busy = true;
    return page;
}

function releasePage(page) {
    if (page) page.busy = false;
}

/* =========================
   URL FIXER (ROBUST)
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
   MAIN ROUTE
========================= */
app.get("/browse", async (req, res) => {

    const target = fixUrl(req.query.url);

    if (!target) {
        return res.status(400).send("Invalid URL");
    }

    /* =========================
       CACHE HIT (INSTANT LOAD)
    ========================= */
    if (cache.has(target)) {
        return res.send(cache.get(target));
    }

    let page;

    try {
        page = await getPage();

        console.log("➡️ Loading:", target);

        await page.goto(target, {
            waitUntil: "domcontentloaded",
            timeout: 20000
        });

        await page.waitForLoadState("domcontentloaded").catch(() => {});

        const finalUrl = page.url();
        const title = await page.title();

        const html = `
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
    font-family:Arial;
    background:#eee;
    font-size:14px;
}
</style>
</head>

<body>

<div class="topbar">
    URL: ${finalUrl} | Title: ${title}
</div>

<iframe src="${finalUrl}"></iframe>

</body>
</html>
        `;

        /* =========================
           CACHE RESULT
        ========================= */
        cache.set(target, html);

        releasePage(page);

        return res.send(html);

    } catch (err) {

        releasePage(page);

        return res.status(500).send("Proxy error: " + err.toString());
    }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
    console.log("🚀 Fast proxy running on port", PORT);
});
