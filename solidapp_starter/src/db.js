import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'solidapp.sqlite');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function run(sql, params = {}) { return db.prepare(sql).run(params); }
export function get(sql, params = {}) { return db.prepare(sql).get(params); }
export function all(sql, params = {}) { return db.prepare(sql).all(params); }
