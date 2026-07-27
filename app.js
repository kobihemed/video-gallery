// ======= CONFIGURE THESE TWO VALUES AFTER DEPLOYING THE WORKER =======
const API_BASE = "https://video-gallery-api.kobihemed.workers.dev";

// SHA-256 hash of "kobiadmin"
const TRIGGER_HASH = "055bf1bc44c107144e5fa64117ae87b1c1dfef38ca15eddbfe48ea0ca64696f8";
// =======================================================================

const DEFAULT_SETTINGS = {
  pageTitle: "Video Gallery",
  columns: 4,
  gap: 20,
  cellHeight: "auto",
  padding: 0,
  pageBg: "#14161a",
  headerColor: "#f0f0f0",
  bgColor: "#1e2126",
  cardTextColor: "#f0f0f0",
  borderWidth: 0,
  borderColor: "#3a3f47",
  badgeBg: "#000000",
  badgeText: "#ffffff"
};

let adminToken = null;
let currentVideos = [];
let sections = [{ id: "default", title: "All Videos" }];
let gridSettings = { ...DEFAULT_SETTINGS };

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Secret Keystroke Trigger ----
let keyBuffer = "";
window.addEventListener("keydown", async (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  if (e.key.length > 1 && e.key !== "Backspace") return;

  keyBuffer = (keyBuffer + e.key).slice(-20);
  const hash = await sha256(keyBuffer);

  if (hash === TRIGGER_HASH) {
    keyBuffer = "";
    document.getElementById("admin-modal").classList.remove("hidden");
  }
});

// ---- Apply Dynamic Styles & Colors ----
function applyGridStyles() {
  const root = document.documentElement;
  root.style.setProperty("--page-bg", gridSettings.pageBg);
  root.style.setProperty("--header-color", gridSettings.headerColor);
  root.style.setProperty("--grid-columns", gridSettings.columns);
  root.style.setProperty("--grid-gap", `${gridSettings.gap}px`);
  root.style.setProperty("--cell-height", gridSettings.cellHeight);
  root.style.setProperty("--card-padding", `${gridSettings.padding}px`);
  root.style.setProperty("--card-bg", gridSettings.bgColor);
  root.style.setProperty("--card-text-color", gridSettings.cardTextColor);
  root.style.setProperty("--card-border-width", `${gridSettings.borderWidth}px`);
  root.style.setProperty("--card-border-color", gridSettings.borderColor);
  root.style.setProperty("--badge-bg", gridSettings.badgeBg);
  root.style.setProperty("--badge-text", gridSettings.badgeText);

  const headingEl = document.getElementById("page-title-heading");
  if (headingEl) {
    headingEl.textContent = gridSettings.pageTitle || "Video Gallery";
  }
}

// ---- Sync Inputs with Local State ----
function syncSettingsInputs() {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal("setting-page-title", gridSettings.pageTitle);
  setVal("setting-columns", gridSettings.columns);
  setVal("setting-gap", gridSettings.gap);
  setVal("setting-cell-height", gridSettings.cellHeight);
  setVal("setting-padding", gridSettings.padding);
  setVal("setting-page-bg", gridSettings.pageBg);
  setVal("setting-header-color", gridSettings.headerColor);
  setVal("setting-bg-color", gridSettings.bgColor);
  setVal("setting-card-text-color", gridSettings.cardTextColor);
  setVal("setting-border-width", gridSettings.borderWidth);
  setVal("setting-border-color", gridSettings.borderColor);
  setVal("setting-badge-bg", gridSettings.badgeBg);
  setVal("setting-badge-text", gridSettings.badgeText);
}

// ---- Live Color Pickers ----
function bindLiveColorPickers() {
  const colorMap = [
    { id: "setting-page-bg", key: "pageBg" },
    { id: "setting-header-color", key: "headerColor" },
    { id: "setting-bg-color", key: "bgColor" },
    { id: "setting-card-text-color", key: "cardTextColor" },
    { id: "setting-border-color", key: "borderColor" },
    { id: "setting-badge-bg", key: "badgeBg" },
    { id: "setting-badge-text", key: "badgeText" }
  ];

  colorMap.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", (e) => {
        gridSettings[key] = e.target.value;
        applyGridStyles();
      });
    }
  });

  const titleInput = document.getElementById("setting-page-title");
  if (titleInput) {
    titleInput.addEventListener("input", (e) => {
      gridSettings.pageTitle = e.target.value;
      applyGridStyles();
    });
  }
}

