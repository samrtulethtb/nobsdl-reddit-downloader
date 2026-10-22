// Browser-level verification for nobsdl-reddit-media.user.js.
// Every Reddit page, Reddit image host and NoBsDL API answer is fulfilled in
// process; no public site or NoBsDL endpoint is contacted. GM_xmlhttpRequest is
// provided by a small test polyfill on top of the intercepted network.
//
// Run (Playwright for Node installed anywhere outside the repo, e.g. a scratch dir):
//   NODE_PATH=<dir>/node_modules CHROME_BIN=/usr/bin/google-chrome node tests/test_nobsdl_reddit_userscript_browser.js
// Firefox (Playwright's own build, no executablePath):
//   BROWSER=firefox NODE_PATH=<dir>/node_modules node tests/test_nobsdl_reddit_userscript_browser.js
'use strict';

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'nobsdl-reddit-media.user.js'), 'utf8');
const MB = 1024 * 1024;
const NOBSDL = 'https://nobsdl.com';
let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) { console.log('[PASS] ' + name); passed += 1; }
  else { console.log('[FAIL] ' + name + (detail === undefined ? '' : '  (' + JSON.stringify(detail) + ')')); failed += 1; }
}

const CORS = {'access-control-allow-origin': '*'};

// Minimal GM_xmlhttpRequest on top of fetch (the userscript itself never calls
// fetch). It supports the arraybuffer responses used for Reddit images and
// exposes responseHeaders, like a real userscript manager does.
const GM_POLYFILL = `
  window.__gmRequests = [];
  window.GM_xmlhttpRequest = function (opts) {
    window.__gmRequests.push(opts.url);
    fetch(opts.url, {method: opts.method || 'GET', headers: opts.headers || {}})
      .then(async (r) => {
        const lines = [];
        r.headers.forEach((value, key) => lines.push(key + ': ' + value));
        const responseHeaders = lines.join('\\r\\n');
        if (opts.responseType === 'arraybuffer') {
          const buffer = await r.arrayBuffer();
          opts.onload({status: r.status, response: buffer, responseHeaders, responseText: ''});
        } else {
          const text = await r.text();
          opts.onload({status: r.status, responseText: text, response: text, responseHeaders});
        }
      })
      .catch((error) => opts.onerror && opts.onerror({error}));
  };
`;

const BASE_STYLE = `<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #fff; color: #111; }
  main { padding: 20px; }
  shreddit-post, shreddit-aspect-ratio, gallery-carousel, shreddit-player, shreddit-comment { display: block; }
  shreddit-post { width: 720px; margin: 0 0 28px; }
  shreddit-aspect-ratio { position: relative; width: 640px; height: 360px; overflow: hidden; }
  img { display: block; width: 640px; height: 360px; object-fit: cover; background: #ddd; }
  gallery-carousel [slot^="page-"] { display: block; }
  shreddit-comment { width: 720px; margin: 0 0 28px; padding: 12px; border: 1px solid #ddd; }
  shreddit-comment img { width: 320px; height: 180px; }
</style>`;

function htmlPage(body, title) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + (title || 'Reddit fixture') + '</title>'
    + BASE_STYLE + '</head><body><main>' + body + '</main></body></html>';
}

