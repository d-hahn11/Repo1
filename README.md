# The Standings

A private weekly power-rankings board for your group. Add people, upvote or downvote them, leave comments about what they did, and drag to reorder by hand. Every Monday (or whenever you click "Run weekly update"), this week's votes get locked in as the new ranking.

## Features

- **Upvote / downvote** — casts count toward this week's score without changing the visible rank yet.
- **Comments** — leave notes on anyone's row about what earned them the vote.
- **Weekly update** — click the button (or let the built-in Monday 00:00 cron job do it) to apply the week's votes and re-sort the board.
- **Drag to reorder** — grab any row and drop it where you want; manual moves persist until the next weekly update.

## Setup

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

Data is stored in `data/db.json`, created automatically on first run (it's git-ignored, so your local data stays local).

## Project structure

```
server.js        Express app + API routes + weekly cron job
db.js             lowdb (JSON file) data store
public/           frontend (vanilla HTML/CSS/JS, no build step)
data/db.json      local data file (auto-created, git-ignored)
```

## API

| Method | Route | Description |
|---|---|---|
| GET | `/api/members` | List all members, sorted by rank |
| POST | `/api/members` | Add a member `{ name }` |
| DELETE | `/api/members/:id` | Remove a member |
| POST | `/api/members/:id/vote` | Vote `{ direction: "up" \| "down" }` |
| POST | `/api/reorder` | Manually reorder `{ order: [id, id, ...] }` |
| GET | `/api/members/:id/comments` | List comments for a member |
| POST | `/api/members/:id/comments` | Add a comment `{ author, text }` |
| DELETE | `/api/comments/:id` | Remove a comment |
| POST | `/api/weekly-update` | Run the weekly recompute now |
| GET | `/api/weekly-runs` | Recent weekly update history |

## Notes

- No login is built in — this is meant for a small private group with a shared link. Add auth if you plan to expose it publicly.
- Hosting: works on any Node host (Render, Railway, Fly.io, a VPS). Just make sure `data/` is on persistent storage, since `db.json` lives there.