// ---- Save Remote Settings Helper ----
async function saveRemoteSettings() {
  gridSettings.sections = sections;
  if (!adminToken) return;

  try {
    await fetch(`${API_BASE}/save-grid-settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(gridSettings),
    });
  } catch (err) {
    console.warn("Unable to save settings remotely", err);
  }
}

// ---- Load Gallery & Remote Settings ----
async function loadGallery() {
  try {
    const [vidRes, setRes] = await Promise.all([
      fetch(`${API_BASE}/videos`),
      fetch(`${API_BASE}/grid-settings`).catch(() => null)
    ]);

    if (vidRes && vidRes.ok) {
      currentVideos = await vidRes.json();
    } else {
      currentVideos = [];
    }

    if (setRes && setRes.ok) {
      const savedSettings = await setRes.json();
      if (savedSettings.sections && Array.isArray(savedSettings.sections) && savedSettings.sections.length > 0) {
        sections = savedSettings.sections;
      }
      gridSettings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    applyGridStyles();
    syncSettingsInputs();
    populateSectionDropdown();
    renderSectionList();
    renderGallery();

    if (adminToken) {
      renderAdminList();
    }
  } catch (err) {
    console.error("Failed to load gallery/settings", err);
  }
}

// ---- Render Main Page by Sections ----
function renderGallery() {
  const container = document.getElementById("gallery-container");
  container.innerHTML = "";

  if (!currentVideos || currentVideos.length === 0) {
    container.innerHTML = '<p id="empty-msg" style="text-align:center; padding:40px; color:#888;">No videos yet.</p>';
    return;
  }

  // Create section mapping bucket
  const sectionMap = {};
  sections.forEach((sec) => {
    sectionMap[sec.id] = { title: sec.title, videos: [] };
  });

  // Fallback for default
  if (!sectionMap["default"]) {
    sectionMap["default"] = { title: "Videos", videos: [] };
  }

  // Group videos into their respective section
  currentVideos.forEach((v) => {
    const secId = v.sectionId && sectionMap[v.sectionId] ? v.sectionId : "default";
    sectionMap[secId].videos.push(v);
  });

  // Render sections with videos
  sections.forEach((sec) => {
    const secData = sectionMap[sec.id];
    if (!secData || secData.videos.length === 0) return;

    if (sections.length > 1 || sec.id !== "default") {
      const header = document.createElement("h2");
      header.className = "section-header";
      header.textContent = secData.title;
      container.appendChild(header);
    }

    const grid = document.createElement("div");
    grid.className = "grid";

    secData.videos.forEach((v) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="thumb-container">
          <div class="thumb" style="background-image:url('${v.thumbnail || ""}')"></div>
          ${v.duration ? `<span class="duration-badge">${escapeHtml(v.duration)}</span>` : ""}
        </div>
        <div class="title">${escapeHtml(v.title)}</div>
      `;
      card.addEventListener("click", () => playVideo(v.id, v.title));
      grid.appendChild(card);
    });

    container.appendChild(grid);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---- Embed Parsing ----
function getEmbedUrl(rawUrl) {
  if (!rawUrl) return null;

  const ytMatch = rawUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1`;
  }

  const streamableMatch = rawUrl.match(/streamable\.com\/(?:e\/)?([a-zA-Z0-9]+)/);
  if (streamableMatch && streamableMatch[1]) {
    return `https://streamable.com/e/${streamableMatch[1]}?autoplay=1`;
  }

  return null;
}

// ---- Video Player Modal ----
function playVideo(id, title) {
  const player = document.getElementById("player");
  const iframe = document.getElementById("iframe-player");
  document.getElementById("player-title").textContent = title;

  const videoObj = currentVideos.find((v) => v.id === id);
  let rawUrl = videoObj ? videoObj.url : "";

  if (rawUrl.includes("github.com/") && rawUrl.includes("/blob/")) {
    rawUrl = rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  }

  const embedUrl = getEmbedUrl(rawUrl);

  if (embedUrl) {
    player.pause();
    player.removeAttribute("src");
    player.classList.add("hidden");

    iframe.src = embedUrl;
    iframe.classList.remove("hidden");
  } else {
    iframe.removeAttribute("src");
    iframe.classList.add("hidden");

    player.src = rawUrl.startsWith("http") ? rawUrl : `${API_BASE}/stream/${id}`;
    player.classList.remove("hidden");
    player.load();
    player.play().catch((err) => console.warn("Playback error:", err));
  }

  document.getElementById("player-modal").classList.remove("hidden");
}

