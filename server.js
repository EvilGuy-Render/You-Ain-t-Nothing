import express from "express";
import fetch from "node-fetch";
import compression from "compression";

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

const cache = new Map();

app.get("/", async (req, res) => {

    const target = req.query.url;

    if (!target) {
        return res.status(400).send("Missing ?url=");
    }

    let targetURL;
    try {
        targetURL = new URL(target);
    } catch {
        return res.status(400).send("Invalid URL");
    }

    const cacheKey = targetURL.toString();

    // ⚡ CACHE HIT
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
           🧠 WASM SUPPORT
        ========================= */
        if (
            contentType.includes("application/wasm") ||
            targetURL.pathname.endsWith(".wasm")
        ) {
            res.setHeader("Content-Type", "application/wasm");
            res.setHeader("Cache-Control", "public, max-age=86400");

            // ⚡ STREAM DIRECTLY (CRITICAL)
            return response.body.pipe(res);
        }

        /* =========================
           ⚡ NON-HTML FAST PATH
        ========================= */
        if (!contentType.includes("text/html")) {
            res.setHeader("Content-Type", contentType);
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
                if (link.startsWith("http")) return proxyBase + encodeURIComponent(link);
                if (link.startsWith("//")) return proxyBase + encodeURIComponent("https:" + link);
                if (link.startsWith("/")) return proxyBase + encodeURIComponent(origin + link);
                return proxyBase + encodeURIComponent(origin + "/" + link);
            } catch {
                return link;
            }
        };

        body = body.replace(/(href|src|action)=["']([^"']+)["']/gi,
            (m, a, l) => `${a}="${rewrite(l)}"`);

        body = body.replace(/url\(["']?([^"')]+)["']?\)/gi,
            (m, l) => `url("${rewrite(l)}")`);

        body = body.replace(
            /<head>/i,
            `<head><base href="${proxyBase + encodeURIComponent(origin + "/")}">`
        );

        const headers = {
            "Content-Type": "text/html",
            "Cache-Control": "public, max-age=3600"
        };

        // ⚡ CACHE HTML ONLY
        cache.set(cacheKey, { body, headers });

        res.set(headers);
        res.send(body);

    } catch (err) {
        res.status(500).send("Proxy error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log("Proxy running on port " + PORT);
});
