const listEl = document.getElementById("member-list");
const emptyStateEl = document.getElementById("empty-state");
const updateStatusEl = document.getElementById("update-status");
const runUpdateBtn = document.getElementById("run-update-btn");

let members = [];
let previousRanks = {}; // memberId -> rank from the run before last, for move indicators
let draggedId = null;
let activeCommentsMemberId = null;

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

async function loadAll() {
  const [membersData, runs, settings] = await Promise.all([
    api("/api/members"),
    api("/api/weekly-runs"),
    api("/api/settings")
  ]);
  members = membersData;

  previousRanks = {};
  if (runs.length >= 2) {
    runs[1].snapshot.forEach((s) => { previousRanks[s.memberId] = s.rank; });
  }

  renderStatus(settings);
  renderMembers();
}

function renderStatus(settings) {
  if (settings.lastWeeklyUpdate) {
    const d = new Date(settings.lastWeeklyUpdate);
    updateStatusEl.textContent = `Last updated ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  } else {
    updateStatusEl.textContent = "Not updated yet";
  }
}

function renderMembers() {
  listEl.innerHTML = "";
  emptyStateEl.hidden = members.length > 0;

  members.forEach((m) => {
    const row = document.createElement("li");
    row.className = "member-row";
    row.draggable = true;
    row.dataset.id = m.id;

    const prevRank = previousRanks[m.id];
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
          <button class="comment-toggle" data-id="${m.id}">comments</button>
          &middot; this week: ${m.pendingScore > 0 ? "+" : ""}${m.pendingScore}
        </div>
      </div>
      <div class="member-actions">
        <button class="vote-btn up" data-id="${m.id}" data-dir="up" title="Upvote">↑</button>
        <span class="pending-score"></span>
        <button class="vote-btn down" data-id="${m.id}" data-dir="down" title="Downvote">↓</button>
        <button class="remove-btn" data-id="${m.id}" title="Remove">✕</button>
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
    const member = members.find((m) => m.id === id);
    member.pendingScore += direction === "up" ? 1 : -1;
    renderMembers();
    await api(`/api/members/${id}/vote`, { method: "POST", body: JSON.stringify({ direction }) });
  }

  if (removeBtn) {
    const id = removeBtn.dataset.id;
    const member = members.find((m) => m.id === id);
    if (!confirm(`Remove ${member.name} from the board?`)) return;
    await api(`/api/members/${id}`, { method: "DELETE" });
    await loadAll();
  }

  if (commentToggle) {
    openComments(commentToggle.dataset.id);
  }
});

// ---- Add member ----

document.getElementById("add-member-btn").addEventListener("click", addMember);
document.getElementById("new-member-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addMember();
});

async function addMember() {
  const input = document.getElementById("new-member-name");
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  await api("/api/members", { method: "POST", body: JSON.stringify({ name }) });
  await loadAll();
}

// ---- Drag to reorder ----

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
  const fromIndex = members.findIndex((m) => m.id === draggedId);
  const toIndex = members.findIndex((m) => m.id === targetId);
  const [moved] = members.splice(fromIndex, 1);
  members.splice(toIndex, 0, moved);
  members.forEach((m, i) => { m.rank = i + 1; });
  renderMembers();

  await api("/api/reorder", { method: "POST", body: JSON.stringify({ order: members.map((m) => m.id) }) });
});

// ---- Comments panel ----

const panel = document.getElementById("comments-panel");
const backdrop = document.getElementById("comments-backdrop");
const commentsTitle = document.getElementById("comments-title");
const commentsList = document.getElementById("comments-list");

async function openComments(memberId) {
  activeCommentsMemberId = memberId;
  const member = members.find((m) => m.id === memberId);
  commentsTitle.textContent = `${member.name} — comments`;
  panel.hidden = false;
  backdrop.hidden = false;
  await loadComments(memberId);
}

function closeComments() {
  panel.hidden = true;
  backdrop.hidden = true;
  activeCommentsMemberId = null;
}

document.getElementById("close-comments").addEventListener("click", closeComments);
backdrop.addEventListener("click", closeComments);

async function loadComments(memberId) {
  const comments = await api(`/api/members/${memberId}/comments`);
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
  await loadComments(activeCommentsMemberId);
});

document.getElementById("comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const author = document.getElementById("comment-author").value.trim() || "Anonymous";
  const text = document.getElementById("comment-text").value.trim();
  if (!text) return;
  await api(`/api/members/${activeCommentsMemberId}/comments`, {
    method: "POST",
    body: JSON.stringify({ author, text })
  });
  document.getElementById("comment-text").value = "";
  await loadComments(activeCommentsMemberId);
});

// ---- Weekly update ----

runUpdateBtn.addEventListener("click", async () => {
  if (!confirm("Run the weekly update now? This will lock in this week's votes as the new ranking.")) return;
  await api("/api/weekly-update", { method: "POST" });
  await loadAll();
});

loadAll();
