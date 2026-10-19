import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const SCRIPT = new URL("../nobsdl-reddit-media.user.js", import.meta.url);
const source = readFileSync(SCRIPT, "utf8");
const {
  parseRedditPostUrl,
  postUrlFromId,
  parseRedditImageUrl,
  isRedditImageUrl,
  originalImageUrl,
  imageKey,
  srcsetCandidates,
  bestImageVariant,
  galleryItemsFromImages,
  imageFilename,
  normalizeRedditChoices,
  downloadParams,
  progressView,
  safeStatusPath,
  safeFileUrl,
  formatSize,
  cleanPostTitle,
  parseResponseHeaders,
  openOnNoBsdlUrl,
  IMAGE_HOSTS,
} = require(SCRIPT.pathname);

const post = (href) => parseRedditPostUrl(href);

test("metadata is least-privilege and Reddit-only", () => {
  const header = source.slice(0, source.indexOf("// ==/UserScript=="));
  const matches = [...header.matchAll(/^\/\/ @match\s+(\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(matches, ["*://reddit.com/*", "*://*.reddit.com/*", "*://redd.it/*"]);
  assert.deepEqual([...header.matchAll(/^\/\/ @exclude\s+(\S+)$/gm)].map((m) => m[1]), ["*://embed.reddit.com/*"]);
  assert.deepEqual([...header.matchAll(/^\/\/ @grant\s+(\S+)$/gm)].map((m) => m[1]).sort(), ["GM.xmlHttpRequest", "GM_xmlhttpRequest"]);
  assert.deepEqual([...header.matchAll(/^\/\/ @connect\s+(\S+)$/gm)].map((m) => m[1]).sort(), ["i.redd.it", "nobsdl.com", "preview.redd.it"]);
  assert.deepEqual(IMAGE_HOSTS, ["i.redd.it", "preview.redd.it"]);
  assert.match(header, /^\/\/ @noframes$/m);
  assert.match(header, /^\/\/ @antifeature\s+payment\s+\S/m);
  assert.match(header, /^\/\/ @version\s+1\.\d+\.\d+$/m);
  assert.match(header, /^\/\/ @run-at\s+document-idle$/m);
  assert.ok([...header.match(/^\/\/ @name\s+(.*)$/m)[1]].length <= 100);
  assert.ok([...header.match(/^\/\/ @description\s+(.*)$/m)[1]].length <= 500);
  assert.doesNotMatch(header, /@connect\s+\*/);
});

test("the script never uses page network APIs, storage, or HTML injection", () => {
  assert.doesNotMatch(source, /new XMLHttpRequest|\bfetch\s*\(|navigator\.sendBeacon/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.match(source, /url: NOBSDL_ORIGIN \+ path/);
  assert.match(source, /rel = "noopener noreferrer"/);
  assert.match(source, /referrerPolicy = "no-referrer"/);
});

test("copy stays within verified Reddit/NoBsDL behaviour", () => {
  assert.doesNotMatch(source, /\bno ads\b|ad-free|without ads/i);
  assert.doesNotMatch(source, /no watermark|watermark-free|without watermark/i);
  assert.doesNotMatch(source, /unlimited downloads|free 4K/i);
  assert.doesNotMatch(source, /private VPS|dedicated queue|priority queue/i);
});

test("recognises Reddit post URLs and canonicalises them", () => {
  assert.deepEqual(post("https://www.reddit.com/r/pics/comments/1x9kry0/merlin/?utm_source=share"), {
    id: "1x9kry0",
    url: "https://www.reddit.com/r/pics/comments/1x9kry0/merlin",
    path: "/r/pics/comments/1x9kry0/merlin",
    subreddit: "pics",
  });
  assert.equal(post("https://old.reddit.com/r/videos/comments/abc123/a_title/").url, "https://www.reddit.com/r/videos/comments/abc123/a_title");
  assert.equal(post("https://www.reddit.com/comments/abc123").url, "https://www.reddit.com/comments/abc123");
  assert.equal(post("https://www.reddit.com/user/someone/comments/abc123/title/").url, "https://www.reddit.com/user/someone/comments/abc123/title");
  assert.equal(post("https://redd.it/abc123").url, "https://www.reddit.com/comments/abc123");
  assert.equal(post("https://www.reddit.com/r/pics/comments/abc123/title/comment/xyz").url, "https://www.reddit.com/r/pics/comments/abc123/title/comment/xyz");
});

test("does not treat listings, galleries, CDN links, or lookalike hosts as posts", () => {
  for (const href of [
    "https://www.reddit.com/",
    "https://www.reddit.com/r/pics/",
    "https://www.reddit.com/r/pics/comments/",
    "https://www.reddit.com/gallery/abc123",
    "https://www.reddit.com/user/someone",
    "https://www.reddit.com/comments/abc",
    "https://www.reddit.com/comments/abcdefghijklmnop",
    "https://v.redd.it/abc123",
    "https://i.redd.it/abc123.jpg",
    "https://preview.redd.it/abc123.jpg",
    "https://reddit.com.evil.example/r/pics/comments/abc123/x/",
    "https://evilreddit.com/r/pics/comments/abc123/x/",
    "https://www.reddit.com.evil.example/comments/abc123",
    "javascript:alert(1)",
    "not a url",
  ]) assert.equal(post(href), null, href);
});

test("post-id helper accepts only t3 ids", () => {
  assert.equal(postUrlFromId("t3_abc123"), "https://www.reddit.com/comments/abc123");
  assert.equal(postUrlFromId("abc123"), "https://www.reddit.com/comments/abc123");
  for (const bad of ["t5_abc123", "t3_abc", "t3_abcdefghijklmnop", "t3_", ""]) assert.equal(postUrlFromId(bad), null, bad);
});

test("only Reddit-hosted still images are accepted", () => {
  assert.equal(parseRedditImageUrl("https://i.redd.it/foo.JPG").url, "https://i.redd.it/foo.JPG");
  const preview = parseRedditImageUrl("https://preview.redd.it/foo.png?width=640&format=pjpg&auto=webp");
  assert.equal(preview.host, "preview.redd.it");
  assert.equal(preview.ext, "png");
  assert.equal(preview.key, "/foo.png");
  assert.equal(parseRedditImageUrl("http://i.redd.it/foo.jpg").url, "https://i.redd.it/foo.jpg");
  for (const bad of [
    "https://preview.redd.it/foo.jpg?format=mp4",
    "https://i.redd.it/foo.mp4",
    "https://external-preview.redd.it/foo.jpg",
    "https://v.redd.it/foo.jpg",
    "https://i.redd.it.evil.example/foo.jpg",
    "https://i.imgur.com/foo.jpg",
    "data:image/jpeg;base64,AAAA",
    "https://i.redd.it/foo",
  ]) assert.equal(isRedditImageUrl(bad), false, bad);
});

test("original image path upgrades a preview to i.redd.it when possible", () => {
  assert.equal(originalImageUrl("https://preview.redd.it/merlin-v0-abc.jpg?width=640&auto=webp"), "https://i.redd.it/merlin-v0-abc.jpg");
  assert.equal(originalImageUrl("https://i.redd.it/merlin-v0-abc.png?x=1"), "https://i.redd.it/merlin-v0-abc.png");
  assert.equal(originalImageUrl("https://preview.redd.it/foo.webp"), null);
  assert.equal(originalImageUrl("https://example.com/foo.jpg"), null);
  assert.equal(imageKey("https://preview.redd.it/foo.jpg?width=320"), imageKey("https://preview.redd.it/foo.jpg?width=1080"));
  assert.equal(imageKey("https://i.redd.it/foo.jpg"), imageKey("https://preview.redd.it/foo.jpg?width=640"));
});

test("srcset chooses the largest real variant, falling back to src", () => {
  const srcset = "https://preview.redd.it/a.jpg?width=320 320w, https://preview.redd.it/a.jpg?width=1080 1080w, https://preview.redd.it/a.jpg?width=640 640w";
  assert.equal(bestImageVariant("https://preview.redd.it/a.jpg", srcset), "https://preview.redd.it/a.jpg?width=1080");
  assert.equal(bestImageVariant("https://preview.redd.it/a.jpg", "https://preview.redd.it/a.jpg 1x, https://preview.redd.it/a.jpg?d=2 2x"), "https://preview.redd.it/a.jpg?d=2");
  assert.equal(bestImageVariant("https://preview.redd.it/a.jpg", ""), "https://preview.redd.it/a.jpg");
  assert.equal(bestImageVariant("", "/media/a.jpg 640w", "https://www.reddit.com/r/pics/"), "https://www.reddit.com/media/a.jpg");
  assert.equal(srcsetCandidates("bad, https://preview.redd.it/a.jpg 1080w").length, 2);
});

test("gallery helper dedupes, sorts pages, and never invents items", () => {
  const items = galleryItemsFromImages([
    {url: "https://preview.redd.it/two.jpg?width=640", alt: "r/pics - Second", page: 2},
    {url: "https://preview.redd.it/one.jpg?width=640", alt: "r/pics - First", page: 1},
    {url: "https://preview.redd.it/one.jpg?width=1080", alt: "duplicate", page: 1},
    {url: "https://example.com/not-reddit.jpg", alt: "external", page: 3},
    {url: "not a url", alt: "broken", page: 4},
  ]);
  assert.deepEqual(items.map((item) => [item.index, item.total, item.alt, item.url]), [
    [1, 2, "First", "https://preview.redd.it/one.jpg?width=640"],
    [2, 2, "Second", "https://preview.redd.it/two.jpg?width=640"],
  ]);
  assert.deepEqual(galleryItemsFromImages([]), []);
  const zeroBased = galleryItemsFromImages([
    {url: "https://preview.redd.it/a.jpg", page: 1},
    {url: "https://preview.redd.it/b.jpg", page: 0},
    {url: "https://preview.redd.it/c.jpg"},
    {url: "https://preview.redd.it/d.jpg", page: ""},
  ]);
  assert.deepEqual(zeroBased.map((item) => [item.page, item.index, item.url]), [
    [0, 1, "https://preview.redd.it/b.jpg"],
    [1, 2, "https://preview.redd.it/a.jpg"],
    [0, 3, "https://preview.redd.it/c.jpg"],
    [0, 4, "https://preview.redd.it/d.jpg"],
  ]);
});

test("filenames are safe, readable, and extension-aware", () => {
  assert.equal(imageFilename({title: "Merlin: soaking / up?", url: "https://preview.redd.it/a.jpg", contentType: "image/webp"}), "Merlin soaking up.webp");
  assert.equal(imageFilename({title: "Merlin soaking up the sun", url: "https://preview.redd.it/a.jpg", index: 2, total: 3}), "Merlin soaking up the sun - 02.jpg");
  assert.equal(imageFilename({title: "", url: "https://preview.redd.it/merlin-soaking-up-the-sun-v0-g9jh3qsz0cwh1.jpg?width=640"}), "merlin-soaking-up-the-sun.jpg");
  assert.equal(imageFilename({title: "x.png", url: "https://preview.redd.it/a.png", contentType: "image/jpeg"}), "x.jpg");
  const traversal = imageFilename({title: "../../etc/passwd", url: "https://preview.redd.it/a.jpg"});
  assert.equal(traversal.includes("/"), false);
  assert.equal(traversal.includes(".."), false);
  assert.ok(imageFilename({title: "x".repeat(400), url: "https://preview.redd.it/a.jpg"}).length <= 120);
  assert.equal(cleanPostTitle("r/pics - Merlin soaking up the sun!"), "Merlin soaking up the sun!");
  assert.equal(cleanPostTitle("Merlin soaking up the sun : r/pics"), "Merlin soaking up the sun");
});

test("format normalisation keeps the API's real tiers and bitrates", () => {
  const data = {
    title: "r/pics - Fixture video",
    duration: 212,
    is_supporter: false,
    video_formats: {
      "720p MP4 · 1280x720": {format_id: "dash-720", quality_edge: 720, height: 720, size_mb: 2.5, resolution: "1280x720"},
      "480p MP4 · 854x480": {format_id: "dash-480", quality_edge: 480, height: 480, size_mb: 1.2, resolution: "854x480"},
    },
    supporter_video_formats: {
      "1080p MP4 · 1920x1080": {format_id: "dash-1080", quality_edge: 1080, height: 1080, size_mb: 5, resolution: "1920x1080"},
    },
    audio_formats: {
      "128": {bitrate: 128, size_mb: 0.2, tier: "free"},
      "192": {bitrate: 192, size_mb: 0.4, tier: "free"},
      "320": {bitrate: 320, size_mb: 5, tier: "supporter"},
      "unknown": {bitrate: 256, size_mb: "?", tier: "unknown"},
    },
  };
  const free = normalizeRedditChoices(data);
  assert.equal(free.title, "Fixture video");
  assert.equal(free.duration, 212);
  assert.deepEqual(free.video.map((choice) => [choice.title, choice.format, choice.locked, choice.resolution]), [
    ["720p", "mp4", false, "1280x720"],
    ["480p", "mp4", false, "854x480"],
    ["1080p", "mp4", true, "1920x1080"],
  ]);
  assert.deepEqual(free.audio.map((choice) => [choice.title, choice.locked]), [
    ["256 kbps", false],
    ["128 kbps", false],
    ["320 kbps", true],
  ]);
  const paid = normalizeRedditChoices(Object.assign({}, data, {is_supporter: true}));
  assert.equal(paid.video.some((choice) => choice.locked), false);
  assert.equal(paid.audio.some((choice) => choice.locked), false);
  assert.equal(normalizeRedditChoices({}).video.length, 0);
  assert.equal(normalizeRedditChoices(null).audio.length, 0);
});

test("free choices are shown before locked ones, then by real quality", () => {
  const info = normalizeRedditChoices({
    video_formats: {"1080p": {format_id: "free1080", quality_edge: 1080, size_mb: 20}},
    supporter_video_formats: {"2160p": {format_id: "paid2160", quality_edge: 2160, size_mb: 80}},
  });
  assert.deepEqual(info.video.map((choice) => [choice.title, choice.locked]), [["1080p", false], ["2160p", true]]);
});

test("download parameters follow the existing /download contract", () => {
  assert.equal(
    downloadParams({family: "video", format: "mp4", formatId: "dash-720"}, "https://www.reddit.com/r/pics/comments/1x9kry0/merlin/"),
    "/download?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fpics%2Fcomments%2F1x9kry0%2Fmerlin&format=mp4&async=1&format_id=dash-720"
  );
  assert.match(
    downloadParams({family: "audio", format: "mp3", bitrate: 128}, "https://redd.it/abc123"),
    /^\/download\?url=https%3A%2F%2Fwww\.reddit\.com%2Fcomments%2Fabc123&format=mp3&async=1&audio_bitrate=128$/
  );
  assert.match(
    downloadParams({family: "audio", format: "mp3", bitrate: 320, formatId: "audio-320"}, "https://www.reddit.com/comments/abc123"),
    /format=mp3&async=1&format_id=audio-320$/
  );
  assert.equal(downloadParams({family: "video", format: "mp4"}, "https://example.com/not-reddit"), null);
});

test("progress text only reports measured numbers", () => {
  const MB = 1024 * 1024;
  assert.deepEqual(progressView("downloading", {
    downloaded_bytes: 50 * MB,
    total_bytes: 200 * MB,
    fraction: 0.25,
    speed_bps: 5 * MB,
    eta_seconds: 30,
  }, 9, "mp4"), {
    mode: "measured",
    fraction: 0.25,
    text: "25% · 50.0 MB of 200 MB · 5.0 MB/s · ~30s left",
    step: 1,
  });
  assert.equal(progressView("queued", null, 0, "mp4").text, "Waiting for a free download slot…");
  assert.equal(progressView("connecting", null, 3, "mp4").text, "Preparing the Reddit video on NoBsDL… 3s");
  assert.equal(progressView("merging", {fraction: 1}, 1, "mp4").mode, "working");
  assert.deepEqual(progressView("converting", {fraction: 1, encode_fraction: 0.64}, 3, "mp3"), {
    mode: "measured",
    fraction: 0.64,
    text: "Converting to MP3… 64%",
    step: 2,
  });
  assert.equal(progressView("ready", null, 0, "mp4").mode, "done");
  assert.equal(progressView("downloading", {fraction: 0.5}, 0, "mp4").text, "Downloading on NoBsDL…");
  assert.equal(formatSize(2.5), "~2.5 MB");
});

test("only same-origin NoBsDL status and file paths are followed", () => {
  assert.equal(safeStatusPath("/api/free-download/status/abcdef123456"), "/api/free-download/status/abcdef123456");
  assert.equal(safeFileUrl("/api/free-download/file/abcdef123456"), "https://nobsdl.com/api/free-download/file/abcdef123456");
  for (const bad of [
    "https://evil.example/api/free-download/file/abcdef123456",
    "//evil.example/api/free-download/file/abcdef123456",
    "/api/free-download/file/../admin",
    "/d/token",
    "",
  ]) {
    assert.equal(safeFileUrl(bad), null, bad);
    assert.equal(safeStatusPath(bad), null, bad);
  }
});

test("header and fallback links stay explicit", () => {
  assert.equal(parseResponseHeaders("Content-Type: image/jpeg\r\nX-Test: yes")["content-type"], "image/jpeg");
  assert.equal(
    openOnNoBsdlUrl("https://www.reddit.com/r/pics/comments/1x9kry0/merlin/"),
    "https://nobsdl.com/reddit-downloader?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fpics%2Fcomments%2F1x9kry0%2Fmerlin"
  );
  assert.equal(openOnNoBsdlUrl("https://example.com/nope"), "https://nobsdl.com/reddit-downloader");
});
