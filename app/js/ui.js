/* Squiddle 界面（小样 v3）：标题栏、播放条、像素进度条、浮动菜单（曲目 / 调节 / 刚才这一下）、文字显影、ASCII 开场、粒子鼓皮和 1 像素粒子点缀。
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
const vuBars = [...document.querySelectorAll('#vu i')];
const lv = new Float32Array(8);
const LVI = {kick:0, floor:1, tom2:2, tom1:3, snare:4, hihat:6, crash:7};
function drawMeter(){ for(let i=0; i<8; i++) vuBars[i].style.setProperty('--v', (Math.min(4, Math.round(lv[i]*4))*25) + '%'); }
if(desk && desk.win){
  $('#wbtns').hidden = false;
  $('#wMin').onclick = () => desk.win.min();
  $('#wMax').onclick = () => desk.win.max();
  $('#wClose').onclick = () => desk.win.close();
  desk.win.onState(st => {
    const b = $('#wMax'); b.classList.toggle('max', st.max); b.title = b.ariaLabel = st.max ? '还原' : '最大化';
    win.classList.toggle('full', st.full);
  });
}

/* ---------- 播放条 ---------- */
const playBtn = $('#play'), loopBtn = $('#loop'), dirBtn = $('#dir'), spotBtn = $('#spot'), stageEl = $('#stage'), camEl = $('#cam'), camT = $('#camT');
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
S.on('camera', lab => reveal(camT, lab, {dur: 620}));

let songMode = '';
function showSong(info, first){
  const o = first ? {from: blank(info.name), force: true} : {};
  reveal($('#pTitle'), info.name, Object.assign({dur: 640}, o));
  reveal($('#pMeta'), info.meta, {dur: 700, delay: 60, ...(first ? {from: blank(info.meta), force: true} : {})});
  speedIn.value = Math.round(info.rate*100); speedOut.textContent = info.speedLabel; setBar(speedIn.closest('.pbar'), (speedIn.value - speedIn.min)/(speedIn.max - speedIn.min));
  songMode = info.mode; $('#songVolL').hidden = info.mode !== 'audio';
}
S.on('song', info => showSong(info));

/* 像素进度条：填充按整格走，把手跟着头 */
function setBar(bar, p){
  p = Math.max(0, Math.min(1, p));
  const W = bar.clientWidth, pitch = 7;
  const fw = Math.min(W, Math.round(p*W/pitch)*pitch);
  bar.querySelector('.fill').style.width = fw + 'px';
  bar.querySelector('.knob').style.left = (p*W) + 'px';
  const gl = bar.querySelector('.glow'); if(gl) gl.style.left = fw + 'px';
}
function bindDrag(bar){
  bar.querySelector('input').addEventListener('pointerdown', () => bar.classList.add('drag'));
  addEventListener('pointerup', () => bar.classList.remove('drag'));
}
/* 拖进度条或星轨的时候先停住演奏、跟着手走，松手再接着放，免得一边放一边跳 */
let scrub = null;
function scrubStart(){ if(scrub) return; scrub = {resume: S.state().playing}; if(scrub.resume) S.play(false); }
function scrubEnd(){ if(!scrub) return; const r = scrub.resume; scrub = null; if(r) S.play(true); }
const seekBar = $('#seekBar'), seekIn = $('#seek'); bindDrag(seekBar);
seekIn.addEventListener('pointerdown', scrubStart);
addEventListener('pointerup', scrubEnd); addEventListener('pointercancel', scrubEnd);
seekIn.addEventListener('input', () => S.seek(seekIn.value/1000*S.time().dur));

/* 星轨：按住左右拖，单击跳到那里 */
const laneCv = $('#lane'); let laneDrag = null;
const wrapT = t => { const d = S.time().dur || 1; return S.state().loop ? ((t % d) + d) % d : Math.max(0, Math.min(d, t)); };
laneCv.addEventListener('pointerdown', e => {
  laneCv.setPointerCapture(e.pointerId); const r = laneCv.getBoundingClientRect(), L = S.lane();
  laneDrag = {x0: e.clientX, t0: S.time().t, moved: false, k: r.width/L.lw, rx: r.left}; laneCv.classList.add('grab');
});
laneCv.addEventListener('pointermove', e => {
  if(!laneDrag) return; const dx = e.clientX - laneDrag.x0;
  if(!laneDrag.moved && Math.abs(dx) > 3){ laneDrag.moved = true; scrubStart(); }
  if(laneDrag.moved) S.seek(wrapT(laneDrag.t0 - dx/laneDrag.k/S.lane().pps));
});
const laneUp = e => {
  if(!laneDrag) return; const L = S.lane();
  if(!laneDrag.moved) S.seek(wrapT(S.time().t + ((e.clientX - laneDrag.rx)/laneDrag.k - L.phx)/L.pps));
  laneDrag = null; laneCv.classList.remove('grab'); scrubEnd();
};
laneCv.addEventListener('pointerup', laneUp); laneCv.addEventListener('pointercancel', laneUp);

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
/* 卡片高度按三页里最高的那页定，切页签时高度不变 */
function fitPanes(){ let h = 0; for(const p of document.querySelectorAll('.pane')) h = Math.max(h, p.scrollHeight); $('#panes').style.height = h + 'px'; }
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
  if(on && !was){ requestAnimationFrame(() => { placeInd(); syncBars(); fitPanes(); }); setTimeout(() => revealIn(document.querySelector('.pane.on')), 60); }
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
const XI = '<svg class="px" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M0 0h2v1h1v1h2V1h1V0h2v2H7v1H6v2h1v1h1v2H6V7H5V6H3v1H2v1H0V6h1V5h1V3H1V2H0z"/></svg>';
let libCache = [];
function renderLib(items){
  const known = new Set(libCache.map(x => x.name + '|' + x.dur));
  libCache = items; list.textContent = '';
  for(const s of items){
    const li = document.createElement('li'); li.className = 'song' + (s.current ? ' cur' : '') + (libCache.length && !known.has(s.name + '|' + s.dur) && known.size ? ' new' : '');
    li.innerHTML = '<div><div class="row" tabindex="0" role="button"><span><span class="no"></span><span class="eq"><i></i><i></i><i></i></span></span><span class="t"><b></b><span></span></span><button class="rm" type="button" aria-label="移除">' + XI + '</button></div></div>';
    li.querySelector('.no').textContent = String(s.i + 1).padStart(2, '0');
    const tb = li.querySelector('b'); tb.textContent = s.name; tb.className = 'rv'; tb.dataset.rv = s.name;
    li.querySelector('.t > span').textContent = s.kind + '·' + fmt(s.dur) + '·' + s.bpm + ' BPM';
    const row = li.querySelector('.row');
    if(s.current) row.setAttribute('aria-current', 'true');
    row.onclick = e => { if(e.target.closest('.rm')) return; S.selectSong(s.i); };
    row.onkeydown = e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); S.selectSong(s.i); } };
    const rm = li.querySelector('.rm');
    if(items.length <= 1) rm.hidden = true;
    rm.onclick = () => { li.classList.add('gone'); setTimeout(() => S.removeSong(s.i), reduced() ? 0 : 280); };
    list.appendChild(li);
  }
  $('#songN').textContent = items.length;
  if(isOpen()) requestAnimationFrame(fitPanes);
}
S.on('lib', renderLib);
const fileIn = $('#file');
function openFile(){ fileIn.click(); }
$('#drop').onclick = openFile;
fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if(f) S.loadFile(f); });
const tabText = $('#tabText');
tabText.value = S.exampleTab;
$('#tabGo').onclick = () => S.loadTabText(tabText.value);
$('#paste').addEventListener('toggle', () => { if(isOpen()) requestAnimationFrame(fitPanes); });

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

/* ---------- 画布工具：按设备像素画，1 颗粒子 = 1 个 CSS 像素 ---------- */
const DPR = () => Math.max(1, Math.round(window.devicePixelRatio || 1));
function fitCv(cv){ const d = DPR(), w = Math.round(cv.clientWidth*d), h = Math.round(cv.clientHeight*d); if(w && (cv.width !== w || cv.height !== h)){ cv.width = w; cv.height = h; } return d; }
function dot(px, W, H, x, y, s, r, g, b, a){
  x = Math.round(x); y = Math.round(y);
  for(let yy=0; yy<s; yy++){ const Y = y + yy; if(Y < 0 || Y >= H) continue;
    for(let xx=0; xx<s; xx++){ const X = x + xx; if(X < 0 || X >= W) continue; const i = (Y*W + X)*4; px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a; } }
}
const mix = (a, b, t) => a + (b - a)*t;

/* ---------- 刚才这一下：粒子鼓皮 ----------
   一千多颗粒子铺成圆形鼓皮，按圆膜的真实振动模态起伏：形状是贝塞尔函数 J_m(α_mn·r)·cos(m(θ-θ打))，
   打在哪里决定每个模态被激起多少（打在正中心只激起 m=0 的对称模态）。显示的振动放慢了，看得清花纹。 */
