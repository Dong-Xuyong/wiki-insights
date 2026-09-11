(() => {
  const root = document.getElementById("view-root");
  const topTitle = document.getElementById("topbar-title");
  const backBtn = document.getElementById("back-btn");
  const tabToggle = document.getElementById("tab-toggle");
  const fab = document.getElementById("fab");
  const fabCopy = document.getElementById("fab-copy");
  const fabShare = document.getElementById("fab-share");
  const tabbar = document.getElementById("tabbar");

  const LOCAL_KEY = "wiki-insights-local-v1";
  const PROGRESS_KEY = "wiki-insights-progress-v1";
  const GAME_KEY = "wiki-insights-game-v1";
  const RETURN_KEY = "wiki-insights-return-v1";
  const RESUME_MIN_SEC = 3;
  const RESUME_END_PAD_SEC = 5;
  const XP_STARTED = 10;
  const XP_COMPLETED = 40;
  const XP_PER_LEVEL = 250;
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
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
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

  function emptyGameStore() {
    return { version: 1, days: {}, earnedBadges: [], seenBadges: [], bootstrapped: false };
  }

  function loadGameStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(GAME_KEY) || "{}");
      const seenBadges = Array.isArray(raw.seenBadges) ? raw.seenBadges : [];
      return {
        version: 1,
        days: raw.days && typeof raw.days === "object" ? raw.days : {},
        earnedBadges: Array.isArray(raw.earnedBadges) ? raw.earnedBadges : [...seenBadges],
        seenBadges,
        bootstrapped: raw.bootstrapped === true,
      };
    } catch {
      return emptyGameStore();
    }
  }

  function saveGameStore(store) {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify(store));
    } catch {
      /* Private mode or storage quota: progress still works for this session. */
    }
  }

  function localDateKey(value = Date.now()) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function shiftDateKey(key, days) {
    const [y, m, d] = String(key).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }

  function recordActiveDay(timestamp = Date.now()) {
    const key = localDateKey(timestamp);
    if (!key) return;
    const game = loadGameStore();
    game.days[key] = 1;
    const keys = Object.keys(game.days).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - 730))) delete game.days[old];
    saveGameStore(game);
  }

  function activityStreak(days) {
    const has = (key) => !!days[key];
    const today = localDateKey();
    let cursor = has(today) ? today : shiftDateKey(today, -1);
    let count = 0;
    while (has(cursor)) {
      count += 1;
      cursor = shiftDateKey(cursor, -1);
    }
    return count;
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
    const previous = map[videoId];
    if (clear) delete map[videoId];
    else if (done) {
      map[videoId] = { t: Math.floor(seconds || 0), updated: Date.now(), done: true };
    } else if (previous?.done) {
      map[videoId] = { ...previous, updated: Date.now(), done: true };
    } else if (seconds < RESUME_MIN_SEC) return;
    else map[videoId] = { t: Math.floor(seconds), updated: Date.now(), done: false };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
    if (!clear) {
      recordActiveDay();
      celebrateNewAchievements();
    }
    paintDetailLabels();
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

  function paintResumeBar(seconds, { done = false } = {}) {
    const bar = document.getElementById("resume-bar");
    const label = document.getElementById("resume-label");
    if (!bar || !label) return;
    if (done) {
      label.textContent = "Marked completed";
      bar.classList.remove("hidden");
      return;
    }
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
        paintResumeBar(0, { done: true });
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
    const catalogVideoIds = new Set();
    for (const v of CATALOG.videos || []) {
      map.set(v.slug, v);
      if (v.video_id) catalogVideoIds.add(v.video_id);
    }
    for (const v of localVideos) {
      if (v.video_id && catalogVideoIds.has(v.video_id)) continue;
      map.set(v.slug, {
        section: "other",
        concepts: [],
        conceptCount: 0,
        ...v,
        local: true,
      });
    }
    return [...map.values()].sort((a, b) => {
      const da = a.updated || a.created || "";
      const db = b.updated || b.created || "";
      if (da !== db) return db.localeCompare(da);
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function sections() {
    const list = Array.isArray(CATALOG?.sections) ? CATALOG.sections : [];
    return list.length
      ? list
      : [{ id: "other", title: "Other", color: "#9a948a" }];
  }

  function sectionOf(id) {
    return (
      sections().find((section) => section.id === id) ||
      sections().find((section) => section.id === "other") || {
        id: "other",
        title: "Other",
        color: "#9a948a",
      }
    );
  }

  function watchState(progress) {
    if (progress.done) return "completed";
    if (progress.started) return "in-progress";
    return "not-started";
  }

  function watchLabel(progress, { compact = false } = {}) {
    if (progress.done) return "Completed";
    if (progress.started) return compact ? `${progress.pct}%` : `${progress.pct}% watched`;
    return "Not started";
  }

  function progressCounts(videos, progressMap) {
    const counts = { total: videos.length, completed: 0, inProgress: 0, notStarted: 0 };
    for (const video of videos) {
      const state = watchState(catalogProgress(video, progressMap));
      if (state === "completed") counts.completed += 1;
      else if (state === "in-progress") counts.inProgress += 1;
      else counts.notStarted += 1;
    }
    return counts;
  }

  function categoryProgress(videos, progressMap, sectionId) {
    const members = videos.filter((video) => (video.section || "other") === sectionId);
    const counts = progressCounts(members, progressMap);
    return {
      ...counts,
      pct: counts.total ? Math.round((counts.completed / counts.total) * 100) : 0,
    };
  }

  function learningSummary(videos, progressMap = loadProgressMap(), game = loadGameStore()) {
    const counts = progressCounts(videos, progressMap);
    const started = counts.inProgress + counts.completed;
    const explored = new Set();
    const concepts = new Set();
    for (const video of videos) {
      const progress = catalogProgress(video, progressMap);
      if (progress.started && (video.section || "other") !== "other") {
        explored.add(video.section);
      }
      if (progress.done) {
        for (const concept of video.concepts || []) concepts.add(concept.slug);
      }
    }
    const xp = started * XP_STARTED + counts.completed * XP_COMPLETED;
    const level = Math.floor(xp / XP_PER_LEVEL) + 1;
    return {
      ...counts,
      started,
      xp,
      level,
      levelXp: xp % XP_PER_LEVEL,
      completionPct: counts.completed
        ? Math.max(1, Math.round((counts.completed / counts.total) * 100))
        : 0,
      streak: activityStreak(game.days || {}),
      activeDays: Object.keys(game.days || {}).length,
      exploredCategories: explored.size,
      conceptsEncountered: concepts.size,
    };
  }

  function achievements(summary, game = loadGameStore()) {
    const definitions = [
      {
        id: "first-start",
        icon: "▶",
        title: "First step",
        description: "Start your first video",
        current: summary.started,
        goal: 1,
      },
      {
        id: "first-finish",
        icon: "✓",
        title: "First finish",
        description: "Complete one video",
        current: summary.completed,
        goal: 1,
      },
      {
        id: "five-finished",
        icon: "5",
        title: "Building momentum",
        description: "Complete five videos",
        current: summary.completed,
        goal: 5,
      },
      {
        id: "three-day-streak",
        icon: "3",
        title: "Three-day rhythm",
        description: "Learn for three days in a row",
        current: summary.streak,
        goal: 3,
      },
      {
        id: "category-explorer",
        icon: "◇",
        title: "Category explorer",
        description: "Start videos in three categories",
        current: summary.exploredCategories,
        goal: 3,
      },
      {
        id: "ten-finished",
        icon: "10",
        title: "Committed learner",
        description: "Complete ten videos",
        current: summary.completed,
        goal: 10,
      },
      {
        id: "seven-day-streak",
        icon: "7",
        title: "Seven-day streak",
        description: "Learn for seven days in a row",
        current: summary.streak,
        goal: 7,
      },
      {
        id: "twenty-five-finished",
        icon: "25",
        title: "Insight collector",
        description: "Complete twenty-five videos",
        current: summary.completed,
        goal: 25,
      },
    ];
    return definitions.map((badge) => ({
      ...badge,
      current: Math.min(badge.current, badge.goal),
      qualified: badge.current >= badge.goal,
      unlocked: badge.current >= badge.goal || game.earnedBadges.includes(badge.id),
    }));
  }

  function bootstrapGamification() {
    const game = loadGameStore();
    if (game.bootstrapped) return;
    const progressMap = loadProgressMap();
    let hadProgress = false;
    for (const record of Object.values(progressMap)) {
      if (!record || typeof record !== "object") continue;
      const active = record.done || Number(record.t) >= RESUME_MIN_SEC;
      if (!active) continue;
      hadProgress = true;
      const day = record.updated ? localDateKey(record.updated) : "";
      if (day) game.days[day] = 1;
    }
    game.bootstrapped = true;
    if (hadProgress) {
      const summary = learningSummary(allVideos(), progressMap, game);
      const unlocked = achievements(summary, game)
        .filter((badge) => badge.unlocked)
        .map((badge) => badge.id);
      game.earnedBadges = unlocked;
      game.seenBadges = unlocked;
    }
    saveGameStore(game);
  }

  function celebrateNewAchievements() {
    if (!CATALOG) return;
    const game = loadGameStore();
    if (!game.bootstrapped) return;
    const summary = learningSummary(allVideos(), loadProgressMap(), game);
    const fresh = achievements(summary, game).filter(
      (badge) => badge.qualified && !game.earnedBadges.includes(badge.id)
    );
    if (!fresh.length) return;
    game.earnedBadges = [
      ...new Set([...game.earnedBadges, ...fresh.map((badge) => badge.id)]),
    ];
    game.seenBadges = [...new Set([...game.seenBadges, ...fresh.map((badge) => badge.id)])];
    saveGameStore(game);
    toast(
      `Achievement unlocked: ${fresh[0].title}${fresh.length > 1 ? ` +${fresh.length - 1} more` : ""}`
    );
  }

  function sortVideos(videos, sort, progressMap) {
    const list = [...videos];
    if (sort === "az") {
      return list.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    }
    if (sort === "updated") {
      return list.sort((a, b) =>
        String(b.updated || b.created || "").localeCompare(String(a.updated || a.created || ""))
      );
    }
    const rank = { "in-progress": 0, "not-started": 1, completed: 2 };
    return list.sort((a, b) => {
      const pa = catalogProgress(a, progressMap);
      const pb = catalogProgress(b, progressMap);
      const stateA = watchState(pa);
      const stateB = watchState(pb);
      if (rank[stateA] !== rank[stateB]) return rank[stateA] - rank[stateB];
      const activityA = progressMap[a.video_id]?.updated || 0;
      const activityB = progressMap[b.video_id]?.updated || 0;
      if (activityA !== activityB) return activityB - activityA;
      const dateA = a.updated || a.created || "";
      const dateB = b.updated || b.created || "";
      if (dateA !== dateB) return dateB.localeCompare(dateA);
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
    const raw = (location.hash || "#/").replace(/^#/, "");
    const [path, query = ""] = raw.split("?");
    const m = path.match(/^\/v\/([^/?#]+)/);
    if (m) return { name: "detail", slug: decodeURIComponent(m[1]) };
    if (/^\/browse\/?$/.test(path)) {
      const params = new URLSearchParams(query);
      const statusValues = new Set(["all", "not-started", "in-progress", "completed"]);
      const sortValues = new Set(["smart", "updated", "az"]);
      const status = params.get("status") || "all";
      const sort = params.get("sort") || "smart";
      return {
        name: "browse",
        q: params.get("q") || "",
        status: statusValues.has(status) ? status : "all",
        section: params.get("section") || "",
        sort: sortValues.has(sort) ? sort : "smart",
      };
    }
    if (/^\/progress\/?$/.test(path)) return { name: "progress" };
    const create = path.match(/^\/create\/?/);
    if (create) return { name: "create" };
    return { name: "home" };
  }

  function queryUrlParam() {
    const sp = new URLSearchParams(location.search);
    return sp.get("url") || sp.get("v") || "";
  }

  function navigate(hash) {
    location.hash = hash;
  }

  function browseHash(state = {}) {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.status && state.status !== "all") params.set("status", state.status);
    if (state.section) params.set("section", state.section);
    if (state.sort && state.sort !== "smart") params.set("sort", state.sort);
    const query = params.toString();
    return `#/browse${query ? `?${query}` : ""}`;
  }

  function updateBrowseState(changes, { replace = false, focusSearch = false } = {}) {
    const routeState = parseRoute();
    const current =
      routeState.name === "browse"
        ? routeState
        : { q: "", status: "all", section: "", sort: "smart" };
    const hash = browseHash({ ...current, ...changes });
    if (!replace) {
      navigate(hash);
      return;
    }
    history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
    route().then(() => {
      if (!focusSearch) return;
      const input = document.getElementById("browse-search");
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function rememberReturnRoute() {
    try {
      sessionStorage.setItem(
        RETURN_KEY,
        JSON.stringify({ hash: location.hash || "#/", scrollY: window.scrollY })
      );
    } catch {
      /* Session storage may be unavailable. */
    }
  }

  function returnRoute() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "{}");
      if (typeof saved.hash === "string" && saved.hash.startsWith("#/")) return saved;
    } catch {
      /* Fall back to Home. */
    }
    return { hash: "#/", scrollY: 0 };
  }

  function restoreReturnScroll() {
    const saved = returnRoute();
    if (saved.hash !== (location.hash || "#/")) return;
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      /* Ignore. */
    }
    if (saved.scrollY) {
      requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY, behavior: "auto" }));
    }
  }

  function returnFromDetail() {
    const saved = returnRoute();
    const url = new URL(location.href);
    url.searchParams.delete("url");
    url.searchParams.delete("v");
    history.replaceState(
      history.state,
      "",
      `${url.pathname}${url.search}${saved.hash || "#/"}`
    );
    route({ focusView: true });
  }

  function openVideo(slug) {
    rememberReturnRoute();
    navigate(`#/v/${encodeURIComponent(slug)}`);
  }

  function setChrome({ title, showBack, showTabs, activeTab = "", showNav = true }) {
    topTitle.textContent = title || "Wiki Insights";
    topTitle.classList.toggle("hidden", !!showTabs);
    backBtn.classList.toggle("hidden", !showBack);
    tabToggle.classList.toggle("hidden", !showTabs);
    fab.classList.toggle("hidden", !showTabs);
    tabbar?.classList.toggle("hidden", !showNav);
    root.classList.toggle("is-detail", !!showTabs);
    tabbar?.querySelectorAll(".nav-tab").forEach((button) => {
      const active = button.dataset.tab === activeTab;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
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

  function keywordChips(keywords, limit = 2) {
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

  function categoryPillHtml(video) {
    const section = sectionOf(video.section || "other");
    return `<span class="category-pill"><span class="category-dot" style="--section-color:${esc(
      section.color
    )}"></span>${esc(section.title)}</span>`;
  }

  function statusBadgeHtml(progress) {
    const state = watchState(progress);
    const symbol = state === "completed" ? "✓" : state === "in-progress" ? "▶" : "○";
    return `<span class="watch-status ${state}">${symbol} ${esc(
      watchLabel(progress, { compact: state === "in-progress" })
    )}</span>`;
  }

  function paintDetailLabels() {
    const labels = document.getElementById("detail-labels");
    if (!labels || !currentVideo) return;
    const progress = catalogProgress(currentVideo, loadProgressMap());
    labels.innerHTML = `${statusBadgeHtml(progress)}${categoryPillHtml(currentVideo)}`;
  }

  function videoCardHtml(video, progress, { compact = false } = {}) {
    const updated = videoUpdatedLabel(video);
    return `
      <article class="video-card${compact ? " is-compact" : ""}" data-slug="${esc(
        video.slug
      )}" tabindex="0" role="link" aria-label="${esc(`${video.title}. ${watchLabel(progress)}`)}">
        <div class="video-card-top">
          ${thumbProgressHtml(video, progress)}
          <div class="video-card-body">
            <p class="video-card-title">${esc(video.title)}${
              video.local ? ` <span class="badge-local">Local</span>` : ""
            }</p>
            <div class="video-card-meta">
              ${video.creator ? `<span>${esc(String(video.creator).replace(/-/g, " "))}</span>` : ""}
              ${video.duration_min ? `<span>${video.duration_min} min</span>` : ""}
              ${video.conceptCount ? `<span>${video.conceptCount} concepts</span>` : ""}
              ${!compact && updated ? `<span>${esc(updated)}</span>` : ""}
            </div>
            <div class="video-card-labels">
              ${statusBadgeHtml(progress)}
              ${categoryPillHtml(video)}
              ${
                video.has_insights === false
                  ? `<span class="content-badge">Summary only</span>`
                  : ""
              }
            </div>
          </div>
        </div>
        ${compact ? "" : keywordChips(video.keywords, 2)}
      </article>`;
  }

  function bindVideoCards(container = root) {
    container.querySelectorAll(".video-card").forEach((card) => {
      const open = () => openVideo(card.dataset.slug);
      card.addEventListener("click", (event) => {
        if (event.target.closest(".kw-chip")) return;
        open();
      });
      card.addEventListener("keydown", (event) => {
        if (event.target.closest(".kw-chip")) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
    container.querySelectorAll(".kw-chip").forEach((chip) => {
      chip.addEventListener("click", (event) => {
        event.stopPropagation();
        navigate(browseHash({ q: chip.dataset.kw || "", status: "all", section: "", sort: "smart" }));
      });
    });
  }

  function completionBar(pct, label) {
    return `
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
        aria-valuenow="${pct}" aria-label="${esc(label)}">
        <span class="progress-fill" style="width:${pct}%"></span>
      </div>`;
  }

  function categoryRowHtml(section, stats, visibleCount = stats.total, status = "all") {
    const filteredLabel =
      status === "all"
        ? `${stats.completed} of ${stats.total} completed`
        : `${visibleCount} ${status.replace("-", " ")}`;
    return `
      <button type="button" class="category-row${visibleCount ? "" : " is-empty"}"
        data-section="${esc(section.id)}" ${visibleCount ? "" : "disabled"}>
        <span class="category-icon" style="--section-color:${esc(section.color)}"></span>
        <span class="category-row-main">
          <span class="category-row-title">${esc(section.title)}</span>
          <span class="category-row-count">${esc(filteredLabel)}${
            stats.inProgress ? ` · ${stats.inProgress} in progress` : ""
          }</span>
          ${completionBar(stats.pct, `${section.title}: ${stats.pct}% completed`)}
        </span>
        <span class="category-chevron" aria-hidden="true">›</span>
      </button>`;
  }

  function renderHome() {
    destroyPlayer();
    setChrome({
      title: "Wiki Insights",
      showBack: false,
      showTabs: false,
      activeTab: "home",
      showNav: true,
    });
    currentVideo = null;
    currentInsights = null;
    const videos = allVideos();
    const progressMap = loadProgressMap();
    const game = loadGameStore();
    const summary = learningSummary(videos, progressMap, game);
    const badges = achievements(summary);
    const nextBadge = badges.find((badge) => !badge.unlocked);
    const inProgress = videos
      .filter((video) => watchState(catalogProgress(video, progressMap)) === "in-progress")
      .sort(
        (a, b) =>
          (progressMap[b.video_id]?.updated || 0) - (progressMap[a.video_id]?.updated || 0)
      );
    const notStarted = videos.find(
      (video) => watchState(catalogProgress(video, progressMap)) === "not-started"
    );
    const primaryVideo = inProgress[0] || notStarted || null;
    const primaryProgress = primaryVideo ? catalogProgress(primaryVideo, progressMap) : null;
    const primaryLabel = primaryVideo
      ? primaryProgress.started
        ? `Continue at ${primaryProgress.pct}%`
        : "Start learning"
      : "Review completed videos";

    root.innerHTML = `
      <section class="learning-hero" aria-labelledby="learning-title">
        <div class="hero-topline">
          <span class="eyebrow">Level ${summary.level}</span>
          <span class="hero-xp">${summary.xp} XP</span>
        </div>
        <h2 id="learning-title">${summary.completionPct}% of your library completed</h2>
        ${completionBar(summary.completionPct, `${summary.completionPct}% of library completed`)}
        <div class="status-stats">
          <button type="button" data-home-status="not-started">
            <strong>${summary.notStarted}</strong><span>Not started</span>
          </button>
          <button type="button" data-home-status="in-progress">
            <strong>${summary.inProgress}</strong><span>In progress</span>
          </button>
          <button type="button" data-home-status="completed">
            <strong>${summary.completed}</strong><span>Completed</span>
          </button>
        </div>
      </section>

      <button type="button" id="home-primary" class="primary-action"${
        primaryVideo ? ` data-slug="${esc(primaryVideo.slug)}"` : ""
      }>
        <span>
          <small>${esc(primaryLabel)}</small>
          <strong>${esc(primaryVideo?.title || "You completed the whole library")}</strong>
        </span>
        <span class="primary-arrow" aria-hidden="true">→</span>
      </button>

      ${
        inProgress.length
          ? `<section class="home-section" aria-labelledby="continue-title">
              <div class="section-heading">
                <div><span class="eyebrow">Pick up where you left off</span><h2 id="continue-title">Continue watching</h2></div>
                <button type="button" class="text-action" data-home-status="in-progress">See all</button>
              </div>
              <div class="video-grid">
                ${inProgress
                  .slice(0, 3)
                  .map((video) => videoCardHtml(video, catalogProgress(video, progressMap), { compact: true }))
                  .join("")}
              </div>
            </section>`
          : ""
      }

      <section class="home-section" aria-labelledby="categories-title">
        <div class="section-heading">
          <div><span class="eyebrow">Explore your library</span><h2 id="categories-title">Categories</h2></div>
          <button type="button" class="text-action" id="browse-all">Browse all</button>
        </div>
        <div class="category-list">
          ${sections()
            .map((section) =>
              categoryRowHtml(section, categoryProgress(videos, progressMap, section.id))
            )
            .join("")}
        </div>
      </section>

      <section class="milestone-card" aria-labelledby="milestone-title">
        <div class="milestone-icon" aria-hidden="true">${esc(nextBadge?.icon || "✓")}</div>
        <div>
          <span class="eyebrow">${nextBadge ? "Next achievement" : "Achievements complete"}</span>
          <h2 id="milestone-title">${esc(nextBadge?.title || "Every badge unlocked")}</h2>
          <p>${
            nextBadge
              ? `${esc(nextBadge.description)} · ${nextBadge.current}/${nextBadge.goal}`
              : "You have reached every current milestone."
          }</p>
        </div>
        <button type="button" id="view-progress" aria-label="Open progress">›</button>
      </section>
    `;

    root.querySelectorAll("[data-home-status]").forEach((button) => {
      button.addEventListener("click", () =>
        navigate(
          browseHash({
            q: "",
            status: button.dataset.homeStatus,
            section: "all",
            sort: "smart",
          })
        )
      );
    });
    root.querySelectorAll(".category-row").forEach((button) => {
      button.addEventListener("click", () =>
        navigate(browseHash({ q: "", status: "all", section: button.dataset.section, sort: "smart" }))
      );
    });
    document.getElementById("browse-all").addEventListener("click", () => navigate("#/browse"));
    document.getElementById("view-progress").addEventListener("click", () => navigate("#/progress"));
    document.getElementById("home-primary").addEventListener("click", () => {
      if (primaryVideo) openVideo(primaryVideo.slug);
      else navigate(browseHash({ q: "", status: "completed", section: "all", sort: "smart" }));
    });
    bindVideoCards();
    restoreReturnScroll();
  }

  function renderBrowse(state) {
    destroyPlayer();
    setChrome({
      title: "Browse videos",
      showBack: false,
      showTabs: false,
      activeTab: "browse",
      showNav: true,
    });
    currentVideo = null;
    currentInsights = null;
    const videos = allVideos();
    const progressMap = loadProgressMap();
    const validSections = new Set(["all", ...sections().map((section) => section.id)]);
    if (state.section && !validSections.has(state.section)) state.section = "";

    const totals = progressCounts(videos, progressMap);
    const q = state.q.trim().toLowerCase();
    let filtered = videos.filter((video) => matchesQuery(video, q));
    if (state.status !== "all") {
      filtered = filtered.filter(
        (video) => watchState(catalogProgress(video, progressMap)) === state.status
      );
    }
    if (state.section && state.section !== "all") {
      filtered = filtered.filter((video) => (video.section || "other") === state.section);
    }
    filtered = sortVideos(filtered, state.sort, progressMap);

    const showVideos = !!state.section || !!q;
    const selectedSection =
      state.section && state.section !== "all" ? sectionOf(state.section) : null;
    const statusOptions = [
      ["all", "All", totals.total],
      ["not-started", "Not started", totals.notStarted],
      ["in-progress", "In progress", totals.inProgress],
      ["completed", "Completed", totals.completed],
    ];
    const resultLabel = selectedSection
      ? `${selectedSection.title} · ${filtered.length} video${filtered.length === 1 ? "" : "s"}`
      : state.section === "all" || q
        ? `${filtered.length} video${filtered.length === 1 ? "" : "s"}`
        : "Choose a category";

    root.innerHTML = `
      <section class="browse-tools" aria-label="Browse controls">
        <label class="sr-only" for="browse-search">Search videos</label>
        <div class="search-field">
          <span aria-hidden="true">⌕</span>
          <input id="browse-search" type="search" placeholder="Search title, creator, or keyword"
            value="${esc(state.q)}" autocomplete="off" />
        </div>
        <div class="filter-row" aria-label="Watch status">
          ${statusOptions
            .map(
              ([value, label, count]) =>
                `<button type="button" class="filter-chip${state.status === value ? " active" : ""}"
                  data-status="${value}" aria-pressed="${state.status === value}">
                  ${label}<span>${count}</span>
                </button>`
            )
            .join("")}
        </div>
        <details class="add-video">
          <summary>Add a YouTube video</summary>
          <div class="url-bar">
            <label class="sr-only" for="url-input">YouTube URL</label>
            <input id="url-input" type="url" placeholder="Paste a YouTube link" autocomplete="off" />
            <button type="button" id="url-go" class="url-go">Open</button>
          </div>
        </details>
      </section>

      <div class="browse-result-head">
        <div>
          ${state.section ? `<button type="button" id="back-categories" class="back-link">← Categories</button>` : ""}
          <p class="result-label">${esc(resultLabel)}</p>
        </div>
        ${
          showVideos
            ? `<label class="sort-label">Sort
                <select id="sort-select">
                  <option value="smart"${state.sort === "smart" ? " selected" : ""}>Continue / newest</option>
                  <option value="updated"${state.sort === "updated" ? " selected" : ""}>Recently updated</option>
                  <option value="az"${state.sort === "az" ? " selected" : ""}>A–Z</option>
                </select>
              </label>`
            : ""
        }
      </div>

      ${
        showVideos
          ? `<div id="catalog-list" class="video-grid">
              ${
                filtered.length
                  ? filtered
                      .map((video) => videoCardHtml(video, catalogProgress(video, progressMap)))
                      .join("")
                  : `<div class="empty-state">
                      <div aria-hidden="true">⌕</div>
                      <h2>No videos match</h2>
                      <p>Try another status, category, or search.</p>
                      <button type="button" id="clear-filters" class="secondary-action">Clear filters</button>
                    </div>`
              }
            </div>`
          : `<div class="category-list browse-categories">
              <button type="button" class="category-row all-videos-row" data-section="all">
                <span class="category-icon all-icon" aria-hidden="true">≡</span>
                <span class="category-row-main">
                  <span class="category-row-title">All videos</span>
                  <span class="category-row-count">${totals.total} total · ${totals.inProgress} in progress · ${totals.completed} completed</span>
                </span>
                <span class="category-chevron" aria-hidden="true">›</span>
              </button>
              ${sections()
                .map((section) => {
                  const stats = categoryProgress(videos, progressMap, section.id);
                  const visible =
                    state.status === "all"
                      ? stats.total
                      : state.status === "completed"
                        ? stats.completed
                        : state.status === "in-progress"
                          ? stats.inProgress
                          : stats.notStarted;
                  return categoryRowHtml(section, stats, visible, state.status);
                })
                .join("")}
            </div>`
      }
    `;

    const input = document.getElementById("browse-search");
    input.addEventListener("input", () => {
      updateBrowseState({ q: input.value }, { replace: true, focusSearch: true });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const id = extractVideoId(input.value);
      if (id) {
        e.preventDefault();
        handleIncomingUrl(input.value);
      }
    });
    root.querySelectorAll("[data-status]").forEach((button) => {
      button.addEventListener("click", () => {
        const status = button.dataset.status;
        updateBrowseState({
          status,
          section: !state.section && status !== "all" ? "all" : state.section,
        });
      });
    });
    root.querySelectorAll(".category-row").forEach((button) => {
      button.addEventListener("click", () =>
        updateBrowseState({ section: button.dataset.section, q: "" })
      );
    });
    document.getElementById("back-categories")?.addEventListener("click", () =>
      updateBrowseState({ section: "", q: "" })
    );
    document.getElementById("sort-select")?.addEventListener("change", (event) =>
      updateBrowseState({ sort: event.target.value })
    );
    document.getElementById("clear-filters")?.addEventListener("click", () =>
      navigate("#/browse")
    );
    document.getElementById("url-go").addEventListener("click", () => {
      handleIncomingUrl(document.getElementById("url-input").value);
    });
    document.getElementById("url-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleIncomingUrl(e.target.value);
    });
    bindVideoCards();
    restoreReturnScroll();
  }

  function renderProgress() {
    destroyPlayer();
    setChrome({
      title: "Your progress",
      showBack: false,
      showTabs: false,
      activeTab: "progress",
      showNav: true,
    });
    currentVideo = null;
    currentInsights = null;
    const videos = allVideos();
    const progressMap = loadProgressMap();
    const summary = learningSummary(videos, progressMap);
    const badges = achievements(summary);
    const levelPct = Math.round((summary.levelXp / XP_PER_LEVEL) * 100);
    const nextBadge = badges.find((badge) => !badge.unlocked);

    root.innerHTML = `
      <section class="level-card" aria-labelledby="level-title">
        <div class="level-orb" aria-hidden="true">${summary.level}</div>
        <div class="level-main">
          <span class="eyebrow">Current level</span>
          <h2 id="level-title">Level ${summary.level}</h2>
          <p>${summary.levelXp} / ${XP_PER_LEVEL} XP to level ${summary.level + 1}</p>
          ${completionBar(levelPct, `${summary.levelXp} of ${XP_PER_LEVEL} XP toward next level`)}
        </div>
        <strong>${summary.xp} XP</strong>
      </section>

      <div class="progress-stat-grid">
        <button type="button" data-progress-status="completed">
          <strong>${summary.completed}</strong><span>Completed</span>
        </button>
        <div><strong>${summary.streak}</strong><span>Day streak</span></div>
        <div><strong>${summary.exploredCategories}</strong><span>Categories</span></div>
      </div>

      <section class="progress-overview" aria-labelledby="overview-title">
        <div class="section-heading">
          <div><span class="eyebrow">Library progress</span><h2 id="overview-title">${summary.completionPct}% completed</h2></div>
          <strong>${summary.completed}/${summary.total}</strong>
        </div>
        ${completionBar(summary.completionPct, `${summary.completionPct}% of library completed`)}
        <div class="progress-metrics">
          <div><strong>${summary.inProgress}</strong><span>In progress</span></div>
          <div><strong>${summary.conceptsEncountered}</strong><span>Concepts encountered</span></div>
          <div><strong>${summary.activeDays}</strong><span>Active days</span></div>
        </div>
      </section>

      ${
        nextBadge
          ? `<section class="next-badge">
              <span class="milestone-icon" aria-hidden="true">${esc(nextBadge.icon)}</span>
              <div><span class="eyebrow">Next achievement</span><h2>${esc(nextBadge.title)}</h2>
              <p>${esc(nextBadge.description)} · ${nextBadge.current}/${nextBadge.goal}</p></div>
            </section>`
          : ""
      }

      <section class="home-section" aria-labelledby="badges-title">
        <div class="section-heading">
          <div><span class="eyebrow">Milestones</span><h2 id="badges-title">Achievements</h2></div>
          <span class="achievement-total">${badges.filter((badge) => badge.unlocked).length}/${badges.length}</span>
        </div>
        <div class="achievement-grid">
          ${badges
            .map(
              (badge) => `
                <article class="achievement-card${badge.unlocked ? " unlocked" : " locked"}">
                  <div class="achievement-icon" aria-hidden="true">${esc(badge.icon)}</div>
                  <h3>${esc(badge.title)}</h3>
                  <p>${esc(badge.description)}</p>
                  <span>${badge.unlocked ? "Unlocked" : `${badge.current}/${badge.goal}`}</span>
                </article>`
            )
            .join("")}
        </div>
      </section>

      <p class="local-note">Progress, XP, streaks, and badges are stored only in this browser.</p>
    `;
    root.querySelectorAll("[data-progress-status]").forEach((button) => {
      button.addEventListener("click", () =>
        navigate(
          browseHash({
            q: "",
            status: button.dataset.progressStatus,
            section: "all",
            sort: "smart",
          })
        )
      );
    });
    restoreReturnScroll();
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
    body.setAttribute("aria-labelledby", `tab-${panel}`);
    tabToggle.querySelectorAll(".seg").forEach((b) => {
      const active = b.dataset.panel === panel;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
      b.tabIndex = active ? 0 : -1;
    });
    body.innerHTML =
      panel === "summary"
        ? renderSummaryHtml(currentVideo)
        : panel === "concepts"
          ? renderConceptsHtml(currentVideo)
          : renderInsightsHtml(currentInsights);
    body.querySelectorAll(".kw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        navigate(
          browseHash({ q: chip.dataset.kw || "", status: "all", section: "", sort: "smart" })
        );
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
    setChrome({ title: "", showBack: true, showTabs: true, showNav: false });
    currentVideo = v;
    panel = "insights";
    const startAt = v.video_id ? getSavedSeconds(v.video_id) : 0;
    const progress = catalogProgress(v, loadProgressMap());
    const showResumeBar = startAt >= RESUME_MIN_SEC || progress.done;
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
      <div id="resume-bar" class="resume-bar${showResumeBar ? "" : " hidden"}">
        <span id="resume-label">${
          progress.done ? "Marked completed" : startAt ? `Resuming from ${formatClock(startAt)}` : ""
        }</span>
        <button type="button" id="restart-video">Start over</button>
      </div>
      <h1 class="detail-title">${esc(v.title)}${
        videoUpdatedLabel(v) ? ` · ${esc(videoUpdatedLabel(v))}` : ""
      }</h1>
      <div id="detail-labels" class="detail-labels">
        ${statusBadgeHtml(progress)}
        ${categoryPillHtml(v)}
      </div>
      ${keywordChips(v.keywords, 8)}
      <div id="detail-body" role="tabpanel" tabindex="0"><div class="empty">Loading…</div></div>
    `;
    root.querySelectorAll(".kw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        navigate(
          browseHash({ q: chip.dataset.kw || "", status: "all", section: "", sort: "smart" })
        );
      });
    });
    if (v.video_id) {
      bindResumeBar(v.video_id);
      bindResumePlayer(v.video_id, startAt);
    }
    const insights = await loadInsights(slug);
    const activeRoute = parseRoute();
    if (
      currentVideo?.slug !== slug ||
      activeRoute.name !== "detail" ||
      activeRoute.slug !== slug
    ) {
      return;
    }
    currentInsights = insights;
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

    setChrome({ title: "Creating…", showBack: true, showTabs: false, showNav: false });
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
        section: "other",
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
      const next = new URL(location.href);
      next.searchParams.delete("url");
      next.searchParams.delete("v");
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
      openVideo(hit.slug);
      return;
    }
    if (extractVideoId(value)) {
      rememberReturnRoute();
      await createFromYoutube(value);
      return;
    }
    toast("Paste a YouTube URL");
  }

  async function route({ focusView = false } = {}) {
    if (!CATALOG) return;
    const pending = queryUrlParam();
    if (pending && !location.hash.includes("/v/")) {
      // Consume query once into create/open flow
      const u = new URL(location.href);
      u.searchParams.delete("url");
      u.searchParams.delete("v");
      history.replaceState(null, "", u.pathname + u.hash);
      await handleIncomingUrl(pending);
      if (focusView) requestAnimationFrame(() => root.focus({ preventScroll: true }));
      return;
    }
    const r = parseRoute();
    if (r.name === "detail") await renderDetail(r.slug);
    else if (r.name === "browse") renderBrowse(r);
    else if (r.name === "progress") renderProgress();
    else renderHome();
    if (focusView) requestAnimationFrame(() => root.focus({ preventScroll: true }));
  }

  backBtn.addEventListener("click", returnFromDetail);
  tabbar?.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-tab");
    if (!button) return;
    const routes = { home: "#/", browse: "#/browse", progress: "#/progress" };
    navigate(routes[button.dataset.tab] || "#/");
  });
  tabToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    panel = btn.dataset.panel;
    paintDetailBody();
  });
  tabToggle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const buttons = [...tabToggle.querySelectorAll(".seg")];
    const current = Math.max(0, buttons.findIndex((button) => button.dataset.panel === panel));
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = buttons[(current + delta + buttons.length) % buttons.length];
    panel = next.dataset.panel;
    paintDetailBody();
    next.focus();
    event.preventDefault();
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
    route({ focusView: true });
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
      bootstrapGamification();
      return route();
    })
    .catch((err) => {
      root.innerHTML = `<div class="empty">Failed to load catalog.<br/>${esc(err.message)}</div>`;
    });
})();
