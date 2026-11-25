// 冒烟测试：用 Playwright 启动 Electron，看有没有报错、开场结束后是不是在打鼓、抽屉三页能不能打开，各截一张图
// 用法：xvfb-run -a -s "-screen 0 1400x1000x24" node scripts/smoke.js [截图文件名前缀]
const { _electron: electron } = require('playwright');
(async () => {
  const out = process.argv[2] || 'smoke';
  const app = await electron.launch({ args: ['.', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'], cwd: process.cwd(), executablePath: require('electron') });
  const win = await app.firstWindow();
  const errs = [];
  win.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|swiftshader|Security Warning/i.test(m.text()))) errs.push(m.type() + ': ' + m.text()); });
  win.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await win.waitForTimeout(1000);
  await win.screenshot({ path: `${out}-splash.png` });
  await win.waitForTimeout(5000);
  const st = await win.evaluate(() => ({
    desktop: !!window.squiddleDesktop, winBtns: !document.getElementById('wbtns').hidden,
    splashGone: document.getElementById('splash').hidden, playing: window.Squiddle.state().playing,
    title: document.getElementById('pTitle').textContent, time: document.getElementById('t0').textContent + ' / ' + document.getElementById('t1').textContent,
    songs: document.querySelectorAll('#songs .song').length,
    fonts: ['12px "Fusion Pixel 12px Proportional SC"', '13px Silkscreen', 'bold 13px Silkscreen', '20px VT323'].map(f => document.fonts.check(f, f.includes('Fusion') ? 'Ab鼓' : 'Ab')),
    hits: Object.values(window.__dbg.HITS).reduce((a, b) => a + b, 0),
  }));
  console.log(JSON.stringify(st));
  await win.screenshot({ path: `${out}-main.png` });
  for (const k of ['1', '2', '3']) { await win.keyboard.press(k); await win.waitForTimeout(900); await win.screenshot({ path: `${out}-tab${k}.png` }); }
  await win.keyboard.press('Escape'); await win.waitForTimeout(500);
  await win.hover('#seekBar'); await win.waitForTimeout(300);
  await win.screenshot({ path: `${out}-closed.png` });
  errs.forEach(e => console.log(e));
  await app.close();
  if (errs.some(e => e.startsWith('pageerror'))) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
