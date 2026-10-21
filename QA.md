# Manual QA — NoBsDL Reddit Media Downloader

This checklist covers the behaviour that the automated suite cannot prove:
Reddit's live DOM, Reddit's live CDN, a real NoBsDL video job, and a real
browser download. Record actual results; do not mark a row PASS from the
automated tests alone.

## Before you start

Record:

- Date:
- Tester:
- Browser + version:
- Userscript manager + version:
- Network/country:
- NoBsDL account state (none / Supporter):
- Script version (`@version`):

Install `nobsdl-reddit-media.user.js` in the manager. Open DevTools →
Network with **Preserve log** enabled and a filter containing:

```
nobsdl.com
i.redd.it
preview.redd.it
```

Do not paste cookies, session tokens or payment data into this document or
into a bug report.

## Fixtures

These public posts were used while building the script. Reddit content can be
deleted or changed; record the URL you actually used.

| Fixture | URL | What to expect |
| --- | --- | --- |
| Gallery | https://www.reddit.com/r/aww/comments/1x9kry0/merlin_soaking_up_the_sun/ | A gallery with multiple Reddit-hosted image pages |
| Video | https://www.reddit.com/r/Unexpected/comments/1cl9h0u/the_insurance_claim_will_be_interesting/ | A Reddit video post with the current `shreddit-player` player |
| Single image | (record a current public single-image post): | One image post, no gallery |
| Comment image | (record a public post whose comment contains an `i.redd.it` / `preview.redd.it` image): | At least one Reddit-hosted image in a comment |

Known environment note: a direct `/api/video-info` request for the video
fixture returned HTTP 400 from the build environment on 2026-10-19. That is not
by itself proof that the endpoint or the post is broken. Record the live
status and, if it fails, retry once from a normal browser/network before
reporting a backend problem.

## 1. Install and page scan

- [ ] The manager lists the script for `reddit.com`, `*.reddit.com` and
  `redd.it`, with `embed.reddit.com` excluded.
- [ ] The script appears once; no duplicate copy is installed.
- [ ] Open a Reddit feed. No NoBsDL control appears on avatars, icons,
  subreddit banners, external-host images or "related posts" thumbnails.
- [ ] Scroll for ~30 seconds. No `nobsdl.com` request is made.
- [ ] Open a supported post. Controls appear without a page reload.
- [ ] Wait 5 seconds and scroll slightly. Controls do **not** multiply.

Record: PASS / FAIL / NOT TESTED. Notes:

## 2. Single image

- [ ] One `⬇ Save image` badge appears on the post media (in Firefox as well as
  Chrome).
- [ ] Click it once. The browser saves one file; no tab opens. In Firefox the
  saved file is a JPEG/PNG/GIF (the request uses an `Accept` header without
  WebP), so it is not opened in a new tab; if Reddit still returns WebP, record
  it.
- [ ] File name matches the post title and a sensible image extension.
- [ ] The saved image matches the post (not an avatar, icon or unrelated
  thumbnail).
- [ ] If `i.redd.it` refuses the original, the script falls back to the
  `preview.redd.it` URL and still saves an image (or shows an honest error with
  **Open image**).
- [ ] Scrolling/rescanning does not add a second badge.
- [ ] Network: no `nobsdl.com` request for this save; only Reddit image hosts.

Record file name, image dimensions if known, and result:

## 3. Gallery

- [ ] One `⬇ Save gallery · N` badge appears (in Firefox as well as Chrome),
  as a visible box in the top-right of the post media; `N` equals Reddit's own
  page count, also in the feed right after the carousel loads (the label may
  take up to about a second to catch up).
- [ ] The saved gallery images are the original files (JPEG/PNG/GIF at full
  size, from `i.redd.it/<id>.<ext>`), not 640px WebP previews.
- [ ] Open it. The panel title is the post title.
- [ ] Row count equals `N`; rows say "Image 1 of N" … in page order.
- [ ] No invented pages and no external-host images.
- [ ] Save image 1. File name ends with `- 01.<ext>`; the image matches page 1.
- [ ] Save image 2 (or another row). It is a different file and matches that
  page.
