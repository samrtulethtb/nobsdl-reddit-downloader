## ⬇️ Save Reddit videos, images, galleries and comments right on the page

<img src="https://raw.githubusercontent.com/samrtulethtb/nobsdl-reddit-downloader/main/media/demo.gif" alt="Click Download video on a Reddit post, pick 720p, watch the real progress, the MP4 is saved" width="480">

Every Reddit video, image, gallery and GIF gets a **⬇ button** on the media
itself. Click it and the file goes straight to your browser's downloads, with
no new tab, no copy-pasting links and no captcha pages.

**What it saves**
- 🎬 **Videos with sound**: MP4 in the qualities the post really has
  (e.g. 1080p · ~19 MB), or **MP3 128 / 256 / 320 kbps**.
- 🖼️ **Images in full size**: the original `i.redd.it` file, not the small
  preview Reddit shows (e.g. a 5693×4171 JPEG).
- 🗂️ **Whole galleries as one ZIP**: or save single pages from the list.
- 🎞️ **GIF posts** as the original `.gif`.
- 💬 **Images posted in comments**: a small Save image button next to them.
- 📝 **Comments to JSON, CSV or Markdown**: an **Export comments** button on
  every post page.

### 🗂️ Galleries: every image, one download

<img src="https://raw.githubusercontent.com/samrtulethtb/nobsdl-reddit-downloader/main/media/gallery.gif" alt="Save gallery opens the list of all 8 images; Save all packs them into one ZIP" width="440">

**⬇ Save gallery · N** lists every image of the post. **Save all (.zip)** packs
them into a single ZIP in your browser, so you get one download instead of a
pile of "allow multiple downloads?" prompts.

### 📝 Export comments

<img src="https://raw.githubusercontent.com/samrtulethtb/nobsdl-reddit-downloader/main/media/comments.gif" alt="Export comments dialog: 25 comments loaded, JSON, CSV and Markdown buttons" width="640">

- **JSON**: every field (author, score, time, permalink, parent id, depth) to
  rebuild the thread.
- **CSV**: one row per comment, ready for a spreadsheet.
- **Markdown**: the readable nested thread.
- It exports the comments **already loaded on the page** and tells you how many
  that is next to Reddit's own count. Scroll or open more replies first if you
  want more.
- It runs **entirely in your browser**: no request, nothing uploaded.

<img src="https://raw.githubusercontent.com/samrtulethtb/nobsdl-reddit-downloader/main/media/image-save.jpg" alt="Save image button on a Reddit image post" width="480">

### Why this one

- 🎯 **Real formats with real sizes.** Video choices come from the actual post
  through NoBsDL. Nothing is invented; where Reddit doesn't give a size, none
  is shown.
- 📊 **Live progress you can trust.** Queue → Download → Process → Ready, with a
  real percentage and speed, not a fake timer bar.
- 🧭 **Stays out of your way.** Buttons sit on the media only; promoted posts
  and ads never get one. Works in feeds and on post pages.
- 🏠 **No third-party download sites.** Video goes through NoBsDL's own service.
  **No popups. No forced redirects. No fake download buttons.**

### ▶️ Try it

After installing, open one of these NASA posts on Reddit:

| What | Post |
|---|---|
| Video | https://www.reddit.com/user/nasa/comments/1wvzqhx/crew13_approaches_the_international_space_station/ |
| Gallery | https://www.reddit.com/user/nasa/comments/1sf1hyj/nasa_is_unveiling_images_from_mondays_artemis_ii/ |
| Image | https://www.reddit.com/user/nasa/comments/1si4jud/artemis_ii_splashes_down/ |

### Free and Supporter (disclosed as `@antifeature payment`)

Most video downloads are **free**. Some higher resolutions and files over the
free size limits (500 MB video, 100 MB MP3) need a paid
[NoBsDL Supporter key](https://nobsdl.com/supporter). Those choices are shown
with a 🔒 and never started for a free session. Images, galleries, GIFs and the
comment export are always free. A Supporter session activated on nobsdl.com in
the same browser is used when your userscript manager sends nobsdl.com cookies
with its requests; otherwise use **Open post on NoBsDL** in the video panel.

### Privacy

- **Nothing is sent while you scroll.** Requests start only when you click.
- **Images, galleries and GIFs** come straight from Reddit's own image hosts
  (`i.redd.it`, `preview.redd.it`). Nothing goes to NoBsDL.
- **Videos:** when you open the video panel, only that post's public link goes
  to nobsdl.com to list the formats and prepare the file.
- **Comment export** makes no request at all.
- No analytics, ads or tracking code. The script stores nothing: no cookies,
  no local storage, no history.
- Readable, unminified source (MIT).

### Good to know

- Made for the current Reddit (`www.reddit.com`). Old Reddit
  (`old.reddit.com`) is not supported.
- Reddit galleries hold up to 20 images; the ZIP has as many as the post shows.
- Posts that link a **Streamable** video download through NoBsDL like Reddit
  videos. Posts that link a **RedGIFs** clip get a **Download on NSFWDL**
  button instead; it opens that clip on nsfwdl.com (our adult video
  downloader) in a new tab, only when you click it.
- Private, deleted or quarantined content that Reddit doesn't show you can't be
  saved.
- Download only media you are allowed to save.

**Also from NoBsDL:**
[Free All-in-One Video Downloader](https://greasyfork.org/scripts/597631) for
YouTube, TikTok, Instagram, X, Facebook and 15 more sites ·
[Reddit video downloader](https://nobsdl.com/reddit-downloader) (works without
a script)

Problems or ideas? [nobsdl.com/contact](https://nobsdl.com/contact)
