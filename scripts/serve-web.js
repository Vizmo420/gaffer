// Malutki statyczny serwer dla web/ + udostępnia data/ (żeby interfejs sam
// wczytał data/squad.json wygenerowany przez `node cli.js squad`).
// Zero zależności — tylko wbudowane moduły Node.
//
//   npm run web   ->   http://localhost:5173

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT ?? 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  // /data/* -> katalog data/ (tylko pliki .json, tylko odczyt)
  if (url.startsWith('/data/')) {
    const name = path.basename(url);
    const file = path.join(DATA_DIR, name);
    if (path.extname(file) !== '.json' || !file.startsWith(DATA_DIR) || !fs.existsSync(file)) {
      return send(res, 404, '{"error":"not_found"}', MIME['.json']);
    }
    return send(res, 200, fs.readFileSync(file), MIME['.json']);
  }

  // reszta -> web/
  let rel = url === '/' ? '/index.html' : url;
  const file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Not found');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
});

server.listen(PORT, () => {
  console.log(`Interfejs: http://localhost:${PORT}`);
  console.log(`Dane z:    ${DATA_DIR}  (uruchom "node cli.js squad", żeby je wygenerować)`);
});
