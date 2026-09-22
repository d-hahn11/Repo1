const listEl = document.getElementById("member-list");
const emptyStateEl = document.getElementById("empty-state");
const updateStatusEl = document.getElementById("update-status");
const runUpdateBtn = document.getElementById("run-update-btn");
const tabsEl = document.getElementById("category-tabs");

let categories = [];
let currentCategoryId = localStorage.getItem("standings:lastCategoryId") || null;
let rankings = []; // current category's people, ranked
let previousRanks = {}; // personId -> rank from the run before last, for move indicators
let draggedId = null;
let activeCommentsPersonId = null;

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }
  return res.status === 204 ? null : res.json();
}

// ---- Bootstrapping ----

async function init() {
  categories = await api("/api/categories");
  if (!categories.find((c) => c.id === currentCategoryId)) {
    currentCategoryId = categories[0].id;
  }
  renderTabs();
  await loadCategory();
}

async function loadCategory() {
  const [rankingsData, runs] = await Promise.all([
    api(`/api/categories/${currentCategoryId}/rankings`),
    api(`/api/categories/${currentCategoryId}/weekly-runs`)
  ]);
  rankings = rankingsData;

  previousRanks = {};
  if (runs.length >= 2) {
    runs[1].snapshot.forEach((s) => { previousRanks[s.personId] = s.rank; });
  }

  const category = categories.find((c) => c.id === currentCategoryId);
  renderStatus(category);
  renderMembers();
}

