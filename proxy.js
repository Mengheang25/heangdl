const express = require("express");
const router = express.Router();

// Helper to filter safe headers to forward
function getSafeHeaders(headersInput = {}) {
  let headers = headersInput;
  if (typeof headersInput === "string") {
    try {
      headers = JSON.parse(headersInput);
    } catch (e) {
      headers = {};
    }
  }
  const safe = {};
  const forbidden = ["host", "connection", "content-length", "accept-encoding"];
  if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (!forbidden.includes(key.toLowerCase()) && value !== undefined && value !== null) {
        safe[key] = value;
      }
    }
  }
  if (!safe["user-agent"] && !safe["User-Agent"]) {
    safe["User-Agent"] =
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  }
  return safe;
}

// Global CORS middleware
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Health check endpoint
router.get(["/health", "/api/health"], (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "HEANG D.L Proxy",
    mode: "web-app-proxy",
    timestamp: new Date().toISOString(),
  });
});

// Media proxy handler function
async function handleMediaProxy(req, res) {
  try {
    const targetUrl = req.query.url;
    const referer = req.query.referer || req.query.referrer || "";

    if (!targetUrl || typeof targetUrl !== "string" || !targetUrl.startsWith("http")) {
      return res.status(400).send("Invalid or missing 'url' parameter.");
    }

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    };

    if (referer) headers["Referer"] = referer;
    if (req.headers.range) headers["Range"] = req.headers.range;

    const response = await fetch(targetUrl, {
      headers,
      redirect: "follow",
    });

    const passthroughHeaders = [
      "content-type",
      "content-length",
      "accept-ranges",
      "content-range",
      "content-disposition",
    ];

    passthroughHeaders.forEach((h) => {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    });

    res.status(response.status);
    const arrayBuf = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err) {
    console.error("[MEDIA PROXY ERROR]", err.message);
    if (!res.headersSent) {
      res.status(500).send("Failed to stream media: " + err.message);
    }
  }
}

router.all(["/proxy/media", "/api/proxy/media"], handleMediaProxy);

// Central HTTP Proxy endpoint for scraper API calls
const proxyHandler = async (req, res) => {
  // Guard for root health check
  if (req.method === "GET" && !req.query.url) {
    return res.status(200).json({
      status: "ok",
      service: "HEANG D.L Proxy Server",
      mode: "web-app-proxy",
    });
  }

  try {
    const payload = req.method === "POST" ? req.body : req.query;
    let targetUrl = payload ? payload.url : undefined;

    if (!targetUrl || typeof targetUrl !== "string" || !targetUrl.startsWith("http")) {
      return res.status(400).json({ error: "Invalid target URL." });
    }

    const method = (payload.method || "GET").toUpperCase();
    const headers = getSafeHeaders(payload.headers);
    const isArrayBuffer = payload.responseType === "arraybuffer";

    let fetchUrl = targetUrl;
    if (payload.params && typeof payload.params === "object") {
      const q = new URLSearchParams(payload.params).toString();
      if (q) fetchUrl += (fetchUrl.includes("?") ? "&" : "?") + q;
    }

    let body = undefined;
    if (payload.data !== undefined && method !== "GET" && method !== "HEAD") {
      if (typeof payload.data === "object") {
        if (headers["Content-Type"]?.includes("application/x-www-form-urlencoded")) {
          body = new URLSearchParams(payload.data).toString();
        } else {
          body = JSON.stringify(payload.data);
          if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
        }
      } else {
        body = String(payload.data);
      }
    }

    const response = await fetch(fetchUrl, {
      method,
      headers,
      body,
      redirect: "follow",
    });

    const resHeaders = {};
    response.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    if (isArrayBuffer) {
      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      return res.status(200).json({
        status: response.status,
        headers: resHeaders,
        data: buffer.toString("base64"),
        isBase64: true,
      });
    }

    const responseText = await response.text();

    return res.status(200).json({
      status: response.status,
      headers: resHeaders,
      data: responseText,
      isBase64: false,
    });
  } catch (err) {
    console.error("[PROXY ERROR]", err.message);
    // Always return 200 JSON wrapper so browser fetch client receives structured response
    return res.status(200).json({
      status: 502,
      error: "Proxy request failed: " + err.message,
      data: "Proxy request failed: " + err.message,
      isBase64: false,
    });
  }
};

router.all(["/proxy", "/api/proxy"], proxyHandler);
router.use(proxyHandler);

module.exports = router;
