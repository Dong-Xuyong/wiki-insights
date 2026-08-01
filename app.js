(() => {
  const root = document.getElementById("view-root");
  const topTitle = document.getElementById("topbar-title");
  const backBtn = document.getElementById("back-btn");
  const tabToggle = document.getElementById("tab-toggle");
  const fab = document.getElementById("fab");
  const fabCopy = document.getElementById("fab-copy");
  const fabShare = document.getElementById("fab-share");

  const LOCAL_KEY = "wiki-insights-local-v1";
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

  function allVideos() {
    const map = new Map();
    for (const v of CATALOG.videos || []) map.set(v.slug, v);
    for (const v of localVideos) map.set(v.slug, { ...v, local: true });
    return [...map.values()];
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
    setChrome({ title: "Wiki Insights", showBack: false, showTabs: false });
    currentVideo = null;
    currentInsights = null;
    const q = searchQ.trim().toLowerCase();
    const videos = allVideos().filter((v) => matchesQuery(v, q));
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
      <p class="catalog-meta">${videos.length} videos · click a keyword chip to filter</p>
      <div id="catalog-list">
        ${videos
          .map(
            (v) => `
          <button type="button" class="video-card" data-slug="${esc(v.slug)}">
            <p class="video-card-title">${esc(v.title)}${
              v.local ? ` <span class="badge-local">Local</span>` : ""
            }</p>
            <div class="video-card-meta">
              ${v.creator ? `<span>${esc(String(v.creator).replace(/-/g, " "))}</span>` : ""}
              ${v.duration_min ? `<span>${v.duration_min} min</span>` : ""}
            </div>
            ${keywordChips(v.keywords)}
          </button>`
          )
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
    root.querySelectorAll(".video-card").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (e.target.closest(".kw-chip")) return;
        navigate(`#/v/${btn.dataset.slug}`);
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
      panel === "summary" ? renderSummaryHtml(currentVideo) : renderInsightsHtml(currentInsights);
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
      root.innerHTML = `<div class="empty">Video not found.</div>`;
      return;
    }
    setChrome({ title: "", showBack: true, showTabs: true });
    currentVideo = v;
    panel = "insights";
    root.innerHTML = `
      <div class="player-wrap">
        ${
          v.video_id
            ? `<iframe src="https://www.youtube.com/embed/${esc(v.video_id)}" title="${esc(
                v.title
              )}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>`
            : `<div class="missing-insights">No video id</div>`
        }
      </div>
      <p class="detail-title">${esc(v.title)}</p>
      ${keywordChips(v.keywords, 8)}
      <div id="detail-body"><div class="empty">Loading…</div></div>
    `;
    root.querySelectorAll(".kw-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        searchQ = chip.dataset.kw || "";
        navigate("#/");
      });
    });
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
