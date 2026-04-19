const express = require("express");
const compression = require("compression");

const app = express();
app.use(compression());

const PORT = process.env.PORT || 3000;

app.get("/", async (req, res) => {

    const target = req.query.url;

    if (!target) {
        return res.send("Proxy running (Advanced Mode)");
    }

    let targetURL;
    try {
        targetURL = new URL(target);
    } catch {
        return res.status(400).send("Invalid URL");
    }

    try {

        const response = await fetch(targetURL, {
            headers: {
                "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
                "Accept": req.headers["accept"] || "*/*",
                "Accept-Encoding": "identity"
            }
        });

        const contentType = response.headers.get("content-type") || "";

        // forward headers (important for assets)
        response.headers.forEach((value, key) => {
            if (!key.toLowerCase().includes("content-encoding")) {
                res.setHeader(key, value);
            }
        });

        /* =========================
           ⚡ NON-HTML (assets)
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

                if (link.startsWith("data:") || link.startsWith("blob:")) return link;

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
            /(href|src|action|data-src|data-href)=["']([^"']+)["']/gi,
            (m, attr, link) => `${attr}="${rewrite(link)}"`
        );

        // rewrite CSS
        body = body.replace(
            /url\(["']?([^"')]+)["']?\)/gi,
            (m, link) => `url("${rewrite(link)}")`
        );

        /* =========================
           🧠 ADVANCED BROWSER LAYER
        ========================= */

        const injectedScript = `
        <script>
        const __proxy = "${proxyBase}";
        const __encode = encodeURIComponent;

        function rewrite(u){
            try{
                if(!u || u.startsWith("data:") || u.startsWith("blob:")) return u;
                return __proxy + __encode(new URL(u, location.href));
            }catch{
                return u;
            }
        }

        // fetch
        const origFetch = window.fetch;
        window.fetch = function(u, o){
            if(typeof u === "string") u = rewrite(u);
            return origFetch(u, o);
        };

        // XHR
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url){
            arguments[1] = rewrite(url);
            return origOpen.apply(this, arguments);
        };

        // WebSocket (fallback block)
        window.WebSocket = function(){
            console.warn("WebSocket blocked by proxy");
        };

        </script>
        `;

        // inject base + script
        body = body.replace(
            /<head>/i,
            `<head>
            <base href="${proxyBase + encodeURIComponent(origin + "/")}">
            ${injectedScript}
            `
        );

        res.setHeader("Content-Type", "text/html");
        res.send(body);

    } catch (err) {
        res.status(500).send("Proxy error: " + err.toString());
    }
});

app.listen(PORT, () => {
    console.log("Running Advanced Browser Mode on port " + PORT);
});
