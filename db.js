const path = require("path");
const fs = require("fs");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const adapter = new FileSync(path.join(dataDir, "db.json"));
const db = low(adapter);

db.defaults({
  categories: [],
  people: [],
  rankings: [],
  comments: [],
  weeklyRuns: []
}).write();

// One-time migration from the old single-board schema, where members and
// their scores lived directly on one flat list, to categories + people +
// per-category rankings. Runs once if old data is found and no categories
// exist yet, so nothing already added gets lost.
(function migrateIfNeeded() {
  const state = db.getState();
  if (!state.members || (state.categories && state.categories.length > 0)) return;

  const now = new Date().toISOString();
  const categoryId = "main";

  const people = state.members.map((m) => ({
    id: m.id,
    name: m.name,
    createdAt: m.createdAt || now
  }));

  const rankings = state.members.map((m) => ({
    id: `${categoryId}:${m.id}`,
    categoryId,
    personId: m.id,
    rank: m.rank,
    pendingScore: m.pendingScore || 0,
    totalScore: m.totalScore || 0
  }));

  const weeklyRuns = (state.weeklyRuns || []).map((run) => ({
    id: run.id,
    categoryId,
    ranAt: run.ranAt,
    snapshot: run.snapshot.map((s) => ({ personId: s.memberId, name: s.name, rank: s.rank }))
  }));

  const comments = (state.comments || []).map((c) => ({
    id: c.id,
    personId: c.memberId,
    text: c.text,
    author: c.author,
    createdAt: c.createdAt
  }));

  const categories = [{
    id: categoryId,
    name: "Main Rankings",
    createdAt: now,
    lastWeeklyUpdate: state.settings ? state.settings.lastWeeklyUpdate : null
  }];

  db.setState({ categories, people, rankings, comments, weeklyRuns }).write();
})();

// Ensure at least one category exists for brand-new installs.
if (db.get("categories").value().length === 0) {
  db.get("categories").push({
    id: "main",
    name: "Main Rankings",
    createdAt: new Date().toISOString(),
    lastWeeklyUpdate: null
  }).write();
}

module.exports = db;
