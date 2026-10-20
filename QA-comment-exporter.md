# Manual QA — Reddit Comment Exporter

This checklist covers what the automated suite cannot prove: Reddit's live DOM,
a real userscript manager, a real browser download and live lazy-loaded
threads. Record actual results; do not mark a row PASS from the automated tests
alone.

## Before you start

Record:

- Date:
- Tester:
- Browser + version:
- Userscript manager + version:
- Post URL used:
- Script version (`@version`):

Install `reddit-comment-exporter.user.js` in the manager. Do not paste
cookies, session tokens or other private data into this document.

## Fixtures

Use a public Reddit post with a real comment thread. Pick one with:

- several top-level comments and nested replies
- at least one collapsed or "load more" area, if possible
- at least one image-only comment, if possible
- at least one deleted/removed comment, if possible

Record the URL actually used:

```
https://www.reddit.com/r/...
```

## 1. Install and visibility

- [ ] The manager lists the script for `www.reddit.com` and `reddit.com`.
- [ ] The script appears once; no duplicate copy is installed.
- [ ] Open a Reddit feed. No **Export comments** button appears.
- [ ] Open the fixture post. The button appears at the bottom-right without a
  page reload.
- [ ] The button does not cover a required Reddit control on desktop or mobile.
- [ ] Opening the post in a new tab and returning does not add a second button.

Record: PASS / FAIL / NOT TESTED. Notes:

## 2. Loaded count and scope

- [ ] Open DevTools and count unique
  `document.querySelectorAll('shreddit-comment')` thingids.
- [ ] The button count matches that unique count.
- [ ] The panel separately shows Reddit's own comment count.
- [ ] The panel states that only currently loaded comments are included.
- [ ] On a large thread, scrolling or expanding comments increases the count
  within about a second.
- [ ] The script does not click "more comments" or fetch more comments by
  itself.

Record loaded count, Reddit's count and result:

## 3. Panel interaction

- [ ] Clicking **Export comments** opens the dialog.
- [ ] The dialog shows the loaded count, Reddit's count and the limitation.
- [ ] JSON, CSV and Markdown buttons are visible and enabled.
- [ ] Tab and Shift+Tab stay inside the dialog.
- [ ] Escape closes the dialog and returns focus to the button.
- [ ] Clicking the dimmed area outside the panel closes it.
- [ ] The close button closes it.
- [ ] Reopening after a download still works.

Record: PASS / FAIL / NOT TESTED. Notes:

## 4. JSON

- [ ] Clicking JSON produces exactly one browser download.
- [ ] The suggested filename is
  `reddit-comments-<subreddit>-<post-id>.json`.
- [ ] The file parses as JSON.
- [ ] `format` is `reddit-comments`, `version` is `1`, and `count` equals the
  loaded count.
- [ ] `post` contains the canonical post URL, title, subreddit, author and
  Reddit's comment count where available.
- [ ] `comments` contains one object per unique `thingid`; no duplicate node
  creates a duplicate record.
- [ ] A reply has the parent comment's `t1_...` id in `parent_id`; a top-level
  comment points at the post `t3_...`.
- [ ] A parent comment's `body` does not contain its child replies.
- [ ] A nested reply's `depth` is greater than its parent's `depth`.
- [ ] `is_submitter`, `is_deleted`, `is_removed` and `collapsed` match what the
  page shows.
- [ ] `created_utc` and `created_iso` are present when Reddit rendered a
  timestamp, and `null` when it did not.
- [ ] Image-only comments have an empty `body`; no media file is downloaded.

Record: PASS / FAIL / NOT TESTED. Notes:

## 5. CSV

- [ ] Clicking CSV produces exactly one download ending in `.csv`.
- [ ] The header has 13 columns:
  `id,parent_id,depth,author,score,created_utc,created_iso,is_submitter,is_deleted,is_removed,collapsed,permalink,body`.
- [ ] The file opens in a spreadsheet with one row per unique comment.
- [ ] A comment containing quotes and line breaks still opens correctly.
- [ ] A body beginning with `=`, `+`, `-` or `@` is displayed as text, not
  executed as a formula.
- [ ] Boolean columns say `true`/`false`; missing scores are blank.
- [ ] No comment body is silently dropped.

Record: PASS / FAIL / NOT TESTED. Notes:

## 6. Markdown

- [ ] Clicking Markdown produces exactly one download ending in `.md`.
- [ ] The file opens in a Markdown viewer.
- [ ] The header names the post, URL, loaded count, Reddit's count and export
  time.
- [ ] Replies are visibly indented under their parents.
- [ ] Author, score, timestamp, OP marker and permalink appear when available.
- [ ] Literal angle brackets in a comment body are escaped, not treated as
  HTML.
- [ ] Image-only comments show `_[no text]_`.

Record: PASS / FAIL / NOT TESTED. Notes:

## 7. Live DOM cases

- [ ] A collapsed comment (`<details>` without `open`) is exported with its
  body text when its `shreddit-comment` exists.
- [ ] A comment containing a script tag does not export the script text.
- [ ] A deleted comment is exported as Reddit displays it and is marked
  `is_deleted` in JSON.
- [ ] An image-only comment exports an empty body and does not download the
  image.
- [ ] A reply nested several levels deep is exported with the correct
  `parent_id` and `depth`.
- [ ] After expanding more comments, the button count and a new export reflect
  the new records.

Record: PASS / FAIL / NOT TESTED. Notes:

## 8. SPA / navigation

- [ ] Navigate from the post back to a feed. The button disappears.
- [ ] Navigate to a different post without a full reload. The old post's
  comments are not reused; the button hides until that post's comments load.
- [ ] Return to the original post. The button and count return.
- [ ] If the post URL changes while the panel is open, the panel closes rather
  than exporting from the wrong page.

Record: PASS / FAIL / NOT TESTED. Notes:

## 9. Network and privacy

- [ ] With DevTools → Network open and **Preserve log** enabled, opening the
  button and downloading each format makes no request to `nobsdl.com`.
- [ ] No request is made to a non-Reddit host by the userscript itself.
- [ ] The script appears with `@grant none` and no `@connect`.
- [ ] DevTools → Application shows no new localStorage/sessionStorage entry
  from this script.
- [ ] The script does not read or print cookies.
- [ ] Only one browser download is produced per format click.

Record: PASS / FAIL / NOT TESTED. Notes:

## 10. Mobile and appearance

- [ ] On a narrow viewport the button remains reachable.
- [ ] The panel fits the viewport and scrolls when needed.
- [ ] The format buttons stack instead of overflowing.
- [ ] The panel is readable in light and dark browser color schemes.
- [ ] Reduced-motion settings do not break the panel.

Record: PASS / FAIL / NOT TESTED. Notes:

## Sign-off

- [ ] All critical sections pass, or every failure has an action and owner.
- [ ] The test post and script version are recorded above.
- [ ] The user understands that the export contains only currently loaded
  comments and may be much smaller than Reddit's total.

Tester:

Date:

Notes:
