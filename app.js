(() => {
  const root = document.getElementById("view-root");
  const topTitle = document.getElementById("topbar-title");
  const backBtn = document.getElementById("back-btn");
  const tabToggle = document.getElementById("tab-toggle");
  const fab = document.getElementById("fab");
  const fabCopy = document.getElementById("fab-copy");
  const fabShare = document.getElementById("fab-share");

  let CATALOG = null;
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
    toast._t = setTimeout(() => el.classList.remove("show"), 1600);
  }

  function parseRoute() {
    const h = (location.hash || "#/").replace(/^#/, "");
    const m = h.match(/^\/v\/([^/?#]+)/);
    if (m) return { name: "detail", slug: decodeURIComponent(m[1]) };
    return { name: "catalog" };
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

  function renderCatalog() {
    setChrome({ title: "Wiki Insights", showBack: false, showTabs: false });
    currentVideo = null;
    currentInsights = null;
    const q = searchQ.trim().toLowerCase();
    const videos = (CATALOG.videos || []).filter((v) => {
      if (!q) return true;
      const hay = [v.title, v.creator, ...(v.tags || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
    root.innerHTML = `
      <div class="search-wrap">
        <input id="search" type="search" placeholder="Search videos…" value="${esc(searchQ)}" autocomplete="off" />
      </div>
      <p class="catalog-meta">${videos.length} videos · ${CATALOG.insightsCount || 0} with Insights</p>
      <div id="catalog-list">
        ${videos
          .map(
            (v) => `
          <button type="button" class="video-card" data-slug="${esc(v.slug)}">
            <p class="video-card-title">${esc(v.title)}</p>
            <div class="video-card-meta">
              ${v.creator ? `<span>${esc(v.creator.replace(/-/g, " "))}</span>` : ""}
              ${v.duration_min ? `<span>${v.duration_min} min</span>` : ""}
              ${v.has_insights ? `<span class="badge-insights">Insights</span>` : ""}
            </div>
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
    root.querySelectorAll(".video-card").forEach((btn) => {
      btn.addEventListener("click", () => navigate(`#/v/${btn.dataset.slug}`));
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
          <div class="qa-q"><span class="emoji">${esc(it.e || "💡")}</span><span><span class="label">Q:</span> ${rich(it.q)}</span></div>
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
    return `<div class="summary-body">${paras || "<p>No summary on file.</p>"}${keys}</div>`;
  }

  function paintDetailBody() {
    const body = document.getElementById("detail-body");
    if (!body || !currentVideo) return;
    tabToggle.querySelectorAll(".seg").forEach((b) => {
      b.classList.toggle("active", b.dataset.panel === panel);
    });
    body.innerHTML =
      panel === "summary" ? renderSummaryHtml(currentVideo) : renderInsightsHtml(currentInsights);
  }

  async function renderDetail(slug) {
    const v = (CATALOG.videos || []).find((x) => x.slug === slug);
    if (!v) {
      root.innerHTML = `<div class="empty">Video not found.</div>`;
      return;
    }
    setChrome({ title: "", showBack: true, showTabs: true });
    currentVideo = v;
    panel = v.has_insights ? "insights" : "summary";
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
      <div id="detail-body"><div class="empty">Loading…</div></div>
    `;
    currentInsights = await loadInsights(slug);
    paintDetailBody();
  }

  async function route() {
    if (!CATALOG) return;
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
    const shareData = {
      title: currentVideo.title,
      text,
      url: currentVideo.url || location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.title}\n${shareData.url}\n\n${text}`);
        toast("Copied link + text");
      }
    } catch {
      /* user cancelled */
    }
  });

  window.addEventListener("hashchange", () => {
    route();
  });

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
