// 文档一开始就注入。
// 故意不提供 window.squiddleDesktop：页面就按"网页版"走，加载完停在开场页等一次点击或按键（按任意处开始），
// 那一下同时解锁声音。窗口按钮本来就藏了；全屏状态和 F11 由这里和原生外壳接管。
(() => {
  const post = (name, v) => { try { webkit.messageHandlers[name].postMessage(v); } catch (_) {} };
  // 原生外壳在进出全屏时调用：页面的 .win.full 负责收起顶条和播放条
  window.__sqWinState = s => { const w = document.getElementById('win'); if (w) w.classList.toggle('full', !!s.full); };
  addEventListener('keydown', e => {
    if (e.key === 'F11') { e.preventDefault(); e.stopImmediatePropagation(); post('sqwin', 'full'); return; }   // 用窗口全屏，不用网页元素全屏
    if (e.key === 'Escape') post('sqwin', 'esc');                                                             // 全屏时按 Esc 退出（页面照样收到 Esc）
  }, true);
  // 控制台输出和报错转到外壳的终端输出里，方便看问题
  const fmt = a => a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (_) { return String(x); } }).join(' ');
  for (const l of ['log', 'warn', 'error']) { const o = console[l].bind(console); console[l] = (...a) => { post('sqlog', l + ': ' + fmt(a)); o(...a); }; }
  addEventListener('error', e => post('sqlog', 'uncaught: ' + e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  addEventListener('unhandledrejection', e => post('sqlog', 'rejection: ' + String(e.reason)));
})();
