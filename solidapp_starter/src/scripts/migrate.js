import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, description TEXT, is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, section_id INTEGER NOT NULL,
  title TEXT NOT NULL, body_md TEXT NOT NULL, body_html TEXT NOT NULL,
  kind TEXT CHECK(kind IN ('request','offer','question')) NOT NULL,
  score INTEGER DEFAULT 0, status TEXT CHECK(status IN ('visible','hidden','frozen','deleted')) DEFAULT 'visible',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, parent_id INTEGER,
  body_md TEXT NOT NULL, body_html TEXT NOT NULL, score INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('visible','hidden','frozen','deleted')) DEFAULT 'visible',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT CHECK(entity_type IN ('post','comment')) NOT NULL,
  entity_id INTEGER NOT NULL, direction INTEGER CHECK(direction IN (-1,1)) NOT NULL,
  token_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS votes_unique ON votes(entity_type, entity_id, token_hash);
CREATE TABLE IF NOT EXISTS reports ( id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id INTEGER, reason TEXT, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS bug_reports ( id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL );
`);
console.log('Migration complete.');
