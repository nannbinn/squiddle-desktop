// 把 app/ 打成一个能直接在浏览器里打开的单文件 html：脚本、样式、字体全部内嵌。
// 用法：npm run prepare-web && npm run build-web  →  dist/Squiddle-web.html
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app');
const OUT = path.join(__dirname, '..', 'dist', 'Squiddle-web.html');
const read = p => fs.readFileSync(path.join(APP, p), 'utf8');

// 字体表：url(fonts/x.woff2) → data URI
const fontsCss = read('vendor/fonts.css').replace(/url\((fonts\/[^)]+)\)/g, (m, f) => {
  const b = fs.readFileSync(path.join(APP, 'vendor', f)).toString('base64');
  return `url(data:font/woff2;base64,${b})`;
});

const safe = s => s.replace(/<\/script/gi, '<\\/script');
let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  const css = href === 'vendor/fonts.css' ? fontsCss : read(href);
  return `<style>\n${css}\n</style>`;
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => `<script>\n${safe(read(src))}\n</script>`);

if (/(?:src|href)="(?!data:|#|https?:)[^"]+\.(?:js|css|woff2)"/.test(html)) throw new Error('还有没内嵌的外部文件');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`${path.relative(process.cwd(), OUT)}  ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB`);
