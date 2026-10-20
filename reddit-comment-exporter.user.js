// ==UserScript==
// @name         Reddit Comment Exporter
// @namespace    https://github.com/samrtulethtb/nobsdl-reddit-downloader
// @version      1.0.0
// @description  Export the comments already loaded on a Reddit post to JSON, CSV or Markdown. Runs locally; no server requests.
// @author       Reddit Comment Exporter
// @license      MIT
// @match        https://www.reddit.com/*
// @match        https://reddit.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

// What this script does:
// - Reads only the comments already present in the page's DOM.
// - Builds JSON, CSV or Markdown locally and downloads it with a Blob URL.
// - Makes no network requests, reads no cookies, and stores nothing.
// - It does not fetch more comments or bypass Reddit's collapsed/load-more UI.
(function () {
  "use strict";

  const HOST_ID = "reddit-comment-exporter-root";
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
  const CSS = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483000;
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
    @media (max-width: 560px) {
      .rce-overlay { align-items: end; padding: 10px; }
      .rce-panel { max-height: 92vh; border-radius: 16px; padding: 18px; }
      .rce-formats { grid-template-columns: 1fr; }
      .rce-button { right: 12px; bottom: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  `;

  // ── Small helpers ──────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = String(value);
      else if (key === "hidden" || key === "disabled") node[key] = Boolean(value);
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of [].concat(children || [])) if (child) node.append(child);
    return node;
  }

  function cleanText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function cleanPostTitle(value) {
    let text = cleanText(value);
    text = text.replace(/^r\/[A-Za-z0-9_]+\s*[-–—]\s*/i, "");
    text = text.replace(/\s*[:|–—-]\s*r\/[A-Za-z0-9_]+\s*$/i, "");
    text = text.replace(/\s*[-–—]\s*Reddit\s*$/i, "");
    return text.trim();
  }

  function cleanAuthor(value) {
    return cleanText(value).replace(/^u\//i, "");
  }

  function parseCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  }

  // ── Post URL and page metadata ────────────────────────────────────────
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

  // ── Comment extraction ────────────────────────────────────────────────
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
      .replace(/\u200b/g, "")
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

  function commentRecord(node, post) {
    if (!node || node.nodeType !== 1) return null;
    const thingid = cleanText(node.getAttribute("thingid") || node.id || "");
    if (!/^t1_[a-z0-9]+$/i.test(thingid)) return null;
    const nodePostId = cleanText(node.getAttribute("postid"));
    if (nodePostId && post && post.id && nodePostId !== post.id) return null;

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

  // ── Export formats ────────────────────────────────────────────────────
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
      if (comment.permalink) line += " · [link](" + comment.permalink + ")";
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

  // ── UI ────────────────────────────────────────────────────────────────
  let ui = null;
  let panelOpen = false;
  let lastPost = null;
  let lastComments = [];
  let lastHref = "";

  function ensureUi() {
    if (ui) return ui;
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
    const count = lastComments.length;
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
    refresh();
    if (!lastComments.length || !ui) return;
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

  function saveText(text, filename, mime) {
    const blob = new Blob([text], {type: mime + ";charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // The download has already started; nothing else to do.
      }
    }, 60000);
  }

  function downloadFormat(format) {
    if (!ui) return;
    refresh();
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
    lastComments = [];
    if (!ui) return;
    ui.button.hidden = true;
    if (panelOpen) closePanel(false);
  }

  function refresh() {
    if (!document.body) return;
    const route = parsePostUrl(location.href, "https://www.reddit.com");
    if (!route) {
      hideUi();
      return;
    }
    const post = postMeta(route, document);
    const comments = collectComments(document, post);
    lastPost = post;
    lastComments = comments;
    ensureUi();
    updateButton(comments.length);
    if (!comments.length) {
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
    refresh();
  }

  function boot() {
    if (window.top !== window.self) return;
    tick();
    window.addEventListener("popstate", tick);
    window.addEventListener("hashchange", tick);
    window.addEventListener("pageshow", tick);
    setInterval(tick, SCAN_INTERVAL_MS);
  }

  const api = {
    HOST_ID,
    SCAN_INTERVAL_MS,
    FORMATS,
    CSV_COLUMNS,
    parsePostUrl,
    cleanText,
    cleanPostTitle,
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
    authorLabel,
    formatDate,
    commentsToMarkdown,
    filenameFor,
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
