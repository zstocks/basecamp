import './db.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  // Only safe, read-only methods for now
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  // Health check — same shape your other apps use
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', app: 'basecamp' }));
    return;
  }

  // Static file serving out of public/
  const path = req.url === '/' ? '/index.html' : req.url;
  if (path.includes('..')) {            // crude path-traversal guard
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await readFile(join(PUBLIC_DIR, path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : file);
  } catch {
    res.writeHead(404).end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Basecamp running on http://localhost:${PORT}`);
});