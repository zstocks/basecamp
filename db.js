import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'basecamp.db');
const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Ensure the data directory exists before opening the file
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);

// PRAGMAs are per-connection settings. Set them once, immediately.
db.pragma('journal_mode = WAL'); // write-ahead logging: safer + faster, allows backups while running
db.pragma('foreign_keys = ON');  // SQLite requires this every connection to enforce FKs

function applyMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT filename FROM _migrations').all().map(r => r.filename)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const insertApplied = db.prepare('INSERT INTO _migrations (filename) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insertApplied.run(file);
    })();
    console.log(`Migration applied: ${file}`);
  }
}

applyMigrations();