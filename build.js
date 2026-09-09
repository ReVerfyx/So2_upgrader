#!/usr/bin/env node
/**
 * Мини-сборщик статики. Без зависимостей.
 *
 *   src/layout.html          — общий каркас страницы
 *   src/partials/*.html      — шапка / подвал
 *   src/pages/*.html         — контент страниц (+ JSON-шапка в HTML-комментарии)
 *   static/**                — копируется в dist как есть
 *   site.config.json         — единственный источник настроек
 *
 * Результат: dist/
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const siteUrl = String(cfg.siteUrl || '').replace(/\/+$/, '');

/* ---------- helpers ---------- */
const read = (p) => fs.readFileSync(p, 'utf8');
const dig = (obj, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);

function tpl(str, vars) {
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const v = dig(vars, key);
    return v === undefined || v === null ? m : String(v);
  });
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Разбирает JSON-шапку страницы: <!-- { "title": "..." } --> */
function parsePage(raw) {
  const m = raw.match(/^\s*<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) return { meta: {}, body: raw };
  let meta;
  try { meta = JSON.parse(m[1]); }
  catch (e) { throw new Error('Битая JSON-шапка страницы: ' + e.message); }
  return { meta, body: raw.slice(m[0].length) };
}

/* ---------- сборка ---------- */
rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

copyDir(path.join(ROOT, 'static'), OUT);

// настройки -> JS для браузера
fs.mkdirSync(path.join(OUT, 'assets/js'), { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'assets/js/config.js'),
  '/* Сгенерировано build.js из site.config.json. Правьте site.config.json. */\n' +
  'window.SITE_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n'
);

const layout = read(path.join(ROOT, 'src/layout.html'));
const partials = {};
for (const f of fs.readdirSync(path.join(ROOT, 'src/partials'))) {
  partials[path.basename(f, '.html')] = read(path.join(ROOT, 'src/partials', f));
}

const pagesDir = path.join(ROOT, 'src/pages');
const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort();
const built = [];

for (const file of files) {
  const { meta, body } = parsePage(read(path.join(pagesDir, file)));
  const name = path.basename(file, '.html');

  const vars = Object.assign({}, cfg, {
    year: new Date().getFullYear(),
    page: name,
    title: meta.title || cfg.brand,
    description: meta.description || cfg.tagline,
    bodyClass: meta.bodyClass || '',
    canonical: siteUrl + (name === 'index' ? '/' : '/' + file),
    scripts: (meta.scripts || []).map((s) => `<script src="assets/js/${s}" defer></script>`).join('\n    '),
    headExtra: meta.headExtra || ''
  });

  // активный пункт меню
  let header = partials.header.replace(
    new RegExp(`(data-nav="${name}")`, 'g'), '$1 aria-current="page" class="is-active"'
  );

  const html = tpl(
    tpl(layout, Object.assign({}, vars, {
      header,
      footer: partials.footer,
      body
    })),
    vars // второй проход: плейсхолдеры внутри партиалов и body
  );

  fs.writeFileSync(path.join(OUT, file), html);
  if (meta.noindex !== true) built.push({ file, priority: meta.priority || '0.6' });
  process.stdout.write(`  ✓ ${file}\n`);
}

/* sitemap.xml */
if (siteUrl) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = built.map(({ file, priority }) => {
    const loc = siteUrl + (file === 'index.html' ? '/' : '/' + file);
    return `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><priority>${priority}</priority></url>`;
  }).join('\n');
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
}

/* CNAME для своего домена: site.config.json -> customDomain, либо env CUSTOM_DOMAIN */
const domain = (process.env.CUSTOM_DOMAIN || cfg.customDomain || '').trim();
if (domain) {
  fs.writeFileSync(path.join(OUT, 'CNAME'), domain + '\n');
  process.stdout.write(`  ✓ CNAME -> ${domain}\n`);
}

/* GitHub Pages не должен прогонять сборку через Jekyll */
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

process.stdout.write(`\nГотово: ${built.length} стр. -> dist/\n`);
