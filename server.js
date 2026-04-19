const express = require("express");
const compression = require("compression");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

// simple memory cache
const cache = new Map();

app.get("/", async (req, res) => {

    const target = req.query.url;

    if (!target) {
        return res.send("Proxy running");
    }

    let targetURL;
    try {
        targetURL = new URL(target);
    } catch {
        return res.status(400).send("Invalid URL");
    }

    const cacheKey = targetURL.toString();

    // cache hit (HTML only)
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        res.set(cached.headers);
        return res.send(cached.body);
    }

    try {

        const response = await fetch(targetURL, {
            headers: {
                "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
                "Accept": req.headers["accept"] || "*/*"
            }
        });

        const contentType = response.headers.get("content-type") || "";

        /* =========================
           WASM SUPPORT (SAFE)
        ========================= */
        if (
            contentType.includes("application/wasm") ||
            targetURL.pathname.endsWith(".wasm")
        ) {
            res.setHeader("Content-Type", "application/wasm");
            return response.body.pipe(res);
        }

        /* =========================
           FAST PATH (JS/CSS/IMAGES)
        ========================= */
        if (!contentType.includes("text/html")) {
            res.setHeader("Content-Type", contentType);
            res.setHeader("Access-Control-Allow-Origin", "*");
            return response.body.pipe(res);
        }

        /* =========================
           HTML PROCESSING
        ========================= */

        let body = await response.text();

        const origin = targetURL.origin;
        const proxyBase = `${req.protocol}://${req.get("host")}/?url=`;

        const rewrite = (link) => {
            try {
                if (!link) return link;

                if (link.startsWith("data:") || link.startsWith("blob:")) {
                    return link;
                }

                if (link.startsWith("http")) {
                    return proxyBase + encodeURIComponent(link);
                }

                if (link.startsWith("//")) {
                    return proxyBase + encodeURIComponent("https:" + link);
                }

                if (link.startsWith("/")) {
                    return proxyBase + encodeURIComponent(origin + link);
                }

                return proxyBase + encodeURIComponent(origin + "/" + link);

            } catch {
                return link;
            }
        };

        // rewrite essential attributes
        body = body.replace(
            /(href|src|action)=["']([^"']+)["']/gi,
            (m, attr, link) => `${attr}="${rewrite(link)}"`
        );

        // rewrite CSS urls
        body = body.replace(
            /url\(["']?([^"')]+)["']?\)/gi,
            (m, link) => `url("${rewrite(link)}")`
        );

        // inject base tag only (safe for UI)
        body = body.replace(
            /<head>/i,
            `<head><base href="${proxyBase + encodeURIComponent(origin + "/")}">`
        );

        const headers = {
            "Content-Type": "text/html",
            "Cache-Control": "public, max-age=3600"
        };

        cache.set(cacheKey, { body, headers });

        res.set(headers);
        res.send(body);

    } catch (err) {
        res.status(500).send("Proxy error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log("Running on port " + PORT);
});