- [ ] Click **Save all (.zip)**. Exactly one ZIP download is offered, named
  after the post. The browser does not ask for permission to download multiple
  files.
- [ ] Open the ZIP. It contains all N files with the distinct numbered names,
  and each image matches its page.
- [ ] The panel status says how many images were packed and names the ZIP.
- [ ] If one image fails, the remaining images are still packed into one ZIP
  and the status reports the real number packed and failed; it does not claim
  success for the failed page.
- [ ] Network: no `nobsdl.com` request; only `i.redd.it` / `preview.redd.it`.

Record the real `N`, file names, and result:

## 4. Video

Open the video post and the panel. Use DevTools to confirm requests.

- [ ] Exactly one `⬇ Download video` badge appears; the native `<video>`
  fallback does not add a second one.
- [ ] In the normal card feed, each visible video post gets a visible
  `⬇ Download video` badge.
- [ ] On a post page, Reddit's promoted video (`shreddit-comments-page-ad`) and
  feed ads (`shreddit-ad-post`, promoted posts) get **no** NoBsDL badge.
- [ ] A RedGIFs link post (also behind the 18+ blur) and a Streamable link post
  each get one `⬇ Download video` badge. Opening it sends exactly one
  `/api/video-info` request whose `url=` is the external RedGIFs/Streamable URL
  (not the Reddit post URL), and the formats start a `/download` job for that
  external URL.
- [ ] With Tampermonkey/Violentmonkey, the finished video is saved through the
  manager (the Reddit tab is not navigated, even if the file link fails) and has
  the server's file name.
- [ ] In compact view (`?feedViewType=compactView`), each visible video post
  still gets a visible badge on its post/article surface, not a 0×0 control
  inside the hidden player.
- [ ] If Reddit opens a player in an overlay/lightbox outside the post, the
  player gets a badge and opening it requests that player's own post URL.
- [ ] On opening, exactly one `/api/video-info` request is made.
- [ ] Its `url=` is the canonical full Reddit post URL, without tracking
  parameters or a trailing slash.
- [ ] The panel title is the real post title; the duration (if shown) matches
  the video.
- [ ] The cards match the response: only returned MP4/MP3 formats; no invented
  quality or size.
- [ ] A locked card is visibly marked; clicking it opens
  `https://nobsdl.com/supporter` in a new tab and starts **no** `/download`
  job.
- [ ] Click one free format once. Exactly one `/download?…&async=1&format_id=…`
  request starts; no duplicate job.
- [ ] Progress is measured (bytes and/or percentage), not a fake timer.
- [ ] Close the panel while it runs. Reopen it from the badge; the same job is
  shown and continues. No new job starts.
- [ ] The finished file is handed to the browser as an attachment.
- [ ] The video plays and has audio.
- [ ] The saved duration/resolution is consistent with the chosen format.
- [ ] "Download another format" reopens the same format list without a second
  metadata request.
- [ ] Network: only `nobsdl.com` for metadata/job/status/file.

Record API status, chosen format, file name, whether audio was present, and
result:

## 5. Comment images

- [ ] An inline `⬇ Save image` button appears next to a Reddit-hosted image or
  link inside a comment.
- [ ] The comment image does **not** get a post-level badge, and the post image
  does not get a comment button.
- [ ] Click once. One file is saved; the name contains the post title and
  `comment`.
- [ ] The saved image matches the comment image.
- [ ] Rescanning does not duplicate the inline button.
- [ ] Network: no `nobsdl.com` request.

Record result:

## 6. SPA / dynamic navigation

- [ ] From a feed, open a supported post. Controls appear.
- [ ] Use Reddit's back/forward navigation. Controls appear on the new page and
  do not duplicate.
- [ ] Open a gallery/video panel, then navigate to a different post. The stale
  panel closes; it does not keep acting on the previous post.
- [ ] Add media by scrolling (lazy rendering). Controls appear when the media
  appears.
- [ ] No `nobsdl.com` request happens merely from navigating.

Record result:

## 7. Missing GM transport (optional)

Only test this if you can disable `GM_xmlhttpRequest` in the manager or use a
build without it.

