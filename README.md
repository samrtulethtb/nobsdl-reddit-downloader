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

> **Verification status (2026-10-21, script 1.2.0):** the script passes 20 +
> 13 unit tests and the browser suites (157 and 64 checks) in Chromium and in
> Firefox against synthetic Reddit DOM fixtures with mocked Reddit CDN and
> NoBsDL responses. The fixtures mirror the live structure that caused the
> 1.1.0 bugs (see [1.2.0 fixes](#120-fixes)). A live logged-in Reddit probe in
> Chrome earlier verified visible video badges on a post page, the normal card
> feed and the compact feed. Those probes did not run inside a userscript
> manager, so a live end-to-end NoBsDL video job through the userscript is
> still a manual QA item. Use [QA.md](QA.md) before calling it
> production-ready.
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
| Gallery (`gallery-carousel` with `page-N` images) | `⬇ Save gallery · N` badge | Opens a panel listing every Reddit-hosted page found; Save saves one image, Save all (.zip) downloads one local ZIP | `i.redd.it` / `preview.redd.it` only |
| Video post (`shreddit-player`, `shreddit-player-2`, `shreddit-video-player`, or a native `<video>` in a video post) | `⬇ Download video` badge | Opens the NoBsDL format panel and runs the async download flow | `nobsdl.com` only after the panel is opened |
| Link post embedding a Streamable video (`content-href` is `https://streamable.com/<id>`) | `⬇ Download video` badge | Same panel; the external URL (not the Reddit post URL) is what NoBsDL is asked about | `nobsdl.com` only after the panel is opened |
| Link post embedding a RedGIFs video (`content-href` is `https://www.redgifs.com/watch/<id>` or `/ifr/<id>`) | `⬇ Download on NSFWDL` badge | Opens `https://nsfwdl.com/redgifs-downloader#url=<RedGIFs link>` in a new tab, only on click. NSFWDL is the adult video downloader; its page reads the link and starts it | Nothing from the script; the new tab loads nsfwdl.com |
| GIF post (`content-href` is an `i.redd.it/….gif`) | `⬇ Save GIF` badge | Saves the original `.gif` | `i.redd.it` only |
| Comment image (Reddit-hosted image link or embedded image in `shreddit-comment`) | Inline `⬇ Save image` button | Saves that comment image | `i.redd.it` / `preview.redd.it` only |

Reddit's own promoted content (`shreddit-ad-post`, `shreddit-comments-page-ad`,
`[slot="expanded-video-player"]`, or a post with a `promoted` attribute) is
never touched: no badge is added there.

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
- Video file names come from NoBsDL's `Content-Disposition` header: the
  browser downloads the file itself, so its own "ask where to save" setting
  applies to videos exactly as it does to images.

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
| Markdown | A header (post URL, loaded count, Reddit's count, export time, the loaded-only note), then one bullet per comment indented by `depth` with author, score, time, an OP marker and a link when the permalink is an `https://www.reddit.com/` URL (with `(`, `)`, whitespace, `<` and `>` percent-encoded), and the body in a blockquote with `<`, `>` and `&` escaped |

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

## 1.2.4 changes

- New name, so the script is easier to find on Greasy Fork: **Reddit
  Downloader – Videos with Sound, Full-Size Images, Galleries (ZIP), GIFs &
  Comments**. `@namespace` is unchanged, so existing installs keep updating.
  The `@description` leads with the same terms.
- The header comment no longer says videos are saved through the userscript
  manager's download function (since 1.2.3 the browser saves them).
- No behaviour change.

## 1.2.3 changes

- RedGIFs posts get **Download on NSFWDL** instead of the NoBsDL panel (owner
  decision, 2026-10-21): NSFWDL (`nsfwdl.com`) is the adult video downloader.
  The click opens `nsfwdl.com/redgifs-downloader#url=<RedGIFs link>` in a new
  tab; that page fills in the link and starts it. Checked live in Firefox and
  Chrome. Streamable posts still use NoBsDL.
- Video files are downloaded by the browser itself again, like images, so the
  browser's "always ask where to save" setting applies to both. `GM_download`
  (1.2.0-1.2.2) saved videos without asking even when the browser is set to
  ask; its `@grant` lines are removed. The download link is clicked without
  being added to the page, so Reddit's router never sees it, and the Reddit tab
  stays put because NoBsDL sends the file as an attachment.

## 1.2.2 fixes

Checked on live Reddit on 2026-10-21 in Firefox and Chrome, including NSFW
posts with a pool account that has mature content enabled:

- GIF posts (`i.redd.it/....gif`, played by Reddit's video player) showed
  "Download video", but NoBsDL's backend does not accept GIF posts. They now
  get **Save GIF**, which saves the original `.gif` straight from i.redd.it,
  like any Reddit image.
- RedGIFs posts whose link is the embed form `redgifs.com/ifr/<id>` got no
  button. They are now read as `redgifs.com/watch/<id>`.
- On a post page, a video badge could end up on `<main>` (over the page,
  not the media) when Reddit rendered the media late. Badges now go only on
  the post's media container, or in a feed on the post's own `<article>`, and
  move onto the media container once it appears.

## 1.2.1 fixes

Found on live Reddit in Firefox on 2026-10-21, after 1.2.0:

- Saving one image from a gallery closed the panel, and later saves showed
  "Saved" without downloading anything. Reddit's router caught the click on
  the hidden download link and changed the page URL to the `blob:` URL. The
  download link is no longer put in the page. A browser test mimics that router.
- The panel closes on navigation only when you leave its post. A `blob:` URL,
  or opening the same post from the feed, no longer closes it.
- Badges stop pointer, mouse and touch presses as well as clicks, so Reddit's
  cards and players don't react to a press on a badge.

## 1.2.0 fixes

Each root cause below was observed on live Reddit (Firefox 140 and Chrome) and
is covered by the live-structure fixtures:

- **Badges missing or misplaced in Firefox** (galleries showed no button): the
  badge was appended to `shreddit-async-loader` (`display: inline`, shadow
  root). It is now mounted on a verified block host, preferring
  `[slot="post-media-container"]`.
- **Ads got buttons:** promoted content is skipped (see Supported media).
- **RedGIFs/Streamable posts had no button:** now recognised from
  `content-href`; NoBsDL is asked about the external URL because the Reddit
  post URL only yields an entry `/download` rejects.
- **Image save fetched a small WebP preview:** see Images and galleries below.
- **Video save navigated the Reddit tab** to the file URL: `GM_download` was
  used when available (replaced in 1.2.3 by the browser's own download).
- **Gallery count stuck at "· 1" in feeds:** the label follows the real number
  of `page-N` nodes on every scan.
- **Scan starvation under infinite scroll:** scans now run at least about once
  a second while mutations continue.
- **Comment export Markdown links:** only `https://www.reddit.com/` permalinks
  become links, and `(`, `)`, whitespace, `<` and `>` in the URL are
  percent-encoded.
- **Badges are more visible:** brand gradient, white 13px/800 text, 36px
  minimum height; labels are `⬇ Download video`, `⬇ Save image`,
  `⬇ Save gallery · N`.

## Network behaviour

Nothing is sent while scrolling or scanning the page.

### Images and galleries

1. The userscript manager fetches the original image when the URL is a
   `.jpg`/`.jpeg`/`.png`/`.gif` preview. Modern previews look like
   `preview.redd.it/<slug>-v0-<id>.<ext>`; the original is
   `https://i.redd.it/<id>.<ext>` (the slug path on `i.redd.it` is refused with
   HTTP 403). Older previews keep the same path on `i.redd.it`. A URL already on
   `i.redd.it` is used as is. In galleries an `i.redd.it` URL found anywhere in
   the page node (for example in a `zoomable-img`) is preferred over a preview.
2. Image requests send `Accept: image/jpeg,image/png,image/gif,*/*;q=0.1`, so
   Reddit does not answer with a WebP/AVIF preview where a JPEG exists.
3. If Reddit refuses that original (for example HTTP 404), the script retries
   the exact `preview.redd.it` URL that Reddit itself displayed.
4. The bytes are saved as a browser download. No NoBsDL request is made. If the
   response is still WebP/AVIF it is saved as such; a browser setting such as
   Firefox's "open WebP files in the browser" can then show it in a tab, which
   the script cannot change.

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
- Badges are only mounted on a visible block-level host that does not have a
  shadow root (Reddit's `shreddit-async-loader` is `display: inline` with a
  shadow root, and Firefox places an absolutely-positioned badge inside such a
  host outside the post). After mounting, the script checks that the badge has
  a real box inside its host and otherwise removes it and tries the next host.
  A badge with an empty box is removed and mounted again on a later scan.
- RedGIFs/Streamable embed posts are recognised only from the post's
  `content-href` (https, exact host, a `/watch/<id>` or `/<id>` path); anything
  else, including lookalike hosts, ports and userinfo, is ignored. NoBsDL's
  formats for these come from the external video, so no "Open post on NoBsDL"
  link is shown for them.
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
CHROME_BIN=/usr/bin/google-chrome \
  node tests/test_nobsdl_reddit_userscript_browser.js
```

Both browser files also run in Playwright's Firefox with `BROWSER=firefox`
(no `CHROME_BIN` needed):

```sh
BROWSER=firefox \
  node tests/test_nobsdl_reddit_userscript_browser.js
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

Last local result (2026-10-21, script 1.2.0):

- `tests/test_nobsdl_reddit_userscript.mjs`: **20/20 passed**
- `tests/test_nobsdl_reddit_userscript_browser.js`: **157/157 passed** in
  Chromium and **157/157 passed** in Firefox 140 (`BROWSER=firefox`)
- `tests/test_nobsdl_reddit_comment_export.mjs`: **13/13 passed**
- `tests/test_nobsdl_reddit_comment_export_browser.js`: **64/64 passed** in
  Chromium and **64/64 passed** in Firefox
- `node --check nobsdl-reddit-media.user.js`: clean
- Mutation check: with both the inline/shadow-host skip and the placement check
  disabled, the Firefox run fails the live-structure badge tests (the badge is
  rendered 28 px wide at a negative x offset outside the post); restored, it
  passes.

The browser suite covers the single-image save, gallery individual saves, the
one-download gallery ZIP, video format lookup/progress/close-reopen/attachment,
a hidden-player compact post, a player outside a post/lightbox, a player that
loads after the fallback badge, the MP3 `audio_bitrate` path, comment images,
duplicate prevention, re-rendered post elements and media hosts, SPA navigation,
the no-GM fallback, a stale `format_unavailable` response, and crosspost post-id
selection. The live-structure fixtures (post with an open shadow root and named
slots, a `div[slot="post-media-container"]` holding an inline
`shreddit-async-loader` with its own shadow root, a gallery whose pages carry
`-v0-` previews and `zoomable-img` originals, RedGIFs/Streamable link posts
including one behind a blurred container, a promoted video, a feed ad and a
promoted post) assert that every badge has a non-zero box inside its media
container, is the topmost element at its centre, and that no badge appears in
an ad; that embed posts ask `/api/video-info` and `/download` about the
external URL; that the gallery label follows hydration; that image saves use
the derived `i.redd.it` original with the non-WebP `Accept` header; that video
files are downloaded by the browser itself (1.2.3); and that scans keep
running during continuous DOM mutation.

The comment-export browser suite covers the button and its count (duplicate
nodes counted once), the dialog, the three downloads and their contents,
nested replies and parent ids, collapsed, image-only and deleted comments,
dynamic comment loading, SPA navigation (feed, another post, back), empty
posts, a single host/button after repeated scans, no overlap with the media
toast at 1280, 800 and 390 px, and no network request during any of it.

Those tests use synthetic DOM and mocked responses. They do not prove that
Reddit's live DOM, Reddit's CDN, or NoBsDL's live video endpoint currently
behave the same way.
