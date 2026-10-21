// Unit tests for the comment-export section of the merged userscript
// nobsdl-reddit-media.user.js. Pure functions only; the
// browser behaviour is covered by tests/test_nobsdl_reddit_comment_export_browser.js.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const SCRIPT = new URL("../nobsdl-reddit-media.user.js", import.meta.url);
const source = readFileSync(SCRIPT, "utf8");
const merged = require(SCRIPT.pathname);
// Comment-export functions plus the shared title cleaner the section reuses.
const api = Object.assign({}, merged.commentExport, {cleanPostTitle: merged.cleanPostTitle});

const SECTION_START = "// ── Comment export ──";
const SECTION_END = "// ── End comment export ──";
const section = source.slice(source.indexOf(SECTION_START), source.indexOf(SECTION_END));

const post = {
  id: "t3_abc123",
  url: "https://www.reddit.com/r/test/comments/abc123/a_title",
  title: "A <title> & more",
  subreddit: "test",
  author: "alice",
  comment_count: 4,
};
const comments = [
  {
    id: "t1_c1",
    parent_id: "t3_abc123",
    depth: 0,
    author: "alice",
    body: "Top comment.\nSecond line.",
    score: 12,
    created_utc: 1792463427,
    created_iso: "2026-10-20T02:30:27.000Z",
    permalink: "https://www.reddit.com/r/test/comments/abc123/a_title/comment/c1/",
    is_submitter: true,
    is_deleted: false,
    is_removed: false,
    collapsed: false,
    content_type: "text",
  },
  {
    id: "t1_c2",
    parent_id: "t1_c1",
    depth: 1,
    author: "bob",
    body: "Reply with \"quotes\" and\nnew line",
    score: 3,
    created_utc: 1792463500,
    created_iso: "2026-10-20T02:31:40.000Z",
    permalink: "https://www.reddit.com/r/test/comments/abc123/a_title/comment/c2/",
    is_submitter: false,
    is_deleted: false,
    is_removed: false,
    collapsed: false,
    content_type: "text",
  },
  {
    id: "t1_c3",
    parent_id: "t1_c2",
    depth: 2,
    author: "[deleted]",
    body: "[deleted]",
    score: null,
    created_utc: null,
    created_iso: null,
    permalink: null,
    is_submitter: false,
    is_deleted: true,
    is_removed: false,
    collapsed: true,
    content_type: "text",
  },
  {
    id: "t1_c4",
    parent_id: "t3_abc123",
    depth: 0,
    author: "dave",
    body: "=SUM(1,1)",
    score: 0,
    created_utc: 1792463600,
    created_iso: "2026-10-20T02:33:20.000Z",
    permalink: "https://www.reddit.com/r/test/comments/abc123/a_title/comment/c4/",
    is_submitter: false,
    is_deleted: false,
    is_removed: false,
    collapsed: false,
    content_type: "text",
  },
];
const now = new Date("2026-10-20T12:00:00.000Z");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

test("merged metadata announces comment export and keeps the media permissions", () => {
  const header = source.slice(0, source.indexOf("// ==/UserScript=="));
  assert.match(header, /^\/\/ @version\s+1\.2\.2$/m);
  const description = header.match(/^\/\/ @description\s+(.*)$/m)[1];
  assert.match(description, /comments/i);
  assert.match(description, /JSON, CSV or Markdown/);
  assert.doesNotMatch(description, /\bno ads\b|ad-free/i);
  assert.ok(description.length <= 500);
  assert.deepEqual([...header.matchAll(/^\/\/ @name\s+(.*)$/gm)].map((m) => m[1]), ["NoBsDL Reddit Media Downloader"]);
  assert.deepEqual([...header.matchAll(/^\/\/ @namespace\s+(.*)$/gm)].map((m) => m[1]), ["https://nobsdl.com/"]);
  // The comment export adds no grant and no connect host of its own; the
  // only extra grants are the manager download function used for video files.
  assert.deepEqual([...header.matchAll(/^\/\/ @grant\s+(\S+)$/gm)].map((m) => m[1]).sort(), ["GM.download", "GM.xmlHttpRequest", "GM_download", "GM_xmlhttpRequest"]);
  assert.deepEqual([...header.matchAll(/^\/\/ @connect\s+(\S+)$/gm)].map((m) => m[1]).sort(), ["i.redd.it", "nobsdl.com", "preview.redd.it"]);
  // The "what this script sends" header states that comment export sends nothing.
  const preamble = source.slice(0, source.indexOf("(function () {"));
  assert.match(preamble, /Comment export: runs locally and sends nothing/);
});

test("the comment-export section is delimited and non-empty", () => {
  assert.ok(source.indexOf(SECTION_START) > 0);
  assert.ok(source.indexOf(SECTION_END) > source.indexOf(SECTION_START));
  assert.equal(source.split(SECTION_START).length, 2);
  assert.equal(source.split(SECTION_END).length, 2);
  assert.ok(section.length > 5000);
});

