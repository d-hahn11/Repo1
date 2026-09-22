const express = require("express");
const cron = require("node-cron");
const { nanoid } = require("nanoid");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

function getCategory(id) {
  return db.get("categories").find({ id }).value();
}

function rankingsForCategory(categoryId) {
  return db.get("rankings")
    .filter({ categoryId })
    .value()
    .map((r) => {
      const person = db.get("people").find({ id: r.personId }).value();
      return { ...r, name: person ? person.name : "(removed)" };
    })
    .sort((a, b) => a.rank - b.rank);
}

function renumberRanks(categoryId) {
  const list = rankingsForCategory(categoryId);
  list.forEach((r, i) => {
    db.get("rankings").find({ id: r.id }).assign({ rank: i + 1 }).write();
  });
}

// ---- Categories ----

app.get("/api/categories", (req, res) => {
  res.json(db.get("categories").sortBy("createdAt").value());
});

app.post("/api/categories", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });

  const category = {
    id: nanoid(8),
    name,
    createdAt: new Date().toISOString(),
    lastWeeklyUpdate: null
  };
  db.get("categories").push(category).write();

  // Everyone already on the board joins the new category too, in the order
  // they were originally added.
  const people = db.get("people").sortBy("createdAt").value();
  people.forEach((p, i) => {
    db.get("rankings").push({
      id: `${category.id}:${p.id}`,
      categoryId: category.id,
      personId: p.id,
      rank: i + 1,
      pendingScore: 0,
      totalScore: 0
    }).write();
  });

  res.status(201).json(category);
});

app.delete("/api/categories/:id", (req, res) => {
  const total = db.get("categories").value().length;
  if (total <= 1) {
    return res.status(400).json({ error: "You need at least one category." });
  }
  db.get("categories").remove({ id: req.params.id }).write();
  db.get("rankings").remove({ categoryId: req.params.id }).write();
  db.get("weeklyRuns").remove({ categoryId: req.params.id }).write();
  res.json({ ok: true });
});

// ---- People (shared across every category) ----

app.post("/api/people", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });

  const person = { id: nanoid(8), name, createdAt: new Date().toISOString() };
  db.get("people").push(person).write();

  // Add them to every existing category, at the bottom of each.
  db.get("categories").value().forEach((cat) => {
    const count = db.get("rankings").filter({ categoryId: cat.id }).value().length;
    db.get("rankings").push({
      id: `${cat.id}:${person.id}`,
      categoryId: cat.id,
      personId: person.id,
      rank: count + 1,
      pendingScore: 0,
      totalScore: 0
    }).write();
  });

  res.status(201).json(person);
});

app.delete("/api/people/:id", (req, res) => {
  const affectedCategories = db.get("rankings").filter({ personId: req.params.id }).map("categoryId").value();
  db.get("people").remove({ id: req.params.id }).write();
  db.get("rankings").remove({ personId: req.params.id }).write();
  db.get("comments").remove({ personId: req.params.id }).write();
  affectedCategories.forEach(renumberRanks);
  res.json({ ok: true });
});

// ---- Rankings within a category ----

app.get("/api/categories/:catId/rankings", (req, res) => {
  if (!getCategory(req.params.catId)) return res.status(404).json({ error: "Category not found." });
  res.json(rankingsForCategory(req.params.catId));
});

// Upvote / downvote — affects this week's pending score, not the visible
// rank yet, within this one category only.
app.post("/api/categories/:catId/people/:personId/vote", (req, res) => {
  const direction = req.body.direction;
  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "direction must be 'up' or 'down'." });
  }
  const ranking = db.get("rankings").find({ categoryId: req.params.catId, personId: req.params.personId });
  if (!ranking.value()) return res.status(404).json({ error: "Not found in this category." });

  const delta = direction === "up" ? 1 : -1;
  ranking.update("pendingScore", (s) => (s || 0) + delta).write();
  res.json(ranking.value());
});

// Manual drag-to-reorder override, scoped to one category. Body: { order: [personId, ...] }
app.post("/api/categories/:catId/reorder", (req, res) => {
  const order = req.body.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array of person ids." });

  order.forEach((personId, i) => {
    db.get("rankings").find({ categoryId: req.params.catId, personId }).assign({ rank: i + 1 }).write();
  });
  res.json(rankingsForCategory(req.params.catId));
});

// ---- Comments (shared across categories — a person has one comment thread) ----

app.get("/api/people/:id/comments", (req, res) => {
  const comments = db.get("comments")
    .filter({ personId: req.params.id })
    .sortBy("createdAt")
    .reverse()
    .value();
  res.json(comments);
});

app.post("/api/people/:id/comments", (req, res) => {
  const text = (req.body.text || "").trim();
  const author = (req.body.author || "Anonymous").trim();
  if (!text) return res.status(400).json({ error: "Comment text is required." });

  const person = db.get("people").find({ id: req.params.id }).value();
  if (!person) return res.status(404).json({ error: "Person not found." });

  const comment = {
    id: nanoid(8),
    personId: req.params.id,
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

// ---- Weekly update, per category ----

function runWeeklyUpdate(categoryId) {
  const list = rankingsForCategory(categoryId);

  const reordered = [...list].sort((a, b) => {
    if (b.pendingScore !== a.pendingScore) return b.pendingScore - a.pendingScore;
    return a.rank - b.rank;
  });

  reordered.forEach((r, i) => {
    db.get("rankings").find({ id: r.id }).assign({
      rank: i + 1,
      totalScore: (r.totalScore || 0) + (r.pendingScore || 0),
      pendingScore: 0
    }).write();
  });

  const snapshot = reordered.map((r, i) => ({ personId: r.personId, name: r.name, rank: i + 1 }));
  const run = { id: nanoid(8), categoryId, ranAt: new Date().toISOString(), snapshot };
  db.get("weeklyRuns").push(run).write();
  db.get("categories").find({ id: categoryId }).assign({ lastWeeklyUpdate: run.ranAt }).write();
  return run;
}

app.post("/api/categories/:catId/weekly-update", (req, res) => {
  if (!getCategory(req.params.catId)) return res.status(404).json({ error: "Category not found." });
  res.json(runWeeklyUpdate(req.params.catId));
});

app.get("/api/categories/:catId/weekly-runs", (req, res) => {
  res.json(
    db.get("weeklyRuns")
      .filter({ categoryId: req.params.catId })
      .sortBy("ranAt")
      .reverse()
      .take(10)
      .value()
  );
});

// Auto-run every category every Monday at 00:00 server time.
cron.schedule("0 0 * * 1", () => {
  console.log("Running scheduled weekly update for all categories...");
  db.get("categories").value().forEach((cat) => runWeeklyUpdate(cat.id));
});

app.listen(PORT, () => {
  console.log(`Power Rankings running at http://localhost:${PORT}`);
});
