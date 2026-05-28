import { db } from './db.js';

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();

console.log('Tables in basecamp.db:');
for (const { name } of tables) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all();
  console.log(`\n  ${name}`);
  for (const c of cols) {
    const flags = [c.notnull ? 'NOT NULL' : '', c.pk ? 'PK' : ''].filter(Boolean).join(' ');
    console.log(`    ${c.name.padEnd(18)} ${c.type.padEnd(8)} ${flags}`);
  }
}