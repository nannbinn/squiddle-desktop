// 性能实验模式（只在设了 SQ_EXP 环境变量时注入，正常双击打开不会加载）：
// 统计每帧的 WebGL 绘制调用数、2D 画布调用数、页面 JS 耗时；按开关关掉某个效果；自动"点一下开始"。
(() => {
  const exp = new Set(String(window.__SQ_EXP || '').split(',').filter(Boolean));
  const C = window.__sqC = { draw: 0, c2d: 0, js: 0, frames: 0 };
  for (const K of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!K) continue; const P = K.prototype;
    for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements'])
      if (P[m]) { const o = P[m]; P[m] = function (...a) { C.draw++; return o.apply(this, a); }; }
  }
  const P2 = CanvasRenderingContext2D.prototype;
  for (const m of ['fillRect', 'clearRect', 'drawImage', 'fillText', 'putImageData', 'stroke', 'fill']) {
    const o = P2[m]; P2[m] = function (...a) { C.c2d++; return o.apply(this, a); };
  }
  const raf = window.requestAnimationFrame.bind(window); let lastTs = -1;
  window.requestAnimationFrame = cb => raf(ts => {
    if (ts !== lastTs) { lastTs = ts; C.frames++; }
    const t0 = performance.now(); try { cb(ts); } finally { C.js += performance.now() - t0; }
  });
  const css = (exp.has('nofx') ? '#fx{display:none!important}' : '')
            + (exp.has('noanim') ? '*,*::before,*::after{animation:none!important;transition:none!important}' : '');
  if (css) addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
  addEventListener('load', () => setTimeout(() => {
    dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));                  // 开场页"按任意处开始"
    if (exp.has('cap60') && window.Squiddle) Squiddle.setFrameCap(60);                             // 设置里的 60 帧上限
    if (exp.has('norender')) setTimeout(() => window.Squiddle && Squiddle.hold(true), 1500);       // 3D 照常模拟，但不画
  }, 2500));
  // 记忆测试：memtest1 拖进一份鼓谱和一首合成的测试歌，改循环/导播/聚光灯；memtest2 只看重开后还在不在
  const wav = () => {   // 4 秒、每半拍一下"嗒"的单声道 wav
    const sr = 22050, n = sr * 4, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const t = (i % (sr / 2)) / sr; b.setInt16(44 + i * 2, Math.round(20000 * Math.exp(-t * 60) * Math.sin(t * 2 * Math.PI * 180)), true); }
    return b.buffer;
  };
  if (exp.has('memtest1')) addEventListener('load', () => setTimeout(async () => {
    await Squiddle.loadFile(new File([Squiddle.exampleTab], '记忆测试鼓谱.txt', { type: 'text/plain' }));
    await Squiddle.loadFile(new File([wav()], '记忆测试歌.wav', { type: 'audio/wav' }));
    Squiddle.setLoop(true); Squiddle.setDirector(!Squiddle.state().director); Squiddle.setSpot(!Squiddle.state().spot);
  }, 3500));
  if (exp.has('memtest3')) addEventListener('load', () => setTimeout(() => { const L = Squiddle.lib(); for (let i = L.length - 1; i >= 2; i--) Squiddle.removeSong(i); }, 3500));   // 把存过的都删掉
  addEventListener('load', () => window.Squiddle && Squiddle.on('msg', m => m.txt && console.log('[msg] ' + m.txt)));
  window.__sqMem = () => { const st = Squiddle.state(); return '曲目 ' + Squiddle.lib().map(s => s.name + (s.current ? '(当前)' : '')).join(' / ') + ' | 循环=' + st.loop + ' 导播=' + st.director + ' 聚光灯=' + st.spot + ' 模式=' + Squiddle.song().mode; };
  // 场景统计：每个顶层物体下面有几个会画出来的东西、几个投影
  window.__sqScene = () => {
    const sc = window.__dbg && __dbg.body && __dbg.body.parent; if (!sc) return '无场景';
    const rows = {}; let tot = 0, cast = 0;
    const add = (k, o) => { const r = rows[k] || (rows[k] = { n: 0, cast: 0, mats: new Set() }); r.n++; if (o.castShadow) r.cast++; r.mats.add(o.material && o.material.uuid); };
    sc.children.forEach((c, i) => {
      const key = c === __dbg.body ? '鱿鱼body' : (c.type + (c.isMesh ? ':' + (c.geometry && c.geometry.type) : '') + (c.children.length ? '[组]' : ''));
      c.traverse(o => { if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return; if (!o.visible) return; let v = true, p = o; while (p) { if (!p.visible) v = false; p = p.parent; } if (!v) return; tot++; if (o.castShadow) cast++; add(key, o); });
    });
    return '可见 ' + tot + ' 投影 ' + cast + '\n' + Object.entries(rows).sort((a, b) => b[1].n - a[1].n).map(([k, r]) => '    ' + k + ': ' + r.n + ' (投影 ' + r.cast + ', 材质 ' + r.mats.size + ')').join('\n');
  };
  window.__sqExpReset = () => { Object.assign(C, { draw: 0, c2d: 0, js: 0, frames: 0 }); window.__sqT0 = performance.now(); };
  window.__sqExpRead = () => {
    const s = (performance.now() - window.__sqT0) / 1000, f = Math.max(1, C.frames), fx = document.getElementById('fx');
    const splash = document.getElementById('splash');
    return 'fps=' + (C.frames / s).toFixed(0) + ' 绘制调用/帧=' + (C.draw / f).toFixed(0) + ' 2D调用/帧=' + (C.c2d / f).toFixed(0)
      + ' 页面JS毫秒/帧=' + (C.js / f).toFixed(2) + ' fx画布=' + fx.width + 'x' + fx.height + ' 开场页已关=' + (splash ? splash.hidden : '?') + (window.__sqMerge ? '\n  合并 ' + JSON.stringify(__sqMerge()) : '') + (window.__sqShadow ? ' 影子 ' + JSON.stringify(__sqShadow()) : '') + (exp.has('scene') ? '\n  ' + __sqScene() : '') + ([...exp].some(x => x.startsWith('memtest')) ? '\n  ' + __sqMem() : '');
  };
})();
