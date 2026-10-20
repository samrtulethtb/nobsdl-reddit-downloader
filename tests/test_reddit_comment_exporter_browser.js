// Browser-level verification for reddit-comment-exporter.user.js.
// The Reddit page is a synthetic DOM fixture fulfilled in process. The script
// makes no network requests, so only the fixture URL is ever loaded.
//
// Run after `npm install` (Playwright is a dev dependency):
//   CHROME_BIN=/usr/bin/google-chrome node tests/test_reddit_comment_exporter_browser.js
'use strict';

const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'reddit-comment-exporter.user.js'), 'utf8');
const POST_URL = 'https://www.reddit.com/r/test/comments/abc123/a_title/';
let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log('[PASS] ' + name);
    passed += 1;
  } else {
    console.log('[FAIL] ' + name + (detail === undefined ? '' : '  (' + JSON.stringify(detail) + ')'));
    failed += 1;
  }
}

function fixture(options) {
  const post = options.post === false ? '' : `
    <shreddit-post id="t3_abc123"
      permalink="/r/test/comments/abc123/a_title/"
      post-title="Test post"
      author="alice"
      comment-count="6">
      <h1 slot="title">Test post</h1>
    </shreddit-post>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test post : r/test</title>
  <style>
    body { margin: 0; padding: 24px; font: 15px/1.45 system-ui, sans-serif; color: #111; background: #fff; }
    shreddit-post, shreddit-comment, details { display: block; }
    shreddit-post { margin-bottom: 20px; padding: 12px; border: 1px solid #ddd; }
    shreddit-comment { margin: 8px 0 8px 24px; padding: 8px; border-left: 2px solid #ddd; }
    .hidden-by-test { display: none; }
  </style>
</head>
<body>
  <main>
    ${post}
    <section id="comment-tree">
      <shreddit-comment thingid="t1_c1" postid="t3_abc123" author="alice" depth="0" score="12" created="2026-10-20T02:30:26.587000+0000" permalink="/r/test/comments/abc123/a_title/comment/c1/" content-type="text">
        <details open>
          <summary>Comment from alice</summary>
          <div id="t1_c1-comment-rtjson-content" slot="comment"><p>Top <strong>comment</strong>.</p><p>Second line.</p></div>
          <div id="comment-children">
            <shreddit-comment thingid="t1_c2" postid="t3_abc123" parentid="t1_c1" author="bob" depth="1" score="3" created="2026-10-20T03:00:00.000Z" permalink="/r/test/comments/abc123/a_title/comment/c2/" content-type="text">
              <details open>
                <summary>Comment from bob</summary>
                <div id="t1_c2-comment-rtjson-content" slot="comment"><p>Reply <script type="text/plain">bad-text</script>text with <b>markup</b> &amp; symbols.</p></div>
                <div id="comment-children">
                  <shreddit-comment thingid="t1_c3" postid="t3_abc123" parentid="t1_c2" author="carol" depth="2" score="1" created-timestamp="1729391234" permalink="/r/test/comments/abc123/a_title/comment/c3/" content-type="text" is-submitter="">
                    <details open>
                      <summary>Comment from carol</summary>
                      <div id="t1_c3-comment-rtjson-content" slot="comment"><p>Deep &lt;reply&gt;</p></div>
                    </details>
                  </shreddit-comment>
                </div>
              </details>
            </shreddit-comment>
          </div>
        </details>
      </shreddit-comment>

      <shreddit-comment thingid="t1_c4" postid="t3_abc123" author="[deleted]" depth="0" score="0" permalink="/r/test/comments/abc123/a_title/comment/c4/" content-type="text">
        <details open>
          <summary>Deleted comment</summary>
          <div id="t1_c4-comment-rtjson-content" slot="comment"><p>[deleted]</p></div>
        </details>
      </shreddit-comment>

      <shreddit-comment thingid="t1_c5" postid="t3_abc123" author="dave" depth="0" score="5" permalink="/r/test/comments/abc123/a_title/comment/c5/" content-type="text" collapsed="">
        <details>
          <summary>Collapsed comment</summary>
          <div id="t1_c5-comment-rtjson-content" slot="comment"><p>Hidden body</p></div>
        </details>
      </shreddit-comment>

      <shreddit-comment thingid="t1_c6" postid="t3_abc123" author="erin" depth="0" score="2" permalink="/r/test/comments/abc123/a_title/comment/c6/" content-type="image">
        <details open>
          <summary>Image comment</summary>
          <div id="t1_c6-comment-rtjson-content" slot="comment"><figure><img alt="Comment Image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" width="20" height="20"></figure></div>
        </details>
      </shreddit-comment>

      <!-- Duplicate node: the exporter must count a thingid once. -->
      <shreddit-comment thingid="t1_c1" postid="t3_abc123" author="alice" depth="0" score="12" permalink="/r/test/comments/abc123/a_title/comment/c1/" content-type="text">
        <details open><summary>Duplicate</summary><div id="t1_c1-comment-rtjson-content" slot="comment"><p>Duplicate body must not appear.</p></div></details>
      </shreddit-comment>
    </section>
  </main>
</body>
</html>`;
}

