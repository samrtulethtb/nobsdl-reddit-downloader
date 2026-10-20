# Manual QA — NoBsDL Reddit Media Downloader

This checklist covers the behaviour that the automated suite cannot prove:
Reddit's live DOM, Reddit's live CDN, a real NoBsDL video job, and a real
browser download. Record actual results; do not mark a row PASS from the
automated tests alone.

For the separate Reddit Comment Exporter, use
[QA-comment-exporter.md](QA-comment-exporter.md) instead.

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

- [ ] One `⬇ Save image` badge appears on the post media.
- [ ] Click it once. The browser saves one file; no tab opens.
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

- [ ] One `⬇ Gallery · N` badge appears; `N` equals Reddit's own page count.
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

- [ ] Exactly one `⬇ Video` badge appears; the native `<video>` fallback does
  not add a second one.
- [ ] In the normal card feed, each visible video post gets a visible
  `⬇ Video` badge.
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

## Sign-off

| Field | Value |
| --- | --- |
| Automated unit tests | `node --test tests/test_nobsdl_reddit_userscript.mjs` → 18/18 |
| Automated browser tests | `tests/test_nobsdl_reddit_userscript_browser.js` → 96/96 |
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
