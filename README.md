# Wiki Insights

Mobile-first navigator for YouTube wiki videos — Insights Q&A with emoji and peach highlights, plus a Summary tab from the vault.

Live: https://dong-xuyong.github.io/wiki-insights/

## Features

- **Catalog** — all ingested wiki source videos, searchable by title, creator, and **keywords**
- **Keyword chips** — tap a chip to filter the catalog
- **Insights** — sectioned emoji Q&A with selective highlighting (`**phrase**`)
- **Summary** — wiki Summary + key insight bullets
- **Concepts** — every wiki concept drawn from this video, linking into [Wiki Flashcards](https://dong-xuyong.github.io/wiki-flashcards/), plus a button that studies the whole set as one session
- **Open / create from link** — paste a YouTube URL, or open  
  `https://dong-xuyong.github.io/wiki-insights/?url=https://youtu.be/VIDEO_ID`  
  - If the video is already in the wiki → opens it  
  - If not → generates Insights in the browser from captions (stored in `localStorage` as a Local draft)
- Copy / share floating actions (share links include `?url=`)

## Stack

Plain HTML/CSS/JS, no build step. Data is generated in the Second Brain source repo:

```bash
python scripts/build_wiki_insights_data.py
python scripts/sync_wiki_insights.py
```

Insights packs live at `youtube-wiki/wiki/insights/<slug>.json` and are copied into `data/insights/`.

Each video's `concepts` list is the inverse of the `## Sources` section on every concept
page in the vault — the same rule Wiki Flashcards uses — so both apps always agree on
which concepts belong to which video. The build prints concepts a source page claims
under `## Concepts` that do not link back, so gaps get fixed in the vault.

### Permanently ingest a new YouTube URL into the wiki

```bash
python scripts/create_wiki_insights_from_url.py "https://youtu.be/VIDEO_ID" --sync
```

## Run locally

```bash
python -m http.server 8792
# open http://localhost:8792
# or http://localhost:8792/?url=https://youtu.be/VIDEO_ID
```

To exercise the Wiki Flashcards cross-links locally, serve the parent folder holding both
app directories instead, then open `http://localhost:8790/wiki-insights/`. On localhost
the app points at `../wiki-flashcards/`; everywhere else it uses the public URL.