- [ ] The video panel shows an explanatory error, not a silent failure.
- [ ] It offers **Open post on NoBsDL** with the canonical post URL.
- [ ] The footer says no request was made from the page.
- [ ] No page `fetch`/XHR fallback occurs.

Record manager and result:

## 8. Privacy and interaction promise

- [ ] Scrolling and scanning make no `nobsdl.com` requests.
- [ ] The script creates no analytics/tracking request.
- [ ] The script creates no `localStorage`/`sessionStorage` keys attributable
  to it and reads no cookies (source-level check; manager behaviour is
  separate).
- [ ] No popup, forced redirect, fake download button or fake "your download
  is ready" message appears.
- [ ] External links open in a new tab with `noopener noreferrer`.
- [ ] Error messages describe what actually happened; they do not promise a
  file that was not delivered.

Record result:

## 9. Supporter state (only if you have a key)

- [ ] Without an active key, the locked choices are shown and open
  `/supporter` without starting a job.
- [ ] With an active key, the API's `is_supporter` is reflected: locked choices
  are unlocked (or the backend omits the lock), and no false "paid" claim is
  shown.
- [ ] The script never accepts payment, never asks for card data and never
  creates a key.
- [ ] Pass prices/terms shown on the site match the current business rules;
  record them rather than copying from old documentation.

Record key state and result:

## 10. Failure drills (optional but useful)

- [ ] Open a video post while offline or with NoBsDL blocked: the panel shows
  a real network error and a retry path.
- [ ] Trigger an expired/stale source format (or mock a 409
  `format_unavailable`): **Refresh formats** appears and the same stale job is
  not silently resubmitted.
- [ ] Try a Reddit-hosted image URL that returns 403/404: the message matches
  the status and offers **Open image**; no fake success.
- [ ] Try an external-host image (Imgur, etc.): no control is added.

Record each drill:

## 11. Comment export (script 1.1.0)

Covers what the automated suite cannot prove for the comment export: Reddit's
live DOM, a real userscript manager, a real browser download and live
lazy-loaded threads. Use a public post with several top-level comments and
nested replies; if possible also one with a collapsed or "load more" area, an
image-only comment and a deleted/removed comment. Record the URL used:

```
https://www.reddit.com/r/...
```

### 11.1 Visibility and placement

- [ ] Open a Reddit feed. No **Export comments** button appears.
- [ ] Open the fixture post. The button appears at the bottom-right without a
  page reload, with the loaded count (`Export comments · N`).
- [ ] Wait 5 seconds, scroll, and return to the tab. There is still exactly one
  button.
- [ ] The button does not cover a required Reddit control on desktop or mobile.
- [ ] With the media script's toast showing (for example a failed image save on
  a post that also has comments), the toast and the export button do not
  overlap on a wide window and on a narrow one (under 900 px).
- [ ] Opening the media panel (a video or gallery panel) covers the export
  button; the button is not drawn above the media panel's dimmed backdrop.

Record: PASS / FAIL / NOT TESTED. Notes:

### 11.2 Count and scope

- [ ] In DevTools count the unique `thingid`s of
  `document.querySelectorAll('shreddit-comment')`; the button count matches.
- [ ] The dialog shows the loaded count and Reddit's own count separately, and
  states that only currently loaded comments are included.
- [ ] On a large thread, scrolling or expanding comments yourself raises the
  count within about a second.
- [ ] The script does not click "more comments" or load more comments by itself.

Record loaded count, Reddit's count and result:

### 11.3 Dialog

- [ ] Clicking the button opens the dialog with JSON, CSV and Markdown enabled.
- [ ] Tab and Shift+Tab stay inside the dialog.
- [ ] Escape closes it and returns focus to the button; so do the close button
  and a click on the dimmed area.
- [ ] Reopening after a download still works.

Record: PASS / FAIL / NOT TESTED. Notes:

### 11.4 JSON

- [ ] One browser download named `reddit-comments-<subreddit>-<post-id>.json`
  that parses as JSON.
- [ ] `format` is `reddit-comments`, `version` is `1`, `count` equals the
  loaded count, and `post` has the canonical URL, title, subreddit, author and
  Reddit's comment count where available.
- [ ] One object per unique `thingid`; a duplicate node does not create a
  duplicate record.
