const express = require("express");
const compression = require("compression");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

// simple in-memory cache (Worker-like fallback)
const cache = new Map();

app.get("/", async (req, res) => {

    const target = req.query.url;

    if (!target) {
        return res.send("Proxy running (Worker-style mode)");
    }

    let targetURL;
    try {
        targetURL = new URL(target);
    } catch {
        return res.status(400).send("Invalid URL");
    }

    const cacheKey = targetURL.toString();

    // ⚡ CACHE HIT (Worker-like)
    if (cache.has(cacheKey)) {
        return res.send(cache.get(cacheKey));
    }

    try {

        const response = await fetch(targetURL.toString(), {
            method: req.method,
            headers: {
                "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
                "Accept": req.headers["accept"] || "*/*"
            }
        });

        const contentType = response.headers.get("content-type") || "";

        // clone headers like Worker does
        const headers = {};
        response.headers.forEach((v, k) => {
            headers[k] = v;
        });

        // ⚡ REMOVE BLOCKING HEADERS (IMPORTANT)
        delete headers["x-frame-options"];
        delete headers["content-security-policy"];
        delete headers["content-security-policy-report-only"];
        delete headers["clear-site-data"];

        headers["cache-control"] = "public, max-age=3600";

        /* =========================
           FAST PATH (NO HTML)
        ========================= */
        if (!contentType.includes("text/html")) {
            const buffer = Buffer.from(await response.arrayBuffer());
            return res.set(headers).send(buffer);
        }

        /* =========================
           HTML PROCESSING (Worker style)
        ========================= */

        let text = await response.text();

        const origin = targetURL.origin;
        const proxyBase = `${req.protocol}://${req.get("host")}/?url=`;

        const rewrite = (link) => {
            try {
                if (!link) return link;

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

        // rewrite HTML only (NO JS INJECTION → important fix)
        text = text.replace(
            /(href|src|action)=["']([^"']+)["']/gi,
            (m, attr, link) => `${attr}="${rewrite(link)}"`
        );

        text = text.replace(
            /url\(["']?([^"')]+)["']?\)/gi,
            (m, link) => `url("${rewrite(link)}")`
        );

        // base tag only (clean Worker style)
        text = text.replace(
            /<head>/i,
            `<head><base href="${proxyBase + encodeURIComponent(origin + "/")}">`
        );

        // cache result
        cache.set(cacheKey, text);

        res.set(headers).send(text);

    } catch (err) {
        res.status(500).send("Proxy error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log("Worker-style proxy running on port " + PORT);
});