const MODES = [[0,2.405],[1,3.832],[2,5.136],[0,5.520],[3,6.380],[1,7.016],[4,7.588],[2,8.417],[0,8.654]];
const fact = n => { let f = 1; for(let i=2; i<=n; i++) f *= i; return f; };
function besselJ(m, x){ let s = 0, t = Math.pow(x/2, m)/fact(m); for(let k=0; k<40; k++){ s += t; t *= -(x*x/4)/((k + 1)*(k + 1 + m)); } return s; }
const MN = MODES.map(([m, a]) => { let mx = 0; for(let i=0; i<=200; i++) mx = Math.max(mx, Math.abs(besselJ(m, a*i/200))); return mx; });
const MEM = .9, RINGS = 24, PT = [];
const mkP = (r, th) => ({r, th, x: r*Math.cos(th), y: r*Math.sin(th), sh: MODES.map(([m, a], k) => besselJ(m, a*r/MEM)/MN[k])});
PT.push(mkP(0, 0));
for(let j=1; j<=RINGS; j++){ const r = j/RINGS*MEM*.985, n = Math.round(2*Math.PI*j*1.08), o = j*.61; for(let i=0; i<n; i++) PT.push(mkP(r, o + i/n*2*Math.PI)); }
const RIM = []; for(const [r, c] of [[.945, 0], [.975, 1]]){ const n = Math.round(2*Math.PI*RINGS*r/MEM*1.08); for(let i=0; i<n; i++) RIM.push([r*Math.cos(i/n*2*Math.PI), r*Math.sin(i/n*2*Math.PI), c, i]); }
const HEADHITS = [];
const KF = {kick:.55, floor:.65, tom2:.72, tom1:.8, snare:1, hihat:1.5, crash:1.3};
function headHit(rn, th, vel, key){
  const r = Math.min(.92, rn*.85), kf = KF[key] || 1;
  HEADHITS.push({r, th, t: performance.now()/1000,
    amp: MODES.map(([m, al], k) => (k ? .9 : .45)*vel*besselJ(m, al*r)/MN[k]/(1 + .2*k)),
    w: MODES.map(([, al]) => 6.5*kf*al/2.405),
    tau: MODES.map(([, al]) => 1.6/Math.sqrt(al/2.405)/kf)});
  if(HEADHITS.length > 3) HEADHITS.shift();
}
const headCv = $('#headCv'), hx = headCv.getContext('2d'); let headImg = null;
function drawHead(now){
  const d = fitCv(headCv), W = headCv.width, H = headCv.height; if(!W) return;
  if(!headImg || headImg.width !== W || headImg.height !== H) headImg = hx.createImageData(W, H);
  const px = headImg.data; px.fill(0);
  const cx = W/2 - d/2, cy = H/2 - d/2, R = W/2 - d, live = HEADHITS.filter(h => now - h.t < 5);
  for(const p of PT){
    let z = 0;
    for(const h of live){
      const age = now - h.t;
      for(let k=0; k<MODES.length; k++){ const A = h.amp[k]; if(A > -.002 && A < .002) continue; const m = MODES[k][0];
        z += A*Math.exp(-age/h.tau[k])*Math.cos(h.w[k]*age)*p.sh[k]*(m ? Math.cos(m*(p.th - h.th)) : 1); }
    }
    z = Math.tanh(z*1.5);
    let r, g, b, a;
    if(z >= 0){ if(z < .55){ const u = z/.55; r = mix(92, 240, u); g = mix(88, 131, u); b = mix(150, 165, u); } else { const u = (z - .55)/.45; r = mix(240, 255, u); g = mix(131, 244, u); b = mix(165, 248, u); } a = mix(165, 255, Math.min(1, z*2)); }
    else { const t = -z; r = mix(92, 66, t); g = mix(88, 52, t); b = mix(150, 140, t); a = mix(165, 90, t); }
    const s = d + (Math.abs(z) > .62 ? Math.max(1, d >> 1) : 0), k = 1 + z*.018;
    dot(px, W, H, cx + p.x*R*k, cy + p.y*R*k, s, r|0, g|0, b|0, a|0);
  }
  for(const [x, y, c, i] of RIM){ const lug = c === 1 && i % 9 === 0; dot(px, W, H, cx + x*R, cy + y*R, d, lug ? 255 : c ? 231 : 176, lug ? 238 : c ? 192 : 140, lug ? 170 : c ? 60 : 42, 255); }
  const h = HEADHITS[HEADHITS.length - 1];
  if(h){ const age = now - h.t; if(age < 1.6){
    const al = Math.round(255*(1 - age/1.6)), hp = cx + h.r*MEM*Math.cos(h.th)*R, vp = cy + h.r*MEM*Math.sin(h.th)*R;
    for(let q=-3; q<=3; q++){ dot(px, W, H, hp + q*d, vp, d, 242, 227, 150, q ? al*.8|0 : al); if(q) dot(px, W, H, hp, vp + q*d, d, 242, 227, 150, al*.8|0); } } }
  hx.putImageData(headImg, 0, 0);
}

/* ---------- 刚才这一下：细点阵频谱（真实的模态频率和衰减），峰顶飘火星 ---------- */
const specCv = $('#spec'), sx = specCv.getContext('2d'); let specImg = null;
const LF0 = Math.log(60), LF1 = Math.log(10000);
const PARTS = [], SPK = []; let PK = new Float32Array(0);
function specHit(parts, vel){
  const t = performance.now()/1000, mx = Math.max(1e-4, ...parts.map(p => p.a));
  parts.forEach((p, k) => { if(p.f < 60 || p.f > 10000) return; PARTS.push({f: p.f, a: vel*p.a/mx/(1 + .06*k), tau: Math.max(.25, (p.tau || .3)*1.2), t}); });
  while(PARTS.length > 120) PARTS.shift();
}
function drawSpec(now, dt){
  const d = fitCv(specCv), W = specCv.width, H = specCv.height; if(!W) return;
  if(!specImg || specImg.width !== W || specImg.height !== H) specImg = sx.createImageData(W, H);
  const px = specImg.data; px.fill(0);
  const pitch = 2*d, cols = Math.floor(W/pitch), rows = Math.floor(H/pitch);
  if(PK.length !== cols) PK = new Float32Array(cols);
  const S0 = new Float32Array(cols);
  for(const p of PARTS){
    const a = p.a*Math.exp(-(now - p.t)/p.tau); if(a < .01) continue;
    const c = (Math.log(p.f) - LF0)/(LF1 - LF0)*(cols - 1);
    for(let i=Math.max(0, Math.floor(c - 7)); i<=Math.min(cols - 1, Math.ceil(c + 7)); i++){ const e = (i - c)/1.9; S0[i] += a*Math.exp(-e*e); }
  }
  const kp = Math.pow(.3, dt);
  for(let i=0; i<cols; i++){
    const v = 1 - Math.exp(-S0[i]*1.6), top = v*rows;
    PK[i] = Math.max(v, PK[i]*kp);
    for(let r=0; r<rows; r++){
      const y = H - (r + 1)*pitch + (pitch - d), x = i*pitch;
      if(r < top){ const u = r/rows; let R, G, B;
        if(u < .55){ const w = u/.55; R = mix(147, 240, w); G = mix(64, 131, w); B = mix(127, 165, w); } else { const w = (u - .55)/.45; R = mix(240, 255, w); G = mix(131, 240, w); B = mix(165, 246, w); }
        dot(px, W, H, x, y, d, R|0, G|0, B|0, (110 + 145*Math.min(1, top - r))|0);
      } else dot(px, W, H, x, y, d, 151, 145, 215, 26);
    }
    const pr = Math.round(PK[i]*rows); if(pr > 1) dot(px, W, H, i*pitch, H - pr*pitch - pitch + (pitch - d), d, 242, 227, 150, 210);
    if(v > .12 && Math.random() < v*dt*9 && SPK.length < 160) SPK.push({x: i*pitch, y: H - top*pitch, vy: (14 + Math.random()*22)*d, vx: (Math.random() - .5)*6*d, life: 1, dec: .8 + Math.random()*.8, pink: Math.random() < .5});
  }
  for(let k=SPK.length - 1; k>=0; k--){
    const s = SPK[k]; s.y -= s.vy*dt; s.x += s.vx*dt; s.life -= s.dec*dt;
    if(s.life <= 0 || s.y < 0){ SPK.splice(k, 1); continue; }
    dot(px, W, H, s.x, s.y, d, s.pink ? 240 : 242, s.pink ? 150 : 227, s.pink ? 180 : 150, (255*s.life)|0);
  }
  sx.putImageData(specImg, 0, 0);
}

