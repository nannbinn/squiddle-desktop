// 准备 app/vendor：three.js r128 和两个字体拷成本地文件（app/ 里的 html/css/js 是源码，直接改那里）
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
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

console.log('vendor ready,', fs.readdirSync(fontsDir).length, 'font files');
