# Wiki Insights

Mobile-first learning dashboard for YouTube wiki videos — organized browsing, watch progress, lightweight achievements, Insights Q&A, summaries, and concept links.

Live: https://dong-xuyong.github.io/wiki-insights/

## Features

- **Home** — overall completion, Continue Watching, category progress, and one clear next action
- **Browse** — category-first library with URL-persisted search, watch-state filters, and sorting
- **Three watch states** — Not started, In progress, and Completed
- **Nine browse buckets** — the eight Wiki Flashcards subject areas plus an honest Other fallback
- **Progress** — local XP, levels, activity streaks, category exploration, and achievements
- **Keyword chips** — tap a chip to search the library
- **Insights** — sectioned emoji Q&A with selective highlighting (`**phrase**`)
- **Summary** — wiki Summary + key insight bullets
- **Concepts** — every wiki concept drawn from this video, linking into [Wiki Flashcards](https://dong-xuyong.github.io/wiki-flashcards/), plus a button that studies the whole set as one session
- **Resume playback** — last pause (and last known time) is saved in your browser per video, so coming back continues where you left off. Use **Start over** to clear it.
- **Open / create from link** — paste a YouTube URL, or open  
  `https://dong-xuyong.github.io/wiki-insights/?url=https://youtu.be/VIDEO_ID`  
  - If the video is already in the wiki → opens it  
  - If not → generates Insights in the browser from captions (stored in `localStorage` as a Local draft)
- Copy / share floating actions (share links include `?url=`)

## Routes

- `#/` — Home
- `#/browse` — category browser
- `#/browse?status=completed&section=agents&sort=az&q=claude` — shareable library filters
- `#/progress` — XP, streak, statistics, and achievements
- `#/v/<source-slug>` — video detail

## Local progress

No account or backend is required. Browser storage is deliberately used:

- `wiki-insights-progress-v1` — playback time and Completed state
- `wiki-insights-game-v1` — active learning days and seen achievement celebrations
- `wiki-insights-local-v1` — locally generated video drafts and Insights

Existing `wiki-insights-progress-v1` records are retained. XP is deterministic: 10 XP for a video's first meaningful start and another 40 XP when it is completed, with 250 XP per level. Clearing browser storage resets local progress.

## Stack

Plain HTML/CSS/JS, no frontend build step. Data is generated in the Second Brain source repo:

```bash
python scripts/build_wiki_insights_data.py
python scripts/sync_wiki_insights.py
```

Insights packs live at `youtube-wiki/wiki/insights/<slug>.json` and are copied into `data/insights/`. Each catalog video is assigned a build-time section using the Wiki Flashcards taxonomy; zero-signal videos go to Other.

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