- [ ] A reply's `parent_id` is its parent's `t1_...` id, a top-level comment
  points at the post `t3_...`, and `depth` increases with nesting.
- [ ] A parent's `body` does not contain its child replies; a comment with a
  script tag does not export the script text.
- [ ] `is_submitter`, `is_deleted`, `is_removed` and `collapsed` match the page;
  `created_utc` / `created_iso` are present only when Reddit rendered a time.
- [ ] A collapsed comment is exported with its body; an image-only comment has
  an empty `body` and no media file is downloaded.

Record: PASS / FAIL / NOT TESTED. Notes:

### 11.5 CSV

- [ ] One download ending in `.csv` with the 13-column header
  `id,parent_id,depth,author,score,created_utc,created_iso,is_submitter,is_deleted,is_removed,collapsed,permalink,body`.
- [ ] A spreadsheet shows one row per unique comment; bodies with quotes and
  line breaks open correctly.
- [ ] A body beginning with `=`, `+`, `-` or `@` shows as text, not a formula.
- [ ] Booleans say `true` / `false`; missing scores are blank.

Record: PASS / FAIL / NOT TESTED. Notes:

### 11.6 Markdown

- [ ] One download ending in `.md` that opens in a Markdown viewer.
- [ ] Each `[link]` points to a `https://www.reddit.com/` permalink and still
  works when the URL contains `(` or `)`.
- [ ] The header names the post URL, loaded count, Reddit's count and export
  time; replies are indented under their parents.
- [ ] Author, score, time, OP marker and permalink appear where available;
  literal angle brackets in a body are escaped; image-only comments show
  `_[no text]_`.

Record: PASS / FAIL / NOT TESTED. Notes:

### 11.7 Navigation

- [ ] Navigate from the post to a feed. The button disappears.
- [ ] Navigate to a different post without a full reload. The old post's
  comments are not reused; the button stays hidden until that post's comments
  load.
- [ ] Return to the first post. The button and count return.
- [ ] If the URL changes while the dialog is open, the dialog closes.

Record: PASS / FAIL / NOT TESTED. Notes:

### 11.8 Network and privacy

- [ ] With DevTools -> Network open and **Preserve log** enabled, clearing the
  log, then opening the dialog and downloading each format makes no request at
  all from the userscript (in particular none to `nobsdl.com`, `i.redd.it` or
  `preview.redd.it`).
- [ ] DevTools -> Application shows no new `localStorage` / `sessionStorage`
  entry from the script.
- [ ] Exactly one browser download is produced per format click.
- [ ] Media features (image badge, video badge, gallery) still behave as in
  sections 1-10 on the same post.

Record: PASS / FAIL / NOT TESTED. Notes:

### 11.9 Appearance

- [ ] On a narrow viewport the button is reachable and the dialog fits,
  scrolling when needed; the format buttons stack.
- [ ] The dialog is readable in light and dark colour schemes and with reduced
  motion.

Record: PASS / FAIL / NOT TESTED. Notes:

## Sign-off

| Field | Value |
| --- | --- |
| Automated unit tests | `node --test tests/test_nobsdl_reddit_userscript.mjs` → 20/20 |
| Automated browser tests | `tests/test_nobsdl_reddit_userscript_browser.js` → 157/157 (Chromium), 157/157 (Firefox, `BROWSER=firefox`) |
| Automated comment-export unit tests | `node --test tests/test_nobsdl_reddit_comment_export.mjs` → 13/13 |
| Automated comment-export browser tests | `tests/test_nobsdl_reddit_comment_export_browser.js` → 64/64 (Chromium), 64/64 (Firefox) |
| Live comment export (section 11) | |
| Live gallery result | |
| Live single-image result | |
| Live video result | |
| Live comment-image result | |
| Real video has audio? | |
| Supporter test | |
| Overall | PASS / FAIL / PARTIAL |

If anything fails, report:

1. fixture URL;
2. browser + userscript manager versions;
3. exact step;
4. expected vs actual;
5. the relevant `/api/video-info`, `/download` or status response (redact
   cookies, keys and personal data);
6. screenshot if the failure is visual.

Do not publish a "verified" claim until the live rows above have real results.
