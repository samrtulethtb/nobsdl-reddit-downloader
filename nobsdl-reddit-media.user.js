// ==UserScript==
// @name         NoBsDL Reddit Media Downloader
// @namespace    https://nobsdl.com/
// @version      1.2.0
// @description  Save Reddit images, galleries and comment images straight from the page, download Reddit videos with audio through NoBsDL, and export the comments loaded on a post to JSON, CSV or Markdown. No popups, no fake buttons.
// @author       NoBsDL
// @icon         https://nobsdl.com/static/images/icon-192x192.png
// @homepageURL  https://nobsdl.com/reddit-downloader
// @supportURL   https://nobsdl.com/contact
// @license      MIT
// @match        *://reddit.com/*
// @match        *://*.reddit.com/*
// @match        *://redd.it/*
// @exclude      *://embed.reddit.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_download
// @grant        GM.download
// @connect      nobsdl.com
// @connect      i.redd.it
// @connect      preview.redd.it
// @antifeature  payment Some Reddit video qualities or files above NoBsDL's free limits need a paid NoBsDL Supporter key; those choices are shown with a lock.
// @run-at       document-idle
// @noframes
// ==/UserScript==

// What this script sends, and when:
// - Images and galleries: nothing is sent to NoBsDL. The image is fetched
//   from Reddit's own image hosts (i.redd.it / preview.redd.it) through your
//   userscript manager and saved by the browser.
// - Videos: only when you open the video panel, the canonical Reddit post URL
//   is sent to https://nobsdl.com/api/video-info to list the real formats.
//   Choosing a format starts the async job on NoBsDL; the panel polls its
//   status and finally hands the finished file to the browser (through your
//   userscript manager's download function when it has one).
// - Reddit posts that embed a RedGIFs or Streamable video: the validated
//   RedGIFs/Streamable link of that post (not the Reddit post URL) is sent to
//   the same endpoint, because that is the URL NoBsDL can list formats for.
// - Comment export: runs locally and sends nothing. It reads only the comments
//   already loaded in the page, builds JSON, CSV or Markdown in your browser
//   and saves it as a file. It never loads more comments and uses no network.
// - No analytics, no cookies, no stored history, no requests while scrolling.
//   Only Reddit-hosted images are handled; external image hosts are left alone.
(function () {
  "use strict";

  const NOBSDL_ORIGIN = "https://nobsdl.com";
  const REDDIT_ORIGIN = "https://www.reddit.com";
  const ROOT_ID = "nobsdl-reddit-media";
  const PAGE_STYLE_ID = "nobsdl-reddit-media-style";
  const IMAGE_HOSTS = Object.freeze(["i.redd.it", "preview.redd.it"]);
  const IMAGE_EXTENSIONS = Object.freeze(["jpg", "jpeg", "png", "gif", "webp", "avif"]);
  const POLL_INTERVAL_MS = 1000;
  const POLL_DEADLINE_MS = 20 * 60 * 1000;
  const POST_SELECTOR = "shreddit-post, [data-testid='post-container']";
  const VIDEO_PLAYER_SELECTOR = "shreddit-player, shreddit-player-2, shreddit-video-player";
  const VIDEO_BADGE_SELECTOR = ".nobsdl-reddit-badge[data-nobsdl-kind='video']";

  // ── Small presentation helpers ─────────────────────────────────────────
  function positiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function positiveInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  function heightFromLabel(label) {
    const m = String(label || "").match(/(\d{3,4})p/i);
    return m ? Number(m[1]) : 0;
  }

  function formatBytes(bytes) {
    const mb = Number(bytes) / (1024 * 1024);
    if (!Number.isFinite(mb) || mb < 0) return "";
    if (mb >= 1024) return (mb / 1024).toFixed(2) + " GB";
    return (mb >= 100 ? Math.round(mb) : mb.toFixed(1)) + " MB";
  }

  function formatSize(mb) {
    if (!positiveNumber(mb)) return "";
    return "~" + (mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + " MB");
  }

  function formatSpeed(bps) {
    const n = Number(bps);
    if (!Number.isFinite(n) || n <= 0) return "";
    return n >= 1024 * 1024 ? (n / (1024 * 1024)).toFixed(1) + " MB/s" : Math.max(1, Math.round(n / 1024)) + " KB/s";
  }

  function formatEta(seconds) {
    const n = Math.max(1, Number(seconds) || 0);
    return n < 60 ? "~" + Math.round(n) + "s left" : "~" + Math.round(n / 60) + " min left";
  }

  function formatDuration(seconds) {
    const s = Math.floor(Number(seconds) || 0);
    if (s <= 0) return "";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0") : m + ":" + String(r).padStart(2, "0");
  }

  // Reddit's own title attributes sometimes carry the subreddit prefix or
  // the document title suffix. Only presentation is cleaned; nothing is
  // invented when the page gives no title.
  function cleanPostTitle(value) {
    let text = String(value || "").replace(/\s+/g, " ").trim();
    text = text.replace(/^r\/[A-Za-z0-9_]+\s*[-–—]\s*/i, "");
    text = text.replace(/\s*[:|–—-]\s*r\/[A-Za-z0-9_]+\s*$/i, "");
    text = text.replace(/\s*[-–—]\s*Reddit\s*$/i, "");
    return text.trim();
  }

  function cleanFilenameBase(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 100)
      .trim();
  }

  function extensionForContentType(contentType) {
    const type = String(contentType || "").toLowerCase().split(";")[0].trim();
    if (type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg") return "jpg";
    if (type === "image/png") return "png";
    if (type === "image/gif") return "gif";
    if (type === "image/webp") return "webp";
    if (type === "image/avif") return "avif";
    return "";
  }

  function extensionFromUrl(value) {
    let path = "";
    try { path = new URL(String(value || "")).pathname; } catch (_) { path = String(value || ""); }
    const m = path.match(/\.([A-Za-z0-9]{2,5})$/);
    const ext = m ? m[1].toLowerCase() : "";
    return IMAGE_EXTENSIONS.includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "";
  }

  // ── Reddit URL parsing ─────────────────────────────────────────────────
  function hostIs(host, suffix) {
    return host === suffix || host.endsWith("." + suffix);
  }

  function parseRedditPostUrl(input, base) {
    let url;
    try {
      url = input instanceof URL ? new URL(input.href) : new URL(String(input || ""), base || REDDIT_ORIGIN);
    } catch (_) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");

    if (hostIs(host, "reddit.com")) {
      // yt-dlp's Reddit extractor accepts exactly these post paths:
      // /comments/<id> and /r/<sub>/comments/<id> (also /user/<name>/...).
      const m = url.pathname.match(/^(?:\/(?:r|user)\/[^/]+)?\/comments\/([a-z0-9]{4,12})(?:\/|$)/i);
      if (!m) return null;
      const subreddit = (url.pathname.match(/^\/r\/([^/]+)/i) || [])[1] || "";
      const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
      return {
        id: m[1],
        url: REDDIT_ORIGIN + path,
        path,
        subreddit,
      };
    }

    if (host === "redd.it" || host === "www.redd.it") {
      // redd.it short links redirect to a post. Direct CDN hosts
      // (v.redd.it, i.redd.it, preview.redd.it) are deliberately not posts.
      const m = url.pathname.match(/^\/([a-z0-9]{4,12})(?:\/|$)/i);
      if (!m) return null;
      return {
        id: m[1],
        url: REDDIT_ORIGIN + "/comments/" + m[1],
        path: "/comments/" + m[1],
        subreddit: "",
      };
    }
    return null;
  }

  function postUrlFromId(value) {
    const m = String(value || "").trim().match(/^(?:t3_)?([a-z0-9]{4,12})$/i);
    return m ? REDDIT_ORIGIN + "/comments/" + m[1] : null;
  }

  // ── Reddit image URL parsing ───────────────────────────────────────────
  function parseRedditImageUrl(input, base) {
    let url;
    try {
      url = input instanceof URL ? new URL(input.href) : new URL(String(input || ""), base || REDDIT_ORIGIN);
    } catch (_) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!IMAGE_HOSTS.includes(host)) return null;
    if (!/\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)) return null;
    const format = String(url.searchParams.get("format") || "").toLowerCase();
    if (format === "mp4" || format === "webm") return null;
    url.protocol = "https:";
    url.hash = "";
    const ext = ((url.pathname.match(/\.([A-Za-z0-9]{2,5})$/i) || [])[1] || "").toLowerCase();
    return {
      url: url.href,
      host,
      pathname: url.pathname,
      ext: ext === "jpeg" ? "jpg" : ext,
      // The preview and the original use the same Reddit path; treating them
      // as one image prevents a gallery or an in-flight save from duplicating
      // the same media under two hosts.
      key: url.pathname,
    };
  }

  function isRedditImageUrl(input, base) {
    return Boolean(parseRedditImageUrl(input, base));
  }

  // Reddit serves the original file at i.redd.it with the same path as a
  // preview.redd.it preview. Trying the original first preserves full
  // quality; the caller falls back to the preview URL if Reddit refuses it.
  function originalImageUrl(input) {
    const image = parseRedditImageUrl(input);
    if (!image) return null;
    if (!["jpg", "png", "gif"].includes(image.ext)) return null;
    if (image.host === "i.redd.it") return "https://i.redd.it" + image.pathname;
    // Modern previews are /<slug>-v0-<id>.<ext>; the original lives at
    // i.redd.it/<id>.<ext> (the slug path on i.redd.it answers 403).
    const last = image.pathname.split("/").filter(Boolean).pop() || "";
    const modern = last.match(/^(?:.*-)?v0-([a-z0-9]+)\.(jpe?g|png|gif)$/i);
    if (modern) return "https://i.redd.it/" + modern[1] + "." + modern[2].toLowerCase();
    return "https://i.redd.it" + image.pathname;
  }

  // RedGIFs and Streamable posts: Reddit only shows an embed, so the external
  // URL is what NoBsDL needs. Exact hosts, https only, no userinfo or port,
  // and a path that is really one video. Returns the canonical URL or null.
  function parseEmbedVideoUrl(input) {
    let url;
    try { url = new URL(String(input || "")); } catch (_) { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (host === "redgifs.com" || host === "www.redgifs.com" || host === "v3.redgifs.com") {
      const m = url.pathname.match(/^\/watch\/([A-Za-z0-9_-]{3,64})\/?$/);
      return m ? "https://www.redgifs.com/watch/" + m[1] : null;
    }
    if (host === "streamable.com" || host === "www.streamable.com") {
      const m = url.pathname.match(/^\/([A-Za-z0-9]{3,12})\/?$/);
      return m ? "https://streamable.com/" + m[1] : null;
    }
    return null;
  }

  function imageKey(input) {
    const image = parseRedditImageUrl(input);
    return image ? image.key : "";
  }

  // ── srcset and gallery data ────────────────────────────────────────────
  function srcsetCandidates(srcset, base) {
    const out = [];
    for (const part of String(srcset || "").split(",")) {
      const fields = part.trim().split(/\s+/).filter(Boolean);
      if (!fields.length) continue;
      const raw = fields[0];
      const descriptor = fields[1] || "";
      let url;
      try { url = new URL(raw, base || REDDIT_ORIGIN).href; } catch (_) { continue; }
      const width = /^(\d+)w$/i.exec(descriptor);
      const density = /^([\d.]+)x$/i.exec(descriptor);
      out.push({
        url,
        width: width ? Number(width[1]) : 0,
        density: density ? Number(density[1]) : 0,
      });
    }
    return out;
  }

  function bestImageVariant(src, srcset, base) {
    const candidates = srcsetCandidates(srcset, base);
    let best = null;
    for (const candidate of candidates) {
      if (!best
        || candidate.width > best.width
        || (candidate.width === best.width && candidate.density > best.density)) {
        best = candidate;
      }
    }
    const chosen = best ? best.url : String(src || "");
    if (!chosen) return "";
    try { return new URL(chosen, base || REDDIT_ORIGIN).href; } catch (_) { return ""; }
  }

  function galleryItemsFromImages(images) {
    const out = [];
    const seen = new Set();
    for (const raw of images || []) {
      if (!raw) continue;
      const image = parseRedditImageUrl(raw.url);
      if (!image || seen.has(image.key)) continue;
      seen.add(image.key);
      // Reddit uses 1-based page-N slots, but accept a real 0-based page too
      // instead of treating page 0 as "no page" and pushing it to the end.
      const hasPage = raw.page !== undefined && raw.page !== null && raw.page !== "";
      const pageNumber = hasPage ? Number(raw.page) : NaN;
      const page = Number.isFinite(pageNumber) && pageNumber >= 0 ? Math.round(pageNumber) : -1;
      out.push({
        url: image.url,
        key: image.key,
        alt: cleanPostTitle(raw.alt || ""),
        page,
        order: out.length,
      });
    }
    if (out.some((item) => item.page >= 0)) {
      out.sort((a, b) => {
        const left = a.page < 0 ? Number.MAX_SAFE_INTEGER : a.page;
        const right = b.page < 0 ? Number.MAX_SAFE_INTEGER : b.page;
        return left - right || a.order - b.order;
      });
    }
    return out.map((item, index) => ({
      url: item.url,
      key: item.key,
      alt: item.alt,
      page: item.page < 0 ? 0 : item.page,
      index: index + 1,
      total: out.length,
    }));
  }

  // ── Filenames ──────────────────────────────────────────────────────────
  function imageFilename({title, url, index, total, contentType} = {}) {
    const count = Math.max(1, Number(total) || 1);
    const position = Math.max(1, Number(index) || 1);
    let base = cleanFilenameBase(cleanPostTitle(title));
    base = base.replace(/\.(?:jpe?g|png|gif|webp|avif)$/i, "").trim();
    if (!base) {
      const image = parseRedditImageUrl(url);
      const last = image ? image.pathname.split("/").filter(Boolean).pop() || "" : "";
      base = cleanFilenameBase(last.replace(/\.[^.]+$/, "").replace(/-v0-[a-z0-9]+$/i, ""));
    }
    if (!base) base = "reddit-image";
    const suffix = count > 1 ? " - " + String(position).padStart(2, "0") : "";
    const ext = extensionForContentType(contentType) || extensionFromUrl(url) || "jpg";
    const room = Math.max(24, 120 - suffix.length - ext.length - 1);
    base = base.slice(0, room).trim().replace(/[.\s]+$/, "") || "reddit-image";
    return base + suffix + "." + ext;
  }

  function galleryZipFilename({title} = {}) {
    return (cleanFilenameBase(cleanPostTitle(title)) || "reddit-gallery") + ".zip";
  }

  // ── Local ZIP writer ───────────────────────────────────────────────────
  // Reddit galleries are saved as one browser download instead of N separate
  // downloads (which can make the browser ask for multi-file permission).
  // Images are already compressed, so the archive stores them without deflating
  // and has no dependency on a ZIP library. The output is a standard ZIP with
  // UTF-8 file names (general-purpose bit 11).
  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipDosDateTime(value) {
    const date = value instanceof Date ? value : new Date();
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function zipArchive(files) {
    const entries = [];
    const chunks = [];
    const stamp = zipDosDateTime();
    let offset = 0;
    for (const file of files || []) {
      if (!file) continue;
      const nameBytes = new TextEncoder().encode(String(file.name || "image"));
      const data = file.bytes instanceof Uint8Array
        ? file.bytes
        : new Uint8Array(file.bytes || []);
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      chunks.push(local, data);
      entries.push({nameBytes, crc, size: data.length, offset});
      offset += local.length + data.length;
    }
    const centralOffset = offset;
    for (const entry of entries) {
      const central = new Uint8Array(46 + entry.nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, entry.crc, true);
      centralView.setUint32(20, entry.size, true);
      centralView.setUint32(24, entry.size, true);
      centralView.setUint16(28, entry.nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, entry.offset, true);
      central.set(entry.nameBytes, 46);
      chunks.push(central);
      offset += central.length;
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, offset - centralOffset, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);
    chunks.push(end);
    return new Blob(chunks, {type: "application/zip"});
  }

  // ── Formats from NoBsDL ────────────────────────────────────────────────
  // /api/video-info returns free/Supporter video dictionaries for Reddit and
  // an audio_formats dictionary with 128 / 256 / 320 kbps entries. No quality
  // is invented here: every card maps to an entry the server returned.
  function normalizeRedditChoices(data) {
    const premium = Boolean(data && data.is_supporter);
    const video = [];
    const audio = [];

    function addVideos(entries, supporterList) {
      for (const [label, entry] of Object.entries(entries || {})) {
        if (!entry || typeof entry !== "object") continue;
        const height = positiveInt(entry.quality_edge) || positiveInt(entry.height) || heightFromLabel(label) || 0;
        const formatId = typeof entry.format_id === "string" ? entry.format_id : "";
        if (!height && !formatId) continue;
        const sizeMb = positiveNumber(entry.size_mb);
        const resolution = typeof entry.resolution === "string" && entry.resolution !== "?" ? entry.resolution : "";
        video.push({
          key: "v:" + (formatId || (label + ":" + height)),
          family: "video",
          format: "mp4",
          title: height ? height + "p" : "Original",
          resolution,
          height,
          formatId,
          sizeMb,
          locked: !premium && (supporterList || entry.tier === "supporter"),
        });
      }
    }

    addVideos(data && data.video_formats, false);
    addVideos(data && data.supporter_video_formats, true);

    for (const entry of Object.values((data && data.audio_formats) || {})) {
      if (!entry || typeof entry !== "object") continue;
      const bitrate = Number(entry.bitrate);
      if (![128, 256, 320].includes(bitrate)) continue;
      audio.push({
        key: "a:" + bitrate,
        family: "audio",
        format: "mp3",
        title: bitrate + " kbps",
        bitrate,
        formatId: typeof entry.format_id === "string" ? entry.format_id : "",
        sizeMb: positiveNumber(entry.size_mb),
        locked: !premium && entry.tier === "supporter",
      });
    }

    const dedupe = (items, compare) => {
      const seen = new Set();
      return items.filter((item) => (seen.has(item.key) ? false : seen.add(item.key))).sort(compare);
    };
    const videoSorted = dedupe(video, (a, b) => (a.locked - b.locked) || (b.height - a.height) || a.title.localeCompare(b.title));
    const audioSorted = dedupe(audio, (a, b) => (a.locked - b.locked) || (b.bitrate - a.bitrate));

    return {
      title: cleanPostTitle(data && data.title),
      duration: Number(data && data.duration) || 0,
      isSupporter: premium,
      video: videoSorted,
      audio: audioSorted,
    };
  }

  function downloadParams(choice, sourceUrl) {
    // A Reddit post URL, or the validated RedGIFs/Streamable URL of an
    // embed post; nothing else is ever sent to /download.
    const post = parseRedditPostUrl(sourceUrl);
    const target = post ? post.url : parseEmbedVideoUrl(sourceUrl);
    if (!target || !choice || (choice.family !== "video" && choice.family !== "audio")) return null;
    const params = new URLSearchParams({
      url: target,
      format: choice.family === "audio" ? "mp3" : "mp4",
      async: "1",
    });
    if (choice.formatId) params.set("format_id", choice.formatId);
    else if (choice.family === "audio" && choice.bitrate) params.set("audio_bitrate", String(choice.bitrate));
    return "/download?" + params.toString();
  }

  // ── Progress ───────────────────────────────────────────────────────────
  const PHASE_ORDER = ["requesting", "queued", "connecting", "downloading", "merging", "converting", "finalizing", "ready"];
  const PHASE_STEP = {requesting: 0, queued: 0, connecting: 1, downloading: 1, merging: 2, converting: 2, finalizing: 2, ready: 3};

  function phaseLabel(phase, format) {
    switch (phase) {
      case "queued": return "Waiting for a free download slot";
      case "connecting": return "Preparing the Reddit video on NoBsDL";
      case "downloading": return "Downloading on NoBsDL";
      case "merging": return "Merging video and audio";
      case "converting": return format === "mp3" ? "Converting to MP3" : "Processing the file";
      case "finalizing": return "Finishing up";
      case "ready": return "Ready";
      default: return "Starting your download";
    }
  }

  function progressView(phase, progress, elapsedSeconds, format) {
    const p = progress || {};
    let fraction = typeof p.fraction === "number" ? Math.max(0, Math.min(1, p.fraction)) : null;
    if (phase === "converting") {
      fraction = typeof p.encode_fraction === "number" ? Math.max(0, Math.min(1, p.encode_fraction)) : null;
    }
    let mode = "waiting";
    if (phase === "ready") mode = "done";
    else if ((phase === "downloading" || phase === "converting") && fraction !== null) mode = "measured";
    else if (phase === "merging" || phase === "converting" || phase === "finalizing") mode = "working";

    let text;
    if (phase === "ready") {
      text = "Ready — your browser is saving the file.";
    } else if (phase === "downloading" && p.downloaded_bytes) {
      const parts = [];
      if (fraction !== null) parts.push(Math.floor(fraction * 100) + "%");
      parts.push(fraction !== null && p.total_bytes
        ? formatBytes(p.downloaded_bytes) + " of " + formatBytes(p.total_bytes)
        : formatBytes(p.downloaded_bytes) + " downloaded");
      if (p.speed_bps) parts.push(formatSpeed(p.speed_bps));
      if (typeof p.eta_seconds === "number" && p.eta_seconds > 0) parts.push(formatEta(p.eta_seconds));
      text = parts.join(" · ");
    } else if (phase === "converting" && fraction !== null) {
      text = phaseLabel(phase, format) + "… " + Math.floor(fraction * 100) + "%";
    } else {
      text = phaseLabel(phase, format) + "…" + (elapsedSeconds >= 2 ? " " + elapsedSeconds + "s" : "");
    }
    return {mode, fraction, text, step: PHASE_STEP[phase] || 0};
  }

  // ── Transport (GM only) ────────────────────────────────────────────────
  // The page's own fetch/XMLHttpRequest is never used: only the userscript
  // manager's transport, which is also what lets an active NoBsDL Supporter
  // cookie work when the manager sends it.
  function gmRequestFunction() {
    try {
      if (typeof GM_xmlhttpRequest === "function") return GM_xmlhttpRequest;
    } catch (_) { /* not granted */ }
    try {
      if (typeof GM === "object" && GM && typeof GM.xmlHttpRequest === "function") return GM.xmlHttpRequest.bind(GM);
    } catch (_) { /* not granted */ }
    return null;
  }

  function humanMessage(data) {
    const texts = [data && data.message, data && data.detail, data && data.error]
      .filter((value) => typeof value === "string" && value.trim());
    return texts.find((value) => /\s/.test(value.trim())) || "";
  }

  function apiGet(path, timeout) {
    const send = gmRequestFunction();
    return new Promise((resolve, reject) => {
      if (!send) {
        reject(Object.assign(new Error("In-page downloads need a userscript manager with GM_xmlhttpRequest."), {code: "no_transport", retryable: false}));
        return;
      }
      const fail = (message) => reject(Object.assign(new Error(message), {code: "network", retryable: true}));
      send({
        method: "GET",
        url: NOBSDL_ORIGIN + path,
        headers: {Accept: "application/json"},
        timeout: timeout || 45000,
        onload: (response) => {
          let data = {};
          try { data = JSON.parse(response.responseText || "{}"); } catch (_) { data = {}; }
          if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
          const status = Number(response.status) || 0;
          const failed = data.success === false || data.ok === false || data.status === "error";
          if (status >= 200 && status < 300 && !failed) {
            resolve(data);
            return;
          }
          if (status === 451 && !Object.keys(data).length) {
            reject(Object.assign(new Error("NoBsDL isn't available in your country."), {status}));
            return;
          }
          const message = humanMessage(data) || (status === 404
            ? "NoBsDL couldn't find this Reddit post."
            : status === 429
              ? "Too many requests. Wait a moment and try again."
              : status >= 500
                ? "NoBsDL had a problem. Try again."
                : "NoBsDL couldn't process this Reddit link.");
          reject(Object.assign(new Error(message.slice(0, 300)), {
            status,
            supporterCta: data.supporter_cta === true || data.locked_format === true,
            refreshFormats: /choose_another_quality|retry_format/.test(String(data.suggested_action || "")),
            retryable: status === 429 || status >= 500,
          }));
        },
        onerror: () => fail("Can't reach NoBsDL. Check your connection."),
        ontimeout: () => fail("NoBsDL took too long to answer. Try again."),
      });
    });
  }

  function parseResponseHeaders(raw) {
    const out = {};
    for (const line of String(raw || "").split(/\r?\n/)) {
      const at = line.indexOf(":");
      if (at <= 0) continue;
      out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    }
    return out;
  }

  function binaryStringToBytes(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  function apiBinary(url, timeout) {
    const send = gmRequestFunction();
    return new Promise((resolve, reject) => {
      if (!send) {
        reject(Object.assign(new Error("Saving images in the page needs a userscript manager with GM_xmlhttpRequest."), {code: "no_transport"}));
        return;
      }
      const image = parseRedditImageUrl(url);
      if (!image) {
        reject(Object.assign(new Error("That isn't a Reddit image URL."), {code: "invalid_image"}));
        return;
      }
      send({
        method: "GET",
        url: image.url,
        // Not AVIF/WebP: asking for them makes Reddit answer with a WebP preview,
        // which some browsers open in a tab instead of saving.
        headers: {Accept: "image/jpeg,image/png,image/gif,*/*;q=0.1"},
        responseType: "arraybuffer",
        timeout: timeout || 45000,
        onload: (response) => {
          const status = Number(response.status) || 0;
          if (status < 200 || status >= 300) {
            const message = status === 403
              ? "Reddit refused this image (HTTP 403). Open the image and save it from your browser."
              : status === 404
                ? "This Reddit image is no longer available (HTTP 404)."
                : "Reddit's image host answered with HTTP " + status + ".";
            reject(Object.assign(new Error(message), {status, retryable: false}));
            return;
          }
          const headers = parseResponseHeaders(response.responseHeaders);
          const contentType = String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
          if (contentType && !contentType.startsWith("image/")) {
            reject(Object.assign(new Error("Reddit's image host returned a non-image response."), {status, retryable: false}));
            return;
          }
          let body = response.response;
          if (body == null && typeof response.responseText === "string") body = binaryStringToBytes(response.responseText);
          if (body == null) {
            reject(Object.assign(new Error("No image data came back from Reddit."), {status, retryable: false}));
            return;
          }
          const blob = body instanceof Blob ? body : new Blob([body], {type: contentType || "application/octet-stream"});
          resolve({blob, contentType, status});
        },
        onerror: () => reject(Object.assign(new Error("Couldn't reach Reddit's image host. Check your connection."), {code: "network", retryable: true})),
        ontimeout: () => reject(Object.assign(new Error("Reddit's image host took too long to answer. Try again."), {code: "network", retryable: true})),
      });
    });
  }

  function safeStatusPath(statusUrl) {
    const path = String(statusUrl || "");
    return /^\/api\/free-download\/status\/[A-Za-z0-9_-]{8,100}$/.test(path) ? path : null;
  }

  function safeFileUrl(directUrl) {
    const path = String(directUrl || "");
    return /^\/api\/free-download\/file\/[A-Za-z0-9_-]{8,100}$/.test(path) ? NOBSDL_ORIGIN + path : null;
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  const PAGE_STYLE = `
    .nobsdl-reddit-badge {
      all: initial;
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2147483000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 36px;
      max-width: calc(100% - 16px);
      padding: 0 13px;
      border: 1px solid rgba(255,255,255,.55);
      border-radius: 10px;
      background: linear-gradient(135deg,#6862f6,#497fee);
      box-shadow: 0 8px 26px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.4);
      color: #fff;
      font: 800 13px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      letter-spacing: .01em;
      white-space: nowrap;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: filter .15s ease, transform .15s ease;
    }
    .nobsdl-reddit-badge:hover { filter: brightness(1.16); transform: translateY(-1px); }
    .nobsdl-reddit-badge:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
    .nobsdl-reddit-badge[disabled] { cursor: progress; opacity: .82; }
    .nobsdl-reddit-comment-save {
      all: initial;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      margin: 4px 0 4px 6px;
      padding: 0 9px;
      border: 1px solid rgba(255,255,255,.55);
      border-radius: 7px;
      background: linear-gradient(135deg,#6862f6,#497fee);
      color: #fff;
      font: 700 11px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      white-space: nowrap;
      vertical-align: middle;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .nobsdl-reddit-comment-save:hover { filter: brightness(1.12); }
    .nobsdl-reddit-comment-save:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
    .nobsdl-reddit-comment-save[disabled] { cursor: progress; opacity: .75; }
    @media (prefers-reduced-motion: reduce) {
      .nobsdl-reddit-badge { transition: none; }
    }
  `;

  const PANEL_STYLE = `
    :host { all: initial; color-scheme: dark; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .scrim { position: fixed; inset: 0; background: rgba(2,6,23,.62); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
    .panel {
      position: fixed;
      left: 50%;
      top: 50%;
      z-index: 2;
      width: min(560px, calc(100vw - 28px));
      max-height: min(84vh, 760px);
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(148,163,184,.3);
      border-radius: 18px;
      background: rgba(9,11,17,.985);
      box-shadow: 0 26px 70px rgba(0,0,0,.62), 0 0 36px rgba(99,102,241,.16);
      color: #f1f5f9;
      font: 600 14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      overflow: hidden;
    }
    .head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 16px 12px; border-bottom: 1px solid rgba(148,163,184,.16); }
    .meta { flex: 1; min-width: 0; }
    .title { margin: 0; font-size: 16px; font-weight: 850; letter-spacing: -.01em; color: #f8fafc; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .sub { margin: 3px 0 0; font-size: 11.5px; font-weight: 600; color: #94a3b8; overflow-wrap: anywhere; }
    .close { all: initial; flex: none; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(148,163,184,.25); border-radius: 10px; color: #cbd5e1; font: 800 20px/1 system-ui,sans-serif; cursor: pointer; }
    .close:hover { background: rgba(148,163,184,.14); }
    .close:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
    .body { padding: 14px 16px; overflow-y: auto; overscroll-behavior: contain; }
    .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; border-top: 1px solid rgba(148,163,184,.16); font-size: 11px; font-weight: 600; color: #94a3b8; }
    .foot a, .note a, .error a { color: #a5b4fc; }
    .section + .section { margin-top: 16px; }
    .section h4 { margin: 0 0 8px; font-size: 10.5px; font-weight: 850; letter-spacing: .09em; text-transform: uppercase; color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
    .card {
      all: initial;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      min-height: 62px;
      padding: 10px 11px;
      border: 1px solid rgba(148,163,184,.24);
      border-radius: 12px;
      background: rgba(30,41,59,.58);
      color: #f8fafc;
      font: 700 14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      text-align: left;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease, transform .15s ease;
    }
    .card:hover { border-color: #7771ff; background: rgba(99,102,241,.18); transform: translateY(-1px); }
    .card:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
    .card[disabled] { cursor: progress; opacity: .65; }
    .card.locked { border-style: dashed; background: rgba(245,158,11,.07); }
    .card .q { font-size: 15px; font-weight: 850; }
    .card .s { font-size: 11px; font-weight: 600; color: #94a3b8; }
    .card.locked .s { color: #fbbf24; }
    .note { margin: 13px 0 0; font-size: 11.5px; color: #94a3b8; }
    .hint { margin: 10px 0 0; font-size: 12px; color: #cbd5e1; }
    .center { text-align: center; color: #94a3b8; font-size: 12px; }
    .spinner { width: 26px; height: 26px; margin: 12px auto; border: 3px solid rgba(148,163,184,.25); border-top-color: #7771ff; border-radius: 50%; animation: spin .8s linear infinite; }
    .error { padding: 10px 12px; border: 1px solid rgba(248,113,113,.38); border-radius: 12px; background: rgba(127,29,29,.26); color: #fecaca; font-size: 12.5px; overflow-wrap: anywhere; }
    .result-ok { padding: 11px 12px; border: 1px solid rgba(74,222,128,.34); border-radius: 12px; background: rgba(20,83,45,.27); color: #bbf7d0; font-size: 12.5px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .btn { all: initial; display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 14px; border: 1px solid transparent; border-radius: 10px; background: linear-gradient(135deg,#6862f6,#497fee); color: #fff; font: 800 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; text-decoration: none; cursor: pointer; }
    .btn:hover { filter: brightness(1.12); }
    .btn:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
    .btn[disabled] { cursor: progress; opacity: .65; }
    .btn-ghost { background: transparent; border-color: rgba(148,163,184,.32); color: #cbd5e1; }
    .steps { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); list-style: none; margin: 2px 0 12px; padding: 0; font-size: 10.5px; font-weight: 800; }
    .steps li { display: flex; flex-direction: column; align-items: center; gap: 5px; color: #64748b; }
    .steps li + li::after { content: ""; position: absolute; top: 4px; right: calc(50% + 9px); width: calc(100% - 18px); height: 2px; border-radius: 2px; background: currentColor; opacity: .5; }
    .steps li { position: relative; }
    .steps i { display: block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; }
    .steps [data-state=done] { color: #cbd5e1; }
    .steps [data-state=done] i { background: currentColor; }
    .steps [data-state=current] { color: #8b87ff; }
    .steps [data-state=current] i { background: currentColor; animation: pulse 1.3s ease-in-out infinite; }
    .track { position: relative; height: 8px; margin: 0 0 9px; border-radius: 99px; background: rgba(148,163,184,.18); overflow: hidden; }
    .bar { position: relative; height: 100%; width: 0; border-radius: 99px; background: linear-gradient(90deg,#6862f6,#3dd6f5); transition: width .95s linear; overflow: hidden; }
    .bar.waiting { width: 36%; transition: none; animation: slide 1.35s cubic-bezier(.45,0,.55,1) infinite; }
    .bar.working::after { content: ""; position: absolute; inset: 0; background-image: repeating-linear-gradient(-45deg, rgba(255,255,255,.3) 0 8px, rgba(255,255,255,0) 8px 16px); background-size: 22.6px 22.6px; animation: stripes .7s linear infinite; }
    .bar.measured::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.38), rgba(255,255,255,0)); transform: translateX(-100%); animation: sheen 1.6s ease-in-out infinite; }
    .status-line { margin: 0; min-height: 1.5em; color: #cbd5e1; font-size: 12px; text-align: center; font-variant-numeric: tabular-nums; }
    .gallery-list { display: flex; flex-direction: column; gap: 8px; }
    .gallery-item { display: grid; grid-template-columns: 88px minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 7px; border: 1px solid rgba(148,163,184,.18); border-radius: 12px; background: rgba(30,41,59,.4); }
    .gallery-item img { width: 88px; height: 66px; object-fit: cover; border-radius: 8px; background: rgba(148,163,184,.12); }
    .gi-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .gi-meta strong { font-size: 12.5px; color: #f8fafc; }
    .gi-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; font-size: 11px; }
    .gallery-item .btn { min-height: 34px; padding: 0 11px; }
    .toast { position: fixed; left: 50%; bottom: 22px; z-index: 3; width: min(480px, calc(100vw - 28px)); transform: translateX(-50%); padding: 11px 13px; border: 1px solid rgba(148,163,184,.3); border-radius: 12px; background: rgba(9,11,17,.98); box-shadow: 0 16px 44px rgba(0,0,0,.55); color: #e2e8f0; font: 600 12.5px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow-wrap: anywhere; }
    .toast.ok { border-color: rgba(74,222,128,.4); color: #bbf7d0; }
    .toast.error { border-color: rgba(248,113,113,.42); color: #fecaca; }
    .toast a { color: #a5b4fc; font-weight: 800; }
    @keyframes slide { 0% { transform: translateX(-105%); } 100% { transform: translateX(285%); } }
    @keyframes stripes { to { background-position: 22.6px 0; } }
    @keyframes sheen { to { transform: translateX(100%); } }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(139,135,255,.55); } 100% { box-shadow: 0 0 0 7px rgba(139,135,255,0); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 620px) {
      .panel { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: min(86vh, 720px); transform: none; border-radius: 18px 18px 0 0; border-bottom: 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
      .gallery-item { grid-template-columns: 70px minmax(0,1fr) auto; }
      .gallery-item img { width: 70px; height: 56px; }
      .toast { bottom: max(16px, env(safe-area-inset-bottom, 0px)); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .bar.waiting { width: 100%; opacity: .45; }
    }
  `;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of [].concat(children || [])) if (child) node.append(child);
    return node;
  }

  function externalLink(href, text, className) {
    const link = el("a", {class: className || "", href, text, target: "_blank"});
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    return link;
  }

  function ensurePageStyle() {
    if (document.getElementById(PAGE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    style.textContent = PAGE_STYLE;
    (document.head || document.documentElement).append(style);
  }

  let ui = null;
  let lastFocus = null;

  function ensureRoot() {
    if (ui) return ui;
    let host = document.getElementById(ROOT_ID);
    if (!host) {
      host = el("div", {id: ROOT_ID});
      host.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
      document.documentElement.append(host);
    }
    const shadow = host.shadowRoot || host.attachShadow({mode: "open"});
    shadow.replaceChildren();

    const style = el("style", {text: PANEL_STYLE});
    const scrim = el("div", {class: "scrim", hidden: true});
    const title = el("h2", {class: "title"});
    const sub = el("p", {class: "sub"});
    const close = el("button", {class: "close", type: "button", "aria-label": "Close", text: "×"});
    const body = el("div", {class: "body"});
    const foot = el("div", {class: "foot"});
    const panel = el("section", {
      class: "panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "NoBsDL Reddit media downloader",
      hidden: true,
    }, [
      el("header", {class: "head"}, [el("div", {class: "meta"}, [title, sub]), close]),
      body,
      foot,
    ]);
    const toast = el("div", {class: "toast", role: "status", hidden: true});

    scrim.style.pointerEvents = "auto";
    panel.style.pointerEvents = "auto";
    toast.style.pointerEvents = "auto";

    shadow.append(style, scrim, panel, toast);
    ui = {host, shadow, scrim, panel, title, sub, body, foot, toast, close};
    return ui;
  }

  let toastTimer = 0;
  function toast(message, kind, link) {
    const view = ensureRoot();
    clearTimeout(toastTimer);
    const text = el("span", {text: String(message || "Something went wrong.")});
    const children = [text];
    if (link && link.href) {
      children.push(document.createTextNode(" "));
      children.push(externalLink(link.href, link.text || "Open", ""));
    }
    view.toast.className = "toast" + (kind ? " " + kind : "");
    view.toast.setAttribute("role", kind === "error" ? "alert" : "status");
    view.toast.replaceChildren(...children);
    view.toast.hidden = false;
    if (!link) {
      toastTimer = setTimeout(() => { if (view.toast) view.toast.hidden = true; }, kind === "error" ? 11000 : 6000);
    }
  }

  function panelShell({title, sub, kind, body, foot}) {
    const view = ensureRoot();
    view.panel.dataset.kind = kind || "";
    view.title.textContent = title || "Reddit media";
    view.sub.textContent = sub || "";
    view.body.replaceChildren(...[].concat(body || []));
    view.foot.replaceChildren(...[].concat(foot || []));
    if (!lastFocus) lastFocus = document.activeElement;
    view.panel.hidden = false;
    view.scrim.hidden = false;
    view.close.focus({preventScroll: true});
  }

  function closePanel() {
    if (!ui) return;
    ui.panel.hidden = true;
    ui.scrim.hidden = true;
    state.open = false;
    if (lastFocus && typeof lastFocus.focus === "function") {
      try { lastFocus.focus({preventScroll: true}); } catch (_) { /* detached */ }
    }
    lastFocus = null;
  }

  function setButtonBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.nobsdlLabel) button.dataset.nobsdlLabel = button.textContent || "";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = label || "Working…";
    } else {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (button.dataset.nobsdlLabel) button.textContent = button.dataset.nobsdlLabel;
    }
  }

  const BADGE_SELECTOR = ".nobsdl-reddit-badge";
  const MIN_BADGE_WIDTH = 40;
  const BADGE_EDGE_TOLERANCE = 2;

  function createBadge(label, onClick, kind) {
    const button = el("button", {
      class: "nobsdl-reddit-badge",
      type: "button",
      text: label,
      title: "Download with NoBsDL",
      "aria-label": label + " with NoBsDL",
    });
    button.dataset.nobsdlKind = kind || "";
    button.style.position = "absolute";
    button.style.top = "8px";
    button.style.right = "8px";
    button.style.zIndex = "2147483000";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(button);
    });
    return button;
  }

  function setBadgeLabel(badge, label) {
    if (!badge || badge.disabled || badge.textContent === label) return;
    badge.textContent = label;
    badge.setAttribute("aria-label", label + " with NoBsDL");
  }

  function badgeHasBox(badge) {
    if (!badge || !badge.getClientRects || !badge.getClientRects().length) return false;
    const rect = badge.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // A badge whose box is empty (its host is hidden, collapsed or was
  // re-rendered) is treated as missing so a later scan can mount it again.
  function pruneDeadBadges(root) {
    if (!root || !root.querySelectorAll) return;
    for (const badge of root.querySelectorAll(BADGE_SELECTOR)) {
      if (!badgeHasBox(badge)) badge.remove();
    }
  }

  // Shadow-hosting and inline/contents elements (Reddit's
  // shreddit-async-loader) are not a positioning context in every browser:
  // Firefox puts an absolutely-positioned child of an inline relative host
  // outside the post. Those hosts are never used.
  function hostCanHoldBadge(host) {
    if (!host || host.nodeType !== 1 || host.shadowRoot) return false;
    if (!host.getClientRects || !host.getClientRects().length) return false;
    let display = "";
    try { display = window.getComputedStyle(host).display; } catch (_) { return false; }
    return display !== "inline" && display !== "contents" && display !== "none";
  }

  function badgeSitsInsideHost(badge, host) {
    if (!badge.getClientRects().length) return false;
    const box = badge.getBoundingClientRect();
    if (box.width <= MIN_BADGE_WIDTH) return false;
    const area = host.getBoundingClientRect();
    const slack = BADGE_EDGE_TOLERANCE;
    return box.left >= area.left - slack && box.top >= area.top - slack
      && box.right <= area.right + slack && box.bottom <= area.bottom + slack;
  }

  // Mounts one badge on the first candidate host where it really shows up
  // inside that host. Returns the new badge, or null when a live badge already
  // exists in any candidate (no duplicates) or nothing suitable was found.
  function mountBadge(candidates, label, onClick, kind) {
    const hosts = [];
    for (const host of candidates || []) {
      if (host && host.nodeType === 1 && !hosts.includes(host)) hosts.push(host);
    }
    for (const host of hosts) pruneDeadBadges(host);
    for (const host of hosts) {
      if (host.querySelector(BADGE_SELECTOR)) return null;
    }
    for (const host of hosts) {
      if (!hostCanHoldBadge(host)) continue;
      const badge = createBadge(label, onClick, kind);
      const previousPosition = host.style.position;
      let positioned = false;
      try {
        if (window.getComputedStyle(host).position === "static") {
          host.style.position = "relative";
          positioned = true;
        }
      } catch (_) { /* optional */ }
      host.append(badge);
      if (badgeSitsInsideHost(badge, host)) return badge;
      badge.remove();
      if (positioned) host.style.position = previousPosition;
    }
    return null;
  }

  // Containers a post's media can live in, best first: Reddit's plain block
  // slot container, then the aspect-ratio wrappers, then the older markers.
  // Searched upwards from the media and downwards from the post, because
  // Reddit does not always keep the media inside the post's own subtree.
  const MEDIA_HOST_SELECTORS = Object.freeze([
    '[slot="post-media-container"]',
    '[id$="-aspect-ratio"]',
    "shreddit-aspect-ratio",
    '[data-testid="post-media-container"]',
    '[data-testid="post-media"]',
    ".media-preview",
  ]);

  function mediaHostCandidates(post, node, fallbacks) {
    const out = [];
    const add = (host, allowPost) => {
      if (host && host.nodeType === 1 && !out.includes(host) && (allowPost || host !== post)) out.push(host);
    };
    for (const selector of MEDIA_HOST_SELECTORS) {
      if (node && node.closest) add(node.closest(selector));
      if (post && post.querySelector) add(post.querySelector(selector));
    }
    for (const host of fallbacks || []) add(host, true);
    // Last resort: the wrappers between the media and its post, then the post.
    // mountBadge skips inline, shadow-hosting and hidden ones.
    if (post && node && post.contains && post.contains(node)) {
      for (let up = node.parentElement; up && up !== post; up = up.parentElement) add(up);
      add(post, true);
    }
    return out;
  }

  function addCommentButton(after, onClick, label) {
    if (!after || !after.parentElement) return null;
    const button = el("button", {
      class: "nobsdl-reddit-comment-save",
      type: "button",
      text: label || "⬇ Save",
      "aria-label": "Save this Reddit image with NoBsDL",
      title: "Download with NoBsDL",
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(button);
    });
    after.insertAdjacentElement("afterend", button);
    return button;
  }

  // ── Runtime state ──────────────────────────────────────────────────────
  const state = {
    context: null,
    busy: false,
    token: 0,
    videoCache: null,
    saving: new Set(),
    galleryBusy: false,
    open: false,
  };

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function openOnNoBsdlUrl(postUrl) {
    const post = parseRedditPostUrl(postUrl);
    return NOBSDL_ORIGIN + "/reddit-downloader" + (post ? "?url=" + encodeURIComponent(post.url) : "");
  }

  function saveBlob(blob, filename) {
    const href = URL.createObjectURL(blob);
    const anchor = el("a", {href, download: filename});
    anchor.style.display = "none";
    anchor.rel = "noopener noreferrer";
    anchor.referrerPolicy = "no-referrer";
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => { try { URL.revokeObjectURL(href); } catch (_) { /* gone */ } }, 60000);
  }

  function gmDownloadFunction() {
    try {
      if (typeof GM_download === "function") return GM_download;
    } catch (_) { /* not granted */ }
    try {
      if (typeof GM === "object" && GM && typeof GM.download === "function") return GM.download.bind(GM);
    } catch (_) { /* not granted */ }
    return null;
  }

  // The finished video file. With a userscript manager download function the
  // Reddit tab is never navigated (a 404/409/410 would replace it with JSON)
  // and the file gets a sane name; without one, or when it fails, the previous
  // behaviour applies: the browser is pointed at the file URL.
  function saveFile(fileUrl, filename) {
    let fellBack = false;
    const navigate = () => {
      if (fellBack) return;
      fellBack = true;
      saveFileByNavigation(fileUrl);
    };
    const download = gmDownloadFunction();
    if (!download) {
      navigate();
      return;
    }
    try {
      const result = download({url: fileUrl, name: filename, saveAs: false, onerror: navigate});
      if (result && typeof result.catch === "function") result.catch(navigate);
    } catch (_) {
      navigate();
    }
  }

  function videoSaveName(status, context, choice) {
    const wanted = choice && choice.family === "audio" ? "mp3" : "mp4";
    const known = ["mp4", "mp3", "m4a", "webm", "mkv", "mov"];
    const fromServer = String((status && status.filename) || "").split(/[\\/]/).pop();
    const parts = /^(.*?)(?:\.([A-Za-z0-9]{2,4}))?$/.exec(fromServer || "");
    const serverBase = cleanFilenameBase(parts ? parts[1] : "");
    const serverExt = parts && parts[2] ? parts[2].toLowerCase() : "";
    const base = serverBase
      || cleanFilenameBase(cleanPostTitle(context && context.title))
      || "reddit-video";
    return base + "." + (known.includes(serverExt) ? serverExt : wanted);
  }

  function saveFileByNavigation(fileUrl) {
    const anchor = el("a", {href: fileUrl});
    anchor.style.display = "none";
    anchor.rel = "noopener noreferrer";
    anchor.referrerPolicy = "no-referrer";
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
  }

  // ── Images and galleries ───────────────────────────────────────────────
  async function fetchImageItem(item) {
    const candidates = [];
    for (const candidate of [originalImageUrl(item.url), item.url]) {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
    }
    let lastError = null;
    for (const candidate of candidates) {
      try {
        return await apiBinary(candidate);
      } catch (error) {
        lastError = error;
        if (error && error.code === "no_transport") break;
      }
    }
    throw lastError || new Error("Couldn't save this Reddit image.");
  }

  async function saveImageItem(context, item, options) {
    const settings = options || {};
    const button = settings.button || null;
    const quiet = settings.quiet === true;
    const key = item.key || imageKey(item.url);
    if (!key || state.saving.has(key)) {
      return {ok: false, error: new Error("This image is already being saved.")};
    }
    state.saving.add(key);
    setButtonBusy(button, true, "Saving…");
    try {
      const response = await fetchImageItem(item);
      const filename = imageFilename({
        title: context.title,
        url: item.url,
        index: item.index,
        total: item.total,
        contentType: response.contentType,
      });
      saveBlob(response.blob, filename);
      if (!quiet) toast("Saved " + filename, "ok");
      setButtonBusy(button, false);
      return {ok: true, filename};
    } catch (failure) {
      const error = failure || new Error("Couldn't save this Reddit image.");
      if (!quiet) toast(error.message, "error", {href: item.url, text: "Open image"});
      setButtonBusy(button, false);
      return {ok: false, error};
    } finally {
      state.saving.delete(key);
    }
  }

  function renderGallery(context) {
    const items = context.items || [];
    const list = el("div", {class: "gallery-list"});
    const status = el("p", {class: "status-line", "aria-live": "polite"});
    const saveAll = el("button", {
      class: "btn save-all",
      type: "button",
      text: items.length === 1 ? "Save image" : "Save all (.zip)",
    });
    const rows = [];

    for (const item of items) {
      const thumb = el("img", {src: item.url, alt: "", loading: "lazy"});
      thumb.referrerPolicy = "no-referrer";
      const meta = el("div", {class: "gi-meta"}, [
        el("strong", {text: "Image " + item.index + " of " + item.total}),
        el("span", {text: item.alt || "Reddit image"}),
      ]);
      const save = el("button", {class: "btn", type: "button", text: "Save"});
      save.addEventListener("click", async () => {
        if (state.saving.has(item.key)) return;
        status.textContent = "Saving image " + item.index + " of " + item.total + "…";
        const result = await saveImageItem(context, item, {button: save, quiet: false});
        if (result.ok) {
          save.textContent = "Saved";
          save.disabled = true;
          status.textContent = "Saved " + result.filename + ".";
        } else {
          save.textContent = "Try again";
          save.disabled = false;
          status.textContent = result.error && result.error.message || "Couldn't save this image.";
        }
      });
      rows.push(save);
      list.append(el("div", {class: "gallery-item"}, [thumb, meta, save]));
    }

    saveAll.addEventListener("click", async () => {
      if (state.galleryBusy || !items.length) return;
      state.galleryBusy = true;
      saveAll.disabled = true;
      for (const row of rows) row.disabled = true;
      let saved = 0;
      let failed = 0;
      try {
        // A one-image gallery behaves exactly like a normal single image.
        if (items.length === 1) {
          status.textContent = "Saving image 1 of 1…";
          const result = await saveImageItem(context, items[0], {button: rows[0], quiet: true});
          if (result.ok) {
            saved = 1;
            rows[0].textContent = "Saved";
            rows[0].disabled = true;
            status.textContent = "Saved " + result.filename + ".";
            toast("Saved " + result.filename + ".", "ok");
          } else {
            failed = 1;
            rows[0].textContent = "Try again";
            rows[0].disabled = false;
            status.textContent = result.error && result.error.message || "Couldn't save this image.";
            toast(status.textContent, "error");
          }
          return;
        }

        // Multiple pages become one local ZIP. That means one browser
        // download, matching the single-image behavior, instead of N downloads
        // that make the browser ask for multi-file permission.
        const files = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const key = item.key || imageKey(item.url);
          status.textContent = "Preparing " + (i + 1) + " of " + items.length + "…";
          if (key) {
            if (state.saving.has(key)) {
              failed++;
              rows[i].textContent = "Try again";
              rows[i].disabled = false;
              continue;
            }
            state.saving.add(key);
          }
          try {
            const response = await fetchImageItem(item);
            const filename = imageFilename({
              title: context.title,
              url: item.url,
              index: item.index,
              total: item.total,
              contentType: response.contentType,
            });
            files.push({name: filename, bytes: new Uint8Array(await response.blob.arrayBuffer())});
            saved++;
            rows[i].textContent = "Packed";
            rows[i].disabled = true;
          } catch (_) {
            failed++;
            rows[i].textContent = "Try again";
            rows[i].disabled = false;
          } finally {
            if (key) state.saving.delete(key);
          }
        }

        if (!files.length) {
          status.textContent = "Saved 0 of " + items.length + ". " + failed + " failed.";
          toast("No gallery images could be downloaded.", "error");
          return;
        }

        status.textContent = "Packing " + files.length + " image" + (files.length === 1 ? "" : "s") + " into one ZIP…";
        const zipName = galleryZipFilename({title: context.title});
        saveBlob(zipArchive(files), zipName);
        if (failed) {
          status.textContent = "Saved " + saved + " of " + items.length + " images in " + zipName + ". " + failed + " failed.";
          toast("Saved " + saved + " of " + items.length + " images in one ZIP. " + failed + " failed.", "error");
        } else {
          status.textContent = "Saved " + saved + " images in " + zipName + ".";
          toast("Saved " + saved + " images in one ZIP.", "ok");
        }
      } catch (error) {
        status.textContent = (error && error.message) || "Couldn't create the gallery ZIP.";
        toast(status.textContent, "error");
      } finally {
        state.galleryBusy = false;
        saveAll.disabled = false;
      }
    });

    panelShell({
      kind: "gallery",
      title: context.title || "Reddit gallery",
      sub: items.length + " image" + (items.length === 1 ? "" : "s") + " found in this post",
      body: [list, status, el("div", {class: "row"}, [saveAll])],
      foot: [
        el("span", {text: "Images come from Reddit's image host; galleries are packed into one ZIP."}),
        externalLink(openOnNoBsdlUrl(context.postUrl), "Open post on NoBsDL ↗", ""),
      ],
    });
    state.open = true;
  }

  // ── Video ──────────────────────────────────────────────────────────────
  function noTransportView(context, kind) {
    const isVideo = kind === "video";
    panelShell({
      kind,
      title: context.title || (isVideo ? "Reddit video" : "Reddit media"),
      sub: "NoBsDL",
      body: [
        el("div", {
          class: "error",
          text: isVideo
            ? "In-page video downloads need a userscript manager with GM_xmlhttpRequest."
            : "Saving images in the page needs a userscript manager with GM_xmlhttpRequest.",
        }),
        context.sourceUrl
          ? el("p", {class: "hint", text: "You can still paste this video link into NoBsDL: " + context.sourceUrl})
          : el("p", {class: "hint", text: "You can still open this post on NoBsDL and download it there."}),
        el("div", {class: "row"}, [
          context.sourceUrl
            ? externalLink(NOBSDL_ORIGIN + "/", "Open NoBsDL ↗", "btn")
            : externalLink(openOnNoBsdlUrl(context.postUrl), "Open post on NoBsDL ↗", "btn"),
        ]),
      ],
      foot: [el("span", {text: "No request was made from this page."})],
    });
    state.open = true;
  }

  function videoFooter(context) {
    return [
      el("span", {text: "MP4 video and audio are prepared by NoBsDL."}),
      // The NoBsDL Reddit page cannot list formats for an embedded
      // RedGIFs/Streamable video, so no link is offered for those.
      context.sourceUrl ? null : externalLink(openOnNoBsdlUrl(context.postUrl), "Open post on NoBsDL ↗", ""),
    ].filter(Boolean);
  }

  function loadVideoFormats(context) {
    if (!gmRequestFunction()) {
      noTransportView(context, "video");
      return;
    }
    const token = ++state.token;
    panelShell({
      kind: "video",
      title: context.title || "Reddit video",
      sub: "Checking this Reddit post on NoBsDL…",
      body: [
        el("div", {class: "spinner", "aria-hidden": "true"}),
        el("p", {class: "center", text: "Reading the real formats…"}),
      ],
      foot: videoFooter(context),
    });
    state.open = true;
    apiGet("/api/video-info?url=" + encodeURIComponent(context.sourceUrl || context.postUrl) + "&intent=mp4", 60000)
      .then((data) => {
        if (token !== state.token || !state.context || state.context.key !== context.key) return;
        const info = normalizeRedditChoices(data);
        state.videoCache = {key: context.key, info};
        renderVideoChoices(context, info);
      })
      .catch((error) => {
        if (token !== state.token || !state.context || state.context.key !== context.key) return;
        showVideoError(context, error, () => loadVideoFormats(context));
      });
  }

  function renderVideoChoices(context, info) {
    const sections = [];
    if (info.video.length) {
      sections.push(el("div", {class: "section"}, [
        el("h4", {text: "Video · MP4"}),
        el("div", {class: "grid"}, info.video.map((choice) => videoCard(context, choice, info))),
      ]));
    }
    if (info.audio.length) {
      sections.push(el("div", {class: "section"}, [
        el("h4", {text: "Audio · MP3"}),
        el("div", {class: "grid"}, info.audio.map((choice) => videoCard(context, choice, info))),
      ]));
    }
    if (!sections.length) {
      sections.push(el("p", {class: "center", text: "No downloadable format was found for this Reddit post."}));
    }
    const body = el("div", {}, sections);
    if (info.video.some((choice) => choice.locked) || info.audio.some((choice) => choice.locked)) {
      body.append(el("p", {class: "note"}, [
        "🔒 Locked choices need a paid ",
        externalLink(NOBSDL_ORIGIN + "/supporter", "NoBsDL Supporter key", ""),
        ". Everything else is free.",
      ]));
    } else if (info.isSupporter) {
      body.append(el("p", {class: "note", text: "✓ Supporter active on this browser."}));
    }

    const sub = [
      "Reddit",
      formatDuration(info.duration),
      info.video.length + info.audio.length + " formats",
    ].filter(Boolean).join(" · ");
    panelShell({
      kind: "video",
      title: info.title || context.title || "Reddit video",
      sub,
      body: [body],
      foot: videoFooter(context),
    });
    state.open = true;
    const first = ui.panel.querySelector(".card:not(.locked)");
    if (first) first.focus({preventScroll: true});
  }

  function videoCard(context, choice, info) {
    const parts = [choice.resolution, formatSize(choice.sizeMb), choice.locked ? "🔒 Supporter" : ""].filter(Boolean);
    const button = el("button", {
      class: "card" + (choice.locked ? " locked" : ""),
      type: "button",
      "aria-label": choice.title + " " + choice.format.toUpperCase()
        + (choice.sizeMb ? ", " + formatSize(choice.sizeMb) : "")
        + (choice.locked ? ", needs NoBsDL Supporter" : ""),
    }, [
      el("span", {class: "q", text: choice.title}),
      el("span", {class: "s", text: parts.join(" · ") || choice.format.toUpperCase()}),
    ]);
    button.addEventListener("click", () => {
      if (choice.locked) {
        window.open(NOBSDL_ORIGIN + "/supporter", "_blank", "noopener,noreferrer");
        return;
      }
      if (state.busy) {
        toast("A NoBsDL download is already running. Wait for it to finish.", "error");
        return;
      }
      startVideoJob(context, choice, info);
    });
    return button;
  }

  function showVideoError(context, error, retry) {
    const actions = el("div", {class: "row"});
    if (retry) {
      actions.append(el("button", {
        class: "btn",
        type: "button",
        text: error && error.refreshFormats ? "Refresh formats" : "Try again",
        onclick: retry,
      }));
    }
    if (error && error.supporterCta) {
      actions.append(externalLink(NOBSDL_ORIGIN + "/supporter", "Supporter options", "btn btn-ghost"));
    }
    panelShell({
      kind: "video",
      title: context.title || "Reddit video",
      sub: "NoBsDL",
      body: [
        el("div", {class: "error", role: "alert", text: (error && error.message) || "Something went wrong."}),
        actions,
      ],
      foot: videoFooter(context),
    });
    state.open = true;
  }

  function showVideoResult(context, choice) {
    panelShell({
      kind: "video",
      title: context.title || "Reddit video",
      sub: choice.title + " · " + choice.format.toUpperCase(),
      body: [
        el("div", {class: "result-ok", role: "status", text: "✅ File ready. Your browser is saving it — check your downloads."}),
        el("div", {class: "row"}, [
          el("button", {
            class: "btn",
            type: "button",
            text: "Download another format",
            onclick: () => {
              const cached = state.videoCache;
              if (cached && cached.key === context.key) renderVideoChoices(context, cached.info);
              else loadVideoFormats(context);
            },
          }),
          context.sourceUrl ? null : externalLink(openOnNoBsdlUrl(context.postUrl), "Open post on NoBsDL ↗", "btn btn-ghost"),
        ]),
      ],
      foot: videoFooter(context),
    });
    state.open = true;
  }

  async function startVideoJob(context, choice, info) {
    if (state.busy) {
      toast("A NoBsDL download is already running. Wait for it to finish.", "error");
      return;
    }
    const params = downloadParams(choice, context.sourceUrl || context.postUrl);
    if (!params) {
      toast("This Reddit post link couldn't be read.", "error");
      return;
    }
    const token = ++state.token;
    state.busy = true;
    state.context = context;

    const steps = el("ol", {class: "steps", "aria-label": "Download progress"},
      ["Queue", "Download", "Process", "Ready"].map((label) => el("li", {}, [el("i", {"aria-hidden": "true"}), label])));
    const bar = el("div", {class: "bar waiting"});
    const track = el("div", {class: "track", role: "progressbar", "aria-label": "Download progress", "aria-valuemin": "0", "aria-valuemax": "100"}, [bar]);
    const line = el("p", {class: "status-line", "aria-live": "polite"});
    panelShell({
      kind: "video",
      title: info.title || context.title || "Reddit video",
      sub: choice.title + " · " + choice.format.toUpperCase(),
      body: [steps, track, line],
      foot: videoFooter(context),
    });
    state.open = true;

    let phase = "requesting";
    let since = Date.now();
    let progress = null;
    let renderedPhase = null;
    const render = () => {
      if (token !== state.token) return;
      const view = progressView(phase, progress, Math.floor((Date.now() - since) / 1000), choice.format);
      Array.from(steps.children).forEach((item, index) => {
        item.dataset.state = index < view.step || phase === "ready" ? "done" : index === view.step ? "current" : "pending";
      });
      if (renderedPhase !== phase) {
        bar.style.transition = "none";
        void bar.offsetWidth;
        setTimeout(() => { bar.style.transition = ""; }, 50);
      }
      renderedPhase = phase;
      bar.className = "bar " + view.mode;
      bar.style.width = view.mode === "measured" ? (view.fraction * 100).toFixed(1) + "%" : view.mode === "waiting" ? "" : "100%";
      if (view.mode === "measured" || view.mode === "done") {
        track.setAttribute("aria-valuenow", String(view.mode === "done" ? 100 : Math.floor(view.fraction * 100)));
      } else {
        track.removeAttribute("aria-valuenow");
      }
      line.textContent = view.text;
    };
    render();
    const ticker = setInterval(render, 1000);

    try {
      const job = await apiGet(params, 30000);
      if (token !== state.token) return;
      const statusPath = safeStatusPath(job.status_url);
      if (!statusPath) throw Object.assign(new Error("NoBsDL returned an unexpected answer. Try again."), {status: 0});
      const deadline = Date.now() + POLL_DEADLINE_MS;
      let misses = 0;
      while (token === state.token && Date.now() < deadline) {
        let status;
        try {
          status = await apiGet(statusPath, 20000);
          misses = 0;
        } catch (error) {
          // A dropped poll is not a failed job; the server keeps working.
          if (!error.retryable || ++misses >= 5) throw error;
          await delay(1000 * misses);
          continue;
        }
        if (token !== state.token) return;
        if (status.status === "ready") {
          const fileUrl = safeFileUrl(status.direct_url);
          if (!fileUrl) throw Object.assign(new Error("NoBsDL returned an unexpected file link."), {status: 0});
          phase = "ready";
          render();
          state.busy = false;
          saveFile(fileUrl, videoSaveName(status, context, choice));
          toast("File ready — your browser is saving it.", "ok");
          showVideoResult(context, choice);
          return;
        }
        const next = status.phase || status.status || "queued";
        if (PHASE_ORDER.indexOf(next) >= 0 && PHASE_ORDER.indexOf(next) >= PHASE_ORDER.indexOf(phase)) {
          if (next !== phase) {
            phase = next;
            since = Date.now();
          }
        }
        if (status.progress && typeof status.progress === "object") {
          const previous = progress && typeof progress.fraction === "number" ? progress.fraction : null;
          progress = Object.assign({}, status.progress);
          if (previous !== null && typeof progress.fraction === "number" && progress.fraction < previous) {
            progress.fraction = previous;
          }
        }
        render();
        await delay(POLL_INTERVAL_MS);
      }
      if (token === state.token) throw new Error("This is taking unusually long. Try again or open the post on NoBsDL.");
    } catch (error) {
      clearInterval(ticker);
      if (token !== state.token) return;
      state.busy = false;
      toast((error && error.message) || "Something went wrong.", "error");
      showVideoError(context, error, error && error.refreshFormats
        ? () => { state.videoCache = null; loadVideoFormats(context); }
        : () => startVideoJob(context, choice, info));
    } finally {
      clearInterval(ticker);
    }
  }

  function openPanel(context) {
    if (!context) return;
    ensureRoot();
    if (state.busy && state.context && state.context.key !== context.key) {
      toast("A NoBsDL download is already running. Wait for it to finish.", "error");
      return;
    }
    if (state.busy && state.context && state.context.key === context.key) {
      ui.panel.hidden = false;
      ui.scrim.hidden = false;
      state.open = true;
      return;
    }
    state.context = context;
    state.token++;
    if (context.kind === "gallery") renderGallery(context);
    else if (context.kind === "video") {
      if (state.videoCache && state.videoCache.key === context.key) renderVideoChoices(context, state.videoCache.info);
      else loadVideoFormats(context);
    }
  }

  // ── Finding media in Reddit's DOM ──────────────────────────────────────
  // Per-post elements, not post URLs: Reddit can remove and re-render a post
  // (back/forward, feed recycling) and the new DOM must get its badge again.
  let lastHref = "";

  function postTitleFor(post) {
    if (post) {
      const attr = cleanPostTitle(post.getAttribute("post-title"));
      if (attr) return attr;
      const title = post.querySelector('[slot="title"], [data-testid="post-title"], h1, h2, h3');
      if (title) {
        const text = cleanPostTitle(title.textContent);
        if (text) return text;
      }
    }
    return cleanPostTitle(document.title);
  }

  function contextForParsed(parsed, post) {
    return {
      url: parsed.url,
      id: parsed.id,
      post: post || null,
      title: postTitleFor(post),
    };
  }

  function pageMediaContainer(el) {
    return Boolean(el && el.closest
      && el.closest("main, [role='main'], shreddit-app, #main-content, dialog, [role='dialog'], faceplate-dialog, shreddit-media-lightbox"));
  }

  function postContextFor(el, options) {
    const allowPage = !options || options.allowPage !== false;
    // A player or gallery may carry its own post-id. Prefer the surrounding
    // post's full permalink when both identify the same post; use the media
    // post-id when it points at a different post (a crosspost). The wider
    // climb also covers a player moved into a lightbox/portal.
    let media = null;
    let node = el;
    for (let depth = 0; depth < 8 && node && node.nodeType === 1; depth++, node = node.parentElement) {
      if (node.hasAttribute && node.hasAttribute("post-id")) {
        const parsed = parseRedditPostUrl(postUrlFromId(node.getAttribute("post-id")) || "");
        if (parsed) {
          media = parsed;
          break;
        }
      }
    }
    const post = el.closest && el.closest(POST_SELECTOR);
    if (post) {
      const permalink = post.getAttribute("permalink") || post.getAttribute("content-href") || "";
      const parsed = parseRedditPostUrl(permalink, document.baseURI);
      if (parsed && (!media || parsed.id === media.id)) return contextForParsed(parsed, post);
      if (media) return contextForParsed(media, post);
      const byId = parseRedditPostUrl(postUrlFromId(post.getAttribute("post-id") || post.getAttribute("id")) || "");
      if (byId) return contextForParsed(byId, post);
      const link = post.querySelector('a[slot="full-post-link"][href], a[data-click-id="body"][href], a[href*="/comments/"]');
      if (link) {
        const byLink = parseRedditPostUrl(link.getAttribute("href"), document.baseURI);
        if (byLink) return contextForParsed(byLink, post);
      }
    }
    if (media) return contextForParsed(media, post);
    if (allowPage) {
      const here = parseRedditPostUrl(location.href);
      if (here && pageMediaContainer(el)) {
        return contextForParsed(here, null);
      }
    }
    return null;
  }

  function galleryRootFor(el) {
    return el.closest && el.closest("gallery-carousel, shreddit-gallery-carousel, [data-testid='gallery-carousel']");
  }

  // Per page: every Reddit image URL found anywhere in the page node (the
  // preview <img>, a zoomable-img <img>, a link). An i.redd.it URL is the
  // original file and wins over preview.redd.it, which only serves resized
  // (often WebP) previews.
  function galleryItems(gallery) {
    if (!gallery) return [];
    const pageNodes = Array.from(gallery.querySelectorAll('[slot^="page-"]'));
    let nodes;
    if (pageNodes.length) nodes = pageNodes;
    else if (gallery.querySelector("img")) nodes = Array.from(gallery.querySelectorAll("img"));
    else nodes = Array.from(gallery.querySelectorAll("a[href]"));
    const images = [];
    nodes.forEach((node, index) => {
      const pageMatch = /^page-(\d+)$/i.exec(node.getAttribute("slot") || "");
      const imgs = node.tagName === "IMG" ? [node] : Array.from(node.querySelectorAll("img"));
      const anchors = node.tagName === "A" ? [node] : Array.from(node.querySelectorAll("a[href]"));
      const found = [];
      for (const img of imgs) {
        found.push(bestImageVariant(img.getAttribute("src"), img.getAttribute("srcset"), document.baseURI));
      }
      for (const anchor of anchors) {
        try { found.push(new URL(anchor.getAttribute("href") || "", document.baseURI).href); } catch (_) { /* skip */ }
      }
      const valid = found.filter((candidate) => candidate && isRedditImageUrl(candidate));
      const original = valid.find((candidate) => {
        const parsed = parseRedditImageUrl(candidate);
        return parsed && parsed.host === "i.redd.it";
      });
      const url = original || valid[0] || "";
      if (!url) return;
      const img = imgs[0] || null;
      images.push({
        url,
        alt: img ? img.getAttribute("alt") || "" : "",
        page: pageMatch ? Number(pageMatch[1]) : index + 1,
      });
    });
    return galleryItemsFromImages(images);
  }

  function galleryPageCount(gallery) {
    if (!gallery) return 0;
    const pages = gallery.querySelectorAll('[slot^="page-"]').length;
    return pages || galleryItems(gallery).length;
  }

  function galleryLabel(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    return "⬇ Save gallery" + (n ? " · " + n : "");
  }

  function nearestComment(node) {
    return node && node.closest ? node.closest("shreddit-comment, [data-testid='comment']") : null;
  }

  function isContentImage(img, src) {
    if (!img || nearestComment(img)) return false;
    if (img.closest(VIDEO_PLAYER_SELECTOR)) return false;
    if (galleryRootFor(img)) return false;
    const post = img.closest(POST_SELECTOR);
    if (!post) return false;
    if (img.closest("header, [slot='post-header'], shreddit-post-header, [data-testid='post-header'], faceplate-tracker[noun='subreddit_icon']")) return false;
    if (img.getAttribute("aria-hidden") === "true") return false;
    const cls = String(img.className || "").toLowerCase();
    if (/\b(avatar|icon|emoji|snoo|thumbnail)\b/.test(cls)) return false;

    const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : {width: 0, height: 0};
    const width = Math.max(Number(img.getAttribute("width")) || 0, Number(rect.width) || 0, Number(img.naturalWidth) || 0);
    const height = Math.max(Number(img.getAttribute("height")) || 0, Number(rect.height) || 0, Number(img.naturalHeight) || 0);
    if (width && height && (width < 200 || height < 120)) return false;

    const media = img.closest("[slot='post-media-container'], [data-testid='post-media-container'], shreddit-aspect-ratio, [data-testid='post-media'], a[data-click-id='media'], a[href*='/gallery/'], .media-preview");
    const postType = String(post.getAttribute("post-type") || "").toLowerCase();
    if (media || postType === "image" || postType === "gallery") {
      const link = img.closest("a[href]");
      if (!media && link && /\/comments\//i.test(link.getAttribute("href") || "")) return false;
      return true;
    }
    const link = img.closest("a[href]");
    if (link && /\/comments\//i.test(link.getAttribute("href") || "")) return false;
    return width >= 300 && height >= 200;
  }

  // Ads are never touched: promoted posts, the promoted video on a post page
  // and feed ad cards.
  const AD_SELECTOR = 'shreddit-comments-page-ad, shreddit-ad-post, [slot="expanded-video-player"]';
  const GALLERY_SELECTOR = "gallery-carousel, shreddit-gallery-carousel, [data-testid='gallery-carousel']";

  function isPromotedPost(post) {
    if (!post || !post.hasAttribute || !post.hasAttribute("promoted")) return false;
    return !/^(?:false|0)$/i.test(String(post.getAttribute("promoted") || "").trim());
  }

  function inAd(node) {
    if (!node || !node.closest) return false;
    if (node.closest(AD_SELECTOR)) return true;
    return isPromotedPost(node.closest(POST_SELECTOR));
  }

  const galleryBadges = new WeakMap();
  const badgeGalleries = new WeakMap();

  function processGallery(gallery) {
    if (!gallery || inAd(gallery)) return;
    const label = galleryLabel(galleryPageCount(gallery));
    const known = galleryBadges.get(gallery);
    if (known) {
      if (known.isConnected && badgeHasBox(known)) {
        setBadgeLabel(known, label);
        return;
      }
      known.remove();
      galleryBadges.delete(gallery);
    }
    const context = postContextFor(gallery, {allowPage: true});
    if (!context) return;
    const post = context.post || gallery.closest(POST_SELECTOR);
    const candidates = mediaHostCandidates(post, gallery, [gallery.parentElement, gallery]);
    const badge = mountBadge(
      candidates,
      label,
      (button) => {
        let live = badgeGalleries.get(button) || gallery;
        if (!live.isConnected && context.post && context.post.querySelector) {
          live = context.post.querySelector(GALLERY_SELECTOR) || live;
        }
        const items = galleryItems(live);
        if (!items.length) {
          toast("No Reddit gallery images were found in this post.", "error");
          return;
        }
        openPanel({
          kind: "gallery",
          key: "g:" + context.url,
          postUrl: context.url,
          title: postTitleFor(context.post) || context.title,
          items,
        });
      },
      "gallery"
    );
    if (badge) {
      galleryBadges.set(gallery, badge);
      badgeGalleries.set(badge, gallery);
      gallery.dataset.nobsdlReddit = "gallery";
      if (badge.parentElement) badge.parentElement.dataset.nobsdlReddit = "gallery";
      return;
    }
    // A live badge from an earlier render of this gallery is adopted so its
    // label keeps following the real page count.
    for (const host of candidates) {
      const existing = host.querySelector(BADGE_SELECTOR + "[data-nobsdl-kind='gallery']");
      if (existing) {
        galleryBadges.set(gallery, existing);
        badgeGalleries.set(existing, gallery);
        setBadgeLabel(existing, label);
        return;
      }
    }
  }

  function videoBadgeExists(marker) {
    if (!marker || !marker.querySelector) return false;
    pruneDeadBadges(marker);
    return Boolean(marker.querySelector(VIDEO_BADGE_SELECTOR));
  }

  function clearStaleVideoBadges(root, postUrl) {
    if (!root || !root.querySelectorAll) return;
    for (const badge of root.querySelectorAll(VIDEO_BADGE_SELECTOR)) {
      if (badge.dataset.nobsdlPost && badge.dataset.nobsdlPost !== postUrl) badge.remove();
    }
  }

  function videoScopeFor(post) {
    if (!post) return null;
    const parent = post.parentElement;
    if (parent && !parent.shadowRoot && parent !== document.body
      && parent.querySelectorAll(POST_SELECTOR).length <= 1) return parent;
    return post;
  }

  // RedGIFs/Streamable link posts: the external video URL, read from the
  // post's own content-href (present even while an 18+ blur hides the embed).
  function embedSourceFor(post) {
    if (!post || !post.getAttribute) return null;
    return parseEmbedVideoUrl(post.getAttribute("content-href"));
  }

  function withEmbedSource(context) {
    if (!context || !context.post) return context;
    const source = embedSourceFor(context.post);
    if (source) context.sourceUrl = source;
    return context;
  }

  // Reddit uses different wrappers per surface: the plain block
  // post-media-container slot, aspect-ratio wrappers, a hidden subtree in
  // compact view. mountBadge only uses a host where the badge really shows.
  function videoHostCandidates(media, post) {
    const fallbacks = [];
    if (media && media !== post && media.parentElement) fallbacks.push(media.parentElement);
    // A shreddit-post can have its own shadow root: an unslotted light-DOM
    // child is not rendered (0x0). Its article wrapper is the safe visible
    // surface in compact view, but only when it belongs to this post.
    const scope = videoScopeFor(post);
    if (scope && scope !== post) fallbacks.push(scope);
    if (post) fallbacks.push(post);
    if (media) fallbacks.push(media);
    return mediaHostCandidates(post, media, fallbacks);
  }

  function openVideoPanel(context) {
    openPanel({
      kind: "video",
      key: "v:" + context.url,
      postUrl: context.url,
      sourceUrl: context.sourceUrl || "",
      title: postTitleFor(context.post) || context.title,
    });
  }

  function mountVideoBadge(context, media, post) {
    if (post) {
      const scope = videoScopeFor(post);
      clearStaleVideoBadges(scope, context.url);
      if (videoBadgeExists(scope)) return null;
    }
    const candidates = videoHostCandidates(media, post);
    for (const host of candidates) {
      clearStaleVideoBadges(host, context.url);
      if (videoBadgeExists(host)) return null;
    }
    const badge = mountBadge(candidates, "⬇ Download video", () => openVideoPanel(context), "video");
    if (badge) {
      badge.dataset.nobsdlPost = context.url;
      if (badge.parentElement && badge.parentElement !== post) badge.parentElement.dataset.nobsdlReddit = "video";
    }
    return badge;
  }

  function processVideo(player) {
    if (!player || nearestComment(player) || inAd(player)) return;
    const post = player.closest && player.closest(POST_SELECTOR);
    const context = withEmbedSource(postContextFor(player, {allowPage: true}));
    if (!context) return;
    mountVideoBadge(context, player, post);
  }

  // Link posts that embed a RedGIFs or Streamable video. Reddit renders them
  // as shreddit-embed (sometimes behind a blur) and has no player of its own.
  function processEmbedPost(post) {
    if (!post || nearestComment(post) || inAd(post)) return;
    if (!embedSourceFor(post)) return;
    const context = withEmbedSource(postContextFor(post, {allowPage: true}));
    if (!context || !context.sourceUrl) return;
    mountVideoBadge(context, post, post);
  }

  // Compact/card feeds can keep the real player in a hidden subtree, and some
  // video posts temporarily have no player at all. The post itself is then the
  // visible control surface; the canonical post URL is still known.
  function processVideoPostFallback(post) {
    if (!post || nearestComment(post) || inAd(post)) return;
    if (String(post.getAttribute("post-type") || "").toLowerCase() !== "video") return;
    // A real player/native video is handled by processVideo/processNativeVideo;
    // this fallback exists for compact or temporarily player-less posts.
    if (post.querySelector(VIDEO_PLAYER_SELECTOR + ", video")) return;
    const context = withEmbedSource(postContextFor(post, {allowPage: true}));
    if (!context) return;
    mountVideoBadge(context, post, post);
  }

  function processNativeVideo(video) {
    if (!video || video.closest(VIDEO_PLAYER_SELECTOR) || nearestComment(video) || inAd(video)) return;
    const post = video.closest && video.closest(POST_SELECTOR);
    const postType = post ? String(post.getAttribute("post-type") || "").toLowerCase() : "";
    const mediaContainer = video.closest && video.closest(
      "[slot='post-media-container'], [data-testid='post-media-container'], shreddit-aspect-ratio, "
      + "dialog, [role='dialog'], faceplate-dialog, shreddit-media-lightbox"
    );
    if (!post && !mediaContainer) return;
    if (post && postType !== "video"
      && !video.closest("[slot='post-media-container'], [data-testid='post-media-container'], shreddit-aspect-ratio")) return;
    const context = withEmbedSource(postContextFor(video, {allowPage: true}));
    if (!context) return;
    mountVideoBadge(context, video, post);
  }

  function processImage(img) {
    if (!img || inAd(img)) return;
    if (nearestComment(img) || galleryRootFor(img)) return;
    if (img.closest(VIDEO_PLAYER_SELECTOR)) return;
    const post = img.closest(POST_SELECTOR);
    if (!post) return;
    if (String(post.getAttribute("post-type") || "").toLowerCase() === "video") return;
    if (embedSourceFor(post)) return;
    pruneDeadBadges(post);
    if (post.querySelector(BADGE_SELECTOR)) return;
    const src = bestImageVariant(img.getAttribute("src"), img.getAttribute("srcset"), document.baseURI);
    if (!isRedditImageUrl(src)) return;
    if (!isContentImage(img, src)) return;
    const context = postContextFor(img, {allowPage: false});
    if (!context) return;

    const title = postTitleFor(post) || cleanPostTitle(img.getAttribute("alt") || "");
    const badge = mountBadge(mediaHostCandidates(post, img, [img.parentElement]), "⬇ Save image", (button) => {
      const current = bestImageVariant(img.getAttribute("src"), img.getAttribute("srcset"), document.baseURI);
      const parsed = parseRedditImageUrl(isRedditImageUrl(current) ? current : src);
      if (!parsed) {
        toast("Reddit changed this image before it could be saved. Try again.", "error");
        return;
      }
      saveImageItem(
        {title, postUrl: context.url},
        {url: parsed.url, key: parsed.key, index: 1, total: 1, alt: img.getAttribute("alt") || ""},
        {button, quiet: false}
      ).then((result) => {
        if (result.ok) {
          button.textContent = "✓ Saved";
          setTimeout(() => { if (button.isConnected) button.textContent = "⬇ Save image"; }, 3000);
        } else {
          button.textContent = "⬇ Save image";
        }
      });
    }, "image");
    if (badge && badge.parentElement) badge.parentElement.dataset.nobsdlReddit = "image";
  }

  function saveCommentImage(button, url, title) {
    const parsed = parseRedditImageUrl(url);
    if (!parsed) {
      toast("That link isn't a Reddit-hosted image.", "error");
      return;
    }
    saveImageItem(
      {title: title || cleanPostTitle(document.title)},
      {url: parsed.url, key: parsed.key, index: 1, total: 1},
      {button, quiet: false}
    ).then((result) => {
      if (result.ok) {
        button.textContent = "✓ Saved";
        setTimeout(() => { if (button.isConnected) button.textContent = "⬇ Save image"; }, 3000);
      } else {
        button.textContent = "⬇ Save image";
      }
    });
  }

  function processCommentMedia(comment) {
    if (!comment) return;
    const post = comment.closest(POST_SELECTOR);
    const parentTitle = postTitleFor(post);
    const title = parentTitle ? parentTitle + " comment" : "Reddit comment image";

    for (const anchor of comment.querySelectorAll("a[href]")) {
      if (nearestComment(anchor) !== comment) continue;
      if (anchor.dataset.nobsdlReddit === "comment") continue;
      const parsed = parseRedditImageUrl(anchor.getAttribute("href"), document.baseURI);
      if (!parsed) continue;
      const button = addCommentButton(anchor, (clicked) => saveCommentImage(clicked, parsed.url, title), "⬇ Save image");
      if (button) anchor.dataset.nobsdlReddit = "comment";
    }

    for (const img of comment.querySelectorAll("img")) {
      if (nearestComment(img) !== comment) continue;
      if (img.dataset.nobsdlReddit === "comment") continue;
      const anchor = img.closest("a[href]");
      if (anchor && parseRedditImageUrl(anchor.getAttribute("href"), document.baseURI)) continue;
      const src = bestImageVariant(img.getAttribute("src"), img.getAttribute("srcset"), document.baseURI);
      const parsed = parseRedditImageUrl(src);
      if (!parsed) continue;
      const button = addCommentButton(img, (clicked) => saveCommentImage(clicked, parsed.url, title), "⬇ Save image");
      if (button) img.dataset.nobsdlReddit = "comment";
    }
  }

  // ── Comment export ─────────────────────────────────────────────────────
  // Exports the comments already loaded in the page's DOM to JSON, CSV or
  // Markdown. This whole section runs locally: it sends no requests of any
  // kind, uses none of the media script's transport helpers, reads no browser
  // storage, never clicks "load more" and never loads anything. The only
  // output is a Blob download of what is already on screen. It reuses the pure
  // helpers el(), cleanPostTitle() and saveBlob() from above.
  const commentExport = (function () {
    const HOST_ID = "nobsdl-reddit-comment-export-root";
    const SCAN_INTERVAL_MS = 1000;
    const MAX_FILENAME = 100;
    const FORMATS = Object.freeze({
      json: {label: "JSON", extension: "json", mime: "application/json"},
      csv: {label: "CSV", extension: "csv", mime: "text/csv"},
      markdown: {label: "Markdown", extension: "md", mime: "text/markdown"},
    });
    const CSV_COLUMNS = Object.freeze([
      "id",
      "parent_id",
      "depth",
      "author",
      "score",
      "created_utc",
      "created_iso",
      "is_submitter",
      "is_deleted",
      "is_removed",
      "collapsed",
      "permalink",
      "body",
    ]);
    const SKIP_TAGS = new Set([
      "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG", "BUTTON", "INPUT",
      "TEXTAREA", "SELECT", "OPTION", "SHREDDIT-COMMENT",
    ]);
    const BLOCK_TAGS = new Set([
      "P", "DIV", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "H1", "H2", "H3",
      "H4", "H5", "H6", "SECTION", "ARTICLE", "FIGURE", "FIGCAPTION", "TABLE",
      "THEAD", "TBODY", "TR", "TD", "TH", "HR",
    ]);
    // The media script shows its toast bottom-centre (480px wide, 22px from the
    // bottom; full width on phones). Below 900px the pill would touch it, so it
    // sits above that toast zone. The host is one z-index below the media
    // panel/toast host so an open media panel always covers the pill.
    const CSS = `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147482999;
        pointer-events: none;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color-scheme: light dark;
      }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      .rce-button {
        pointer-events: auto;
        position: fixed;
        right: max(16px, env(safe-area-inset-right));
        bottom: max(16px, env(safe-area-inset-bottom));
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 999px;
        padding: 10px 14px;
        background: #1a1a1b;
        color: #fff;
        box-shadow: 0 8px 24px rgba(0,0,0,.28);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
        cursor: pointer;
      }
      .rce-button:hover { background: #333; }
      .rce-button:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
      .rce-dot { width: 7px; height: 7px; border-radius: 50%; background: #f8b84e; flex: none; }
      .rce-overlay {
        pointer-events: auto;
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(8,10,14,.62);
      }
      .rce-panel {
        width: min(560px, 100%);
        max-height: min(86vh, 760px);
        overflow: auto;
        padding: 22px;
        border: 1px solid rgba(0,0,0,.08);
        border-radius: 18px;
        background: #fff;
        color: #16181d;
        box-shadow: 0 24px 80px rgba(0,0,0,.35);
      }
      .rce-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .rce-kicker {
        margin: 0 0 4px;
        color: #767a82;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .rce-title { margin: 0; font-size: 20px; line-height: 1.2; }
      .rce-close {
        flex: none;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        font-family: inherit;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
      }
      .rce-close:hover { background: #eef1f5; }
      .rce-close:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
      .rce-summary { margin: 16px 0 4px; font-size: 15px; font-weight: 600; }
      .rce-reported, .rce-note, .rce-privacy {
        margin: 4px 0 0;
        color: #666b73;
        font-size: 12px;
        line-height: 1.45;
      }
      .rce-note { margin-top: 10px; }
      .rce-formats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin: 14px 0;
      }
      .rce-format {
        padding: 10px;
        border: 1px solid #d9dce1;
        border-radius: 12px;
        background: #f7f8fa;
        color: inherit;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
      }
      .rce-format:hover { background: #eef1f5; }
      .rce-format:focus-visible { outline: 3px solid #f8b84e; outline-offset: 2px; }
      .rce-format:disabled { opacity: .55; cursor: not-allowed; }
      .rce-format strong { display: block; font-size: 13px; }
      .rce-format span { display: block; margin-top: 3px; color: #666b73; font-size: 11px; line-height: 1.3; }
      .rce-status { min-height: 1.2em; margin: 8px 0 0; color: #0b7a3b; font-size: 12px; line-height: 1.4; }
      .rce-privacy { margin-top: 19px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
      @media (prefers-color-scheme: dark) {
        .rce-panel { border-color: #34363c; background: #1b1c1f; color: #f2f3f5; }
        .rce-kicker, .rce-reported, .rce-note, .rce-privacy { color: #a7abb3; }
        .rce-format { border-color: #3a3d44; background: #25272c; color: #f2f3f5; }
        .rce-format:hover, .rce-close:hover { background: #2f3238; }
        .rce-format span { color: #b7bbc3; }
        .rce-close { color: #f2f3f5; }
        .rce-status { color: #7fe0a3; }
        .rce-privacy { border-color: #34363c; }
      }
      @media (max-width: 900px) {
        .rce-button { bottom: calc(max(16px, env(safe-area-inset-bottom)) + 80px); }
      }
      @media (max-width: 560px) {
        .rce-overlay { align-items: end; padding: 10px; }
        .rce-panel { max-height: 92vh; border-radius: 16px; padding: 18px; }
        .rce-formats { grid-template-columns: 1fr; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition: none !important; }
      }
    `;

    // ── Small helpers ────────────────────────────────────────────────────
    function cleanText(value) {
      return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    }

    function cleanAuthor(value) {
      return cleanText(value).replace(/^u\//i, "");
    }

    function parseCount(value) {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
    }

    // ── Post URL and page metadata ───────────────────────────────────────
    function parsePostUrl(href, base) {
      let url;
      try {
        url = new URL(href, base || "https://www.reddit.com");
      } catch (_) {
        return null;
      }
      if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      const at = parts.findIndex((part) => part.toLowerCase() === "comments");
      if (at < 0 || at + 1 >= parts.length) return null;
      const shortId = parts[at + 1];
      if (!/^[a-z0-9]{4,12}$/i.test(shortId)) return null;
      const prefix = parts.slice(0, at);
      if (prefix.length) {
        const first = prefix[0].toLowerCase();
        if (first !== "r" && first !== "user") return null;
        if (prefix.length < 2) return null;
      }
      let subreddit = null;
      if (prefix.length >= 2 && prefix[0].toLowerCase() === "r") {
        try {
          subreddit = decodeURIComponent(prefix[1]);
        } catch (_) {
          subreddit = prefix[1];
        }
      }
      const slug = parts[at + 2] && parts[at + 2].toLowerCase() !== "comment" ? parts[at + 2] : "";
      const canonicalParts = prefix.concat(["comments", shortId]);
      if (slug) canonicalParts.push(slug);
      const path = "/" + canonicalParts.join("/");
      return {
        id: "t3_" + shortId,
        shortId,
        url: "https://www.reddit.com" + path,
        path,
        subreddit,
      };
    }

    function postMeta(route, root) {
      const doc = root || document;
      const posts = Array.from(doc.querySelectorAll("shreddit-post"));
      const matchingPost = posts.find((post) => {
        const parsed = parsePostUrl(post.getAttribute("permalink") || "", "https://www.reddit.com");
        if (parsed) return parsed.id === route.id;
        const id = post.id || "";
        return /^t3_[a-z0-9]+$/i.test(id) && id === route.id;
      });
      const post = matchingPost || null;
      let title = "";
      if (post) title = cleanPostTitle(post.getAttribute("post-title"));
      if (!title && post) {
        const titleNode = post.querySelector('[slot="title"], [data-testid="post-title"], h1, h2, h3');
        if (titleNode) title = cleanPostTitle(titleNode.textContent);
      }
      if (!title) title = cleanPostTitle(doc.title);
      if (!title) title = "Reddit post";
      const author = post ? cleanAuthor(post.getAttribute("author")) : "";
      const commentCount = post ? parseCount(post.getAttribute("comment-count")) : null;
      return {
        id: route.id,
        url: route.url,
        path: route.path,
        subreddit: route.subreddit || (post ? cleanText(post.getAttribute("subreddit")) : null) || null,
        title,
        author: author || null,
        comment_count: commentCount,
        element: post || null,
      };
    }

    function absoluteRedditUrl(value) {
      if (!value) return null;
      try {
        const url = new URL(value, "https://www.reddit.com");
        if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
        return url.href;
      } catch (_) {
        return null;
      }
    }

    // ── Comment extraction ───────────────────────────────────────────────
    function parseCreated(value) {
      if (value === null || value === undefined || value === "") return null;
      const text = String(value).trim();
      const numeric = Number(text);
      let millis = Number.NaN;
      if (/^\d+(?:\.\d+)?$/.test(text) && Number.isFinite(numeric) && numeric > 0) {
        millis = numeric < 1e12 ? numeric * 1000 : numeric;
      } else {
        millis = Date.parse(text);
      }
      if (!Number.isFinite(millis) || millis <= 0) return null;
      const date = new Date(millis);
      if (!Number.isFinite(date.getTime())) return null;
      return {utc: Math.floor(millis / 1000), iso: date.toISOString()};
    }

    function parseScore(value) {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? Math.round(number) : null;
    }

    function ownBodyNode(node, thingid) {
      if (!node || !thingid) return null;
      const exact = node.querySelector('[id="' + thingid + '-comment-rtjson-content"]');
      if (exact) return exact;
      return Array.from(node.querySelectorAll('[slot="comment"]')).find((candidate) => {
        return candidate.closest("shreddit-comment") === node;
      }) || null;
    }

    function normalizeText(value) {
      return String(value == null ? "" : value)
        .replace(/​/g, "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    function extractBodyText(body) {
      if (!body) return "";
      let out = "";
      function walk(node) {
        if (!node) return;
        if (node.nodeType === 3) {
          out += node.nodeValue || "";
          return;
        }
        if (node.nodeType !== 1) return;
        const tag = String(node.tagName || "").toUpperCase();
        if (SKIP_TAGS.has(tag)) return;
        if (tag === "BR") {
          out += "\n";
          return;
        }
        const block = BLOCK_TAGS.has(tag);
        if (block && out && !out.endsWith("\n")) out += "\n";
        for (const child of node.childNodes) walk(child);
        if (block && out && !out.endsWith("\n")) out += "\n";
      }
      walk(body);
      return normalizeText(out);
    }

    // A comment node counts only when it has a t1_ thing id and, if it names
    // its post, that post is the one on screen.
    function commentThingId(node, post) {
      if (!node || node.nodeType !== 1) return "";
      const thingid = cleanText(node.getAttribute("thingid") || node.id || "");
      if (!/^t1_[a-z0-9]+$/i.test(thingid)) return "";
      const nodePostId = cleanText(node.getAttribute("postid"));
      if (nodePostId && post && post.id && nodePostId !== post.id) return "";
      return thingid;
    }

    function commentRecord(node, post) {
      const thingid = commentThingId(node, post);
      if (!thingid) return null;

      const bodyNode = ownBodyNode(node, thingid);
      const body = extractBodyText(bodyNode);
      const author = cleanAuthor(node.getAttribute("author"));
      const created = parseCreated(node.getAttribute("created") || node.getAttribute("created-timestamp"));
      const score = parseScore(node.getAttribute("score"));
      let depth = Number(node.getAttribute("depth"));
      if (!Number.isFinite(depth) || depth < 0) {
        depth = 0;
        let parent = node.parentElement;
        while (parent && (!post || !post.element || parent !== post.element)) {
          if (parent.tagName === "SHREDDIT-COMMENT") depth += 1;
          parent = parent.parentElement;
        }
      }
      const parentId = cleanText(node.getAttribute("parentid")) || (post && post.id) || null;
      const permalink = absoluteRedditUrl(node.getAttribute("permalink"));
      const contentType = cleanText(node.getAttribute("content-type"));
      const details = node.querySelector(":scope > details");
      const collapsed = node.hasAttribute("collapsed") || Boolean(details && !details.hasAttribute("open"));
      const deleted = /^\[deleted\]$/i.test(body) || author === "[deleted]";
      const removed = /^\[removed\]$/i.test(body);
      const isSubmitter = node.hasAttribute("is-submitter")
        || Boolean(post && post.author && author && author === post.author);

      return {
        id: thingid,
        parent_id: parentId,
        depth: Math.max(0, Math.round(depth)),
        author: author || null,
        body,
        score,
        created_utc: created ? created.utc : null,
        created_iso: created ? created.iso : null,
        permalink,
        is_submitter: isSubmitter,
        is_deleted: deleted,
        is_removed: removed,
        collapsed,
        content_type: contentType || null,
      };
    }

    function collectComments(root, post) {
      const doc = root || document;
      const nodes = Array.from(doc.querySelectorAll("shreddit-comment"));
      const seen = new Set();
      const comments = [];
      for (const node of nodes) {
        const id = cleanText(node.getAttribute("thingid") || node.id || "");
        if (id && seen.has(id)) continue;
        const record = commentRecord(node, post);
        if (!record || seen.has(record.id)) continue;
        seen.add(record.id);
        comments.push(record);
      }
      return comments;
    }

    // Same filters and dedupe as collectComments, without building bodies. The
    // once-a-second scan only needs the number for the button label.
    function countComments(root, post) {
      const doc = root || document;
      const seen = new Set();
      for (const node of doc.querySelectorAll("shreddit-comment")) {
        const id = cleanText(node.getAttribute("thingid") || node.id || "");
        if (id && seen.has(id)) continue;
        const thingid = commentThingId(node, post);
        if (thingid) seen.add(thingid);
      }
      return seen.size;
    }

    // ── Export formats ───────────────────────────────────────────────────
    function buildExport(post, comments, now) {
      const date = now instanceof Date ? now : new Date(now || Date.now());
      return {
        format: "reddit-comments",
        version: 1,
        exported_at: date.toISOString(),
        source: "Reddit page DOM",
        note: "Only comments loaded in the page were exported.",
        post: {
          id: post.id,
          url: post.url,
          title: post.title,
          subreddit: post.subreddit || null,
          author: post.author || null,
          comment_count: Number.isFinite(post.comment_count) ? post.comment_count : null,
        },
        count: comments.length,
        comments: comments.map((comment) => Object.assign({}, comment)),
      };
    }

    function commentsToJson(post, comments, now) {
      return JSON.stringify(buildExport(post, comments, now), null, 2) + "\n";
    }

    function csvValue(value) {
      if (value === null || value === undefined) return "";
      if (typeof value === "number") return String(value);
      if (typeof value === "boolean") return value ? "true" : "false";
      let text = String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
      return text;
    }

    function commentsToCsv(comments) {
      const rows = [CSV_COLUMNS.join(",")];
      for (const comment of comments) {
        rows.push(CSV_COLUMNS.map((column) => csvValue(comment[column])).join(","));
      }
      return rows.join("\r\n") + "\r\n";
    }

    function markdownEscape(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    // Only Reddit permalinks become Markdown links, and characters that
    // would end or break the link syntax are percent-encoded.
    function markdownLinkUrl(value) {
      const url = String(value == null ? "" : value).trim();
      if (!url.startsWith("https://www.reddit.com/")) return "";
      return url
        .replace(/\s/g, (space) => encodeURIComponent(space))
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E");
    }

    function authorLabel(value) {
      const author = cleanText(value);
      if (!author) return "[unknown]";
      if (author === "[deleted]") return "[deleted]";
      return /^u\//i.test(author) ? author : "u/" + author;
    }

    function formatDate(iso) {
      if (!iso) return "";
      return iso.slice(0, 16).replace("T", " ") + " UTC";
    }

    function commentsToMarkdown(post, comments, now) {
      const date = now instanceof Date ? now : new Date(now || Date.now());
      const lines = [];
      lines.push("# Reddit comments: " + markdownEscape(post.title || "Reddit post"));
      lines.push("");
      lines.push("- Post: " + post.url);
      lines.push("- Comments loaded: " + comments.length
        + (Number.isFinite(post.comment_count) ? " (Reddit reports " + post.comment_count + ")" : ""));
      lines.push("- Exported: " + date.toISOString());
      lines.push("- Note: Only comments currently loaded in the page are included.");
      lines.push("");
      for (const comment of comments) {
        const depth = Math.max(0, Math.round(Number(comment.depth) || 0));
        const indent = "  ".repeat(depth);
        const meta = [];
        if (comment.score !== null && comment.score !== undefined) {
          meta.push(comment.score + " point" + (comment.score === 1 ? "" : "s"));
        }
        if (comment.created_iso) meta.push(formatDate(comment.created_iso));
        if (comment.is_submitter) meta.push("OP");
        let line = indent + "- **" + markdownEscape(authorLabel(comment.author)) + "**";
        if (meta.length) line += " · " + meta.join(" · ");
        const link = markdownLinkUrl(comment.permalink);
        if (link) line += " · [link](" + link + ")";
        lines.push(line);
        const body = comment.body ? markdownEscape(comment.body) : "_[no text]_";
        for (const bodyLine of body.split("\n")) lines.push(indent + "  > " + bodyLine);
        lines.push("");
      }
      return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    }

    function filenameFor(post, format) {
      const spec = FORMATS[format] || FORMATS.json;
      const shortId = String((post && post.id) || "post").replace(/^t3_/i, "") || "post";
      const subreddit = String((post && post.subreddit) || "reddit");
      const base = ("reddit-comments-" + subreddit + "-" + shortId)
        .normalize("NFKC")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_.]+|[-_.]+$/g, "")
        .slice(0, MAX_FILENAME);
      return (base || "reddit-comments") + "." + spec.extension;
    }

    // ── UI (own Shadow DOM host, separate from the media panel) ──────────
    let ui = null;
    let panelOpen = false;
    let booted = false;
    let lastPost = null;
    let lastCount = 0;
    let lastComments = [];
    let lastHref = "";

    function ensureUi() {
      // One host only: reuse it across re-scans and SPA navigation, and put it
      // back if the page ever detached it.
      if (ui) {
        if (!ui.host.isConnected) document.documentElement.append(ui.host);
        return ui;
      }
      const stale = document.getElementById(HOST_ID);
      if (stale) stale.remove();
      const host = document.createElement("div");
      host.id = HOST_ID;
      const shadow = host.attachShadow({mode: "open"});
      const style = document.createElement("style");
      style.textContent = CSS;
      shadow.append(style);

      const button = el("button", {
        class: "rce-button",
        type: "button",
        hidden: true,
        "aria-haspopup": "dialog",
        "aria-controls": "rce-panel",
      }, [
        el("span", {class: "rce-dot", "aria-hidden": "true"}),
        el("span", {class: "rce-button-label", text: "Export comments"}),
      ]);

      const overlay = el("div", {class: "rce-overlay", hidden: true});
      const panel = el("section", {
        class: "rce-panel",
        id: "rce-panel",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "rce-title",
        "aria-describedby": "rce-summary",
        hidden: true,
      });
      const close = el("button", {
        class: "rce-close",
        type: "button",
        "aria-label": "Close export panel",
        text: "×",
      });
      const head = el("div", {class: "rce-head"}, [
        el("div", {}, [
          el("p", {class: "rce-kicker", text: "Reddit comments"}),
          el("h2", {class: "rce-title", id: "rce-title", text: "Export comments"}),
        ]),
        close,
      ]);
      const summary = el("p", {class: "rce-summary", id: "rce-summary"});
      const reported = el("p", {class: "rce-reported"});
      const note = el("p", {class: "rce-note"});
      const formats = el("div", {class: "rce-formats"});
      const formatButtons = [];
      for (const [key, label, description] of [
        ["json", "JSON", "All fields and parent IDs"],
        ["csv", "CSV", "Flat table for spreadsheets"],
        ["markdown", "Markdown", "Readable nested thread"],
      ]) {
        const formatButton = el("button", {
          class: "rce-format",
          type: "button",
          "data-format": key,
        }, [
          el("strong", {text: label}),
          el("span", {text: description}),
        ]);
        formatButton.addEventListener("click", () => downloadFormat(key));
        formatButtons.push(formatButton);
        formats.append(formatButton);
      }
      const status = el("p", {class: "rce-status", role: "status", "aria-live": "polite"});
      const privacy = el("p", {
        class: "rce-privacy",
        text: "Runs locally. The comments are not uploaded anywhere.",
      });
      panel.append(head, summary, reported, note, formats, status, privacy);
      overlay.append(panel);
      shadow.append(button, overlay);
      document.documentElement.append(host);

      button.addEventListener("click", openPanel);
      close.addEventListener("click", () => closePanel(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closePanel(true);
      });
      document.addEventListener("keydown", onKeydown);

      ui = {
        host, shadow, button, overlay, panel, close, summary, reported, note,
        formats, formatButtons, status, privacy,
      };
      return ui;
    }

    function updateButton(count) {
      if (!ui) return;
      const label = ui.button.querySelector(".rce-button-label");
      if (label) label.textContent = "Export comments" + (count ? " · " + count : "");
      ui.button.setAttribute("aria-label", "Export " + count + " loaded comment" + (count === 1 ? "" : "s"));
      ui.button.hidden = count === 0;
    }

    function updatePanelSummary() {
      if (!ui) return;
      const count = lastCount;
      ui.summary.textContent = count + " comment" + (count === 1 ? "" : "s") + " loaded from this page.";
      if (lastPost && Number.isFinite(lastPost.comment_count)) {
        ui.reported.textContent = "Reddit reports " + lastPost.comment_count + " comment"
          + (lastPost.comment_count === 1 ? "" : "s") + " on this post.";
      } else {
        ui.reported.textContent = "Reddit's total comment count is not available in the page.";
      }
      ui.note.textContent = count
        ? "Only comments currently loaded in the page are included. Scroll or expand more comments before exporting for a larger file."
        : "No comments are loaded in the page.";
      for (const formatButton of ui.formatButtons) formatButton.disabled = count === 0;
    }

    function closePanel(restoreFocus) {
      if (!ui) return;
      ui.overlay.hidden = true;
      ui.panel.hidden = true;
      panelOpen = false;
      if (restoreFocus && !ui.button.hidden) ui.button.focus();
    }

    function openPanel() {
      refresh(true);
      if (!lastCount || !ui) return;
      updatePanelSummary();
      ui.status.textContent = "";
      ui.overlay.hidden = false;
      ui.panel.hidden = false;
      panelOpen = true;
      const first = ui.formatButtons.find((button) => !button.disabled) || ui.close;
      if (first) setTimeout(() => first.focus(), 0);
    }

    function onKeydown(event) {
      if (!panelOpen || !ui) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel(true);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(ui.panel.querySelectorAll("button:not([disabled])"))
        .filter((node) => node.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = ui.shadow.activeElement;
      if (!ui.panel.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // Blob download through the shared saveBlob() helper; nothing is uploaded.
    function saveText(text, filename, mime) {
      saveBlob(new Blob([text], {type: mime + ";charset=utf-8"}), filename);
    }

    function downloadFormat(format) {
      if (!ui) return;
      refresh(true);
      if (!lastPost || !lastComments.length) {
        updatePanelSummary();
        ui.status.textContent = "No comments are loaded.";
        return;
      }
      const spec = FORMATS[format];
      if (!spec) return;
      let text;
      if (format === "json") text = commentsToJson(lastPost, lastComments, new Date());
      else if (format === "csv") text = commentsToCsv(lastComments);
      else text = commentsToMarkdown(lastPost, lastComments, new Date());
      const filename = filenameFor(lastPost, format);
      try {
        saveText(text, filename, spec.mime);
        ui.status.textContent = "Started download: " + filename + " (" + lastComments.length + " comments).";
      } catch (_) {
        ui.status.textContent = "The browser could not create the download.";
      }
    }

    function hideUi() {
      lastPost = null;
      lastCount = 0;
      lastComments = [];
      if (!ui) return;
      ui.button.hidden = true;
      if (panelOpen) closePanel(false);
    }

    // full=true also builds every comment record (needed to open the panel or
    // download); the idle scan only counts, so a long thread is not re-read
    // in full every second.
    function refresh(full) {
      if (!document.body) return;
      const route = parsePostUrl(location.href, "https://www.reddit.com");
      if (!route) {
        hideUi();
        return;
      }
      const post = postMeta(route, document);
      let comments = [];
      let count;
      if (full) {
        comments = collectComments(document, post);
        count = comments.length;
      } else {
        count = countComments(document, post);
      }
      lastPost = post;
      lastComments = comments;
      lastCount = count;
      ensureUi();
      updateButton(count);
      if (!count) {
        if (panelOpen) closePanel(false);
        return;
      }
      if (panelOpen) updatePanelSummary();
    }

    function tick() {
      if (!document.body) return;
      const href = location.href;
      if (href !== lastHref) {
        lastHref = href;
        if (panelOpen) closePanel(false);
      }
      refresh(panelOpen);
    }

    function boot() {
      if (booted) return;
      booted = true;
      tick();
      window.addEventListener("popstate", tick);
      window.addEventListener("hashchange", tick);
      window.addEventListener("pageshow", tick);
      setInterval(tick, SCAN_INTERVAL_MS);
    }

    return {
      boot,
      HOST_ID,
      SCAN_INTERVAL_MS,
      FORMATS,
      CSV_COLUMNS,
      parsePostUrl,
      cleanText,
      cleanAuthor,
      parseCount,
      parseCreated,
      parseScore,
      normalizeText,
      buildExport,
      commentsToJson,
      csvValue,
      commentsToCsv,
      markdownEscape,
      markdownLinkUrl,
      authorLabel,
      formatDate,
      commentsToMarkdown,
      filenameFor,
    };
  })();
  // ── End comment export ─────────────────────────────────────────────────

  // ── Scanning ───────────────────────────────────────────────────────────
  const SCAN_DEBOUNCE_MS = 180;
  const SCAN_MAX_WAIT_MS = 1000;
  let scanTimer = 0;
  let scanQueuedAt = 0;
  // Debounced, but never starved: during continuous DOM mutation (infinite
  // scroll) a scan still runs at least every SCAN_MAX_WAIT_MS.
  function scheduleScan() {
    const now = Date.now();
    if (!scanQueuedAt) scanQueuedAt = now;
    clearTimeout(scanTimer);
    const wait = Math.max(0, Math.min(SCAN_DEBOUNCE_MS, scanQueuedAt + SCAN_MAX_WAIT_MS - now));
    scanTimer = setTimeout(() => {
      scanQueuedAt = 0;
      scan();
    }, wait);
  }

  function scan() {
    if (!document.body) return;
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (state.open && !state.busy) closePanel();
    }
    document.querySelectorAll(GALLERY_SELECTOR).forEach(processGallery);
    document.querySelectorAll("shreddit-post[content-href], [data-testid='post-container'][content-href]").forEach(processEmbedPost);
    document.querySelectorAll(VIDEO_PLAYER_SELECTOR).forEach(processVideo);
    document.querySelectorAll("shreddit-post[post-type='video'], [data-testid='post-container'][post-type='video']").forEach(processVideoPostFallback);
    document.querySelectorAll("shreddit-post video, [data-testid='post-container'] video").forEach(processNativeVideo);
    document.querySelectorAll("shreddit-post img, [data-testid='post-container'] img").forEach(processImage);
    document.querySelectorAll("shreddit-comment, [data-testid='comment']").forEach(processCommentMedia);
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  function boot() {
    if (window.top !== window.self) return;
    ensurePageStyle();
    ensureRoot();
    scan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {childList: true, subtree: true});
    setInterval(scheduleScan, 2500);
    window.addEventListener("popstate", scheduleScan);
    window.addEventListener("hashchange", scheduleScan);
    ui.scrim.addEventListener("click", closePanel);
    ui.close.addEventListener("click", closePanel);
    document.addEventListener("keydown", (event) => {
      if (!ui || ui.panel.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(ui.panel.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])"))
        .filter((node) => !node.disabled && node.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = ui.shadow.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    });
    // Comment export has its own UI and scan; a failure there must never stop
    // the media features above.
    try { commentExport.boot(); } catch (_) { /* media features keep working */ }
  }

  const api = {
    commentExport,
    NOBSDL_ORIGIN,
    IMAGE_HOSTS,
    parseRedditPostUrl,
    postUrlFromId,
    parseRedditImageUrl,
    isRedditImageUrl,
    originalImageUrl,
    parseEmbedVideoUrl,
    galleryLabel,
    imageKey,
    srcsetCandidates,
    bestImageVariant,
    galleryItemsFromImages,
    imageFilename,
    galleryZipFilename,
    crc32,
    zipArchive,
    normalizeRedditChoices,
    downloadParams,
    progressView,
    safeStatusPath,
    safeFileUrl,
    formatSize,
    formatDuration,
    cleanPostTitle,
    parseResponseHeaders,
    openOnNoBsdlUrl,
  };

  if (typeof module === "object" && module && module.exports
    && typeof process === "object" && process.versions && process.versions.node) {
    module.exports = api;
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {once: true});
  } else {
    boot();
  }
})();
