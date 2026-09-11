(() => {
  const root = document.getElementById("view-root");
  const topTitle = document.getElementById("topbar-title");
  const backBtn = document.getElementById("back-btn");
  const tabToggle = document.getElementById("tab-toggle");
  const fab = document.getElementById("fab");
  const fabCopy = document.getElementById("fab-copy");
  const fabShare = document.getElementById("fab-share");

  const LOCAL_KEY = "wiki-insights-local-v1";
  const PROGRESS_KEY = "wiki-insights-progress-v1";
  const RESUME_MIN_SEC = 3;
  const RESUME_END_PAD_SEC = 5;
  // Sibling app; relative when serving the repo root locally.
  const FLASHCARDS_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "../wiki-flashcards/"
    : "https://dong-xuyong.github.io/wiki-flashcards/";
  const PIPED = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.private.coffee",
  ];

  let CATALOG = null;
  let localVideos = [];
  let localInsights = {};
  let currentVideo = null;
  let currentInsights = null;
  let panel = "insights";
  let searchQ = "";
  const insightsCache = new Map();
  let ytApiPromise = null;
  let ytPlayer = null;
  let ytPlayerVideoId = null;
  let ytSaveTimer = null;
  let ytHasPlayed = false;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    );
  }
  function rich(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<mark class="hl">$1</mark>');
  }

  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
      localVideos = Array.isArray(raw.videos) ? raw.videos : [];
      localInsights = raw.insights && typeof raw.insights === "object" ? raw.insights : {};
    } catch {
      localVideos = [];
      localInsights = {};
    }
  }
  function saveLocal() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ videos: localVideos, insights: localInsights }));
  }

  function loadProgressMap() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function getSavedSeconds(videoId) {
    if (!videoId) return 0;
    const rec = loadProgressMap()[videoId];
    if (!rec || rec.done) return 0;
    const t = typeof rec.t === "number" ? rec.t : 0;
    return t >= RESUME_MIN_SEC ? Math.floor(t) : 0;
  }

  function setSavedSeconds(videoId, seconds, { done = false, clear = false } = {}) {
    if (!videoId) return;
    const map = loadProgressMap();
    if (clear) delete map[videoId];
    else if (done) {
      map[videoId] = { t: Math.floor(seconds || 0), updated: Date.now(), done: true };
    } else if (seconds < RESUME_MIN_SEC) return;
    else map[videoId] = { t: Math.floor(seconds), updated: Date.now(), done: false };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  }

  function catalogProgress(v, progressMap) {
    const rec = v.video_id ? progressMap[v.video_id] : null;
    if (!rec) return { done: false, pct: 0, started: false };
    if (rec.done) return { done: true, pct: 100, started: true };
    const t = typeof rec.t === "number" ? rec.t : 0;
    if (t < RESUME_MIN_SEC) return { done: false, pct: 0, started: false };
    const dur = (Number(v.duration_min) || 0) * 60;
    const pct = dur > 0 ? Math.min(99, Math.max(6, Math.round((t / dur) * 100))) : 12;
    return { done: false, pct, started: true };
  }

  function thumbProgressHtml(v, progress) {
    const { done, pct, started } = progress;
    const thumb = v.video_id
      ? `<img class="video-card-thumb" src="https://i.ytimg.com/vi/${esc(
          v.video_id
        )}/mqdefault.jpg" alt="" loading="lazy" decoding="async" />`
      : `<div class="video-card-thumb video-card-thumb-empty" aria-hidden="true"></div>`;
    const bar =
      started
        ? `<div class="video-card-progress${done ? " is-done" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${
            done ? "Completed" : `${pct}% watched`
          }"><span style="width:${pct}%"></span></div>`
        : "";
    const badge = done
      ? `<span class="video-card-status">Done</span>`
      : started
        ? `<span class="video-card-status is-watch">${pct}%</span>`
        : "";
    return `<div class="video-card-thumb-wrap">${thumb}${bar}${badge}</div>`;
  }

  function formatClock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function paintResumeBar(seconds) {
    const bar = document.getElementById("resume-bar");
    const label = document.getElementById("resume-label");
    if (!bar || !label) return;
    if (seconds < RESUME_MIN_SEC) {
      bar.classList.add("hidden");
      return;
    }
    label.textContent = `Resuming from ${formatClock(seconds)}`;
    bar.classList.remove("hidden");
  }

  function persistPlayerTime({ done = false } = {}) {
    if (!ytPlayer || !ytPlayerVideoId) return 0;
    if (!done && !ytHasPlayed) return 0;
    try {
      const t = ytPlayer.getCurrentTime?.();
      const dur = ytPlayer.getDuration?.() || 0;
      if (typeof t !== "number" || !Number.isFinite(t)) return 0;
      const finished = done || (dur > 0 && t >= dur - RESUME_END_PAD_SEC);
      if (finished) {
        setSavedSeconds(ytPlayerVideoId, t, { done: true });
        paintResumeBar(0);
        return t;
      }
      if (t < RESUME_MIN_SEC) return t;
      setSavedSeconds(ytPlayerVideoId, t);
      paintResumeBar(t);
      return t;
    } catch {
      return 0;
    }
  }

  function stopProgressTimer() {
    if (!ytSaveTimer) return;
    clearInterval(ytSaveTimer);
    ytSaveTimer = null;
  }

  function destroyPlayer() {
    persistPlayerTime();
    stopProgressTimer();
    if (ytPlayer) {
      try {
        ytPlayer.destroy();
      } catch {
        /* already gone */
      }
      ytPlayer = null;
    }
    ytPlayerVideoId = null;
    ytHasPlayed = false;
  }

  function ensureYouTubeAPI() {
    if (window.YT && typeof window.YT.Player === "function") {
      return Promise.resolve(window.YT);
    }
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") prev();
        resolve(window.YT);
      };
      const src = "https://www.youtube.com/iframe_api";
      if (!document.querySelector(`script[src="${src}"]`)) {
        const tag = document.createElement("script");
        tag.src = src;
        document.head.appendChild(tag);
      }
    });
    return ytApiPromise;
  }

  function youtubeEmbedSrc(videoId, startAt) {
    const params = new URLSearchParams({
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
      origin: location.origin,
    });
    if (startAt >= RESUME_MIN_SEC) params.set("start", String(startAt));
    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }

  function bindResumePlayer(videoId, startAt) {
    ytPlayerVideoId = videoId;
    ensureYouTubeAPI().then((YT) => {
      const el = document.getElementById("yt-player");
      if (!el || currentVideo?.video_id !== videoId) return;
      ytPlayer = new YT.Player("yt-player", {
        events: {
          onReady(e) {
            if (startAt >= RESUME_MIN_SEC) {
              try {
                e.target.seekTo(startAt, true);
              } catch {
                /* first play still uses start= */
              }
            }
          },
          onStateChange(e) {
            if (e.data === YT.PlayerState.PLAYING) {
              ytHasPlayed = true;
              if (!ytSaveTimer) ytSaveTimer = setInterval(() => persistPlayerTime(), 5000);
              return;
            }
            if (e.data === YT.PlayerState.PAUSED) {
              persistPlayerTime();
              stopProgressTimer();
            } else if (e.data === YT.PlayerState.ENDED) {
              persistPlayerTime({ done: true });
              stopProgressTimer();
            }
          },
        },
      });
    });
  }

  function bindResumeBar(videoId) {
    const restart = document.getElementById("restart-video");
    if (!restart) return;
    restart.addEventListener("click", () => {
      setSavedSeconds(videoId, 0, { clear: true });
      paintResumeBar(0);
      if (ytPlayer?.seekTo) {
        try {
          ytPlayer.seekTo(0, true);
        } catch {
          /* ignore */
        }
      }
    });
  }

  function allVideos() {
    const map = new Map();
    for (const v of CATALOG.videos || []) map.set(v.slug, v);
    for (const v of localVideos) map.set(v.slug, { ...v, local: true });
    return [...map.values()].sort((a, b) => {
      const da = a.updated || a.created || "";
      const db = b.updated || b.created || "";
      if (da !== db) return db.localeCompare(da);
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function formatUpdated(iso) {
    const raw = String(iso || "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[Number(m[2]) - 1];
    if (!month) return raw;
    return `${Number(m[3])} ${month} ${m[1]}`;
  }

  function videoUpdatedLabel(v) {
    const formatted = formatUpdated(v.updated || v.created);
    return formatted ? `Updated ${formatted}` : "";
  }

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function extractVideoId(input) {
    const value = String(input || "").trim();
    const patterns = [
      /(?:youtu\.be\/|youtube\.com\/(?:embed|shorts)\/)([\w-]{11})/,
      /[?&]v=([\w-]{11})/,
      /^([\w-]{11})$/,
    ];
    for (const re of patterns) {
      const m = value.match(re);
      if (m) return m[1];
    }
    return null;
  }

  function findByUrlOrId(input) {
    const id = extractVideoId(input);
    const videos = allVideos();
    if (id) {
      const hit = videos.find((v) => v.video_id === id);
      if (hit) return hit;
    }
    const raw = String(input || "").trim().toLowerCase();
    if (!raw) return null;
    return videos.find((v) => (v.url || "").toLowerCase() === raw || v.slug === raw) || null;
  }

  function parseRoute() {
    const h = (location.hash || "#/").replace(/^#/, "");
    const m = h.match(/^\/v\/([^/?#]+)/);
    if (m) return { name: "detail", slug: decodeURIComponent(m[1]) };
    const create = h.match(/^\/create\/?/);
    if (create) return { name: "create" };
    return { name: "catalog" };
  }

  function queryUrlParam() {
    const sp = new URLSearchParams(location.search);
    return sp.get("url") || sp.get("v") || "";
  }

  function navigate(hash) {
    location.hash = hash;
  }

  function setChrome({ title, showBack, showTabs }) {
    topTitle.textContent = title || "Wiki Insights";
    topTitle.classList.toggle("hidden", !!showTabs);
    backBtn.classList.toggle("hidden", !showBack);
    tabToggle.classList.toggle("hidden", !showTabs);
    fab.classList.toggle("hidden", !showTabs);
  }

  function insightsPlainText(pack, video) {
    const lines = [video.title, ""];
    for (const sec of pack.sections || []) {
      lines.push(sec.title);
      for (const it of sec.items || []) {
        lines.push(`${it.e || ""} Q: ${it.q}`.trim());
        lines.push(`A: ${String(it.a).replace(/\*\*/g, "")}`);
        lines.push("");
      }
    }
    return lines.join("\n").trim();
  }

  async function loadInsights(slug) {
    if (localInsights[slug]) return localInsights[slug];
    if (insightsCache.has(slug)) return insightsCache.get(slug);
    try {
      const res = await fetch(`data/insights/${encodeURIComponent(slug)}.json`);
      if (!res.ok) throw new Error("missing");
      const data = await res.json();
      insightsCache.set(slug, data);
      return data;
    } catch {
      insightsCache.set(slug, null);
      return null;
    }
  }

  function keywordChips(keywords, limit = 5) {
    const list = (keywords || []).slice(0, limit);
    if (!list.length) return "";
    return `<div class="kw-row">${list
      .map((k) => `<button type="button" class="kw-chip" data-kw="${esc(k)}">${esc(k)}</button>`)
      .join("")}</div>`;
  }

  function matchesQuery(v, q) {
    if (!q) return true;
    const hay = [v.title, v.creator, v.slug, ...(v.tags || []), ...(v.keywords || [])]
      .join(" ")
      .toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
  }

  function renderCatalog() {
    destroyPlayer();
    setChrome({ title: "Wiki Insights", showBack: false, showTabs: false });
    currentVideo = null;
    currentInsights = null;
    const q = searchQ.trim().toLowerCase();
    const videos = allVideos().filter((v) => matchesQuery(v, q));
    const progressMap = loadProgressMap();
    root.innerHTML = `
      <div class="search-wrap">
        <input id="search" type="search" placeholder="Search keywords, title, creator…" value="${esc(
          searchQ
        )}" autocomplete="off" />
      </div>
      <div class="url-bar">
        <input id="url-input" type="url" placeholder="Paste YouTube link to open or create Insights…" autocomplete="off" />
        <button type="button" id="url-go" class="url-go">Go</button>
      </div>
      <p class="catalog-meta">${videos.length} videos · newest updates first · click a keyword chip to filter</p>
      <div id="catalog-list">
        ${videos
          .map((v) => {
            const updated = videoUpdatedLabel(v);
            const progress = catalogProgress(v, progressMap);
            const watchLabel = progress.done
              ? "Completed"
              : progress.started
                ? `${progress.pct}% watched`
                : "Not started";
            return `
          <article class="video-card" data-slug="${esc(v.slug)}" tabindex="0" role="link" aria-label="${esc(
            `${v.title}. ${watchLabel}`
          )}">
            <div class="video-card-top">
              ${thumbProgressHtml(v, progress)}
              <div class="video-card-body">
                <p class="video-card-title">${esc(v.title)}${
                  v.local ? ` <span class="badge-local">Local</span>` : ""
                }</p>
                <div class="video-card-meta">
                  ${v.creator ? `<span>${esc(String(v.creator).replace(/-/g, " "))}</span>` : ""}
                  ${v.duration_min ? `<span>${v.duration_min} min</span>` : ""}
                  ${v.conceptCount ? `<span>${v.conceptCount} concepts</span>` : ""}
                  ${updated ? `<span>${esc(updated)}</span>` : ""}
                  ${
                    progress.started
                      ? `<span class="video-card-watch${progress.done ? " is-done" : " is-watch"}">${watchLabel}</span>`
                      : ""
                  }
                </div>
              </div>
            </div>
            ${keywordChips(v.keywords)}
          </article>`;
          })
          .join("")}
      </div>
    `;
    const input = document.getElementById("search");
    input.addEventListener("input", () => {
      searchQ = input.value;
      renderCatalog();
      const again = document.getElementById("search");
      if (again) {
        again.focus();
        const len = again.value.length;
        again.setSelectionRange(len, len);
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const id = extractVideoId(input.value);
      if (id) {
        e.preventDefault();
        handleIncomingUrl(input.value);
      }
    });
    document.getElementById("url-go").addEventListener("click", () => {
      handleIncomingUrl(document.getElementById("url-input").value);
    });
    document.getElementById("url-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleIncomingUrl(e.target.value);
    });
    root.querySelectorAll(".video-card").forEach((card) => {
      const open = () => navigate(`#/v/${card.dataset.slug}`);
      card.addEventListener("click", (e) => {
        if (e.target.closest(".kw-chip")) return;
        open();
      });
      card.addEventListener("keydown", (e) => {
        if (e.target.closest(".kw-chip")) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
    root.querySelectorAll(".kw-chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        searchQ = chip.dataset.kw || "";
        renderCatalog();
      });
    });
  }

  function renderInsightsHtml(pack) {
    if (!pack || !pack.sections || !pack.sections.length) {
      return `<div class="missing-insights">Insights pack not available yet. Check the Summary tab.</div>`;
    }
    return pack.sections
      .map(
        (sec) => `
      <h2 class="section-title">${esc(sec.title)}</h2>
      ${(sec.items || [])
        .map(
          (it) => `
        <div class="qa-block">
          <div class="qa-q"><span class="emoji">${esc(it.e || "💡")}</span><span><span class="label">Q:</span> ${rich(
            it.q
          )}</span></div>
          <div class="qa-a"><span class="label">A:</span> ${rich(it.a)}</div>
        </div>`
        )
        .join("")}`
      )
      .join("");
  }

  function renderConceptsHtml(v) {
    const list = v.concepts || [];
    if (!list.length) {
      return `<div class="missing-insights">${
        v.local
          ? "Local videos have no wiki concepts yet. Ingest it into the vault to get flashcards."
          : "No concepts linked to this video yet. Add a <code>## Sources</code> entry on a concept page."
      }</div>`;
    }
    const studyUrl = `${FLASHCARDS_URL}#/v/${encodeURIComponent(v.slug)}`;
    return `
      <a class="study-cta" href="${esc(studyUrl)}">
        Study ${list.length} concept${list.length === 1 ? "" : "s"} &rarr;
      </a>
      <div class="concept-grid">
        ${list
          .map(
            (c) => `<a class="concept-chip" href="${esc(
              `${FLASHCARDS_URL}#/c/${encodeURIComponent(c.slug)}`
            )}">
              <span class="concept-emoji">${esc(c.e || "💡")}</span>
              <span class="concept-name">${esc(c.title)}</span>
            </a>`
          )
          .join("")}
      </div>`;
  }

  function renderSummaryHtml(v) {
    const paras = (v.summary || "")
      .split(/\n\n+/)
      .filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`)
      .join("");
    const keys =
      v.key_insights && v.key_insights.length
        ? `<h2 class="section-title">Key insights</h2><ul class="key-list">${v.key_insights
            .map((k) => `<li>${esc(k)}</li>`)
            .join("")}</ul>`
        : "";
    const kws = (v.keywords || []).length
      ? `<h2 class="section-title">Keywords</h2>${keywordChips(v.keywords, 12)}`
      : "";
    return `<div class="summary-body">${paras || "<p>No summary on file.</p>"}${keys}${kws}</div>`;
  }

  function paintDetailBody() {
    const body = document.getElementById("detail-body");
    if (!body || !currentVideo) return;
    tabToggle.querySelectorAll(".seg").forEach((b) => {
      b.classList.toggle("active", b.dataset.panel === panel);
    });
    body.innerHTML =
      panel === "summary"
        ? renderSummaryHtml(currentVideo)
        : panel === "concepts"
          ? renderConceptsHtml(currentVideo)
          : renderInsightsHtml(currentInsights);
    body.querySelectorAll(".kw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        searchQ = chip.dataset.kw || "";
        navigate("#/");
      });
    });
  }

  async function renderDetail(slug) {
    const v = allVideos().find((x) => x.slug === slug);
    if (!v) {
      destroyPlayer();
      root.innerHTML = `<div class="empty">Video not found.</div>`;
      return;
    }
    destroyPlayer();
    setChrome({ title: "", showBack: true, showTabs: true });
    currentVideo = v;
    panel = "insights";
    const startAt = v.video_id ? getSavedSeconds(v.video_id) : 0;
    root.innerHTML = `
      <div class="player-wrap">
        ${
          v.video_id
            ? `<iframe id="yt-player" src="${esc(youtubeEmbedSrc(v.video_id, startAt))}" title="${esc(
                v.title
              )}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
            : `<div class="missing-insights">No video id</div>`
        }
      </div>
      <div id="resume-bar" class="resume-bar${startAt ? "" : " hidden"}">
        <span id="resume-label">${startAt ? `Resuming from ${formatClock(startAt)}` : ""}</span>
        <button type="button" id="restart-video">Start over</button>
      </div>
      <p class="detail-title">${esc(v.title)}${
        videoUpdatedLabel(v) ? ` · ${esc(videoUpdatedLabel(v))}` : ""
      }</p>
      ${keywordChips(v.keywords, 8)}
      <div id="detail-body"><div class="empty">Loading…</div></div>
    `;
    root.querySelectorAll(".kw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        searchQ = chip.dataset.kw || "";
        navigate("#/");
      });
    });
    if (v.video_id) {
      bindResumeBar(v.video_id);
      bindResumePlayer(v.video_id, startAt);
    }
    currentInsights = await loadInsights(slug);
    paintDetailBody();
  }

  function highlightAnswer(text) {
    if (text.includes("**")) return text;
    const words = text.split(/\s+/);
    if (words.length > 10) {
      const n = Math.max(4, Math.floor(words.length / 4));
      const chunk = words.slice(0, n).join(" ");
      return text.replace(chunk, `**${chunk}**`);
    }
    return `**${text}**`;
  }

  function packFromText(slug, title, text) {
    const emojis = ["💡", "🔑", "📊", "🎯", "⚡", "🧠", "💰", "🏆", "🔄", "🚀"];
    const sents = String(text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 48 && s.length <= 320)
      .slice(0, 12);
    const items = (sents.length ? sents : [`Key themes from “${title}”.`]).map((sent, i) => ({
      e: emojis[i % emojis.length],
      q: "What should you remember from this part of the talk?",
      a: highlightAnswer(sent),
    }));
    const sections = [];
    for (let i = 0; i < items.length; i += 2) {
      sections.push({
        title: i === 0 ? "Core insights" : `Further takeaways ${i / 2 + 1}`,
        items: items.slice(i, i + 2),
      });
    }
    return { slug, sections: sections.slice(0, 6) };
  }

  async function fetchOEmbed(videoId) {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not load video metadata");
    return res.json();
  }

  async function fetchPipedStream(videoId) {
    let lastErr = null;
    for (const base of PIPED) {
      try {
        const res = await fetch(`${base}/streams/${videoId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("No Piped mirror available");
  }

  function subtitlesToText(subtitlesJson) {
    // Piped returns URL to subtitles file; sometimes JSON body already
    if (typeof subtitlesJson === "string") return subtitlesJson;
    return "";
  }

  async function fetchCaptionText(stream) {
    const subs = stream.subtitles || stream.captions || [];
    const preferred =
      subs.find((s) => /^en/i.test(s.code || s.languageCode || "")) ||
      subs.find((s) => /auto/i.test(s.name || "")) ||
      subs[0];
    if (!preferred || !preferred.url) return stream.description || "";
    try {
      const res = await fetch(preferred.url);
      const text = await res.text();
      // VTT / SRT → plain
      return text
        .replace(/WEBVTT[\s\S]*?\n\n/, "")
        .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s-->\s[\d:.,]+\s*/g, "")
        .replace(/^\d+\s*$/gm, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{2,}/g, "\n")
        .trim();
    } catch {
      return stream.description || "";
    }
  }

  function keywordsFromTitle(title, author) {
    const stop = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "to",
      "of",
      "in",
      "on",
      "for",
      "with",
      "how",
      "why",
      "what",
      "your",
      "you",
      "i",
      "is",
      "my",
      "from",
    ]);
    const parts = String(title)
      .split(/[^a-zA-Z0-9]+/)
      .filter((w) => w.length > 2 && !stop.has(w.toLowerCase()))
      .slice(0, 8);
    if (author) parts.unshift(author);
    return [...new Set(parts.map((p) => p.replace(/-/g, " ")))].slice(0, 10);
  }

  async function createFromYoutube(urlOrId) {
    const videoId = extractVideoId(urlOrId);
    if (!videoId) {
      toast("Not a YouTube link");
      return;
    }
    const existing = findByUrlOrId(videoId);
    if (existing) {
      navigate(`#/v/${existing.slug}`);
      return;
    }

    setChrome({ title: "Creating…", showBack: true, showTabs: false });
    root.innerHTML = `<div class="empty">Generating Insights from captions…<br/><span class="muted">This stays in your browser until you ingest it into the wiki.</span></div>`;

    try {
      let title = videoId;
      let author = "";
      let duration_min = null;
      let summary = "";
      let bodyText = "";

      try {
        const stream = await fetchPipedStream(videoId);
        title = stream.title || title;
        author = stream.uploader || stream.uploaderName || "";
        if (stream.duration) duration_min = Math.max(1, Math.round(stream.duration / 60));
        summary = stream.description || "";
        bodyText = await fetchCaptionText(stream);
        if (!bodyText || bodyText.length < 80) bodyText = summary;
      } catch {
        const meta = await fetchOEmbed(videoId);
        title = meta.title || title;
        author = meta.author_name || "";
        bodyText = `${title}. ${author}`;
        summary = bodyText;
      }

      const slug = `local-${videoId}`;
      const keywords = keywordsFromTitle(title, author);
      const pack = packFromText(slug, title, bodyText);
      const video = {
        slug,
        title,
        video_id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        duration_min,
        creator: author,
        tags: [],
        keywords,
        summary: summary.slice(0, 1600),
        key_insights: (pack.sections || [])
          .flatMap((s) => s.items || [])
          .slice(0, 5)
          .map((it) => it.a.replace(/\*\*/g, "")),
        has_insights: true,
        local: true,
        updated: todayIso(),
        created: todayIso(),
      };

      localVideos = [video, ...localVideos.filter((v) => v.slug !== slug)];
      localInsights[slug] = pack;
      saveLocal();
      insightsCache.set(slug, pack);
      toast("Insights created (local)");
      // Reflect shareable query
      const next = new URL(location.href);
      next.searchParams.set("url", video.url);
      history.replaceState(null, "", `${next.pathname}${next.search}#/v/${slug}`);
      await renderDetail(slug);
    } catch (err) {
      root.innerHTML = `<div class="empty">Could not create Insights.<br/>${esc(
        err.message || err
      )}<br/><br/>Vault ingest:<br/><code>python scripts/create_wiki_insights_from_url.py "https://youtu.be/${esc(
        videoId
      )}" --sync</code></div>`;
    }
  }

  async function handleIncomingUrl(raw) {
    const value = String(raw || "").trim();
    if (!value) return;
    const hit = findByUrlOrId(value);
    if (hit) {
      navigate(`#/v/${hit.slug}`);
      return;
    }
    if (extractVideoId(value)) {
      await createFromYoutube(value);
      return;
    }
    toast("Paste a YouTube URL");
  }

  async function route() {
    if (!CATALOG) return;
    const pending = queryUrlParam();
    if (pending && !location.hash.includes("/v/")) {
      // Consume query once into create/open flow
      const u = new URL(location.href);
      u.searchParams.delete("url");
      u.searchParams.delete("v");
      history.replaceState(null, "", u.pathname + u.hash);
      await handleIncomingUrl(pending);
      return;
    }
    const r = parseRoute();
    if (r.name === "detail") await renderDetail(r.slug);
    else renderCatalog();
  }

  backBtn.addEventListener("click", () => navigate("#/"));
  tabToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    panel = btn.dataset.panel;
    paintDetailBody();
  });

  fabCopy.addEventListener("click", async () => {
    if (!currentVideo) return;
    const text =
      panel === "summary"
        ? `${currentVideo.title}\n\n${currentVideo.summary || ""}\n\n${(currentVideo.key_insights || [])
            .map((k) => `• ${k}`)
            .join("\n")}`
        : currentInsights
          ? insightsPlainText(currentInsights, currentVideo)
          : currentVideo.summary || "";
    try {
      await navigator.clipboard.writeText(text.trim());
      toast("Copied");
    } catch {
      toast("Copy failed");
    }
  });

  fabShare.addEventListener("click", async () => {
    if (!currentVideo) return;
    const text = currentInsights
      ? insightsPlainText(currentInsights, currentVideo)
      : currentVideo.summary || currentVideo.title;
    const pageUrl = currentVideo.url
      ? `${location.origin}${location.pathname}?url=${encodeURIComponent(currentVideo.url)}`
      : location.href;
    const shareData = { title: currentVideo.title, text, url: pageUrl };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(`${shareData.title}\n${shareData.url}\n\n${text}`);
        toast("Copied link + text");
      }
    } catch {
      /* cancelled */
    }
  });

  window.addEventListener("hashchange", () => {
    route();
  });
  window.addEventListener("pagehide", () => persistPlayerTime());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistPlayerTime();
  });

  loadLocal();
  fetch("data/catalog.json")
    .then((r) => {
      if (!r.ok) throw new Error("catalog missing");
      return r.json();
    })
    .then((data) => {
      CATALOG = data;
      return route();
    })
    .catch((err) => {
      root.innerHTML = `<div class="empty">Failed to load catalog.<br/>${esc(err.message)}</div>`;
    });
})();
