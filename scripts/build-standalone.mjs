// Skleja web/ w jeden samodzielny plik HTML (bez serwera, bez modułów) —
// do otwarcia wprost w przeglądarce / na telefonie. Działa na danych
// przykładowych; przycisk „Importuj skład" nadal wczytuje data/squad.json.
//
//   node scripts/build-standalone.mjs [ścieżka-wyjściowa]
//   (domyślnie: hattrick-standalone.html w katalogu projektu)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB = path.join(ROOT, 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');

// Usuwa import/export, żeby wszystko zmieściło się w jednym module.
const strip = (js) =>
  js
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(const|let|function|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '');

const bundle = [
  '// ===== sample-squad.js =====',
  strip(read('sample-squad.js')),
  '// ===== optimizer.js =====',
  strip(read('optimizer.js')),
  '// ===== training-calc.js =====',
  strip(read('training-calc.js')),
  '// ===== app.js =====',
  strip(read('app.js')),
].join('\n\n');

const css = read('style.css');

const indexBody = read('index.html')
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script[\s\S]*?<\/script>/g, '') // usuń <script src=app.js> i rejestrację SW
  .replace(/<link rel="manifest"[^>]*>/g, '')
  .trim();

const html = `<title>Gaffer</title>
<meta name="color-scheme" content="dark" />
<style>
${css}
</style>

${indexBody}

<script type="module">
${bundle}
</script>
`;

const out = process.argv[2] || path.join(ROOT, 'hattrick-standalone.html');
fs.writeFileSync(out, html);
console.log(`Zapisano: ${out}  (${(html.length / 1024).toFixed(0)} KB)`);
