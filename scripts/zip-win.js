// 把 dist/win-unpacked 打成 Squiddle-<版本>-win-x64.zip（解压后双击 Squiddle.exe）
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const v = require('../package.json').version, dist = path.join(__dirname, '..', 'dist'), out = path.join(dist, `Squiddle-${v}-win-x64.zip`);
fs.rmSync(path.join(dist, 'Squiddle'), { recursive: true, force: true }); fs.rmSync(out, { force: true });
fs.renameSync(path.join(dist, 'win-unpacked'), path.join(dist, 'Squiddle'));
execFileSync('zip', ['-qr9', out, 'Squiddle'], { cwd: dist, stdio: 'inherit' });
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