document.getElementById("close-player").addEventListener("click", () => {
  const player = document.getElementById("player");
  const iframe = document.getElementById("iframe-player");

  player.pause();
  player.removeAttribute("src");
  player.load();
  player.classList.add("hidden");

  iframe.removeAttribute("src");
  iframe.classList.add("hidden");

  document.getElementById("player-modal").classList.add("hidden");
});

// ---- Admin Login ----
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("admin-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (res.ok) {
      adminToken = data.token;
      document.getElementById("login-form").classList.add("hidden");
      document.getElementById("admin-dashboard").classList.remove("hidden");
      renderAdminList();
      renderSectionList();
      populateSectionDropdown();
    } else {
      errorEl.textContent = data.error || "Login failed";
    }
  } catch (err) {
    errorEl.textContent = "Network error";
  }
});

document.getElementById("close-admin").addEventListener("click", () => {
  document.getElementById("admin-modal").classList.add("hidden");
});

// ---- Save Design Settings ----
document.getElementById("save-grid-settings-btn").addEventListener("click", async () => {
  gridSettings = {
    ...gridSettings,
    pageTitle: document.getElementById("setting-page-title").value || "Video Gallery",
    columns: parseInt(document.getElementById("setting-columns").value, 10) || 4,
    gap: parseInt(document.getElementById("setting-gap").value, 10) || 0,
    cellHeight: document.getElementById("setting-cell-height").value,
    padding: parseInt(document.getElementById("setting-padding").value, 10) || 0,
    pageBg: document.getElementById("setting-page-bg").value,
    headerColor: document.getElementById("setting-header-color").value,
    bgColor: document.getElementById("setting-bg-color").value,
    cardTextColor: document.getElementById("setting-card-text-color").value,
    borderWidth: parseInt(document.getElementById("setting-border-width").value, 10) || 0,
    borderColor: document.getElementById("setting-border-color").value,
    badgeBg: document.getElementById("setting-badge-bg").value,
    badgeText: document.getElementById("setting-badge-text").value,
    sections: sections
  };

  applyGridStyles();
  await saveRemoteSettings();
  alert("Design & Sections saved successfully.");
});

// ---- Reset Design Button ----
document.getElementById("reset-design-btn").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to reset all colors and layout settings to defaults?")) return;

  gridSettings = { ...DEFAULT_SETTINGS, sections };
  applyGridStyles();
  syncSettingsInputs();
  await saveRemoteSettings();
});

// ---- Section Management ----
document.getElementById("add-section-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("new-section-title");
  const title = input.value.trim();
  if (!title) return;

  const newSec = { id: `sec-${Date.now()}`, title };
  sections.push(newSec);
  input.value = "";

  renderSectionList();
  populateSectionDropdown();
  renderGallery();

  // Instantly persist new section to KV backend
  await saveRemoteSettings();
});

function renderSectionList() {
  const listEl = document.getElementById("admin-section-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  sections.forEach((sec, idx) => {
    const li = document.createElement("li");
    li.className = "admin-item";
    li.innerHTML = `
      <span class="admin-item-title">${escapeHtml(sec.title)}</span>
      <div class="admin-item-controls">
        ${sec.id !== "default" ? `<button class="btn-icon delete-btn">Delete</button>` : `<span style="font-size:11px; color:#888;">Default</span>`}
      </div>
    `;

    if (sec.id !== "default") {
      li.querySelector(".delete-btn").addEventListener("click", async () => {
        sections.splice(idx, 1);
        renderSectionList();
        populateSectionDropdown();
        renderGallery();
        await saveRemoteSettings();
      });
    }

    listEl.appendChild(li);
  });
}

function populateSectionDropdown() {
  const select = document.getElementById("video-section-select");
  if (!select) return;
  select.innerHTML = "";
  sections.forEach((sec) => {
    const opt = document.createElement("option");
    opt.value = sec.id;
    opt.textContent = sec.title;
    select.appendChild(opt);
  });
}

