// ======= CONFIGURE THESE TWO VALUES AFTER DEPLOYING THE WORKER =======
const API_BASE = "https://video-gallery-api.kobihemed.workers.dev";

// SHA-256 hash of the secret keystroke sequence that reveals the admin panel.
// The default below is the hash of "kobi2026" — CHANGE THIS before going live.
// Generate your own with:  node -e "console.log(require('crypto').createHash('sha256').update('yourSecretPhrase').digest('hex'))"
const TRIGGER_HASH = "0c81d72d645b6f16b0c724269b7a3ae14105fb382826351a037e50a5037e3155";
// =======================================================================

let adminToken = null;

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- secret keystroke trigger ----
// Type the secret phrase anywhere on the page (no input focused) to reveal the admin panel.
let keyBuffer = "";
window.addEventListener("keydown", async (e) => {
  if (e.key.length > 1 && e.key !== "Backspace") return; // ignore Shift, Ctrl, etc.
  keyBuffer = (keyBuffer + e.key).slice(-40);
  const hash = await sha256(keyBuffer);
  if (hash === TRIGGER_HASH) {
    keyBuffer = "";
    document.getElementById("admin-modal").classList.remove("hidden");
  }
});

// ---- gallery ----
async function loadGallery() {
  try {
    const res = await fetch(`${API_BASE}/videos`);
    const videos = await res.json();
    const grid = document.getElementById("gallery");
    const emptyMsg = document.getElementById("empty-msg");

    grid.querySelectorAll(".card").forEach((c) => c.remove());

    if (videos.length === 0) {
      emptyMsg.classList.remove("hidden");
      return;
    }
    emptyMsg.classList.add("hidden");

    videos.forEach((v) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="thumb" style="background-image:url('${v.thumbnail || ""}')"></div>
        <div class="title">${escapeHtml(v.title)}</div>
      `;
      card.addEventListener("click", () => playVideo(v.id, v.title));
      grid.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to load videos", err);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function playVideo(id, title) {
  const player = document.getElementById("player");
  const source = document.getElementById("player-source");
  document.getElementById("player-title").textContent = title;
  source.src = `${API_BASE}/stream/${id}`;
  player.load();
  document.getElementById("player-modal").classList.remove("hidden");
  player.play().catch(() => {});
}

document.getElementById("close-player").addEventListener("click", () => {
  const player = document.getElementById("player");
  player.pause();
  player.currentTime = 0;
  document.getElementById("player-modal").classList.add("hidden");
});

// ---- admin login ----
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
      document.getElementById("add-video-form").classList.remove("hidden");
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

// ---- add video ----
document.getElementById("add-video-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("video-title").value;
  const url = document.getElementById("video-url").value;
  const thumbnail = document.getElementById("video-thumb").value;
  const statusEl = document.getElementById("add-status");
  statusEl.textContent = "";

  try {
    const res = await fetch(`${API_BASE}/add-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ title, url, thumbnail }),
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById("add-video-form").reset();
      statusEl.textContent = "Video added.";
      loadGallery();
    } else {
      statusEl.textContent = data.error || "Failed to add video";
    }
  } catch (err) {
    statusEl.textContent = "Network error";
  }
});

loadGallery();