test("the comment-export section makes no requests and reads no cookies or storage", () => {
  // Media transport helpers and every page network API.
  assert.doesNotMatch(section, /\bapiGet\b|\bapiBinary\b|\bgmRequestFunction\b|GM_xmlhttpRequest|GM\.xmlHttpRequest|GM_|GM\./);
  assert.doesNotMatch(section, /\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/);
  assert.doesNotMatch(section, /NOBSDL_ORIGIN|nobsdl\.com|\.src\s*=|new Image|\.action\s*=|\.submit\(/);
  // Cookies, storage and HTML injection.
  assert.doesNotMatch(section, /document\.cookie|localStorage|sessionStorage|indexedDB|cookieStore/);
  assert.doesNotMatch(section, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
  // Output is a Blob download through the shared pure helper.
  assert.match(section, /new Blob/);
  assert.match(section, /saveBlob\(/);
  // It must not click "load more" or other Reddit controls.
  assert.doesNotMatch(section, /\.click\(\)/);
});

test("the whole merged script keeps its existing no-network-API guarantees", () => {
  assert.doesNotMatch(source, /new XMLHttpRequest|\bfetch\s*\(|navigator\.sendBeacon/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /\bno ads\b|ad-free|without ads/i);
});

test("recognises and canonicalises Reddit post URLs", () => {
  assert.deepEqual(api.parsePostUrl("https://www.reddit.com/r/test/comments/abc123/a_title/?utm_source=share"), {
    id: "t3_abc123",
    shortId: "abc123",
    url: "https://www.reddit.com/r/test/comments/abc123/a_title",
    path: "/r/test/comments/abc123/a_title",
    subreddit: "test",
  });
  assert.equal(
    api.parsePostUrl("https://www.reddit.com/comments/abc123").url,
    "https://www.reddit.com/comments/abc123",
  );
  assert.equal(
    api.parsePostUrl("https://old.reddit.com/r/test/comments/abc123/a_title/comment/def456/").url,
    "https://www.reddit.com/r/test/comments/abc123/a_title",
  );
  assert.equal(
    api.parsePostUrl("https://www.reddit.com/user/someone/comments/abc123/a_title/").url,
    "https://www.reddit.com/user/someone/comments/abc123/a_title",
  );
  assert.equal(api.parsePostUrl("https://www.reddit.com/r/test/"), null);
  assert.equal(api.parsePostUrl("https://example.com/r/test/comments/abc123/title/"), null);
  assert.equal(api.parsePostUrl("https://www.reddit.com/r/test/comments/not-an-id/title/"), null);
});

test("normalises titles, authors and counters without inventing values", () => {
  assert.equal(api.cleanPostTitle("r/test - A real title"), "A real title");
  assert.equal(api.cleanPostTitle("A real title : r/test"), "A real title");
  assert.equal(api.cleanPostTitle("A real title - Reddit"), "A real title");
  assert.equal(api.cleanAuthor("u/Alice"), "Alice");
  assert.equal(api.cleanAuthor(""), "");
  assert.equal(api.parseCount("12"), 12);
  assert.equal(api.parseCount(""), null);
  assert.equal(api.parseCount("not a number"), null);
  assert.equal(api.parseScore("-4"), -4);
  assert.equal(api.parseScore(""), null);
  assert.equal(api.normalizeText("  one \n\n\n two  "), "one\n\ntwo");
});

test("parses ISO and Unix timestamps", () => {
  assert.deepEqual(api.parseCreated("2026-10-20T02:30:26.587000+0000"), {
    utc: 1792463426,
    iso: "2026-10-20T02:30:26.587Z",
  });
  assert.deepEqual(api.parseCreated("1729391234"), {
    utc: 1729391234,
    iso: "2024-10-20T02:27:14.000Z",
  });
  assert.equal(api.parseCreated(""), null);
  assert.equal(api.parseCreated("not a date"), null);
});

test("JSON export is structured, flat and honest about the source", () => {
  const parsed = JSON.parse(api.commentsToJson(post, comments, now));
  assert.equal(parsed.format, "reddit-comments");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.exported_at, "2026-10-20T12:00:00.000Z");
  assert.equal(parsed.source, "Reddit page DOM");
  assert.match(parsed.note, /Only comments loaded/);
  assert.deepEqual(parsed.post, {
    id: "t3_abc123",
    url: "https://www.reddit.com/r/test/comments/abc123/a_title",
    title: "A <title> & more",
    subreddit: "test",
    author: "alice",
    comment_count: 4,
  });
  assert.equal(parsed.count, 4);
  assert.equal(parsed.comments.length, 4);
  assert.equal(parsed.comments[1].parent_id, "t1_c1");
  assert.equal(parsed.comments[2].depth, 2);
  assert.equal(parsed.comments[2].is_deleted, true);
  assert.equal("element" in parsed.post, false);
});

test("CSV export quotes text, preserves newlines and guards formulas", () => {
  const csv = api.commentsToCsv(comments);
  assert.match(csv, /^id,parent_id,depth,author,score,created_utc,created_iso,is_submitter,is_deleted,is_removed,collapsed,permalink,body\r\n/);
  assert.match(csv, /"Top comment\.\nSecond line\."/);
  assert.match(csv, /"Reply with ""quotes"" and\nnew line"/);
  assert.match(csv, /"'=SUM\(1,1\)"/);
  const rows = parseCsv(csv);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].length, 13);
  assert.equal(rows[1][0], "t1_c1");
  assert.equal(rows[1][3], "alice");
  assert.equal(rows[1][4], "12");
  assert.equal(rows[1][7], "true");
  assert.equal(rows[2][4], "3");
  assert.equal(rows[3][4], "");
  assert.equal(rows[4][4], "0");
  assert.equal(rows[4][12], "'=SUM(1,1)");
  assert.equal(api.csvValue(-4), "-4");
  assert.equal(api.csvValue(false), "false");
});

test("Markdown export escapes HTML, marks OP and nests replies", () => {
  const markdown = api.commentsToMarkdown(post, comments, now);
  assert.match(markdown, /^# Reddit comments: A &lt;title&gt; &amp; more/m);
  assert.match(markdown, /- Post: https:\/\/www\.reddit\.com\/r\/test\/comments\/abc123\/a_title/);
  assert.match(markdown, /- Comments loaded: 4 \(Reddit reports 4\)/);
  assert.match(markdown, /- Exported: 2026-10-20T12:00:00\.000Z/);
  assert.match(markdown, /- Note: Only comments currently loaded/);
  assert.match(markdown, /^- \*\*u\/alice\*\* · 12 points · 2026-10-20 02:30 UTC · OP · \[link\]/m);
  assert.match(markdown, /^  - \*\*u\/bob\*\*/m);
  assert.match(markdown, /^    - \*\*\[deleted\]\*\*/m);
  assert.match(markdown, /^    > Reply with "quotes" and$/m);
  assert.match(markdown, /^      > \[deleted\]$/m);
});

test("Markdown links are Reddit-only and percent-encode characters that break the syntax", () => {
  const link = (permalink) => api.commentsToMarkdown(post, [{
    id: "t1_x", depth: 0, author: "alice", body: "hi", score: 1, permalink,
  }], now);
  assert.equal(api.markdownLinkUrl("https://www.reddit.com/r/t/comments/abc123/a_(b)/comment/c1/"),
    "https://www.reddit.com/r/t/comments/abc123/a_%28b%29/comment/c1/");
  assert.equal(api.markdownLinkUrl("https://www.reddit.com/r/t/a b<c>d"), "https://www.reddit.com/r/t/a%20b%3Cc%3Ed");
  const out = link("https://www.reddit.com/r/t/comments/abc123/x)(evil)/comment/c1/");
  assert.match(out, /\[link\]\(https:\/\/www\.reddit\.com\/r\/t\/comments\/abc123\/x%29%28evil%29\/comment\/c1\/\)/);
  assert.doesNotMatch(out, /\)\(evil/);
  for (const bad of ["http://www.reddit.com/r/t/", "https://old.reddit.com/r/t/", "https://evil.example/https://www.reddit.com/", "javascript:alert(1)", "", null, undefined]) {
    assert.equal(api.markdownLinkUrl(bad), "", String(bad));
    assert.doesNotMatch(link(bad), /\[link\]/, String(bad));
  }
});

test("file names are stable and safe", () => {
  assert.equal(api.filenameFor(post, "json"), "reddit-comments-test-abc123.json");
  assert.equal(api.filenameFor(post, "csv"), "reddit-comments-test-abc123.csv");
  assert.equal(api.filenameFor(post, "markdown"), "reddit-comments-test-abc123.md");
  assert.equal(
    api.filenameFor({id: "t3_AbC123", subreddit: "a/b c"}, "json"),
    "reddit-comments-a-b-c-AbC123.json",
  );
  assert.equal(api.filenameFor({id: "", subreddit: ""}, "json"), "reddit-comments-reddit-post.json");
});

test("buildExport keeps the post summary separate from the flat comments", () => {
  const payload = api.buildExport(post, comments, now);
  assert.equal(payload.post.title, "A <title> & more");
  assert.equal(payload.post.comment_count, 4);
  assert.equal(payload.count, 4);
  assert.equal(payload.comments[0].id, "t1_c1");
  assert.equal("element" in payload.post, false);
});
