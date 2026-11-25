// 把网页版 index-jelly.html 变成桌面版的 app/index.html：three.js 和字体改成本地文件，打开就有声音
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = process.argv[2] || path.join(root, 'web', 'index-jelly.html');
const app = path.join(root, 'app'), vendor = path.join(app, 'vendor'), fontsDir = path.join(vendor, 'fonts');
fs.rmSync(vendor, {recursive: true, force: true}); fs.mkdirSync(fontsDir, {recursive: true});
fs.copyFileSync(require.resolve('three/build/three.min.js'), path.join(vendor, 'three.min.js'));

// 字体：只拷 woff2，@font-face 里的地址改成本地
let css = '';
for (const pkg of ['silkscreen', 'zcool-qingke-huangyou']) {
  const dir = path.dirname(require.resolve(`@fontsource/${pkg}/package.json`));
  let c = fs.readFileSync(path.join(dir, '400.css'), 'utf8');
  c = c.replace(/,\s*url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/g, '').replace(/url\(\.\/files\//g, 'url(fonts/');
  for (const f of fs.readdirSync(path.join(dir, 'files'))) if (f.endsWith('-400-normal.woff2')) fs.copyFileSync(path.join(dir, 'files', f), path.join(fontsDir, f));
  fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(fontsDir, `${pkg}-LICENSE.txt`));
  css += c + '\n';
}
fs.writeFileSync(path.join(vendor, 'fonts.css'), css);

let html = fs.readFileSync(src, 'utf8');
const rep = (a, b) => { if (!html.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); html = html.replace(a, b); };
rep('<link rel="preconnect" href="https://fonts.googleapis.com">\n', '');
rep(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/.exec(html)[0], '<link rel="stylesheet" href="vendor/fonts.css">');
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', '<script src="vendor/three.min.js"></script>');
rep("  startBtn.hidden = true;\n});", "  startBtn.hidden = true;\n});\nif(window.squiddleDesktop) startBtn.click();     // 桌面版：没有自动播放限制，打开就有声音");
if (/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) console.warn('warning: page still references an external URL');
// 网页版是片段（发布时才套外壳）：标题和样式放进 <head>，从 <div class="wrap"> 起是 <body>
if (!/<!doctype/i.test(html)) { const k = html.indexOf('<div class="wrap">'); if (k < 0) throw new Error('no .wrap');
  html = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' + html.slice(0, k) + '</head>\n<body>\n' + html.slice(k) + '\n</body>\n</html>\n'; }
fs.writeFileSync(path.join(app, 'index.html'), html);
console.log('app/index.html ready,', fs.readdirSync(fontsDir).length, 'font files');
