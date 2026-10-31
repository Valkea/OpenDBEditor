# OpenDB Editor

A PostgreSQL schema designer that runs entirely in the browser.

**Use it: <https://valkea.github.io/OpenDBEditor/>** (deployed from `main` on every push).

- **Nothing leaves your browser.** SQL is parsed, analysed and drawn on your device. There is no
  backend: the app is a set of static files, and the production build ships a Content-Security-Policy
  that forbids the page from contacting any other host, so the browser itself enforces it.
- **Works fully offline.** A service worker caches every file of the app (including the lazily
  loaded layout engine and SQL editor) on first visit; after that it runs with no network at all,
  and can be installed as an app.
- **No account, no tracking.** No sign-up, no cookies, no analytics. The only thing stored locally
  is your light/dark preference.
- **The link is the file.** The whole schema — tables, enums, extensions, relationships, groups,
  notes and positions — is compressed into the page URL's `#hash`, updated on every edit. Share the
  link to share the schema; bookmark the page to save it, even offline. The part after `#` is never
  sent to any server, not even the one hosting the app. A bookmark only holds the version you
  bookmarked, so also keep a copy with **Export → SQL + layout**, which re-opens with positions,
  groups and notes.

## Three ways to look at a schema

| View | What it is for |
| --- | --- |
| **Atlas** (1) | Groups become tinted regions ("islands"). Semantic zoom: far away each table is a block with its name in large type, mid-zoom shows only key columns, close-up shows every column with types, defaults, checks and comments. *Portals* turn references to hub tables into clickable chips instead of long lines. |
| **Blueprint** (2) | Classic full-detail ERD with crow's-foot notation on drafting paper — the one to print or export. |
| **Constellation** (3) | Tables as stars sized by columns and connections, pulled together by group. Click a star to put it at the centre with everything else in orbits by foreign-key distance; click the centre star (or double-click any star) to edit its table. |

## Features

- **Live SQL twin** (`S`): edit PostgreSQL DDL and the canvas follows; edit the canvas and the SQL regenerates. Errors are shown inline and pause syncing instead of breaking the drawing. Statements it doesn't model (views, functions, triggers…) are kept verbatim.
- **Arrange** (`L`): ELK-based auto-layout that lays out each group as an island, arranges the islands, tries several strategies and keeps the one with the fewest line crossings. **Locked** tables or groups never move; everything else is placed around them.
- **Suggest groups**: Louvain community detection on the foreign-key graph.
- **Health**: live checks with one-click fixes — FK columns without an index, redundant indexes, FK type mismatches, extension types used without the extension, `SET NULL` on `NOT NULL`, double-escaped comments, mixed-case identifiers, unused enums…
- **Compare**: load an older version (file, pasted SQL or link), see added/changed tables on the canvas, and get a migration script.
- **Join paths**: pick two tables, see the shortest FK chain light up and copy the `SELECT … JOIN …`.
- **Focus lens** (`F`): fade everything more than N hops away from the selected table.
- Enums, extensions (ltree, pgvector, PostGIS, citext, pgcrypto, pg_trgm, …), indexes (incl. partial / GiST / GIN / HNSW), unique & check constraints, identity and generated columns, comments, sticky notes attached to tables, table status (draft / deprecated).
- Import by file, drag & drop or paste. Export plain SQL, SQL with the layout embedded in a trailing comment block (re-opens with positions, groups and notes), or a PNG.

Shortcuts: `⌘K` command palette · `⌘Z` / `⇧⌘Z` undo/redo · double-click the canvas for a new table · drag a column dot onto another column to create a foreign key · `T` table · `N` note · `Esc` clear.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # parser, layout, lint, diff/migration tests
npm run build      # static site in dist/
```

Stack: React 19, React Flow (@xyflow/react), elkjs, d3-force, graphology, CodeMirror 6, zustand + immer, fflate.

`src/sql/` holds a hand-written, error-tolerant PostgreSQL DDL parser and the generator; `src/layout/`
the layout engines; `src/analysis/` lint, diff/migration and join-path logic; `src/canvas/` the
React Flow nodes and edges; `src/panels/` the UI around the canvas.