function imageResponse(route) {
  return route.fulfill({
    status: 200,
    headers: Object.assign({'content-type': 'image/jpeg'}, CORS),
    body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
}

function json(route, body, status) {
  return route.fulfill({
    status: status || 200,
    headers: Object.assign({'content-type': 'application/json'}, CORS),
    body: JSON.stringify(body),
  });
}

// Minimal reader for the store-only ZIP produced by the userscript. It checks
// the central directory and returns each local entry, so the test verifies the
// real archive rather than only the download filename.
function readZipEntries(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const end = buffer.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error('missing ZIP end record');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('missing ZIP central header');
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('missing ZIP local header');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'),
      method,
      data: buffer.subarray(dataStart, dataStart + size),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const shadow = (page, selector) => page.locator('#nobsdl-reddit-media').locator(selector);
const gmRequests = (page) => page.evaluate(() => (window.__gmRequests || []).slice());

async function setup(browser, options) {
  const settings = options || {};
  const context = await browser.newContext({
    viewport: settings.viewport || {width: 1280, height: 900},
    acceptDownloads: true,
  });
  const calls = [];
  const mediaRequests = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'nobsdl.com' || url.hostname === 'dl.nobsdl.com') {
      calls.push(url.pathname + url.search);
      if (settings.api) return settings.api(route, url, calls);
      return route.fulfill({
        status: 200,
        headers: Object.assign({'content-type': 'text/html; charset=utf-8'}, CORS),
        body: '<!doctype html><html><body><h1>NoBsDL</h1></body></html>',
      });
    }
    if (url.hostname === 'i.redd.it' || url.hostname === 'preview.redd.it') {
      mediaRequests.push(url.href);
      if (settings.media) return settings.media(route, url, mediaRequests);
      return imageResponse(route);
    }
    if (request.isNavigationRequest()) {
      return route.fulfill({
        status: 200,
        headers: {'content-type': 'text/html; charset=utf-8'},
        body: htmlPage(settings.body || '', settings.title),
      });
    }
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return {context, page, calls, mediaRequests, errors};
}

async function inject(page, gm) {
  if (gm) await page.addScriptTag({content: GM_POLYFILL});
  await page.addScriptTag({content: SCRIPT});
  await page.waitForTimeout(350);
}

const IMAGE_URL = 'https://www.reddit.com/r/nobsdl_test/comments/img1234/fixture_image_post/';
const GALLERY_URL = 'https://www.reddit.com/r/nobsdl_test/comments/gal1234/fixture_gallery_post/';
const VIDEO_URL = 'https://www.reddit.com/r/nobsdl_test/comments/vid1234/fixture_video_post/';
const COMMENT_URL = 'https://www.reddit.com/r/nobsdl_test/comments/cmt1234/fixture_comment_post/';
const SPA_A = 'https://www.reddit.com/r/nobsdl_test/comments/spa1234/spa_gallery_post/';
const SPA_B = 'https://www.reddit.com/r/nobsdl_test/comments/spa5678/spa_image_post/';
const CROSSPOST_URL = 'https://www.reddit.com/r/nobsdl_test/comments/outer1/fixture_crosspost/';

function imagePost() {
  return '<shreddit-post permalink="/r/nobsdl_test/comments/img1234/fixture_image_post/"'
    + ' post-type="image" post-title="Fixture Image Post">'
    + '<h1 slot="title">Fixture Image Post</h1>'
    + '<shreddit-aspect-ratio><img src="https://preview.redd.it/imgone.jpg?width=640&amp;format=pjpg&amp;auto=webp&amp;s=abc"'
    + ' width="1080" height="720" alt="Fixture image"></shreddit-aspect-ratio>'
    + '</shreddit-post>';
}

function galleryPost() {
  return '<shreddit-post permalink="/r/nobsdl_test/comments/gal1234/fixture_gallery_post/"'
    + ' post-type="gallery" post-title="Fixture Gallery Post">'
    + '<h1 slot="title">Fixture Gallery Post</h1>'
    + '<shreddit-aspect-ratio><gallery-carousel post-id="t3_gal1234">'
    + '<li slot="page-1"><img src="https://preview.redd.it/galleryone.jpg?width=1080&amp;format=pjpg&amp;auto=webp" width="1080" height="720" alt="First"></li>'
    + '<li slot="page-2"><img src="https://preview.redd.it/gallerytwo.jpg?width=1080&amp;format=pjpg&amp;auto=webp" width="1080" height="720" alt="Second"></li>'
    + '<li slot="page-3"><img src="https://preview.redd.it/gallerythree.jpg?width=1080&amp;format=pjpg&amp;auto=webp" width="1080" height="720" alt="Third"></li>'
    + '</gallery-carousel></shreddit-aspect-ratio>'
    + '</shreddit-post>';
}

function videoPost() {
  return '<shreddit-post permalink="/r/nobsdl_test/comments/vid1234/fixture_video_post/"'
    + ' post-type="video" post-title="Fixture Video Post">'
    + '<h1 slot="title">Fixture Video Post</h1>'
    + '<shreddit-aspect-ratio><shreddit-player post-id="t3_vid1234"'
    + ' src="https://v.redd.it/fixture/HLSPlaylist.m3u8?x=1">'
    + '<video width="1080" height="720"></video></shreddit-player></shreddit-aspect-ratio>'
    + '</shreddit-post>';
}

function compactVideoPost() {
  return '<article><shreddit-post permalink="/r/nobsdl_test/comments/vid1234/fixture_video_post/"'
    + ' post-type="video" post-title="Fixture Video Post">'
    + '<h1 slot="title" style="margin:0;height:72px">Fixture Video Post</h1>'
    + '<div style="display:none"><shreddit-aspect-ratio><shreddit-player post-id="t3_vid1234"'
    + ' src="https://v.redd.it/fixture/HLSPlaylist.m3u8"></shreddit-player></shreddit-aspect-ratio></div>'
    + '</shreddit-post></article>';
}

function portalVideo() {
  return '<div id="lightbox" style="position:relative;width:640px;height:360px">'
    + '<shreddit-player post-id="t3_port123"'
    + ' src="https://v.redd.it/fixture/HLSPlaylist.m3u8"></shreddit-player>'
    + '</div>';
}

function commentPost() {
  return '<shreddit-post permalink="/r/nobsdl_test/comments/cmt1234/fixture_comment_post/"'
    + ' post-type="link" post-title="Fixture Comment Post">'
    + '<h1 slot="title">Fixture Comment Post</h1>'
    + '<shreddit-aspect-ratio><img src="https://preview.redd.it/postimage.jpg?width=1080&amp;format=pjpg&amp;auto=webp"'
    + ' width="1080" height="720" alt="Post image"></shreddit-aspect-ratio>'
    + '</shreddit-post>'
    + '<shreddit-comment><div>Nice picture.</div>'
    + '<a href="https://preview.redd.it/commentimage.jpg?width=640&amp;format=pjpg&amp;auto=webp">'
    + '<img src="https://preview.redd.it/commentimage.jpg?width=320&amp;format=pjpg&amp;auto=webp"'
    + ' width="320" height="180" alt="Comment image"></a></shreddit-comment>';
}

const VIDEO_INFO = {
  title: 'Fixture Video Post',
  duration: 92,
  is_supporter: false,
  video_formats: {
    '720p': {format_id: 'dash-720', quality_edge: 720, size_mb: 12.4, resolution: '1280x720', tier: 'free'},
    '480p': {format_id: 'dash-480', quality_edge: 480, size_mb: 5.1, resolution: '854x480', tier: 'free'},
  },
  supporter_video_formats: {
    '1080p': {format_id: 'dash-1080', quality_edge: 1080, size_mb: 25, resolution: '1920x1080', tier: 'supporter'},
  },
  audio_formats: {
    '128': {format_id: null, bitrate: 128, size_mb: 1.5, tier: 'free'},
  },
};

function videoApi(polls) {
  let poll = 0;
  const script = polls || [
    {status: 'processing', phase: 'queued'},
    {status: 'processing', phase: 'connecting'},
    {status: 'processing', phase: 'downloading', progress: {downloaded_bytes: 50 * MB, total_bytes: 200 * MB, fraction: 0.25, speed_bps: 5 * MB, eta_seconds: 30}},
    {status: 'processing', phase: 'merging', progress: {fraction: 1}},
    {status: 'ready', direct_url: '/api/free-download/file/fixturejob1'},
  ];
  return (route, url) => {
    if (url.pathname === '/api/video-info') return json(route, VIDEO_INFO);
    if (url.pathname === '/download') return json(route, {ok: true, status: 'processing', status_url: '/api/free-download/status/fixturejob1'});
    if (url.pathname === '/api/free-download/status/fixturejob1') return json(route, script[Math.min(poll++, script.length - 1)]);
    if (url.pathname === '/api/free-download/file/fixturejob1') {
      return route.fulfill({
        status: 200,
        headers: Object.assign({
          'content-type': 'video/mp4',
          'content-disposition': 'attachment; filename="Fixture Video Post.mp4"',
        }, CORS),
        body: 'mp4-bytes',
      });
    }
    return route.fulfill({
      status: 200,
      headers: Object.assign({'content-type': 'text/html; charset=utf-8'}, CORS),
      body: '<!doctype html><html><body><h1>NoBsDL page</h1></body></html>',
    });
  };
}

// ── Fixtures that mirror the LIVE Reddit DOM ───────────────────────────────
// shreddit-post has an open shadow root with named slots; its media sits in a
// plain div[slot="post-media-container"]; Reddit's own lazy wrapper
// shreddit-async-loader is display:inline AND has a shadow root with a <slot>.
// Firefox places an absolutely-positioned child of such an inline host outside
// the post, so a badge must never be mounted there.
const LIVE_STYLE = '<style>'
  + 'shreddit-async-loader { display: inline; }'
  + 'shreddit-blurred-container { display: block; position: relative; width: 640px; height: 360px; }'
  + 'shreddit-player { width: 640px; height: 360px; }'
  + 'shreddit-embed { display: block; width: 640px; height: 360px; background: #223; }'
  + '.blur-overlay { position: absolute; inset: 0; z-index: 10; background: #888; color: #fff; }'
  + 'gallery-carousel { width: 640px; height: 360px; overflow: hidden; }'
  + '[slot="post-media-container"] { width: 640px; }'
  + 'shreddit-comments-page-ad, shreddit-ad-post { display: block; width: 640px; height: 360px; }'
  + '</style>';

const ATTACH_SHADOWS = '<script>(function () {'
  + 'window.__attachShadows = function () {'
  + '  document.querySelectorAll("shreddit-post").forEach(function (p) {'
  + '    if (p.shadowRoot) return;'
  + '    p.attachShadow({mode: "open"}).innerHTML = \'<slot name="title"></slot><slot name="post-media-container"></slot><slot name="expanded-video-player"></slot><slot></slot>\';'
  + '  });'
  + '  document.querySelectorAll("shreddit-async-loader").forEach(function (l) {'
  + '    if (l.shadowRoot) return;'
  + '    l.attachShadow({mode: "open"}).innerHTML = "<slot></slot>";'
  + '  });'
  + '};'
  + 'window.__attachShadows();'
  + '})();</script>';

const LIVE_GALLERY_URL = 'https://www.reddit.com/r/nobsdl_test/comments/lg12345/live_gallery_post/';
const LIVE_IMAGE_URL = 'https://www.reddit.com/r/nobsdl_test/comments/li12345/live_image_post/';
const LIVE_REDGIFS_URL = 'https://www.reddit.com/r/nobsdl_test/comments/rg12345/live_redgifs_post/';
const LIVE_STREAMABLE_URL = 'https://www.reddit.com/r/nobsdl_test/comments/st12345/live_streamable_post/';
const LIVE_ADS_URL = 'https://www.reddit.com/r/nobsdl_test/comments/ad12345/live_video_with_ads/';
const REDGIFS_SOURCE = 'https://www.redgifs.com/watch/blueredfoxes';
const STREAMABLE_SOURCE = 'https://streamable.com/abc12';

function livePage(count) {
  const pages = [];
  for (let i = 1; i <= count; i++) pages.push(livePageNode(i));
  return pages.join('');
}

// page-1: preview only (-v0- slug path); page-2: zoomable-img with the real
// i.redd.it original; page-3: both, the original must win.
function livePageNode(n) {
  const preview = '<img src="https://preview.redd.it/slug-name-v0-pic' + n + 'abc.jpg?width=640&amp;crop=smart&amp;auto=webp&amp;s=h' + n + '" width="640" height="360" alt="Page ' + n + '">';
  const original = '<zoomable-img><img src="https://i.redd.it/orig' + n + 'xyz.jpeg" width="640" height="360" alt="Page ' + n + '"></zoomable-img>';
  const body = n % 3 === 1 ? preview : n % 3 === 2 ? original : preview + original;
  return '<li slot="page-' + n + '">' + body + '</li>';
}

function liveGalleryPost(pageCount, options) {
  const settings = options || {};
  const carousel = '<gallery-carousel post-id="t3_lg12345">' + livePage(pageCount) + '</gallery-carousel>';
  const media = settings.noContainer
    ? '<shreddit-async-loader>' + carousel + '</shreddit-async-loader>'
    : '<div slot="post-media-container"><shreddit-async-loader>' + carousel + '</shreddit-async-loader></div>';
  return '<shreddit-post permalink="/r/nobsdl_test/comments/lg12345/live_gallery_post/" post-type="gallery"'
    + ' post-title="Live Gallery Post"><h1 slot="title">Live Gallery Post</h1>' + media + '</shreddit-post>';
}

function liveImagePost() {
  return '<shreddit-post permalink="/r/nobsdl_test/comments/li12345/live_image_post/" post-type="image"'
    + ' post-title="Live Image Post"><h1 slot="title">Live Image Post</h1>'
    + '<div slot="post-media-container"><shreddit-async-loader>'
    + '<img src="https://preview.redd.it/some-picture-v0-liveimg99.jpeg?width=640&amp;crop=smart&amp;auto=webp&amp;s=abc"'
    + ' width="640" height="360" alt="Live image"></shreddit-async-loader></div></shreddit-post>';
}

function liveEmbedPost(kind) {
  const redgifs = kind === 'redgifs';
  return '<shreddit-post permalink="/r/nobsdl_test/comments/' + (redgifs ? 'rg12345/live_redgifs_post' : 'st12345/live_streamable_post') + '/"'
    + ' post-type="link" post-title="' + (redgifs ? 'Live RedGIFs Post' : 'Live Streamable Post') + '"'
    + ' domain="' + (redgifs ? 'redgifs.com' : 'streamable.com') + '"'
    + ' content-href="' + (redgifs ? REDGIFS_SOURCE : STREAMABLE_SOURCE) + '">'
    + '<h1 slot="title">' + (redgifs ? 'Live RedGIFs Post' : 'Live Streamable Post') + '</h1>'
    + '<div slot="post-media-container">'
    + (redgifs
      ? '<shreddit-blurred-container><shreddit-embed providername="RedGIFs"></shreddit-embed><div class="blur-overlay">18+</div></shreddit-blurred-container>'
      : '<shreddit-embed providername="Streamable"></shreddit-embed>')
    + '</div></shreddit-post>';
}

function liveAdsPage() {
  return '<shreddit-post permalink="/r/nobsdl_test/comments/ad12345/live_video_with_ads/" post-type="video"'
    + ' post-title="Live Video With Ads"><h1 slot="title">Live Video With Ads</h1>'
    + '<div slot="post-media-container"><shreddit-player post-id="t3_ad12345" src="https://v.redd.it/real/HLSPlaylist.m3u8"></shreddit-player></div>'
    + '<shreddit-comments-page-ad><shreddit-player slot="expanded-video-player" post-id="t3_ad99999"'
    + ' src="https://v.redd.it/promoted/HLSPlaylist.m3u8"><video width="640" height="360"></video></shreddit-player></shreddit-comments-page-ad>'
    + '</shreddit-post>'
    + '<shreddit-ad-post><div slot="post-media-container"><shreddit-player post-id="t3_ad88888"'
    + ' src="https://v.redd.it/feedad/HLSPlaylist.m3u8"></shreddit-player></div></shreddit-ad-post>'
    + '<shreddit-post permalink="/r/nobsdl_test/comments/ad77777/promoted_image/" post-type="image" promoted'
    + ' post-title="Promoted"><h1 slot="title">Promoted</h1><div slot="post-media-container">'
    + '<img src="https://preview.redd.it/promo-v0-pr1.jpg?width=640&amp;auto=webp" width="640" height="360" alt="Promoted"></div></shreddit-post>';
}

async function liveSetup(browser, body, options) {
  const rig = await setup(browser, Object.assign({}, options || {}, {body: LIVE_STYLE + body + ATTACH_SHADOWS}));
  return rig;
}

// Geometry of every badge as the viewer sees it.
async function badgeReport(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.nobsdl-reddit-badge')).map((badge) => {
    badge.scrollIntoView({block: 'center'});
    const post = badge.closest('shreddit-post');
    const media = (post && post.querySelector('[slot="post-media-container"]')) || post;
    const box = badge.getBoundingClientRect();
    const area = media ? media.getBoundingClientRect() : {left: 0, top: 0, right: 0, bottom: 0};
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      text: badge.textContent,
      width: Math.round(box.width),
      height: Math.round(box.height),
      inside: Boolean(media) && box.left >= area.left - 2 && box.top >= area.top - 2
        && box.right <= area.right + 2 && box.bottom <= area.bottom + 2,
      topmost: top === badge,
      inAd: Boolean(badge.closest('shreddit-comments-page-ad, shreddit-ad-post, [slot="expanded-video-player"]')),
      host: badge.parentElement ? badge.parentElement.tagName.toLowerCase() : '',
    };
  }));
}

