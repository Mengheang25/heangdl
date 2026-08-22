import { CHROME_UA, getCookiesFromHeaders } from "../utils/index.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _pinSource = null;
export function setPinterestSource(src) {
  _pinSource = src;
}

export async function scrapePinterest(url) {
  if (!_pinSource) {
    return { status: true, requireSource: true };
  }

  let currentStatus = null;
  try {
    if (_pinSource === "pindown") {
      const r1 = await scraperFetch(
        {
          url: "https://pindown.io/",
          headers: { "User-Agent": CHROME_UA },
          rawResponse: true,
        },
        "Pindown Main",
      );
      currentStatus = r1.status;
      const cookies = getCookiesFromHeaders(r1.headers);
      const parser = new DOMParser();
      const doc1 = parser.parseFromString(r1.data, "text/html");

      const tokenInput = doc1.querySelector(
        'input[type="hidden"]:not([name="lang"])',
      );
      const tokenName = tokenInput?.getAttribute("name");
      const tokenValue = tokenInput?.getAttribute("value");

      if (!tokenName || !tokenValue)
        throw new Error("Pinterest token not found.");

      const r2Data = await scraperFetch(
        {
          url: "https://pindown.io/action",
          method: "POST",
          data: { url, [tokenName]: tokenValue, lang: "en" },
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookies,
            "User-Agent": CHROME_UA,
          },
        },
        "Pindown Action",
      );

      const doc2 = parser.parseFromString(r2Data.html || "", "text/html");
      const downloads = [];
      doc2.querySelectorAll(".columns .column").forEach((el) => {
        const title = el.querySelector(".is-size-6")?.textContent?.trim() || "";
        const dlUrl = el.querySelector(".button")?.getAttribute("href");
        if (dlUrl) {
          const lowerUrl = dlUrl.toLowerCase();
          let dlType = "IMAGE";
          if (lowerUrl.endsWith(".mp4")) {
            dlType = "VIDEO";
          } else if (
            lowerUrl.match(/\.(jpg|jpeg|png|webp)/) ||
            lowerUrl.includes("i.pinimg.com") ||
            title.toLowerCase().includes("image") ||
            title.toLowerCase().includes("photo")
          ) {
            dlType = "IMAGE";
          }
          downloads.push({ type: dlType, url: dlUrl });
        }
      });

      if (downloads.length === 0) {
        throw new Error("No download links found for this Pinterest link.");
      }

      _pinSource = null;
      return createScraperResult(true, {
        title: doc2.querySelector("h3")?.textContent?.trim() || "Pinterest",
        thumbnail: doc2.querySelector(".image img")?.getAttribute("src"),
        downloads,
        sourceUrl: url,
      });
    }

    const pageRes = await scraperFetch(
      {
        url: url,
        headers: {
          "User-Agent": CHROME_UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        rawResponse: true,
      },
      "Pinterest Direct",
    );
    currentStatus = pageRes.status;

    if (!pageRes.data || typeof pageRes.data !== "string") {
      throw new Error("Failed to fetch Pinterest page.");
    }

    const html = pageRes.data;

    // Title
    let title = "Pinterest Pin";
    const ogTitleMatch =
      html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      title = ogTitleMatch[1].replace(/ \| Pinterest$/i, "").trim();
    }

    // Videos
    const videoMatches =
      html.match(
        /https:\/\/(?:v1\.pinimg\.com|7\.pinimg\.com|v\.pinimg\.com)\/[a-zA-Z0-9\/._-]+\.mp4/gi,
      ) || html.match(/https:\/\/[^"'\s]+\.mp4/gi);

    // Images - prefer originals
    let rawImageMatches =
      html.match(
        /https:\/\/i\.pinimg\.com\/originals\/[a-zA-Z0-9\/._-]+\.(?:jpg|jpeg|png|webp)/gi,
      ) || [];

    if (rawImageMatches.length === 0) {
      rawImageMatches =
        html.match(
          /https:\/\/i\.pinimg\.com\/736x\/[a-zA-Z0-9\/._-]+\.(?:jpg|jpeg|png|webp)/gi,
        ) || [];
    }

    // Filter out site assets
    const isSiteAsset = (u) =>
      u.includes("d53b014d86a6b6761bf649a0ed813c2b") ||
      u.includes("/avatars/") ||
      u.includes("/profile/") ||
      u.includes("sprite") ||
      u.includes("placeholder");

    const filteredImages = rawImageMatches.filter((u) => !isSiteAsset(u));
    const uniqueVideos = videoMatches ? [...new Set(videoMatches)] : [];
    const uniqueImages = [...new Set(filteredImages)];

    if (uniqueVideos.length === 0 && uniqueImages.length === 0) {
      throw new Error("No media found in Pinterest page.");
    }

    const downloads = [];
    uniqueImages.forEach((iUrl) => {
      downloads.push({ type: "IMAGE", url: iUrl });
    });
    uniqueVideos.forEach((vUrl) => {
      downloads.push({ type: "VIDEO", url: vUrl });
    });

    _pinSource = null;
    return createScraperResult(true, {
      title,
      thumbnail: uniqueImages[0] || uniqueVideos[0] || "",
      downloads,
      sourceUrl: url,
    });
  } catch (err) {
    _pinSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}
