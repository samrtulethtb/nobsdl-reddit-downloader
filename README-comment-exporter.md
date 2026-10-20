# Reddit Comment Exporter (userscript)

A separate, optional userscript in this repository. It exports the comments
that a Reddit post page has already loaded into JSON, CSV or Markdown.

- Runs locally in the browser.
- Makes no network requests after the Reddit page itself has loaded.
- Does not read cookies or store anything.
- Does not use the media downloader or call any server.
- Only reads the comments that Reddit has rendered in the page; it does not
  fetch more comments or expand Reddit's "more comments" controls.

The media userscript remains `nobsdl-reddit-media.user.js` and is not changed
by this tool.

## Install

1. Install a userscript manager such as
   [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Add `reddit-comment-exporter.user.js`:
   - install it from the raw file in this repository, or
   - create a new userscript in the manager and paste the file.
3. Open a Reddit post page with comments. A small **Export comments** button
   appears at the bottom-right.

The script has no build step and no runtime dependencies. It requires a
current Reddit page that uses the `shreddit-*` web components. Old Reddit is
not supported.

## What it exports

The button count is the number of unique comment records the script finds for
the current post (normally every `shreddit-comment` element currently loaded).
It is not Reddit's total comment count; the panel shows both so the difference
is explicit.

Each comment record contains:

- `id` and `parent_id` (`t1_...` for comments, `t3_...` for top-level)
- `depth`
- `author` (or `null`)
- `body` as plain text (paragraph breaks preserved, HTML tags and scripts
  removed)
- `score` when Reddit rendered it
- `created_utc` and `created_iso` when the page rendered a timestamp
- `permalink`
- `is_submitter`, `is_deleted`, `is_removed`, `collapsed`
- `content_type` when Reddit exposes it

Comments that contain only an image or video have an empty `body` when Reddit
renders no caption text; the exporter does not download comment media.

## Formats

### JSON

The complete structured export:

- post id, URL, title, subreddit, author and Reddit's comment count
- export timestamp and a note about the loaded-only scope
- a flat `comments` array whose `parent_id` and `depth` reconstruct the thread

Use JSON if you need machine-readable data or exact text.

### CSV

One row per comment, with 13 columns:

`id, parent_id, depth, author, score, created_utc, created_iso,
is_submitter, is_deleted, is_removed, collapsed, permalink, body`

Quotes and line breaks are CSV-escaped. Cells that start with a spreadsheet
formula character (`=`, `+`, `-`, `@`, tab or carriage return) are prefixed
with an apostrophe so opening the file in Excel or another spreadsheet does
not execute the text as a formula. Numeric score cells are left as numbers.

### Markdown

A readable thread:

- a header with the post URL, loaded count, Reddit's count and export time
- one bullet per comment, indented by `depth`
- author, score, timestamp, OP marker and a permalink where available
- the comment body in a blockquote, with HTML `<`/`>`/`&` escaped

Markdown is a readable rendering. Use JSON when exact data matters.

## Limitations

- **Loaded comments only.** Reddit lazy-loads large threads. The exporter does
  not click "more comments", fetch Reddit's JSON endpoints, or wait for
  comments that are not in the DOM. Scroll or expand the thread first if you
  need more.
- The panel reports both the loaded count and Reddit's own total. They can
  differ by a wide margin on large posts.
- Deleted and removed comments are exported as Reddit displays them, with
  `is_deleted`/`is_removed` flags in JSON.
- Scores and timestamps can be absent or hidden; JSON uses `null` and CSV uses
  an empty field rather than inventing values.
- Collapsed comments are included if their `shreddit-comment` element exists.
  The body text is read from the DOM even when the `<details>` element is
  closed.
- The exporter does not include comment images, videos, GIFs or other media
  files. A comment containing only media has an empty `body`.
- Old Reddit and third-party clients are not supported.
- Reddit can change its DOM at any time. The script targets the current
  `shreddit-comment`, `shreddit-post`, `thingid`, `parentid`, `depth`,
  `created`, `created-timestamp`, `score`, `author` and `permalink` attributes.

## Network and privacy

The userscript:

- has no `@connect` rules and no GM network permission;
- does not call `fetch`, `XMLHttpRequest`, `sendBeacon` or a userscript
  manager's HTTP API;
- does not read `document.cookie` or use `localStorage`/`sessionStorage`;
- builds the export with a local `Blob` and triggers one browser download.

The only network traffic is the Reddit page already open in the tab. The
userscript itself sends no data anywhere.

## File names

Exports are named:

```
reddit-comments-<subreddit>-<post-id>.json
reddit-comments-<subreddit>-<post-id>.csv
reddit-comments-<subreddit>-<post-id>.md
```

Unsafe filename characters are replaced and the base is capped at 100
characters.

## Tests

Unit tests (URL parsing, timestamps, JSON/CSV/Markdown, filenames and
metadata):

```sh
node --test tests/test_reddit_comment_exporter.mjs
```

Browser tests in Chromium (synthetic Reddit DOM, no public network):

```sh
npm install
CHROME_BIN=/usr/bin/google-chrome node tests/test_reddit_comment_exporter_browser.js
```

Last local result (2026-10-20):

- `tests/test_reddit_comment_exporter.mjs`: **10/10 passed**
- `tests/test_reddit_comment_exporter_browser.js`: **46/46 passed**
- `node --check reddit-comment-exporter.user.js`: clean

The browser suite covers visible button placement, duplicate `thingid`
deduplication, nested replies, parent ids, parent/child body separation,
collapsed comments, image-only comments, deleted comments, submitter flags,
ISO and Unix timestamps, JSON/CSV/Markdown downloads, CSV escaping, the
one-download behavior, dynamic comment loading, SPA navigation to a feed and
another post, empty posts and network isolation.

A live logged-in Reddit DOM probe on 2026-10-20 also loaded the script into a
real post page, found 100 unique loaded comments, produced a JSON download
with 100 unique records, made no `nobsdl.com` request and raised no page
errors. That probe did not run inside a userscript manager, so a real
manager-backed install remains a manual QA item.

## Manual QA

Use [QA-comment-exporter.md](QA-comment-exporter.md) for the live checklist.
