// Browser-level verification for nobsdl-reddit-media.user.js.
// Every Reddit page, Reddit image host and NoBsDL API answer is fulfilled in
// process; no public site or NoBsDL endpoint is contacted. GM_xmlhttpRequest is
// provided by a small test polyfill on top of the intercepted network.
//
// Run after `npm install` (Playwright is a dev dependency):
//   CHROME_BIN=/usr/bin/google-chrome node tests/test_nobsdl_reddit_userscript_browser.js
'use strict';

const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');

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

async function main() {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox']});

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
    check('gallery: one gallery badge counts the real pages', (await badges.count()) === 1 && (await badges.first().textContent()) === '⬇ Gallery · 3', await badges.allTextContents());
    check('gallery: the post image does not also get a still-image badge', (await badges.count()) === 1);

    await badges.first().click();
    await shadow(page, '.gallery-item').first().waitFor();
    check('gallery: the panel title is the post title', (await shadow(page, '.title').textContent()) === 'Fixture Gallery Post');
    check('gallery: the panel states the real page count', (await shadow(page, '.sub').textContent()) === '3 images found in this post');
    check('gallery: every page has one row', (await shadow(page, '.gallery-item').count()) === 3);
    check('gallery: rows are numbered honestly', JSON.stringify(await shadow(page, '.gallery-item .gi-meta strong').allTextContents()) === JSON.stringify(['Image 1 of 3', 'Image 2 of 3', 'Image 3 of 3']));
    check('gallery: Save all is actually offered', (await shadow(page, '.save-all').count()) === 1 && (await shadow(page, '.save-all').textContent()) === 'Save all');
    check('gallery: opening the panel sends no NoBsDL request', calls.length === 0 && (await gmRequests(page)).length === 0, calls);

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
      return status && status.textContent === 'Saved all 3 images.';
    }, null, {timeout: 15000});
    await page.waitForTimeout(300);
    check('gallery: Save all saves every page exactly once', downloads.length === 4, downloads.length);
    const saveAllNames = downloads.slice(1).map((item) => item.suggestedFilename());
    check('gallery: Save all uses distinct numbered filenames', JSON.stringify(saveAllNames) === JSON.stringify([
      'Fixture Gallery Post - 01.jpg',
      'Fixture Gallery Post - 02.jpg',
      'Fixture Gallery Post - 03.jpg',
    ]), saveAllNames);
    const allSent = await gmRequests(page);
    check('gallery: Save all fetches each real page from Reddit', allSent.includes('https://i.redd.it/gallerytwo.jpg')
      && allSent.includes('https://i.redd.it/gallerythree.jpg'), allSent);
    check('gallery: the final status is honest', (await shadow(page, '.status-line').textContent()) === 'Saved all 3 images.');
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
    check('video: one video badge is added', (await badges.count()) === 1 && (await badges.first().textContent()) === '⬇ Video', await badges.allTextContents());
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

  // 3b. An MP3 choice has no source format id; it must use audio_bitrate and
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
      && (await badges.first().textContent()) === '⬇ Video', await badges.allTextContents());
    await page.evaluate(() => {
      const old = document.querySelector('shreddit-post shreddit-aspect-ratio');
      const wrap = document.createElement('div');
      wrap.innerHTML = '<shreddit-aspect-ratio><shreddit-player post-id="t3_vid1234"'
        + ' src="https://v.redd.it/fixture/HLSPlaylist.m3u8"></shreddit-player></shreddit-aspect-ratio>';
      old.replaceWith(wrap.firstElementChild);
    });
    await page.waitForTimeout(650);
    check('rerender: replacing only the media host restores the badge', (await badges.count()) === 1
      && (await badges.first().textContent()) === '⬇ Video', await badges.allTextContents());
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

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
