# NoBsDL Reddit Media Downloader (userscript)

A standalone userscript for Reddit's current web interface. It adds a small
NoBsDL control to Reddit images, galleries, videos and comment images:

- **Images** are saved directly from Reddit's image hosts.
- **Galleries** open a list of the real pages, with individual Save buttons and
  Save all (.zip).
- **Videos** open a panel with the MP4/MP3 formats NoBsDL returns for that post,
  measured progress, and an in-page hand-off of the finished file.
- **Comment images** get an inline Save image button next to the image or link.
- **Comment export** adds an **Export comments · N** button on post pages that
  saves the comments already loaded in the page as JSON, CSV or Markdown. It
  runs locally and sends nothing (see [Comment export](#comment-export)).

It is independent of NoBsDL's all-in-one userscript
(`nobsdl-download-button.user.js`); it does not replace or modify that script.

NoBsDL's interaction promise applies to everyone: **No popups. No forced
redirects. No fake download buttons. Just download.**

> **Verification status (2026-10-20):** the script passes 18 unit tests and 96
> Chromium browser checks against synthetic Reddit DOM fixtures with mocked
> Reddit CDN and NoBsDL responses. A live logged-in Reddit probe in Chrome also
> verified visible `⬇ Video` badges on a post page, the normal card feed and
> the compact feed (including the post-level compact fallback). That probe did
> not run inside a userscript manager, so a live end-to-end NoBsDL video job
> through the userscript is still a manual QA item. Use [QA.md](QA.md) before
> calling it production-ready.
>
> **Comment export (added in 1.1.0, 2026-10-21):** verified only against
> synthetic Reddit DOM in Chromium (see [Tests](#tests)). Its behaviour inside a
> real userscript manager on live Reddit threads is a manual QA item (QA.md
> section 11).

## Install

1. Install a userscript manager that provides `GM_xmlhttpRequest`, such as
   [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Add `nobsdl-reddit-media.user.js`:
   - install it from the raw file in this repository (userscript managers
     recognize `*.user.js` URLs), or
   - create a new userscript in the manager and paste this file, or
   - open the file directly if your manager installs local `.user.js` files.
3. Open any `reddit.com` page. The controls appear on supported media; there is
   no separate toolbar button.

The script has no build step and no runtime dependencies.

These files come from the NoBsDL project's ``
directory; this repository keeps the standalone Reddit userscript and its tests
together so it can be installed and reviewed on its own.

## Supported media

| Reddit content | What appears | What it does | Network used |
| --- | --- | --- | --- |
| Single image post (`shreddit-post` with a Reddit-hosted image) | `⬇ Save image` badge on the media | Saves the largest real variant discoverable in the page, preferring the original `i.redd.it` file | `i.redd.it`, then `preview.redd.it` as fallback |
| Gallery (`gallery-carousel` with `page-N` images) | `⬇ Gallery · N` badge | Opens a panel listing every Reddit-hosted page found; Save saves one image, Save all (.zip) downloads one local ZIP | `i.redd.it` / `preview.redd.it` only |
| Video post (`shreddit-player`, `shreddit-player-2`, `shreddit-video-player`, or a native `<video>` in a video post) | `⬇ Video` badge | Opens the NoBsDL format panel and runs the async download flow | `nobsdl.com` only after the panel is opened |
| Comment image (Reddit-hosted image link or embedded image in `shreddit-comment`) | Inline `⬇ Save image` button | Saves that comment image | `i.redd.it` / `preview.redd.it` only |

Only still images served from `i.redd.it` or `preview.redd.it` are handled.
External hosts (for example Imgur) are deliberately left alone. Gallery items
must already be present in Reddit's DOM; if Reddit has not rendered a page yet,
the script cannot invent it.

### File names

- Image: the cleaned post title, plus ` - 01`, ` - 02`, … for galleries.
- Gallery ZIP: the cleaned post title plus `.zip`; the numbered image names
  above are the entries inside the archive.
- Comment image: the page/post title plus ` comment`.
- Extension: from the image response's `Content-Type`, then the URL, otherwise
  `.jpg`.
- Unsafe characters are removed and names are capped at roughly 120
  characters.
- Video file names come from NoBsDL's `Content-Disposition` response; the
  script does not rename the server's file.

## Comment export

Since version 1.1.0 the same script also exports the comments of a Reddit post
to a file, so there is one script to install.

- On a current-Reddit post page that has comments loaded, an **Export comments
  · N** button appears at the bottom-right. It is hidden on feeds and on posts
  with no loaded comments.
- `N` is the number of unique comment records found in the page (unique
  `thingid`s of `shreddit-comment` elements that belong to this post). It is
  not Reddit's total comment count; the dialog shows both.
- The button opens a dialog (focus is kept inside it; Escape, the close button
  or a click outside closes it) with **JSON**, **CSV** and **Markdown**.
- **Loaded comments only.** The export reads only what Reddit has already
  rendered in the page. It never clicks "more comments", never expands
  anything and never requests more comments. Scroll or expand the thread first
  if you want a larger file.
- **Runs locally.** The comment export makes no network request, uses none of
  the script's NoBsDL/image transport, reads no cookies or browser storage and
  stores nothing. The file is built in the page and saved as one browser
  download from a `Blob` URL. Nothing is sent to NoBsDL.

Each comment record has `id`, `parent_id`, `depth`, `author`, `body` (plain
text), `score`, `created_utc`, `created_iso`, `permalink`, `is_submitter`,
`is_deleted`, `is_removed`, `collapsed` and `content_type` where the page
provides them; missing values are `null` (JSON) or empty (CSV), never invented.
Comments that only contain an image or video have an empty `body`; no comment
media is downloaded by the export.

| Format | Content |
| --- | --- |
| JSON | `format: "reddit-comments"`, `version: 1`, export time, a note about the loaded-only scope, the post (id, URL, title, subreddit, author, Reddit's comment count), `count`, and a flat `comments` array whose `parent_id` and `depth` rebuild the thread |
| CSV | One row per comment, 13 columns: `id, parent_id, depth, author, score, created_utc, created_iso, is_submitter, is_deleted, is_removed, collapsed, permalink, body`. Quotes and line breaks are CSV-escaped; text cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'` so a spreadsheet does not run them as a formula |
| Markdown | A header (post URL, loaded count, Reddit's count, export time, the loaded-only note), then one bullet per comment indented by `depth` with author, score, time, an OP marker and a permalink where available, and the body in a blockquote with `<`, `>` and `&` escaped |

File names: `reddit-comments-<subreddit>-<post-id>.json`, `.csv` or `.md` (unsafe
characters replaced, base capped at 100 characters).

Placement: the export button lives in its own Shadow DOM host
(`#nobsdl-reddit-comment-export-root`), one z-index level below the media
panel and toast host, so an open media panel covers it. The media script's
toast is bottom-centre; on viewports narrower than 900 px the export button is
lifted above that toast zone so the two never overlap.

Limits: only the current `shreddit-comment` / `shreddit-post` structure with its
`thingid`, `postid`, `parentid`, `depth`, `created` / `created-timestamp`,
`score`, `author` and `permalink` attributes is read; Old Reddit and
third-party clients are not supported, and Reddit can change its DOM at any
time. Collapsed comments are exported if their element exists. Deleted and
removed comments are exported as Reddit displays them, with `is_deleted` /
`is_removed` flags.

## Network behaviour

Nothing is sent while scrolling or scanning the page.

### Images and galleries

1. The userscript manager fetches the original `https://i.redd.it/<path>` when
   the URL is a `.jpg`/`.jpeg`/`.png`/`.gif` preview.
2. If Reddit refuses that original (for example HTTP 404), the script retries
   the exact `preview.redd.it` URL that Reddit itself displayed.
3. The bytes are saved as a browser download. No NoBsDL request is made.

A single image or a single gallery row produces exactly one browser download.
For a multi-image gallery, **Save all (.zip)** fetches the pages and builds one
store-only ZIP locally (the images are already compressed), so the browser also
receives exactly one download. This avoids the browser's separate
multi-download permission prompt. The individual row buttons still save one
image at a time.

If Reddit returns 403, the toast reports it and offers an **Open image** link;
there is no bypass.

### Videos

Opening the video panel performs exactly one canonical lookup:

```
GET https://nobsdl.com/api/video-info?url=<canonical Reddit post URL>&intent=mp4
```

Choosing a free format starts the existing async contract:

```
GET /download?url=<post>&format=mp4&async=1&format_id=<source format id>
GET /download?url=<post>&format=mp3&async=1&audio_bitrate=128|256|320
```

MP3 entries normally have no source `format_id`; the script then sends the
chosen `audio_bitrate`, which is what the existing `/download` MP3 contract
uses.

The script polls `status_url` about once per second (up to 20 minutes), reports
only measured bytes/speed/ETA, and gives up after five consecutive poll
failures. When the status is `ready`, it opens `direct_url` so the browser
receives the attachment. The script validates that both URLs are same-origin
`/api/free-download/...` paths; it will not follow an arbitrary URL.

The panel can be closed while a job runs; the script keeps polling and saves
the file when it is ready. The script has no cancel request, so closing the tab
ends the UI even if the server job continues.

### When the manager has no GM transport

If `GM_xmlhttpRequest` / `GM.xmlHttpRequest` is unavailable, the script does not
fall back to the page's `fetch` or `XMLHttpRequest`.

- Video: the panel explains the limitation and links to
  `https://nobsdl.com/reddit-downloader?url=<canonical post URL>`.
- Images: the save fails with an honest error toast and an **Open image** link.

Nothing is fetched through the page's own network APIs in either case.

## Supporter formats

The userscript never decides tiers, prices or limits. It displays exactly what
`/api/video-info` returns:

- `video_formats` → free MP4 choices;
- `supporter_video_formats` → locked choices;
- `audio_formats` → the 128 / 256 / 320 kbps MP3 entries the API offers.

Clicking a locked choice opens `https://nobsdl.com/supporter` in a new tab and
starts no job. An active Supporter session is recognised by the backend
(`is_supporter`); the script then shows those formats as available. Passes,
prices and checkout are handled only on the NoBsDL site.

No popups, forced redirects or fake download buttons are a property of NoBsDL
for everyone, not a paid feature.

## Privacy

- No analytics, telemetry, tracking pixels or stored history.
- The script does not read or write `localStorage`, `sessionStorage` or
  `document.cookie`.
- Comment export runs entirely in the page: no request, nothing uploaded, and
  the comments are only written to the file you choose to download.
- No request is made until you click a control (video format requests start
  only when the video panel is opened).
- Only the canonical Reddit post URL (plus the chosen format id or MP3 bitrate
  for a download) is sent to NoBsDL.
- Image bytes come from Reddit's own image hosts.
- All links opened by the script use `target="_blank"` with
  `rel="noopener noreferrer"` and `referrerPolicy="no-referrer"`.
- Requests go through your userscript manager. The script itself does not read
  or store cookies; whether the manager includes its `nobsdl.com` cookie is a
  manager setting.

## Limitations

- **Live UI verification is pending.** See the status note above and
  [QA.md](QA.md).
- Reddit's current `shreddit-*` web components are the target. Old Reddit and
  third-party clients do not provide these structures.
- Reddit can change its DOM at any time. The script has fallbacks for
  `data-testid` containers and identifies posts from `permalink`, `post-id`,
  and post links, but it cannot guess media that is absent from the DOM.
- Direct `v.redd.it` links are not Reddit posts and cannot be converted to a
  post id; they get no control from this script.
- Comment support covers Reddit-hosted still images (including `.gif`). Video
  or `v.redd.it` links in comments are not downloaded by this script.
- Galleries only include Reddit-hosted image pages that are visible in the DOM.
- The original-image upgrade applies only to `.jpg`, `.jpeg`, `.png` and `.gif`
  paths; `.webp`/`.avif` previews are used as-is.
- Video/audio formats, sizes and availability are whatever NoBsDL returns for
  that post. The script does not merge, transcode, probe or invent formats.
- The script does not cancel a job. Keep the tab open until the file is handed
  to the browser.
- Save all downloads one ZIP. Individual row buttons still save single files.
  A browser setting such as Chrome's “Ask where to save each file before
  downloading” applies to any download; the script cannot change it.
- Video posts in compact view, or a player moved outside a `shreddit-post`,
  use a visible post/article surface instead of a hidden player host. The
  badge still resolves the canonical post URL before any request.
- Crossposts use the player/gallery `post-id` when it differs from the
  enclosing post, so the media's own post is requested rather than the outer
  crosspost.
- A NoBsDL `format_unavailable` answer shows **Refresh formats** and does not
  silently retry the same stale source.

## Tests

Pure helpers (URLs, image validation, galleries, filenames, tiers, params,
progress, safe paths):

```sh
node --test tests/test_nobsdl_reddit_userscript.mjs
```

Browser-level UI and flows in Chromium (all Reddit/CDN/NoBsDL traffic mocked):

```sh
npm install
CHROME_BIN=/usr/bin/google-chrome node tests/test_nobsdl_reddit_userscript_browser.js
```

Comment export, unit level (URL parsing, timestamps, JSON/CSV/Markdown,
filenames, and a static check that the delimited `// ── Comment export ──`
section contains none of the transport helpers, network APIs, cookie/storage
access or HTML injection):

```sh
node --test tests/test_nobsdl_reddit_comment_export.mjs
```

Comment export, browser level (synthetic Reddit DOM; any request other than
the fixture page itself is recorded and fails the test):

```sh
CHROME_BIN=/usr/bin/google-chrome \
  node tests/test_nobsdl_reddit_comment_export_browser.js
```

Last local result (2026-10-21, script 1.1.0):

- `tests/test_nobsdl_reddit_userscript.mjs`: **18/18 passed**
- `tests/test_nobsdl_reddit_userscript_browser.js`: **96/96 passed**
- `tests/test_nobsdl_reddit_comment_export.mjs`: **12/12 passed**
- `tests/test_nobsdl_reddit_comment_export_browser.js`: **64/64 passed**
- `node --check nobsdl-reddit-media.user.js`: clean

The browser suite covers the single-image save, gallery individual saves, the
one-download gallery ZIP, video format lookup/progress/close-reopen/attachment,
a hidden-player compact post, a player outside a post/lightbox, a player that
loads after the fallback badge, the MP3 `audio_bitrate` path, comment images,
duplicate prevention, re-rendered post elements and media hosts, SPA navigation,
the no-GM fallback, a stale `format_unavailable` response, and crosspost post-id
selection.

The comment-export browser suite covers the button and its count (duplicate
nodes counted once), the dialog, the three downloads and their contents,
nested replies and parent ids, collapsed, image-only and deleted comments,
dynamic comment loading, SPA navigation (feed, another post, back), empty
posts, a single host/button after repeated scans, no overlap with the media
toast at 1280, 800 and 390 px, and no network request during any of it.

Those tests use synthetic DOM and mocked responses. They do not prove that
Reddit's live DOM, Reddit's CDN, or NoBsDL's live video endpoint currently
behave the same way.