const badgesOk = (report) => report.length > 0 && report.every((b) => b.width > 40 && b.height > 0 && b.inside && b.topmost && !b.inAd);

async function main() {
  const browser = process.env.BROWSER === 'firefox'
    ? await playwright.firefox.launch({headless: true})
    : await playwright.chromium.launch({executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox']});

  // 1. A single Reddit image is saved straight from i.redd.it, with no NoBsDL
  // request, a readable filename and exactly one badge across rescans.
  {
    const {context, page, calls, errors} = await setup(browser, {body: imagePost()});
    await page.goto(IMAGE_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('image: one Save image badge is added', (await badges.count()) === 1, await badges.count());
    check('image: the badge names the action', (await badges.first().textContent()) === '⬇ Save image');
    await page.evaluate(() => document.body.append(document.createElement('div')));
    await page.waitForTimeout(500);
    check('image: rescans never duplicate the badge', (await badges.count()) === 1, await badges.count());
    check('image: nothing is sent while scanning', calls.length === 0 && (await gmRequests(page)).length === 0, calls);

    const downloadPromise = page.waitForEvent('download');
    await badges.first().click();
    const download = await downloadPromise;
    const sent = await gmRequests(page);
    check('image: the browser saves the original full-size file', download.suggestedFilename() === 'Fixture Image Post.jpg', download.suggestedFilename());
    check('image: i.redd.it is the only image request', JSON.stringify(sent) === JSON.stringify(['https://i.redd.it/imgone.jpg']), sent);
    check('image: no NoBsDL request is made for a still image', calls.length === 0, calls);
    check('image: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 2. A gallery opens a list of its real Reddit-hosted images; one image can
  // be saved on its own, and Save all saves every distinct page. A 404 on
  // i.redd.it falls back to the preview URL it came from.
  {
    const media = (route, url) => {
      if (url.hostname === 'i.redd.it' && url.pathname === '/galleryone.jpg') {
        return route.fulfill({status: 404, headers: CORS, body: 'gone'});
      }
      return imageResponse(route);
    };
    const {context, page, calls, errors} = await setup(browser, {body: galleryPost(), media});
    await page.goto(GALLERY_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('gallery: one gallery badge counts the real pages', (await badges.count()) === 1 && (await badges.first().textContent()) === '⬇ Save gallery · 3', await badges.allTextContents());
    check('gallery: the post image does not also get a still-image badge', (await badges.count()) === 1);

    await badges.first().click();
    await shadow(page, '.gallery-item').first().waitFor();
    check('gallery: the panel title is the post title', (await shadow(page, '.title').textContent()) === 'Fixture Gallery Post');
    check('gallery: the panel states the real page count', (await shadow(page, '.sub').textContent()) === '3 images found in this post');
    check('gallery: every page has one row', (await shadow(page, '.gallery-item').count()) === 3);
    check('gallery: rows are numbered honestly', JSON.stringify(await shadow(page, '.gallery-item .gi-meta strong').allTextContents()) === JSON.stringify(['Image 1 of 3', 'Image 2 of 3', 'Image 3 of 3']));
    check('gallery: Save all is actually offered', (await shadow(page, '.save-all').count()) === 1 && (await shadow(page, '.save-all').textContent()) === 'Save all (.zip)');
    check('gallery: opening the panel sends no NoBsDL request', calls.length === 0 && (await gmRequests(page)).length === 0, calls);
    check('gallery: no "Open post on NoBsDL" link (the site saves Reddit videos only)', (await shadow(page, '.foot a').count()) === 0);

    const downloads = [];
    page.on('download', (item) => downloads.push(item));
    await page.evaluate(() => { window.__gmRequests = []; });
    const firstDownload = page.waitForEvent('download');
    await shadow(page, '.gallery-item').first().locator('.btn').click();
    await firstDownload;
    check('gallery: a single page saves with its position in the name', downloads[0].suggestedFilename() === 'Fixture Gallery Post - 01.jpg', downloads[0].suggestedFilename());
    const firstSent = await gmRequests(page);
    check('gallery: the original is tried first, then the preview fallback', JSON.stringify(firstSent) === JSON.stringify([
      'https://i.redd.it/galleryone.jpg',
      'https://preview.redd.it/galleryone.jpg?width=1080&format=pjpg&auto=webp',
    ]), firstSent);
    check('gallery: the single save is confirmed in the panel', (await shadow(page, '.gallery-item').first().locator('.btn').textContent()) === 'Saved');

    await page.evaluate(() => { window.__gmRequests = []; });
    await shadow(page, '.save-all').click();
    await page.waitForFunction(() => {
      const root = document.getElementById('nobsdl-reddit-media');
      const status = root && root.shadowRoot && root.shadowRoot.querySelector('.status-line');
      return status && status.textContent === 'Saved 3 images in Fixture Gallery Post.zip.';
    }, null, {timeout: 15000});
    await page.waitForTimeout(300);
    check('gallery: Save all produces exactly one browser download', downloads.length === 2, downloads.map((item) => item.suggestedFilename()));
    check('gallery: Save all downloads one ZIP named after the post', downloads[1].suggestedFilename() === 'Fixture Gallery Post.zip', downloads[1].suggestedFilename());
    const zipBytes = fs.readFileSync(await downloads[1].path());
    const zipEntries = readZipEntries(zipBytes);
    check('gallery: the ZIP contains every real page once', JSON.stringify(zipEntries.map((entry) => entry.name)) === JSON.stringify([
      'Fixture Gallery Post - 01.jpg',
      'Fixture Gallery Post - 02.jpg',
      'Fixture Gallery Post - 03.jpg',
    ]), zipEntries.map((entry) => entry.name));
    check('gallery: the ZIP stores the real fetched bytes without inventing content',
      zipEntries.every((entry) => entry.method === 0 && entry.data.length === 4
        && entry.data[0] === 0xff && entry.data[1] === 0xd8 && entry.data[2] === 0xff && entry.data[3] === 0xd9),
      zipEntries.map((entry) => ({method: entry.method, length: entry.data.length})));
    const allSent = await gmRequests(page);
    check('gallery: Save all fetches each real page from Reddit', allSent.includes('https://i.redd.it/gallerytwo.jpg')
      && allSent.includes('https://i.redd.it/gallerythree.jpg'), allSent);
    check('gallery: the final status is honest', (await shadow(page, '.status-line').textContent()) === 'Saved 3 images in Fixture Gallery Post.zip.');
    await page.keyboard.press('Escape');
    check('gallery: Escape closes the panel', await shadow(page, '.panel').evaluate((node) => node.hidden));
    check('gallery: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 3. A Reddit video asks NoBsDL for the real formats, lets a free choice
  // start one async job, measures progress, keeps running when the panel is
  // closed, and finally hands the attachment to the browser.
  {
    const {context, page, calls, errors} = await setup(browser, {body: videoPost(), api: videoApi()});
    await page.goto(VIDEO_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('video: one video badge is added', (await badges.count()) === 1 && (await badges.first().textContent()) === '⬇ Download video', await badges.allTextContents());
    check('video: the native <video> fallback does not add a second badge', (await badges.count()) === 1);
    check('video: scanning the post sends nothing', calls.length === 0, calls);

    await badges.first().click();
    await shadow(page, '.card').first().waitFor();
    check('video: the canonical full post URL is sent once', calls.filter((call) => call.startsWith('/api/video-info')).length === 1
      && calls[0] === '/api/video-info?url=' + encodeURIComponent('https://www.reddit.com/r/nobsdl_test/comments/vid1234/fixture_video_post') + '&intent=mp4', calls);
    check('video: the real title and format count are shown', (await shadow(page, '.title').textContent()) === 'Fixture Video Post'
      && (await shadow(page, '.sub').textContent()) === 'Reddit · 1:32 · 4 formats', await shadow(page, '.sub').textContent());
    const cards = await shadow(page, '.card').evaluateAll((els) => els.map((el) => [el.querySelector('.q').textContent, el.classList.contains('locked')]));
    check('video: formats are ordered free-first, then by real quality', JSON.stringify(cards) === JSON.stringify([
      ['720p', false], ['480p', false], ['1080p', true], ['128 kbps', false],
    ]), cards);
    check('video: only the server-declared Supporter choice is locked', (await shadow(page, '.card.locked').count()) === 1);
    check('video: the lock note names the paid key', (await shadow(page, '.note').textContent()).includes('Locked choices need a paid NoBsDL Supporter key'));

    const popupPromise = context.waitForEvent('page');
    await shadow(page, '.card.locked').click();
    const popup = await popupPromise;
    await popup.waitForURL(NOBSDL + '/supporter').catch(() => {});
    check('video: a locked choice opens /supporter and starts no job', popup.url() === NOBSDL + '/supporter'
      && !calls.some((call) => call.startsWith('/download')), {url: popup.url(), calls});
    await popup.close();

    const downloadPromise = page.waitForEvent('download');
    await shadow(page, '.card:not(.locked)').first().click();
    await page.waitForFunction(() => {
      const root = document.getElementById('nobsdl-reddit-media');
      const line = root && root.shadowRoot && root.shadowRoot.querySelector('.status-line');
      return line && line.textContent.startsWith('25%');
    }, null, {timeout: 15000});
    check('video: measured progress is shown', (await shadow(page, '.status-line').textContent()) === '25% · 50.0 MB of 200 MB · 5.0 MB/s · ~30s left', await shadow(page, '.status-line').textContent());
    check('video: the exact chosen source format starts one async job', JSON.stringify(calls.filter((call) => call.startsWith('/download'))) === JSON.stringify([
      '/download?url=' + encodeURIComponent('https://www.reddit.com/r/nobsdl_test/comments/vid1234/fixture_video_post') + '&format=mp4&async=1&format_id=dash-720',
    ]), calls);

    await shadow(page, '.close').click();
    check('video: closing the panel hides it without cancelling', await shadow(page, '.panel').evaluate((node) => node.hidden));
    await badges.first().click();
    check('video: reopening during the job shows the running panel again', !(await shadow(page, '.panel').evaluate((node) => node.hidden))
      && (await shadow(page, '.track').count()) === 1);
    const download = await downloadPromise;
    check('video: the finished file is saved by the browser', download.suggestedFilename() === 'Fixture Video Post.mp4', download.suggestedFilename());
    await shadow(page, '.result-ok').waitFor();
    check('video: the result is shown after the file is ready', (await shadow(page, '.result-ok').textContent()).startsWith('✅ File ready'));
    check('video: status polling continued while the panel was closed', calls.filter((call) => call.startsWith('/api/free-download/status/')).length >= 4, calls);
    check('video: one click started exactly one job', calls.filter((call) => call.startsWith('/download')).length === 1, calls);
    check('video: the footer says NoBsDL prepares the MP4', (await shadow(page, '.foot span').first().textContent()) === 'MP4 video and audio are prepared by NoBsDL.');

    await shadow(page, '.row .btn').first().click();
    await shadow(page, '.card').first().waitFor();
    check('video: "Download another format" reuses the listed formats', calls.filter((call) => call.startsWith('/api/video-info')).length === 1, calls);
    check('video: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 3a. Compact/card feeds keep the player in a hidden subtree. The badge
  // must still be visible on the post, not inside a 0x0 host.
  {
    const {context, page, calls, errors} = await setup(browser, {body: compactVideoPost(), api: videoApi()});
    await page.goto(VIDEO_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('video compact: one badge is added to a hidden-player post', (await badges.count()) === 1
      && (await badges.first().textContent()) === '⬇ Download video', await badges.allTextContents());
    const box = await badges.first().boundingBox();
    check('video compact: the badge is actually visible', Boolean(box && box.width > 0 && box.height > 0), box);
    await badges.first().click();
    await shadow(page, '.card').first().waitFor();
    check('video compact: the visible badge starts the normal lookup', calls.filter((call) => call.startsWith('/api/video-info')).length === 1
      && calls[0] === '/api/video-info?url=' + encodeURIComponent('https://www.reddit.com/r/nobsdl_test/comments/vid1234/fixture_video_post') + '&intent=mp4', calls);
    check('video compact: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 3a2. A post that first rendered without a player must not gain a second
  // badge when Reddit lazy-loads the real player later.
  {
    const body = '<article><shreddit-post permalink="/r/nobsdl_test/comments/vid1234/fixture_video_post/"'
      + ' post-type="video" post-title="Fixture Video Post">'
      + '<h1 slot="title" style="margin:0;height:72px">Fixture Video Post</h1></shreddit-post></article>';
    const {context, page, calls, errors} = await setup(browser, {body, api: videoApi()});
    await page.goto(VIDEO_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('video lazy: a player-less post gets one fallback badge', (await badges.count()) === 1
      && (await badges.first().textContent()) === '⬇ Download video', await badges.allTextContents());
    await page.evaluate(() => {
      document.querySelector('shreddit-post').insertAdjacentHTML('beforeend',
        '<shreddit-aspect-ratio><shreddit-player post-id="t3_vid1234"'
        + ' src="https://v.redd.it/fixture/HLSPlaylist.m3u8"></shreddit-player></shreddit-aspect-ratio>');
    });
    await page.waitForTimeout(650);
    check('video lazy: the later player does not duplicate the badge', (await badges.count()) === 1, await badges.allTextContents());
    await badges.first().click();
    await shadow(page, '.card').first().waitFor();
    check('video lazy: the single badge still starts one lookup', calls.filter((call) => call.startsWith('/api/video-info')).length === 1, calls);
    check('video lazy: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 3b. A player moved outside a shreddit-post (lightbox/portal) still gets a
  // control from its own post-id, even on a feed URL.
  {
    const {context, page, calls, errors} = await setup(browser, {body: portalVideo(), api: videoApi()});
    await page.goto('https://www.reddit.com/r/nobsdl_test/');
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('video portal: a player outside a post gets one badge', (await badges.count()) === 1
      && (await badges.first().textContent()) === '⬇ Download video', await badges.allTextContents());
    await badges.first().click();
    await shadow(page, '.card').first().waitFor();
    check('video portal: the badge uses the player post-id', calls[0] === '/api/video-info?url=' + encodeURIComponent('https://www.reddit.com/comments/port123') + '&intent=mp4', calls);
    check('video portal: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 3c. An MP3 choice has no source format id; it must use audio_bitrate and
  // the server's attachment name, not a fabricated MP4 name.
  {
    const api = (route, url) => {
      if (url.pathname === '/api/video-info') return json(route, VIDEO_INFO);
      if (url.pathname === '/download') return json(route, {ok: true, status: 'processing', status_url: '/api/free-download/status/fixturejob1'});
      if (url.pathname === '/api/free-download/status/fixturejob1') {
        return json(route, {status: 'ready', direct_url: '/api/free-download/file/fixturejob1'});
      }
      if (url.pathname === '/api/free-download/file/fixturejob1') {
        return route.fulfill({
          status: 200,
          headers: Object.assign({
            'content-type': 'audio/mpeg',
            'content-disposition': 'attachment; filename="Fixture Video Post.mp3"',
          }, CORS),
          body: 'mp3-bytes',
        });
      }
      return route.fulfill({status: 404, headers: CORS, body: ''});
    };
    const {context, page, calls, errors} = await setup(browser, {body: videoPost(), api});
    await page.goto(VIDEO_URL);
    await inject(page, true);
    await page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(page, '.card').first().waitFor();
    const downloadPromise = page.waitForEvent('download');
    await shadow(page, '.card').filter({hasText: '128 kbps'}).click();
    const download = await downloadPromise;
    await shadow(page, '.result-ok').waitFor();
    check('mp3: the MP3 choice uses audio_bitrate, not a source format_id', JSON.stringify(calls.filter((call) => call.startsWith('/download'))) === JSON.stringify([
      '/download?url=' + encodeURIComponent('https://www.reddit.com/r/nobsdl_test/comments/vid1234/fixture_video_post') + '&format=mp3&async=1&audio_bitrate=128',
    ]), calls);
    check('mp3: the browser saves the server-named MP3', download.suggestedFilename() === 'Fixture Video Post.mp3', download.suggestedFilename());
    check('mp3: the result names the chosen audio format', (await shadow(page, '.sub').textContent()) === '128 kbps · MP3', await shadow(page, '.sub').textContent());
    check('mp3: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 4. Comment images get their own inline button, never a post-level badge
  // and never a duplicate button when the page is scanned again.
  {
    const {context, page, calls, errors} = await setup(browser, {body: commentPost(), title: 'Fixture Comment Post : r/nobsdl_test'});
    await page.goto(COMMENT_URL);
    await inject(page, true);
    const commentButtons = page.locator('shreddit-comment .nobsdl-reddit-comment-save');
    check('comment: one inline Save image button is added', (await commentButtons.count()) === 1, await commentButtons.count());
    check('comment: the comment image gets no post-level badge', (await page.locator('shreddit-comment .nobsdl-reddit-badge').count()) === 0);
    check('comment: the post image keeps its own badge', (await page.locator('.nobsdl-reddit-badge').count()) === 1);
    await page.evaluate(() => document.body.append(document.createElement('div')));
    await page.waitForTimeout(500);
    check('comment: rescans never duplicate the inline button', (await commentButtons.count()) === 1, await commentButtons.count());

    const downloadPromise = page.waitForEvent('download');
    await commentButtons.first().click();
    const download = await downloadPromise;
    const sent = await gmRequests(page);
    check('comment: the image is named after the post and marked as a comment', download.suggestedFilename() === 'Fixture Comment Post comment.jpg', download.suggestedFilename());
    check('comment: the original comment image is fetched from i.redd.it', sent.includes('https://i.redd.it/commentimage.jpg'), sent);
    check('comment: saving a comment image sends nothing to NoBsDL', calls.length === 0, calls);
    check('comment: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 5. SPA navigation: media added after load is picked up, and an open panel
  // is closed when the URL changes (it was about the previous post).
  {
    const {context, page, calls, errors} = await setup(browser, {body: ''});
    await page.goto(SPA_A);
    await inject(page, true);
    check('spa: an empty feed gets no badges', (await page.locator('.nobsdl-reddit-badge').count()) === 0);

    await page.evaluate((gallery) => {
      const feed = document.querySelector('main');
      feed.insertAdjacentHTML('beforeend', gallery);
    }, galleryPost().replace('gal1234', 'spa1234').replace('fixture_gallery_post', 'spa_gallery_post'));
    await page.locator('.nobsdl-reddit-badge').first().waitFor({timeout: 4000});
    check('spa: dynamically inserted media is found', (await page.locator('.nobsdl-reddit-badge').count()) === 1);
    await page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(page, '.gallery-item').first().waitFor();
    check('spa: the gallery panel opens for the new post', !(await shadow(page, '.panel').evaluate((node) => node.hidden)));

    await page.evaluate((nextUrl) => {
      history.pushState({}, '', nextUrl);
      document.querySelector('main').insertAdjacentHTML('beforeend',
        '<shreddit-post permalink="/r/nobsdl_test/comments/spa5678/spa_image_post/" post-type="image" post-title="Second Post">'
        + '<h1 slot="title">Second Post</h1><shreddit-aspect-ratio>'
        + '<img src="https://preview.redd.it/spatwo.jpg?width=1080&amp;format=pjpg&amp;auto=webp" width="1080" height="720">'
        + '</shreddit-aspect-ratio></shreddit-post>');
    }, SPA_B);
    await page.waitForFunction(() => document.getElementById('nobsdl-reddit-media').shadowRoot.querySelector('.panel').hidden, null, {timeout: 5000});
    check('spa: a stale panel closes after the URL changes', await shadow(page, '.panel').evaluate((node) => node.hidden));
    check('spa: the newly inserted image gets its badge', (await page.locator('.nobsdl-reddit-badge').count()) === 2, await page.locator('.nobsdl-reddit-badge').allTextContents());
    check('spa: navigating sends no NoBsDL request on its own', calls.length === 0, calls);
    check('spa: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 5b. Reddit can remove and re-render a post (back/forward, feed recycling).
  // The fresh DOM must get a working video badge again, not be suppressed by a
  // URL remembered from the previous render.
  {
    const {context, page, calls, errors} = await setup(browser, {body: videoPost(), api: videoApi()});
    await page.goto(VIDEO_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('rerender: the first video DOM gets a badge', (await badges.count()) === 1);
    const freshVideo = videoPost();
    await page.evaluate(() => document.querySelector('main').replaceChildren());
    await page.waitForTimeout(500);
    check('rerender: removing the post removes its badge', (await badges.count()) === 0);
    await page.evaluate((html) => { document.querySelector('main').innerHTML = html; }, freshVideo);
    await page.waitForTimeout(650);
    check('rerender: a fresh post DOM gets the video badge again', (await badges.count()) === 1
      && (await badges.first().textContent()) === '⬇ Download video', await badges.allTextContents());
    await page.evaluate(() => {
      const old = document.querySelector('shreddit-post shreddit-aspect-ratio');
      const wrap = document.createElement('div');
      wrap.innerHTML = '<shreddit-aspect-ratio><shreddit-player post-id="t3_vid1234"'
        + ' src="https://v.redd.it/fixture/HLSPlaylist.m3u8"></shreddit-player></shreddit-aspect-ratio>';
      old.replaceWith(wrap.firstElementChild);
    });
    await page.waitForTimeout(650);
    check('rerender: replacing only the media host restores the badge', (await badges.count()) === 1
      && (await badges.first().textContent()) === '⬇ Download video', await badges.allTextContents());
    await badges.first().click();
    await shadow(page, '.card').first().waitFor();
    check('rerender: the new badge still starts the normal lookup', calls.length === 1
      && calls[0].startsWith('/api/video-info?url='), calls);
    check('rerender: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 6. Without GM_xmlhttpRequest, the panel explains the limit and links to
  // the post on NoBsDL; it never falls back to page fetch.
  {
    const {context, page, calls, errors} = await setup(browser, {body: videoPost(), api: videoApi()});
    await page.goto(VIDEO_URL);
    await inject(page, false);
    await page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(page, '.error').waitFor();
    check('no-gm: the panel explains the missing userscript transport', (await shadow(page, '.error').textContent()).includes('GM_xmlhttpRequest'));
    const link = shadow(page, '.row a.btn');
    check('no-gm: the fallback link opens the full post on NoBsDL', (await link.getAttribute('href')) === NOBSDL + '/reddit-downloader?url=' + encodeURIComponent('https://www.reddit.com/r/nobsdl_test/comments/vid1234/fixture_video_post'));
    check('no-gm: the fallback link opens a new tab safely', (await link.getAttribute('target')) === '_blank' && (await link.getAttribute('rel')) === 'noopener noreferrer');
    check('no-gm: the footer promises no request was made', (await shadow(page, '.foot span').textContent()) === 'No request was made from this page.');
    check('no-gm: no network request is attempted', calls.length === 0, calls);
    check('no-gm: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 7. A stale source format: the backend asks for another choice, so the
  // panel offers Refresh formats and never silently retries the same job.
  {
    const api = (route, url) => {
      if (url.pathname === '/api/video-info') return json(route, VIDEO_INFO);
      if (url.pathname === '/download') {
        return json(route, {
          error: 'format_unavailable',
          detail: 'This exact format is not available anymore. Please choose another quality.',
          suggested_action: 'choose_another_quality',
          supporter_cta: false,
        }, 409);
      }
      return route.fulfill({status: 404, headers: CORS, body: ''});
    };
    const {context, page, calls, errors} = await setup(browser, {body: videoPost(), api});
    await page.goto(VIDEO_URL);
    await inject(page, true);
    await page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(page, '.card').first().waitFor();
    await shadow(page, '.card:not(.locked)').first().click();
    await shadow(page, '.body .error').waitFor();
    check('stale format: the backend message is shown', (await shadow(page, '.body .error').textContent()).includes('not available anymore'));
    check('stale format: Refresh formats is offered', (await shadow(page, '.row .btn').textContent()) === 'Refresh formats');
    check('stale format: no Supporter CTA when the backend says supporter_cta=false', (await shadow(page, 'a[href="https://nobsdl.com/supporter"]').count()) === 0);
    await shadow(page, '.row .btn').click();
    await shadow(page, '.card').first().waitFor();
    check('stale format: refreshing re-reads formats without resubmitting the job', calls.filter((call) => call.startsWith('/api/video-info')).length === 2
      && calls.filter((call) => call.startsWith('/download')).length === 1, calls);
    check('stale format: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // 8. A crossposted player whose post-id differs from the surrounding post
  // uses the media post's own id rather than mislabelling the outer post.
  {
    const body = '<shreddit-post permalink="/r/nobsdl_test/comments/outer1/fixture_crosspost/"'
      + ' post-type="video" post-title="Outer crosspost">'
      + '<h1 slot="title">Outer crosspost</h1>'
      + '<shreddit-aspect-ratio><shreddit-player post-id="t3_media9"'
      + ' src="https://v.redd.it/other/HLSPlaylist.m3u8"></shreddit-player></shreddit-aspect-ratio>'
      + '</shreddit-post>';
    const {context, page, calls, errors} = await setup(browser, {body, api: videoApi()});
    await page.goto(CROSSPOST_URL);
    await inject(page, true);
    await page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(page, '.card').first().waitFor();
    check('crosspost: the player post-id identifies the media post', calls[0] === '/api/video-info?url=' + encodeURIComponent('https://www.reddit.com/comments/media9') + '&intent=mp4', calls);
    check('crosspost: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // ── Live-DOM regression tests (Chrome and Firefox) ───────────────────────

  // L1. Gallery in the live structure: slot container > inline async-loader
  // (own shadow root) > carousel. The badge must be a real, visible, topmost
  // box inside the media container, show the page count, and the panel must
  // prefer the i.redd.it originals found anywhere in a page node.
  {
    const media = (route, url) => imageResponse(route);
    const {context, page, calls, mediaRequests, errors} = await liveSetup(browser, liveGalleryPost(3), {media});
    await page.goto(LIVE_GALLERY_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    const report = await badgeReport(page);
    check('live gallery: exactly one badge', report.length === 1, report);
    check('live gallery: the badge is a real box inside the media container and topmost', badgesOk(report), report);
    check('live gallery: the badge sits on the plain block container, not the inline loader', report[0] && report[0].host === 'div', report);
    check('live gallery: the label is "Save gallery" with the real count', (await badges.first().textContent()) === '⬇ Save gallery · 3', await badges.allTextContents());
    const look = await badges.first().evaluate((node) => {
      const css = getComputedStyle(node);
      return {image: css.backgroundImage, color: css.color, size: css.fontSize, weight: css.fontWeight, min: css.minHeight, radius: css.borderTopLeftRadius};
    });
    check('live gallery: the badge uses the brand gradient, white 13px/800 text and a 36px minimum',
      /linear-gradient/.test(look.image) && look.color === 'rgb(255, 255, 255)' && look.size === '13px'
      && look.weight === '800' && look.min === '36px' && look.radius === '10px', look);

    await badges.first().click();
    await shadow(page, '.gallery-item').first().waitFor();
    check('live gallery: three rows', (await shadow(page, '.gallery-item').count()) === 3);
    await page.evaluate(() => { window.__gmRequests = []; });
    const zip = page.waitForEvent('download');
    await shadow(page, '.save-all').click();
    await zip;
    await page.waitForTimeout(300);
    const sent = await gmRequests(page);
    check('live gallery: a preview-only page derives the i.redd.it original from its -v0- id', sent.includes('https://i.redd.it/pic1abc.jpg'), sent);
    check('live gallery: a page with a zoomable-img uses the i.redd.it URL', sent.includes('https://i.redd.it/orig2xyz.jpeg'), sent);
    check('live gallery: when a page has both, the original wins over the preview', sent.includes('https://i.redd.it/orig3xyz.jpeg')
      && !sent.some((entry) => entry.includes('preview.redd.it/slug-name-v0-pic3abc')), sent);
    check('live gallery: nothing goes to NoBsDL', calls.length === 0, calls);
    check('live gallery: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L1r. Reddit's router (live bug 2026-10-21, Firefox): a document-level
  // click handler turned the hidden download anchor into a pushState to the
  // blob: URL, which closed the panel and lost every later download. Mimic
  // that router; each row must still download and the panel must stay open.
  {
    const media = (route, url) => imageResponse(route);
    const {context, page, errors} = await liveSetup(browser, liveGalleryPost(3), {media});
    await page.goto(LIVE_GALLERY_URL);
    await page.evaluate(() => {
      window.__routed = [];
      document.addEventListener('click', (event) => {
        const anchor = event.target && event.target.closest && event.target.closest('a[href]');
        if (!anchor) return;
        event.preventDefault();
        window.__routed.push(anchor.href);
        try { history.pushState({}, '', anchor.href); } catch (_) { /* cross-origin */ }
      }, true);
    });
    await inject(page, true);
    await page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(page, '.gallery-item').first().waitFor();
    const downloads = [];
    page.on('download', (item) => downloads.push(item.suggestedFilename()));
    const rows = shadow(page, '.gallery-item .btn');
    for (let i = 0; i < 3; i++) {
      const next = page.waitForEvent('download', {timeout: 8000}).catch(() => null);
      await rows.nth(i).click({timeout: 3000}).catch(() => {});
      await next;
      await page.waitForTimeout(400);
    }
    check('router: every gallery row downloads its own file', JSON.stringify(downloads) === JSON.stringify([
      'Live Gallery Post - 01.jpg', 'Live Gallery Post - 02.jpg', 'Live Gallery Post - 03.jpg',
    ]), downloads);
    check('router: the download anchor never reaches the page router', (await page.evaluate(() => window.__routed.length)) === 0,
      await page.evaluate(() => window.__routed));
    check('router: the page URL is unchanged', page.url() === LIVE_GALLERY_URL, page.url());
    check('router: the panel stays open after the saves', await shadow(page, '.gallery-list').isVisible());
    check('router: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L1b. A gallery with no block container around it, only the inline loader:
  // the badge must land on a visible block host instead.
  {
    const {context, page, errors} = await liveSetup(browser, liveGalleryPost(2, {noContainer: true}));
    await page.goto(LIVE_GALLERY_URL);
    await inject(page, true);
    const report = await badgeReport(page);
    check('live gallery (loader only): a badge is mounted', report.length === 1, report);
    check('live gallery (loader only): the badge is not on the inline loader', report[0] && report[0].host !== 'shreddit-async-loader', report);
    const box = await page.locator('.nobsdl-reddit-badge').first().boundingBox();
    const post = await page.locator('shreddit-post').first().boundingBox();
    check('live gallery (loader only): the badge is inside the post and visible', Boolean(box && post && box.width > 40
      && box.x >= post.x - 2 && box.y >= post.y - 2 && box.x + box.width <= post.x + post.width + 2 && box.y + box.height <= post.y + post.height + 2), {box, post});
    const top = await page.evaluate(() => {
      const badge = document.querySelector('.nobsdl-reddit-badge');
      badge.scrollIntoView({block: 'center'});
      const rect = badge.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === badge;
    });
    check('live gallery (loader only): the badge is the topmost element at its centre', top);
    check('live gallery (loader only): no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L2. The count follows Reddit hydrating the carousel; the label is
  // refreshed on a later scan and the badge is never duplicated.
  {
    const {context, page, errors} = await liveSetup(browser, liveGalleryPost(1));
    await page.goto(LIVE_GALLERY_URL);
    await inject(page, true);
    const badges = page.locator('.nobsdl-reddit-badge');
    check('gallery count: starts at the one page that is rendered', (await badges.first().textContent()) === '⬇ Save gallery · 1', await badges.allTextContents());
    await page.evaluate((html) => document.querySelector('gallery-carousel').insertAdjacentHTML('beforeend', html), [2, 3, 4, 5].map(livePageNode).join(''));
    await page.waitForFunction(() => /· 5$/.test((document.querySelector('.nobsdl-reddit-badge') || {}).textContent || ''), null, {timeout: 4000}).catch(() => {});
    check('gallery count: the label is updated after hydration', (await badges.first().textContent()) === '⬇ Save gallery · 5', await badges.allTextContents());
    check('gallery count: still exactly one badge', (await badges.count()) === 1);
    check('gallery count: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L3. Image post in the live structure: the badge is visible, and the save
  // goes to the i.redd.it original derived from the -v0- id, asking for a
  // non-WebP image. A WebP answer is still saved as-is.
  {
    const accepts = [];
    const media = (route, url) => {
      if (route.request().resourceType() === 'fetch') accepts.push(route.request().headers()['accept'] || '');
      if (url.pathname === '/liveimg99.jpeg') {
        return route.fulfill({status: 200, headers: Object.assign({'content-type': 'image/webp'}, CORS), body: Buffer.from('RIFFxxxxWEBP')});
      }
      return imageResponse(route);
    };
    const {context, page, calls, errors} = await liveSetup(browser, liveImagePost(), {media});
    await page.goto(LIVE_IMAGE_URL);
    await inject(page, true);
    const report = await badgeReport(page);
    check('live image: one visible topmost badge inside the media container', report.length === 1 && badgesOk(report), report);
    check('live image: the label is "Save image"', report[0] && report[0].text === '⬇ Save image', report);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.nobsdl-reddit-badge').first().click();
    const download = await downloadPromise;
    const sent = await gmRequests(page);
    check('live image: the original is derived from the -v0- id (not the slug path, not the preview)',
      JSON.stringify(sent) === JSON.stringify(['https://i.redd.it/liveimg99.jpeg']), sent);
    check('live image: the request asks for JPEG/PNG/GIF, not WebP or AVIF',
      accepts.length === 1 && /^image\/jpeg,image\/png,image\/gif,\*\/\*;q=0\.1$/.test(accepts[0]), accepts);
    check('live image: a WebP answer is still saved, named for what it is', download.suggestedFilename() === 'Live Image Post.webp', download.suggestedFilename());
    check('live image: nothing goes to NoBsDL', calls.length === 0, calls);
    check('live image: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L4r. RedGIFs posts (adult, behind a blur) go to NSFWDL, the adult
  // downloader (owner 2026-10-21): one "Download on NSFWDL" badge that opens
  // nsfwdl.com/redgifs-downloader#url=<RedGIFs link> in a new tab, and
  // nothing is sent to NoBsDL.
  {
    const {context, page, calls, errors} = await liveSetup(browser, liveEmbedPost('redgifs'));
    await page.goto(LIVE_REDGIFS_URL);
    await inject(page, true);
    const report = await badgeReport(page);
    check('redgifs: exactly one badge, "Download on NSFWDL"', report.length === 1 && report[0].text === '⬇ Download on NSFWDL', report);
    check('redgifs: the badge is a real box inside the media container and topmost', badgesOk(report), report);
    check('redgifs: the badge says it opens NSFWDL in a new tab',
      /NSFWDL/.test(await page.locator('.nobsdl-reddit-badge').first().getAttribute('aria-label') || ''));
    const popup = context.waitForEvent('page', {timeout: 5000}).catch(() => null);
    await page.locator('.nobsdl-reddit-badge').first().click();
    const tab = await popup;
    check('redgifs: a click opens NSFWDL\'s RedGIFs page with the link prefilled',
      tab && tab.url() === 'https://nsfwdl.com/redgifs-downloader#url=' + encodeURIComponent(REDGIFS_SOURCE), tab && tab.url());
    check('redgifs: the Reddit tab stays where it is', page.url() === LIVE_REDGIFS_URL, page.url());
    check('redgifs: nothing goes to NoBsDL', calls.length === 0, calls);
    check('redgifs: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L4. Streamable link posts get a Video badge from the post's own
  // content-href, and NoBsDL is asked about the EXTERNAL URL, never the
  // Reddit post URL.
  for (const kind of ['streamable']) {
    const source = kind === 'redgifs' ? REDGIFS_SOURCE : STREAMABLE_SOURCE;
    const redditUrl = kind === 'redgifs' ? LIVE_REDGIFS_URL : LIVE_STREAMABLE_URL;
    const api = (route, url) => {
      if (url.pathname === '/api/video-info') {
        return json(route, {
          title: 'External clip',
          duration: 12,
          video_formats: {
            '270p': {format_id: 'sd', quality_edge: 270, size_mb: 1.2, resolution: '480x270', tier: 'free'},
            '1080p': {format_id: 'hd', quality_edge: 1080, size_mb: 9.5, resolution: '1920x1080', tier: 'free'},
          },
        });
      }
      if (url.pathname === '/download') return json(route, {ok: true, status: 'processing', status_url: '/api/free-download/status/fixturejob1'});
      if (url.pathname === '/api/free-download/status/fixturejob1') {
        return json(route, {status: 'ready', filename: 'External clip.mp4', direct_url: '/api/free-download/file/fixturejob1'});
      }
      if (url.pathname === '/api/free-download/file/fixturejob1') {
        return route.fulfill({status: 200, headers: Object.assign({'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="External clip.mp4"'}, CORS), body: 'mp4'});
      }
      return route.fulfill({status: 404, headers: CORS, body: ''});
    };
    const {context, page, calls, errors} = await liveSetup(browser, liveEmbedPost(kind), {api});
    await page.goto(redditUrl);
    await inject(page, true);
    const report = await badgeReport(page);
    check('embed ' + kind + ': exactly one Video badge', report.length === 1 && report[0].text === '⬇ Download video', report);
    check('embed ' + kind + ': the badge is a real box inside the media container and topmost', badgesOk(report), report);
    check('embed ' + kind + ': no still-image badge is added on the thumbnail', report.length === 1);
    check('embed ' + kind + ': scanning sends nothing', calls.length === 0, calls);
    await page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(page, '.card').first().waitFor();
    check('embed ' + kind + ': /api/video-info is asked about the external URL',
      JSON.stringify(calls) === JSON.stringify(['/api/video-info?url=' + encodeURIComponent(source) + '&intent=mp4']), calls);
    check('embed ' + kind + ': the real external formats are listed', (await shadow(page, '.card .q').allTextContents()).join(',').includes('1080p'));
    check('embed ' + kind + ': no "Open post on NoBsDL" link is offered for an embed', (await shadow(page, '.foot a').count()) === 0);
    const downloadPromise = page.waitForEvent('download');
    await shadow(page, '.card').first().click();
    const download = await downloadPromise;
    const jobs = calls.filter((call) => call.startsWith('/download'));
    check('embed ' + kind + ': the job is started for the external URL with the chosen format_id',
      jobs.length === 1 && jobs[0].startsWith('/download?url=' + encodeURIComponent(source) + '&format=mp4&async=1&format_id='), jobs);
    check('embed ' + kind + ': the browser saves the file', download.suggestedFilename() === 'External clip.mp4', download.suggestedFilename());
    check('embed ' + kind + ': no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L4b. Lookalike and non-https content-href values never produce a badge.
  {
    const bad = ['http://www.redgifs.com/watch/blueredfoxes', 'https://redgifs.com.evil.com/watch/blueredfoxes',
      'https://user@streamable.com/abc12', 'https://www.redgifs.com:8443/watch/blueredfoxes', 'https://streamable.com/e/abc12'];
    const body = bad.map((href, i) => '<shreddit-post permalink="/r/nobsdl_test/comments/bad' + (1000 + i) + '/x/" post-type="link"'
      + ' post-title="Bad ' + i + '" content-href="' + href + '"><h1 slot="title">Bad ' + i + '</h1>'
      + '<div slot="post-media-container"><shreddit-embed></shreddit-embed></div></shreddit-post>').join('');
    const {context, page, errors} = await liveSetup(browser, body);
    await page.goto('https://www.reddit.com/r/nobsdl_test/');
    await inject(page, true);
    check('embed: rejected hosts, http, userinfo, ports and non-video paths get no badge', (await page.locator('.nobsdl-reddit-badge').count()) === 0, await page.locator('.nobsdl-reddit-badge').allTextContents());
    check('embed: no page errors for rejected links', errors.length === 0, errors);
    await context.close();
  }

  // L4c. GIF posts (live 2026-10-21): Reddit plays an i.redd.it .gif with its
  // video player, but NoBsDL's backend rejects GIF posts. The post gets one
  // "Save GIF" badge that saves the original .gif straight from i.redd.it.
  {
    const gifUrl = 'https://www.reddit.com/r/nobsdl_test/comments/gf12345/live_gif_post/';
    const body = '<main><shreddit-post permalink="/r/nobsdl_test/comments/gf12345/live_gif_post/" post-type="gif"'
      + ' post-title="Live GIF Post" content-href="https://i.redd.it/gifabc123.gif"><h1 slot="title">Live GIF Post</h1>'
      + '<div slot="post-media-container"><shreddit-blurred-container><shreddit-player post-id="t3_gf12345"'
      + ' src="https://v.redd.it/gifabc/HLSPlaylist.m3u8"><video width="640" height="360"></video></shreddit-player>'
      + '</shreddit-blurred-container></div></shreddit-post></main>';
    const media = (route) => route.fulfill({status: 200, headers: Object.assign({'content-type': 'image/gif'}, CORS), body: Buffer.from('GIF89a;')});
    const {context, page, calls, errors} = await liveSetup(browser, body, {media});
    await page.goto(gifUrl);
    await inject(page, true);
    const report = await badgeReport(page);
    check('gif: exactly one badge, labelled Save GIF', report.length === 1 && report[0].text === '⬇ Save GIF', report);
    check('gif: the badge is a real box inside the media container and topmost', badgesOk(report), report);
    check('gif: no Download video badge on a GIF post', (await page.locator('.nobsdl-reddit-badge[data-nobsdl-kind=video]').count()) === 0);
    await page.evaluate(() => { window.__gmRequests = []; });
    const download = page.waitForEvent('download');
    await page.locator('.nobsdl-reddit-badge').first().click();
    const file = await download;
    check('gif: the original .gif is fetched from i.redd.it', JSON.stringify(await gmRequests(page)) === JSON.stringify(['https://i.redd.it/gifabc123.gif']), await gmRequests(page));
    check('gif: the file is saved as .gif', /\.gif$/.test(file.suggestedFilename()), file.suggestedFilename());
    check('gif: nothing goes to NoBsDL', calls.length === 0, calls);
    check('gif: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L4d. Media rendered late (live 2026-10-21): on a post page the post's
  // parent is <main>; a badge must never float there. In a feed card the
  // <article> fallback is fine until the media container appears, then the
  // badge moves onto the media.
  {
    const late = (wrapper) => '<' + wrapper + '><shreddit-post permalink="/r/nobsdl_test/comments/rg12345/live_redgifs_post/"'
      + ' post-type="link" post-title="Late RedGIFs" content-href="' + REDGIFS_SOURCE + '"><h1 slot="title">Late RedGIFs</h1>'
      + '</shreddit-post></' + wrapper + '>';
    const addMedia = () => {
      const post = document.querySelector('shreddit-post');
      const box = document.createElement('div');
      box.setAttribute('slot', 'post-media-container');
      box.style.cssText = 'display:block;width:640px;height:360px';
      box.innerHTML = '<shreddit-embed providername="RedGIFs"></shreddit-embed>';
      post.append(box);
    };
    for (const wrapper of ['main', 'article']) {
      const {context, page, errors} = await liveSetup(browser, late(wrapper));
      await page.goto(LIVE_REDGIFS_URL);
      await inject(page, true);
      await page.waitForTimeout(400);
      const early = await page.evaluate(() => Array.from(document.querySelectorAll('.nobsdl-reddit-badge')).map((b) => b.parentElement.tagName.toLowerCase()));
      check('late media (' + wrapper + '): no badge ever sits on <main>', !early.includes('main'), early);
      await page.evaluate(addMedia);
      await page.waitForTimeout(3200);
      const report = await badgeReport(page);
      check('late media (' + wrapper + '): one NSFWDL badge once the media exists', report.length === 1 && report[0].text === '⬇ Download on NSFWDL', report);
      check('late media (' + wrapper + '): the badge is on the media container, inside it and topmost', report[0] && report[0].host === 'div' && badgesOk(report), report);
      check('late media (' + wrapper + '): no page errors', errors.length === 0, errors);
      await context.close();
    }
  }

  // L5. Ads: nothing inside a promoted comments-page video, a feed ad card or
  // a promoted post is ever touched; the real video above them still is.
  {
    const {context, page, errors} = await liveSetup(browser, liveAdsPage());
    await page.goto(LIVE_ADS_URL);
    await inject(page, true);
    await page.waitForTimeout(700);
    const report = await badgeReport(page);
    check('ads: exactly one badge (the real video)', report.length === 1 && report[0].text === '⬇ Download video', report);
    check('ads: no badge inside an ad container', report.every((b) => !b.inAd), report);
    check('ads: the real video badge is visible, inside its media container and topmost', badgesOk(report), report);
    check('ads: the promoted post gets no badge',
      (await page.locator('shreddit-post[promoted] .nobsdl-reddit-badge').count()) === 0
      && (await page.locator('shreddit-ad-post .nobsdl-reddit-badge, shreddit-comments-page-ad .nobsdl-reddit-badge').count()) === 0);
    check('ads: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L6. Infinite scroll keeps the DOM mutating constantly; scans must still
  // run (at least about once a second), not wait for the mutations to stop.
  {
    const {context, page, errors} = await liveSetup(browser, '');
    await page.goto(LIVE_GALLERY_URL);
    await inject(page, true);
    await page.evaluate((html) => {
      window.__churn = setInterval(() => document.querySelector('main').append(document.createElement('i')), 30);
      setTimeout(() => {
        document.querySelector('main').insertAdjacentHTML('beforeend', html);
        window.__attachShadows();
      }, 200);
      setTimeout(() => clearInterval(window.__churn), 5000);
    }, liveGalleryPost(2));
    const start = Date.now();
    await page.waitForSelector('.nobsdl-reddit-badge', {timeout: 3000}).catch(() => {});
    const waited = Date.now() - start;
    const stillChurning = await page.evaluate(() => document.querySelectorAll('main > i').length > 20);
    check('scan: a badge appears within ~2s while the DOM is still mutating continuously',
      (await page.locator('.nobsdl-reddit-badge').count()) === 1 && waited < 2600 && stillChurning, {waited, stillChurning});
    check('scan: no page errors', errors.length === 0, errors);
    await context.close();
  }

  // L7. Video files go through the browser's own download handling, like
  // images (owner 2026-10-21: the browser's "always ask where to save" setting
  // must apply to videos too). Even when the manager offers GM_download it is
  // not used; the anchor never reaches Reddit's router; the tab stays put.
  {
    const polls = [{status: 'ready', filename: 'Fixture Video Post.mp4', direct_url: '/api/free-download/file/fixturejob1'}];
    const rig = await setup(browser, {body: videoPost(), api: videoApi(polls)});
    await rig.page.addInitScript(() => {
      window.__gmDownloads = 0;
      window.GM_download = () => { window.__gmDownloads += 1; };
      window.__routed = [];
      document.addEventListener('click', (event) => {
        const anchor = event.target && event.target.closest && event.target.closest('a[href]');
        if (!anchor || !/free-download/.test(anchor.href)) return;
        event.preventDefault();
        window.__routed.push(anchor.href);
      }, true);
    });
    await rig.page.goto(VIDEO_URL);
    await inject(rig.page, true);
    await rig.page.locator('.nobsdl-reddit-badge').first().click();
    await shadow(rig.page, '.card').first().waitFor();
    const downloadPromise = rig.page.waitForEvent('download', {timeout: 8000}).catch(() => null);
    await shadow(rig.page, '.card:not(.locked)').first().click();
    const download = await downloadPromise;
    check('video save: the browser downloads the file itself (its save settings apply)',
      download && download.suggestedFilename() === 'Fixture Video Post.mp4', download && download.suggestedFilename());
    check('video save: GM_download is not used', (await rig.page.evaluate(() => window.__gmDownloads)) === 0);
    check('video save: the download link never reaches the page router', (await rig.page.evaluate(() => window.__routed.length)) === 0,
      await rig.page.evaluate(() => window.__routed));
    check('video save: the Reddit tab is not navigated', rig.page.url() === VIDEO_URL, rig.page.url());
    check('video save: no page errors', rig.errors.length === 0, rig.errors);
    await rig.context.close();
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
