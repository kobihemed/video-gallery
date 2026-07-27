// ======= CONFIGURE THESE TWO VALUES AFTER DEPLOYING THE WORKER =======
const API_BASE = "https://video-gallery-api.kobihemed.workers.dev";

// SHA-256 hash of "video2026"
const TRIGGER_HASH = "055bf1bc44c107144e5fa64117ae87b1c1dfef38ca15eddbfe48ea0ca64696f8";
// =======================================================================

let adminToken = null;
let currentVideos = [];
let gridSettings = {
  columns: 4,
  gap: 20,
  cellHeight: "auto",
  padding: 0,
  bgColor: "#1e2126",
  borderWidth: 0,
  borderColor: "#3a3f47"
};

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- secret keystroke trigger ----
let keyBuffer = "";
window.addEventListener("keydown", async (e) => {
  if (e.key.length > 1 && e.key !== "Backspace") return;
  keyBuffer = (keyBuffer + e.key).slice(-40);
  const hash = await sha256(keyBuffer);
  if (hash === TRIGGER_HASH) {
    keyBuffer = "";
    document.getElementById("admin-modal").classList.remove("hidden");
  }
});

// ---- Apply Dynamic Grid Styles ----
function applyGridStyles() {
  const root = document.documentElement;
  root.style.setProperty("--grid-columns", gridSettings.columns);
  root.style.setProperty("--grid-gap", `${gridSettings.gap}px`);
  root.style.setProperty("--cell-height", gridSettings.cellHeight);
  root.style.setProperty("--card-padding", `${gridSettings.padding}px`);
  root.style.setProperty("--card-bg", gridSettings.bgColor);
  root.style.setProperty("--card-border-width", `${gridSettings.borderWidth}px`);
  root.style.setProperty("--card-border-color", gridSettings.borderColor);
}

// Sync UI inputs with local state
function syncSettingsInputs() {
  document.getElementById("setting-columns").value = gridSettings.columns;
  document.getElementById("setting-gap").value = gridSettings.gap;
  document.getElementById("setting-cell-height").value = gridSettings.cellHeight;
  document.getElementById("setting-padding").value = gridSettings.padding;
  document.getElementById("setting-bg-color").value = gridSettings.bgColor;
  document.getElementById("setting-border-width").value = gridSettings.borderWidth;
  document.getElementById("setting-border-color").value = gridSettings.borderColor;
}

// ---- Load Gallery & Settings ----
async function loadGallery() {
  try {
    const [vidRes, setRes] = await Promise.all([
      fetch(`${API_BASE}/videos`),
      fetch(`${API_BASE}/grid-settings`).catch(() => null)
    ]);

    currentVideos = await vidRes.json();
    
    if (setRes && setRes.ok) {
      const savedSettings = await setRes.json();
      gridSettings = { ...gridSettings, ...savedSettings };
    }
    
    applyGridStyles();
    syncSettingsInputs();
    renderGallery();
    
    if (adminToken) {
      renderAdminList();
    }
  } catch (err) {
    console.error("Failed to load gallery/settings", err);
  }
}

function renderGallery() {
  const grid = document.getElementById("gallery");
  const emptyMsg = document.getElementById("empty-msg");

  grid.querySelectorAll(".card").forEach((c) => c.remove());

  if (!currentVideos || currentVideos.length === 0) {
    emptyMsg.classList.remove("hidden");
    return;
  }
  emptyMsg.classList.add("hidden");

  currentVideos.forEach((v) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="thumb" style="background-image:url('${v.thumbnail || ""}')"></div>
      <div class="title">${escapeHtml(v.title)}</div>
    `;
    card.addEventListener("click", () => playVideo(v.id, v.title));
    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---- Helper to parse & convert third-party embed links ----
function getEmbedUrl(rawUrl) {
  if (!rawUrl) return null;

  // Convert GitHub blob links directly to raw file URLs
  if (rawUrl.includes("github.com/") && rawUrl.includes("/blob/")) {
    return rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  }

  // 1. YouTube
  const ytMatch = rawUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1`;
  }

  // 2. Streamable
  const streamableMatch = rawUrl.match(/streamable\.com\/(?:e\/)?([a-zA-Z0-9]+)/);
  if (streamableMatch && streamableMatch[1]) {
    return `https://streamable.com/e/${streamableMatch[1]}?autoplay=1`;
  }

  return null;
}

