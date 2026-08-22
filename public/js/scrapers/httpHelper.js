import { CapacitorHttp, getUserAgent } from "../utils/index.js";

/**
 * Gets the configured HTTP request timeout limit in milliseconds.
 * Defaults to 30000ms (30s) if unset or invalid.
 * @returns {number} Timeout in milliseconds
 */
export function getRequestTimeout() {
  const customSec = parseInt(localStorage.getItem("heangdl_request_timeout"), 10);
  if (!isNaN(customSec) && customSec >= 5 && customSec <= 180) {
    return customSec * 1000;
  }
  return 30000;
}

/**
 * Safely parses response data as JSON, detecting HTML error pages (Cloudflare/Rate Limit blocks).
 * @param {any} data - Raw response data
 * @param {string} serverName - Server name for error contextualization
 * @returns {object} Parsed JSON object
 */
export function parseJsonResponse(data, serverName = "Server") {
  if (typeof data === "object" && data !== null) return data;
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.startsWith("<") || trimmed.startsWith("<!DOCTYPE")) {
      throw new Error(
        `${serverName} returned an HTML error page (blocked or rate-limited). Please try another server or check your network connection.`,
      );
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`${serverName} returned an invalid response format.`);
    }
  }
  throw new Error(`${serverName} returned an empty response.`);
}

/**
 * Centralized HTTP request client wrapping CapacitorHttp.
 * Injects active User-Agent, handles configurable timeouts, and performs defensive JSON parsing.
 * @param {object} options - Request options (method, url, headers, data, params, responseType)
 * @param {string} serverName - Name of the target server for logging and error reporting
 * @returns {Promise<any>} Response data (parsed if JSON)
 */
