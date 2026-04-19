const express = require("express");
const fetch = require("node-fetch");
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

    // ⚡ CACHE HIT (HTML ONLY)
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
           🔥 FULL WASM + GAME SUPPORT
        ========================= */

        if (
            contentType.includes("application/wasm") ||
            targetURL.pathname.endsWith(".wasm")
        ) {
            res.setHeader("Content-Type", "application/wasm");
            res.setHeader("Cache-Control", "public, max-age=86400");

            // required for advanced WASM
            res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

            return response.body.pipe(res);
        }

        /* =========================
           ⚡ FAST PATH (JS/CSS/IMAGES)
        ========================= */
        if (!contentType.includes("text/html")) {

            res.setHeader("Content-Type", contentType);

            // allow cross-origin assets
            res.setHeader("Access-Control-Allow-Origin", "*");

            return response.body.pipe(res);
        }

        /* =========================
           🌐 HTML PROCESSING (FIX MORE SITES)
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

        // rewrite attributes
        body = body.replace(
            /(href|src|action|data-src)=["']([^"']+)["']/gi,
            (m, attr, link) => `${attr}="${rewrite(link)}"`
        );

        // rewrite CSS urls
        body = body.replace(
            /url\(["']?([^"')]+)["']?\)/gi,
            (m, link) => `url("${rewrite(link)}")`
        );

        // fix scripts using fetch/XHR
        body = body.replace(
            /fetch\(["']([^"']+)["']/gi,
            (m, link) => `fetch("${rewrite(link)}"`
        );

        // inject base + compatibility fixes
        body = body.replace(
            /<head>/i,
            `<head>
            <base href="${proxyBase + encodeURIComponent(origin + "/")}">
            <script>
            const __proxy = "${proxyBase}";
            const __encode = encodeURIComponent;

            const origFetch = window.fetch;
            window.fetch = function(u, o){
                try{
                    if(typeof u === "string" && !u.startsWith("blob:") && !u.startsWith("data:")){
                        u = __proxy + __encode(new URL(u, location.href));
                    }
                }catch{}
                return origFetch(u, o);
            };
            </script>
            `
        );

        const headers = {
            "Content-Type": "text/html",
            "Cache-Control": "public, max-age=3600"
        };

        // cache HTML
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
