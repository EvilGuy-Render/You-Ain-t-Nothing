export default {
  async fetch(request) {
    const url = new URL(request.url);

    // === HOMEPAGE ===
    if (url.pathname === "/" && !url.searchParams.has("url")) {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Proxy</title></head>
        <body style="background:#111;color:#0f0;text-align:center;padding:80px;font-family:sans-serif;">
          <h1>Full Middleman Proxy</h1>
          <p>All assets fetched server-side (CORS + WiFi stable)</p>
          <form>
            <input name="url" placeholder="Paste game URL" style="width:500px;padding:12px;">
            <button>Go</button>
          </form>
        </body>
        </html>
      `, { headers: { "Content-Type": "text/html" } });
    }

    let target = url.searchParams.get("url");
    if (!target) return new Response("Missing URL", { status: 400 });

    if (!target.startsWith("http")) target = "https://" + target;

    let targetUrl;
    try { targetUrl = new URL(target); }
    catch { return new Response("Bad URL", { status: 400 }); }

    const origin = targetUrl.origin;

    try {
      const reqHeaders = new Headers(request.headers);
      if (request.headers.get("range")) reqHeaders.set("range", request.headers.get("range"));

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: reqHeaders,
        body: request.body,
        redirect: "manual"
      });

      // Intercept filter block redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location") || "";
        const confirmHtml = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"><title>Redirect Confirmation</title></head>
          <body style="background:#111;color:#0f0;text-align:center;padding:100px;font-family:sans-serif;">
            <h2>Redirect Detected</h2>
            <p>The site tried to redirect to:</p>
            <p style="word-break:break-all;background:#222;padding:10px;">${location}</p>
            <p>Do you want to follow this redirect?</p>
            <button onclick="window.location.href='${location}'" style="padding:12px 24px;margin:10px;background:#0f0;color:#111;border:none;font-size:18px;cursor:pointer;">✅ Yes</button>
            <button onclick="window.history.back()" style="padding:12px 24px;margin:10px;background:#333;color:#0f0;border:none;font-size:18px;cursor:pointer;">❌ No</button>
          </body>
          </html>
        `;
        return new Response(confirmHtml, { headers: { "Content-Type": "text/html" } });
      }

      const contentType = response.headers.get("content-type") || "";
      const headers = new Headers(response.headers);

      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");

      headers.delete("Content-Security-Policy");
      headers.delete("X-Frame-Options");
      headers.delete("Content-Encoding");

      // MIME fixes for games
      const path = targetUrl.pathname.toLowerCase();
      if (path.endsWith(".wasm")) headers.set("Content-Type", "application/wasm");
      if (path.endsWith(".data") || path.includes(".unityweb") || path.includes(".bundle") || path.includes(".part")) {
        headers.set("Content-Type", "application/octet-stream");
      }

      // For HTML: rewrite links so all future requests go through the proxy (middleman style)
      if (contentType.includes("text/html")) {
        let text = await response.text();

        // Rewrite all static attributes to go through proxy
        text = text.replace(
          /(src|href|action|data)=["']([^"']+)["']/gi,
          (m, attr, val) => {
            if (val.startsWith("http") || val.startsWith("data:") || val.startsWith("#")) return m;
            const full = val.startsWith("/") ? origin + val : origin + "/" + val;
            return `${attr}="/?url=${encodeURIComponent(full)}"`;
          }
        );

        // Also rewrite CSS url() inside <style> tags if any
        text = text.replace(/url\(([^)]+)\)/gi, (m, v) => {
          let val = v.replace(/["']/g, "");
          if (val.startsWith("data:") || val.startsWith("http")) return m;
          const full = val.startsWith("/") ? origin + val : origin + "/" + val;
          return `url("/?url=${encodeURIComponent(full)}")`;
        });

        return new Response(text, { headers });
      }

      // For CSS files: rewrite url()
      if (contentType.includes("css")) {
        let css = await response.text();
        css = css.replace(/url\(([^)]+)\)/gi, (m, v) => {
          let val = v.replace(/["']/g, "");
          if (val.startsWith("data:") || val.startsWith("http")) return m;
          const full = val.startsWith("/") ? origin + val : origin + "/" + val;
          return `url("/?url=${encodeURIComponent(full)}")`;
        });
        return new Response(css, { headers });
      }

      // Everything else (JS, WASM, images, fonts, .partN, .data, etc.) is served directly
      // This is the "middleman" part — browser only talks to the proxy
      return new Response(response.body, { status: response.status, headers });

    } catch (err) {
      return new Response("Proxy error: " + err.message, { status: 500 });
    }
  }
};