export async function scraperFetch(options, serverName = "Server") {
  const method = (
    options.method || (options.data ? "POST" : "GET")
  ).toUpperCase();
  const headers = { ...options.headers };

  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = getUserAgent();
  }

  const httpConfig = {
    url: options.url,
    headers: headers,
    connectTimeout: getRequestTimeout(),
    readTimeout: getRequestTimeout(),
  };

  if (options.data !== undefined) httpConfig.data = options.data;
  if (options.params !== undefined) httpConfig.params = options.params;
  if (options.responseType !== undefined)
    httpConfig.responseType = options.responseType;

  let response;
  const invoke =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__?.invoke ||
    window.__TAURI__?.invoke;

  if (CapacitorHttp) {
    if (method === "POST") {
      response = await CapacitorHttp.post(httpConfig);
    } else if (method === "PUT") {
      response = await CapacitorHttp.put(httpConfig);
    } else if (method === "DELETE") {
      response = await CapacitorHttp.delete(httpConfig);
    } else {
      response = await CapacitorHttp.get(httpConfig);
    }
  } else if (invoke) {
    // Native Rust reqwest for Tauri Desktop (100% CORS-free)
    let fetchUrl = options.url;
    if (options.params) {
      const q = new URLSearchParams(options.params).toString();
      if (q) fetchUrl += (fetchUrl.includes("?") ? "&" : "?") + q;
    }

    let bodyString = undefined;
    if (options.data !== undefined) {
      if (
        typeof options.data === "object" &&
        !(options.data instanceof FormData) &&
        !(options.data instanceof URLSearchParams)
      ) {
        if (
          headers["Content-Type"]?.includes(
            "application/x-www-form-urlencoded",
          )
        ) {
          bodyString = new URLSearchParams(options.data).toString();
        } else {
          bodyString = JSON.stringify(options.data);
          if (!headers["Content-Type"])
            headers["Content-Type"] = "application/json";
        }
      } else {
        bodyString = String(options.data);
      }
    }

    response = await invoke("tauri_http_request", {
      url: fetchUrl,
      method: method,
      headers: headers,
      body: bodyString,
    });
  } else {
    // Web App (Browser) mode: Route request through proxy.js backend or public CORS proxies
    let proxied = false;

    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "";

    const proxyTargets = ["/api/proxy", "/proxy"];
    if (isLocalhost) {
      proxyTargets.push("http://localhost:3000/api/proxy");
      proxyTargets.push("http://127.0.0.1:3000/api/proxy");
    }

    const uniqueProxyTargets = [...new Set(proxyTargets)];

    for (const proxyUrl of uniqueProxyTargets) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          getRequestTimeout(),
        );

        const proxyPayload = {
          url: options.url,
          method: method,
          headers: headers,
          data: options.data,
          params: options.params,
          responseType: options.responseType,
        };

        const res = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proxyPayload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        // Process any response from proxy server (even non-2xx target statuses)
        if (res.status !== 404 && res.status !== 405) {
          let proxyRes;
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            try {
              proxyRes = await res.json();
            } catch (e) {
              const txt = await res.text().catch(() => "");
              proxyRes = { status: res.status, data: txt };
            }
          } else {
            const txt = await res.text().catch(() => "");
            proxyRes = { status: res.status, data: txt };
          }

          let resData = proxyRes.data !== undefined ? proxyRes.data : proxyRes;

          if (proxyRes.isBase64 && typeof resData === "string") {
            const binaryStr = atob(resData);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            resData = bytes.buffer;
          }

          response = {
            status: proxyRes.status || res.status,
            headers: proxyRes.headers || {},
            data: resData,
          };
          proxied = true;
          break;
        }
      } catch (e) {
        console.warn(`[PROXY TRY FAILED] ${proxyUrl}:`, e.message);
      }
    }

    // Public CORS proxies fallback for BOTH GET and POST requests if local/cloud backend proxy fails
    if (!proxied) {
      let body = undefined;
      if (options.data !== undefined && method !== "GET" && method !== "HEAD") {
        if (
          typeof options.data === "object" &&
          !(options.data instanceof FormData) &&
          !(options.data instanceof URLSearchParams)
        ) {
          if (
            headers["Content-Type"]?.includes(
              "application/x-www-form-urlencoded",
            )
          ) {
            body = new URLSearchParams(options.data).toString();
          } else {
            body = JSON.stringify(options.data);
            if (!headers["Content-Type"])
              headers["Content-Type"] = "application/json";
          }
        } else {
          body = options.data;
        }
      }

      const publicProxies = [
        `https://corsproxy.io/?${encodeURIComponent(options.url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(options.url)}`,
      ];

      for (const pubUrl of publicProxies) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(
            () => controller.abort(),
            getRequestTimeout(),
          );
          const res = await fetch(pubUrl, {
            method: method,
            headers: headers,
            body: body,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const resData =
              options.responseType === "arraybuffer"
                ? await res.arrayBuffer()
                : await res.text();
            response = {
              status: res.status,
              headers: Object.fromEntries(res.headers.entries()),
              data: resData,
            };
            proxied = true;
            break;
          }
        } catch (e) {
          console.warn("[PUBLIC PROXY FALLBACK FAILED]", e.message);
        }
      }
    }

    if (!proxied) {
      // Direct browser fetch fallback
      let fetchUrl = options.url;
      if (options.params) {
        const q = new URLSearchParams(options.params).toString();
        if (q) fetchUrl += (fetchUrl.includes("?") ? "&" : "?") + q;
      }

      let body = undefined;
      if (options.data !== undefined) {
        if (
          typeof options.data === "object" &&
          !(options.data instanceof FormData) &&
          !(options.data instanceof URLSearchParams)
        ) {
          if (
            headers["Content-Type"]?.includes(
              "application/x-www-form-urlencoded",
            )
          ) {
            body = new URLSearchParams(options.data).toString();
          } else {
            body = JSON.stringify(options.data);
            if (!headers["Content-Type"])
              headers["Content-Type"] = "application/json";
          }
        } else {
          body = options.data;
        }
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          getRequestTimeout(),
        );
        const res = await fetch(fetchUrl, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const resData =
          options.responseType === "arraybuffer"
            ? await res.arrayBuffer()
            : await res.text();
        response = {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          data: resData,
        };
      } catch (fetchErr) {
        if (isLocalhost) {
          throw new Error(
            `Local Proxy Server offline. Please start server with 'npm start'.`,
          );
        } else {
          throw new Error(
            `Cloud Proxy Error or Network Blocked. Please try again or test another server.`,
          );
        }
      }
    }
  }

  if (options.rawResponse) {
    return response;
  }

  if (options.parseJson !== false) {
    return parseJsonResponse(response.data, serverName);
  }

  return response.data;
}

/**
 * Helper to construct standardized scraper response objects.
 * @param {boolean} success - Whether the scrape operation succeeded
 * @param {object|string} payload - Data payload if success, error message if failure
 * @returns {{status: boolean, result?: object, message?: string}} Standardized response
 */
export function createScraperResult(success, payload, statusCode = null) {
  if (success) {
    return { status: true, result: payload };
  }
  const res = {
    status: false,
    message:
      typeof payload === "string"
        ? payload
        : payload?.message || "Scraping failed.",
  };
  if (statusCode !== null && statusCode !== undefined) {
    res.statusCode = statusCode;
  }
  return res;
}
