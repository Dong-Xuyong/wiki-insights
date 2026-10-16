# Wiki Insights

The app moved to Study → Insights (`/wiki-flashcards/insights/`). This repo now hosts only the redirect stub and the `data/` folder the app reads. Grok Bot keeps writing `data/` here.

Live app: https://dong-xuyong.github.io/wiki-flashcards/insights/

`index.html` sends `/wiki-insights/` to that app and keeps the query string and hash (`?url=`, `#/`, `#/browse?...`, `#/progress`, `#/v/<slug>`). `404.html` maps any other missing path under `/wiki-insights/` to the same path under `/wiki-flashcards/insights/`. Files in `data/` stay here and are still served.

## Data

`data/catalog.json` and `data/insights/<slug>.json` are committed snapshots; there is currently no build script that regenerates them. Each catalog video carries a section from the Wiki Flashcards taxonomy; zero-signal videos go to Other.

The Study Insights tab fetches these files from `/wiki-insights/data/`. Do not delete or move `data/`.

Agents record ingested videos in the private `Dong-Xuyong/progress-sync` repo with `scripts/sync_wiki_insights.py` (see `wiki-insights/AGENT_INSIGHTS_SPEC.md` there).

Each video's `concepts` list is the inverse of the `## Sources` section on every concept page in the vault — the same rule Wiki Flashcards uses — so both apps always agree on which concepts belong to which video.