const hName = $('#hName'), hPos = $('#hPos'), hVel = $('#hVel'), hSpd = $('#hSpd');
S.on('hit', h => {
  if(h.parts && h.parts.length) specHit(h.parts, h.vel);
  headHit(h.rn, Math.atan2(h.z, h.x), h.vel, h.key);
  const i = LVI[h.key]; if(i !== undefined){ lv[i] = Math.max(lv[i], h.vel); if(i < 7) lv[i + 1] = Math.max(lv[i + 1], h.vel*.6); }
  if(S.state().playing && !scrub) laneSpark(h.key, h.vel);
  const pos = (h.rn < .3 ? '中心' : h.rn < .65 ? '中间' : '靠边') + ' ' + h.rn.toFixed(2);
  if(isOpen() && curTab === 'tab-hit'){ reveal(hName, h.label, {dur: 260, band: .5}); reveal(hPos, pos, {dur: 260, band: .5}); }
  else { hName.textContent = h.label; hPos.textContent = pos; }
  hVel.textContent = h.vel.toFixed(2); hSpd.textContent = h.speed.toFixed(1) + ' m/s';
});

/* ---------- 全窗口 1 像素粒子：按钮迸一圈、星轨溅射、进度条火星、拖放区浮尘 ---------- */
const fxCv = $('#fx'), fx = fxCv.getContext('2d'), FX = [];
const FXC = {pink:[240,131,165], pale:[242,227,150], white:[255,232,242], violet:[165,141,241]};
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
let winRect = win.getBoundingClientRect();
function fitFx(){ const d = DPR(); winRect = win.getBoundingClientRect(); const w = Math.round(winRect.width*d), h = Math.round(winRect.height*d); if(fxCv.width !== w || fxCv.height !== h){ fxCv.width = w; fxCv.height = h; } }
function rel(el){ const a = el.getBoundingClientRect(); return {x: a.left - winRect.left, y: a.top - winRect.top, w: a.width, h: a.height}; }
function emitFx(o){ if(reduced() || FX.length > 500) return; FX.push(Object.assign({vx: 0, vy: 0, g: 0, drag: 1.5, life: 1, dec: 1.4, c: FXC.pale, tw: false, tx: null}, o)); }
win.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn,.row,.seg button,.tabs button'); if(!b) return;
  fitFx(); const x = e.clientX - winRect.left, y = e.clientY - winRect.top, big = b.classList.contains('play'), n = big ? 18 : 10;
  for(let i=0; i<n; i++){ const a = i/n*Math.PI*2 + Math.random()*.5, v = (big ? 55 : 38) + Math.random()*30;
    emitFx({x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v, drag: 5, dec: 2.2 + Math.random(), c: [FXC.pink, FXC.pale, FXC.white][i % 3]}); }
});
function laneSpark(key, vel){
  const L = S.lane(), y0 = L.row[key]; if(y0 === undefined || reduced()) return;
  const B = rel(laneCv), k = B.h/L.lh, x = B.x + (L.phx + .5)*k, y = B.y + y0*k, c = hex(L.col[key]);
  for(let i=0; i<3 + Math.round(vel*4); i++) emitFx({x, y, vx: -(20 + Math.random()*70), vy: (Math.random() - .5)*40, drag: 2.2, dec: 1.1 + Math.random()*.9, c, tw: true});
}
function seekEmber(dt){
  if(!S.state().playing || scrub || Math.random() > dt*14) return;
  const B = rel(seekBar), fw = parseFloat(seekBar.querySelector('.fill').style.width) || 0;
  emitFx({x: B.x + fw - 3, y: B.y + 2 + Math.random()*6, vx: -(6 + Math.random()*16), vy: -(4 + Math.random()*14), g: -6, drag: 1, dec: .9 + Math.random()*.6, c: Math.random() < .5 ? FXC.white : FXC.pink, tw: true});
}
const dropEl = $('#drop'); let dropHot = 0;
dropEl.addEventListener('pointerenter', () => dropHot = 1);
dropEl.addEventListener('pointerleave', () => dropHot = 0);
function dropDust(dt){
  if(!isOpen() || curTab !== 'tab-lib') return;
  const D = rel(dropEl); if(D.w < 10) return;
  const hot = win.classList.contains('dragging') ? 2 : dropHot, ic = dropEl.querySelector('svg').getBoundingClientRect();
  const tx = ic.left + ic.width/2 - winRect.left, ty = ic.top + ic.height/2 - winRect.top;
  if(Math.random() < (hot ? 26*hot : 3)*dt){
    const side = Math.random()*4|0, u = Math.random();
    const x = D.x + (side === 0 ? u*D.w : side === 1 ? D.w - 2 : side === 2 ? u*D.w : 1), y = D.y + (side === 0 ? 1 : side === 1 ? u*D.h : side === 2 ? D.h - 2 : u*D.h);
    emitFx(hot ? {x, y, tx, ty, pull: 160 + 120*hot, drag: 3.5, dec: .7, c: Math.random() < .6 ? FXC.pink : FXC.pale, tw: true}
               : {x: D.x + 6 + Math.random()*(D.w - 12), y: D.y + D.h - 8, vx: (Math.random() - .5)*6, vy: -(5 + Math.random()*8), drag: .2, dec: .35 + Math.random()*.2, c: FXC.violet, tw: true});
  }
}
function drawFx(dt, now){
  fitFx(); const d = DPR(); fx.clearRect(0, 0, fxCv.width, fxCv.height);
  for(let i=FX.length - 1; i>=0; i--){
    const p = FX[i];
    if(p.tx !== null){ const dx = p.tx - p.x, dy = p.ty - p.y, l = Math.hypot(dx, dy) || 1; if(l < 4){ FX.splice(i, 1); continue; } p.vx += dx/l*p.pull*dt; p.vy += dy/l*p.pull*dt; }
    const k = Math.exp(-p.drag*dt); p.vx *= k; p.vy *= k; p.vy += p.g*dt;
    p.x += p.vx*dt; p.y += p.vy*dt; p.life -= p.dec*dt;
    if(p.life <= 0){ FX.splice(i, 1); continue; }
    let a = Math.min(1, p.life*1.6); if(p.tw) a *= .65 + .35*Math.sin(now*22 + i);
    fx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a.toFixed(3)})`;
    fx.fillRect(Math.round(p.x*d), Math.round(p.y*d), d, d);
  }
}

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

/* ---------- 开场：字符显影背景 + ASCII 鱿鱼打鼓 + 进度 ---------- */
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
let sqFrame = 0;     // 现在画第几帧鱿鱼（背景层按它画）

/* 字符显影：整片背景是很小的字符格，平时只有暗色乱码慢慢变；一块不规则的亮区游过时，
   乱码闪烁着变成真实的小字（鱿鱼的故事），亮区走后再慢慢退回乱码。算法照 loupe-loading.html 移植。 */
const Glyphs = (() => {
  const CFG = {
    cellW: 6, cellH: 13,                 // 字符格：12px 像素字，横 6 格一个西文字、两格一个汉字
    font: '12px "Fusion Pixel 12px Proportional SC"',
    band: 0.22, thMin: 0.35, thMax: 0.85,
    rise: 14, fall: 0.85, radius: 40,
    fastHz: 16, slowHz: 1.2, dimAlpha: 0.1, fps: 30,
    idleMs: 2500, follow: 6,             // 鼠标停下 2.5 秒或移出窗口，亮区就不再补亮，慢慢退回乱码
  };
  const CH = 'abcdefghijklmnopqrstuvwxyz<>/\\|=+-_*:;.,';
  const STORY = [
    '星空背面有一片很浅的海，海里住着一只粉色的果冻鱿鱼，名字叫 Squiddle。',
    '它有八条软管一样的触手，每一条都想打鼓：两条管镲，两条管嗵鼓，一条专门踩底鼓，剩下的轮流敲军鼓。',
    '白天它在礁石上数气泡，晚上把落进海里的星星捡起来，擦亮，别在胸口当拍子。',
    '踩镲是潮水，军鼓是心跳，底鼓是远处鲸鱼翻身时的一声叹气。',
    '它的鼓是用沉船的木板和深海的夜色做的，鼓面上撒满了碎星，打一下就亮一下。',
    '音箱是它从海沟里拖上来的，低音单元一响，水母们就排成一圈慢慢地摇。',
    '它不怕打错拍子，只怕没人听；所以每天开场前，它都会先调好鼓皮，接好音箱，铺开星空，再把自己叫醒。',
    '粉色的披肩是外婆织的，背后缝着北斗七星，铃铛一响，就是要开始了。',
    '如果你把歌拖进来，它会把每一个鼓点都记在星轨上，一颗一颗地打给你听。',
    '一、二、三、四。',
  ].join('　　');
  const CONT = '\u0001';                  // 汉字占两格，后一格用这个记号
  const cv = $('#glyphs'), ctx = cv.getContext('2d');
  const slowCv = document.createElement('canvas'), sctx = slowCv.getContext('2d');
  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0, x0 = 0, y0 = 0, n = 0;
  let real = [], th, h, ph, slowK, mask, pointer = null, lens = null, wasLive = false, lit = false, t = 0, last = 0, running = false;
  let col = {}, squid = null, sqC0 = 0, sqR0 = 0;
  const hash = (i, k) => {
    let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((k + 0x632be5ab) | 0, 0xc2b2ae35);
    x ^= x >>> 15; x = Math.imul(x, 0x27d4eb2d); x ^= x >>> 13;
    return x >>> 0;
  };
  // 鱿鱼三帧：拆成逐格的字符和颜色（<i> 星星黄、<u> 鼓紫、其余粉）
  const SQG = SQ.map(fr => fr.map(line => {
    const out = []; let k = 'p';
    line.replace(/<(\/?)([iu])>|([^<])/g, (m, cl, tag, c) => { if(tag) k = cl ? 'p' : tag; else out.push([c, k]); return ''; });
    return out;
  }));
  const SQW = Math.max(...SQG.flat().map(l => l.length)), SQH = SQG[0].length;
  sq.style.width = SQW*CFG.cellW + 'px'; sq.style.height = SQH*CFG.cellH + 'px';
  // 鱿鱼占的格子（三帧合起来，每行从第一个到最后一个非空字符，左右各多留一格）不画背景字
  const sqSpan = [];
  for(let r=0; r<SQH; r++){
    let a = SQW, b = -1;
    SQG.forEach(fr => fr[r].forEach(([c], i) => { if(c !== ' '){ a = Math.min(a, i); b = Math.max(b, i); } }));
    sqSpan.push([a - 1, b + 1]);
  }
  function readColors(){
    const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
    col = {real: '#ece7d8', fast: v('--pink'), slow: v('--dim'), p: v('--pink'), i: v('--star'), u: v('--violet')};
  }
  // 字模图集：每种颜色的每个字只用 fillText 画一次，之后每帧都是从图集里贴图。
  // 每帧几千次 fillText（汉字更重）在有的机器上越画越卡，贴图便宜得多。
  const atlasCv = document.createElement('canvas'), actx2 = atlasCv.getContext('2d');
  let atlas = null, atlasKey = '';
  function buildAtlas(){
    const fontOk = !document.fonts || document.fonts.check(CFG.font, '鼓A');
    const key = dpr + '|' + fontOk;
    if(atlas && atlasKey === key) return;
    const sets = {slow: CH, fast: CH, real: '', p: '', i: '', u: ''};
    sets.real = [...new Set(STORY)].filter(c => c !== ' ' && c !== '　').join('');
    SQG.flat(2).forEach(([c, k]) => { if(c !== ' ' && !sets[k].includes(c)) sets[k] += c; });
    const cw = CFG.cellW*dpr, chh = CFG.cellH*dpr, perRow = 48, list = [];
    for(const k in sets) for(const c of sets[k]) list.push([k, c]);
    atlasCv.width = perRow*cw*2; atlasCv.height = Math.ceil(list.length/perRow)*chh;
    actx2.font = `${12*dpr}px "Fusion Pixel 12px Proportional SC"`; actx2.textBaseline = 'top';
    atlas = new Map();
    list.forEach(([k, c], idx) => {
      const sx = (idx % perRow)*cw*2, sy = Math.floor(idx/perRow)*chh;
      actx2.fillStyle = col[k]; actx2.fillText(c, sx, sy + dpr);
      atlas.set(k + c, [sx, sy, (wide(c) ? 2 : 1)*cw]);
    });
    atlasKey = key;
  }
  function blit(c2, k, c, x, y){        // x、y 是 CSS 像素，画到设备像素上
    const g = atlas.get(k + c); if(!g) return;
    c2.drawImage(atlasCv, g[0], g[1], g[2], CFG.cellH*dpr, x*dpr, y*dpr, g[2], CFG.cellH*dpr);
  }
  function build(){
    const r = splash.getBoundingClientRect();
    dpr = Math.max(1, Math.round(window.devicePixelRatio || 1)); W = r.width; H = r.height;
    if(!W || !H) return false;
    cv.width = slowCv.width = Math.round(W*dpr); cv.height = slowCv.height = Math.round(H*dpr);
    // 让格子正好对齐鱿鱼占位框的左上角，鱿鱼就嵌在格子里
    const s = sq.getBoundingClientRect(), cw = CFG.cellW, chh = CFG.cellH;
    const ox = Math.round(s.left - r.left), oy = Math.round(s.top - r.top);
    x0 = (ox % cw + cw) % cw - cw; y0 = (oy % chh + chh) % chh - chh;
    cols = Math.ceil((W - x0)/cw); rows = Math.ceil((H - y0)/chh); n = cols*rows;
    sqC0 = Math.round((ox - x0)/cw); sqR0 = Math.round((oy - y0)/chh);
    // 故事：拆成格子（汉字两格），每一行从不同位置开始
    const base = [];
    for(const c of STORY + '　　'){ if(wide(c)) base.push(c, CONT); else base.push(c); }
    const seq = [...base];
    while(seq.length < cols*3) seq.push(...base);
    real = new Array(n); th = new Float32Array(n); h = new Float32Array(n); ph = new Float32Array(n);
    slowK = new Int32Array(n).fill(-1); mask = new Uint8Array(n);
    for(let j=0; j<rows; j++){
      let off = (j*137 + (hash(j, 7) % 97)) % (seq.length - cols);
      if(seq[off] === CONT) off++;
      for(let i=0; i<cols; i++){
        let c = seq[off + i];
        if(i === 0 && c === CONT) c = ' ';
        if(i === cols - 1 && c !== CONT && wide(c)) c = ' ';
        real[j*cols + i] = c;
      }
    }
    for(let i=0; i<n; i++){ th[i] = CFG.thMin + Math.random()*(CFG.thMax - CFG.thMin); ph[i] = Math.random()*10; }
    for(let i=0; i<n; i++) if(real[i] === CONT) th[i] = th[i - 1];     // 汉字两格同进同退
    sqSpan.forEach(([a, b], r) => { const j = sqR0 + r; if(j < 0 || j >= rows) return;
      for(let i = sqC0 + a; i <= sqC0 + b; i++) if(i >= 0 && i < cols) mask[j*cols + i] = 1; });
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, slowCv.width, slowCv.height);
    ctx.imageSmoothingEnabled = sctx.imageSmoothingEnabled = false;
    rect = r;
    buildAtlas();
    return true;
  }
  function target(x, y, p){
    const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    if(d > CFG.radius*1.8) return 0;
    const a = Math.atan2(dy, dx);
    const R = CFG.radius*(1 + 0.26*Math.sin(3*a + t*1.7) + 0.14*Math.sin(5*a - t*2.3) + 0.08*Math.sin(8*a + t*0.9));
    return Math.max(0, Math.min(1.25, (1 - d/R)*2.2));
  }
  function step(dt){
    t += dt;
    const live = pointer && performance.now() - pointer.at < CFG.idleMs;
    if(live){
      if(!lens || !wasLive) lens = {x: pointer.x, y: pointer.y};     // 鼠标重新动起来：亮区直接出现在鼠标处
      wasLive = true;
      const k = 1 - Math.exp(-dt*CFG.follow*2);
      lens.x += (pointer.x - lens.x)*k; lens.y += (pointer.y - lens.y)*k;
    }
    else { wasLive = false; if(!lit) return; }                // 没有亮区、也没有余辉：什么都不用算
    const up = 1 - Math.exp(-dt*CFG.rise), down = dt*CFG.fall, R = CFG.radius*1.8;
    const p = live ? lens : {x: -1e4, y: -1e4};
    const i0 = Math.max(0, Math.floor((p.x - R - x0)/CFG.cellW)), i1 = Math.min(cols - 1, Math.ceil((p.x + R - x0)/CFG.cellW));
    const j0 = Math.max(0, Math.floor((p.y - R - y0)/CFG.cellH)), j1 = Math.min(rows - 1, Math.ceil((p.y + R - y0)/CFG.cellH));
    lit = false;
    for(let o=0; o<n; o++){
      const i = o % cols, j = (o/cols) | 0;
      const T = (i >= i0 && i <= i1 && j >= j0 && j <= j1) ? target(x0 + (i + .5)*CFG.cellW, y0 + (j + .5)*CFG.cellH, p) : 0;
      if(T > h[o]) h[o] += (T - h[o])*up; else if(h[o] > 0) h[o] = Math.max(T, h[o] - down);
      if(h[o] > 0) lit = true;
    }
  }
  function draw(){
    const cw = CFG.cellW, chh = CFG.cellH, fastK = Math.floor(t*CFG.fastHz);
    // 慢乱码：画在一张常驻的底图上，每帧只重画换了字的格子
    for(let o=0; o<n; o++){
      const x = x0 + (o % cols)*cw, y = y0 + ((o/cols) | 0)*chh;
      const k = (!mask[o] && h[o] <= th[o] - CFG.band) ? Math.floor(t*CFG.slowHz + ph[o]) : -1;
      if(k === slowK[o]) continue;
      sctx.clearRect(x*dpr, y*dpr, cw*dpr, chh*dpr);
      if(k >= 0) blit(sctx, 'slow', CH[hash(o, k) % CH.length], x, y);
      slowK[o] = k;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = CFG.dimAlpha; ctx.drawImage(slowCv, 0, 0); ctx.globalAlpha = 1;
    ctx.globalAlpha = 0.6;                       // 接近阈值：快速跳动的粉色乱码
    for(let o=0; o<n; o++){
      if(mask[o] || h[o] <= th[o] - CFG.band) continue;
      const shown = h[o] > th[o] && real[o] !== CONT;
      const lead = real[o] === CONT && h[o - 1] > th[o - 1];
      if(shown || lead) continue;
      blit(ctx, 'fast', CH[hash(o, fastK) % CH.length], x0 + (o % cols)*cw, y0 + ((o/cols) | 0)*chh);
    }
                                                                           // 超过阈值：真实的故事小字
    for(let o=0; o<n; o++){
      if(mask[o] || h[o] <= th[o] || real[o] === ' ' || real[o] === CONT || real[o] === '　') continue;
      ctx.globalAlpha = Math.min(1, 0.5 + (h[o] - th[o])*1.5);
      blit(ctx, 'real', real[o], x0 + (o % cols)*cw, y0 + ((o/cols) | 0)*chh);
    }
    ctx.globalAlpha = 1;
    // 鱿鱼：嵌在同一层格子里，不受乱码影响
    SQG[sqFrame].forEach((line, r) => line.forEach(([c, k], i) => {
      if(c !== ' ') blit(ctx, k, c, x0 + (sqC0 + i)*cw, y0 + (sqR0 + r)*chh);
    }));
  }
  function frame(ts){
    if(!running) return;
    requestAnimationFrame(frame);
    if(document.hidden){ last = ts; return; }
    if(ts - last < 1000/CFG.fps - 1) return;
    const dt = Math.min(0.06, (ts - last)/1000 || 0.016); last = ts;
    if(!reduced()) step(dt);
    draw();
  }
  let rect = null;
  splash.addEventListener('pointermove', e => { if(rect) pointer = {x: e.clientX - rect.left, y: e.clientY - rect.top, at: performance.now()}; });
  splash.addEventListener('pointerleave', () => { pointer = null; });
  // 开场框的大小一变（字体加载、提示行出现），鱿鱼占位框就会挪，格子要跟着重新对齐
  if(window.ResizeObserver) new ResizeObserver(() => { if(running) build(); }).observe(splash.querySelector('.box'));
  addEventListener('resize', () => { if(running) build(); });
  return {
    start(){ readColors(); if(!build()) return; running = true; requestAnimationFrame(frame); if(document.fonts) document.fonts.ready.then(() => running && build()); },
    stop(){ running = false; cv.width = cv.height = slowCv.width = slowCv.height = atlasCv.width = atlasCv.height = 0; atlas = null; },   // 进了主界面就把两张大画布的显存还回去
  };
})();

S.play(false);       // 开场时先别打，开场结束再开始
function runSplash(){
  S.hold(true);        // 开场页盖住舞台时，舞台不渲染
  Glyphs.start();
  const dur = reduced() ? 200 : 1800, t0 = performance.now(); let f = 0, want = '';
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0)/dur), n = Math.round(p*20);
    sqFrame = f++ % 3;
    const st = STEPS[Math.min(3, Math.floor(p*4))];
    if(st !== want){ want = st; reveal(loadStep, st, {from: loadStep.textContent || blank(st), dur: 300, band: .5, force: true}); }
    loadBar.innerHTML = `  [<b>${'#'.repeat(n)}</b>${'.'.repeat(20 - n)}] ${String(Math.round(p*100)).padStart(3)}%`;
    if(p < 1) setTimeout(tick, 170);
    else fontsReady.then(() => setTimeout(desk ? done : waitStart, 200));
  };
  tick();
}
// 网页里打开：浏览器要先有一次点击或按键才肯出声，所以停在开场页等一下
function waitStart(){
  const go = $('#go'), msg = '> 按任意处开始 <';
  let f = 0, alive = true;
  const bob = () => { if(!alive) return; sqFrame = f++ % 3; setTimeout(bob, 170); };
  bob();
  reveal(loadStep, '准备好了', {from: loadStep.textContent, dur: 300, band: .5, force: true});
  go.hidden = false; reveal(go, msg, {from: blank(msg), dur: 500, force: true});
  splash.classList.add('wait');
  const start = e => {
    if(e.type === 'keydown' && (e.repeat || /^(Shift|Control|Alt|Meta|Tab|F\d+)$/.test(e.key))) return;
    if(e.type === 'pointerup' && e.button > 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    removeEventListener('pointerup', start, true); removeEventListener('keydown', start, true);
    alive = false; splash.classList.remove('wait');
    S.unlockAudio();
    done();
  };
  addEventListener('pointerup', start, true); addEventListener('keydown', start, true);
}
function done(){
  S.hold(false);
  splash.classList.add('bye');
  setTimeout(() => { splash.hidden = true; Glyphs.stop(); }, 650);
  reveal($('#logoT'), 'Squiddle', {from: '########', dur: 700, force: true});
  reveal(camT, S.camera(), {from: blank(S.camera()), dur: 600, delay: 200, force: true});
  showSong(S.song(), true);
  syncBars(); placeInd();
  S.play(true);
}

/* ---------- 每帧：电平、进度、时间、帧率、粒子 ---------- */
let last = performance.now(), slow = 0, fpsT = 0;
const fpsHist = [], fpsV = $('#fpsV'), fpsGr = $('#fpsGr'), t0El = $('#t0'), t1El = $('#t1');
for(let k=0; k<24; k++) fpsGr.appendChild(document.createElement('i'));
let timeStr = '';
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - last)/1000); last = now;
  for(let i=0; i<8; i++) lv[i] *= Math.pow(.05, dt);
  const tm = S.time(), p = tm.dur ? tm.t/tm.dur : 0;
  setBar(seekBar, p); if(!seekBar.classList.contains('drag')) seekIn.value = Math.round(p*1000);
  const ts = fmt(tm.t) + ' / ' + fmt(tm.dur);
  if(ts !== timeStr){ timeStr = ts; t0El.textContent = fmt(tm.t); t1El.textContent = fmt(tm.dur); seekIn.setAttribute('aria-valuetext', ts); }
  fpsT += dt;
  if(fpsT >= .5){
    fpsT = 0; const v = S.fps(); fpsV.textContent = v ? v + ' fps' : '--';
    fpsHist.push(v); if(fpsHist.length > 24) fpsHist.shift();
    const mx = Math.max(...fpsHist, 1), bars = fpsGr.children, off = 24 - fpsHist.length;
    for(let k=0; k<24; k++){ const val = fpsHist[k - off]; bars[k].style.height = val ? Math.max(2, Math.round(val/mx*8)*2) + 'px' : '0px'; }
  }
  if(isOpen() && curTab === 'tab-hit'){ drawSpec(now/1000, dt); drawHead(now/1000); }
  seekEmber(dt); dropDust(dt); drawFx(dt, now/1000);
  slow += dt;
  if(slow > 1/30){
    slow = 0; drawMeter();
    const playing = S.state().playing, eq = list.querySelectorAll('.song.cur .eq i');
    if(eq.length) [0, 3, 6].forEach((b, j) => { eq[j].style.height = playing ? (2 + Math.min(5, Math.round((lv[b] + lv[b + 1])*3))*2) + 'px' : '2px'; });
  }
}

/* ---------- 启动 ---------- */
addEventListener('resize', () => { placeInd(); syncBars(); if(isOpen()) fitPanes(); });
showState(S.state()); renderLib(S.lib());
selectTab(curTab);
drawMeter();
requestAnimationFrame(frame);
runSplash();
})();
