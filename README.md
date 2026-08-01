# Wiki Insights

Mobile-first navigator for YouTube wiki videos — Insights Q&A with emoji and peach highlights, plus a Summary tab from the vault.

Live: https://dong-xuyong.github.io/wiki-insights/

## Features

- **Catalog** — all ingested wiki source videos, searchable
- **Insights** — sectioned emoji Q&A with selective highlighting (`**phrase**`)
- **Summary** — wiki Summary + key insight bullets
- Embedded YouTube player per video
- Copy / share floating actions

## Stack

Plain HTML/CSS/JS, no build step. Data is generated in the Second Brain source repo:

```bash
python scripts/build_wiki_insights_data.py
python scripts/sync_wiki_insights.py
```

Insights packs live at `youtube-wiki/wiki/insights/<slug>.json` and are copied into `data/insights/`.

## Run locally

```bash
python -m http.server 8792
# open http://localhost:8792
```