// ---- Add / Edit Video ----
document.getElementById("video-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("add-status");
  statusEl.textContent = "Saving...";
  statusEl.style.color = "#9ad19a";

  try {
    const id = document.getElementById("video-id").value;
    const title = document.getElementById("video-title").value;
    const url = document.getElementById("video-url").value;
    const thumbnail = document.getElementById("video-thumb").value;
    const duration = document.getElementById("video-duration").value;
    const sectionId = document.getElementById("video-section-select").value;

    const endpoint = id ? `${API_BASE}/edit-video` : `${API_BASE}/add-video`;
    const payload = id 
      ? { id, title, url, thumbnail, duration, sectionId } 
      : { title, url, thumbnail, duration, sectionId };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });

    const textRes = await res.text();
    let data = {};
    try {
      data = JSON.parse(textRes);
    } catch (parseErr) {
      throw new Error(`Server response error: ${textRes.substring(0, 100)}`);
    }

    if (res.ok) {
      resetForm();
      statusEl.textContent = id ? "Video updated successfully." : "Video added successfully.";
      await loadGallery();
    } else {
      statusEl.style.color = "#f28b82";
      statusEl.textContent = data.error || `Error ${res.status}`;
    }
  } catch (err) {
    statusEl.style.color = "#f28b82";
    statusEl.textContent = `Client Error: ${err.message}`;
  }
});

document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);

function resetForm() {
  document.getElementById("video-form").reset();
  document.getElementById("video-id").value = "";
  document.getElementById("form-heading").textContent = "Add New Video";
  document.getElementById("save-video-btn").textContent = "Add Video";
  document.getElementById("cancel-edit-btn").classList.add("hidden");
  document.getElementById("add-status").textContent = "";
}

function startEditVideo(video) {
  document.getElementById("video-id").value = video.id;
  document.getElementById("video-title").value = video.title || "";
  document.getElementById("video-url").value = video.url || "";
  document.getElementById("video-thumb").value = video.thumbnail || "";
  document.getElementById("video-duration").value = video.duration || "";
  document.getElementById("video-section-select").value = video.sectionId || "default";

  document.getElementById("form-heading").textContent = "Edit Video";
  document.getElementById("save-video-btn").textContent = "Save Changes";
  document.getElementById("cancel-edit-btn").classList.remove("hidden");
}

// ---- Render Video List Controls ----
let draggedIndex = null;

function renderAdminList() {
  const listEl = document.getElementById("admin-video-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (currentVideos.length === 0) {
    listEl.innerHTML = '<li style="font-size:13px; color:#888;">No videos to manage.</li>';
    return;
  }

  currentVideos.forEach((video, index) => {
    const li = document.createElement("li");
    li.className = "admin-item";
    li.draggable = true;
    li.dataset.index = index;

    li.innerHTML = `
      <span class="admin-item-title">☰ ${escapeHtml(video.title)}</span>
      <div class="admin-item-controls">
        <label style="font-size: 11px; color: #888;">Slot:</label>
        <input type="number" class="pos-input" value="${index + 1}" min="1" max="${currentVideos.length}">
        <button class="btn-icon edit-btn">Edit</button>
        <button class="btn-icon delete-btn">Delete</button>
      </div>
    `;

    const posInput = li.querySelector(".pos-input");
    posInput.addEventListener("change", (e) => {
      const newPos = parseInt(e.target.value, 10) - 1;
      if (!isNaN(newPos) && newPos >= 0 && newPos < currentVideos.length) {
        moveVideoToPosition(index, newPos);
      }
    });

    li.addEventListener("dragstart", () => {
      draggedIndex = index;
      li.classList.add("dragging");
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      draggedIndex = null;
    });

    li.addEventListener("dragover", (e) => e.preventDefault());

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (draggedIndex !== null && draggedIndex !== index) {
        moveVideoToPosition(draggedIndex, index);
      }
    });

    li.querySelector(".edit-btn").addEventListener("click", () => startEditVideo(video));
    li.querySelector(".delete-btn").addEventListener("click", () => deleteVideo(video.id));

    listEl.appendChild(li);
  });
}

// Reorder helper
async function moveVideoToPosition(fromIndex, toIndex) {
  const item = currentVideos.splice(fromIndex, 1)[0];
  currentVideos.splice(toIndex, 0, item);

  renderGallery();
  renderAdminList();

  const orderedIds = currentVideos.map((v) => v.id);

  try {
    await fetch(`${API_BASE}/reorder-videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderedIds }),
    });
  } catch (err) {
    console.error("Failed to save reordered positions:", err);
    await loadGallery();
  }
}

// Delete Video helper
async function deleteVideo(id) {
  if (!confirm("Are you sure you want to delete this video?")) return;

  try {
    const res = await fetch(`${API_BASE}/delete-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ id }),
    });

    if (res.ok) {
      await loadGallery();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete video");
    }
  } catch (err) {
    alert("Network error while deleting video.");
  }
}

// Initialize live pickers and load gallery
bindLiveColorPickers();
loadGallery();
