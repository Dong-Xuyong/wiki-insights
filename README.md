# Wiki Insights

Mobile-first navigator for YouTube wiki videos — Insights Q&A with emoji and peach highlights, plus a Summary tab from the vault.

Live: https://dong-xuyong.github.io/wiki-insights/

## Features

- **Catalog** — all ingested wiki source videos, searchable by title, creator, and **keywords**
- **Keyword chips** — tap a chip to filter the catalog
- **Insights** — sectioned emoji Q&A with selective highlighting (`**phrase**`)
- **Summary** — wiki Summary + key insight bullets
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
