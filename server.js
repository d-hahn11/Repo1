const express = require("express");
const cron = require("node-cron");
const { nanoid } = require("nanoid");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

function sortedMembers() {
  return db.get("members").sortBy("rank").value();
}

function renumberRanks() {
  const members = sortedMembers();
  members.forEach((m, i) => {
    db.get("members").find({ id: m.id }).assign({ rank: i + 1 }).write();
  });
}

// ---- Members ----

app.get("/api/members", (req, res) => {
  res.json(sortedMembers());
});

app.post("/api/members", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });

  const members = db.get("members").value();
  const member = {
    id: nanoid(8),
    name,
    rank: members.length + 1,
    pendingScore: 0,
    totalScore: 0,
    createdAt: new Date().toISOString()
  };
  db.get("members").push(member).write();
  res.status(201).json(member);
});

app.delete("/api/members/:id", (req, res) => {
  db.get("members").remove({ id: req.params.id }).write();
  db.get("comments").remove({ memberId: req.params.id }).write();
  renumberRanks();
  res.json({ ok: true });
});

// Upvote / downvote — affects this week's pending score, not the visible rank
// until the weekly update runs.
app.post("/api/members/:id/vote", (req, res) => {
  const direction = req.body.direction;
  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "direction must be 'up' or 'down'." });
  }
  const member = db.get("members").find({ id: req.params.id });
  if (!member.value()) return res.status(404).json({ error: "Member not found." });

  const delta = direction === "up" ? 1 : -1;
  member.update("pendingScore", (s) => (s || 0) + delta).write();
  res.json(member.value());
});

// Manual drag-to-reorder override. Body: { order: [id, id, id, ...] }
app.post("/api/reorder", (req, res) => {
  const order = req.body.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array of member ids." });

  order.forEach((id, i) => {
    db.get("members").find({ id }).assign({ rank: i + 1 }).write();
  });
  res.json(sortedMembers());
});

// ---- Comments ----

app.get("/api/members/:id/comments", (req, res) => {
  const comments = db.get("comments")
    .filter({ memberId: req.params.id })
    .sortBy("createdAt")
    .reverse()
    .value();
  res.json(comments);
});

app.post("/api/members/:id/comments", (req, res) => {
  const text = (req.body.text || "").trim();
  const author = (req.body.author || "Anonymous").trim();
  if (!text) return res.status(400).json({ error: "Comment text is required." });

  const member = db.get("members").find({ id: req.params.id }).value();
  if (!member) return res.status(404).json({ error: "Member not found." });

  const comment = {
    id: nanoid(8),
    memberId: req.params.id,
    text,
    author,
    createdAt: new Date().toISOString()
  };
  db.get("comments").push(comment).write();
  res.status(201).json(comment);
});

app.delete("/api/comments/:id", (req, res) => {
  db.get("comments").remove({ id: req.params.id }).write();
  res.json({ ok: true });
});

// ---- Weekly update ----

function runWeeklyUpdate() {
  const members = sortedMembers();

  // New order: rank ascending, broken by pendingScore descending (a run of
  // upvotes this week can lift someone past the person above them, and vice versa).
  const reordered = [...members].sort((a, b) => {
    if (b.pendingScore !== a.pendingScore) return b.pendingScore - a.pendingScore;
    return a.rank - b.rank;
  });

  reordered.forEach((m, i) => {
    db.get("members").find({ id: m.id }).assign({
      rank: i + 1,
      totalScore: (m.totalScore || 0) + (m.pendingScore || 0),
      pendingScore: 0
    }).write();
  });

  const snapshot = reordered.map((m, i) => ({ memberId: m.id, name: m.name, rank: i + 1 }));
  const run = { id: nanoid(8), ranAt: new Date().toISOString(), snapshot };
  db.get("weeklyRuns").push(run).write();
  db.set("settings.lastWeeklyUpdate", run.ranAt).write();
  return run;
}

app.post("/api/weekly-update", (req, res) => {
  const run = runWeeklyUpdate();
  res.json(run);
});

app.get("/api/weekly-runs", (req, res) => {
  res.json(db.get("weeklyRuns").sortBy("ranAt").reverse().take(10).value());
});

app.get("/api/settings", (req, res) => {
  res.json(db.get("settings").value());
});

// Auto-run every Monday at 00:00 server time.
cron.schedule("0 0 * * 1", () => {
  console.log("Running scheduled weekly update...");
  runWeeklyUpdate();
});

app.listen(PORT, () => {
  console.log(`Power Rankings running at http://localhost:${PORT}`);
});
