const path = require("path");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const adapter = new FileSync(path.join(__dirname, "data", "db.json"));
const db = low(adapter);

db.defaults({
  members: [],
  comments: [],
  weeklyRuns: [],
  settings: { lastWeeklyUpdate: null }
}).write();

module.exports = db;
