const state = {
  results: [],
  jobs: [],
  selectedType: "album",
  pollTimer: null,
};

const els = {
  health: document.querySelector("#health"),
  query: document.querySelector("#query"),
  mediaType: document.querySelector("#mediaType"),
  quality: document.querySelector("#quality"),
  searchButton: document.querySelector("#searchButton"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#resultCount"),
  queue: document.querySelector("#queue"),
  refreshQueue: document.querySelector("#refreshQueue"),
};

function formatDuration(seconds) {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  const remaining = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function qualityLabel(item) {
  if (!item.maximumBitDepth || !item.maximumSamplingRate) return "";
  return `${item.maximumBitDepth}bit / ${item.maximumSamplingRate}kHz`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed with ${response.status}`);
  }
  return data;
}

async function checkHealth() {
  try {
    const health = await api("/api/health");
    els.health.textContent = health.qobuzConfigured
      ? `Ready. Imports to ${health.musicDir}`
      : "QOBUZ_APP_ID is not configured.";
  } catch (error) {
    els.health.textContent = error.message;
  }
}

async function search() {
  const q = els.query.value.trim();
  const type = els.mediaType.value;
  if (q.length < 2) return;

  state.selectedType = type;
  els.searchButton.disabled = true;
  els.results.className = "results empty";
  els.results.textContent = "Searching Qobuz...";
  els.resultCount.textContent = "";

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}&type=${type}&limit=20`);
    state.results = data.items || [];
    renderResults();
  } catch (error) {
    els.results.className = "results empty";
    els.results.textContent = error.message;
  } finally {
    els.searchButton.disabled = false;
  }
}

function renderResults() {
  els.resultCount.textContent = state.results.length ? `${state.results.length} found` : "";
  if (!state.results.length) {
    els.results.className = "results empty";
    els.results.textContent = "No matching Qobuz results.";
    return;
  }

  els.results.className = "results";
  els.results.innerHTML = state.results.map(renderResult).join("");
  document.querySelectorAll("[data-download-id]").forEach((button) => {
    button.addEventListener("click", () => enqueueDownload(button.dataset.downloadId));
  });
}

function renderResult(item) {
  const cover = item.cover
    ? `<img class="cover" src="${escapeHtml(item.cover)}" alt="" />`
    : `<div class="cover fallbackCover">♪</div>`;
  const meta =
    item.type === "album"
      ? [item.artist, item.year, item.tracksCount ? `${item.tracksCount} tracks` : ""]
      : [item.artist, item.album, formatDuration(item.duration)];
  const badges = [
    item.hires ? `<span class="badge hires">Hi-Res</span>` : "",
    item.explicit ? `<span class="badge explicit">Explicit</span>` : "",
    qualityLabel(item) ? `<span class="badge">${escapeHtml(qualityLabel(item))}</span>` : "",
  ].join("");

  return `
    <article class="resultItem">
      ${cover}
      <div>
        <div class="itemTitle">${escapeHtml(item.title)}</div>
        <div class="itemMeta">${escapeHtml(meta.filter(Boolean).join(" · "))}</div>
        <div class="badges">${badges}</div>
      </div>
      <button data-download-id="${escapeHtml(item.id)}">Download</button>
    </article>
  `;
}

async function enqueueDownload(id) {
  const item = state.results.find((result) => result.id === id);
  if (!item) return;

  await api("/api/downloads", {
    method: "POST",
    body: JSON.stringify({
      mediaType: item.type,
      id: item.id,
      quality: Number(els.quality.value),
      title: item.title,
      artist: item.artist,
    }),
  });
  await loadQueue();
  startPolling();
}

async function loadQueue() {
  try {
    const data = await api("/api/downloads");
    state.jobs = data.items || [];
    renderQueue();
  } catch (error) {
    els.queue.className = "queue empty";
    els.queue.textContent = error.message;
  }
}

function renderQueue() {
  if (!state.jobs.length) {
    els.queue.className = "queue empty";
    els.queue.textContent = "No downloads queued.";
    return;
  }

  els.queue.className = "queue";
  els.queue.innerHTML = state.jobs.map(renderJob).join("");
  document.querySelectorAll("[data-retry-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/downloads/${button.dataset.retryId}/retry`, { method: "POST" });
      await loadQueue();
      startPolling();
    });
  });
}

function renderJob(job) {
  const title = job.title || `${job.mediaType} ${job.mediaId}`;
  const meta = [job.artist, `Q${job.quality}`, job.error].filter(Boolean).join(" · ");
  const log = (job.log || []).slice(-8).join("\n");
  const retry =
    job.status === "failed"
      ? `<div class="queueActions"><button class="secondary" data-retry-id="${escapeHtml(job.id)}">Retry</button></div>`
      : "";

  return `
    <article class="queueItem">
      <div>
        <div class="itemTitle">${escapeHtml(title)}</div>
        <div class="itemMeta">${escapeHtml(meta)}</div>
      </div>
      <span class="status ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
      ${log ? `<pre class="queueLog">${escapeHtml(log)}</pre>` : ""}
      ${retry}
    </article>
  `;
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(async () => {
    await loadQueue();
    const active = state.jobs.some((job) => ["queued", "downloading", "importing"].includes(job.status));
    if (!active) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }, 2500);
}

els.searchButton.addEventListener("click", search);
els.query.addEventListener("keydown", (event) => {
  if (event.key === "Enter") search();
});
els.refreshQueue.addEventListener("click", loadQueue);

checkHealth();
loadQueue();
