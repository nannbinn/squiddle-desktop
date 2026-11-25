/* Squiddle 界面：标题栏、播放条、像素进度条、右侧抽屉（曲目 / 调节 / 刚才这一下）、文字显影、ASCII 动画、开场。
   舞台（js/stage.js）只通过 window.Squiddle 接口打交道。动画都按真实帧时长 dt 写，和帧率无关。 */
(function(){
'use strict';
const S = window.Squiddle;
const $ = s => document.querySelector(s);
const desk = window.squiddleDesktop || null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const win = $('#win');
const fmt = t => { t = Math.max(0, t); return Math.floor(t/60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const store = {
  get(k, d){ try{ const v = localStorage.getItem('squiddle.' + k); return v === null ? d : JSON.parse(v); } catch(_){ return d; } },
  set(k, v){ try{ localStorage.setItem('squiddle.' + k, JSON.stringify(v)); } catch(_){} },
};

/* ---------- 文字显影 ----------
   每个字一个门槛 = 从左到右的位置 + 一点随机；一道扫描 m 依次越过门槛：
   没越过的显示旧字（淡），正在越过的显示乱码，越过了的显示新字。 */
const GA = '#%&*+=/<>?~:;!^', GW = '＃％＆＊＋＝／＜＞？～：；！＾';
const wide = c => /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(c);
const esc = c => c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;
const blank = t => t.replace(/[^\s]/g, c => wide(c) ? '　' : ' ');
const runs = new WeakMap();
function reveal(el, text, o = {}){
  const from = o.from !== undefined ? o.from : el.textContent;
  const dur = o.dur || 560, band = o.band || .22, delay = o.delay || 0;
  if(reduced() || (from === text && !o.force)){ runs.delete(el); el.textContent = text; return; }
  const n = Math.max(from.length, text.length), th = [];
  for(let i=0; i<n; i++) th.push((n > 1 ? i/(n - 1) : 0)*(1 - band - .12) + Math.random()*.12);
  const tok = {}; runs.set(el, tok);
  const t0 = performance.now() + delay;
  const step = now => {
    if(runs.get(el) !== tok) return;
    const k = Math.max(0, Math.min(1, (now - t0)/dur)), m = 1 - Math.pow(1 - k, 3), tick = Math.floor(now/55);
    let h = '';
    for(let i=0; i<n; i++){
      const a = from[i] || '', b = text[i] || '', x = (m*(1 + band) - th[i])/band;
      if(x >= 1){ h += esc(b); continue; }
      if(x < 0){ h += a ? (/\s/.test(a) ? a : '<span class="gh">' + esc(a) + '</span>') : ''; continue; }
      const ref = b || a; if(!ref || /\s/.test(ref)){ h += ref; continue; }
      const pool = wide(ref) ? GW : GA;
      h += '<span class="' + (x < .5 ? 'gl2' : 'gl') + '">' + pool[(i*7 + tick*13 + (i*tick) % 5) % pool.length] + '</span>';
    }
    el.innerHTML = h;
    if(k < 1) requestAnimationFrame(step); else { el.textContent = text; runs.delete(el); }
  };
  requestAnimationFrame(step);
}
function revealIn(box){          // 抽屉打开或切页时，里面的标题和标签从上往下依次显出来
  let i = 0;
  for(const el of box.querySelectorAll('.rv')){
    if(el.offsetParent === null) continue;
    if(!el.dataset.rv) el.dataset.rv = el.textContent;
    const t = el.dataset.rv;
    reveal(el, t, {from: blank(t).replace(/./g, (c, j) => j % 3 === 1 && !/\s/.test(t[j]) ? (wide(t[j]) ? '＊' : '.') : c), delay: i++*45, dur: 520, force: true});
  }
}

/* ---------- 标题栏 ---------- */
const meterEl = $('#meter'), tbNow = $('#tbNow');
const lv = new Float32Array(8), MCH = ['_', '.', ':', '|', '#'];
const LVI = {kick:0, floor:1, tom2:2, tom1:3, snare:4, hihat:6, crash:7};
function drawMeter(){
  let s = ''; for(let i=0; i<8; i++) s += MCH[Math.min(4, Math.round(lv[i]*4))];
  meterEl.innerHTML = '[' + s.replace(/#/g, '<em>#</em>') + ']';
}
if(desk && desk.win){
  $('#wbtns').hidden = false;
  $('#wMin').onclick = () => desk.win.min();
  $('#wMax').onclick = () => desk.win.max();
  $('#wClose').onclick = () => desk.win.close();
  desk.win.onState(st => {
    const b = $('#wMax'); b.textContent = st.max ? '][' : '[]'; b.title = b.ariaLabel = st.max ? '还原' : '最大化';
    win.classList.toggle('full', st.full);
  });
}

/* ---------- 播放条 ---------- */
const playBtn = $('#play'), loopBtn = $('#loop'), dirBtn = $('#dir'), spotBtn = $('#spot'), stageEl = $('#stage'), camEl = $('#cam');
function showState(st){
  playBtn.classList.toggle('on', st.playing); playBtn.setAttribute('aria-label', st.playing ? '暂停' : '播放');
  loopBtn.setAttribute('aria-pressed', String(st.loop));
  dirBtn.setAttribute('aria-pressed', String(st.director));
  spotBtn.setAttribute('aria-pressed', String(st.spot)); stageEl.classList.toggle('spot', st.spot);
  camEl.classList.toggle('live', st.director);
}
S.on('state', showState);
playBtn.onclick = () => S.play();
$('#rewind').onclick = () => S.rewind();
loopBtn.onclick = () => S.setLoop(!S.state().loop);
dirBtn.onclick = () => S.setDirector(!S.state().director);
spotBtn.onclick = () => S.setSpot(!S.state().spot);
S.on('camera', lab => reveal(camEl, lab, {dur: 620}));

let songMode = '';
function showSong(info, first){
  const o = first ? {from: blank(info.name), force: true} : {};
  reveal($('#pTitle'), info.name, Object.assign({dur: 640}, o));
  reveal($('#pMeta'), info.meta, {dur: 700, delay: 60, ...(first ? {from: blank(info.meta), force: true} : {})});
  reveal(tbNow, '- ' + info.name, {dur: 700});
  speedIn.value = Math.round(info.rate*100); speedOut.textContent = info.speedLabel; setBar(speedIn.closest('.pbar'), (speedIn.value - speedIn.min)/(speedIn.max - speedIn.min));
  songMode = info.mode; $('#songVolL').hidden = info.mode !== 'audio';
}
S.on('song', info => showSong(info));

/* 像素进度条：填充按整格走，把手跟着头 */
function setBar(bar, p){
  p = Math.max(0, Math.min(1, p));
  const W = bar.clientWidth, pitch = 7;
  bar.querySelector('.fill').style.width = Math.min(W, Math.round(p*W/pitch)*pitch) + 'px';
  bar.querySelector('.knob').style.left = (p*W) + 'px';
}
function bindDrag(bar){
  bar.querySelector('input').addEventListener('pointerdown', () => bar.classList.add('drag'));
  addEventListener('pointerup', () => bar.classList.remove('drag'));
}
const seekBar = $('#seekBar'), seekIn = $('#seek'); bindDrag(seekBar);
seekIn.addEventListener('input', () => S.seek(seekIn.value/1000*S.time().dur));

/* ---------- 点舞台：点中鼓的地方迸出 ASCII 火花 ---------- */
S.on('aim', a => sparks(a.x, a.y));
function sparks(x, y){
  if(reduced()) return;
  const G = ['*', '+', '.', 'x', '*', "'"], C = ['#e7c03c', '#f2e396', '#f083a5', '#a58df1'], n = 9;
  for(let i=0; i<n; i++){
    const s = document.createElement('span'); s.className = 'spark'; s.textContent = G[i % G.length]; s.style.color = C[i % C.length];
    s.style.left = x + 'px'; s.style.top = y + 'px'; document.body.appendChild(s);
    const a = (i/n)*Math.PI*2 + Math.random()*.4, d = 28 + Math.random()*30;
    s.animate([{transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1},
               {transform: `translate(calc(-50% + ${Math.cos(a)*d}px), calc(-50% + ${Math.sin(a)*d - 10}px)) scale(.6)`, opacity: 0}],
      {duration: 520 + Math.random()*200, easing: 'cubic-bezier(.22,1,.36,1)'}).onfinish = () => s.remove();
  }
}

/* ---------- 抽屉 ---------- */
const drawer = $('#drawer'), menuBtn = $('#menuBtn'), scrim = $('#scrim');
const TABS = ['tab-lib', 'tab-adj', 'tab-hit'];
let curTab = TABS.includes(store.get('tab')) ? store.get('tab') : 'tab-lib';
const isOpen = () => drawer.classList.contains('open');
function placeInd(){ const b = document.getElementById(curTab), ind = $('#ind'); ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`; }
function selectTab(id, focus){
  const from = TABS.indexOf(curTab), to = TABS.indexOf(id);
  curTab = id; store.set('tab', id);
  for(const t of TABS){
    const b = document.getElementById(t), p = document.getElementById(b.getAttribute('aria-controls')), on = t === id;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    p.style.setProperty('--from', (to >= from ? 14 : -14) + 'px');
    const was = p.classList.contains('on');
    p.classList.toggle('on', on);
    if(on && !was && isOpen()) revealIn(p);
  }
  placeInd(); requestAnimationFrame(syncBars);
  if(focus) document.getElementById(id).focus();
}
function openMenu(on, tab){
  const was = isOpen();
  drawer.classList.toggle('open', on); scrim.classList.toggle('on', on);
  menuBtn.setAttribute('aria-expanded', String(on)); menuBtn.setAttribute('aria-pressed', String(on));
  if(tab) selectTab(tab);
  if(on && !was){ requestAnimationFrame(() => { placeInd(); syncBars(); }); setTimeout(() => revealIn(document.querySelector('.pane.on')), 60); }
  if(!on && was && drawer.contains(document.activeElement)) menuBtn.focus();
}
menuBtn.onclick = () => openMenu(!isOpen());
$('#drawerX').onclick = () => openMenu(false);
scrim.onclick = () => openMenu(false);
for(const t of TABS) document.getElementById(t).onclick = () => selectTab(t);
$('.tabs').addEventListener('keydown', e => {
  const i = TABS.indexOf(curTab);
  if(e.key === 'ArrowRight'){ e.preventDefault(); selectTab(TABS[(i + 1) % 3], true); }
  if(e.key === 'ArrowLeft'){ e.preventDefault(); selectTab(TABS[(i + 2) % 3], true); }
});

/* ---------- 曲目 ---------- */
const list = $('#songs');
let libCache = [];
function renderLib(items){
  const known = new Set(libCache.map(x => x.name + '|' + x.dur));
  libCache = items; list.textContent = '';
  for(const s of items){
    const li = document.createElement('li'); li.className = 'song' + (s.current ? ' cur' : '') + (libCache.length && !known.has(s.name + '|' + s.dur) && known.size ? ' new' : '');
    li.innerHTML = '<div><div class="row" tabindex="0" role="button"><span class="eq"></span><span class="t"><b></b><span></span></span><button class="rm" type="button" aria-label="移除">x</button></div></div>';
    const tb = li.querySelector('b'); tb.textContent = s.name; tb.className = 'rv'; tb.dataset.rv = s.name;
    li.querySelector('.t span').textContent = s.kind + ' · ' + fmt(s.dur) + ' · ' + s.bpm + ' BPM';
    const row = li.querySelector('.row');
    if(s.current) row.setAttribute('aria-current', 'true');
    row.onclick = e => { if(e.target.closest('.rm')) return; S.selectSong(s.i); };
    row.onkeydown = e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); S.selectSong(s.i); } };
    const rm = li.querySelector('.rm');
    if(items.length <= 1) rm.hidden = true;
    rm.onclick = () => { li.classList.add('gone'); setTimeout(() => S.removeSong(s.i), reduced() ? 0 : 280); };
    list.appendChild(li);
  }
}
S.on('lib', renderLib);
const fileIn = $('#file');
function openFile(){ fileIn.click(); }
$('#drop').onclick = openFile;
fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if(f) S.loadFile(f); });
const tabText = $('#tabText');
tabText.value = S.exampleTab;
$('#tabGo').onclick = () => S.loadTabText(tabText.value);

/* 拖文件进窗口 */
const hasFiles = e => !!(e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
let dragN = 0;
document.addEventListener('dragenter', e => { if(!hasFiles(e)) return; e.preventDefault(); if(++dragN === 1){ win.classList.add('dragging'); openMenu(true, 'tab-lib'); } });
document.addEventListener('dragover', e => { if(hasFiles(e)) e.preventDefault(); });
document.addEventListener('dragleave', e => { if(hasFiles(e) && --dragN <= 0){ dragN = 0; win.classList.remove('dragging'); } });
document.addEventListener('drop', e => { if(!hasFiles(e)) return; e.preventDefault(); dragN = 0; win.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if(f) S.loadFile(f); });

/* ---------- 提示条：显影出现；读文件时是一条带 ASCII 进度的 ---------- */
const toasts = $('#toasts');
function toast(text, o = {}){
  const t = document.createElement('div'); t.className = 'toast' + (o.err ? ' err' : ''); toasts.appendChild(t);
  while(toasts.children.length > 3) toasts.firstChild.remove();
  reveal(t, text, {from: blank(text), dur: Math.min(900, 300 + text.length*6), force: true});
  const ms = o.ms || Math.min(9000, 2200 + text.length*60);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 230); }, ms);
  return t;
}
S.on('msg', m => { if(m.txt) toast(m.txt, {err: m.err}); });
let jobToast = null, spin = 0;
S.on('job', j => {
  if(!j){ if(jobToast){ const t = jobToast; jobToast = null; t.classList.add('out'); setTimeout(() => t.remove(), 230); } return; }
  if(!jobToast){ jobToast = document.createElement('div'); jobToast.className = 'toast'; toasts.appendChild(jobToast); }
  const p = j.p || 0, n = Math.round(p*14);
  jobToast.innerHTML = `<span class="k">${'|/-\\'[spin++ % 4]}</span> ${j.txt.replace(/[&<>]/g, esc)} [${'#'.repeat(n)}${'.'.repeat(14 - n)}] ${Math.round(p*100)}%`;
});

/* ---------- 调节 ---------- */
const speedIn = $('#speed'), speedOut = $('#speedV');
const set0 = store.get('settings', {});
const CTL = {
  speed:   {out: speedOut, fmt: v => S.setSpeed(+v)},
  drumVol: {out: $('#drumVolV'), fmt: v => { S.setDrumVol(+v); return v; }, save: true},
  songVol: {out: $('#songVolV'), fmt: v => { S.setSongVol(+v); return v; }, save: true},
  tune:    {out: $('#tuneV'), fmt: v => { S.setTune(+v); return v + '%'; }, save: true},
};
for(const id in CTL){
  const inp = document.getElementById(id), c = CTL[id], bar = inp.closest('.pbar');
  if(c.save && set0[id] !== undefined) inp.value = set0[id];
  const upd = apply => {
    if(apply) c.out.textContent = c.fmt(inp.value);
    setBar(bar, (inp.value - inp.min)/(inp.max - inp.min));
  };
  inp.addEventListener('input', () => { upd(true); if(c.save){ set0[id] = +inp.value; store.set('settings', set0); } });
  bindDrag(bar); c.upd = upd;
  if(c.save) upd(true);
}
function syncBars(){ for(const id in CTL) CTL[id].upd(false); }
const seg = $('#seg'), segBtns = [...seg.querySelectorAll('button')];
function setCap(i){
  segBtns.forEach((x, j) => x.setAttribute('aria-checked', String(j === i)));
  $('#segTh').style.transform = `translateX(${i*100}%)`;
  S.setFrameCap(+segBtns[i].dataset.cap); set0.cap = i; store.set('settings', set0);
}
segBtns.forEach((b, i) => b.onclick = () => setCap(i));
setCap(Math.max(0, Math.min(2, set0.cap | 0)));
$('#resetView').onclick = () => S.resetView();

/* ---------- 刚才这一下：ASCII 模态柱 + 鼓皮上的落点和波纹 ---------- */
const specEl = $('#spec'), headEl = $('#headArt'), SH = 7;
let parts = [], shown = [];
const fmtF = f => f >= 1000 ? (f/1000).toFixed(1) + 'k' : String(Math.round(f));
function drawSpec(){
  const n = parts.length;
  if(!n){ specEl.innerHTML = Array(SH).fill('').concat('<s>点个鼓，或者放首歌</s>').join('\n'); return; }
  const mx = Math.max(1e-4, ...parts.map(p => p.a)), lines = [];
  for(let r=SH; r>=1; r--){
    let l = '';
    for(let i=0; i<n; i++){
      const h = shown[i]/mx*SH, pk = Math.round(parts[i].a/mx*SH);
      if(h >= r - .2) l += r > SH - 2 ? '<i>##</i> ' : '## ';
      else if(pk === r) l += '<u>==</u> ';
      else l += r === 1 ? '.. ' : '   ';
    }
    lines.push(l);
  }
  const fs = parts.map(p => p.f), lo = fmtF(Math.min(...fs)), hi = fmtF(Math.max(...fs)) + ' Hz';
  const w = Math.max(lo.length + hi.length + 2, n*3 - 1);
  lines.push('<s>' + lo + ' '.repeat(w - lo.length - hi.length) + hi + '</s>');
  specEl.innerHTML = lines.join('\n');
}
const HW = 17, HH = 9, HCX = 8, HCY = 4, HRX = 8, HRY = 4;
let hit = {x: HCX, y: HCY, t: -9};
const insideHead = (x, y) => Math.hypot((x - HCX)/HRX, (y - HCY)/HRY) <= 1.04;
function drawHead(now){
  const rad = (now - hit.t)*14; let out = '';
  for(let y=0; y<HH; y++){
    for(let x=0; x<HW; x++){
      const d = Math.hypot((x - HCX)/HRX, (y - HCY)/HRY);
      if(d > 1.04){ out += ' '; continue; }
      if(Math.round(hit.x) === x && Math.round(hit.y) === y){ out += '<i>*</i>'; continue; }
      const edge = !insideHead(x - 1, y) || !insideHead(x + 1, y) || !insideHead(x, y - 1) || !insideHead(x, y + 1);
      if(edge){
        const dx = (x - HCX)/HRX, dy = (y - HCY)/HRY, a = Math.abs(Math.atan2(dy, dx))*180/Math.PI;
        out += a < 25 || a > 155 ? '|' : (a > 65 && a < 115) ? '-' : ((dx < 0) === (dy < 0) ? '/' : '\\'); continue;
      }
      const dh = Math.hypot((x - hit.x)/2, y - hit.y);
      if(rad < 14 && Math.abs(dh*1.6 - rad) < .9){ out += '<u>o</u>'; continue; }
      out += Math.abs(d - .45) < .07 ? '.' : ' ';
    }
    out += '\n';
  }
  headEl.innerHTML = out;
}
const hName = $('#hName'), hPos = $('#hPos'), hVel = $('#hVel'), hSpd = $('#hSpd');
S.on('hit', h => {
  parts = h.parts || []; shown = parts.map(p => p.a);
  const i = LVI[h.key]; if(i !== undefined){ lv[i] = Math.max(lv[i], h.vel); if(i < 7) lv[i + 1] = Math.max(lv[i + 1], h.vel*.6); }
  hit = {x: HCX + h.x*(HRX - 1), y: HCY + h.z*(HRY - .6), t: performance.now()/1000};
  const pos = (h.rn < .3 ? '中心' : h.rn < .65 ? '中间' : '靠边') + ' ' + h.rn.toFixed(2);
  if(isOpen() && curTab === 'tab-hit'){ reveal(hName, h.label, {dur: 260, band: .5}); reveal(hPos, pos, {dur: 260, band: .5}); }
  else { hName.textContent = h.label; hPos.textContent = pos; }
  hVel.textContent = h.vel.toFixed(2); hSpd.textContent = h.speed.toFixed(1) + ' m/s';
});

/* ---------- 键盘 ---------- */
document.addEventListener('keydown', e => {
  const tag = e.target && e.target.tagName;
  const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range');
  if((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')){ e.preventDefault(); openFile(); return; }
  if(e.key === 'F11'){ e.preventDefault(); if(desk && desk.win) desk.win.full(); else if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); return; }
  if(typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.code === 'Space' && !e.repeat){ if(tag === 'BUTTON' || tag === 'SUMMARY') return; e.preventDefault(); S.play(); }
  else if(e.key === 'm' || e.key === 'M') openMenu(!isOpen());
  else if(e.key === '1' || e.key === '2' || e.key === '3') openMenu(true, TABS[+e.key - 1]);
  else if(e.key === 'Escape' && isOpen()) openMenu(false);
});

/* ---------- 开场：ASCII 鱿鱼打鼓 + 进度 ---------- */
const SQ = [
[ '        <i>*</i>        ', '       /^\\       ', '      / <i>*</i> \\      ', '     |  <i>*</i>  |     ', '     | <i>***</i> |     ',
  '      \\___/      ', '      (o o)      ', '   ,--/|||\\--,   ', '  <u>[==]</u>  |  <u>[==]</u>  ', ' <u>(____)</u>/_\\<u>(____)</u> ' ],
[ '        <i>+</i>        ', '       /^\\       ', '      / <i>+</i> \\      ', '     |  <i>*</i>  |     ', '     | <i>***</i> |     ',
  '      \\___/      ', '      (- -)      ', "   '--/|||\\--,   ", '  <u>[==]</u>  |  <u>[==]</u> <i>*</i>', ' <u>(____)</u>/_\\<u>(____)</u> ' ],
[ '        <i>.</i>        ', '       /^\\       ', '      / <i>*</i> \\      ', '     |  <i>+</i>  |     ', '     | <i>***</i> |     ',
  '      \\___/      ', '      (o o)      ', "   ,--/|||\\--'   ", '<i>*</i> <u>[==]</u>  |  <u>[==]</u>  ', ' <u>(____)</u>/_\\<u>(____)</u> ' ],
];
const STEPS = ['调鼓皮', '接音箱', '铺星空', '叫醒鱿鱼'];
const splash = $('#splash'), sq = $('#sq'), loadStep = $('#loadStep'), loadBar = $('#loadBar');
S.play(false);       // 开场时先别打，开场结束再开始
function runSplash(){
  const dur = reduced() ? 200 : 1800, t0 = performance.now(); let f = 0, want = '';
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0)/dur), n = Math.round(p*20);
    sq.innerHTML = SQ[f++ % 3].join('\n');
    const st = STEPS[Math.min(3, Math.floor(p*4))];
    if(st !== want){ want = st; reveal(loadStep, st, {from: loadStep.textContent || blank(st), dur: 300, band: .5, force: true}); }
    loadBar.innerHTML = `  [<b>${'#'.repeat(n)}</b>${'.'.repeat(20 - n)}] ${String(Math.round(p*100)).padStart(3)}%`;
    if(p < 1) setTimeout(tick, 170);
    else fontsReady.then(() => setTimeout(done, 200));
  };
  tick();
}
function done(){
  splash.classList.add('bye');
  setTimeout(() => { splash.hidden = true; }, 650);
  reveal($('#logoT'), 'Squiddle', {from: '########', dur: 700, force: true});
  reveal(camEl, S.camera(), {from: blank(S.camera()), dur: 600, delay: 200, force: true});
  showSong(S.song(), true);
  syncBars(); placeInd();
  if(desk){ S.play(true); }
  else {                                       // 网页里打开：浏览器要先点一下才出声
    const b = $('#start'); b.hidden = false;
    b.onclick = () => { S.unlockAudio(); S.play(true); b.hidden = true; };
  }
}

/* ---------- 每帧：电平、进度、时间、帧率、模态柱和鼓皮 ---------- */
let last = performance.now(), slow = 0, fpsT = 0;
const fpsHist = [], timeEl = $('#time'), fpsV = $('#fpsV'), fpsGr = $('#fpsGr');
let timeStr = '';
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - last)/1000); last = now;
  for(let i=0; i<8; i++) lv[i] *= Math.pow(.05, dt);
  for(let i=0; i<parts.length; i++) shown[i] *= Math.exp(-dt/Math.max(.03, parts[i].tau*.5));
  const tm = S.time(), p = tm.dur ? tm.t/tm.dur : 0;
  setBar(seekBar, p); if(!seekBar.classList.contains('drag')) seekIn.value = Math.round(p*1000);
  const ts = fmt(tm.t) + ' / ' + fmt(tm.dur);
  if(ts !== timeStr){ timeEl.textContent = timeStr = ts; seekIn.setAttribute('aria-valuetext', ts); }
  fpsT += dt;
  if(fpsT >= .5){
    fpsT = 0; const v = S.fps(); fpsV.textContent = v ? v + ' fps' : '--';
    fpsHist.push(v); if(fpsHist.length > 14) fpsHist.shift();
    const mx = Math.max(...fpsHist, 1); fpsGr.textContent = fpsHist.map(x => ' ._-=^'[Math.max(1, Math.round(x/mx*5))]).join('');
  }
  slow += dt;
  if(slow > 1/30){
    slow = 0; drawMeter();
    if(isOpen() && curTab === 'tab-hit'){ drawSpec(); drawHead(now/1000); }
    const playing = S.state().playing;
    for(const li of list.children){
      const eq = li.querySelector('.eq'); if(!eq) continue;
      eq.textContent = li.classList.contains('cur') ? (playing ? [0, 3, 6].map(i => '.:|'[Math.min(2, Math.round((lv[i] + lv[i + 1])*1.6))]).join('') : '|| ') : '';
    }
  }
}

/* ---------- 启动 ---------- */
addEventListener('resize', () => { placeInd(); syncBars(); });
showState(S.state()); renderLib(S.lib());
selectTab(curTab);
drawSpec(); drawHead(0); drawMeter();
requestAnimationFrame(frame);
runSplash();
})();