function emptyPostFixture() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>No comments : r/test</title>
  <style>shreddit-post { display: block; }</style></head><body>
  <shreddit-post id="t3_abc123" permalink="/r/test/comments/abc123/a_title/" post-title="No comments" author="alice" comment-count="0"></shreddit-post>
  </body></html>`;
}

async function openFixture(browser, url, html) {
  const context = await browser.newContext({
    viewport: {width: 1200, height: 900},
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
  await page.route('https://www.reddit.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: html,
  }));
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.addScriptTag({content: SCRIPT});
  await page.waitForTimeout(1200);
  return {context, page, errors, requests};
}

const shadow = (page, selector) => page.locator('#reddit-comment-exporter-root').locator(selector);

async function uiState(page) {
  return page.evaluate(() => {
    const host = document.getElementById('reddit-comment-exporter-root');
    const root = host && host.shadowRoot;
    const button = root && root.querySelector('.rce-button');
    const overlay = root && root.querySelector('.rce-overlay');
    const panel = root && root.querySelector('.rce-panel');
    const summary = root && root.querySelector('.rce-summary');
    const reported = root && root.querySelector('.rce-reported');
    const note = root && root.querySelector('.rce-note');
    return {
      host: Boolean(host),
      button: button ? {
        hidden: button.hidden,
        text: button.textContent,
        aria: button.getAttribute('aria-label'),
        rect: button.getBoundingClientRect().toJSON(),
      } : null,
      panelHidden: panel ? panel.hidden : null,
      overlayHidden: overlay ? overlay.hidden : null,
      summary: summary ? summary.textContent : null,
      reported: reported ? reported.textContent : null,
      note: note ? note.textContent : null,
    };
  });
}

async function downloadFormat(page, format) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    shadow(page, `.rce-format[data-format="${format}"]`).click(),
  ]);
  const file = await download.path();
  return {
    filename: download.suggestedFilename(),
    text: file ? fs.readFileSync(file, 'utf8') : '',
    failure: await download.failure(),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
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
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && text[index + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
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

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    {
      const {context, page, errors, requests} = await openFixture(browser, POST_URL, fixture({}));

      const initial = await uiState(page);
      check('page: the exporter adds a UI host', initial.host === true);
      check('page: the button is visible', Boolean(initial.button && !initial.button.hidden));
      check('page: the button counts unique loaded comments, not duplicate nodes',
        Boolean(initial.button && /· 6\b/.test(initial.button.text)), initial.button);
      check('page: the button has an accessible label',
        Boolean(initial.button && /6 loaded comments/.test(initial.button.aria || '')), initial.button);
      check('page: the button has a visible size',
        Boolean(initial.button && initial.button.rect.width > 0 && initial.button.rect.height > 0), initial.button);

      await shadow(page, '.rce-button').click();
      await page.waitForTimeout(100);
      const open = await uiState(page);
      check('panel: opening the button reveals the dialog', open.overlayHidden === false && open.panelHidden === false);
      check('panel: the summary reports the loaded count', open.summary === '6 comments loaded from this page.', open.summary);
      check('panel: the summary reports Reddit\'s own count separately', open.reported === 'Reddit reports 6 comments on this post.', open.reported);
      check('panel: the limitation is stated', /Only comments currently loaded/.test(open.note || ''), open.note);

      const json = await downloadFormat(page, 'json');
      check('json: one browser download is produced', json.failure === null && json.filename === 'reddit-comments-test-abc123.json', json);
      const parsed = JSON.parse(json.text);
      check('json: the payload has the expected shape',
        parsed.format === 'reddit-comments' && parsed.version === 1 && parsed.count === 6 && parsed.comments.length === 6,
        parsed);
      check('json: the post metadata is the page post',
        parsed.post.id === 't3_abc123'
        && parsed.post.url === 'https://www.reddit.com/r/test/comments/abc123/a_title'
        && parsed.post.title === 'Test post'
        && parsed.post.subreddit === 'test'
        && parsed.post.author === 'alice'
        && parsed.post.comment_count === 6,
        parsed.post);
      const byId = Object.fromEntries(parsed.comments.map((comment) => [comment.id, comment]));
      check('json: the duplicate thingid is exported once',
        parsed.comments.filter((comment) => comment.id === 't1_c1').length === 1
        && !parsed.comments.some((comment) => /Duplicate body/.test(comment.body)));
      check('json: top-level parent ids point at the post',
        byId.t1_c1.parent_id === 't3_abc123' && byId.t1_c4.parent_id === 't3_abc123');
      check('json: replies keep their parent ids and depths',
        byId.t1_c2.parent_id === 't1_c1' && byId.t1_c2.depth === 1
        && byId.t1_c3.parent_id === 't1_c2' && byId.t1_c3.depth === 2);
      check('json: the parent body does not swallow child comments',
        byId.t1_c1.body === 'Top comment.\nSecond line.'
        && byId.t1_c2.body === 'Reply text with markup & symbols.'
        && byId.t1_c3.body === 'Deep <reply>',
        [byId.t1_c1.body, byId.t1_c2.body, byId.t1_c3.body]);
      check('json: collapsed comments still export their body',
        byId.t1_c5.body === 'Hidden body' && byId.t1_c5.collapsed === true,
        byId.t1_c5);
      check('json: image-only comments have an empty body',
        byId.t1_c6.body === '' && byId.t1_c6.content_type === 'image',
        byId.t1_c6);
      check('json: deleted comments are marked',
        byId.t1_c4.is_deleted === true && byId.t1_c4.author === '[deleted]' && byId.t1_c4.body === '[deleted]');
      check('json: the submitter flag is exported',
        byId.t1_c1.is_submitter === true && byId.t1_c3.is_submitter === true && byId.t1_c2.is_submitter === false);
      check('json: the Unix timestamp fallback is parsed',
        byId.t1_c3.created_utc === 1729391234 && byId.t1_c3.created_iso === '2024-10-20T02:27:14.000Z',
        byId.t1_c3);
      check('json: the page does not execute the script text it exports',
        byId.t1_c2.body.indexOf('bad-text') === -1);

      const csv = await downloadFormat(page, 'csv');
      check('csv: one browser download is produced', csv.failure === null && csv.filename === 'reddit-comments-test-abc123.csv', csv);
      const rows = parseCsv(csv.text);
      check('csv: the header is complete', rows[0].length === 13 && rows[0][0] === 'id' && rows[0][12] === 'body', rows[0]);
      check('csv: each unique comment has one row', rows.length === 7, rows.length);
      const csvC1 = rows.find((row) => row[0] === 't1_c1');
      const csvC5 = rows.find((row) => row[0] === 't1_c5');
      const csvC6 = rows.find((row) => row[0] === 't1_c6');
      check('csv: newlines are preserved inside a quoted cell',
        Boolean(csvC1 && csvC1[12] === 'Top comment.\nSecond line.'), csvC1);
      check('csv: a collapsed body is present', Boolean(csvC5 && csvC5[12] === 'Hidden body'), csvC5);
      check('csv: an image-only body is empty', Boolean(csvC6 && csvC6[12] === ''), csvC6);
      check('csv: booleans are explicit', Boolean(csvC1 && csvC1[7] === 'true' && csvC1[8] === 'false'));

      const markdown = await downloadFormat(page, 'markdown');
      check('markdown: one browser download is produced',
        markdown.failure === null && markdown.filename === 'reddit-comments-test-abc123.md', markdown);
      check('markdown: the title and source are escaped and named',
        /^# Reddit comments: Test post$/m.test(markdown.text)
        && markdown.text.includes('- Post: https://www.reddit.com/r/test/comments/abc123/a_title'));
      check('markdown: replies are visibly nested',
        /^  - \*\*u\/bob\*\*/m.test(markdown.text) && /^    - \*\*u\/carol\*\*/m.test(markdown.text));
      check('markdown: literal angle brackets are escaped',
        markdown.text.includes('> Deep &lt;reply&gt;'));
      check('markdown: the page note is present',
        markdown.text.includes('Only comments currently loaded in the page are included.'));

      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      const closed = await uiState(page);
      check('panel: Escape closes the dialog', closed.overlayHidden === true && closed.panelHidden === true);

      await shadow(page, '.rce-button').click();
      await page.waitForTimeout(50);
      await shadow(page, '.rce-overlay').click({position: {x: 2, y: 2}});
      await page.waitForTimeout(50);
      const overlayClosed = await uiState(page);
      check('panel: clicking outside the panel closes it',
        overlayClosed.overlayHidden === true && overlayClosed.panelHidden === true);

      await page.evaluate(() => {
        const tree = document.getElementById('comment-tree');
        const node = document.createElement('shreddit-comment');
        node.setAttribute('thingid', 't1_c7');
        node.setAttribute('postid', 't3_abc123');
        node.setAttribute('author', 'frank');
        node.setAttribute('depth', '0');
        node.setAttribute('score', '9');
        node.setAttribute('permalink', '/r/test/comments/abc123/a_title/comment/c7/');
        node.setAttribute('content-type', 'text');
        node.innerHTML = '<details open><summary>New</summary><div id="t1_c7-comment-rtjson-content" slot="comment"><p>Newly loaded comment.</p></div></details>';
        tree.append(node);
      });
      await page.waitForTimeout(1200);
      const afterAppend = await uiState(page);
      check('dynamic: a newly loaded comment updates the button',
        Boolean(afterAppend.button && /· 7\b/.test(afterAppend.button.text)), afterAppend.button);

      await page.evaluate(() => {
        history.pushState({}, '', '/r/test/');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.waitForTimeout(1200);
      const onFeed = await uiState(page);
      check('spa: leaving the post hides the exporter', onFeed.button === null || onFeed.button.hidden === true);

      await page.evaluate(() => {
        history.pushState({}, '', '/r/test/comments/zzz999/other/');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.waitForTimeout(1200);
      const onOtherPost = await uiState(page);
      check('spa: another post does not reuse comments from the previous post',
        onOtherPost.button === null || onOtherPost.button.hidden === true);

      await page.evaluate(() => {
        history.pushState({}, '', '/r/test/comments/abc123/a_title/');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.waitForTimeout(1200);
      const back = await uiState(page);
      check('spa: returning to the post restores the count',
        Boolean(back.button && !back.button.hidden && /· 7\b/.test(back.button.text)), back.button);

      check('network: the userscript makes no external requests',
        requests.every((url) => url.startsWith('https://www.reddit.com/')), requests);
      check('page: no uncaught page errors', errors.length === 0, errors);
      await context.close();
    }

    {
      const {context, page, errors} = await openFixture(browser, 'https://www.reddit.com/r/test/', fixture({post: false}));
      const feed = await uiState(page);
      check('feed: no export button appears', feed.button === null || feed.button.hidden === true);
      check('feed: no page errors', errors.length === 0, errors);
      await context.close();
    }

    {
      const {context, page, errors} = await openFixture(browser, POST_URL, emptyPostFixture());
      const empty = await uiState(page);
      check('empty: a post without loaded comments has no visible button',
        empty.button === null || empty.button.hidden === true);
      check('empty: no page errors', errors.length === 0, errors);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