function renderStatus(category) {
  if (category && category.lastWeeklyUpdate) {
    const d = new Date(category.lastWeeklyUpdate);
    updateStatusEl.textContent = `Last updated ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  } else {
    updateStatusEl.textContent = "Not updated yet";
  }
}

// ---- Category tabs ----

function renderTabs() {
  tabsEl.innerHTML = "";
  categories.forEach((cat) => {
    const tab = document.createElement("button");
    tab.className = "tab" + (cat.id === currentCategoryId ? " active" : "");
    tab.dataset.id = cat.id;
    tab.innerHTML = `<span>${escapeHtml(cat.name)}</span>` +
      (categories.length > 1 ? `<span class="tab-remove" data-id="${cat.id}" title="Delete category">✕</span>` : "");
    tabsEl.appendChild(tab);
  });

  const addTab = document.createElement("button");
  addTab.className = "tab tab-add";
  addTab.id = "add-category-btn";
  addTab.textContent = "+ New category";
  tabsEl.appendChild(addTab);
}

tabsEl.addEventListener("click", async (e) => {
  const removeBtn = e.target.closest(".tab-remove");
  const addBtn = e.target.closest("#add-category-btn");
  const tab = e.target.closest(".tab:not(.tab-add)");

  if (removeBtn) {
    e.stopPropagation();
    const cat = categories.find((c) => c.id === removeBtn.dataset.id);
    if (!confirm(`Delete the "${cat.name}" category? This only removes this leaderboard, not the people in it.`)) return;
    await api(`/api/categories/${removeBtn.dataset.id}`, { method: "DELETE" });
    categories = await api("/api/categories");
    if (currentCategoryId === removeBtn.dataset.id) currentCategoryId = categories[0].id;
    renderTabs();
    await loadCategory();
    return;
  }

  if (addBtn) {
    const name = prompt("Name this category (e.g. \"Funniest\", \"Most Helpful\"):");
    if (!name || !name.trim()) return;
    const created = await api("/api/categories", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    categories = await api("/api/categories");
    currentCategoryId = created.id;
    localStorage.setItem("standings:lastCategoryId", currentCategoryId);
    renderTabs();
    await loadCategory();
    return;
  }

  if (tab) {
    currentCategoryId = tab.dataset.id;
    localStorage.setItem("standings:lastCategoryId", currentCategoryId);
    renderTabs();
    await loadCategory();
  }
});

// ---- Rendering the board ----

function renderMembers() {
  listEl.innerHTML = "";
  emptyStateEl.hidden = rankings.length > 0;

  rankings.forEach((m) => {
    const row = document.createElement("li");
    row.className = "member-row";
    row.draggable = true;
    row.dataset.id = m.personId;

    const prevRank = previousRanks[m.personId];
    let moveHtml = "";
    if (prevRank !== undefined && prevRank !== m.rank) {
      const delta = prevRank - m.rank;
      moveHtml = delta > 0
        ? `<span class="move-indicator move-up">▲ ${delta}</span>`
        : `<span class="move-indicator move-down">▼ ${Math.abs(delta)}</span>`;
    }

    row.innerHTML = `
      <div class="rank-num">${m.rank}</div>
      <div class="member-main">
        <div class="member-name-row">
          <span class="member-name">${escapeHtml(m.name)}</span>
          ${moveHtml}
        </div>
        <div class="member-sub">
          <button class="comment-toggle" data-id="${m.personId}">comments</button>
          &middot; this week: ${m.pendingScore > 0 ? "+" : ""}${m.pendingScore}
        </div>
      </div>
      <div class="member-actions">
        <button class="vote-btn up" data-id="${m.personId}" data-dir="up" title="Upvote">↑</button>
        <button class="vote-btn down" data-id="${m.personId}" data-dir="down" title="Downvote">↓</button>
        <button class="remove-btn" data-id="${m.personId}" title="Remove from the whole board">✕</button>
      </div>
    `;
    listEl.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Voting ----

listEl.addEventListener("click", async (e) => {
  const voteBtn = e.target.closest(".vote-btn");
  const removeBtn = e.target.closest(".remove-btn");
  const commentToggle = e.target.closest(".comment-toggle");

  if (voteBtn) {
    const id = voteBtn.dataset.id;
    const direction = voteBtn.dataset.dir;
    const ranking = rankings.find((m) => m.personId === id);
    ranking.pendingScore += direction === "up" ? 1 : -1;
    renderMembers();
    await api(`/api/categories/${currentCategoryId}/people/${id}/vote`, {
      method: "POST",
      body: JSON.stringify({ direction })
    });
  }

  if (removeBtn) {
    const id = removeBtn.dataset.id;
    const ranking = rankings.find((m) => m.personId === id);
    if (!confirm(`Remove ${ranking.name} from the whole board (every category)?`)) return;
    await api(`/api/people/${id}`, { method: "DELETE" });
    await loadCategory();
  }

  if (commentToggle) {
    openComments(commentToggle.dataset.id);
  }
});

// ---- Add person (global, joins every category) ----

document.getElementById("add-member-btn").addEventListener("click", addMember);
document.getElementById("new-member-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addMember();
});

async function addMember() {
  const input = document.getElementById("new-member-name");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  await api("/api/people", { method: "POST", body: JSON.stringify({ name }) });
  await loadCategory();
}

// ---- Drag to reorder (within current category only) ----

listEl.addEventListener("dragstart", (e) => {
  const row = e.target.closest(".member-row");
  draggedId = row.dataset.id;
  row.classList.add("dragging");
});

listEl.addEventListener("dragend", (e) => {
  const row = e.target.closest(".member-row");
  if (row) row.classList.remove("dragging");
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
});

listEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  const row = e.target.closest(".member-row");
  if (!row || row.dataset.id === draggedId) return;
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  row.classList.add("drag-over");
});

listEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  const targetRow = e.target.closest(".member-row");
  if (!targetRow || targetRow.dataset.id === draggedId) return;

  const targetId = targetRow.dataset.id;
  const fromIndex = rankings.findIndex((m) => m.personId === draggedId);
  const toIndex = rankings.findIndex((m) => m.personId === targetId);
  const [moved] = rankings.splice(fromIndex, 1);
  rankings.splice(toIndex, 0, moved);
  rankings.forEach((m, i) => { m.rank = i + 1; });
  renderMembers();

  await api(`/api/categories/${currentCategoryId}/reorder`, {
    method: "POST",
    body: JSON.stringify({ order: rankings.map((m) => m.personId) })
  });
});

// ---- Comments panel (shared across categories) ----

const panel = document.getElementById("comments-panel");
const backdrop = document.getElementById("comments-backdrop");
const commentsTitle = document.getElementById("comments-title");
const commentsList = document.getElementById("comments-list");

async function openComments(personId) {
  activeCommentsPersonId = personId;
  const person = rankings.find((m) => m.personId === personId);
  commentsTitle.textContent = `${person.name} — comments`;
  panel.hidden = false;
  backdrop.hidden = false;
  await loadComments(personId);
}

function closeComments() {
  panel.hidden = true;
  backdrop.hidden = true;
  activeCommentsPersonId = null;
}

document.getElementById("close-comments").addEventListener("click", closeComments);
backdrop.addEventListener("click", closeComments);

async function loadComments(personId) {
  const comments = await api(`/api/people/${personId}/comments`);
  commentsList.innerHTML = comments.length
    ? comments.map((c) => `
        <li class="comment-item">
          <div class="comment-meta">
            <span>${escapeHtml(c.author)} &middot; ${new Date(c.createdAt).toLocaleDateString()}</span>
            <button class="delete-comment" data-id="${c.id}">remove</button>
          </div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </li>
      `).join("")
    : `<li class="comment-item" style="color: var(--ink-dim); border: none;">No comments yet.</li>`;
}

commentsList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-comment");
  if (!btn) return;
  await api(`/api/comments/${btn.dataset.id}`, { method: "DELETE" });
  await loadComments(activeCommentsPersonId);
});

document.getElementById("comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const author = document.getElementById("comment-author").value.trim() || "Anonymous";
  const text = document.getElementById("comment-text").value.trim();
  if (!text) return;
  await api(`/api/people/${activeCommentsPersonId}/comments`, {
    method: "POST",
    body: JSON.stringify({ author, text })
  });
  document.getElementById("comment-text").value = "";
  await loadComments(activeCommentsPersonId);
});

// ---- Weekly update (current category only) ----

runUpdateBtn.addEventListener("click", async () => {
  const category = categories.find((c) => c.id === currentCategoryId);
  if (!confirm(`Run the weekly update for "${category.name}" now? This locks in this week's votes as the new ranking.`)) return;
  await api(`/api/categories/${currentCategoryId}/weekly-update`, { method: "POST" });
  await loadCategory();
});

init();