// ---- Universal Video Player Handler ----
function playVideo(id, title) {
  const player = document.getElementById("player");
  const iframe = document.getElementById("iframe-player");
  document.getElementById("player-title").textContent = title;

  const videoObj = currentVideos.find((v) => v.id === id);
  const rawUrl = videoObj ? videoObj.url : "";

  const embedUrl = getEmbedUrl(rawUrl);

  if (embedUrl && (embedUrl.includes("youtube") || embedUrl.includes("streamable"))) {
    // Platform embed
    player.pause();
    player.removeAttribute("src");
    player.classList.add("hidden");

    iframe.src = embedUrl;
    iframe.classList.remove("hidden");
  } else {
    // Direct file stream / GitHub raw media
    iframe.removeAttribute("src");
    iframe.classList.add("hidden");

    const targetUrl = rawUrl.includes("github.com/") && rawUrl.includes("/blob/")
      ? rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
      : `${API_BASE}/stream/${id}`;

    player.src = targetUrl;
    player.classList.remove("hidden");
    player.load();
    player.play().catch((err) => {
      console.warn("Autoplay blocked or playback error:", err);
    });
  }

  document.getElementById("player-modal").classList.remove("hidden");
}

// ---- Close Video Player Modal ----
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
    } else {
      errorEl.textContent = data.error || "Login failed";
    }
  } catch (err) {
    errorEl.textContent = "Network error";
  }
});

// ---- Close Admin Modal ----
document.getElementById("close-admin").addEventListener("click", () => {
  document.getElementById("admin-modal").classList.add("hidden");
});

// ---- Save Grid Customization ----
document.getElementById("save-grid-settings-btn").addEventListener("click", async () => {
  gridSettings = {
    columns: parseInt(document.getElementById("setting-columns").value, 10) || 4,
    gap: parseInt(document.getElementById("setting-gap").value, 10) || 0,
    cellHeight: document.getElementById("setting-cell-height").value,
    padding: parseInt(document.getElementById("setting-padding").value, 10) || 0,
    bgColor: document.getElementById("setting-bg-color").value,
    borderWidth: parseInt(document.getElementById("setting-border-width").value, 10) || 0,
    borderColor: document.getElementById("setting-border-color").value,
  };

  applyGridStyles();

  if (adminToken) {
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
      console.warn("Unable to save grid settings remotely", err);
    }
  }
});

// ---- Add / Edit Video ----
document.getElementById("video-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("video-id").value;
  const title = document.getElementById("video-title").value;
  const url = document.getElementById("video-url").value;
  const thumbnail = document.getElementById("video-thumb").value;
  const statusEl = document.getElementById("add-status");
  statusEl.textContent = "";

  const endpoint = id ? `${API_BASE}/edit-video` : `${API_BASE}/add-video`;
  const payload = id ? { id, title, url, thumbnail } : { title, url, thumbnail };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      resetForm();
      statusEl.textContent = id ? "Video updated." : "Video added.";
      await loadGallery();
    } else {
      statusEl.textContent = data.error || "Operation failed";
    }
  } catch (err) {
    statusEl.textContent = "Network error";
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
  
  document.getElementById("form-heading").textContent = "Edit Video";
  document.getElementById("save-video-btn").textContent = "Save Changes";
  document.getElementById("cancel-edit-btn").classList.remove("hidden");
}

// ---- Render Admin List & Placement Controls ----
let draggedIndex = null;

function renderAdminList() {
  const listEl = document.getElementById("admin-video-list");
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

    // Manual slot placement
    const posInput = li.querySelector(".pos-input");
    posInput.addEventListener("change", (e) => {
      const newPos = parseInt(e.target.value, 10) - 1;
      if (!isNaN(newPos) && newPos >= 0 && newPos < currentVideos.length) {
        moveVideoToPosition(index, newPos);
      }
    });

    // Drag and Drop Events
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

// Move item to specific grid position slot
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

// ---- Delete Video ----
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

loadGallery();
