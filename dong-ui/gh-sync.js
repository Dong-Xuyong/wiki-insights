/**
 * dong-ui GitHub progress sync: one JSON file per app in a private repo.
 * The token lives in localStorage, shared by every app on this origin.
 *
 *   GhSync.save(appId, getPayload, applyPayload) -> Promise<message>
 *   GhSync.load(appId, applyPayload)             -> Promise<message>
 *   GhSync.read(appId) -> Promise<data|null>
 *       GET only, same Contents request and token as load/save. Does not
 *       prompt. Resolves null when there is no token, the file is missing
 *       (404), or the body is empty. Never writes. save refuses "*-agent".
 */
(function (global) {
  "use strict";

  var CONFIG_KEY = "dong-gh-sync";
  var DEFAULT_REPO = "Dong-Xuyong/progress-sync";
  var API = "https://api.github.com/repos/";

  function peekConfig() {
    try {
      var cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (cfg && cfg.token) return cfg;
    } catch (e) {}
    return null;
  }

  function isAgentSideFile(appId) {
    return /-agent$/.test(String(appId || ""));
  }

  function getConfig() {
    var cfg = peekConfig();
    if (cfg) return cfg;
    var token = global.prompt(
      "Paste a GitHub fine-grained token with Contents read/write on " +
        DEFAULT_REPO +
        " only.\nIt is saved in this browser for all your apps."
    );
    if (!token || !token.trim()) throw new Error("No GitHub token, sync cancelled");
    cfg = { token: token.trim(), repo: DEFAULT_REPO };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function fromBase64(b64) {
    return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ""))));
  }

  function request(cfg, method, path, body) {
    return fetch(API + cfg.repo + "/contents/" + path, {
      method: method,
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + cfg.token,
        Accept: "application/vnd.github+json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem(CONFIG_KEY);
        throw new Error("GitHub token rejected; you will be asked for a new one");
      }
      if (res.status === 404 && method === "GET") return null;
      if (res.status === 409) throw new Error("Saved from another device meanwhile; try again");
      if (!res.ok) throw new Error("GitHub error " + res.status);
      return res.json();
    });
  }

  function fetchRemote(cfg, appId) {
    return request(cfg, "GET", appId + ".json").then(function (file) {
      if (!file) return null;
      return { sha: file.sha, data: JSON.parse(fromBase64(file.content)) };
    });
  }

  function read(appId) {
    var cfg = peekConfig();
    if (!cfg) return Promise.resolve(null);
    return request(cfg, "GET", appId + ".json").then(function (file) {
      if (!file || file.content == null) return null;
      var text = "";
      try {
        text = fromBase64(file.content).trim();
      } catch (e) {
        return null;
      }
      if (!text) return null;
      return JSON.parse(text);
    });
  }

  function save(appId, getPayload, applyPayload) {
    if (isAgentSideFile(appId)) {
      return Promise.reject(new Error("Agent side files are read-only"));
    }
    var cfg;
    if (
      !global.confirm("Save " + appId + " progress to GitHub?") ||
      !global.confirm("Are you sure? This updates the copy your other devices load.")
    ) {
      return Promise.reject(new Error("Save cancelled"));
    }
    try {
      cfg = getConfig();
    } catch (e) {
      return Promise.reject(e);
    }
    return fetchRemote(cfg, appId).then(function (remote) {
      if (remote) applyPayload(remote.data);
      var body = {
        message: "Save " + appId + " progress",
        content: toBase64(JSON.stringify(getPayload())),
      };
      if (remote) body.sha = remote.sha;
      return request(cfg, "PUT", appId + ".json", body).then(function () {
        return "Saved to GitHub";
      });
    });
  }

  function load(appId, applyPayload) {
    var cfg;
    try {
      cfg = getConfig();
    } catch (e) {
      return Promise.reject(e);
    }
    return fetchRemote(cfg, appId).then(function (remote) {
      if (!remote) return "Nothing saved on GitHub yet";
      applyPayload(remote.data);
      return "Imported from GitHub";
    });
  }

  global.GhSync = { save: save, load: load, read: read };
})(typeof window !== "undefined" ? window : globalThis);
