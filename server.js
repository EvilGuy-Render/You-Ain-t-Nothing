const express = require("express");
const compression = require("compression");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

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

    try {

        const response = await fetch(targetURL, {
            headers: {
                "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
                "Accept": req.headers["accept"] || "*/*",
                "Accept-Encoding": "identity"
            }
        });

        const contentType = response.headers.get("content-type") || "";

        /* =========================
           🔥 FORWARD IMPORTANT HEADERS
        ========================= */
        response.headers.forEach((value, key) => {
            if (!key.toLowerCase().includes("content-encoding")) {
                res.setHeader(key, value);
            }
        });

        /* =========================
           ⚡ NON-HTML (IMAGES, JS, CSS)
        ========================= */
        if (!contentType.includes("text/html")) {
            res.setHeader("Access-Control-Allow-Origin", "*");

            const buffer = Buffer.from(await response.arrayBuffer());
            return res.send(buffer);
        }

        /* =========================
           🌐 HTML PROCESSING
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

        // rewrite EVERYTHING important
        body = body.replace(
            /(href|src|action|data-src|data-href)=["']([^"']+)["']/gi,
            (m, attr, link) => `${attr}="${rewrite(link)}"`
        );

        // rewrite CSS urls
        body = body.replace(
            /url\(["']?([^"')]+)["']?\)/gi,
            (m, link) => `url("${rewrite(link)}")`
        );

        // base fix
        body = body.replace(
            /<head>/i,
            `<head><base href="${proxyBase + encodeURIComponent(origin + "/")}">`
        );

        res.setHeader("Content-Type", "text/html");
        res.send(body);

    } catch (err) {
        res.status(500).send("Proxy error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log("Running on port " + PORT);
});
