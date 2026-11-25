// 冒烟测试：用 Playwright 启动 Electron，看有没有报错、截一张图、确认声音已经开了
const { _electron: electron } = require('playwright');
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'], cwd: process.cwd(), executablePath: require('electron') });
  const win = await app.firstWindow();
  const errs = [];
  win.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|swiftshader|Security Warning/i.test(m.text()))) errs.push(m.type() + ': ' + m.text()); });
  win.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await win.waitForTimeout(5000);
  const st = await win.evaluate(() => ({ startHidden: document.getElementById('start').hidden, desktop: !!window.squiddleDesktop, font: document.fonts.check('20px "ZCOOL QingKe HuangYou"', '曲目'), pix: document.fonts.check('13px Silkscreen'), hits: Object.values(window.__dbg.HITS).reduce((a, b) => a + b, 0) }));
  console.log(JSON.stringify(st)); errs.forEach(e => console.log(e));
  await win.screenshot({ path: process.argv[2] || 'smoke.png' });
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
