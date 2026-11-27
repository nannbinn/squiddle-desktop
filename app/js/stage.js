(function(){
'use strict';
const V3 = THREE.Vector3, UPV = new V3(0,1,0);
const W0 = 320, H0 = 180;
let W = W0, H = H0, FOVK = 1;     // 渲染分辨率跟着舞台区域的宽高比走：宽窗口加宽，高窗口加高（像素大小不变）
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({canvas, antialias:false});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);

// ---------- 低分辨率渲染目标 + 描边后处理 ----------
const rt = new THREE.WebGLRenderTarget(W, H, {minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter});
rt.depthTexture = new THREE.DepthTexture(W, H);
rt.depthTexture.type = THREE.UnsignedIntType;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.fog = new THREE.Fog(0xffffff, 9, 20);
const camera = new THREE.PerspectiveCamera(38, W/H, 0.3, 60);

const post = new THREE.ShaderMaterial({
  uniforms:{tColor:{value:rt.texture}, tDepth:{value:rt.depthTexture}, px:{value:new THREE.Vector2(1/W,1/H)}, near:{value:camera.near}, far:{value:camera.far}, fogFar:{value:20}, ink:{value:new THREE.Color(0x1a1230)}, inkJ:{value:new THREE.Color(0x8a1f55)},
    projInv:{value:new THREE.Matrix4()}, camWorld:{value:new THREE.Matrix4()}, mantleInv:{value:new THREE.Matrix4()}, mantleH:{value:1.75},
    uSpot:{value:0}, spotA:{value:new THREE.Vector3(0,12,0)}, spotAx:{value:new THREE.Vector3(0,-1,0)}, spotTan:{value:0.185}, spotL:{value:14}, floorY:{value:-0.95}, night:{value:new THREE.Color(0x22244c)}, beamC:{value:new THREE.Color(0xfff3c4)}, pxA:{value:0.0037}, uT:{value:0}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 px; uniform float near; uniform float far; uniform float fogFar; uniform vec3 ink; uniform vec3 inkJ;
    uniform mat4 projInv; uniform mat4 camWorld; uniform mat4 mantleInv; uniform float mantleH;
    uniform float uSpot; uniform vec3 spotA; uniform vec3 spotAx; uniform float spotTan; uniform float spotL; uniform float floorY; uniform vec3 night; uniform vec3 beamC; uniform float pxA; uniform float uT;
    varying vec2 vUv;
    float lin(vec2 uv){ float z=texture2D(tDepth,uv).x*2.-1.; return 2.*near*far/(far+near-z*(far-near)); }
    float thr(float d){ return 0.09*d + 0.04; }
    float jl(vec2 uv){ return step(texture2D(tColor, uv).a, 0.5); }       // 1 = 果冻像素
    // 这个像素在外套膜上的高度（用深度反推回世界坐标，再换到外套膜自己的坐标）：上半部的壳画得更厚
    float upperK(vec2 uv){
      vec4 v = projInv*vec4(uv*2.-1., texture2D(tDepth, uv).x*2.-1., 1.); v /= v.w;
      vec4 l = mantleInv*(camWorld*v);
      return smoothstep(0.4, 0.62, l.y/mantleH)*step(length(l.xz), 0.8);
    }
    // 果冻壳的厚度：沿一个方向往外走，找到外轮廓那一格；离它 rimW 格以内是亮线，再往里 wallW 格是更浓的壁色。
    // 往里至少还要有两格同一表面的果冻才画，细触手就只留外轮廓，不会被亮线吃掉
    vec2 shell(vec2 o, float d0, float rimW, float wallW){
      float m1 = lin(vUv-o), m2 = lin(vUv-2.*o), m3 = lin(vUv-3.*o);
      float wide = jl(vUv-o)*jl(vUv-2.*o)*step(abs(m1-d0), thr(d0))*step(abs(m2-m1), thr(m1))*step(m3-m2, thr(m2));
      if(wide < 0.5) return vec2(0.);
      float prev = d0, e = 0.;
      for(int i=1; i<=7; i++){
        float fi = float(i);
        if(fi > rimW + wallW) break;
        vec2 q = vUv + fi*o;
        float di = lin(q);
        if(jl(q) < 0.5 || abs(di - prev) > thr(prev)) break;
        if(lin(q + o) - di > thr(di)){ e = fi; break; }
        prev = di;
      }
      if(e < 0.5) return vec2(0.);
      return vec2(step(e, rimW), step(rimW + 0.5, e)*step(e, rimW + wallW));
    }
    // 聚光灯用的小工具：4×4 有序抖动、像素星星的随机数、沿视线在光锥里走一段算光柱的浓度
    float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(.5, a.y*.75))); }
    float bayer4(vec2 a){ return bayer2(.5*a)*.25 + bayer2(a); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
    // 点 p 离光锥轴线的距离占这一截光锥半径的比例（<1 在光里），顺带给出离灯头的轴向距离
    vec2 coneR(vec3 p){ vec3 v = p - spotA; float a = dot(v, spotAx); return vec2(length(v - a*spotAx)/(max(a, 1e-3)*spotTan), a); }
    // 视线和光锥（只算朝下的那一半）相交的一段 [s0, s1]，没交到就返回 s1 < s0
    vec2 coneHit(vec3 ro, vec3 rd){
      float c2 = 1./(1. + spotTan*spotTan);                       // cos²(半角)
      vec3 co = ro - spotA; float da = dot(rd, spotAx), oa = dot(co, spotAx);
      float a = da*da - c2, b = 2.*(da*oa - dot(rd, co)*c2), c = oa*oa - dot(co, co)*c2;
      float disc = b*b - 4.*a*c;
      if(disc < 0. || abs(a) < 1e-6) return vec2(1., 0.);
      float sq = sqrt(disc), r0 = (-b - sq)/(2.*a), r1 = (-b + sq)/(2.*a), lo = min(r0, r1), hi = max(r0, r1);
      if(a < 0.) return oa + .5*(lo + hi)*da > 0. ? vec2(lo, hi) : vec2(1., 0.);
      return oa + (hi + 1.)*da > 0. ? vec2(hi, 1e4) : vec2(-1e4, lo);
    }
    // 光柱：在相交的那段里走 14 步。边缘只留很窄的过渡，边就清楚；靠近灯头那一截淡出，看起来是一束从画外照进来的长光
    float beam(vec3 ro, vec3 rd, float smax){
      vec2 iv = coneHit(ro, rd); float s0 = max(iv.x, 0.), s1 = min(iv.y, smax);
      if(s1 <= s0) return 0.;
      float acc = 0., j = bayer4(gl_FragCoord.xy);
      for(int i = 0; i < 14; i++){
        vec3 p = ro + rd*mix(s0, s1, (float(i) + j)/14.);
        vec2 k = coneR(p);
        acc += (1. - smoothstep(.9, 1., k.x))*smoothstep(.25*spotL, .8*spotL, k.y)*step(floorY, p.y);
      }
      return acc/14.*(s1 - s0);
    }
    // ---- 聚光灯夜景的远景：钉在世界里的像素星、两圈岩石山峰剪影、一座城堡 ----
    const float TAU = 6.2831853;
    float h1(float n){ return fract(sin(n*127.1 + 3.7)*43758.5453); }
    // 星星按视线方向分格，每格最多一颗，只点亮离它最近的那一个像素：转视角时星星跟着天空一起转，还是一格一颗
    vec3 starAt(vec3 rd, vec3 base){
      float yaw = atan(rd.x, rd.z), pit = asin(clamp(rd.y, -1., 1.)), cs = .011;
      float iy = floor(pit/cs), pc = (iy + .5)*cs, cw = cs/max(cos(pc), .2);
      float ix = floor(yaw/cw), hs = hash(vec2(ix, iy) + 17.3);
      if(hs < .962) return base;
      vec2 st = vec2((ix + .2 + .6*fract(hs*31.7))*cw, (iy + .2 + .6*fract(hs*57.3))*cs);
      vec2 dd = vec2((yaw - st.x)*cos(pit), pit - st.y);
      if(max(abs(dd.x), abs(dd.y)) > pxA*.5) return base;
      float tw = .75 + .25*sin(uT*(1.3 + 2.*fract(hs*13.1)) + hs*40.);      // 轻轻闪
      return mix(base, vec3(.95, .94, 1.), (.3 + .45*fract(hs*97.))*tw);
    }
    // 一圈山：沿圆柱的角度取一维分形噪声当连绵的矮山脊（在圆上采样，绕一圈首尾接得上），上面立几簇细高的石峰，
    // 像雾里的峰林：每簇三四根石柱，中间高两边矮；柱子上窄下略宽、顶上圆钝，侧壁随高度左右错开，像一层层岩块
    float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
      return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + 1.), f.x), f.y); }
    float fbm2(vec2 p){ return .5*vn2(p) + .25*vn2(p*2.03 + 7.1) + .125*vn2(p*4.11 + 3.3) + .0625*vn2(p*8.17 + 1.9); }
    float ridge(float a, float v, float R, float seed, float n, float hmax, float base){
      vec2 cp = vec2(cos(a), sin(a))*R;
      float h = base*(.35 + 1.1*fbm2(cp*.08 + seed));
      for(int k = 0; k < 10; k++){
        float fk = float(k); if(fk >= n) break;
        float c = (fk + .15 + .7*h1(fk + seed))/n*TAU;
        float d = a - c; d = (d - TAU*floor((d + 3.14159265)/TAU))*R;
        float spread = 1.6 + 2.2*h1(fk*2.3 + seed);
        if(abs(d) > spread + 2.) continue;
        float hc = hmax*(.45 + .55*h1(fk*3.1 + seed));
        for(int j = 0; j < 4; j++){
          float fj = float(j), r1 = h1(fk*11.7 + fj*3.9 + seed), r2 = h1(fk*5.3 + fj*7.1 + seed*1.7);
          float o = (fj - 1.5 + (r1 - .5)*.8)/1.5*spread;
          float hj = hc*(.5 + .5*r2)*(1. - .45*abs(o)/spread);
          float w = .3 + .45*h1(fk*9.1 + fj*2.7 + seed);
          float dj = d - o + (vn2(vec2(v*1.6, fk*13. + fj*5.)) - .5)*w*.7;             // 侧壁一层层错开
          float t = abs(dj)/(w*(1. + .5*max(0., 1. - v/hj)));                             // 底部略宽
          if(t < 1.) h = max(h, hj*(1. - t*t*t*t));                                      // 顶上圆钝、侧壁陡
        }
      }
      return h;
    }
    // 城堡剪影（u 是沿山圈的横向距离、v 是离地高度，单位和场景一样）：0 = 没有，1 = 墙体，2 = 亮着的窗
    float bx(vec2 q, float cx, float hw, float y0, float y1){ return step(abs(q.x - cx), hw)*step(y0, q.y)*step(q.y, y1); }
    float sp(vec2 q, float cx, float hw, float y0, float y1){ float t = (q.y - y0)/(y1 - y0); return step(0., t)*step(t, 1.)*step(abs(q.x - cx), hw*(1. - t)); }
    float castle(vec2 q){
      if(abs(q.x) > 3.6 || q.y > 6.6 || q.y < -.5) return 0.;
      float w = 0.;
      w = max(w, bx(q, 0., 3.4, -1., .55 + .22*step(.5, fract(q.x*1.6))));             // 山脚下的小镇，屋顶高低错落
      w = max(w, bx(q, -2.2, .7, -1., 1.05)); w = max(w, sp(q, -2.2, .75, 1.05, 1.5));
      w = max(w, bx(q, .2, 1.45, -1., 2.2)); w = max(w, sp(q, .2, 1.45, 2.2, 2.75));      // 主殿和人字顶
      w = max(w, bx(q, .55, .4, -1., 4.3)); w = max(w, sp(q, .55, .42, 4.3, 6.5));        // 主塔和尖顶
      w = max(w, bx(q, -.5, .32, -1., 3.7)); w = max(w, sp(q, -.5, .34, 3.7, 5.5));       // 副塔
      w = max(w, bx(q, 1.3, .15, -1., 2.9)); w = max(w, sp(q, 1.3, .17, 2.9, 3.65));      // 小尖塔
      w = max(w, bx(q, -1.25, .17, -1., 2.6)); w = max(w, sp(q, -1.25, .19, 2.6, 3.35));
      w = max(w, bx(q, 1.75, .11, -1., 2.35)); w = max(w, sp(q, 1.75, .13, 2.35, 2.9));
      w = max(w, bx(q, -1.85, .11, -1., 2.95));                                            // 烟囱
      w = max(w, bx(q, 2.65, .36, 1.1, 1.85)); w = max(w, sp(q, 2.65, .42, 1.85, 2.3));   // 右边的水塔
      w = max(w, step(abs(abs(q.x - 2.65) - .27), .06)*step(q.y, 1.1));
      if(w < .5) return 0.;
      float win = bx(q, .95, .2, .75, 1.55)                                                 // 主殿的拱门透着光
        + bx(q, .55, .07, 3.25, 3.55) + bx(q, .55, .07, 2.55, 2.8) + bx(q, -.5, .06, 2.9, 3.15)
        + bx(q, -.75, .07, 1.3, 1.5) + bx(q, -.2, .07, 1.3, 1.5) + bx(q, -2.35, .07, .55, .75) + bx(q, 1.6, .07, .25, .42);
      return win > .5 ? 2. : 1.;
    }
    // 视线打到以舞台为中心、半径 R 的竖直圆柱上的位置（相机总在圆柱里面，取往前那个交点）
    float cylT(vec3 ro, vec3 rd, float R){
      vec2 o = ro.xz - vec2(.1, -.4), d = rd.xz;
      float a = dot(d, d), b = dot(o, d), c = dot(o, o) - R*R;
      if(a < 1e-5) return -1.;
      return (-b + sqrt(max(b*b - a*c, 0.)))/a;
    }
    vec3 horizon(vec3 ro, vec3 rd, float dist, vec3 cs, float bay){
      // 颜色只比夜空暗一点点：远的一圈几乎融进天里，近的一圈也只是隐约看得出；山脚是一层比夜空亮一点的薄雾
      vec3 farC = night*vec3(.97, .93, .98), nearC = night*vec3(.91, .84, .92), haze = night*vec3(1.12, 1.12, 1.1), win = vec3(1., .8, .45);
      for(int L = 0; L < 2; L++){
        float R = L == 0 ? 46. : 30.;
        float t = cylT(ro, rd, R);
        if(t < 0. || t > dist) continue;
        vec3 hp = ro + rd*t; float a = atan(hp.x - .1, hp.z + .4), v = hp.y - floorY;
        if(v < -.05) continue;
        float h = L == 0 ? ridge(a, v, R, 11.3, 9., 5.5, 1.3) : ridge(a, v, R, 4.7, 7., 7.5, .8);
        vec3 col = L == 0 ? farC : nearC;
        float k = 0.;
        if(L == 1){                                                 // 城堡在默认视角的正后方偏右，周围的山让开一点
          float u = a - 4.42; u = (u - TAU*floor((u + 3.14159265)/TAU))*R; k = castle(vec2(u, v));
          h = mix(min(h, .9), h, smoothstep(4., 8., abs(u)));
        }
        if(v < h || k > .5){
          vec3 m = k > 1.5 ? mix(nearC, win, .45) : k > .5 ? night*vec3(.78, .78, .85) : col;
          float mist = (1. - smoothstep(0., L == 0 ? 3. : 2.2, v))*.85;     // 山脚埋在薄雾里，用抖动分四档，像素风不出色带
          cs = k > 1.5 ? m : mix(m, haze, floor(mist*4. + bay)/4.);
        }
      }
      return cs;
    }
    void main(){
      vec4 c4 = texture2D(tColor,vUv);
      vec3 c = c4.rgb;
      vec3 inkC = c4.a < 0.5 ? inkJ : ink;     // 果冻像素在 alpha 里留了记号：它的轮廓用同色系的深色
      float d0 = lin(vUv);
      float m = 0.;
      m = max(m, lin(vUv+vec2(px.x,0.))-d0);
      m = max(m, lin(vUv-vec2(px.x,0.))-d0);
      m = max(m, lin(vUv+vec2(0.,px.y))-d0);
      m = max(m, lin(vUv-vec2(0.,px.y))-d0);
      bool emis = c4.a > 0.6 && c4.a < 0.9;    // 应援灯：alpha 记成 0.75，不量化、不压暗，呼吸的明暗才顺
      if(!emis) c = floor(c*10.+.5)/10.;       // 轻微色阶量化
      if(c4.a < 0.5 && m <= thr(d0)){
        float up = upperK(vUv), rimW = 1. + step(0.35, up), wallW = 2. + floor(up*2.99);   // 上半部：2 格亮线 + 最多 4 格壁色
        vec2 su = shell(vec2(0., px.y), d0, rimW, wallW), sd = shell(vec2(0., -px.y), d0, rimW, wallW), sl = shell(vec2(-px.x, 0.), d0, rimW, wallW), sr = shell(vec2(px.x, 0.), d0, rimW, wallW);
        float rim = max(max(su.x, 0.55*sd.x), 0.8*max(sl.x, sr.x));        // 上沿最亮，下沿最淡
        float wall = max(max(su.y, sd.y), max(sl.y, sr.y))*step(rim, 0.01);
        c = mix(c, c*c*c, 0.7*wall);                                         // 壁：同色更浓（浅粉变成饱和的粉，淡紫变成饱和的紫）
        c = mix(c, vec3(1.0), 0.82*rim);                                     // 亮线：带一点本色的白
        c = floor(c*10.+.5)/10.;
      }
      if(m > thr(d0) && d0 < fogFar) c = inkC;   // 只在近侧像素画 1px 描边，雾里的远处不描
      // 聚光灯：用深度反推每个像素的世界坐标。光锥（灯头在左前上方的画外，斜着照向鼓手）里的照常亮，外面压成和页面一样的夜空色；
      // 背景直接是夜空色加几颗像素星；应援灯（alpha 里记成 0.75）不压暗；最后叠一道带抖动的光柱
      if(uSpot > 0.001){
        float dz = texture2D(tDepth, vUv).x, bay = bayer4(gl_FragCoord.xy);
        bool bg = dz > 0.99999;
        vec4 v = projInv*vec4(vUv*2. - 1., dz*2. - 1., 1.); v /= v.w;
        vec3 wp = (camWorld*v).xyz, ro = camWorld[3].xyz, rd = normalize(wp - ro);
        vec3 cs;
        if(emis) cs = c;
        else if(bg){
          cs = horizon(ro, rd, 1e4, starAt(rd, night), bay);
        } else {
          vec2 k = coneR(wp);
          float lit = k.y > 0. ? 1. - smoothstep(.88, 1.02, k.x) : 0.;
          lit = clamp(floor(lit*3. + bay)/3., 0., 1.);
          bool flr = wp.y < floorY + .05;
          vec3 on = c*vec3(1.03, 1., .93);
          if(flr) on = mix(night, on, .5 - .14*k.x*k.x);           // 地板上的光斑压暗一半，往边上再淡一点；鼓手和鼓照常亮
          cs = mix(mix(night, c, flr ? .04 : .09), on, lit);       // 光圈外：地面几乎和页面一样，东西留一点点轮廓
          if(flr && lit < .01) cs = horizon(ro, rd, length(wp - ro), cs, bay);   // 远处地面上也能立起山脚
        }
        float g = 1. - exp(-beam(ro, rd, bg ? 40. : length(wp - ro))*.38);
        g = smoothstep(.03, .62, g);                               // 提一点对比，光柱的边更利落
        cs += beamC*floor(g*5. + bay)/5.*.16;
        c = mix(c, cs, uSpot);
      }
      gl_FragColor = vec4(c,1.);
    }`
});
const postScene = new THREE.Scene();
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), post));
const postCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

// ---------- 分档光照 ----------
const ramp = new THREE.DataTexture(new Uint8Array([70,70,70,255, 150,150,150,255, 255,255,255,255]), 3, 1, THREE.RGBAFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const toon = (color, extra) => new THREE.MeshToonMaterial(Object.assign({color, gradientMap:ramp}, extra||{}));
scene.add(new THREE.AmbientLight(0x8a7fc0, 0.55));
const sun = new THREE.DirectionalLight(0xfff1dc, 0.85);
const SUN_DIR = new V3(2.5, 5, 3).normalize();
sun.target.position.set(0, 0, -1.2); sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 9);
scene.add(sun); scene.add(sun.target);
// 投影：硬边阴影图，配合像素风；地面用只显示阴影的透明平面接收
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.BasicShadowMap;
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {left:-6, right:6, top:6, bottom:-6, near:1, far:24}); sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.02;

// ---------- 地面：白底 + 灰网格（线切成短段，转到哪个角度都不会穿过近裁面出错） ----------
const FLOOR_Y = -0.95;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({color:0xffffff, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:2}));
floor.rotation.x = -Math.PI/2; floor.position.y = FLOOR_Y; scene.add(floor);
{
  // 建模软件式网格：1 单位一格，每 5 格一条深色主线；线切成短段，转到哪个角度都不会穿过近裁面出错
  const GS = 1.0, EXT = 16, SEG = 0.5, pv = [], pc = [];
  const cMinor = new THREE.Color(0xd6d6dd), cMajor = new THREE.Color(0xa8a8b4);
  const addLine = (alongZ, fixed, col)=>{
    for(let b=-EXT; b<EXT-1e-3; b+=SEG){
      if(alongZ) pv.push(fixed,0,b, fixed,0,b+SEG); else pv.push(b,0,fixed, b+SEG,0,fixed);
      pc.push(col.r,col.g,col.b, col.r,col.g,col.b);
    }
  };
  for(let i=-EXT;i<=EXT;i++){ const col = i%5===0 ? cMajor : cMinor; addLine(true, i*GS, col); addLine(false, i*GS, col); }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pv,3)); gg.setAttribute('color', new THREE.Float32BufferAttribute(pc,3));
  const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({vertexColors:true}));
  grid.position.y = FLOOR_Y + 0.01; grid.material.depthWrite = false; grid.renderOrder = 1; scene.add(grid);
}
const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({color:0x2a2440, opacity:0.22, depthWrite:false}));
shadowCatcher.rotation.x = -Math.PI/2; shadowCatcher.position.y = FLOOR_Y + 0.004; shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);

// ---------- 聚光灯 + 应援灯：压暗和光柱在后处理里做（见 post），这里管开关的渐变和四周零星的浅黄色应援灯 ----------
const SPOT = {on:false, k:0, t:0};
{ // 瞄准鼓手胸口，灯头在左前上方 14 单位（和主光同一个方向，影子也朝同一边），半角 10.5°：光圈能照到一点后面的音箱
  const Q = new V3(0.0, 0.6, -1.0), L = 14, U = post.uniforms;
  U.spotA.value.copy(Q).addScaledVector(SUN_DIR, L); U.spotAx.value.copy(SUN_DIR).negate();
  U.spotTan.value = Math.tan(10.5*Math.PI/180); U.spotL.value = L; U.floorY.value = FLOOR_Y;
}
const FANS = (()=>{
  const N = 30, pos = new Float32Array(N*3), col = new Float32Array(N*3), brd = new Float32Array(N*2), base = [];
  let sd = 11; const rnd = ()=> (sd = (sd*16807)%2147483647)/2147483647;
  const pal = [0xfff1a6, 0xffe98a, 0xfff7cc].map(c=>new THREE.Color(c));
  for(let i=0;i<N;i++){
    const a = rnd()*Math.PI*2, R = 6.5 + rnd()*4.5;                     // 离鼓组 6.5～11 单位，一圈都有
    base.push({p:new V3(0.05 + Math.sin(a)*R, FLOOR_Y + 0.75 + rnd()*0.7, -0.45 + Math.cos(a)*R), t:new V3(Math.cos(a), 0, -Math.sin(a)), ph:(rnd() - 0.5)*0.9, amp:0.1 + rnd()*0.12});
    const c = pal[(rnd()*3)|0]; col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    brd[i*2] = rnd()*6.283; brd[i*2+1] = 0.8 + rnd()*0.9;               // 呼吸：每支灯自己的相位和快慢（周期约 3.5～8 秒），不会一起亮灭
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('fcol', new THREE.BufferAttribute(col, 3)); geo.setAttribute('fbr', new THREE.BufferAttribute(brd, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms:{uT:{value:0}, night:{value:new THREE.Color(0x22244c)}},
    vertexShader:'uniform float uT; uniform vec3 night; attribute vec3 fcol; attribute vec2 fbr; varying vec3 vC; varying float vS; void main(){ float b = .5 + .5*sin(uT*fbr.y + fbr.x); b = .12 + .88*b*b; vC = mix(night, fcol, b); vec4 mv = modelViewMatrix*vec4(position, 1.); vS = floor(clamp(28./-mv.z, 2., 3.)); gl_PointSize = vS; gl_Position = projectionMatrix*mv; }',
    // 近的画成 3 格的十字小星，远的 2 格；alpha 写 0.75 给后处理当"自己发光、别压暗"的记号
    fragmentShader:'varying vec3 vC; varying float vS; void main(){ vec2 q = abs(gl_PointCoord - .5); if(vS > 2.5 && q.x > .2 && q.y > .2) discard; gl_FragColor = vec4(vC, .75); }',
    transparent:true, blending:THREE.NoBlending, depthWrite:false
  });
  const pts = new THREE.Points(geo, mat); pts.renderOrder = 20; pts.frustumCulled = false; pts.visible = false; scene.add(pts);
  return {pts, pos, base, geo};
})();
function updateSpot(dt){
  const tgt = SPOT.on ? 1 : 0;
  SPOT.k += Math.sign(tgt - SPOT.k)*Math.min(Math.abs(tgt - SPOT.k), dt*1.7);   // 约 0.6 秒淡入淡出
  const k = SPOT.k*SPOT.k*(3 - 2*SPOT.k);
  post.uniforms.uSpot.value = k;
  // 场景本身的背景保持白色：半透明的果冻透出来的还是亮底，鱿鱼在光里不发灰；真正的背景像素在后处理里换成夜空色
  FANS.pts.visible = k > 0.5;
  if(!FANS.pts.visible) return;
  SPOT.t += dt; FANS.pts.material.uniforms.uT.value = SPOT.t;
  const beat = playing ? globalStep/2 : SPOT.t*0.4;                   // 放歌时跟拍子左右摇（两拍一个来回），停下来慢慢晃
  FANS.base.forEach((b, i)=>{
    const sw = Math.sin(Math.PI*beat + b.ph)*b.amp, bob = Math.abs(Math.cos(Math.PI*beat + b.ph))*0.05;
    FANS.pos[i*3] = b.p.x + b.t.x*sw; FANS.pos[i*3+1] = b.p.y + bob; FANS.pos[i*3+2] = b.p.z + b.t.z*sw;
  });
  FANS.geo.attributes.position.needsUpdate = true;
}

// ---------- 轨道相机：拖动旋转、平移，滚轮/双指缩放 ----------
const ORBIT0 = {tx:0.1, ty:1.0, tz:-0.4, r:7.4, th:0.95, ph:1.2};
const orbit = {target:new V3(), r:0, th:0, ph:0};
function resetOrbit(){ orbit.target.set(ORBIT0.tx, ORBIT0.ty, ORBIT0.tz); orbit.r = ORBIT0.r; orbit.th = ORBIT0.th; orbit.ph = ORBIT0.ph; }
const clampPh = v => Math.max(0.2, Math.min(1.48, v)), clampR = v => Math.max(3.5, Math.min(14, v));
const FOV0 = 38, UPOSE = {pos:new V3(), look:new V3(), fov:FOV0};
function orbitPose(o){
  const th = orbit.th, ph = clampPh(orbit.ph), r = clampR(orbit.r), s = Math.sin(ph);
  o.pos.set(orbit.target.x + r*s*Math.sin(th), orbit.target.y + r*Math.cos(ph), orbit.target.z + r*s*Math.cos(th));
  o.look.copy(orbit.target); o.fov = FOV0; return o;
}
function applyCam(pos, look, fov){
  camera.position.copy(pos); camera.lookAt(look);
  if(FOVK !== 1) fov = 2*Math.atan(Math.tan(fov*Math.PI/360)*FOVK)*360/Math.PI;   // 比 16:9 高的窗口：竖向视野放大一些
  if(Math.abs(camera.fov - fov) > 1e-3){ camera.fov = fov; camera.updateProjectionMatrix(); }
  const r = pos.distanceTo(look); scene.fog.near = r + 2; scene.fog.far = r + 14; post.uniforms.fogFar.value = scene.fog.far;
}
// 舞台区域变了：16:9 及更宽时高度固定 180 格、宽度加宽；更窄时宽度固定 320 格、高度加高
function fitView(cw, ch){
  if(!(cw > 0 && ch > 0)) return;
  const a = cw/ch, A0 = W0/H0;
  let w, h; if(a >= A0){ h = H0; w = Math.min(1280, Math.round(H0*a)); } else { w = W0; h = Math.min(720, Math.round(W0/a)); }
  FOVK = a < A0 ? Math.sqrt(A0/a) : 1;      // 高窗口：竖向视野放大一半（按比例开方），横向稍微裁一点，鼓手不至于缩得太小
  if(w === W && h === H) return;
  W = w; H = h;
  renderer.setSize(W, H, false); rt.setSize(W, H); post.uniforms.px.value.set(1/W, 1/H);
  camera.aspect = W/H; camera.fov = -1;      // 下一帧 applyCam 重新算投影
}
function applyOrbit(){ orbitPose(UPOSE); applyCam(UPOSE.pos, UPOSE.look, UPOSE.fov); }
// 平移：看向点限制在舞台附近，免得把整套鼓拖出画面找不回来
function clampTarget(){ const t = orbit.target; t.x = Math.max(-3.5, Math.min(3.5, t.x)); t.y = Math.max(-0.8, Math.min(3.2, t.y)); t.z = Math.max(-4, Math.min(3, t.z)); }
resetOrbit();

// ---------- 鱿鱼皮肤：与鼓同样的三档光照，再加边缘透光和分档的湿润高光 ----------
const lightView = new V3(), sunDir = SUN_DIR.clone();
function skinMat(o){
  o = o || {};
  return new THREE.ShaderMaterial({
    uniforms:{ map:{value:o.map||null}, useMap:{value:o.map ? 1 : 0}, tint:{value:new THREE.Color(o.tint===undefined ? 0xffffff : o.tint)},
      L:{value:lightView}, amb:{value:new THREE.Color(0x8a7fc0).multiplyScalar(0.55)}, sunC:{value:new THREE.Color(0xfff1dc).multiplyScalar(0.85)},
      rimC:{value:new THREE.Color(0xffb8b4)}, rimK:{value:o.rim===undefined ? 0.4 : o.rim}, rimT:{value:o.rimT||0.62}, specK:{value:o.spec===undefined ? 0.32 : o.spec} },
    vertexColors: !!o.vcol, side: o.side || THREE.FrontSide,
    vertexShader:`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main(){
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vC = vec3(1.0);
        #ifdef USE_COLOR
          vC *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vC *= instanceColor;
        #endif
        vUv = uv;
        vec4 mv = modelViewMatrix * im * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * (mat3(im) * normal));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader:`
      uniform sampler2D map; uniform float useMap; uniform vec3 tint; uniform vec3 L; uniform vec3 amb; uniform vec3 sunC; uniform vec3 rimC;
      uniform float rimK; uniform float rimT; uniform float specK;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main(){
        vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
        vec3 V = normalize(vV);
        vec3 base = tint * vC;
        if(useMap > 0.5) base *= texture2D(map, vUv).rgb;
        float d = dot(N, L);
        float band = d > 0.333 ? 1.0 : (d > -0.333 ? 0.59 : 0.27);
        vec3 col = base * (amb + sunC * band);
        float rim = 1.0 - max(dot(N, V), 0.0);                 // 半透明：轮廓处透出暖粉色，背光一侧更明显
        col += rimC * rimK * step(rimT, rim) * (0.55 + 0.45 * step(d, 0.0));
        float sp = pow(max(dot(N, normalize(L + V)), 0.0), 40.0);   // 湿润的小块高光
        col += vec3(specK) * step(0.55, sp);
        gl_FragColor = vec4(col, 1.0);
      }`
  });
}
// 金属：分档光照 + 假环境反射（天空亮、地平线一道暗带）+ 硬边高光；镲片的切线沿圆周（车纹），高光会拉成放射状亮带
function metalMat(o){
  const m = new THREE.ShaderMaterial({
    uniforms:{ base:{value:new THREE.Color(o.base)}, hi:{value:new THREE.Color(o.hi)}, lo:{value:new THREE.Color(o.lo)}, Lw:{value:SUN_DIR},
      aniso:{value:o.aniso ? 1 : 0}, grooves:{value:o.grooves || 0} },
    side: o.side || THREE.FrontSide,
    vertexShader:`
      varying vec3 vWN; varying vec3 vWP; varying vec3 vT; varying float vR;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vWN = normalize(mat3(modelMatrix) * normal);
        vT = mat3(modelMatrix) * vec3(position.z, 0.0, -position.x);
        vR = length(position.xz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader:`
      uniform vec3 base; uniform vec3 hi; uniform vec3 lo; uniform vec3 Lw; uniform float aniso; uniform float grooves;
      varying vec3 vWN; varying vec3 vWP; varying vec3 vT; varying float vR;
      void main(){
        vec3 N = normalize(vWN); if(!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWP);
        float e = reflect(-V, N).y;
        vec3 env = e > 0.5 ? hi : (e > 0.15 ? mix(base, hi, 0.5) : (e > -0.1 ? lo : mix(lo, base, 0.6)));
        float d = dot(N, Lw);
        float band = d > 0.3 ? 1.0 : (d > -0.3 ? 0.68 : 0.42);
        vec3 col = mix(base*band, env, 0.6);
        vec3 H = normalize(Lw + V);
        float sp;
        if(aniso > 0.5){
          vec3 T = normalize(vT + vec3(1e-5));
          float th = dot(T, H);
          sp = pow(sqrt(max(0.0, 1.0 - th*th)), 90.0) * step(-0.2, d);
          if(grooves > 0.0) col *= 0.9 + 0.1*step(0.5, fract(vR*grooves));
        } else {
          sp = pow(max(dot(N, H), 0.0), 60.0);
        }
        col += hi*(0.75*step(0.55, sp) + 0.3*step(0.25, sp));
        col = mix(col, hi, 0.35*step(0.8, 1.0 - max(dot(N, V), 0.0)));
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  m.userData.mergeable = !o.aniso;     // 只用世界坐标算光照，可以合并（镲片车纹用局部坐标，不合并）
  return m;
}
// ---------- 果冻材质 ----------
// 半透明外壳：中间薄、边缘厚（菲涅尔），越靠轮廓越亮越饱和；背光一侧的轮廓里透出亮色；顶上一片柔和高光。
// 透明度分 5 档再叠 4×4 有序抖动，在 320×180 下是像素画式的网点过渡。外壳照样写深度，外轮廓照样描边
// 只留粉色。颜色是一整条渐变：脑袋上半部是粉，从中部往下慢慢变成淡紫，到触手尖是不透明的深紫红
const PAL = {body:0xffa8c6, mid:0xc890ff, tip:0x8a1a6b, edge:0xff4f8f, edgeM:0xa45cf5, edgeT:0x560b43, glow:0xffe3f0, hi:0xfff7fb,
  ink:0x6e1f5e, lid:0xeea2dc, suck:0xffe6f0, core:0xfff5f8, pen:0xffe2ee, gill:0xff8fb2, star:[0xfff4a8, 0xffd23a, 0xf0981c]};
const JT = {}; [['cBody','body'],['cMid','mid'],['cTip','tip'],['cEdge','edge'],['cEdgeM','edgeM'],['cEdgeT','edgeT'],['cGlow','glow'],['cHi','hi']].forEach(([k, n])=>JT[k] = {value:new THREE.Color(PAL[n])});
function jellyMat(o){
  o = o || {};
  const u = Object.assign({}, JT, {
    Lw:{value:SUN_DIR}, map:{value:o.map||null}, useMap:{value:o.map ? 1 : 0}, spotK:{value:o.spot||0},
    yR:{value:new THREE.Vector2(...(o.yR||[0,1]))}, aIn:{value:o.aIn===undefined ? 0.3 : o.aIn}, aEdge:{value:o.aEdge===undefined ? 0.95 : o.aEdge},
    limb:{value:o.limb ? 1 : 0}, aTip:{value:o.aTip===undefined ? 0.35 : o.aTip}, flash:{value:0},
    gR:{value:new THREE.Vector3(...(o.gR||[0, 0, 1]))}      // 渐变位置：底端的 g、顶端的 g、在多高处到顶（g=0 粉，0.5 淡紫，1 蓝紫）
  });
  return new THREE.ShaderMaterial({
    uniforms:u, vertexColors: !!o.limb, side: o.side || THREE.FrontSide, transparent:true, depthWrite:true,
    blending:THREE.CustomBlending, blendEquation:THREE.AddEquation, blendSrc:THREE.SrcAlphaFactor, blendDst:THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha:THREE.AddEquation, blendSrcAlpha:THREE.ZeroFactor, blendDstAlpha:THREE.ZeroFactor,   // alpha 清零，当作"这里是果冻"的记号给描边用
    vertexShader:`
      uniform vec2 yR;
      varying vec3 vWN; varying vec3 vWP; varying float vH; varying vec2 vUv;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz; vWN = normalize(mat3(modelMatrix) * normal); vUv = uv;
        vH = (position.y - yR.x)/(yR.y - yR.x);
        #ifdef USE_COLOR
          vH = color.r;            // 触手：顶点色的 r 存沿长度的位置（根 0，尖 1）
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader:`
      uniform vec3 cBody; uniform vec3 cMid; uniform vec3 cTip; uniform vec3 cEdge; uniform vec3 cEdgeM; uniform vec3 cEdgeT; uniform vec3 cGlow; uniform vec3 cHi; uniform vec3 Lw; uniform vec3 gR;
      uniform sampler2D map; uniform float useMap; uniform float spotK; uniform float aIn; uniform float aEdge; uniform float limb; uniform float aTip; uniform float flash;
      varying vec3 vWN; varying vec3 vWP; varying float vH; varying vec2 vUv;
      float bay2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y*0.75))); }
      float bay4(vec2 a){ return bay2(0.5*a)*0.25 + bay2(a); }
      vec3 ramp(vec3 a, vec3 b, vec3 c, float g){ return g < 0.5 ? mix(a, b, g*2.0) : mix(b, c, g*2.0 - 1.0); }
      void main(){
        vec3 N = normalize(vWN); if(!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWP);
        float ndv = max(dot(N, V), 0.0), fr = 1.0 - ndv, h = clamp(vH, 0.0, 1.0);
        float tipK = 0.0, g;
        if(limb > 0.5){                                                    // 触手接着头底的颜色，往尖端走完剩下的渐变
          tipK = smoothstep(0.55, 0.95, h);
          g = h < 0.55 ? mix(0.46, 0.6, h/0.55) : mix(0.6, 1.0, smoothstep(0.55, 0.88, h));
        } else g = mix(gR.x, gR.y, smoothstep(0.0, gR.z, h));
        vec3 base = ramp(cBody, cMid, cTip, g), edge = ramp(cEdge, cEdgeM, cEdgeT, g);
        float d = dot(N, Lw);
        vec3 col = base * (d > 0.3 ? 1.0 : (d > -0.3 ? 0.86 : 0.74));     // 果冻自己透光，明暗档比实心物体浅
        float e1 = step(0.4, fr), e2 = step(0.68, fr);                     // 菲涅尔边两档：越靠轮廓越亮越饱和
        col = mix(col, edge, 0.32*e1 + 0.4*e2);
        float back = step(d, 0.12) * step(0.3, fr);                         // 背光面：轮廓里透出亮色
        col = mix(col, cGlow, 0.6*back*(1.0 - 0.6*e2));
        float top = step(0.7, N.y) * step(0.4, ndv);                        // 顶上一片柔光
        col = mix(col, cHi, 0.5*top);
        float spk = step(0.6, pow(max(dot(N, normalize(Lw + V)), 0.0), 50.0));
        col = mix(col, vec3(1.0), 0.85*spk);
        float a = mix(aIn, aEdge, fr*fr*(3.0 - 2.0*fr));
        if(useMap > 0.5){                                                   // 色素细胞：斑点处更浓、更不透明
          float m = 1.0 - texture2D(map, vUv).g;
          col = mix(col, edge*0.9, m*spotK); a += m*spotK*0.5;
        }
        if(limb > 0.5){                                                    // 根部接着头比较实，往中段越来越透，尖端变成不透明的深紫红
          a *= mix(1.0, aTip, smoothstep(0.08, 0.55, h));
          a = mix(a, 1.0, smoothstep(0.68, 0.86, h));
          col = mix(col, cGlow, flash*tipK*0.85); a += flash*tipK*0.4;
        }
        a = max(a, 0.9*spk);
        a = clamp(floor(a*5.0 + bay4(gl_FragCoord.xy))/5.0, 0.0, 1.0);    // 分档 + 有序抖动
        gl_FragColor = vec4(col, a);
      }`
  });
}
// 果冻里的器官：不透明，被外壳染色。轮廓一圈略暗，正面有一点亮，看着像浮在里面的软球
function organMat(color, gloss){
  const m = new THREE.ShaderMaterial({
    uniforms:{c:{value:new THREE.Color(color)}, Lw:{value:SUN_DIR}, gloss:{value:gloss||0}},
    vertexShader:`varying vec3 vWN; varying vec3 vWP;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWP = wp.xyz; vWN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader:`uniform vec3 c; uniform vec3 Lw; uniform float gloss; varying vec3 vWN; varying vec3 vWP;
      void main(){
        vec3 N = normalize(vWN), V = normalize(cameraPosition - vWP);
        float ndv = max(dot(N, V), 0.0), d = dot(N, Lw);
        vec3 col = c*(d > 0.2 ? 1.0 : 0.86);
        col *= 1.0 - 0.2*step(ndv, 0.4);
        col = mix(col, vec3(1.0), gloss*step(0.5, pow(max(dot(N, normalize(Lw + V)), 0.0), 24.0)));
        col = mix(col, vec3(1.0), 0.3*gloss*step(0.7, ndv)*step(0.2, N.y));
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  m.userData.mergeable = true;
  return m;
}
// 连续软管：沿一串点扫出椭圆截面的管子，顶点和法线每帧直接算。
// 以前触手是一串小球拼的，每个球各自打光、各自描边，看起来一节一节；换成一整根管子就连贯了
const TUBE_M = 10, TUBE_CAP = [[0.5, 0.866], [0.85, 0.527]];      // 末端圆头：沿切线的偏移（×半径）和截面缩放
const _tr = new V3(), _tn = new V3();
function makeTube(n, mat, vRep){
  const M = TUBE_M, rings = n + 2, nv = rings*M + 1;
  const pos = new Float32Array(nv*3), nor = new Float32Array(nv*3), col = new Float32Array(nv*3).fill(1), uv = new Float32Array(nv*2), idx = [];
  for(let k=0;k<rings;k++) for(let j=0;j<M;j++){ uv[(k*M + j)*2] = j/M; uv[(k*M + j)*2 + 1] = k*(vRep || 0); }
  for(let k=0;k<rings-1;k++) for(let j=0;j<M;j++){ const a = k*M + j, b = k*M + (j+1)%M; idx.push(a, b, a + M, b, b + M, a + M); }
  const T = rings*M; for(let j=0;j<M;j++) idx.push((rings-1)*M + j, (rings-1)*M + (j+1)%M, T);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
  return {n, rings, geo, pos, nor, col, mesh};
}
function tubeColor(tb, k, c){ for(let j=0;j<TUBE_M;j++){ const o = (k*TUBE_M + j)*3; tb.col[o] = c.r; tb.col[o+1] = c.g; tb.col[o+2] = c.b; } }
function tubeColorsDone(tb){   // 圆头和尖顶沿用最后一圈的颜色
  const M = TUBE_M, last = (tb.n - 1)*M*3;
  for(let k=tb.n;k<tb.rings;k++) for(let j=0;j<M;j++) for(let q=0;q<3;q++) tb.col[(k*M + j)*3 + q] = tb.col[last + q];
  for(let q=0;q<3;q++) tb.col[tb.rings*M*3 + q] = tb.col[last + q];
  tb.geo.attributes.color.needsUpdate = true;
}
function tubeRing(tb, k, P, bb, nn, tg, rw, rt, sc, off){   // bb、nn、tg 是右手标架（bb = nn × tg）
  const M = TUBE_M; sc = sc === undefined ? 1 : sc; off = off || 0;
  for(let j=0;j<M;j++){
    const a = j/M*Math.PI*2, ca = Math.cos(a), sa = Math.sin(a), o = (k*M + j)*3;
    _tr.copy(P).addScaledVector(bb, ca*rw*sc).addScaledVector(nn, sa*rt*sc).addScaledVector(tg, off);
    tb.pos[o] = _tr.x; tb.pos[o+1] = _tr.y; tb.pos[o+2] = _tr.z;
    _tn.copy(bb).multiplyScalar(ca/rw).addScaledVector(nn, sa/rt).normalize().multiplyScalar(sc).addScaledVector(tg, off ? Math.sqrt(Math.max(0, 1 - sc*sc)) : 0).normalize();
    tb.nor[o] = _tn.x; tb.nor[o+1] = _tn.y; tb.nor[o+2] = _tn.z;
  }
}
function tubeEnd(tb, P, bb, nn, tg, rw, rt){                   // 在最后一圈之后补一个圆头，然后标记更新
  const rr = 0.5*(rw + rt);
  TUBE_CAP.forEach(([off, sc], i)=>tubeRing(tb, tb.n + i, P, bb, nn, tg, rw, rt, sc, off*rr));
  const o = tb.rings*TUBE_M*3; _tr.copy(P).addScaledVector(tg, rr);
  tb.pos[o] = _tr.x; tb.pos[o+1] = _tr.y; tb.pos[o+2] = _tr.z; tb.nor[o] = tg.x; tb.nor[o+1] = tg.y; tb.nor[o+2] = tg.z;
  tb.geo.attributes.position.needsUpdate = true; tb.geo.attributes.normal.needsUpdate = true;
}
// 色素细胞：画在小画布上当贴图，每个斑点按自己的节奏扩张收缩，还有一道明暗波从下往上扫过
function makeSkinTex(w, h, n, dorsalK, cols){
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.LinearFilter; tex.wrapS = THREE.RepeatWrapping;
  const spots = [];
  while(spots.length < n){
    const u = Math.random(), dors = 0.5 + 0.5*Math.cos(2*Math.PI*(u-0.75));
    if(Math.random() > 0.3 + 0.7*dors*dorsalK + (1-dorsalK)*0.7) continue;
    spots.push({u, v:Math.random(), r:(0.4 + Math.random()*1.0)*w/64, ph:Math.random()*6.283, f:0.5 + Math.random()*1.6, c:cols[Math.random() < 0.72 ? 0 : 1]});
  }
  return {cv, tex, spots, dorsalK};
}
function paintSkin(S, t){
  const g = S.cv.getContext('2d'), w = S.cv.width, h = S.cv.height;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  const k = 0.32*S.dorsalK, dg = g.createLinearGradient(0, 0, w, 0);   // 背深腹浅
  [[0,0.5],[0.25,0],[0.5,0.5],[0.75,1],[1,0.5]].forEach(([p,a])=>dg.addColorStop(p, 'rgba(214,92,108,'+(a*k).toFixed(3)+')'));
  g.fillStyle = dg; g.fillRect(0, 0, w, h);
  for(const s of S.spots){
    const ex = 0.5 + 0.5*Math.sin(t*s.f + s.ph), wave = 0.5 + 0.5*Math.sin(t*2.1 - s.v*9);
    const r = s.r*(0.35 + 0.65*ex*(0.55 + 0.45*wave));
    g.fillStyle = s.c + (0.45 + 0.35*wave).toFixed(3) + ')';
    g.beginPath(); g.arc(s.u*w, (1-s.v)*h, r, 0, 6.283); g.fill();
  }
  S.tex.needsUpdate = true;
}
const SKIN_M = makeSkinTex(128, 128, 460, 1, ['rgba(190,46,72,', 'rgba(214,112,64,']);
const SKIN_H = makeSkinTex(128, 64, 200, 0.6, ['rgba(186,44,70,', 'rgba(210,104,60,']);
paintSkin(SKIN_M, 0); paintSkin(SKIN_H, 0);

// ---------- 鱿鱼身体（比例以角色设定图为准） ----------
// 本地坐标：+x 朝脸前方，±z 为两侧，y 向上；y=0 是外套膜下缘，头在其下方，触手从头底一圈长出
const body = new THREE.Group(); scene.add(body);
const bodyBase = new V3(0, 1.45, -1.05);
const vtoon = () => toon(0xffffff, {vertexColors:true});
function latheGeo(prof, seg, cols){
  const g = new THREE.LatheGeometry(prof.map(([r,y])=>new THREE.Vector2(r,y)), seg);
  const pos = g.attributes.position, col = new Float32Array(pos.count*3), c = new THREE.Color();
  const ys = prof.map(p=>p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for(let i=0;i<pos.count;i++){
    const k = (pos.getY(i)-y0)/(y1-y0);
    let j = 0; while(j < cols.length-2 && k > cols[j+1][0]) j++;
    const [ka, ca] = cols[j], [kb, cb] = cols[j+1];
    c.set(ca).lerp(new THREE.Color(cb), Math.min(1, Math.max(0, (k-ka)/(kb-ka))));
    col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  return g;
}
const MANTLE_H = 1.75, HEAD_H = 0.5, RING_Y = -HEAD_H, RING_R = 0.19;
const _Zf0 = new V3(0,0,1);
// 外套膜：会呼吸（径向收缩），鳍挂在外套膜上一起缩放
const mantleG = new THREE.Group(); body.add(mantleG);
const MANTLE_PROF = [[0.0,-0.02],[0.33,-0.02],[0.37,0.08],[0.4,0.32],[0.385,0.6],[0.33,0.88],[0.25,1.12],[0.18,1.34],[0.11,1.52],[0.05,1.66],[0.0,MANTLE_H]];   // 上半段收细拉长
// 外套膜网格沿高度加密，好逐顶点弯曲：头一动，它像果冻一样弯过去再弹回来
const MANTLE_FINE = [[0.33,-0.02]];      // 底部不封口：果冻是透明的，封口的圆盘会在里面露出来
for(let i=0;i<=30;i++){ const y = i/30*(MANTLE_H - 0.05); MANTLE_FINE.push([mantleR(y), y]); }
MANTLE_FINE.push([0.0, MANTLE_H]);
const mantleMesh = new THREE.Mesh(latheGeo(MANTLE_FINE, 48,
  [[0,0xf3a4a2],[0.25,0xfadcd0],[0.6,0xfcece0],[1,0xf8d4cc]]), jellyMat({map:SKIN_M.tex, spot:0.3, yR:[-0.02, MANTLE_H], aIn:0.28, gR:[0.38, 0, 0.6]}));
mantleMesh.frustumCulled = false; mantleG.add(mantleMesh);
// 鳍和外套膜是一整块：在鳍的高度把外套膜两侧（±z）往外拉出一道越来越薄的脊，代替原来单独贴上去的两片鳍，
// 这样头顶和鳍之间是同一张曲面，轮廓、透明度和壳的厚度都连在一起
const FIN_Y0 = 0.95, FIN_L = 0.74, FIN_W = 0.31, FIN_P = 18, MSEG = 48, MNP = MANTLE_FINE.length;
function finW(y){ const s = (y - FIN_Y0)/FIN_L; if(s <= 0 || s >= 1) return 0; return FIN_W*Math.pow(s < 0.42 ? s/0.42 : (1-s)/0.58, 0.85); }
const MF_K = new Float32Array(mantleMesh.geometry.attributes.position.count), MF_S = new Float32Array(MF_K.length);
{
  const g = mantleMesh.geometry, pa = g.attributes.position.array;
  for(let i=0, v=0; i<pa.length; i+=3, v++){
    const x = pa[i], y = pa[i+1], z = pa[i+2], r = Math.hypot(x, z), w = finW(y);
    if(w <= 0 || r < 1e-5) continue;
    const k = Math.pow(Math.abs(z)/r, FIN_P), kk = k*Math.min(1, w/0.06);
    pa[i] = x*(1 - 0.6*kk); pa[i+1] = y + 0.12*w*k; pa[i+2] = z + Math.sign(z)*w*k;
    MF_K[v] = kk; MF_S[v] = (y - FIN_Y0)/FIN_L;
  }
  g.computeVertexNormals();
  const n = g.attributes.normal.array;                       // 车削网格的接缝两列法线取平均，免得出现一道折痕
  for(let j=0;j<MNP;j++){ const a = j*3, b = (MSEG*MNP + j)*3; let x = n[a] + n[b], y = n[a+1] + n[b+1], z = n[a+2] + n[b+2]; const l = Math.hypot(x, y, z) || 1; n[a] = n[b] = x/l; n[a+1] = n[b+1] = y/l; n[a+2] = n[b+2] = z/l; }
}
const M0P = mantleMesh.geometry.attributes.position.array.slice(), M0N = mantleMesh.geometry.attributes.normal.array.slice();
// 软体形变：弯曲量随高度平方增长（根部不动、尖端甩得最多），再加扭转和一道从下往上走的鼓包
const SOFT = {bx:0, bz:0, tw:0, wave:[]}, _sv = {x:0, y:0, z:0};
function softR(h){ let r = 1; for(const w of SOFT.wave){ r += w.a*Math.exp(-w.t*2.5)*Math.exp(-(((h - w.t/0.45)/0.15)**2)); } return r; }
function softPt(x, y, z){
  const h = Math.max(0, y)/MANTLE_H, f = h*h*MANTLE_H, rs = softR(h), a = SOFT.tw*h, ca = Math.cos(a), sa = Math.sin(a);
  _sv.x = (x*ca - z*sa)*rs + SOFT.bx*f; _sv.y = y; _sv.z = (x*sa + z*ca)*rs + SOFT.bz*f;
  return _sv;
}
function updateSoftMantle(dt, t){
  for(let i=SOFT.wave.length-1;i>=0;i--){ SOFT.wave[i].t += dt; if(SOFT.wave[i].t > 0.9) SOFT.wave.splice(i, 1); }
  const P = mantleMesh.geometry.attributes.position, NA = mantleMesh.geometry.attributes.normal, p = P.array, n = NA.array;
  for(let i=0, v=0;i<p.length;i+=3, v++){
    const fw = MF_K[v] > 0 ? MF_K[v]*0.05*Math.sin(t*4.2 - MF_S[v]*6.5 + (M0P[i+2] > 0 ? 0 : 1.2)) : 0;   // 鳍的外缘：一道从下往上走的波
    const y = M0P[i+1], q = softPt(M0P[i] + fw, y, M0P[i+2]);
    p[i] = q.x; p[i+1] = q.y; p[i+2] = q.z;
    const h = Math.max(0, y)/MANTLE_H, a = SOFT.tw*h, ca = Math.cos(a), sa = Math.sin(a);
    const nx = M0N[i]*ca - M0N[i+2]*sa, nz = M0N[i]*sa + M0N[i+2]*ca, ny = M0N[i+1] - 2*h*(SOFT.bx*nx + SOFT.bz*nz);
    const l = Math.hypot(nx, ny, nz) || 1;
    n[i] = nx/l; n[i+1] = ny/l; n[i+2] = nz/l;
  }
  P.needsUpdate = true; NA.needsUpdate = true;
}
const headMesh = new THREE.Mesh(latheGeo(
  [[0.0,RING_Y-0.03],[0.19,RING_Y],[0.2,RING_Y+0.1],[0.215,-0.28],[0.255,-0.16],[0.29,-0.06],[0.3,0.0]], 20,   // 加长的脖子；顶上不封口，和外套膜接成一整个壳
  [[0,0xee8a8c],[1,0xf6aaa4]]), jellyMat({map:SKIN_H.tex, spot:0.25, yR:[RING_Y, 0], aIn:0.38, gR:[0.46, 0.38, 1]}));
body.add(headMesh);
// 漏斗：头下方朝前的短管，外套膜收缩时它鼓起来
const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.058, 0.15, 10, 1, true), jellyMat({yR:[-0.3, 0.3], aIn:0.5, side:THREE.DoubleSide, gR:[0.42, 0.42, 1]}));
funnel.position.set(0.2, -0.24, 0); funnel.rotation.z = -1.95; body.add(funnel);
// 鳍：一张会起伏的网格，根部贴着外套膜，外缘的波从前往后传
function mantleR(y){ for(let i=1;i<MANTLE_PROF.length;i++){ const [r1,y1] = MANTLE_PROF[i], [r0,y0] = MANTLE_PROF[i-1]; if(y <= y1) return r0 + (r1-r0)*(y-y0)/Math.max(1e-6, y1-y0); } return 0; }
const fins = [];                 // 鳍已经长在外套膜上了（见 finW）
function updateFins(){}
// ---------- 果冻里面：乳白内核 + 几团淡色器官 + 背上一片细长的内壳 ----------
// 每个器官在世界空间里用弹簧追自己"本该在"的位置（跟着外套膜一起弯），头一动它们慢半拍，晃几下再停稳
const ORGANS = [], ORG_SPH = new THREE.SphereGeometry(1, 16, 12), _og = new V3(), _og2 = new V3();
const coreMat = organMat(PAL.core, 1), penMat = organMat(PAL.pen, 0.3), gillMat = organMat(PAL.gill, 0.3);
// 四芒星（照用户给的像素星）：四个尖，边是微微内凹的弧，相邻两条边在凹角处直接相交，所以凹角是尖的；
// 立体上是一块鼓起来的软面（法线平滑），不再分水晶切面
function starGeo(R, hz, sy, rv, cv){
  const E = 6, out = [];
  const tip = k => new V3(Math.cos(k*Math.PI/2)*R, Math.sin(k*Math.PI/2)*R*sy, 0);
  const val = k => new V3(Math.cos(k*Math.PI/2 + Math.PI/4)*R*rv, Math.sin(k*Math.PI/2 + Math.PI/4)*R*rv*sy, 0);
  const bez = (a, c, b, t) => new V3().copy(a).multiplyScalar((1-t)*(1-t)).addScaledVector(c, 2*t*(1-t)).addScaledVector(b, t*t);
  for(let k=0;k<4;k++){
    const T = tip(k), V = val(k), T2 = tip(k + 1);
    const c1 = T.clone().add(V).multiplyScalar(0.5*(1 - cv)), c2 = V.clone().add(T2).multiplyScalar(0.5*(1 - cv));
    for(let i=0;i<E;i++) out.push(bez(T, c1, V, i/E));
    for(let i=0;i<E;i++) out.push(bez(V, c2, T2, i/E));
  }
  const n = out.length, pos = [], edge = [], idx = [];
  pos.push(0, 0, hz); edge.push(1);
  for(const q of out){ pos.push(q.x*0.5, q.y*0.5, hz*0.72); edge.push(0.6); }
  for(const q of out){ pos.push(q.x, q.y, 0); edge.push(0); }
  for(const q of out){ pos.push(q.x*0.5, q.y*0.5, -hz*0.72); edge.push(0.6); }
  pos.push(0, 0, -hz); edge.push(1);
  const F1 = i => 1 + i%n, O = i => 1 + n + i%n, B1 = i => 1 + 2*n + i%n, BC = 1 + 3*n;
  for(let i=0;i<n;i++){
    idx.push(0, F1(i), F1(i+1));
    idx.push(F1(i), O(i), O(i+1), F1(i), O(i+1), F1(i+1));
    idx.push(O(i), B1(i), B1(i+1), O(i), B1(i+1), O(i+1));
    idx.push(BC, B1(i+1), B1(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const STAR_GEO = starGeo(1, 0.3, 1.06, 0.36, 0.16);
const starMat = new THREE.ShaderMaterial({
  uniforms:{cA:{value:new THREE.Color(PAL.star[0])}, cB:{value:new THREE.Color(PAL.star[1])}, cC:{value:new THREE.Color(PAL.star[2])}, Lw:{value:SUN_DIR}, glow:{value:0}},
  vertexShader:`attribute float edge; varying vec3 vWN; varying vec3 vWP; varying float vY; varying float vE;
    void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWP = wp.xyz; vWN = normalize(mat3(modelMatrix)*normal); vY = position.y; vE = edge; gl_Position = projectionMatrix*viewMatrix*wp; }`,
  fragmentShader:`uniform vec3 cA; uniform vec3 cB; uniform vec3 cC; uniform vec3 Lw; uniform float glow; varying vec3 vWN; varying vec3 vWP; varying float vY; varying float vE;
    void main(){
      vec3 N = normalize(vWN); if(!gl_FrontFacing) N = -N;
      vec3 V = normalize(cameraPosition - vWP);
      vec3 col = vY > 0.0 ? mix(cB, cA, smoothstep(0.0, 0.8, vY)) : mix(cB, cC, smoothstep(0.0, 0.8, -vY));
      float d = dot(N, Lw);
      col *= d > 0.35 ? 1.06 : (d > -0.15 ? 0.9 : 0.74);
      col *= mix(0.84, 1.0, smoothstep(0.05, 0.4, vE));                // 靠边一圈略深，形状更清楚
      col = mix(col, vec3(1.0), 0.7*step(0.55, pow(max(dot(N, normalize(Lw + V)), 0.0), 24.0)));
      col = mix(col, vec3(1.0), 0.45*glow);
      gl_FragColor = vec4(col, 1.0);
    }`
});
const STARS = [];
function addOrgan(mat, parent, p, sc, k, zeta, maxOff, rot, geo){
  const m = new THREE.Mesh(geo || ORG_SPH, mat); m.scale.copy(sc); if(rot) m.rotation.set(rot[0], rot[1], rot[2]); m.position.copy(p); parent.add(m);
  const O = {m, parent, soft: parent === mantleG, p0:p.clone(), sc0:sc.clone(), k, c:2*Math.sqrt(k)*zeta, maxOff, P:new V3(), V:new V3(), init:false, pulse:0};
  ORGANS.push(O); return O;
}
const CORE = addOrgan(coreMat, mantleG, new V3(0.03, 0.42, 0), new V3(0.205, 0.2, 0.205), 40, 0.16, 0.09);   // 内核：大颗乳白珠子，最晃
addOrgan(gillMat, mantleG, new V3(0.13, 0.15, 0.17), new V3(0.06, 0.1, 0.045), 70, 0.2, 0.04, [0.45, 0, 0]);    // 两片鳃
addOrgan(gillMat, mantleG, new V3(0.13, 0.15, -0.17), new V3(0.06, 0.1, 0.045), 70, 0.2, 0.04, [-0.45, 0, 0]);
// 三颗黄色四芒星：各自慢慢转，跟着身体慢半拍晃；吊镲一响一起闪一下
[[mantleG, new V3(0.03, 0.9, 0.02), 0.2, 26, 0.12, 0.05, 0.55, 0.0],
 [mantleG, new V3(0.0, 1.26, 0.0), 0.12, 20, 0.1, 0.035, -0.75, 1.7],
 [body, new V3(-0.04, -0.19, 0), 0.09, 80, 0.22, 0.02, 0.6, 3.1]].forEach(([par, p, r, k, z, mo, spin, ph])=>{
  const O = addOrgan(starMat, par, p, new V3(r, r, r), k, z, mo, null, STAR_GEO);
  O.spin = spin; O.ang = ph; STARS.push(O);
});
const PEN = (()=>{   // 内壳：沿背侧内壁的一片窄叶子，跟外套膜一起逐顶点弯
  const pts = []; for(let i=0;i<=12;i++){ const y = 0.1 + i/12*1.45; pts.push(new V3(-Math.max(0.02, mantleR(y) - 0.075), y, 0)); }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.02, 6, false), pa = geo.attributes.position.array;
  for(let i=0;i<pa.length;i+=3){ const y = pa[i+1], t = Math.min(1, Math.max(0, (y - 0.1)/1.45)), w = 1 + 1.6*Math.sin(Math.PI*Math.pow(t, 0.8)); pa[i+2] *= w; }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, penMat); m.frustumCulled = false; mantleG.add(m);
  return {m, geo, P0:pa.slice()};
})();
function updateOrgans(dt){
  const h = Math.min(dt, 1/30);
  starMat.uniforms.glow.value = STARS.reduce((m, O)=>Math.max(m, O.pulse), 0);
  const pa = PEN.geo.attributes.position.array;
  for(let i=0;i<pa.length;i+=3){ const q = softPt(PEN.P0[i], PEN.P0[i+1], PEN.P0[i+2]); pa[i] = q.x; pa[i+1] = q.y; pa[i+2] = q.z; }
  PEN.geo.attributes.position.needsUpdate = true;
  for(const O of ORGANS){
    if(O.soft){ const q = softPt(O.p0.x, O.p0.y, O.p0.z); _og.set(q.x, q.y, q.z); } else _og.copy(O.p0);
    O.parent.localToWorld(_og);
    if(!O.init){ O.P.copy(_og); O.V.set(0, 0, 0); O.init = true; }
    O.V.addScaledVector(_og2.subVectors(_og, O.P), O.k*h).multiplyScalar(Math.max(0, 1 - O.c*h));
    O.P.addScaledVector(O.V, h);
    _og2.subVectors(O.P, _og); const l = _og2.length();
    if(l > O.maxOff){ O.P.copy(_og).addScaledVector(_og2, O.maxOff/l); O.V.multiplyScalar(0.5); }
    O.parent.worldToLocal(_og2.copy(O.P)); O.m.position.copy(_og2);
    O.pulse *= Math.exp(-dt*7);
    if(O.spin){ O.ang += O.spin*dt; O.m.rotation.set(0.28*Math.sin(O.ang*0.7 + 1), O.ang, 0.18*Math.sin(O.ang*0.5)); }
    const pz = 1 + 0.16*O.pulse*Math.cos(O.pulse*9);
    O.m.scale.set(O.sc0.x*pz, O.sc0.y*(2 - pz), O.sc0.z*pz);
  }
}
// 眼睛：眼球 + 眼睑 + 会转动的虹膜和瞳孔 + 固定朝光的高光
const eyeLook = new V3(0.3, 0.3, 0.2), eyes = [];
const LID_GEO = new THREE.SphereGeometry(0.15, 14, 6, 0, Math.PI*2, 0, Math.PI/2), lidCapM = skinMat({map:SKIN_H.tex, tint:0xf6b0aa, side:THREE.DoubleSide, rim:0.3}), lidM = skinMat({tint:0xf3a2a0, rim:0.3});   // 眼睑不透明，免得眨眼时透出眼珠
{
  const ball = toon(0xf6f1ea), irisM = toon(0xfbb34a), pupM = toon(0x2e2429), glint = new THREE.MeshBasicMaterial({color:0xffffff});
  for(const s of [-1,1]){
    const a = s*0.8, ne = new V3(Math.cos(a), 0, Math.sin(a)), c = new V3(ne.x*0.24, -0.1, ne.z*0.24);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 9), ball); e.position.copy(c); body.add(e);
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.03, 6, 18), lidM);
    lid.position.copy(c).addScaledVector(ne, 0.045); lid.quaternion.setFromUnitVectors(_Zf0, ne); body.add(lid);
    const pg = new THREE.Group(); pg.position.copy(c); body.add(pg);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), irisM); ir.scale.z = 0.55; ir.position.z = 0.078; pg.add(ir);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), pupM); pu.scale.set(1.25, 0.8, 0.5); pu.position.z = 0.112; pg.add(pu);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.017, 5, 4), glint); gl.position.copy(c).addScaledVector(ne.clone().add(new V3(0.15, 0.35, 0)).normalize(), 0.132); body.add(gl);
    pg.quaternion.setFromUnitVectors(_Zf0, ne);
    // 眼睑：比眼球大一圈的半球壳，绕眼睛的水平轴转动，往前转就是闭眼
    const lg = new THREE.Group(); lg.position.copy(c);
    lg.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V3().crossVectors(UPV, ne), UPV, ne)); body.add(lg);
    const lidCap = new THREE.Mesh(LID_GEO, lidCapM); lidCap.rotation.x = -0.55; lg.add(lidCap);
    eyes.push({pg, c, ne, lidCap});
  }
}
const _eq = new THREE.Quaternion(), _ev = new V3(), _ev2 = new V3();
function updateEyes(lidA){
  for(const E of eyes){
    E.lidCap.rotation.x = lidA;
    body.worldToLocal(_ev.copy(eyeLook)).sub(E.c).normalize();
    const ang = _ev.angleTo(E.ne);
    if(ang > 0.5) _ev.copy(_ev2.copy(E.ne).lerp(_ev, 0.5/ang).normalize());
    _eq.setFromUnitVectors(_Zf0, _ev);
    E.pg.quaternion.slerp(_eq, perFrame(0.3));
  }
}
body.rotation.order = 'YZX';            // 先侧摇、再点头、最后转身
body.rotation.y = -Math.PI/2;          // 脸朝 +z，正对鼓组
body.position.copy(bodyBase);
const ringPoint = (ang, out) => out.set(Math.cos(ang)*RING_R, RING_Y, Math.sin(ang)*RING_R);
const squidRing = new V3(bodyBase.x, bodyBase.y + RING_Y, bodyBase.z);
// 头底一圈的十个位置：前方四个给打鼓的触手，其余六条腕待机
const SLOT = {L:-0.942, R:-0.314, K:0.314, F:0.942};   // 按目标从右到左排：踩镲/吊镲、军鼓/嗵、底鼓、落地嗵，触手根部互不交叉
const IDLE_SLOTS = [1.571, -1.571, 2.199, -2.199, 2.827, -2.827];

const sphereGeo = new THREE.SphereGeometry(1, 8, 6), ringGeo = new THREE.TorusGeometry(1, 0.42, 4, 8);
const suckMat = toon(0xfbe9d6), LIMB_J = {limb:true, aIn:0.66, aEdge:1.0, aTip:0.36}, armJelly = jellyMat(LIMB_J);
const S_COL = s => ({r:s, g:0, b:0});   // 果冻触手的顶点色只用来传沿长度的位置

// 待机的六条腕
const ASEG = 38, NIDLE = IDLE_SLOTS.length;
const armSuck = new THREE.InstancedMesh(ringGeo, suckMat, NIDLE*8); scene.add(armSuck);
const armDefs = IDLE_SLOTS.map((ang,i)=>({ang, len: 1.6 + 0.2*((i*3)%4)/3, ph: i*1.37, curl: 0.45 + 0.25*((i*5)%3)/2,
  P:Array.from({length:ASEG}, ()=>new V3()), Vl:Array.from({length:ASEG}, ()=>new V3()), init:false, tube:makeTube(ASEG, armJelly), N0:new V3()}));
for(const A of armDefs){ for(let k=0;k<ASEG;k++) tubeColor(A.tube, k, S_COL(k/(ASEG-1))); tubeColorsDone(A.tube); }
const _pn = new V3(), _pb = new V3();
const _ap = new V3(), _ad = new V3(), _ao = new V3(), _as = new V3(), _an = new V3(), _aq = new THREE.Quaternion(), _Z = new V3(0,0,1), _aI = new THREE.Quaternion(), _aS = new V3(), _aS2 = new V3(), _aM = new THREE.Matrix4();
const _at = new V3(), _ab = new V3(), _ax2 = new V3(), _aqr = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _au = new V3();
// 后面六条腕：先按曲率沿长度积分出一个会游动的目标姿态（两个方向的行波），
// 再在世界空间里用"越靠尖越软"的弹簧去追它，身体一动，腕会拖在后面、甩过头再荡回来
function updateArms(t, dt){
  let si = 0;
  body.getWorldQuaternion(_bq);
  const h = Math.min(dt, 1/30);
  for(let a=0;a<NIDLE;a++){
    const A = armDefs[a], ds = A.len/(ASEG-1);
    _ao.set(Math.cos(A.ang), 0, Math.sin(A.ang)); _as.set(-Math.sin(A.ang), 0, Math.cos(A.ang));
    ringPoint(A.ang, _ap);
    _ad.set(0, -1, 0).multiplyScalar(0.9).addScaledVector(_ao, 0.45).normalize();
    _ab.copy(_as);                                                  // 弯曲轴（腕的侧向）
    const curl = A.curl*(1 + 0.45*Math.sin(t*0.5 + A.ph) + 0.2*Math.sin(t*1.3 + A.ph*2.3));
    A.N0.crossVectors(_ad, _ab).normalize().applyQuaternion(_bq);   // 根部吸盘那一侧（世界）
    for(let k=0;k<ASEG;k++){
      const s = k/(ASEG-1);
      body.localToWorld(_at.copy(_ap));                             // 这一节的目标位置（世界）
      const P = A.P[k], Vl = A.Vl[k];
      if(!A.init){ P.copy(_at); Vl.set(0, 0, 0); }
      if(k === 0) P.copy(_at);
      else {
        const K = 110*Math.pow(1 - s, 1.6) + 9, C = 2*Math.sqrt(K)*0.45;
        Vl.addScaledVector(_au.subVectors(_at, P), K*h).multiplyScalar(Math.max(0, 1 - C*h));
        P.addScaledVector(Vl, h);
        const prev = A.P[k-1]; _au.subVectors(P, prev); const d = _au.length() || 1e-6;   // 保持每节长度
        P.copy(prev).addScaledVector(_au, ds/d);
      }
      // 沿长度积分曲率：卷曲（越往尖越卷）+ 往上游的行波；另一个方向是左右摆的行波
      const k1 = 0.1 + 1.7*curl*Math.pow(s, 2) + 1.4*Math.sin(t*1.6 + A.ph - s*5.5)*(0.35 + s) + 0.6*Math.sin(t*3.1 + A.ph*2 - s*9)*s;
      const k2 = 1.1*Math.sin(t*1.1 + A.ph*1.7 - s*4)*(0.3 + s) + 0.4*Math.sin(t*2.4 + A.ph - s*8)*s;
      _ax2.crossVectors(_ad, _ab).normalize();                      // 第二根弯曲轴
      _aqr.setFromAxisAngle(_ab, k1*ds); _ad.applyQuaternion(_aqr); _ax2.applyQuaternion(_aqr);
      _aqr.setFromAxisAngle(_ax2, k2*ds); _ad.applyQuaternion(_aqr); _ab.applyQuaternion(_aqr);
      _ap.addScaledVector(_ad, ds);
    }
    A.init = true;
    // 画：沿模拟出来的实际位置平行移动标架，扫出一整根软管，吸盘贴在同一侧
    _pn.copy(A.N0); let r = 0;
    for(let k=0;k<ASEG;k++){
      const s = k/(ASEG-1), P = A.P[k];
      _at.subVectors(A.P[Math.min(ASEG-1, k+1)], A.P[Math.max(0, k-1)]).normalize();
      _pn.addScaledVector(_at, -_pn.dot(_at)).normalize();
      _pb.crossVectors(_pn, _at);
      r = (0.04 + 0.05*Math.pow(1-s, 1.4))*(1-0.25*s*s);
      tubeRing(A.tube, k, P, _pb, _pn, _at, r, r);
      if(k%4===1 && s>0.2 && si < NIDLE*8){
        _aq.setFromUnitVectors(_Z, _pn);
        armSuck.setMatrixAt(si++, _aM.compose(_aS2.copy(P).addScaledVector(_pn, r*0.85), _aq, _aS.set(r*0.36, r*0.36, r*0.24)));
      }
    }
    tubeEnd(A.tube, A.P[ASEG-1], _pb, _pn, _at, r, r);
  }
  for(;si<NIDLE*8;si++) armSuck.setMatrixAt(si, _aM.makeScale(0,0,0));
  armSuck.instanceMatrix.needsUpdate = true;
}

// ---------- 架子鼓 ----------
// 星空鼓壳：深靛蓝渐变，一道淡淡的银河，撒满像素小星和几颗黄色四角星，像亮片漆。
// 每面鼓按自己的周长和深度缩放贴图坐标，大鼓小鼓上的星星密度一样
let _sr = 7; const srand = ()=>((_sr = (_sr*16807) % 2147483647) - 1)/2147483646;
const starShellTex = pixTex(128, 32, (g, w, h)=>{
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3d42a8'); gr.addColorStop(1, '#282a74'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for(let x=0;x<w;x++){ const yc = h*0.5 + Math.sin(x/w*Math.PI*2)*h*0.22; for(let y=0;y<h;y++){ const dd = Math.abs(y - yc); if(dd < 6 && srand() < 0.5*(1 - dd/6)){ g.fillStyle = 'rgba(176,164,255,0.45)'; g.fillRect(x, y, 1, 1); } } }
  for(let i=0;i<90;i++){ g.fillStyle = srand() < 0.7 ? '#ffffff' : '#fff1a6'; g.fillRect(Math.floor(srand()*w), Math.floor(srand()*h), 1, 1); }
  for(let i=0;i<9;i++){ const x = 2 + Math.floor(srand()*(w - 4)), y = 2 + Math.floor(srand()*(h - 4)); g.fillStyle = '#ffd84a'; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1); }
});
starShellTex.wrapS = starShellTex.wrapT = THREE.RepeatWrapping;
const shellMat = toon(0xffffff, {side:THREE.DoubleSide, map:starShellTex}), shellInMat = toon(0xc08a5a, {side:THREE.DoubleSide});
const hoopMat = metalMat({base:0xe2ad3e, hi:0xfff6d2, lo:0x6f4e17});            // 鼓圈和螺丝：抛光金

// ---------- 星空披肩（代替原来的蓝围巾） ----------
// 深靛蓝星空料子，和鼓壳同一路；小丑式尖角下摆镶一道金边，每个尖上挂一颗小金铃；领口一圈金边，正面一颗紫宝石扣；背后用金线绣北斗七星。
// 布在世界空间里模拟：领口一圈钉在身上，其余各点有惯性和重力，再被弹簧拉回设计好的形状；碰到头和触手根会被推开
// 加长版：搭过肩以后往下垂成六片 V 形长襟，正前方两片中间开口，每个尖上挂一个金流苏
const CAPE_NC = 48, CAPE_NR = 10, CAPE_NP = 6, CAPE_YC = RING_Y + 0.17, CAPE_RC = 0.255, CAPE_RH = 0.48, CAPE_L = 0.42;
const capeTri = i => { const f = (i/CAPE_NC*CAPE_NP) % 1; return 1 - Math.abs(f*2 - 1); };   // 两个尖之间是 0，尖上是 1；正前方是凹口
const capeTex = pixTex(256, 96, (g, w, h)=>{
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#272a78'); gr.addColorStop(1, '#3d42a8');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(176,164,255,0.3)';                                    // 一道淡淡的银河
  for(let x=0; x<w; x++){ const y = Math.round(h*0.64 + 5*Math.sin(x/w*Math.PI*6)); g.fillRect(x, y - 2, 1, 4); }
  let r = 9; const rnd = ()=>((r = (r*16807) % 2147483647) - 1)/2147483646;
  for(let i=0; i<170; i++){ g.fillStyle = rnd() < 0.75 ? '#ffffff' : '#fff1a6'; g.fillRect(Math.floor(rnd()*w), Math.floor(rnd()*h), 1, 1); }
  for(let i=0; i<14; i++){                                                // 散落的金色四芒星，越往下摆越大
    const x = 3 + Math.floor(rnd()*(w - 6)), y = Math.floor(h*0.42 + rnd()*h*0.5), a = y > h*0.7 ? 3 : 2;
    if(Math.abs(x - w*0.5) < w*0.16 && y < h*0.45) continue;
    g.fillStyle = '#e9b949'; g.fillRect(x - a, y, 2*a + 1, 1); g.fillRect(x, y - a - 1, 1, 2*a + 3); g.fillStyle = '#fff4c8'; g.fillRect(x, y, 1, 1);
  }
  // 北斗七星：斗口四颗 + 斗柄三颗，绣在背后正中（u = 0.5）
  const D = [[0, 0.04], [0.03, 0.6], [0.3, 0.72], [0.34, 0.22], [0.55, 0.12], [0.76, 0.2], [1, 0.52]];
  const S = D.map(([x, y])=>[Math.round(w*0.37 + x*w*0.26), Math.round(h*0.05 + y*h*0.34)]);
  const seg = (a, b)=>{ const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) || 1; for(let k=0; k<=n; k++) g.fillRect(Math.round(a[0] + (b[0] - a[0])*k/n), Math.round(a[1] + (b[1] - a[1])*k/n), 1, 1); };
  g.fillStyle = 'rgba(255,214,90,0.6)';
  [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]].forEach(([a, b])=>seg(S[a], S[b]));
  for(const [x, y] of S){
    g.fillStyle = '#ffd23a'; g.fillRect(x - 3, y, 7, 1); g.fillRect(x, y - 3, 1, 7); g.fillRect(x - 1, y - 1, 3, 3);
    g.fillStyle = '#fff8d0'; g.fillRect(x, y, 1, 1);
  }
});
const capeMat = toon(0xffffff, {map:capeTex}), capeLining = toon(0x4b2378, {side:THREE.BackSide}), capeGold = toon(0xf0bf48, {side:THREE.DoubleSide});
const CAPE = {R0:[], P:[], Q:[], T:[], init:false}, CAPE_N = CAPE_NC*(CAPE_NR + 1);
for(let j=0; j<=CAPE_NR; j++){
  const sj = j/CAPE_NR;
  for(let i=0; i<CAPE_NC; i++){
    const th = 2*Math.PI*i/CAPE_NC, tri = capeTri(i);
    const sh = Math.min(1, sj*1.7);
    const r = CAPE_RC + (CAPE_RH - CAPE_RC)*(1 - (1 - sh)**2)*(1 + 0.12*tri*sj*sj);   // 先往外搭在“肩”上，过了肩就差不多直直往下垂
    const y = CAPE_YC - CAPE_L*(0.38 + 1.3*tri)*Math.pow(sj, 1.15);                 // 两片之间的开口只到肩下，尖角一直垂下去：一片片 V 形长襟
    CAPE.R0.push(new V3(Math.cos(th)*r, y, Math.sin(th)*r)); CAPE.P.push(new V3()); CAPE.Q.push(new V3()); CAPE.T.push(new V3());
  }
}
const cIdx = (j, i) => j*CAPE_NC + ((i % CAPE_NC) + CAPE_NC) % CAPE_NC;
const CAPE_LV = CAPE.R0.map((p, k)=>k < CAPE_NC ? 0 : p.distanceTo(CAPE.R0[k - CAPE_NC]));
const CAPE_LH = CAPE.R0.map((p, k)=>p.distanceTo(CAPE.R0[cIdx(Math.floor(k/CAPE_NC), k % CAPE_NC + 1)]));
const capeGeo = new THREE.BufferGeometry();          // 多一列和第一列重合，贴图才能绕一圈接上
{
  const NV = (CAPE_NR + 1)*(CAPE_NC + 1), uv = new Float32Array(NV*2), idx = [];
  for(let j=0; j<=CAPE_NR; j++) for(let i=0; i<=CAPE_NC; i++){ const v = j*(CAPE_NC + 1) + i; uv[v*2] = i/CAPE_NC; uv[v*2 + 1] = 1 - j/CAPE_NR; }
  for(let j=0; j<CAPE_NR; j++) for(let i=0; i<CAPE_NC; i++){ const a = j*(CAPE_NC + 1) + i, b = a + 1, c = a + CAPE_NC + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  capeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NV*3), 3));
  capeGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); capeGeo.setIndex(idx);
}
const capeOut = new THREE.Mesh(capeGeo, capeMat), capeIn = new THREE.Mesh(capeGeo, capeLining);
for(const m of [capeOut, capeIn]){ m.frustumCulled = false; scene.add(m); }
const trimGeo = new THREE.BufferGeometry();          // 下摆金边：沿下摆一条窄带，贴在布外面一点点
{
  const idx = []; for(let i=0; i<CAPE_NC; i++){ const a = 2*i; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  trimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2*(CAPE_NC + 1)*3), 3)); trimGeo.setIndex(idx);
}
const capeTrim = new THREE.Mesh(trimGeo, capeGold); capeTrim.frustumCulled = false; scene.add(capeTrim);
const CAPE_PEAKS = Array.from({length:CAPE_NP}, (_, k)=>Math.round((k + 0.5)*CAPE_NC/CAPE_NP));
const bellGeo = new THREE.SphereGeometry(0.022, 8, 6), tasselGeo = new THREE.ConeGeometry(0.032, 0.085, 7, 1, true);   // 流苏：金结 + 往下散开的穗子
tasselGeo.translate(0, -0.06, 0);
const capeBells = CAPE_PEAKS.map(()=>{ const m = new THREE.Mesh(bellGeo, hoopMat); m.add(new THREE.Mesh(tasselGeo, capeGold)); scene.add(m); return m; });
const capeClasp = new THREE.Group(); capeClasp.scale.setScalar(1.3); scene.add(capeClasp);   // 宝石扣钉在披肩正前方第二圈上，跟着布一起动
{ // 领口金边跟着身体
  const collar = new THREE.Mesh(new THREE.TorusGeometry(CAPE_RC + 0.004, 0.024, 6, 36), hoopMat);
  collar.rotation.x = Math.PI/2; collar.position.y = CAPE_YC + 0.004; body.add(collar);
  // 小高领：从领口立起一圈星空料子，越往上越往外翻（像喇叭口，翻出去的上沿离开眼睛），正前方留开口；
  // 开口两边的上角削成圆弧，不留尖角；金边从一边开口底下沿圆角绕上沿一整圈再下到另一边
  const HG = 0.4, HC = 0.15, HR0 = CAPE_RC + 0.012, HR1 = CAPE_RC + 0.17, HN = 40, HV = 4, hv = [], huv = [];
  const hPt = (i, v, out = 0)=>{
    const g = HG*(1 + 0.25*v), a = g + (2*Math.PI - 2*g)*i/HN, da = Math.min(a - g, 2*Math.PI - g - a);
    const hf = 0.45 + 0.55*Math.sin(Math.min(1, da/0.45)*Math.PI/2);                   // 开口处矮一些，圆圆地升上去
    const r = HR0 + (HR1 - HR0)*Math.pow(v, 1.6) + out;
    return [Math.cos(a)*r, CAPE_YC + HC*v*hf, Math.sin(a)*r];
  };
  for(let j=0; j<=HV; j++) for(let i=0; i<=HN; i++){ const v = j/HV; hv.push(...hPt(i, v)); huv.push(i/HN, 0.62 + 0.22*v); }
  const hix = [];
  for(let j=0; j<HV; j++) for(let i=0; i<HN; i++){ const a = j*(HN + 1) + i, b = a + 1, c = a + HN + 1, d = c + 1; hix.push(a, c, b, b, c, d); }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hv, 3)); hg.setAttribute('uv', new THREE.Float32BufferAttribute(huv, 2)); hg.setIndex(hix); hg.computeVertexNormals();
  body.add(new THREE.Mesh(hg, toon(0xffffff, {map:capeTex, side:THREE.FrontSide})), new THREE.Mesh(hg, capeLining));
  const rim = [];
  for(let j=0; j<HV; j++) rim.push(hPt(0, j/HV, 0.004));
  for(let i=0; i<=HN; i++) rim.push(hPt(i, 1, 0.004));
  for(let j=HV - 1; j>=0; j--) rim.push(hPt(HN, j/HV, 0.004));
  const rc = new THREE.CatmullRomCurve3(rim.map(p=>new V3(...p)));
  body.add(new THREE.Mesh(new THREE.TubeGeometry(rc, 160, 0.011, 5, false), hoopMat));
  capeClasp.add(new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.016, 4, 4), hoopMat));                 // 菱形金托
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.058, 0), toon(0x9a63f2)); gem.scale.set(0.82, 1, 0.5); capeClasp.add(gem);   // 八面体自带分面法线，本来就是切面宝石；卡通材质不认 flatShading，写了只会在控制台报警告
}
const HEAD_PROF = [[RING_Y - 0.06, 0.19], [RING_Y + 0.1, 0.2], [-0.28, 0.215], [-0.16, 0.255], [-0.06, 0.29], [0.02, 0.31]];
function capeRmin(y){                                // 头在这个高度的半径，再留一点布的厚度；头以下不管
  if(y < HEAD_PROF[0][0] || y > HEAD_PROF[HEAD_PROF.length - 1][0]) return 0;
  for(let i=1; i<HEAD_PROF.length; i++) if(y <= HEAD_PROF[i][0]){ const [y0, r0] = HEAD_PROF[i-1], [y1, r1] = HEAD_PROF[i]; return r0 + (r1 - r0)*(y - y0)/(y1 - y0) + 0.045; }
  return 0;
}
const CAPE_SPH = Array.from({length:240}, ()=>({c:new V3(), r:0}));
function capeSpheres(){                              // 触手根部和待机的腕：一串小球，布碰到就让开
  let n = 0;
  for(const L of limbs) for(let k=0; k<L.NS && L.sampF[k]*L.LV < 0.75 && n < 230; k++){ const pr = profile(L, L.sampF[k]), S = CAPE_SPH[n++]; S.c.copy(L.pts[k]); S.r = pr.r*Math.max(pr.w, pr.t) + 0.035; }
  for(const A of armDefs) for(let k=0; k<14 && n < 238; k++){ const S = CAPE_SPH[n++]; S.c.copy(A.P[k]); S.r = 0.09 - 0.035*k/14; }
  return n;
}
const _cv = new V3(), _cl2 = new V3(), _cInv = new THREE.Matrix4();
function updateCape(dt, t){
  const P = CAPE.P, Q = CAPE.Q, T = CAPE.T, h = Math.min(dt, 1/30), M = body.matrixWorld;
  _cInv.copy(M).invert();
  for(let k=0; k<CAPE_N; k++) T[k].copy(CAPE.R0[k]).applyMatrix4(M);
  if(!CAPE.init){ for(let k=0; k<CAPE_N; k++){ P[k].copy(T[k]); Q[k].copy(T[k]); } CAPE.init = true; }
  const ks = 1 - Math.exp(-dt*7), damp = Math.pow(0.9, h*60);
  for(let k=0; k<CAPE_N; k++){
    if(k < CAPE_NC){ P[k].copy(T[k]); Q[k].copy(T[k]); continue; }
    const sj = Math.floor(k/CAPE_NC)/CAPE_NR, i = k % CAPE_NC;
    _cv.subVectors(P[k], Q[k]).multiplyScalar(damp); Q[k].copy(P[k]); P[k].add(_cv);
    P[k].y -= (2.2 + 0.25*Math.sin(t*2.3 + i*0.7))*h*h;                     // 重力，带一点点飘
    P[k].lerp(T[k], ks*(1.15 - 0.6*sj));                                     // 拉回原来的形状：越靠领口越硬
  }
  const ns = capeSpheres();
  for(let it=0; it<3; it++){
    for(let k=CAPE_NC; k<CAPE_N; k++){                                       // 竖向保持长度
      const a = P[k - CAPE_NC], b = P[k]; _cv.subVectors(b, a); const d = _cv.length() || 1e-6, c = (d - CAPE_LV[k])/d;
      if(k < 2*CAPE_NC) b.addScaledVector(_cv, -c); else { a.addScaledVector(_cv, 0.5*c); b.addScaledVector(_cv, -0.5*c); }
    }
    for(let k=CAPE_NC; k<CAPE_N; k++){                                       // 横向保持一圈的长度
      const a = P[k], b = P[cIdx(Math.floor(k/CAPE_NC), k % CAPE_NC + 1)]; _cv.subVectors(b, a); const d = _cv.length() || 1e-6, c = 0.5*(d - CAPE_LH[k])/d;
      a.addScaledVector(_cv, c); b.addScaledVector(_cv, -c);
    }
    for(let k=CAPE_NC; k<CAPE_N; k++){                                       // 不穿进触手根和头
      const p = P[k];
      for(let q=0; q<ns; q++){
        const S = CAPE_SPH[q], dx = p.x - S.c.x, dy = p.y - S.c.y, dz = p.z - S.c.z, d2 = dx*dx + dy*dy + dz*dz;
        if(d2 < S.r*S.r){ const f = S.r/(Math.sqrt(d2) || 1e-6); p.set(S.c.x + dx*f, S.c.y + dy*f, S.c.z + dz*f); }
      }
      _cl2.copy(p).applyMatrix4(_cInv);
      const rm = capeRmin(_cl2.y), rr = Math.hypot(_cl2.x, _cl2.z);
      if(rm > 0 && rr < rm){ const f = rm/Math.max(rr, 1e-4); _cl2.x *= f; _cl2.z *= f; p.copy(_cl2).applyMatrix4(M); }
    }
  }
  const pa = capeGeo.attributes.position.array, W = CAPE_NC + 1;
  for(let j=0; j<=CAPE_NR; j++) for(let i=0; i<=CAPE_NC; i++){ const p = P[cIdx(j, i)], v = (j*W + i)*3; pa[v] = p.x; pa[v + 1] = p.y; pa[v + 2] = p.z; }
  capeGeo.attributes.position.needsUpdate = true; capeGeo.computeVertexNormals();
  const na = capeGeo.attributes.normal.array;
  for(let j=0; j<=CAPE_NR; j++){                                             // 接缝两列法线取平均
    const a = j*W*3, b = (j*W + CAPE_NC)*3; let x = na[a] + na[b], y = na[a + 1] + na[b + 1], z = na[a + 2] + na[b + 2]; const l = Math.hypot(x, y, z) || 1;
    na[a] = na[b] = x/l; na[a + 1] = na[b + 1] = y/l; na[a + 2] = na[b + 2] = z/l;
  }
  const ta = trimGeo.attributes.position.array;
  for(let i=0; i<=CAPE_NC; i++){
    const p = P[cIdx(CAPE_NR, i)], p2 = P[cIdx(CAPE_NR - 1, i)], v = (CAPE_NR*W + i)*3, o = 0.008;
    const nx = na[v]*o, ny = na[v + 1]*o, nz = na[v + 2]*o;
    ta[i*6] = p.x + (p2.x - p.x)*0.42 + nx; ta[i*6 + 1] = p.y + (p2.y - p.y)*0.42 + ny; ta[i*6 + 2] = p.z + (p2.z - p.z)*0.42 + nz;
    ta[i*6 + 3] = p.x + nx; ta[i*6 + 4] = p.y + ny - 0.004; ta[i*6 + 5] = p.z + nz;
  }
  trimGeo.attributes.position.needsUpdate = true; trimGeo.computeVertexNormals();
  CAPE_PEAKS.forEach((i, k)=>{ const p = P[cIdx(CAPE_NR, i)]; capeBells[k].position.set(p.x, p.y - 0.02, p.z); });
  { const v = 2*W*3, p = P[cIdx(2, 0)]; _cv.set(na[v], na[v + 1], na[v + 2]);
    capeClasp.position.copy(p).addScaledVector(_cv, 0.024); capeClasp.quaternion.setFromUnitVectors(_Zf0, _cv); }
}
const standMat = metalMat({base:0xa7abbd, hi:0xffffff, lo:0x37324a});           // 支架：镀铬
const cymMat = metalMat({base:0xd59f38, hi:0xfff0b4, lo:0x6a4615, aniso:true, grooves:16, side:THREE.DoubleSide});   // 镲：青铜车纹
const clickables = [], drums = [], cymbals = [], INST = {};
function rod(a, b, r){
  const d = new V3().subVectors(b, a), L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 6), standMat);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UPV, d.normalize());
  scene.add(m); return m;
}
const MN = 27, C2 = 0.42;
function makeDrum(o){
  const d = Object.assign({}, o, {y0:0, isDrum:true});
  const g = new THREE.Group(); scene.add(g); d.g = g;
  d.center = new V3(...o.pos); d.n = new V3(...o.normal).normalize();
  g.position.copy(d.center); g.quaternion.setFromUnitVectors(UPV, d.n);
  const R = o.R, D = o.depth;
  const shellGeo = new THREE.CylinderGeometry(R*1.02, R*1.02, D, 28, 1, true), suv = shellGeo.attributes.uv;
  for(let i=0;i<suv.count;i++) suv.setXY(i, suv.getX(i)*2*Math.PI*R*1.02/2.8, suv.getY(i)*D/0.64);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.y = -D/2; g.add(shell);
  shell.userData.inst = d; shell.userData.body = true; clickables.push(shell);
  for(const y of [0.01, -D+0.01]){
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(R*1.03, 0.032, 6, 32), hoopMat);
    hoop.rotation.x = Math.PI/2; hoop.position.y = y; g.add(hoop);
  }
  for(let i=0;i<6;i++){
    const a = i/6*Math.PI*2 + 0.3;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.05, D*0.36, 0.05), hoopMat);
    lug.position.set(Math.cos(a)*R*1.07, -D/2, Math.sin(a)*R*1.07); g.add(lug);
  }
  const under = new THREE.Mesh(new THREE.CircleGeometry(R, 32), toon(0xe6d8ba));
  under.rotation.x = -Math.PI/2; under.position.y = -0.01; g.add(under);
  // 鼓腔有壁厚：木色内壁 + 下沿一圈木口；嗵鼓和军鼓补上底鼓皮
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(R*0.955, R*0.955, D, 28, 1, true), shellInMat); inner.position.y = -D/2; g.add(inner);
  const lip = new THREE.Mesh(new THREE.RingGeometry(R*0.955, R*1.02, 28), shellInMat); lip.rotation.x = Math.PI/2; lip.position.y = -D; g.add(lip);
  if(o.kind !== 'kick'){ const bot = new THREE.Mesh(new THREE.CircleGeometry(R*0.955, 32), toon(0xe9dcc0)); bot.rotation.x = Math.PI/2; bot.position.y = -D + 0.02; g.add(bot); }
  if(o.kind === 'kick'){
    const front = new THREE.Mesh(new THREE.CircleGeometry(R, 32), toon(0xf6ead2));
    front.rotation.x = Math.PI/2; front.position.y = -D; g.add(front);
    front.userData.inst = d; front.userData.body = true; clickables.push(front);
    const logo = new THREE.Mesh(new THREE.TorusGeometry(R*0.62, 0.022, 4, 32), toon(0xffd23a));   // 前鼓皮：一圈细金线 + 一颗黄色四芒星
    logo.rotation.x = Math.PI/2; logo.position.y = -D-0.01; g.add(logo);
    const st = new THREE.Mesh(STAR_GEO, starMat); st.scale.set(R*0.42, R*0.42, R*0.12); st.rotation.x = Math.PI/2; st.position.y = -D - 0.012; g.add(st);
  }
  // 鼓皮：圆形弹簧网格（有限差分波动方程），网格也直接当显示用的几何体
  const N = MN, dx = 2*R/(N-1);
  Object.assign(d, {N, dx, u:new Float32Array(N*N), uPrev:new Float32Array(N*N), uNext:new Float32Array(N*N), mask:new Uint8Array(N*N), gam:new Float32Array(N*N),
    headPos:new Float32Array(N*N*3), headCol:new Float32Array(N*N*3), rings:[], shake:0});
  const idx = [];
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const k=j*N+i, x=-R+i*dx, z=-R+j*dx, rr = Math.hypot(x,z)/R;
    d.mask[k] = rr <= 0.985 ? 1 : 0;
    d.headPos[k*3]=x; d.headPos[k*3+1]=0; d.headPos[k*3+2]=z;
    const e = Math.min(1, Math.max(0, (rr-0.62)/0.36));
    d.gam[k] = 0.018 + 0.32*e*e;      // 鼓圈附近一圈吸收带，波到边缘基本消失
  }
  for(let j=0;j<N-1;j++) for(let i=0;i<N-1;i++){
    const a=j*N+i, b=a+1, c=a+N, e=c+1;
    if(d.mask[a]&&d.mask[b]&&d.mask[c]) idx.push(a,c,b);
    if(d.mask[b]&&d.mask[c]&&d.mask[e]) idx.push(b,c,e);
  }
  d.headGeo = new THREE.BufferGeometry();
  d.headGeo.setAttribute('position', new THREE.BufferAttribute(d.headPos,3));
  d.headGeo.setAttribute('color', new THREE.BufferAttribute(d.headCol,3));
  d.headGeo.setIndex(idx);
  const head = new THREE.Mesh(d.headGeo, toon(0xffffff, {vertexColors:true})); g.add(head);
  head.userData.inst = d; under.userData.inst = d; clickables.push(head, under);
  g.updateMatrixWorld(true);
  drums.push(d); INST[o.key] = d; return d;
}
function stepMembrane(d){
  const {N, u, uPrev, uNext, mask, gam} = d;
  for(let j=1;j<N-1;j++) for(let i=1;i<N-1;i++){
    const k=j*N+i; if(!mask[k]){uNext[k]=0;continue;}
    const g = gam[k];
    uNext[k] = (2-g)*u[k] - (1-g)*uPrev[k] + C2*(u[k-1]+u[k+1]+u[k-N]+u[k+N]-4*u[k]);
  }
  uPrev.set(u); u.set(uNext);
}
function strikeMembrane(d, x, z, amp){
  const {N, dx, R, u, mask} = d, s2 = 2*(0.11*R)**2;
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const k=j*N+i; if(!mask[k]) continue;
    const px=-R+i*dx-x, pz=-R+j*dx-z;
    u[k] -= amp*Math.exp(-(px*px+pz*pz)/s2);
  }
}
function updateHead(d){
  const {N, u, uPrev, mask, headPos, headCol, R} = d, lim = 0.2*R, cs = 28/R;
  for(let k=0;k<N*N;k++){
    headPos[k*3+1] = mask[k] ? Math.max(-lim, Math.min(lim, u[k])) : 0;
    const v = Math.min(1, Math.abs(u[k]-uPrev[k])*cs);
    headCol[k*3] = 0.80 - 0.30*v; headCol[k*3+1] = 0.74 + 0.10*v; headCol[k*3+2] = 0.62 + 0.30*v;
  }
  d.headGeo.attributes.position.needsUpdate = true;
  d.headGeo.attributes.color.needsUpdate = true;
  d.headGeo.computeVertexNormals();
}
// 涟漪圈：1px 线圈，按波速扩张，越过鼓圈的部分不画，整圈出界就消失
const ringMat = new THREE.LineBasicMaterial({color:0x9fe8ff, transparent:true, depthWrite:false});
function addRing(d, x, z){
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96*3),3));
  const line = new THREE.LineSegments(g, ringMat.clone()); d.g.add(line);
  d.rings.push({line, x, z, t:0, reach: d.R + Math.hypot(x,z)});
  if(d.rings.length>3){ const old=d.rings.shift(); d.g.remove(old.line); }
}
function updateRings(d, dt){
  for(let n=d.rings.length-1;n>=0;n--){
    const r = d.rings[n]; r.t += dt;
    const rad = 0.03 + r.t*3.2*d.R;
    if(rad >= r.reach){ d.g.remove(r.line); d.rings.splice(n,1); continue; }
    const p = r.line.geometry.attributes.position.array, lim = d.R*0.97;
    for(let i=0;i<48;i++){
      const a0=i/48*Math.PI*2, a1=(i+1)/48*Math.PI*2;
      const x0=r.x+Math.cos(a0)*rad, z0=r.z+Math.sin(a0)*rad, x1=r.x+Math.cos(a1)*rad, z1=r.z+Math.sin(a1)*rad;
      const inside = Math.hypot(x0,z0)<lim && Math.hypot(x1,z1)<lim, o=i*6;
      p[o]=x0; p[o+1]=0.02; p[o+2]=z0;
      if(inside){ p[o+3]=x1; p[o+4]=0.02; p[o+5]=z1; } else { p[o+3]=x0; p[o+4]=0.02; p[o+5]=z0; }
    }
    r.line.geometry.attributes.position.needsUpdate = true;
    r.line.material.opacity = 1 - 0.6*rad/r.reach;
  }
}
function makeCymbal(o){
  const c = Object.assign({}, o, {y0:0.012, isDrum:false, wobT:10, wobAmp:0, wobAxis:new V3(1,0,0)});
  const g = new THREE.Group(); scene.add(g); c.g = g;
  c.center = new V3(...o.pos); c.n = new V3(...o.normal).normalize();
  g.position.copy(c.center); g.quaternion.setFromUnitVectors(UPV, c.n);
  c.wob = new THREE.Group(); g.add(c.wob);
  const R = o.R;
  const geo = new THREE.LatheGeometry([[0.0,0.055],[R*0.12,0.05],[R*0.2,0.022],[R*0.55,0.008],[R,0],[R*1.005,-0.008],[R*0.99,-0.016],[R*0.55,-0.008],[R*0.2,0.006],[R*0.12,0.034],[0.0,0.039]].map(([r,y])=>new THREE.Vector2(r,y)), 28);   // 上下两面封口，镲边有厚度
  const disc = new THREE.Mesh(geo, cymMat); c.wob.add(disc);
  disc.userData.inst = c; clickables.push(disc);
  if(o.kind === 'hihat'){ const lower = new THREE.Mesh(geo, cymMat); lower.scale.y = -1; lower.position.y = -0.035; g.add(lower); }
  g.updateMatrixWorld(true);
  cymbals.push(c); INST[o.key] = c; return c;
}

// 鼓组摆放：鱿鱼在后方正中，脸朝 +z；它的左手边是 +x
makeDrum({key:'kick',  label:'底鼓',   kind:'kick',  pos:[0,-0.46,-0.05],  normal:[0,0,-1],        R:0.46, depth:0.55, f0:52,  tau:0.5,  gain:1.3});
makeDrum({key:'snare', label:'军鼓',   kind:'snare', pos:[0.72,0.08,-0.3],  normal:[-0.1,1,-0.15],  R:0.34, depth:0.26, f0:185, tau:0.32, gain:0.85});
makeDrum({key:'tom1',  label:'高嗵',   kind:'tom',   pos:[0.31,0.62,0.3],  normal:[-0.12,1,-0.5],  R:0.27, depth:0.3,  f0:172, tau:0.55, gain:0.9});
makeDrum({key:'tom2',  label:'中嗵',   kind:'tom',   pos:[-0.33,0.62,0.3], normal:[0.12,1,-0.5],   R:0.3,  depth:0.32, f0:138, tau:0.6,  gain:0.95});
makeDrum({key:'floor', label:'落地嗵', kind:'tom',   pos:[-0.85,-0.02,-0.35], normal:[0,1,0],      R:0.4,  depth:0.62, f0:98,  tau:0.75, gain:1.0});
makeCymbal({key:'hihat', label:'踩镲', kind:'hihat', pos:[1.12,0.3,-0.55], normal:[0,1,0],         R:0.3});
makeCymbal({key:'crash', label:'吊镲', kind:'crash', pos:[0.95,1.2,0.15],  normal:[-0.25,1,-0.35], R:0.42});
// 支架：军鼓架、踩镲架、吊镲架都是三脚架（三条腿 + 斜撑 + 橡胶脚垫），落地嗵三条腿、底鼓两只支脚也加脚垫
const footMat = toon(0x2a2433);
function rubberFoot(p){ const ft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.04, 8), footMat); ft.position.set(p.x, FLOOR_Y + 0.02, p.z); scene.add(ft); }
function tripod(x, z, top, spread, a0, hCol){
  const base = new V3(x, FLOOR_Y + hCol, z), low = new V3(x, FLOOR_Y + 0.1, z);
  rod(low, top, 0.022);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.06, 8), standMat); collar.position.copy(base); scene.add(collar);
  const collar2 = collar.clone(); collar2.position.copy(low); scene.add(collar2);
  for(let i=0;i<3;i++){
    const a = a0 + i*2*Math.PI/3, foot = new V3(x + Math.cos(a)*spread, FLOOR_Y + 0.03, z + Math.sin(a)*spread);
    rod(base, foot, 0.016);
    rod(low, base.clone().lerp(foot, 0.6), 0.011);          // 斜撑
    rubberFoot(foot);
  }
}
{
  const F = (x,z)=>new V3(x, FLOOR_Y, z);
  const sn = INST.snare;
  // 军鼓架：三脚架 + 顶上三爪托架托住鼓底
  const snTop = new V3(0.72, 0.08 - sn.depth - 0.06, -0.3);
  tripod(0.72, -0.3, snTop, 0.3, -0.35, 0.3);
  for(let i=0;i<3;i++){
    const a = -0.35 + i*2*Math.PI/3, rim = sn.g.localToWorld(new V3(Math.cos(a)*sn.R*0.85, -sn.depth - 0.02, Math.sin(a)*sn.R*0.85));
    rod(snTop, rim, 0.012);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), footMat); pad.position.copy(rim); scene.add(pad);
  }
  // 踩镲架：三脚架 + 朝鱿鱼一侧的踏板
  tripod(1.12, -0.55, new V3(1.12, 0.26, -0.55), 0.34, 0.2, 0.28);
  {
    const dir = new V3(-0.9, 0, -0.45).normalize(), ped = new THREE.Group(); ped.position.set(1.12 + dir.x*0.28, FLOOR_Y + 0.04, -0.55 + dir.z*0.28);
    ped.rotation.y = Math.atan2(dir.x, dir.z); scene.add(ped);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.3), standMat); board.rotation.x = -0.18; board.position.y = 0.03; ped.add(board);
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.08), footMat); heel.position.set(0, 0.0, 0.17); ped.add(heel);
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.06, 0.015), footMat); chain.position.set(0, 0.06, -0.15); ped.add(chain);
  }
  // 吊镲架：三脚架 + 立管上的横臂 + 横臂尾端配重
  const cr = INST.crash, cTop = new V3(1.22, 0.92, 0.02), tilt = cr.center.clone().addScaledVector(cr.n, -0.07);
  tripod(1.22, 0.02, cTop, 0.38, 0.55, 0.32);
  rod(cTop, tilt, 0.017);
  const back = cTop.clone().addScaledVector(tilt.clone().sub(cTop).normalize(), -0.14);
  rod(cTop, back, 0.017);
  const cw = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), standMat); cw.position.copy(back); scene.add(cw);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), footMat); knob.position.copy(cTop); scene.add(knob);
  // 落地嗵三条腿、嗵鼓支架、底鼓支脚
  for(let i=0;i<3;i++){ const a = i/3*Math.PI*2 + 0.5, f = F(-0.85+Math.cos(a)*0.5, -0.35+Math.sin(a)*0.5); rod(f, new V3(-0.85+Math.cos(a)*0.43, -0.25, -0.35+Math.sin(a)*0.43), 0.02); rubberFoot(f); }
  for(const t of [INST.tom1, INST.tom2]){ const b = t.center.clone().addScaledVector(t.n, -t.depth); rod(new V3(b.x*0.5, 0.1, 0.22), b, 0.022); }
  for(const sg of [-1,1]){ const f = F(sg*0.38, -0.25); rod(f, new V3(sg*0.34, -0.68, -0.05), 0.02); rubberFoot(f); }
}

// ---------- 复古音箱组：鱿鱼身后左右各一套（箱头 + 一只 4×12 + 下面一只单喇叭大低音箱），标志是原创的 ----------
const tolexMat = toon(0x2a2433), pipeMat = toon(0xf1e6d0), goldPanelMat = metalMat({base:0xd9ae4f, hi:0xfff3c4, lo:0x7a5a1e});
const knobMat = toon(0x1d1826), domeMat = toon(0x7a6c5a), surroundMat = toon(0x3a3245);
function pixTex(w, h, draw){
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t;
}
const grilleTex = pixTex(32, 32, (g, w, h)=>{          // 编织纹网布
  g.fillStyle = '#5e5446'; g.fillRect(0, 0, w, h);
  for(let y=0;y<h;y+=4) for(let x=0;x<w;x+=4){ const v = ((x + y)/4)%2; g.fillStyle = v ? '#877862' : '#6c6050'; if(v) g.fillRect(x, y, 4, 2); else g.fillRect(x, y, 2, 4); }
});
grilleTex.wrapS = grilleTex.wrapT = THREE.RepeatWrapping; grilleTex.repeat.set(3, 3);
const grilleMat = new THREE.MeshToonMaterial({map:grilleTex, gradientMap:ramp});
const logoMat = new THREE.MeshBasicMaterial({map:pixTex(64, 16, (g, w, h)=>{
  g.fillStyle = '#2a2433'; g.fillRect(0, 0, w, h); g.fillStyle = '#f6ecd6';
  g.font = 'italic bold 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Calamar', w/2, h/2 + 1);
})});
function box(w, h, d, mat, x, y, z, parent){ const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }
function makeCab(parent, y0, W, Hc, D){
  box(W, Hc, D, tolexMat, 0, y0 + Hc/2, 0, parent);
  const gw = W*0.86, gh = Hc*0.8, fz = D/2 + 0.004, cy0 = y0 + Hc/2;
  box(gw, gh, 0.01, grilleMat, 0, cy0, fz, parent);
  for(const s of [-1,1]){                                   // 白色滚边
    box(gw + 0.04, 0.02, 0.02, pipeMat, 0, cy0 + s*(gh/2 + 0.01), fz + 0.004, parent);
    box(0.02, gh + 0.04, 0.02, pipeMat, s*(gw/2 + 0.01), cy0, fz + 0.004, parent);
  }
  for(const sx of [-1,1]) for(const sy of [0,1]) box(0.08, 0.08, 0.03, standMat, sx*(W/2 - 0.03), y0 + 0.03 + sy*(Hc - 0.06), D/2 + 0.012, parent);   // 金属包角
  const lg = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.075), logoMat); lg.position.set(0, cy0 + gh/2 - 0.05, fz + 0.03); parent.add(lg);
  const domes = [], rr = Math.min(gw, gh)*0.17;              // 四个喇叭：网布下的鼓包，击打时一鼓一鼓
  for(const sx of [-1,1]) for(const sy of [-1,1]){
    const cx = sx*gw*0.23, cy = cy0 + sy*gh*0.22 - 0.02;
    const sur = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.018, 4, 20), surroundMat); sur.position.set(cx, cy, fz + 0.012); parent.add(sur);
    const dm = new THREE.Mesh(new THREE.SphereGeometry(rr*0.9, 14, 6, 0, Math.PI*2, 0, Math.PI/2), domeMat);
    dm.rotation.x = Math.PI/2; dm.position.set(cx, cy, fz + 0.006); dm.scale.y = 0.18; parent.add(dm); domes.push(dm);
  }
  return domes;
}
// 低音箱：不蒙网布，露出一只大喇叭（金属框 + 橡胶折环 + 深色纸盆 + 防尘帽），纸盆整体前后推，声波圈从这里放出去
const coneMat = toon(0x2e2936, {side:THREE.DoubleSide}), baffleMat = toon(0x1f1a28), capMat = metalMat({base:0x8f93a6, hi:0xffffff, lo:0x2d2838});
function makeBassCab(parent, y0, W, Hc, D){
  box(W, Hc, D, tolexMat, 0, y0 + Hc/2, 0, parent);
  const bw = W*0.88, bh = Hc*0.86, fz = D/2 + 0.004, cy0 = y0 + Hc/2, Rw = Math.min(bw, bh)*0.4, cy = cy0 - 0.03;
  box(bw, bh, 0.01, baffleMat, 0, cy0, fz, parent);
  for(const s of [-1,1]){
    box(bw + 0.04, 0.02, 0.02, pipeMat, 0, cy0 + s*(bh/2 + 0.01), fz + 0.004, parent);
    box(0.02, bh + 0.04, 0.02, pipeMat, s*(bw/2 + 0.01), cy0, fz + 0.004, parent);
  }
  for(const sx of [-1,1]) for(const sy of [0,1]) box(0.08, 0.08, 0.03, standMat, sx*(W/2 - 0.03), y0 + 0.03 + sy*(Hc - 0.06), D/2 + 0.012, parent);
  const lg = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), logoMat); lg.position.set(-bw/2 + 0.17, cy0 + bh/2 - 0.05, fz + 0.012); parent.add(lg);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(Rw*1.05, 0.03, 6, 36), standMat); frame.position.set(0, cy, fz + 0.012); parent.add(frame);
  for(let i=0;i<8;i++){ const a = i/8*Math.PI*2 + 0.39, b = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), standMat); b.position.set(Math.cos(a)*Rw*1.05, cy + Math.sin(a)*Rw*1.05, fz + 0.04); parent.add(b); }
  const coneG = new THREE.Group(), z0 = fz + 0.02; coneG.position.set(0, cy, z0); parent.add(coneG);
  const sur = new THREE.Mesh(new THREE.TorusGeometry(Rw*0.93, 0.045, 6, 36), surroundMat); coneG.add(sur);
  const cone = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(Rw*0.9, 0), new THREE.Vector2(Rw*0.6, -0.05), new THREE.Vector2(Rw*0.32, -0.12)], 36).rotateX(Math.PI/2), coneMat); coneG.add(cone);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(Rw*0.34, 16, 8, 0, Math.PI*2, 0, Math.PI/2).rotateX(Math.PI/2), capMat); cap.scale.z = 0.5; cap.position.z = -0.12; coneG.add(cap);
  return {coneG, z0, cy, R:Rw};
}
function makeHead(parent, y0, W, Hh, D){
  box(W, Hh, D, tolexMat, 0, y0 + Hh/2, 0, parent);
  const fz = D/2 + 0.004;
  box(W*0.9, Hh*0.42, 0.01, grilleMat, 0, y0 + Hh*0.7, fz, parent);          // 上半：网布 + 标志
  const lg = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), logoMat); lg.position.set(0, y0 + Hh*0.7, fz + 0.012); parent.add(lg);
  box(W*0.9, Hh*0.3, 0.012, goldPanelMat, 0, y0 + Hh*0.27, fz, parent);     // 下半：金色面板、旋钮、指示灯
  for(let i=0;i<8;i++){
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.05, 8), knobMat);
    k.rotation.x = Math.PI/2; k.position.set(-W*0.36 + i*W*0.085, y0 + Hh*0.27, fz + 0.03); parent.add(k);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8), goldPanelMat);
    cap.rotation.x = Math.PI/2; cap.position.set(k.position.x, k.position.y, fz + 0.058); parent.add(cap);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({color:0x8a1c2c}));
  lamp.position.set(W*0.4, y0 + Hh*0.27, fz + 0.025); parent.add(lamp);
  const hd = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 4, 12, Math.PI), knobMat); hd.position.set(0, y0 + Hh, 0); parent.add(hd);
  for(const s of [-1,1]) box(0.05, 0.02, 0.06, standMat, s*0.13, y0 + Hh + 0.01, 0, parent);
  return lamp;
}
const AMPS = [], RING_GEO = new THREE.BufferGeometry();
{ const pts = []; for(let i=0;i<40;i++){ const a = i/40*Math.PI*2; pts.push(Math.cos(a), Math.sin(a), 0); } RING_GEO.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); }
const waveMat = new THREE.LineBasicMaterial({color:0xf2606e, transparent:true, depthWrite:false});
function makeStack(x, z, ry){
  const g = new THREE.Group(); g.position.set(x, FLOOR_Y, z); g.rotation.y = ry; scene.add(g);
  const sh = new THREE.Group(); g.add(sh);
  const W = 1.2, HC = 1.12, D = 0.58;
  const bass = makeBassCab(sh, 0, W, HC, D);
  const domes = makeCab(sh, HC + 0.01, W, HC, D);
  const lamp = makeHead(sh, 2*HC + 0.02, W, 0.5, 0.46);
  AMPS.push({g, sh, domes, bass, lamp, pump:0, pv:0, shake:0, glow:0, HC, D, rings:[]});
}
makeStack(2.3, -2.3, -0.38);
makeStack(-2.3, -2.3, 0.38);
// 电线：鼓圈上夹一个触发器，电线先垂到地面，在地上弯两道，再从音箱前面爬上去插进箱头的输入口；
// 两头靠近插头的地方各套一个滤波磁环
const cableMat = toon(0x231e2c), ferriteMat = toon(0x6e6880);
function addTrigger(I, hint){
  let best = 0, bd = 1e9; const v = new V3();
  for(let i=0;i<36;i++){ const a = i/36*Math.PI*2; I.g.localToWorld(v.set(Math.cos(a)*I.R*1.1, -0.04, Math.sin(a)*I.R*1.1)); if(v.y < FLOOR_Y + 0.2) continue; const d = v.distanceTo(hint); if(d < bd){ bd = d; best = a; } }   // 触发器别夹到贴地的位置
  const ca = Math.cos(best), sa = Math.sin(best), rr = I.R*1.03 + 0.06, out = new V3(ca, 0, sa);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.09), footMat); box.position.set(ca*rr, -0.045, sa*rr); box.rotation.y = -best; I.g.add(box);
  const jk = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 6), standMat); jk.position.set(ca*(rr + 0.05), -0.045, sa*(rr + 0.05)); jk.quaternion.setFromUnitVectors(UPV, out); I.g.add(jk);
  I.g.updateMatrixWorld(true);
  const p0 = I.g.localToWorld(new V3(ca*(rr + 0.08), -0.045, sa*(rr + 0.08)));
  const dir = out.clone().transformDirection(I.g.matrixWorld);
  return {p0, dir};
}
function ampJack(A, k){                                  // 箱头面板左端的两个输入口，插头 + 插头尾套
  const jx = -0.505, jy = 2.395 + (k ? -0.035 : 0.035), jz = 0.234;
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 6), standMat); plug.rotation.x = Math.PI/2; plug.position.set(jx, jy, jz + 0.025); A.sh.add(plug);
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.07, 8), footMat); boot.rotation.x = Math.PI/2; boot.position.set(jx, jy, jz + 0.08); A.sh.add(boot);
  A.g.updateMatrixWorld(true);
  return {jx, jy, jz, local:(x, y, z)=>A.sh.localToWorld(new V3(x, y, z))};
}
function addCable(pts, r){
  // 样条在电线从鼓上垂到地面的拐弯处会往下冲出一点，钻到地板下面：先密采样，把低于地面的点抬回地面，再用这些点画
  const raw = new THREE.CatmullRomCurve3(pts, false, 'centripetal').getSpacedPoints(240), fy = FLOOR_Y + r + 0.004;
  for(const p of raw) if(p.y < fy) p.y = fy;
  const curve = new THREE.CatmullRomCurve3(raw, false, 'centripetal');
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, r, 5, false), cableMat));
  for(const t of [0.04, 0.965]){
    const p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const fb = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.12, 10), ferriteMat); fb.position.copy(p); fb.quaternion.setFromUnitVectors(UPV, tg); scene.add(fb);
    for(const e of [-1, 1]){ const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.016, 10), ferriteMat); lip.position.copy(p).addScaledVector(tg, e*0.066); lip.quaternion.copy(fb.quaternion); scene.add(lip); }
  }
}
{
  const CR = 0.014, FY = FLOOR_Y + CR;
  const AMP_R = AMPS[0], AMP_L = AMPS[1];
  const jobs = [
    {I:INST.kick,  hint:new V3(-0.55, -0.9, -0.15), A:AMP_L, k:0, wig: 1},
    {I:INST.floor, hint:new V3(-1.35, -0.3, -0.55), A:AMP_L, k:1, wig:-1},
    {I:INST.snare, hint:new V3(0.95, -0.2, -0.55),  A:AMP_R, k:0, wig:-1},
    {I:INST.tom1,  hint:new V3(0.75, 0.35, 0.35),   A:AMP_R, k:1, wig: 1},
  ];
  for(const J of jobs){
    const tr = addTrigger(J.I, J.hint), jk = ampJack(J.A, J.k);
    const s1 = tr.p0.clone().addScaledVector(tr.dir, 0.1); s1.y -= 0.12;
    const d0 = new V3(tr.p0.x + tr.dir.x*0.3, FY, tr.p0.z + tr.dir.z*0.3);
    const ox = jk.jx + (J.k ? 0.06 : -0.02);
    const af = jk.local(ox, CR, 0.75); af.y = FY;
    const side = new V3(af.z - d0.z, 0, d0.x - af.x).normalize();
    const m1 = d0.clone().lerp(af, 0.33).addScaledVector(side, 0.28*J.wig), m2 = d0.clone().lerp(af, 0.68).addScaledVector(side, -0.22*J.wig);
    m1.y = m2.y = FY;
    addCable([tr.p0, s1, d0, m1, m2, af, jk.local(ox, 0.08, 0.5), jk.local(ox - 0.02, 0.7, 0.42), jk.local(jk.jx, 1.7, 0.4), jk.local(jk.jx, jk.jy - 0.12, 0.34), jk.local(jk.jx, jk.jy, jk.jz + 0.115)], CR);
  }
}
function ampRing(A){   // 声波圈：只从低音喇叭往外扩
  const ln = new THREE.LineLoop(RING_GEO, waveMat.clone()); ln.position.set(0, A.bass.cy, A.bass.z0 + 0.04); ln.scale.setScalar(A.bass.R); A.sh.add(ln);
  A.rings.push({ln, t:0}); if(A.rings.length > 4){ const o = A.rings.shift(); A.sh.remove(o.ln); }
}
// 像素音符：♪ 和 ♫，白色字形 + 深色描边，用材质颜色染成乐器的颜色
const NOTE_BMP = [
  ['....##..','....###.','....#.##','....#..#','....#...','....#...','.####...','######..','######..','.####...'],
  ['..#######','..#######','..#.....#','..#.....#','..#.....#','.##....##','###...###','###...###','.#.....#.']
];
const noteTex = NOTE_BMP.map(b => pixTex(12, 12, g=>{
  const bw = b[0].length, bh = b.length, ox = Math.floor((12 - bw)/2), oy = Math.floor((12 - bh)/2);
  const on = (x, y)=> y >= 0 && y < bh && x >= 0 && x < bw && b[y][x] === '#';
  for(let y=-1;y<=bh;y++) for(let x=-1;x<=bw;x++){
    if(on(x, y)){ g.fillStyle = '#ffffff'; g.fillRect(ox + x, oy + y, 1, 1); }
    else if(on(x-1, y) || on(x+1, y) || on(x, y-1) || on(x, y+1)){ g.fillStyle = '#1a1230'; g.fillRect(ox + x, oy + y, 1, 1); }
  }
}));
const NOTES = [];
for(let i=0;i<40;i++){ const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:noteTex[i%2], alphaTest:0.5})); sp.visible = false; scene.add(sp); NOTES.push({sp, t:9, life:1, v:new V3(), ph:0, sc:0.2}); }
let noteI = 0;
const NOTE_COL = {kick:0x4b52c8, snare:0x6c7cf0, tom1:0x8a78ee, tom2:0x8a78ee, floor:0x6650cc, hihat:0xf2c14e, crash:0xffa83a};   // 音符染成乐器的颜色
const AMP_W = {kick:1, snare:0.65, tom1:0.55, tom2:0.55, floor:0.6, hihat:0.12, crash:0.9};
function spawnNote(p, color, up){
  const N = NOTES[noteI++ % NOTES.length];
  N.sp.material.map = noteTex[Math.random() < 0.5 ? 0 : 1]; N.sp.material.color.setHex(color);
  N.sp.position.copy(p); N.v.set((Math.random() - 0.5)*0.5, up, (Math.random() - 0.5)*0.5);
  N.t = 0; N.life = 1.3 + Math.random()*0.6; N.ph = Math.random()*6.283; N.sc = 0.2 + Math.random()*0.08; N.sp.visible = true;
}
const _fx = new V3(), _fx2 = new V3();
function fxHit(I, vel){
  const w = AMP_W[I.key] || 0.4, col = NOTE_COL[I.key] || 0xff7a6b;
  if(I.key !== 'hihat' || Math.random() < 0.35)
    spawnNote(_fx.copy(I.center).addScaledVector(I.n, 0.2).add(_fx2.set((Math.random() - 0.5)*I.R, 0.05, (Math.random() - 0.5)*I.R)), col, 0.7 + 0.4*vel);
  if(w >= 0.5){
    const A = AMPS[Math.floor(Math.random()*AMPS.length)];
    A.sh.localToWorld(_fx.set((Math.random() - 0.5)*0.7, A.HC*(0.4 + Math.random()*1.2), A.D/2 + 0.12)); spawnNote(_fx, col, 0.8);
  }
  for(const A of AMPS){
    A.pv += 1.8*w*vel; A.shake = Math.max(A.shake, w*vel); A.glow = Math.max(A.glow, Math.min(1, w*vel + 0.3));
    if(w >= 0.85 && vel > 0.3) ampRing(A);
  }
}
const _lampLo = new THREE.Color(0x8a1c2c), _lampHi = new THREE.Color(0xff6a5a);
function updateFX(dt){
  for(const A of AMPS){
    A.pv += (-160*A.pump - 9*A.pv)*dt; A.pump += A.pv*dt;          // 喇叭鼓包：被打一下往外鼓，再弹几下
    for(const dm of A.domes) dm.scale.y = Math.max(0.04, 0.18 + A.pump*0.9);
    A.bass.coneG.position.z = A.bass.z0 + Math.max(-0.05, Math.min(0.08, A.pump*0.5));   // 低音纸盆推得最远
    A.shake = Math.max(0, A.shake - dt*4); A.glow = Math.max(0, A.glow - dt*3);
    const j = 0.025*A.shake;                                           // 箱体震动
    A.sh.position.set((Math.random() - 0.5)*j, Math.abs(A.pump)*0.02, (Math.random() - 0.5)*j);
    A.lamp.material.color.copy(_lampLo).lerp(_lampHi, A.glow);
    for(let i=A.rings.length-1;i>=0;i--){
      const r = A.rings[i]; r.t += dt;
      if(r.t > 0.5){ A.sh.remove(r.ln); A.rings.splice(i, 1); continue; }
      r.ln.scale.setScalar(A.bass.R*0.95 + r.t*1.7); r.ln.position.z = A.bass.z0 + 0.04 + r.t*0.5; r.ln.material.opacity = r.t < 0.3 ? 1 : 0.5;   // 像素风：只分两档透明度
    }
  }
  for(const N of NOTES){
    if(!N.sp.visible) continue;
    N.t += dt; if(N.t > N.life){ N.sp.visible = false; continue; }
    N.sp.position.addScaledVector(N.v, dt); N.v.y *= Math.exp(-dt*0.8);
    N.sp.position.x += Math.sin(N.t*5 + N.ph)*0.004;
    const k = N.t < 0.12 ? N.t/0.12*1.25 : (N.t > N.life - 0.2 ? (N.life - N.t)/0.2 : 1);
    N.sp.scale.setScalar(N.sc*Math.max(0.001, k));
  }
}

// ---------- 声音 ----------
const MODES = [[0,1,2.4048],[1,1,3.8317],[2,1,5.1356],[0,2,5.5201],[3,1,6.3802],[1,2,7.0156],[4,1,7.5883],[2,2,8.4172],[0,3,8.6537],[5,1,8.7715]];
function besselJ(m, x){ let s=0; const n=64; for(let i=0;i<n;i++){ const t=(i+.5)*Math.PI/n; s+=Math.cos(m*t - x*Math.sin(t)); } return s/n; }
let tuneMul = 1;
let actx = null, master = null, songGain = null, noiseShort = null, noiseLong = null;
let drumVol = 0.7, songVol = 0.8;      // 鼓声、原曲音量（滑块）
function initAudio(){
  actx = new (window.AudioContext||window.webkitAudioContext)();
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master = actx.createGain(); master.gain.value = 0.5*drumVol/0.7;
  master.connect(comp); comp.connect(actx.destination);
  songGain = actx.createGain(); songGain.gain.value = songVol; songGain.connect(actx.destination);   // 原曲不进压缩器，免得被鼓声压得一抽一抽
  const mk = (sec)=>{ const b = actx.createBuffer(1, Math.floor(actx.sampleRate*sec), actx.sampleRate); const d = b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; return b; };
  noiseShort = mk(0.06); noiseLong = mk(2.6);
}
const audioOn = () => actx && actx.state === 'running';
function noiseBurst(buf, t, filters, gain, dur){
  const src = actx.createBufferSource(); src.buffer = buf;
  let node = src;
  for(const [type, f, Q] of filters){ const bq = actx.createBiquadFilter(); bq.type = type; bq.frequency.value = f; if(Q) bq.Q.value = Q; node.connect(bq); node = bq; }
  const g = actx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  node.connect(g); g.connect(master); src.start(t); src.stop(t+dur+0.02);
}
// 鼓：理想圆膜模态，落点 r 处的激发幅度 ∝ |J_m(j_mn · r/R)|
function playDrum(d, vel, rn){
  const f0 = d.f0*tuneMul, loud = Math.pow(vel, 1.4), nModes = d.kind==='kick' ? 6 : 10;
  const parts = [];
  MODES.slice(0, nModes).forEach(([m,n,z],i)=>{
    const shape = Math.abs(besselJ(m, z*rn)), soft = Math.exp(-(z/2.4048-1)*(1-vel)*0.55);
    let tau = d.tau*Math.pow(2.4048/z, 0.85); if(m===0) tau *= 0.6;
    parts.push({lab:m+','+n, f:f0*z/2.4048, a:shape*soft/(1+0.12*i)*loud, tau, col: m===0 ? '#ffd23a' : '#ff8fb2'});
  });
  if(audioOn()){
    const t = actx.currentTime + 0.003;
    parts.forEach((p,i)=>{
      const a = p.a*0.42*d.gain; if(a < 0.002) return;
      const o = actx.createOscillator(), g = actx.createGain();
      if(d.kind==='kick' && i===0){ o.frequency.setValueAtTime(p.f*2.4, t); o.frequency.exponentialRampToValueAtTime(p.f, t+0.05); }
      else { o.frequency.setValueAtTime(p.f*(1+0.035*vel), t); o.frequency.exponentialRampToValueAtTime(p.f, t+0.09); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t+0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t+p.tau*4.5);
      o.connect(g); g.connect(master); o.start(t); o.stop(t+p.tau*4.5+0.05);
    });
    if(d.kind==='kick') noiseBurst(noiseShort, t, [['lowpass', 2200]], 0.5*loud, 0.014);
    else noiseBurst(noiseShort, t, [['bandpass', 900+2600*vel+800*rn, 0.9]], 0.26*loud, 0.035);
    if(d.kind==='snare') noiseBurst(noiseLong, t, [['highpass', 1800], ['bandpass', 5000, 0.6]], 0.5*loud*(0.6+0.4*(1-rn)), 0.18+0.1*vel);   // 响弦
  }
  if(d.kind==='snare') parts.push({lab:'弦', f:5000, a:0.5*loud, tau:0.1, col:'#bdb6ec'});
  return parts;
}
// 镲：六个不谐和方波（经典鼓机的频率比）高通后叠加噪声
const MET_F = [205.3, 304.4, 369.6, 522.7, 540, 800];
function playCymbal(c, vel, rn){
  const hat = c.kind==='hihat', bell = rn < 0.22, loud = Math.pow(vel, 1.3);
  const mul = (hat ? 2.0 : 1.3)*(bell ? 1.35 : 1);
  const dur = hat ? 0.06 + 0.05*vel : (bell ? 1.0 : 1.5 + 0.8*vel);
  const nz = hat ? 0.3 : (bell ? 0.08 : 0.26);
  const parts = MET_F.map((f,i)=>({lab:'方'+(i+1), f:f*mul, a:(0.75+0.25*Math.cos(i*1.7+rn*5))*loud, tau:dur*0.35, col:'#ffd23a'}));
  parts.push({lab:'噪', f: hat ? 8000 : 5200, a: nz*2.4*loud, tau: dur*0.35, col:'#bdb6ec'});
  if(audioOn()){
    const t = actx.currentTime + 0.003;
    const bus = actx.createGain(), hp = actx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = hat ? 7000 : (bell ? 2500 : 3800);
    bus.gain.setValueAtTime(0, t); bus.gain.linearRampToValueAtTime(loud*(hat ? 0.32 : 0.24), t+0.001);
    bus.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    bus.connect(hp); hp.connect(master);
    MET_F.forEach(f=>{ const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = f*mul; const g = actx.createGain(); g.gain.value = 1/6; o.connect(g); g.connect(bus); o.start(t); o.stop(t+dur+0.05); });
    noiseBurst(noiseLong, t, [['highpass', hat ? 8000 : 5200]], nz*loud, dur*0.9);
  }
  return parts;
}

// ---------- 打鼓的触手：四段等曲率圆弧 + 阻尼最小二乘 ----------
// IK 同时约束末段两端 A、E，末段整片平拍到鼓面；末段之后再接一段只用于显示的卷曲尖
function arcLocal(kx, ky, s, off, axis){
  const k = Math.hypot(kx,ky);
  if(k < 1e-5){ off.set(0,0,s); axis.set(1,0,0); return 0; }
  const dxn=kx/k, dyn=ky/k, ks=k*s;
  off.set(dxn*(1-Math.cos(ks))/k, dyn*(1-Math.cos(ks))/k, Math.sin(ks)/k);
  axis.set(-dyn, dxn, 0);
  return ks;
}
const limbs = [];
function makeLimb(o){
  const L = Object.assign({}, o);
  L.LTOT = o.lens.reduce((a,b)=>a+b,0); L.LV = L.LTOT + o.LC;
  L.S0 = (L.LTOT - o.lens[3])/L.LV; L.S1 = L.LTOT/L.LV;
  L.qlim = o.lens.map((l,j)=>(o.qmax ? o.qmax[j] : (j===3 ? 0.9 : 2.0))/l);
  L.q = new Float64Array(8); L.qTmp = new Float64Array(8); L.J = new Float64Array(48);
  L.NS = o.per.reduce((a,b)=>a+b,0) + o.perc + 1;
  L.pts = Array.from({length:L.NS}, ()=>new V3());
  L.sampF = []; let acc = 0;
  for(let j=0;j<4;j++){ for(let n=0;n<o.per[j];n++) L.sampF.push((acc+n/o.per[j]*o.lens[j])/L.LV); acc += o.lens[j]; }
  for(let n=0;n<=o.perc;n++) L.sampF.push((L.LTOT+n/o.perc*o.LC)/L.LV);
  L.baseLocal = ringPoint(o.ang, new V3()); L.outLocal = new V3(Math.cos(o.ang), 0, Math.sin(o.ang));
  L.basePos = new V3(); L.baseQuat = new THREE.Quaternion(); L.baseDir = new V3();
  L.A = new V3(); L.E = new V3(); L.mid = new V3(); L.prevMidD = NaN;
  L.curl = 1; L.squash = 0; L.contactT = -10; L.inContact = false;
  L.face = new V3(0,-1,0); L.tgA = new V3(); L.tgE = new V3();
  L.lastHit = {p:new V3(), n:new V3(0,1,0), t:0};
  L.nextHit = {inst:null, p:new V3(), n:new V3(0,1,0), t:0, v:0, K:0};
  L.tube = makeTube(L.NS, jellyMat(LIMB_J));          // 每条打鼓的触手一份材质：拍中时尖端单独闪一下
  for(let n=0;n<L.NS;n++) tubeColor(L.tube, n, S_COL(L.sampF[n])); tubeColorsDone(L.tube);
  L.MAXS = 80; L.suck = new THREE.InstancedMesh(ringGeo, suckMat, L.MAXS); scene.add(L.suck);
  limbs.push(L); return L;
}
const _p = new V3(), _R = new THREE.Quaternion(), _o = new V3(), _ax = new V3(), _dq = new THREE.Quaternion(), _inv = new THREE.Quaternion(), _dl = new V3();
function fk(L, qv, outA, outE, draw){
  _p.copy(L.basePos); _R.copy(L.baseQuat);
  let si = 0;
  for(let j=0;j<4;j++){
    const kx=qv[2*j], ky=qv[2*j+1], Lj=L.lens[j];
    if(j===3) outA.copy(_p);
    if(draw) for(let n=0;n<L.per[j];n++){ arcLocal(kx,ky,(n/L.per[j])*Lj,_o,_ax); L.pts[si++].copy(_o.applyQuaternion(_R)).add(_p); }
    const ang = arcLocal(kx,ky,Lj,_o,_ax);
    _p.add(_o.applyQuaternion(_R));
    _R.multiply(_dq.setFromAxisAngle(_ax, ang));
  }
  outE.copy(_p);
  if(draw){   // 卷曲尖：朝吸盘一侧卷
    _inv.copy(_R).invert(); _dl.copy(L.face).applyQuaternion(_inv);
    const h = Math.hypot(_dl.x,_dl.y) || 1, kc = L.curlK*L.curl;
    const kx = kc*_dl.x/h, ky = kc*_dl.y/h;
    for(let n=0;n<=L.perc;n++){ arcLocal(kx,ky,(n/L.perc)*L.LC,_o,_ax); L.pts[si++].copy(_o.applyQuaternion(_R)).add(_p); }
  }
}
const _A0=new V3(), _E0=new V3(), _A1=new V3(), _E1=new V3();
function solveN(M, b){
  const n = b.length, A = M.map((row,i)=>row.concat([b[i]]));
  for(let i=0;i<n;i++){
    let p=i; for(let r=i+1;r<n;r++) if(Math.abs(A[r][i])>Math.abs(A[p][i])) p=r;
    [A[i],A[p]]=[A[p],A[i]];
    const d = A[i][i]; if(Math.abs(d)<1e-12) return new Array(n).fill(0);
    for(let r=0;r<n;r++){ if(r===i) continue; const f=A[r][i]/d; for(let c=i;c<=n;c++) A[r][c]-=f*A[i][c]; }
  }
  return A.map((row,i)=>row[n]/row[i]);
}
function solveIK(L, iters){
  const q = L.q, J = L.J, tA = L.tgA, tE = L.tgE;
  for(let it=0; it<iters; it++){
    fk(L, q, _A0, _E0, false);
    const e = [tA.x-_A0.x, tA.y-_A0.y, tA.z-_A0.z, tE.x-_E0.x, tE.y-_E0.y, tE.z-_E0.z];
    if(e.reduce((s,v)=>s+v*v,0) < 1e-6) break;
    const eps = 1e-3;
    for(let c=0;c<8;c++){
      L.qTmp.set(q); L.qTmp[c]+=eps; fk(L, L.qTmp, _A1, _E1, false);
      J[c]=(_A1.x-_A0.x)/eps; J[8+c]=(_A1.y-_A0.y)/eps; J[16+c]=(_A1.z-_A0.z)/eps;
      J[24+c]=(_E1.x-_E0.x)/eps; J[32+c]=(_E1.y-_E0.y)/eps; J[40+c]=(_E1.z-_E0.z)/eps;
    }
    const M = [];
    for(let r=0;r<6;r++){ M.push([]); for(let s=0;s<6;s++){ let v=0; for(let c=0;c<8;c++) v+=J[r*8+c]*J[s*8+c]; M[r].push(v+(r===s?0.012:0)); } }
    const y = solveN(M, e);
    for(let c=0;c<8;c++){
      let d = 0; for(let r=0;r<6;r++) d += J[r*8+c]*y[r];
      d = Math.max(-0.6, Math.min(0.6, d));
      const lim = L.qlim[c>>1];
      q[c] = Math.max(-lim, Math.min(lim, (q[c]+d)*0.997));
    }
    if(L.planar){                                               // 底鼓那条：只在竖直面里弯，别往两边拧
      for(let j=0;j<4;j++) q[2*j] *= 1 - L.planar;
      for(let j=1;j<3;j++) q[2*j+1] = Math.max(q[2*j+1], 0);    // 中间两段只许往前（朝鼓）弯：J 的底朝前，不会绕成反过来的钩
    }
  }
}
// 形态：根部粗、中段细；长触腕末端是加粗的扁平穗和圆钝的桨状头，腕末端收成圆钝的尖
function profile(L, f){
  const sq = L.squash;
  if(f < L.S0){ const u = f/L.S0; return {r: L.club ? 0.038 + 0.052*Math.pow(1-u, 1.4) + 0.03*Math.pow(u, 3) : 0.034 + 0.056*Math.pow(1-u, 1.3), w:1, t:1, zone:0, u}; }
  if(f <= L.S1){
    const c = (f-L.S0)/(L.S1-L.S0), k = Math.min(1, c*5);
    if(L.club) return {r: 0.074 + 0.02*Math.sin(Math.PI*0.5*c), w:(1+0.32*k)*(1+0.4*sq), t:(1-0.25*k)*(1-0.42*sq), zone:1, u:c};
    return {r: 0.034 - 0.004*c, w:(1+0.15*k)*(1+0.4*sq), t:(1-0.15*k)*(1-0.4*sq), zone:1, u:c};
  }
  const c = (f-L.S1)/(1-L.S1), k = 1-c;
  if(L.club) return {r: 0.095 - 0.04*c*c, w:(1+0.32*k)*(1+0.3*sq), t:(1-0.25*k)*(1-0.3*sq), zone:2, u:c};
  return {r: 0.008 + 0.024*Math.pow(1-c, 0.8), w:1, t:1, zone:2, u:c};
}
const _pp = new V3(), _m4 = new THREE.Matrix4(), _sc = new V3(), _tg = new V3(), _nn = new V3(), _bb = new V3(), _sp = new V3();
// 管子的标架：沿触手平行移动（自己不转），每一圈只朝"吸盘该朝的方向"慢慢扭一点，一圈最多约 10°。
// 以前每一圈各自现算吸盘方向，触手正对着鼓往下砸时这个方向会突然翻过去，相邻两圈错开半圈，管子就像拧了几圈
const MAX_ROLL = 0.18, _fw = new V3(), _fc = new V3();
const _fm = new V3();
function computeFrames(L){
  const P = L.pts, N = L.NS;
  if(!L.FT){ L.FT = P.map(()=>new V3()); L.FN = P.map(()=>new V3()); L.FB = P.map(()=>new V3()); L.rootN = null; }
  for(let n=0;n<N;n++){
    const T = L.FT[n], Nn = L.FN[n];
    T.subVectors(P[Math.min(N-1, n+1)], P[Math.max(0, n-1)]);
    if(T.lengthSq() < 1e-12) T.copy(n ? L.FT[n-1] : UPV); T.normalize();
    if(n >= N-L.perc-1 && n < N-1 && L.curl >= 0.25) _fw.subVectors(P[n+1], P[n]).sub(_sp.subVectors(P[n], P[n-1]));   // 卷曲尖：吸盘朝卷曲内侧
    else if(L.approach) _fw.crossVectors(_fm.crossVectors(UPV, L.face), T);   // 底鼓那条弯成 J：吸盘一直在 J 的外侧（往下时朝后、底部朝地、往上时朝鼓），整条不拧
    else _fw.copy(L.face);
    const r0 = _fw.length(); _fw.addScaledVector(T, -_fw.dot(T)); const wl = _fw.length(), rel = r0 > 1e-7 ? wl/r0 : 0;
    const prev = n ? L.FN[n-1] : (L.rootN || _fw);                // 根部沿用上一帧的根部方向，帧与帧之间也不会突然翻
    Nn.copy(prev).addScaledVector(T, -prev.dot(T));
    if(Nn.lengthSq() < 1e-8){ Nn.set(0, 1, 0).addScaledVector(T, -T.y); if(Nn.lengthSq() < 1e-6) Nn.set(1, 0, 0).addScaledVector(T, -T.x); }
    Nn.normalize();
    if(rel > 0.3){
      _fw.divideScalar(wl);
      const ang = Math.atan2(_fc.crossVectors(Nn, _fw).dot(T), Nn.dot(_fw));
      Nn.applyAxisAngle(T, Math.max(-MAX_ROLL, Math.min(MAX_ROLL, ang*0.5*Math.min(1, (rel - 0.3)/0.4))));
    }
    L.FB[n].crossVectors(Nn, T).normalize();
  }
  if(!L.rootN) L.rootN = new V3(); L.rootN.copy(L.FN[0]);
}
function frameAt(L, n){ _tg.copy(L.FT[n]); _nn.copy(L.FN[n]); _bb.copy(L.FB[n]); }
function placeSucker(L, i, p, size){
  _m4.makeBasis(_tg,_bb,_nn).scale(_sc.set(size, size, size*0.7)).setPosition(p);
  L.suck.setMatrixAt(i, _m4);
}
// 触手和鼓的碰撞：画之前把落进鼓里的点推出去。落在鼓皮下面的往鼓皮外抬（贴着鼓面），
// 抬起量向前后几节平滑扩散，免得折出尖角；从鼓身侧面穿进去的沿半径推出去
const _cl = new V3(), _ck = new V3(), LIFT = new Float32Array(64), LIFT2 = new Float32Array(64), ARC0 = new Float32Array(64), ARC1 = new Float32Array(64), _CQ = Array.from({length:64}, ()=>new V3());
function arcLen(P, N, out){ out[0] = 0; for(let k=1;k<N;k++) out[k] = out[k-1] + P[k].distanceTo(P[k-1]); return out[N-1]; }
function collideLimb(L){
  const N = L.NS; let hit = false;
  const len0 = arcLen(L.pts, N, ARC0);
  for(let k=0;k<N;k++){ const pr = profile(L, L.sampF[k]), lim = FLOOR_Y + pr.r*pr.t + 0.012; if(L.pts[k].y < lim){ L.pts[k].y = lim; hit = true; } }   // 贴着地面走，不穿地板
  for(const d of drums){
    let any = false;
    for(let k=0;k<N;k++){
      const pr = profile(L, L.sampF[k]), r = pr.r*pr.t + 0.012;
      _cl.copy(L.pts[k]); d.g.worldToLocal(_cl);
      const rad = Math.hypot(_cl.x, _cl.z), Rr = d.R*1.04 + r;
      LIFT[k] = 0;
      if(rad < Rr && _cl.y < r && _cl.y > -d.depth - r){
        const up = r - _cl.y, side = Rr - rad;
        if(up <= side + 0.03){ LIFT[k] = up; any = true; }
        else { const f = Rr/Math.max(rad, 1e-4); _cl.x *= f; _cl.z *= f; d.g.localToWorld(L.pts[k].copy(_cl)); hit = true; }
      }
    }
    if(!any) continue;
    for(let k=0;k<N;k++){
      let m = LIFT[k];
      for(let j=Math.max(0, k-5); j<=Math.min(N-1, k+5); j++) m = Math.max(m, LIFT[j]*(1 - Math.abs(k-j)/6));
      LIFT2[k] = m;
    }
    for(let k=0;k<N;k++) if(LIFT2[k] > 0) L.pts[k].addScaledVector(d.n, LIFT2[k]);
    hit = true;
  }
  if(!hit) return;
  for(let it=0; it<2; it++) for(let k=1;k<N-1;k++){            // 推出来的点偶尔会和旁边的点折回去：折角太大就放回两邻点中间
    const P0 = L.pts[k-1], P1 = L.pts[k], P2 = L.pts[k+1];
    _cl.subVectors(P1, P0); _ck.subVectors(P2, P1);
    if(_cl.dot(_ck) < 0.2*_cl.length()*_ck.length()) P1.addVectors(P0, P2).multiplyScalar(0.5);
  }
  // 竖着砸进鼓里的那一截被抬到鼓面上时，几个点会挤成一团（管子在那里打结）。按原来的间距比例沿新的折线重新排一遍
  const len1 = arcLen(L.pts, N, ARC1);
  for(let k=0;k<N;k++) _CQ[k].copy(L.pts[k]);
  let j = 1;
  for(let k=1;k<N-1;k++){
    const sT = ARC0[k]/len0*len1;
    while(j < N-1 && ARC1[j] < sT) j++;
    const seg = ARC1[j] - ARC1[j-1], f = seg > 1e-9 ? (sT - ARC1[j-1])/seg : 0;
    L.pts[k].copy(_CQ[j-1]).lerp(_CQ[j], Math.min(1, Math.max(0, f)));
  }
}
// 相邻的打鼓触手之间不互相穿：找出挨得太近的地方，各让一半。推开量用钟形权重沿触手前后十来节摊开（不折角），
// 再随时间平滑跟过去（不抖）；根部 15% 不参与
const SEP_A = Array.from({length:64}, ()=>new V3()), SEP_B = Array.from({length:64}, ()=>new V3()), SEP_T = Array.from({length:64}, ()=>new V3()), _sq = new V3();
const SEP_W = Array.from({length:11}, (_,i)=>0.5 + 0.5*Math.cos(Math.PI*i/11));
function sepApply(L, D){
  const N = L.NS;
  if(!L.sepAcc) L.sepAcc = Array.from({length:N}, ()=>new V3());
  for(let k=0;k<N;k++){
    let best = 0; SEP_T[k].set(0,0,0);
    for(let j=Math.max(0, k-10); j<=Math.min(N-1, k+10); j++){
      const w = SEP_W[Math.abs(k-j)], m = D[j].length()*w;
      if(m > best){ best = m; SEP_T[k].copy(D[j]).multiplyScalar(w); }
    }
    const g = Math.min(1, Math.max(0, (L.sampF[k] - 0.12)/0.1));
    SEP_T[k].multiplyScalar(g);
    L.sepAcc[k].add(SEP_T[k]);
  }
}
function separateLimbs(dt){
  for(const L of limbs){ if(!L.sepD){ L.sepD = Array.from({length:L.NS}, ()=>new V3()); L.sepAcc = Array.from({length:L.NS}, ()=>new V3()); } for(const v of L.sepAcc) v.set(0,0,0); }
  const kd = 1 - Math.exp(-dt*60);
  for(const [a, b] of SEP_PAIRS) separatePair(limbs[a], limbs[b], kd);
  for(const L of limbs) if(L.sepAcc){ for(let k=0;k<L.NS;k++){ L.sepD[k].lerp(L.sepAcc[k], kd); L.pts[k].add(L.sepD[k]); } }
}
const SEP_PAIRS = [[0, 1], [1, 2]];      // 相邻的根：踩镲触手–军鼓触手、军鼓触手–底鼓触手
function separatePair(A, B, kd){
  for(let k=0;k<A.NS;k++) SEP_A[k].set(0,0,0);
  for(let j=0;j<B.NS;j++) SEP_B[j].set(0,0,0);
  for(let k=0;k<A.NS;k++){
    if(A.sampF[k] < 0.15) continue;
    const pa = profile(A, A.sampF[k]), ra = pa.r*pa.t;
    for(let j=0;j<B.NS;j++){
      if(B.sampF[j] < 0.15) continue;
      const pb = profile(B, B.sampF[j]), need = ra + pb.r*pb.t + 0.02;
      _sq.subVectors(A.pts[k], B.pts[j]); const d = _sq.length();
      if(d >= need || d < 1e-6) continue;
      _sq.multiplyScalar((need - d)/d*0.6);
      if(_sq.lengthSq() > SEP_A[k].lengthSq()) SEP_A[k].copy(_sq);
      if(_sq.lengthSq() > SEP_B[j].lengthSq()) SEP_B[j].copy(_sq).negate();
    }
  }
  sepApply(A, SEP_A); sepApply(B, SEP_B);
}
function drawLimb(L){
  let si = 0, rw = 0, rt = 0;
  computeFrames(L);
  for(let n=0;n<L.NS;n++){
    const f = L.sampF[n], pr = profile(L, f);
    frameAt(L, n);
    // 柔软的次级摆动：只作用在中段，两端不动，不影响击打位置
    const wob = pr.zone===0 ? 0.016*Math.sin(Math.PI*pr.u)*Math.sin(simT*4.3 + f*11 + L.ang*3) : 0;
    const P = _pp.copy(L.pts[n]).addScaledVector(_bb, wob);
    rw = pr.r*pr.w; rt = pr.r*pr.t;
    tubeRing(L.tube, n, P, _bb, _nn, _tg, rw, rt);
    const face = pr.r*pr.t*0.86;
    if(pr.zone===0 && pr.u > 0.3 && si < L.MAXS-2){
      _sp.copy(P).addScaledVector(_nn, face).addScaledVector(_bb, ((n%2) ? 0.38 : -0.38)*pr.r);
      placeSucker(L, si++, _sp, pr.r*0.3);
    } else if(pr.zone===1 && pr.u > 0.06 && pr.u < 0.96 && si < L.MAXS-4){
      const lanes = L.club ? ((n%2) ? [-0.3, 0.3] : [-0.3, 0.3, -0.74, 0.74]) : [(n%2) ? 0.35 : -0.35];
      for(let k=0;k<lanes.length;k++){
        _sp.copy(L.pts[n]).addScaledVector(_nn, face).addScaledVector(_bb, lanes[k]*pr.r*pr.w);
        placeSucker(L, si++, _sp, L.club ? (k<2 ? 0.024 : 0.016) : 0.011);
      }
    } else if(pr.zone===2 && pr.u < 0.8 && si < L.MAXS-2){
      _sp.copy(L.pts[n]).addScaledVector(_nn, face).addScaledVector(_bb, ((n%2) ? 0.3 : -0.3)*pr.r*pr.w);
      placeSucker(L, si++, _sp, (L.club ? 0.022 : 0.008)*(1-0.5*pr.u));
    }
  }
  frameAt(L, L.NS-1); tubeEnd(L.tube, L.pts[L.NS-1], _bb, _nn, _tg, rw, rt);
  for(let i=si;i<L.MAXS;i++){ _m4.makeScale(0,0,0); L.suck.setMatrixAt(i,_m4); }
  L.suck.instanceMatrix.needsUpdate = true;
}

// ---------- 节奏：内置的两小节八分音符（16 格），每条触手一条音轨 ----------
// i 乐器、v 力度、r 落点半径（0 中心，1 边缘）、a 落点角度（0 为靠鱿鱼一侧）
const S = (i, v, r, a) => ({i, v, r, a:a||0});
const TRACKS = {
  L: Array.from({length:16}, (_,k)=> k===0 ? S('crash',1.0,0.62,0.3) : S('hihat', k%2 ? 0.45 : 0.75, 0.55, -0.2)),
  R: [null,null,S('snare',0.9,0.3),null, null,null,S('snare',0.9,0.3),S('snare',0.3,0.45,0.6), null,null,S('snare',0.9,0.3),null, S('tom1',0.8,0.3),S('tom2',0.85,0.3),null,null],
  K: [S('kick',1,0.4),null,null,S('kick',0.7,0.4), S('kick',0.9,0.4),null,null,null, S('kick',1,0.4),null,null,S('kick',0.7,0.4), S('kick',0.9,0.4),null,null,null],
  F: [null,null,null,null, null,null,null,null, null,null,null,null, null,null,S('floor',0.85,0.35),S('floor',1,0.35)],
};
const TENT = {lens:[0.6,0.52,0.45,0.4], LC:0.24, per:[11,9,8,13], perc:8, club:true, curlK:4.6, hc:0.19, thick:0.05, amp:0.85};
const ARMO = {lens:[0.55,0.45,0.42,0.35], LC:0.14, per:[10,8,7,9], perc:6, club:false, curlK:7, hc:0.165, thick:0.03, amp:0.7};
// 打底鼓的腕：加长一些，根部往下走，贴着地面绕到鼓皮下半部，末段从下往上拍（不再从头顶直插下来、路过军鼓）
const KICKO = Object.assign({}, ARMO, {lens:[0.8,0.65,0.5,0.35], per:[14,12,9,9], approach:new V3(0, 1, 0), dropY:1.4, planar:0.04, qmax:[2.0, 2.0, 3.0, 0.9]});   // 第三段允许弯得更狠：J 形的底
makeLimb(Object.assign({key:'L', ang:SLOT.L, track:TRACKS.L}, TENT));
makeLimb(Object.assign({key:'R', ang:SLOT.R, track:TRACKS.R}, TENT));
makeLimb(Object.assign({key:'K', ang:SLOT.K, track:TRACKS.K}, KICKO));
{ const K = limbs[limbs.length-1]; K.q[3] = 0.6/K.lens[1]; K.q[5] = 2.4/K.lens[2]; }   // 一开始就摆成 J 形
makeLimb(Object.assign({key:'F', ang:SLOT.F, track:TRACKS.F}, ARMO));
const OWNER = {hihat:'L', crash:'L', snare:'R', tom1:'R', tom2:'R', kick:'K', floor:'F'};
const limbBy = k => limbs.find(L=>L.key===k);

// ---------- 曲目：内置节奏、上传的鼓谱 / MIDI / 歌曲，都换成同一种“按时间排好的一串击打” ----------
// 每条触手一条队列，nextHit 指向队列里的下一下。歌曲时间 SONG.T 循环时一直往上加（不回绕），开头留 LEAD 秒给触手抬手。
// 拍点表 beats 决定点头的节拍；bar0 是第一个小节头落在第几拍。
let playing = true, simT = 0, globalStep = -3;
let FDT = 1/60;                                           // 这一帧的时长
const perFrame = k => 1 - Math.pow(1 - k, FDT*60);       // 按 60 帧调的每帧系数 k，换算到这一帧
const LEAD = 1.2, MIN_GAP = 0.13, WAIT = 2.2;
let REARM = 0.035, LIFT0 = 0.15;     // 抬回多高才算“离开鼓面”可以再打；快的段落里多抬一点
const SONG = {mode:'loop', kind:'', name:'', bpm:100, dur:4.8, loop:true, rate:1, T:-LEAD, events:[], lanes:{L:[], R:[], K:[], F:[]}, beats:[0, 0.6], bar0:0, env:null, buffer:null, anchorT:0, anchorCtx:0};
const HIT_DEF = {kick:[0.4, 0], snare:[0.3, 0], hihat:[0.55, -0.2], crash:[0.62, 0.3], tom1:[0.3, 0], tom2:[0.3, 0], floor:[0.35, 0]};
const PRI = {crash:3, snare:3, tom1:2, tom2:2, floor:2, kick:2, hihat:1};
const EV = (t, i, v, r, a) => ({t, i, v:Math.max(0.15, Math.min(1, v)), r: r === undefined ? HIT_DEF[i][0] : r, a: a === undefined ? HIT_DEF[i][1] : a});
function lowerBound(A, t){ let lo = 0, hi = A.length; while(lo < hi){ const m = (lo + hi) >> 1; if(A[m].t < t) lo = m + 1; else hi = m; } return lo; }
function lbNum(A, x){ let lo = 0, hi = A.length; while(lo < hi){ const m = (lo + hi) >> 1; if(A[m] < x) lo = m + 1; else hi = m; } return lo; }
// 一条触手同时只能打一样东西：挨得太近的两下只留一下（同时响的按优先级），被挤掉的在星轨上画成空心
function buildLanes(evs){
  const lanes = {L:[], R:[], K:[], F:[]};
  evs.sort((a, b)=>a.t - b.t);
  for(const e of evs){
    e.drop = false; e.hitAt = -99; e.hitIt = -1;
    const Q = lanes[OWNER[e.i]], p = Q[Q.length - 1];
    if(p && e.t - p.t < MIN_GAP){
      if(e.t - p.t < 0.035 && (PRI[e.i] > PRI[p.i] || (PRI[e.i] === PRI[p.i] && e.v > p.v))){ p.drop = true; Q[Q.length - 1] = e; }
      else e.drop = true;
      continue;
    }
    Q.push(e);
  }
  return lanes;
}
// 没有响度曲线的曲目（鼓谱、MIDI），用鼓点疏密当作星轨背景的起伏
function envFromEvents(evs, dur){
  const n = Math.max(1, Math.ceil(dur*10)), v = new Float32Array(n);
  for(const e of evs){ const i = Math.floor(e.t*10); for(let d=-3; d<=3; d++){ const j = i + d; if(j >= 0 && j < n) v[j] += e.v*(1 - Math.abs(d)/4); } }
  let mx = 0; for(let i=0;i<n;i++) mx = Math.max(mx, v[i]);
  for(let i=0;i<n;i++) v[i] = mx ? 0.2 + 0.8*v[i]/mx : 0;
  return {dt:0.1, v};
}
function prepSong(S){
  S.lanes = buildLanes(S.events);
  if(S.auto) S.events = S.events.filter(e=>!e.drop);   // 自动编的鼓：太挤的那下直接不要；用户自己的谱子才画成空心
  if(!S.env) S.env = envFromEvents(S.events, S.dur);
  if(!S.beats || S.beats.length < 2){ const p = 60/(S.bpm || 120); S.beats = Array.from({length:Math.ceil(S.dur/p) + 2}, (_, k)=>k*p); }
  return S;
}
function beatAt(t){
  const B = SONG.beats, n = B.length;
  if(t <= B[0]) return (t - B[0])/(B[1] - B[0]);
  if(t >= B[n-1]) return n - 1 + (t - B[n-1])/(B[n-1] - B[n-2]);
  let lo = 0, hi = n - 1; while(hi - lo > 1){ const m = (lo + hi) >> 1; if(B[m] <= t) lo = m; else hi = m; }
  return lo + (t - B[lo])/(B[hi] - B[lo]);
}
const songIter = T => (SONG.loop && T >= 0) ? Math.floor(T/SONG.dur) : 0;
const songLocal = T => T - songIter(T)*SONG.dur;
// 内置节奏：原来那两小节，按 100 BPM 换成秒
function builtinSong(){
  const evs = [];
  for(const k in TRACKS) TRACKS[k].forEach((s, j)=>{ if(s) evs.push(EV(j*0.3, s.i, s.v, s.r, s.a)); });
  return {mode:'loop', kind:'内置', name:'内置节奏 · 两小节', bpm:100, dur:4.8, loop:true, events:evs, beats:Array.from({length:9}, (_, k)=>k*0.6), bar0:0};
}
let CUR = null;
function applySong(S){
  CUR = S;
  for(const k of ['mode', 'kind', 'name', 'bpm', 'dur', 'loop', 'events', 'lanes', 'beats', 'env']) SONG[k] = S[k];
  SONG.bar0 = S.bar0 || 0; SONG.buffer = S.buffer || null;
  SONG.rate = 1; SONG.T = -LEAD;
  for(const e of S.events){ e.hitAt = -99; e.hitIt = -1; }
}
const BUILTIN = prepSong(builtinSong()); BUILTIN.uid = 'builtin';
const LIB = [BUILTIN];
applySong(BUILTIN);

// 歌曲的声音：和合成鼓声走同一个 AudioContext，时钟就对得上
let songSrc = null;
function stopSongAudio(){ if(songSrc){ try{ songSrc.stop(); }catch(_){} songSrc.disconnect(); songSrc = null; } }
function startSongAudio(){
  stopSongAudio();
  if(SONG.mode !== 'audio' || !SONG.buffer || !audioOn()) return;
  const src = actx.createBufferSource();
  src.buffer = SONG.buffer; src.playbackRate.value = SONG.rate; src.loop = SONG.loop;
  src.connect(songGain);
  const now = actx.currentTime + 0.02, T = SONG.T;
  if(T < 0) src.start(now - T/SONG.rate, 0); else src.start(now, Math.min(songLocal(T), SONG.dur - 0.01));
  SONG.anchorCtx = now; SONG.anchorT = T; songSrc = src;
}
function advanceSong(dt){
  if(songSrc) SONG.T = SONG.anchorT + (actx.currentTime - SONG.anchorCtx)*SONG.rate;
  else SONG.T += dt*SONG.rate;
  if(!SONG.loop && SONG.T > SONG.dur + 0.5){ SONG.T = 0; setPlaying(false); return; }     // 播完回到开头，停下
  globalStep = 2*(beatAt(SONG.T < 0 ? SONG.T : songLocal(SONG.T)) - SONG.bar0);
}

const _hu = new V3(), _hw = new V3(), _tmp = new V3(), _tmp2 = new V3();
// 乐器平面上的落点：a=0 指向鱿鱼那一侧
function hitPoint(I, r, a, out){
  _hu.subVectors(squidRing, I.center); _hu.addScaledVector(I.n, -_hu.dot(I.n)).normalize();
  _hw.crossVectors(I.n, _hu);
  return out.copy(I.center).addScaledVector(I.n, I.y0).addScaledVector(_hu, Math.cos(a)*r*I.R).addScaledVector(_hw, Math.sin(a)*r*I.R);
}
// 底鼓从下往上拍：落点挪到鼓皮中心偏下
const KICK_DX = 0.05;
function hitSpot(I, r, a, out){
  if(I.key !== 'kick') return hitPoint(I, r, a, out);
  hitPoint(I, 0.05 + 0.15*r, Math.PI + 0.5*a, out);
  return out.addScaledVector(_hw, KICK_DX);       // 和触手根部对齐：整条触手在一个竖直面里弯成 J 形
}
function setHit(L, e, k){
  const nh = L.nextHit, I = INST[e.i];
  nh.inst = I; nh.K = k; nh.ev = e; nh.v = e.v; hitSpot(I, e.r, e.a, nh.p); nh.n.copy(I.n); L.prevMidD = NaN;
}
// 下一下：from = 'now' 时从当前歌曲时间重新找（开始、跳转、落后太多），否则就是队列里的下一个
function scheduleNext(L, from){
  const Q = SONG.lanes[L.key], nh = L.nextHit;
  if(!Q.length){ L.rest = true; return; }
  let k, it;
  if(from === 'now'){ const T = SONG.T + 0.08*SONG.rate; it = songIter(T); k = lowerBound(Q, T - it*SONG.dur); }
  else { k = nh.K + 1; it = L.iter; }
  if(k >= Q.length){ if(!SONG.loop){ L.rest = true; nh.K = Q.length; return; } k = 0; it++; }
  L.rest = false; L.iter = it; setHit(L, Q[k], k); nh.tAbs = Q[k].t + it*SONG.dur;
  nh.gap = k + 1 < Q.length ? Q[k+1].t - Q[k].t : (SONG.loop ? Q[0].t + SONG.dur - Q[k].t : 9);   // 离再下一下还有多久：快的段落里没打中要早点放弃
}
for(const L of limbs){
  L.aim = new V3(); let na = 0;
  for(const s of L.track) if(s){ L.aim.add(hitSpot(INST[s.i], s.r, s.a, _tmp2)); na++; }
  L.aim.multiplyScalar(1/na);
  L.rest = false; L.iter = 0; L.nextHit.tAbs = 0;
  scheduleNext(L, 'now');
  const s0 = L.track.find(s=>s), I0 = INST[s0.i];          // 还没排到活的触手（比如落地嗵那条）先悬在自己那件鼓上，别停在原点（底鼓上方）
  if(!L.nextHit.inst){ hitSpot(I0, s0.r, s0.a, L.nextHit.p); L.nextHit.n.copy(I0.n); }
  L.lastHit.p.copy(L.nextHit.p); L.lastHit.n.copy(L.nextHit.n); L.lastHit.t = -0.6;
}

// 每条触手的目标：抬起蓄力（后拉、末端翘起）→ 加速下砸 → 末段整片平拍
const _ctr = new V3(), _nrm = new V3(), _dir = new V3(), _kAx = new V3(), _kv = new V3(), _kq = new THREE.Quaternion();
function computeTarget(L, t){
  const lh = L.lastHit, nh = L.nextHit;
  let h, cock, back = 0, mv;
  const man = !playing && L.manual;                      // 暂停时点鼓：单独打一下
  if(!man && (!playing || L.rest || nh.t - t > WAIT)){             // 停了、这条触手没活、或者下一下还早：先悬着歇一会
    const s = Math.min(1, (t-lh.t)/0.4);
    _ctr.copy(lh.p); _nrm.copy(lh.n); h = 0.4*L.amp*(1-(1-s)**3); cock = 0.3*s;
    L.curl += (1-L.curl)*perFrame(0.08);
  } else {
    const far = nh.t - lh.t > WAIT, t0 = far ? nh.t - WAIT : lh.t, t1 = nh.t, T = Math.max(0.05, t1-t0);
    const s0 = far ? Math.min(1, (t0 - lh.t)/0.4) : man ? L.manS0 : 0, h0 = 0.4*L.amp*(1-(1-s0)**3), c0 = 0.3*s0;   // 从悬停的姿势接着抬
    const Hh = (0.2 + 0.85*nh.v)*L.amp*Math.min(1, LIFT0 + T/0.5), CK = 0.2 + 0.35*nh.v;
    const D = Math.min(0.28, 0.6*T), hoverEnd = t1 - D;
    if(t < hoverEnd){
      const s = Math.max(0, Math.min(1, (t-t0)/Math.max(0.01, hoverEnd-t0))), e = 1-(1-s)**3;
      h = h0 + (Hh - h0)*e; mv = s*s*(3-2*s); cock = c0 + (CK - c0)*e; back = 0.12*Hh*e;
      L.curl += (1-L.curl)*perFrame(0.12);
    } else {
      const s = Math.min(1.1, (t-hoverEnd)/D);
      h = Hh*(1-s*s*s) - 0.03*s**8; mv = 1;
      cock = CK*Math.max(0, 1-Math.pow(s,1.6)); back = 0.12*Hh*Math.max(0, 1-s*s);
      L.curl = Math.min(L.curl, 1 - 0.8*Math.min(1,s));     // 下砸时卷曲尖像鞭子一样甩直
    }
    _ctr.lerpVectors(lh.p, nh.p, mv); _nrm.copy(lh.n).lerp(nh.n, mv).normalize();
  }
  L.face.copy(_nrm).negate();
  if(L.approach) _dir.copy(L.approach).addScaledVector(_nrm, -L.approach.dot(_nrm));   // 底鼓：末段从下往上贴到鼓面
  else { _dir.subVectors(_ctr, L.basePos); _dir.addScaledVector(_nrm, -_dir.dot(_nrm)); }
  if(_dir.lengthSq() < 1e-6) _dir.set(1,0,0); _dir.normalize();
  _ctr.addScaledVector(_dir, -back);
  const cx = Math.cos(cock)*L.hc, cy = Math.sin(cock)*L.hc;
  if(L.approach){   // 底鼓：不是沿法线退开，而是整条 J 绕根部往回摆（离根部的距离不变，J 形就不会挤出一个圈）
    const ck = Math.min(1.2, 2.2*cock);                       // 蓄力时末段绕着 J 的底往后翘，下砸时像踩锤一样甩上去
    L.tgA.copy(_ctr).addScaledVector(_dir, -L.hc).addScaledVector(_nrm, L.thick);
    L.tgE.copy(L.tgA).addScaledVector(_dir, 2*L.hc*Math.cos(ck)).addScaledVector(_nrm, 2*L.hc*Math.sin(ck));
    const off = 0.3*Math.max(0, h); L.tgA.addScaledVector(_nrm, off); L.tgE.addScaledVector(_nrm, off);   // J 的底也离开鼓皮一点，快的段落里才能每一下重新拍上去
    _kAx.crossVectors(_nrm, UPV).normalize();
    const ang = 0.45*Math.max(-0.03, h)/Math.max(0.6, _kv.subVectors(L.tgA, L.basePos).length());
    _kq.setFromAxisAngle(_kAx, ang);
    L.tgA.sub(L.basePos).applyQuaternion(_kq).add(L.basePos); L.tgE.sub(L.basePos).applyQuaternion(_kq).add(L.basePos);
  } else {
    L.tgA.copy(_ctr).addScaledVector(_dir, -cx).addScaledVector(_nrm, h + L.thick - cy);
    L.tgE.copy(_ctr).addScaledVector(_dir,  cx).addScaledVector(_nrm, h + L.thick + cy);
  }
  const fl = FLOOR_Y + L.thick + 0.07; if(L.tgA.y < fl) L.tgA.y = fl; if(L.tgE.y < fl) L.tgE.y = fl;   // 别钻到地板下面
  // 目标别贴近根部：太近时整体往外推，免得触手折回自己身上
  _tmp2.addVectors(L.tgA, L.tgE).multiplyScalar(0.5).sub(L.basePos);
  const dist = _tmp2.length(), minD = 0.5*L.LTOT;
  if(dist < minD){ _tmp2.multiplyScalar((minD-dist)/Math.max(dist,1e-4)); L.tgA.add(_tmp2); L.tgE.add(_tmp2); }
}
function updateBase(L){
  L.basePos.copy(L.baseLocal); body.localToWorld(L.basePos);
  // 根部朝向：大致指向它负责的那几件乐器，再稍微朝下
  L.baseDir.subVectors(L.aim, L.basePos).normalize().multiplyScalar(0.65); L.baseDir.y -= L.dropY || 0.35; L.baseDir.normalize();
  L.baseQuat.setFromUnitVectors(_Z, L.baseDir);
}

// ---------- 对界面开放的事件（界面在 js/ui.js，用 Squiddle.on 订阅） ----------
const BUS = {};
function emit(type, d){ const fs = BUS[type]; if(fs) for(const f of fs){ try{ f(d); } catch(e){ console.error(e); } } }

// ---------- 碰撞：触手末段碰到鼓皮或镲片才发声 ----------
const HITS = {};
const surfDist = (I, p) => _tmp.subVectors(p, I.center).dot(I.n) - I.y0;
function onContact(L, I, speed){
  const vel = Math.max(0.06, Math.min(1, Math.pow(speed/8, 1.2)));
  const loc = I.g.worldToLocal(_tmp2.copy(L.mid));
  const rn = Math.min(0.92, Math.hypot(loc.x, loc.z)/I.R);
  let res;
  if(I.isDrum){
    res = playDrum(I, vel, rn);
    const amp = (0.035 + 0.07*vel)*I.R;     // 末段整片拍下去：冲量沿末段分布在三处
    for(const [P, w] of [[L.A,0.3],[L.mid,0.5],[L.E,0.3]]){ const l = I.g.worldToLocal(_tmp2.copy(P)); strikeMembrane(I, l.x, l.z, amp*w); }
    addRing(I, loc.x, loc.z);
    I.shake = 0.05*vel*I.R;
  } else {
    res = playCymbal(I, vel, rn);
    I.wobT = 0; I.wobAmp = (I.kind==='crash' ? 0.22 : 0.06)*vel;
    I.wobAxis.set(loc.z, 0, -loc.x); if(I.wobAxis.lengthSq() < 1e-6) I.wobAxis.set(1,0,0); I.wobAxis.normalize();
  }
  HITS[I.key] = (HITS[I.key]||0) + 1;
  charHit(I, vel); dirHit(I);
  emit('hit', {key:I.key, label:I.label, drum:!!I.isDrum, vel, rn, x:loc.x/I.R, z:loc.z/I.R, speed, parts:res});
  L.contactT = simT; L.curl = 0.12;
  L.lastHit.p.copy(L.mid).addScaledVector(I.n, -surfDist(I, L.mid)); L.lastHit.n.copy(I.n); L.lastHit.t = Math.max(simT, L.nextHit.t - 0.03);
  const ev = L.nextHit.ev; if(ev && playing){ ev.hitAt = simT; ev.hitIt = L.iter; ev.hitT = SONG.T; }     // 星轨上点亮这一下
  L.manual = false;
  if(playing) scheduleNext(L);
}
function checkContact(L, dt){
  const I = L.nextHit.inst; if(!I) return;
  const dm = surfDist(I, L.mid), low = Math.min(dm, surfDist(I, L.A), surfDist(I, L.E)) - L.thick;
  const sp = isNaN(L.prevMidD) ? 0 : (L.prevMidD - dm)/Math.max(dt, 1e-4); L.prevMidD = dm;
  _tmp.subVectors(L.mid, I.center); const rad = Math.sqrt(Math.max(0, _tmp.lengthSq() - _tmp.dot(I.n)**2));
  if(!L.inContact && low <= 0.012 && sp > 0 && rad < I.R){ L.inContact = true; onContact(L, I, sp); }
  else if(L.inContact && low > L.thick + REARM) L.inContact = false;
}

// ---------- 角色动态：跟拍点头、转身看鼓、外套膜甩动、挤压拉伸、眨眼 ----------
const spr = x => ({x, v:0});
function stepSpr(sp, target, k, c, dt){ sp.v += (k*(target - sp.x) - c*sp.v)*dt; sp.x += sp.v*dt; return sp.x; }
const CH = {yaw:spr(0), nod:spr(0), roll:spr(0), dip:spr(0), sq:spr(0), lagNod:spr(0), lagRoll:spr(0), lagYaw:spr(0), lid:spr(-0.55),
  look:new V3(0.3, 0.3, 0.2), lookT:0, blinkT:2.5, blink:0, blink2:false, squint:0};
const yawTo = p => Math.atan2(p.x - squidRing.x, p.z - squidRing.z);
function attention(){   // 接下来最快要打的那一下，踩镲和过远的不优先
  let best = null, bw = 1e9;
  for(const L of limbs){
    const nh = L.nextHit; if(!nh.inst || L.rest) continue;
    const t = nh.t - simT; if(t < -0.05 || t > 0.8) continue;
    const w = t + (nh.inst.key === 'hihat' ? 0.45 : 0) - (nh.inst.key === 'crash' ? 0.2 : 0);
    if(w < bw){ bw = w; best = nh; }
  }
  return best;
}
function softWave(a){ SOFT.wave.push({t:0, a}); if(SOFT.wave.length > 4) SOFT.wave.shift(); }
function charHit(I, vel){
  fxHit(I, vel);
  if(I.key === 'kick'){ CH.dip.v -= 0.6*vel; CH.sq.v -= 0.9*vel; softWave(0.1*vel); CORE.pulse = Math.max(CORE.pulse, vel); }
  else if(I.key === 'floor') CORE.pulse = Math.max(CORE.pulse, 0.6*vel);
  else if(I.key === 'crash'){ CH.nod.v -= 1.5*vel; CH.sq.v += 1.0*vel; CH.squint = 1; softWave(0.08*vel); for(const O of STARS) O.pulse = Math.max(O.pulse, vel); }
  else if(I.key === 'snare'){ CH.nod.v -= 0.45*vel; softWave(0.05*vel); }
  else if(I.kind === 'tom'){ CH.roll.v += (I.center.x > 0 ? -0.6 : 0.6)*vel; }
}
const _gzv = new V3();
function updateCharacter(dt){
  let yawT, nodT, rollT, dipT = 0, sqT = 0, lidT;
  // 偶尔看镜头：没活干的时候，或者镜头离得比较近的时候（导播给脸部特写时也会看过来）
  _gzv.subVectors(camera.position, squidRing);
  const camD = _gzv.length(), facing = _gzv.z > -0.3*camD;                // 镜头在身前（脸朝 +z）才转得过来
  const idle = !playing || limbs.every(L=>L.rest || L.nextHit.t - simT > 1.2), close = camD < 4.4;
  CH.gazeCD = (CH.gazeCD || 0) - dt;
  if(CH.gaze > 0){ CH.gaze -= dt; if(!facing) CH.gaze = 0; }
  else if(facing && (CH.gazeReq || ((idle || close) && CH.gazeCD <= 0))){ CH.gaze = 1.3 + Math.random()*1.3; CH.gazeCD = (close ? 3.5 : 4.5) + Math.random()*4; }
  CH.gazeReq = 0;
  const gazing = CH.gaze > 0;
  if(playing){
    const beat = globalStep/2, ph = ((beat + 0.1)%1 + 1)%1, pulse = Math.exp(-ph*5.5);
    const sib = ((globalStep%16) + 16)%16, bar = Math.floor(globalStep/16);
    const accent = (sib < 1.2 || (sib >= 8 && sib < 9.2)) ? 1.6 : 1;     // 每小节第一、三拍更重
    nodT = -0.15*accent*pulse; dipT = -0.04*accent*pulse; sqT = -0.04*pulse;
    rollT = 0.09*Math.sin(Math.PI*beat);                                  // 两拍左右摇一个来回
    const nh = attention(), glance = ((bar%4) + 4)%4 === 3 && sib >= 3 && sib < 7;
    if(gazing || glance) CH.look.copy(camera.position); else if(nh) CH.look.copy(nh.p);
    yawT = gazing ? yawTo(camera.position)*0.45 : nh ? yawTo(nh.p)*0.45 : 0;
    lidT = gazing ? -0.8 : glance ? -0.75 : -0.4;                         // 打鼓时眼睑略垂，显得专注；看镜头时睁大
    if(gazing) rollT += 0.06;                                             // 看镜头时歪一点头
  } else {
    CH.lookT -= dt;
    if(gazing){ CH.look.copy(camera.position); CH.lookT = Math.max(CH.lookT, 0.5); }
    else if(CH.lookT <= 0){                                               // 空闲：东张西望
      CH.lookT = 1.2 + Math.random()*2.2;
      const r = Math.random(), ks = Object.keys(INST);
      if(r < 0.3) CH.look.copy(camera.position);
      else if(r < 0.7) CH.look.copy(INST[ks[Math.floor(Math.random()*ks.length)]].center);
      else CH.look.set(bodyBase.x + (Math.random()*2 - 1)*3, bodyBase.y + (Math.random()*2 - 1)*1.2, bodyBase.z + 2 + Math.random()*2);
    }
    yawT = yawTo(CH.look)*0.6; nodT = 0.03*Math.sin(simT*0.8); rollT = 0.05*Math.sin(simT*0.6); lidT = gazing ? -0.8 : -0.6;
    if(gazing) rollT += 0.07;
  }
  yawT = Math.max(-0.38, Math.min(0.38, yawT));
  stepSpr(CH.yaw, yawT, 30, 9, dt);
  stepSpr(CH.nod, nodT, 260, 18, dt); CH.nod.x = Math.max(-0.32, Math.min(0.16, CH.nod.x));
  stepSpr(CH.roll, rollT, 70, 11, dt);
  stepSpr(CH.dip, dipT, 180, 15, dt);
  stepSpr(CH.sq, sqT, 260, 7, dt); CH.sq.x = Math.max(-0.14, Math.min(0.14, CH.sq.x));
  stepSpr(CH.lagNod, CH.nod.x, 38, 2.6, dt);                              // 外套膜像个软软的水袋，跟着头慢半拍再甩过头、晃几下
  stepSpr(CH.lagRoll, CH.roll.x, 32, 2.6, dt);
  stepSpr(CH.lagYaw, CH.yaw.x, 30, 3, dt);
  CH.squint = Math.max(0, CH.squint - dt*2.5);
  stepSpr(CH.lid, lidT + 0.5*CH.squint, 120, 16, dt);
  CH.blinkT -= dt;
  if(CH.blinkT <= 0 && CH.blink === 0){ CH.blink = 1e-4; CH.blinkT = 2 + Math.random()*3.5; CH.blink2 = Math.random() < 0.25; }
  if(CH.blink > 0){ CH.blink += dt; if(CH.blink > 0.17){ CH.blink = 0; if(CH.blink2){ CH.blink2 = false; CH.blinkT = 0.1; } } }
  const bk = CH.blink > 0 ? Math.sin(Math.PI*CH.blink/0.17) : 0;
  eyeLook.copy(CH.look);
  return CH.lid.x + (1.5 - CH.lid.x)*bk;
}
// ---------- 粉色果冻：眼睑、吸盘、描边跟着同一套颜色 ----------
post.uniforms.inkJ.value.setHex(PAL.ink);
for(const m of [lidM, lidCapM]){ m.uniforms.tint.value.setHex(PAL.lid); m.uniforms.rimC.value.setHex(PAL.glow); }
suckMat.color.setHex(PAL.suck);
// 半透明的部分每帧按离镜头远近排先后：远的先画，近的后画，叠在一起才透得对
const JELLY = [
  {m:mantleMesh, p:o=>mantleG.localToWorld(o.set(0, 0.8, 0))},
  {m:headMesh, p:o=>body.localToWorld(o.set(0, -0.25, 0))},
  {m:funnel, p:o=>body.localToWorld(o.set(0.25, -0.24, 0))},
  ...fins.map(F=>({m:F.m, p:o=>mantleG.localToWorld(o.set(0, 1.3, F.side*0.38))})),
  ...armDefs.map(A=>({m:A.tube.mesh, p:o=>o.copy(A.P[ASEG >> 1])})),
  ...limbs.map(L=>({m:L.tube.mesh, p:o=>o.copy(L.mid)})),
];
JELLY.forEach(J=>{ J.c = new V3(); J.d = 0; });
function sortJelly(){
  for(const J of JELLY){ J.p(J.c); J.d = J.c.distanceToSquared(camera.position); }
  [...JELLY].sort((a, b)=>b.d - a.d).forEach((J, i)=>{ J.m.renderOrder = 10 + i; });
}
// 所有实体投影到地面（只有地面接收影子，鼓身上不叠阴影，免得发黑发脏）
scene.traverse(o=>{ if(o.isMesh && o !== floor && o !== shadowCatcher){ o.castShadow = true; if(o.isInstancedMesh) o.frustumCulled = false; } });
// ---------- 导播：放歌时自动切镜头（全景、脸部特写、乐器特写、背影、俯拍、仰拍） ----------
let camLabel = '用户透视';
const INAME = {kick:'底鼓', snare:'军鼓', hihat:'踩镲', tom1:'高嗵', tom2:'中嗵', floor:'落地嗵', crash:'吊镲'};
// 每件乐器一个不被别的东西挡住的机位：看向点 xyz、方位角、俯仰角、距离、视角
const ISHOT = {
  kick:[0.05,-0.45,-0.3, 2.5,1.35,2.6,34], snare:[0.68,0.12,-0.35, 0.6,0.95,2.3,30], hihat:[1.1,0.35,-0.55, 1.15,1.0,2.3,30],
  tom1:[0.25,0.65,0.2, 0.2,1.05,2.3,30], tom2:[-0.25,0.65,0.2, -0.2,1.05,2.3,30], floor:[-0.85,0.05,-0.35, -0.95,1.0,2.3,30], crash:[0.9,1.15,0.1, 0.45,0.85,2.5,32]};
const pm1 = () => Math.random() < 0.5 ? -1 : 1, rnd = (a, b) => a + Math.random()*(b - a);
const SHOTS = {
  wide: ()=>({label:'全景', tg:new V3(0.1, 0.95, -0.4), th:rnd(0.5, 1.1), dth:0.3*pm1(), ph:1.18, r:7.2, dr:-0.8, fov:38}),
  face: ()=>({label:'特写 · 脸', tg:new V3(0, 1.3, -1.05), th:rnd(-0.35, 0.35), dth:0.1*pm1(), ph:1.4, r:2.9, dr:-0.3, fov:30, gaze:true}),
  back: ()=>({label:'背影', tg:new V3(0, 1.15, -0.9), th:Math.PI + rnd(-0.45, 0.45), dth:0.15*pm1(), ph:1.2, r:3.1, dr:0.25, fov:34}),
  top:  ()=>({label:'俯拍', tg:new V3(0.05, 0.3, -0.45), th:rnd(0, 6.28), dth:0.4*pm1(), ph:0.32, r:5.6, dr:-0.5, fov:38}),
  low:  ()=>({label:'仰拍', tg:new V3(0, 1.55, -0.85), th:rnd(-0.1, 0.6), dth:0.12*pm1(), ph:1.62, r:3.7, dr:-0.35, fov:42}),
  inst: k=>{ const q = ISHOT[k]; return {label:'特写 · ' + INAME[k], key:k, tg:new V3(q[0], q[1], q[2]), th:q[3] + rnd(-0.12, 0.12), dth:0.1*pm1(), ph:q[4], r:q[5], dr:-0.25, fov:q[6]}; },
};
const SHOT_W = [['inst', 3.2], ['wide', 2], ['face', 1.6], ['low', 1], ['back', 1], ['top', 0.8]];
const DIR = {on:false, w:0, shot:null, kind:'', t:0, len:4, cutReq:false, from:null, tt:0, pose:{pos:new V3(), look:new V3(), fov:FOV0}, cur:{pos:new V3(), look:new V3(), fov:FOV0}};
// 乐器特写拍哪件：看接下来这个镜头的时长里每件乐器要打几下，按次数抽（底鼓、踩镲太常响，打折扣），一下都不打的不拍
const INST_W = {kick:0.3, hihat:0.4, snare:1, tom1:1.4, tom2:1.4, floor:1.4, crash:1.6};
function pickInst(len){
  if(SONG.T < 0 || !SONG.events.length) return null;
  const t0 = songLocal(SONG.T), t1 = t0 + len*SONG.rate, w = {};
  for(const e of SONG.events){
    if(e.drop) continue;
    const t = e.t < t0 && SONG.loop ? e.t + SONG.dur : e.t;
    if(t >= t0 + 0.3 && t < t1) w[e.i] = (w[e.i] || 0) + 1;
  }
  const prev = DIR.shot && DIR.shot.key; let tot = 0;
  for(const k in w){ w[k] = ISHOT[k] && k !== prev ? Math.min(6, w[k])*(INST_W[k] || 1) : 0; tot += w[k]; }
  if(tot <= 0) return null;
  let x = Math.random()*tot;
  for(const k in w){ x -= w[k]; if(x <= 0 && w[k] > 0) return k; }
  return null;
}
function pickShot(force){
  let kind = force; DIR.len = rnd(5, 8.5);
  if(!kind){
    const opts = SHOT_W.filter(o=>o[0] !== DIR.kind || o[0] === 'inst');
    let x = opts.reduce((a, o)=>a + o[1], 0)*Math.random();
    for(const o of opts){ x -= o[1]; if(x <= 0){ kind = o[0]; break; } }
    kind = kind || 'wide';
  }
  let shot;
  if(kind === 'inst'){
    const k = pickInst(DIR.len);
    if(!k){ kind = 'wide'; shot = SHOTS.wide(); }
    else shot = SHOTS.inst(k);
  } else shot = SHOTS[kind]();
  if(DIR.shot && DIR.w > 0.5){                // 换镜头不硬切：从当前画面平滑运镜过去
    const C = DIR.cur; DIR.from = {look:C.look.clone(), off:C.pos.clone().sub(C.look), fov:C.fov}; DIR.tt = 0;
  } else DIR.from = null;
  DIR.shot = shot; DIR.kind = kind; DIR.t = 0; DIR.cutReq = false;
  if(shot.gaze) CH.gazeReq = 1;              // 脸部特写：她会看过来
}
function dirPose(o){
  const S = DIR.shot, u = Math.min(1, DIR.t/DIR.len) - 0.5, th = S.th + S.dth*u, r = S.r + S.dr*u, sp = Math.sin(S.ph);
  o.pos.set(S.tg.x + r*sp*Math.sin(th), S.tg.y + r*Math.cos(S.ph), S.tg.z + r*sp*Math.cos(th));
  if(o.pos.y < FLOOR_Y + 0.15) o.pos.y = FLOOR_Y + 0.15;
  o.look.copy(S.tg); o.fov = S.fov; return o;
}
// 运镜：看向点直线过去，机位绕看向点按球坐标走（方位角走近的那边），不会从鱿鱼身体里穿过去
const CAM_TR = 0.7, _o0 = new V3(), _o1 = new V3();
function blendShot(o, dt){
  const F = DIR.from; if(!F) return o;
  DIR.tt += dt; const u = Math.min(1, DIR.tt/CAM_TR), e = 0.5 - 0.5*Math.cos(Math.PI*u);   // 正弦缓入缓出：最快处不冲，收尾也不拖
  if(u >= 1){ DIR.from = null; return o; }
  _o1.subVectors(o.pos, o.look);
  const r0 = F.off.length(), r1 = _o1.length();
  const ph0 = Math.acos(Math.max(-1, Math.min(1, F.off.y/r0))), ph1 = Math.acos(Math.max(-1, Math.min(1, _o1.y/r1)));
  const th0 = Math.atan2(F.off.x, F.off.z); let dth = Math.atan2(_o1.x, _o1.z) - th0;
  dth = Math.atan2(Math.sin(dth), Math.cos(dth));
  const r = r0 + (r1 - r0)*e, ph = ph0 + (ph1 - ph0)*e, th = th0 + dth*e, sp = Math.sin(ph);
  o.look.lerpVectors(F.look, o.look, e);
  o.pos.set(o.look.x + r*sp*Math.sin(th), o.look.y + r*Math.cos(ph), o.look.z + r*sp*Math.cos(th));
  if(o.pos.y < FLOOR_Y + 0.15) o.pos.y = FLOOR_Y + 0.15;
  o.fov = F.fov + (o.fov - F.fov)*e;
  return o;
}
function dirHit(I){                          // 到点了就在底鼓或军鼓那一下上切（吊镲不切，让人看完整个动作）
  if(!DIR.on || DIR.w < 0.5 || !DIR.shot) return;
  if(DIR.from) return;                       // 还在运镜途中就不再切
  if(DIR.cutReq && (I.key === 'kick' || I.key === 'snare')) pickShot();
}
function setDirector(on){ DIR.on = on; emit('state', state()); }
// 手动拖动、平移或缩放时，导播把镜头交回给你：按当前画面换算成轨道相机的参数，画面不会跳
const _hv = new V3();
function handOff(){
  if(DIR.w < 0.01) return;
  const C = DIR.cur, d = _hv.subVectors(C.pos, C.look), dist = d.length() || 1;
  orbit.target.copy(C.look); clampTarget();
  orbit.r = clampR(dist*Math.tan(C.fov*Math.PI/360)/Math.tan(FOV0*Math.PI/360));
  orbit.ph = clampPh(Math.acos(Math.max(-1, Math.min(1, d.y/dist))));
  orbit.th = Math.atan2(d.x, d.z);
  DIR.w = 0; DIR.shot = null; DIR.from = null; setDirector(false);
}
function updateCamera(dt){
  orbitPose(UPOSE);
  const want = DIR.on && playing, C = DIR.cur;
  if(want && !DIR.shot) pickShot('wide');
  DIR.w = want ? Math.min(1, DIR.w + dt/0.8) : Math.max(0, DIR.w - dt/0.8);
  if(want){
    DIR.t += dt;
    if(DIR.t > DIR.len) DIR.cutReq = true;
    if(DIR.t > DIR.len + 1.2) pickShot();    // 一直没等到重拍也照切
  }
  if(DIR.w > 0 && DIR.shot){
    blendShot(dirPose(DIR.pose), dt);
    const e = DIR.w*DIR.w*(3 - 2*DIR.w);
    C.pos.lerpVectors(UPOSE.pos, DIR.pose.pos, e); C.look.lerpVectors(UPOSE.look, DIR.pose.look, e); C.fov = UPOSE.fov + (DIR.pose.fov - UPOSE.fov)*e;
  } else {
    C.pos.copy(UPOSE.pos); C.look.copy(UPOSE.look); C.fov = UPOSE.fov;
    if(!want) DIR.shot = null;
  }
  applyCam(C.pos, C.look, C.fov);
  const lab = DIR.w > 0.5 && DIR.shot ? '导播 · ' + DIR.shot.label : '用户透视';
  if(camLabel !== lab){ camLabel = lab; emit('camera', lab); }
}

// ---------- 主循环 ----------
let last = performance.now(), skinClock = 0, memAcc = 0, fpsN = 0, fpsT = 0, FPS = 0, CAP = 0, lastDraw = 0;
let HOLD = false;        // 开场页盖着舞台时：照常模拟，但不渲染，省显卡
function frame(now){
  requestAnimationFrame(frame);
  if(CAP){                                                  // 帧率上限：按时间表画，没到时间就跳过这一帧
    const iv = 1000/CAP; if(now - lastDraw < iv - 2) return;
    lastDraw = now - lastDraw < 2*iv ? lastDraw + iv : now;  // 累加而不是对齐到 now，高刷屏或帧间隔不均时才不会掉一大截；落后太多就重新对齐
  }
  const raw = (now-last)/1000, dt = Math.min(1/20, raw); last = now; FDT = dt;
  fpsN++; fpsT += raw;
  if(fpsT >= 0.5){ FPS = Math.round(fpsN/fpsT); fpsN = 0; fpsT = 0; }   // 实测帧率，调节页里显示
  simT += dt;
  if(playing) advanceSong(Math.min(0.25, raw));             // 歌曲时钟走真实时间（卡一下也不拖慢节拍），只有物理模拟截断步长
  const lidA = updateCharacter(dt);
  body.position.copy(bodyBase); body.position.y += Math.sin(simT*1.3)*0.035 + CH.dip.x;
  body.rotation.set(CH.roll.x, -Math.PI/2 + CH.yaw.x, CH.nod.x + 0.02*Math.sin(simT*0.9));
  const br = Math.sin(simT*2.3), sq = CH.sq.x;              // 呼吸：外套膜径向收缩，漏斗反向鼓起；再叠加挤压拉伸
  mantleG.scale.set((1 + 0.04*br)*(1 - 0.5*sq), (1 - 0.012*br)*(1 + sq), (1 + 0.04*br)*(1 - 0.5*sq));
  const cl = v => Math.max(-0.25, Math.min(0.25, v));
  const dn = CH.lagNod.x - CH.nod.x, dr = CH.lagRoll.x - CH.roll.x;
  mantleG.rotation.set(cl(dr*0.35), 0, cl(dn*0.4));                      // 一小部分整体倾斜，大部分靠弯曲
  SOFT.bx = cl(-dn*1.7); SOFT.bz = cl(dr*1.5); SOFT.tw = cl((CH.lagYaw.x - CH.yaw.x)*1.6);
  updateSoftMantle(dt, simT);
  funnel.scale.set(1 - 0.18*br, 1, 1 - 0.18*br);
  updateFins(simT); updateEyes(lidA);
  skinClock += dt; if(skinClock > 0.09){ skinClock = 0; paintSkin(SKIN_M, simT); paintSkin(SKIN_H, simT*1.1 + 3); }
  body.updateMatrixWorld();
  updateOrgans(dt);

  for(const L of limbs){
    updateBase(L);
    if(playing && !L.rest){
      L.nextHit.t = simT + (L.nextHit.tAbs - SONG.T)/SONG.rate - 0.012;   // 拍到鼓面通常比算好的时间晚半帧，提前一点点
      if(simT > L.nextHit.t + Math.max(0.05, Math.min(0.25, 0.45*L.nextHit.gap/SONG.rate))){   // 没打中就跳过；落后太多（比如切到别的标签页又回来）就直接对齐到现在
        L.lastHit.p.copy(L.nextHit.p); L.lastHit.n.copy(L.nextHit.n); L.lastHit.t = L.nextHit.t;
        scheduleNext(L, L.nextHit.t < simT - 0.8 ? 'now' : undefined);
      }
    }
    if(L.manual && !playing && simT > L.nextHit.t + 0.3){ L.manual = false; L.lastHit.p.copy(L.nextHit.p); L.lastHit.n.copy(L.nextHit.n); L.lastHit.t = simT; }
    computeTarget(L, simT);
    solveIK(L, 10);
    fk(L, L.q, L.A, L.E, true);
    L.mid.addVectors(L.A, L.E).multiplyScalar(0.5);
    const ts = simT - L.contactT;      // 拍击后的压扁与回弹（阻尼弹簧）
    L.squash = ts < 0.6 ? Math.exp(-ts*9)*Math.cos(ts*30) : 0;
    L.tube.mesh.material.uniforms.flash.value = ts < 0.7 ? Math.exp(-ts*7) : 0;   // 拍中：尖端亮一下
  }
  separateLimbs(dt);
  for(const L of limbs){
    collideLimb(L);
    drawLimb(L);
    checkContact(L, dt);
  }
  updateArms(simT, dt);
  updateCape(dt, simT);
  updateFX(dt);

  memAcc += dt*180; const sub = Math.round(memAcc); memAcc -= sub;
  for(const d of drums){
    for(let s=0;s<sub;s++) stepMembrane(d);
    updateHead(d); updateRings(d, dt);
    d.shake *= Math.exp(-dt*18);
    d.g.position.copy(d.center).addScaledVector(d.n, -d.shake);
  }
  for(const c of cymbals){
    c.wobT += dt;
    const a = c.wobT < 3 ? c.wobAmp*Math.exp(-c.wobT*(c.kind==='crash' ? 2.2 : 9))*Math.cos(c.wobT*17) : 0;
    c.wob.quaternion.setFromAxisAngle(c.wobAxis, a);
  }
  drawLane();

  updateCamera(dt);
  updateSpot(dt);
  camera.updateMatrixWorld(); lightView.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  sortJelly();
  mantleG.updateMatrixWorld();
  post.uniforms.projInv.value.copy(camera.projectionMatrixInverse); post.uniforms.camWorld.value.copy(camera.matrixWorld);
  post.uniforms.pxA.value = camera.fov*Math.PI/180/H; post.uniforms.uT.value = simT;
  post.uniforms.mantleInv.value.copy(mantleG.matrixWorld).invert();
  if(HOLD) return;
  OPT.check(); OPT.prepass();
  renderer.setRenderTarget(rt); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
}
window.__dbg = {camera, orbit, body, limbs, arms:armDefs, INST, HITS, eyes, eyeLook, CH, ORGANS, STARS, JT, mantleG, DIR, pickShot, SHOTS, SPOT, FANS};
requestAnimationFrame(frame);

// ---------- 播放控制（按钮在界面那边，见文件末尾的 Squiddle 接口） ----------
function unlockAudio(){
  if(!actx) initAudio();
  return actx.resume().then(()=>{ if(playing) startSongAudio(); });
}
if(window.squiddleDesktop) unlockAudio();     // 桌面版：没有自动播放限制，打开就有声音
function resync(){ for(const L of limbs){ L.manual = false; L.lastHit.t = simT; scheduleNext(L, 'now'); } }
function state(){ return {playing, loop:SONG.loop, director:DIR.on, spot:SPOT.on}; }
function setPlaying(on){
  playing = on;
  for(const L of limbs) L.manual = false;
  if(on){ if(Math.abs(SONG.T) < 0.01) SONG.T = -LEAD; startSongAudio(); resync(); }
  else {
    stopSongAudio();
    for(const L of limbs){ const I = L.nextHit.inst; if(I){ L.lastHit.p.copy(L.mid).addScaledVector(I.n, -surfDist(I, L.mid)); L.lastHit.n.copy(I.n); } L.lastHit.t = simT; }
  }
  emit('state', state());
}
function seekTo(t){
  SONG.T = Math.max(0, Math.min(SONG.dur - 0.05, t));
  for(const e of SONG.events) e.hitIt = -1;
  if(playing){ startSongAudio(); resync(); }
}
function rewind(){
  for(const e of SONG.events) e.hitIt = -1;
  SONG.T = playing ? -LEAD : 0;
  if(playing){ startSongAudio(); resync(); }
}
function setLoop(on){
  if(on === SONG.loop) return;
  if(SONG.loop && SONG.T > 0) SONG.T = songLocal(SONG.T);
  SONG.loop = on; if(CUR){ CUR.loop = on; SAVE.put(CUR); }
  if(playing){ startSongAudio(); resync(); }
  emit('state', state());
}
const speedLabel = () => (SONG.mode === 'audio' ? '≈' : '') + Math.round(SONG.bpm*SONG.rate) + ' BPM';
function setSpeed(pct){         // 速度（百分比）：正在放歌就换个锚点接着算时间，直接改播放速度（音高跟着变）
  const r = pct/100;
  if(songSrc && SONG.T >= 0){
    const now = actx.currentTime;
    SONG.anchorT += (now - SONG.anchorCtx)*SONG.rate; SONG.anchorCtx = now;
    songSrc.playbackRate.setValueAtTime(r, now); SONG.rate = r;
  } else { SONG.rate = r; if(songSrc) startSongAudio(); }
  return speedLabel();
}
function setDrumVol(v){ drumVol = v/100; if(master) master.gain.setTargetAtTime(0.5*drumVol/0.7, actx.currentTime, 0.02); }
function setSongVol(v){ songVol = v/100; if(songGain) songGain.gain.setTargetAtTime(songVol, actx.currentTime, 0.02); }
function setTune(pct){ tuneMul = pct/100; }

// ---------- 星轨：时间往左流，鼓点是星星，左边那颗四芒星是“现在” ----------
const laneCv = document.getElementById('lane'), lc = laneCv.getContext('2d');
const LH = 44, PPS = 40, OW = 320, OH = 8;
let LW = 320, PHX = 76;
// 窄屏上星轨少显示几秒、像素放大一点，鼓点才看得清
// 星轨：高度固定 44 格，每格放大成整数倍的屏幕像素；宽度跟着窗口走，越宽看到的秒数越多
function fitLane(){ const w = laneCv.clientWidth || 960, k = Math.max(1, Math.round((laneCv.clientHeight || 88)/LH)), nw = Math.max(150, Math.round(w/k)); if(nw !== LW){ LW = nw; PHX = Math.round(nw*0.24); laneCv.width = nw; } }
fitLane(); new ResizeObserver(fitLane).observe(laneCv);
const LROW = {crash:8, hihat:15, snare:22, tom1:29, tom2:29, floor:29, kick:37};
const LCOL = {crash:'#e7c03c', hihat:'#f2e396', snare:'#ffffff', tom1:'#d2b2f5', tom2:'#ba83f0', floor:'#9b74e4', kick:'#f083a5'};
const LSZ = {hihat:2, snare:3, tom1:3, tom2:3, floor:3, kick:4};
const LFLASH = 0.1, LFADE = 0.8;                                // 鼓点过扫描线：闪 0.1 秒，再 0.8 秒暗成描边
const LFL = {crash:'#ffe28a', hihat:'#fff1b8', snare:'#ffd6ea', tom1:'#ecdcff', tom2:'#dcc4ff', floor:'#cdb6ff', kick:'#ffb3cf'};
const LDIM = {crash:'#7d6a35', hihat:'#857f60', snare:'#8d8bab', tom1:'#7a66a0', tom2:'#6c5596', floor:'#5f4f8c', kick:'#8c4d68'};
let _ls = 11; const lrand = ()=>((_ls = (_ls*16807) % 2147483647) - 1)/2147483646;
const SKY = Array.from({length:200}, ()=>({x:lrand()*1600, y:1 + Math.floor(lrand()*(LH - 2)), ph:lrand()*6.28, b:0.3 + 0.7*lrand()}));
const STAR7 = ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'];
const STAR5 = ['..#..', '.###.', '#####', '.###.', '..#..'], STAR5O = ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'];
function glyph(ctx, G, cx, cy, col){ ctx.fillStyle = col; const o = G.length >> 1; G.forEach((row, j)=>{ for(let i=0;i<row.length;i++) if(row[i] === '#') ctx.fillRect(cx - o + i, cy - o + j, 1, 1); }); }
function envAt(t){
  const E = SONG.env; if(!E || t < 0) return 0;
  if(SONG.loop) t = songLocal(t); else if(t > SONG.dur) return 0;
  const i = Math.floor(t/E.dt); return i < E.v.length ? E.v[i] : 0;
}
function drawLane(){
  const T = SONG.T, tA = T - PHX/PPS, tB = T + (LW - PHX)/PPS;
  const g = lc.createLinearGradient(0, 0, 0, LH); g.addColorStop(0, '#1e1f39'); g.addColorStop(1, '#363960');
  lc.fillStyle = g; lc.fillRect(0, 0, LW, LH);
  lc.fillStyle = 'rgba(176,164,255,0.14)';                      // 银河：歌的响度（或鼓点的疏密）
  for(let x=0; x<LW; x+=2){ const h = Math.round(envAt(tA + x/PPS)*(LH - 8)*0.5); if(h > 0) lc.fillRect(x, (LH >> 1) - h, 2, 2*h); }
  for(const st of SKY){                                          // 远处的星星慢慢漂
    const x = Math.floor(((st.x - T*5) % 1600 + 1600) % 1600); if(x >= LW) continue;
    const a = st.b*(0.25 + 0.3*Math.sin(simT*1.7 + st.ph));
    if(a > 0.05){ lc.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; lc.fillRect(x, st.y, 1, 1); }
  }
  const its = [];
  if(SONG.loop){ for(let it=Math.max(0, songIter(Math.max(0, tA))); it<=songIter(Math.max(0, tB)); it++) its.push(it); } else its.push(0);
  const B = SONG.beats;                                          // 小节线和拍点
  for(const it of its){
    const off = it*SONG.dur;
    for(let k=lbNum(B, tA - off); k<B.length && B[k] <= tB - off; k++){
      if(SONG.loop && B[k] >= SONG.dur - 1e-3) continue;
      const x = Math.round(PHX + (B[k] + off - T)*PPS), bar = ((k - SONG.bar0) % 4 + 4) % 4 === 0;
      lc.fillStyle = bar ? 'rgba(189,182,236,0.35)' : 'rgba(189,182,236,0.16)';
      for(let y = bar ? 2 : LH - 4; y < LH - 1; y += 2) lc.fillRect(x, y, 1, 1);
    }
  }
  const E = SONG.events;
  for(const it of its){
    const off = it*SONG.dur;
    for(let k=lowerBound(E, tA - off - 0.1); k<E.length && E[k].t <= tB - off + 0.1; k++){
      const e = E[k], x = Math.round(PHX + (e.t + off - T)*PPS), y = LROW[e.i], col = LCOL[e.i];
      const past = e.t + off < T - 0.02, lit = e.hitIt === it, fl = simT - e.hitAt;
      if(e.drop){                                                // 太挤、没打的：空心
        lc.globalAlpha = 0.45; lc.fillStyle = col; const z = 3;
        lc.fillRect(x - 1, y - 1, z, 1); lc.fillRect(x - 1, y + 1, z, 1); lc.fillRect(x - 1, y, 1, 1); lc.fillRect(x + 1, y, 1, 1);
        lc.globalAlpha = 1; continue;
      }
      const z = LSZ[e.i] || 3, age = T - (e.t + off), a0 = 0.42 + 0.4*e.v;
      if(age < 0){                                               // 还没到：照原样
        lc.globalAlpha = a0; if(e.i === 'crash') glyph(lc, STAR5, x, y, col); else { lc.fillStyle = col; lc.fillRect(x - (z >> 1), y - (z >> 1), z, z); }
      } else if(age < LFLASH){                                   // 经过扫描线：用自己颜色的亮色闪一下
        lc.globalAlpha = 1; const c = LFL[e.i];
        if(e.i === 'crash') glyph(lc, STAR5, x, y, c); else { const zz = z + 2; lc.fillStyle = c; lc.fillRect(x - (zz >> 1), y - (zz >> 1), zz, zz); }
      } else {                                                   // 然后 0.8 秒里慢慢暗成描边
        const u = Math.min(1, (age - LFLASH)/LFADE), k = u*u*(3 - 2*u);
        if(k < 1){ lc.globalAlpha = a0*(1 - k); if(e.i === 'crash') glyph(lc, STAR5, x, y, col); else { lc.fillStyle = col; lc.fillRect(x - (z >> 1), y - (z >> 1), z, z); } }
        lc.globalAlpha = 0.62*k; const dc = LDIM[e.i];
        if(e.i === 'crash') glyph(lc, STAR5O, x, y, dc);
        else { const zz = z + 2, o = zz >> 1; lc.fillStyle = dc; lc.fillRect(x - o, y - o, zz, 1); lc.fillRect(x - o, y - o + zz - 1, zz, 1); lc.fillRect(x - o, y - o, 1, zz); lc.fillRect(x - o + zz - 1, y - o, 1, zz); }
      }
      lc.globalAlpha = 1;
      if(lit && fl >= 0 && fl < 0.35){                            // 刚打中：一圈淡粉的小十字散开
        const r = 2 + Math.round(fl*14); lc.fillStyle = 'rgba(255,214,234,' + (1 - fl/0.35).toFixed(2) + ')';
        lc.fillRect(x - r, y, 1, 1); lc.fillRect(x + r, y, 1, 1); lc.fillRect(x, y - r, 1, 1); lc.fillRect(x, y + r, 1, 1);
      }
    }
  }
  lc.fillStyle = 'rgba(255,241,166,0.32)'; lc.fillRect(PHX, 0, 1, LH);   // 播放头
  glyph(lc, STAR7, PHX, 4, '#5e2553'); glyph(lc, ['.#.', '###', '.#.'], PHX, 4, '#e7c03c');
  lc.fillStyle = '#e7c03c'; lc.fillRect(PHX, 1, 1, 7); lc.fillRect(PHX - 3, 4, 7, 1); lc.fillStyle = '#f2e797'; lc.fillRect(PHX, 4, 1, 1);
}
const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s/60), ss = Math.floor(s % 60); return m + ':' + String(ss).padStart(2, '0'); };

// ---------- 曲目单 ----------
const INST_CN = {kick:'底鼓', snare:'军鼓', hihat:'踩镲', crash:'吊镲', tom1:'高嗵', tom2:'中嗵', floor:'落地嗵'};
function libInfo(){ return LIB.map((S, i)=>({i, name:S.name, kind:S.kind, dur:S.dur, bpm:Math.round(S.bpm), current:S === CUR})); }
function songInfo(){
  const n = SONG.events.filter(e=>!e.drop).length;
  return {name:SONG.name, kind:SONG.kind, mode:SONG.mode, dur:SONG.dur, loop:SONG.loop, rate:SONG.rate, speedLabel:speedLabel(),
    meta:SONG.kind + ' · ' + (SONG.mode === 'audio' ? '约 ' : '') + Math.round(SONG.bpm) + ' BPM · ' + n + ' 下'};
}
function updateTrackUI(){ emit('song', songInfo()); emit('lib', libInfo()); emit('state', state()); }
function loadSong(S, autoplay){
  stopSongAudio(); applySong(S); updateTrackUI(); resync();
  SAVE.last(S);
  if(S.mode === 'audio' && !S.buffer && S.audioData) decodeStored(S);
  if(autoplay || playing) setPlaying(true);
}
// 存起来的歌只存了原文件，用到时再解码
function decodeStored(S){
  if(S.decoding) return; S.decoding = true;
  if(!actx) initAudio();
  job('解码中…', 0.3);
  actx.decodeAudioData(S.audioData.slice(0), buf=>{
    S.buffer = buf; S.decoding = false; job(null);
    if(CUR === S){ SONG.buffer = buf; if(playing){ startSongAudio(); resync(); } }
  }, ()=>{ S.decoding = false; job(null); msg('“' + S.name + '” 的音频解不开了，重新拖进来试试。', true); });
}
function summary(S){
  const c = {}; let drop = 0;
  for(const e of S.events){ if(e.drop){ drop++; continue; } c[e.i] = (c[e.i] || 0) + 1; }
  return Object.keys(INST_CN).filter(k=>c[k]).map(k=>INST_CN[k] + ' ' + c[k]).join('、') + (drop ? '；另有 ' + drop + ' 下太挤，没打' : '');
}
function job(txt, p){ emit('job', txt === null ? null : {txt, p}); }
function msg(txt, err){ emit('msg', {txt, err:!!err}); }
function addAndPlay(S, replace){
  prepSong(S);
  const i = replace ? LIB.findIndex(replace) : -1;
  if(i >= 0){ S.uid = LIB[i].uid; S.order = LIB[i].order; LIB[i] = S; } else LIB.push(S);
  SAVE.put(S);
  loadSong(S, true);
}

// ---------- 读文件 ----------
let jobId = 0;
const nextTick = () => new Promise(r=>setTimeout(r, 0));
async function handleFile(f){
  if(!f) return;
  const my = ++jobId, name = f.name.replace(/\.[^.]+$/, '') || f.name, ext = (f.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
  msg('');
  try{
    let S;
    if(['mid', 'midi', 'kar', 'rmi', 'smf'].includes(ext) || /midi/.test(f.type)){
      S = parseMidi(await f.arrayBuffer());
    } else if(['txt', 'tab', 'text'].includes(ext) || f.type.startsWith('text/')){
      S = parseTab(await f.text());
    } else if(f.type.startsWith('audio/') || f.type.startsWith('video/') || ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'webm', 'mp4'].includes(ext)){
      if(f.size > 80e6) throw new Error('这个文件太大了（超过 80 MB），先转成 mp3 再试。');
      if(!actx) initAudio();
      job('解码中…', 0.02);
      const ab = await f.arrayBuffer(), keep = ab.slice(0);
      let buf;
      try{ buf = await new Promise((res, rej)=>actx.decodeAudioData(ab, res, rej)); }
      catch(_){ throw new Error('浏览器解不开这个音频格式，换成 mp3 或 wav 试试。'); }
      if(my !== jobId) return;
      if(buf.duration > 600) throw new Error('这首歌超过 10 分钟了，先剪短一点再试。');
      S = await analyzeAudio(buf, p=>{ if(my === jobId) job('正在听这首歌…', 0.05 + 0.95*p); });
      S.audioData = keep; S.mime = f.type;
    } else throw new Error('认不出这个文件。支持歌曲（mp3、wav、m4a、ogg、flac）、MIDI（.mid）和文本鼓谱（.txt）。');
    if(my !== jobId) return;
    job(null);
    S.name = name; addAndPlay(S);
    const head = S.mode === 'audio' ? '听出来大约 ' + Math.round(S.bpm) + ' BPM，自动编了一套鼓：' : (S.auto ? '这个 MIDI 没有鼓轨，照着音符编了一套鼓：' : '');
    msg('“' + name + '” ' + head + summary(S) + '。');
  } catch(err){
    if(my !== jobId) return;
    job(null); msg(err && err.message ? err.message : '读不了这个文件。', true);
  }
}
function loadTabText(text){
  try{
    const S = parseTab(text); S.name = '粘贴的鼓谱'; S.pasted = true;
    addAndPlay(S, X=>X.pasted); msg('照着粘贴的鼓谱打：' + summary(S) + '。'); return true;
  } catch(err){ msg(err.message, true); return false; }
}

// ---------- 文本鼓谱：每行一件乐器，x/o 一下，- 空拍，竖线分小节 ----------
const TAB_ALIAS = {bd:'kick', b:'kick', k:'kick', kd:'kick', kick:'kick', bass:'kick', '底鼓':'kick', '底':'kick',
  sd:'snare', s:'snare', sn:'snare', snare:'snare', '军鼓':'snare', '军':'snare',
  hh:'hihat', h:'hihat', hat:'hihat', hihat:'hihat', 'hi-hat':'hihat', '踩镲':'hihat', '踩':'hihat',
  rd:'ride', r:'ride', ride:'ride', '叮叮镲':'ride',
  cc:'crash', c:'crash', cr:'crash', crash:'crash', '吊镲':'crash', '吊':'crash',
  t1:'tom1', ht:'tom1', t:'tom1', tom1:'tom1', '高嗵':'tom1', '高':'tom1',
  t2:'tom2', mt:'tom2', tom2:'tom2', '中嗵':'tom2', '中':'tom2',
  ft:'floor', t3:'floor', lt:'floor', f:'floor', floor:'floor', '落地嗵':'floor', '落地':'floor'};
function parseTab(text){
  const evs = [], beats = []; let first = 0, cur = 100, t0 = 0, sys = [];
  const flush = ()=>{
    if(!sys.length) return;
    const spb = 60/cur; let nBars = 0;
    for(const row of sys){
      let segs = row.pat.split('|').map(x=>x.replace(/\s+/g, '')).filter(x=>x.length);
      if(!row.pat.includes('|') && segs.length === 1 && segs[0].length > 16) segs = segs[0].match(/.{1,16}/g);
      row.segs = segs; nBars = Math.max(nBars, segs.length);
    }
    for(const row of sys) row.segs.forEach((seg, b)=>{
      const n = seg.length;
      for(let j=0; j<n; j++){
        const ch = seg[j]; if('-._'.includes(ch)) continue;
        const t = t0 + (b*4 + 4*j/n)*spb, up = ch !== ch.toLowerCase(), ghost = ch === 'g' || ch === 'G';
        let i = row.inst, v = ghost ? 0.35 : up ? 1 : 0.8, r, a;
        if(i === 'ride'){ i = 'hihat'; r = 0.35; v *= 0.85; }
        else if(i === 'hihat' && (ch === 'o' || ch === 'O')){ r = 0.78; v = Math.max(v, 0.9); }
        if(i === 'snare' && ghost){ r = 0.45; a = 0.6; }
        evs.push(EV(t, i, v, r, a));
      }
    });
    for(let k=0; k<nBars*4; k++) beats.push(t0 + k*spb);
    t0 += nBars*4*spb; sys = [];
  };
  for(const raw of String(text).split(/\r?\n/)){
    const line = raw.trim();
    const mt = line.match(/^(?:bpm|tempo|速度)\s*[:=：]?\s*(\d{2,3}(?:\.\d+)?)/i);
    if(mt){ flush(); cur = Math.max(30, Math.min(300, +mt[1])); if(!first) first = cur; continue; }
    const m = line.match(/^([^\s|:：]+)\s*[|:：]?\s*(.*)$/), inst = m && TAB_ALIAS[m[1].toLowerCase()];
    if(inst && /^[xXoO#*gGfF●\-._|\s]+$/.test(m[2]) && /[xXoO#*gGfF●\-]/.test(m[2])){ sys.push({inst, pat:m[2]}); continue; }
    flush();
  }
  flush();
  if(!evs.length) throw new Error('没找到鼓谱。每行开头写乐器名，后面接 x 和 -，比如 HH|x-x-x-x-|');
  beats.push(t0);
  return {mode:'score', kind:'鼓谱', bpm:first || cur, dur:t0, loop:true, events:evs, beats, bar0:0};
}

// ---------- MIDI：通用鼓位（第 10 通道）对到七件鼓镲上 ----------
// [乐器, 力度系数, 落点半径]：叮叮镲归踩镲，叮叮镲铃铛归吊镲中心（钟声），侧击打军鼓边
const GM = {35:['kick'], 36:['kick'], 37:['snare', 0.45, 0.88], 38:['snare'], 39:['snare', 0.85, 0.5], 40:['snare', 1],
  41:['floor'], 43:['floor'], 45:['tom2'], 47:['tom2'], 48:['tom1'], 50:['tom1'],
  42:['hihat'], 44:['hihat', 0.5], 46:['hihat', 1, 0.78], 51:['hihat', 0.75, 0.35], 59:['hihat', 0.75, 0.35], 53:['crash', 0.8, 0.12],
  49:['crash'], 57:['crash'], 52:['crash'], 55:['crash', 0.75], 54:['hihat', 0.5], 56:['hihat', 0.6]};
function parseMidi(ab){
  const d = new DataView(ab), len = d.byteLength; let p = 0;
  if(len < 14) throw new Error('这个 MIDI 文件是空的。');
  const tag = q => q + 4 <= len ? String.fromCharCode(d.getUint8(q), d.getUint8(q+1), d.getUint8(q+2), d.getUint8(q+3)) : '';
  if(tag(0) === 'RIFF'){ for(let q=12; q+8<len; q++) if(tag(q) === 'MThd'){ p = q; break; } }
  if(tag(p) !== 'MThd') throw new Error('这不是 MIDI 文件。');
  const hl = d.getUint32(p+4), ntr = d.getUint16(p+10), div = d.getUint16(p+12);
  p += 8 + hl;
  const tpq = div & 0x8000 ? 0 : div, tps = div & 0x8000 ? (256 - (div >> 8))*(div & 0xff) : 0;
  const notes = [], tempos = [], sigs = [];
  const vlq = ()=>{ let v = 0, b; do{ b = d.getUint8(p++); v = v*128 + (b & 0x7f); } while((b & 0x80) && p < len); return v; };
  for(let tr=0; tr<ntr && p + 8 <= len; tr++){
    const id = tag(p), tl = d.getUint32(p+4); p += 8;
    const end = Math.min(len, p + tl);
    if(id === 'MTrk'){
      let tick = 0, run = 0;
      try{
        while(p < end){
          tick += vlq();
          let st = d.getUint8(p);
          if(st & 0x80) p++; else if(run) st = run; else break;
          if(st === 0xff){
            const ty = d.getUint8(p++), l = vlq();
            if(ty === 0x51 && l >= 3) tempos.push({tick, us:(d.getUint8(p) << 16) | (d.getUint8(p+1) << 8) | d.getUint8(p+2)});
            else if(ty === 0x58 && l >= 2) sigs.push({tick, num:d.getUint8(p), den:1 << d.getUint8(p+1)});
            p += l; if(ty === 0x2f) break;
          } else if(st === 0xf0 || st === 0xf7){ p += vlq(); }
          else {
            run = st; const hi = st & 0xf0, a = d.getUint8(p++), b = (hi === 0xc0 || hi === 0xd0) ? 0 : d.getUint8(p++);
            if(hi === 0x90 && b > 0) notes.push({tick, ch:st & 15, n:a, v:b/127});
          }
        }
      } catch(_){ /* 截断的轨道：读到哪算哪 */ }
    }
    p = end;
  }
  if(!notes.length) throw new Error('这个 MIDI 里没有音符。');
  tempos.sort((a, b)=>a.tick - b.tick);
  if(!tempos.length || tempos[0].tick > 0) tempos.unshift({tick:0, us:500000});
  const seg = []; let sec = 0;
  tempos.forEach((tp, i)=>{ if(i) sec += (tp.tick - tempos[i-1].tick)*tempos[i-1].us/1e6/(tpq || 1); seg.push({tick:tp.tick, sec, us:tp.us}); });
  const t2s = tick => { if(tps) return tick/tps; let g = seg[0]; for(const x of seg){ if(x.tick <= tick) g = x; else break; } return g.sec + (tick - g.tick)*g.us/1e6/tpq; };
  const qn = tpq || Math.round(tps/2);                 // SMPTE 时间码的文件按 120 BPM 数拍子
  sigs.sort((a, b)=>a.tick - b.tick);
  const barQ = sigs[0] ? sigs[0].num*4/sigs[0].den : 4;
  let lastTick = 0; for(const n of notes) if(n.tick > lastTick) lastTick = n.tick;
  const nBeats = Math.max(barQ, Math.ceil((lastTick/qn + 0.05)/barQ)*barQ), beats = [];
  for(let k=0; k<=nBeats; k++) beats.push(t2s(k*qn));
  const dur = beats[nBeats], bpm = tps ? 120 : 60e6/seg[0].us;
  const drums = notes.filter(n=>n.ch === 9 && GM[n.n]);
  let evs, auto = false;
  if(drums.length >= 8) evs = drums.map(n=>{ const g = GM[n.n]; return EV(t2s(n.tick), g[0], (0.25 + 0.75*n.v)*(g[1] === undefined ? 1 : g[1]), g[2]); });
  else { auto = true; evs = arrange(notesInput(notes.filter(n=>n.ch !== 9).map(n=>({t:t2s(n.tick), n:n.n, v:n.v})), dur, beats)); }
  if(!evs.length) throw new Error('这个 MIDI 里找不到能打的节奏。');
  return {mode:'score', kind:'MIDI', bpm, dur, loop:dur < 20, events:evs, beats, bar0:0, auto};
}
// 没有鼓轨的 MIDI：把音符按音高分到低、中、高三档，当作“起音”交给自动编鼓
function notesInput(notes, dur, beats){
  const FPS = 100, F = Math.ceil(dur*FPS) + 2, SL = [new Float32Array(F), new Float32Array(F), new Float32Array(F)];
  for(const n of notes){ const b = n.n < 52 ? 0 : n.n < 72 ? 1 : 2, f = Math.min(F - 1, Math.max(0, Math.round(n.t*FPS))); SL[b][f] = Math.max(SL[b][f], 1.3 + 1.5*n.v); }
  return {dur, beats, bar0:0, flatSpread:5,
    sal:(b, t)=>{ const a = Math.max(0, Math.floor((t - 0.035)*FPS)), z = Math.min(F - 1, Math.ceil((t + 0.035)*FPS)); let m = 0; for(let f=a; f<=z; f++) if(SL[b][f] > m) m = SL[b][f]; return m; },
    barRaw:(t0, t1)=>{ let c = 0; for(const n of notes) if(n.t >= t0 && n.t < t1) c++; return c ? 20*Math.log10(1 + c) : null; }};
}

// ---------- 自动编鼓：拍点 + 三个频段的起音强度 + 每小节有多响 → 一套鼓 ----------
function arrange(o){
  const {dur, beats, bar0, sal} = o, nb = beats.length, Ps = (beats[nb-1] - beats[0])/Math.max(1, nb - 1);
  const bt = k => k < 0 ? beats[0] + k*Ps : k >= nb ? beats[nb-1] + (k - nb + 1)*Ps : beats[k];
  const s0 = bar0 - 4*Math.ceil(bar0/4), bars = [];
  for(let b=0; b<3000; b++){
    const k = s0 + 4*b, t0 = bt(k); if(t0 >= dur - 0.1) break;
    const ts = []; for(let j=0; j<=16; j++){ const kk = k + (j >> 2), ta = bt(kk); ts.push(ta + (j & 3)/4*(bt(kk + 1) - ta)); }
    const raw = o.barRaw(Math.max(0, t0), Math.min(dur, ts[16]));
    bars.push({ts, raw, silent:raw === null});
  }
  const vals = bars.filter(B=>!B.silent).map(B=>B.raw).sort((a, b)=>a - b);
  if(!vals.length) return [];
  const lo = vals[Math.floor(vals.length*0.1)], hi = vals[Math.min(vals.length - 1, Math.floor(vals.length*0.95))];
  const base = hi - lo < o.flatSpread ? 0.55 : 0;      // 从头响到尾的歌：别硬分出“安静段”
  for(const B of bars) B.lv = B.silent ? 0 : Math.max(0, Math.min(1, base + (1 - base)*(B.raw - lo)/Math.max(1e-6, hi - lo)));
  // 段落突然变响、或者每八小节，打一下吊镲
  const first = bars.findIndex(B=>!B.silent); let last = -99;
  bars.forEach((B, b)=>{
    if(B.silent || b < first) return;
    const P = bars[b-1], fresh = !P || P.silent;
    const jump = fresh ? B.lv >= 0.45 : (B.lv - P.lv >= 0.22 && B.lv >= 0.5);
    const phrase = (b - first) % 8 === 0 && B.lv >= 0.7;
    if((jump || phrase) && b - last >= 4){ B.crash = true; last = b; }
  });
  const evs = [];
  bars.forEach((B, b)=>{
    if(B.silent) return;
    const T = B.ts, lv = B.lv, k = 0.75 + 0.25*lv, N = bars[b+1], quiet = lv < 0.35;
    const fill = !!(N && N.crash && !N.silent && lv >= 0.3);   // 吊镲前一小节的后两拍：嗵鼓过门
    const kicks = new Set();
    for(let j=0; j<16; j++){ if(fill && j > 8) continue; if(sal(0, T[j]) > (j & 1 ? 1.9 : 1.15)) kicks.add(j); }
    if(!quiet || B.crash) kicks.add(0);
    if(fill) kicks.add(14);
    for(const j of kicks) evs.push(EV(T[j], 'kick', (j === 0 ? 0.95 : 0.55 + 0.1*Math.min(3, sal(0, T[j])))*k));
    if(B.crash) evs.push(EV(T[0], 'crash', 1));
    const hhEnd = fill ? 8 : 16, step = quiet ? 4 : 2;
    for(let j = B.crash ? step : 0; j < hhEnd; j += step){
      const open = j % 4 === 2 && sal(2, T[j]) > 2.6;
      evs.push(EV(T[j], 'hihat', (j % 4 === 0 ? 0.72 : 0.5)*k + (open ? 0.25 : 0), open ? 0.78 : undefined));
    }
    if(lv >= 0.6) for(let j=1; j<hhEnd; j+=2) if(sal(2, T[j]) > 2.4) evs.push(EV(T[j], 'hihat', 0.4*k));
    if(!quiet || sal(1, T[4]) > 1.6 || sal(1, T[12]) > 1.6) for(const j of [4, 12]) if(!(fill && j === 12)) evs.push(EV(T[j], 'snare', (quiet ? 0.55 : 0.9)*k));
    if(lv >= 0.5){ let g = 0; for(let j=1; j<16 && g<2; j++){ if(j === 4 || j === 12 || kicks.has(j) || (fill && j >= 8)) continue; if(sal(1, T[j]) > 2.2){ evs.push(EV(T[j], 'snare', 0.35, 0.45, 0.6)); g++; } } }
    if(fill) evs.push(EV(T[8], 'tom1', 0.8*k), EV(T[10], 'tom1', 0.85*k, 0.4), EV(T[12], 'tom2', 0.9*k), EV(T[14], 'floor', 0.95*k), EV(T[15], 'floor', 0.9*k, 0.45));
    else if(lv >= 0.75 && (b - first) % 4 === 3) evs.push(EV(T[14], 'floor', 0.75*k));
  });
  return evs.filter(e=>e.t >= 0 && e.t < dur);
}

// ---------- 听歌：三个频段的起音 → 速度、拍点、强拍 → 自动编鼓 ----------
function biqC(type, f, Q, sr){
  const w = 2*Math.PI*f/sr, cs = Math.cos(w), al = Math.sin(w)/(2*Q), a0 = 1 + al, lp = type === 'lowpass';
  const b0 = (lp ? 1 - cs : 1 + cs)/2, b1 = lp ? 1 - cs : -(1 + cs);
  return [b0/a0, b1/a0, b0/a0, -2*cs/a0, (1 - al)/a0];
}
// 两节二阶滤波串起来，每 HOP 个采样算一个均方根
function runBand(st, c0, c1, f0, f1, HOP, out){
  const b0 = st[0], b1 = st[1], b2 = st[2], a1 = st[3], a2 = st[4], B0 = st[9], B1 = st[10], B2 = st[11], A1 = st[12], A2 = st[13];
  let x1 = st[5], x2 = st[6], y1 = st[7], y2 = st[8], X1 = st[14], X2 = st[15], Y1 = st[16], Y2 = st[17];
  for(let f=f0; f<f1; f++){
    let acc = 0;
    for(let i=f*HOP, e=i+HOP; i<e; i++){
      const x = 0.5*(c0[i] + c1[i]);
      const y = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2; x2 = x1; x1 = x; y2 = y1; y1 = y;
      const z = B0*y + B1*X1 + B2*X2 - A1*Y1 - A2*Y2; X2 = X1; X1 = y; Y2 = Y1; Y1 = z;
      acc += z*z;
    }
    out[f] = Math.sqrt(acc/HOP);
  }
  st[5] = x1; st[6] = x2; st[7] = y1; st[8] = y2; st[14] = X1; st[15] = X2; st[16] = Y1; st[17] = Y2;
}
async function analyzeAudio(buf, prog){
  const sr = buf.sampleRate, c0 = buf.getChannelData(0), c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : c0;
  const HOP = Math.round(sr/100), FPS = sr/HOP, F = Math.floor(buf.length/HOP), dur = buf.duration;
  if(F < 400) throw new Error('这段音频太短了，至少要几秒钟。');
  const mk = (p, q) => Float64Array.from([...p, 0, 0, 0, 0, ...q, 0, 0, 0, 0]);
  const ST = [mk(biqC('lowpass', 110, 0.7, sr), biqC('lowpass', 110, 0.7, sr)),       // 低：底鼓、贝斯
              mk(biqC('highpass', 200, 0.7, sr), biqC('lowpass', 3500, 0.7, sr)),     // 中：军鼓、人声、吉他
              mk(biqC('highpass', 6500, 0.7, sr), biqC('highpass', 6500, 0.7, sr))];  // 高：镲
  const R = [0, 1, 2, 3].map(()=>new Float32Array(F));
  for(let f0=0; f0<F; f0+=500){
    const f1 = Math.min(F, f0 + 500);
    for(let b=0; b<3; b++) runBand(ST[b], c0, c1, f0, f1, HOP, R[b]);
    for(let f=f0; f<f1; f++){ let a = 0; for(let i=f*HOP, e=i+HOP; i<e; i++){ const x = 0.5*(c0[i] + c1[i]); a += x*x; } R[3][f] = Math.sqrt(a/HOP); }
    prog(0.85*f1/F); await nextTick();
  }
  const pct = (A, q) => { const so = Float32Array.from(A).sort(); return so[Math.min(so.length - 1, Math.floor(q*so.length))]; };
  // 对数压缩后的正向差分 = 每个频段的“起音强度”；再除以前后 0.6 秒的平均，得到相对强度（>1 算一次起音）
  const FL = [0, 1, 2].map(b=>{
    const r = R[b], ref = pct(r, 0.95) + 1e-9, e = new Float32Array(F), fl = new Float32Array(F);
    for(let f=0; f<F; f++) e[f] = Math.log(1 + 20*r[f]/ref);
    for(let f=2; f<F; f++) fl[f] = Math.max(0, e[f] - e[f-2]);
    return fl;
  });
  const SAL = FL.map(fl=>{
    const cs = new Float64Array(F + 1); for(let f=0; f<F; f++) cs[f+1] = cs[f] + fl[f];
    const gm = cs[F]/F, sl = new Float32Array(F);
    for(let f=0; f<F; f++){ const a = Math.max(0, f - 60), z = Math.min(F, f + 61); sl[f] = fl[f]/(1.4*(cs[z] - cs[a])/(z - a) + 0.3*gm + 1e-6); }
    return sl;
  });
  prog(0.9); await nextTick();
  // 速度：起音强度的自相关，偏向 120 BPM 附近，免得听成快一倍或慢一倍
  const mean = A => { let t = 0; for(let i=0; i<A.length; i++) t += A[i]; return t/A.length + 1e-9; };
  const o = new Float32Array(F), m0 = mean(FL[0]), m1 = mean(FL[1]), m2 = mean(FL[2]);
  for(let f=0; f<F; f++) o[f] = FL[0][f]/m0 + FL[1][f]/m1 + 0.5*FL[2][f]/m2;
  const om = mean(o); let sd = 0; for(let f=0; f<F; f++){ o[f] -= om; sd += o[f]*o[f]; } sd = Math.sqrt(sd/F) + 1e-9; for(let f=0; f<F; f++) o[f] /= sd;
  const LMIN = Math.floor(FPS*60/200), LMAX = Math.ceil(FPS*60/55), ac = new Float64Array(2*LMAX + 2), FA = Math.min(F, Math.round(FPS*240));
  for(let L=LMIN; L<=2*LMAX; L++){ let t = 0; for(let f=0; f+L<FA; f++) t += o[f]*o[f+L]; ac[L] = t/Math.max(1, FA - L); }
  let best = -1e9, bL = LMIN + 1;
  for(let L=LMIN+1; L<LMAX; L++){ const bp = 60*FPS/L, pr = Math.exp(-0.5*(Math.log2(bp/120)/0.9)**2), sc = (ac[L] + 0.5*ac[2*L])*pr; if(sc > best){ best = sc; bL = L; } }
  let P = bL; { const a = ac[bL-1], b = ac[bL], c = ac[bL+1], dd = a - 2*b + c; if(dd < 0) P = bL + 0.5*(a - c)/dd; }
  let bpm = 60*FPS/P; while(bpm < 72) bpm *= 2; while(bpm > 170) bpm /= 2; P = 60*FPS/bpm;
  // 拍点：动态规划，既要落在起音上，又要间隔接近一拍（允许慢慢漂）
  const lo = Math.max(1, Math.round(P*0.5)), hi = Math.round(P*2), pen = new Float64Array(hi + 1);
  for(let dd=lo; dd<=hi; dd++) pen[dd] = 300*Math.log(dd/P)**2;
  const sc = new Float64Array(F), bk = new Int32Array(F).fill(-1);
  for(let n=0; n<F; n++){
    let bv = -1e18, bm = -1;
    for(let m=Math.max(0, n - hi); m <= n - lo; m++){ const v = sc[m] - pen[n - m]; if(v > bv){ bv = v; bm = m; } }
    sc[n] = o[n] + (bm >= 0 ? bv : 0); bk[n] = bm;
  }
  let n = F - 1; { let bv = -1e18; for(let m=Math.max(0, F - Math.round(P)); m<F; m++) if(sc[m] > bv){ bv = sc[m]; n = m; } }
  const bf = []; while(n >= 0){ bf.push(n); n = bk[n]; } bf.reverse();
  const Ps = P/FPS, beats = bf.map(f=>f/FPS - 0.01);
  while(beats[0] > 0.02) beats.unshift(beats[0] - Ps);
  while(beats[beats.length - 1] < dur) beats.push(beats[beats.length - 1] + Ps);
  const fr = t => Math.round((t + 0.01)*FPS);
  const sal = (b, t) => { const c = fr(t), a = Math.max(0, c - 4), z = Math.min(F - 1, c + 4), S = SAL[b]; let m = 0; for(let f=a; f<=z; f++) if(S[f] > m) m = S[f]; return m; };
  // 强拍：底鼓多落在一、三拍，军鼓多落在二、四拍
  const par = [0, 0]; beats.forEach((t, k)=>{ par[k & 1] += sal(0, t) - sal(1, t); });
  const p2 = par[0] >= par[1] ? 0 : 1, q = [0, 0], eb = beats.map((t, k)=>{   // 每拍的平均响度
    const a = Math.max(0, fr(t)), z = Math.min(F, fr(k + 1 < beats.length ? beats[k + 1] : t + Ps)); let u = 0; for(let f=a; f<z; f++) u += R[3][f]; return Math.log(1e-4 + u/Math.max(1, z - a)); });
  const avg4 = k => (eb[k] + eb[k+1] + eb[k+2] + eb[k+3])/4;
  for(let k=p2; k<beats.length; k+=2){
    const jump = k >= 4 && k + 4 <= eb.length ? Math.max(0, avg4(k) - avg4(k - 4) - 0.1) : 0;   // 一、三拍里，往后四拍比往前四拍突然响起来的那一拍多半是小节头
    q[((k - p2) >> 1) & 1] += 0.1*(sal(0, beats[k]) + sal(1, beats[k]) + sal(2, beats[k])) + 40*jump;
  }
  const bar0 = p2 + (q[0] >= q[1] ? 0 : 2);
  const barRaw = (t0, t1) => { const a = Math.max(0, fr(t0)), z = Math.min(F, fr(t1)); if(z <= a) return null; let t = 0; for(let f=a; f<z; f++) t += R[3][f]; const m = t/(z - a); return m < 0.004 ? null : 20*Math.log10(m); };
  const evs = arrange({dur, beats, bar0, sal, barRaw, flatSpread:5});
  const env = {dt:0.1, v:new Float32Array(Math.max(1, Math.ceil(dur*10)))};
  for(let i=0; i<env.v.length; i++){ let m = 0; for(let f=i*10; f<Math.min(F, i*10 + 10); f++) m = Math.max(m, R[3][f]); env.v[i] = m; }
  const ref = pct(env.v, 0.98) + 1e-9; for(let i=0; i<env.v.length; i++) env.v[i] = Math.min(1, env.v[i]/ref);
  prog(1);
  if(!evs.length) throw new Error('这首歌太安静了，没找到能跟的节奏。');
  return {mode:'audio', kind:'歌曲', bpm, dur, loop:false, events:evs, beats, bar0, env, buffer:buf, auto:true};
}

// 曲目单里预先放一段示例鼓谱
const EXAMPLE_TAB = `BPM 108\nCC|x---------------|----------------|x---------------|----------------|\nHH|--x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-|--x-x-x-x-x-x-x-|x-x-x-x---------|\nSD|----o-------o---|----o-------o--g|----o-------o---|----o---o-------|\nT1|----------------|----------------|----------------|----------o-----|\nT2|----------------|----------------|----------------|------------o---|\nFT|----------------|----------------|----------------|--------------oo|\nBD|o-------o-o-----|o-----o-o-------|o-------o-o-----|o-----o---------|`;
try{ const EX = parseTab(EXAMPLE_TAB); EX.name = '示例鼓谱 · 四小节带过门'; EX.kind = '示例'; EX.uid = 'example'; LIB.push(prepSong(EX)); } catch(_){}

// 左键拖动旋转，右键 / 中键 / Shift+拖动平移，滚轮或双指缩放，双指一起拖平移；没拖动的左键单击 = 点选落点
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function aimAt(clientX, clientY){
  const rc = canvas.getBoundingClientRect();
  ndc.set(((clientX-rc.left)/rc.width)*2-1, -((clientY-rc.top)/rc.height)*2+1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(clickables, false)[0]; if(!hit) return;
  const I = hit.object.userData.inst, L = limbBy(OWNER[I.key]);
  emit('aim', {x:clientX, y:clientY, key:I.key});
  const loc = I.g.worldToLocal(hit.point.clone()); loc.y = I.y0;
  const rr = Math.hypot(loc.x, loc.z), lim = I.R*0.72; if(rr > lim){ loc.x *= lim/rr; loc.z *= lim/rr; }
  const nh = L.nextHit;
  if(!playing && !L.manual){                 // 暂停时：这条触手从现在的悬停姿势接着抬手，0.4 秒后拍下去，打完回到悬停，不自动播放
    L.manS0 = Math.min(1, Math.max(0, (simT - L.lastHit.t)/0.4)); L.lastHit.t = simT; nh.t = simT + 0.4; L.manual = true;
  }
  nh.inst = I; nh.n.copy(I.n); nh.v = 0.85; L.prevMidD = NaN;
  if(I.key === 'kick' || hit.object.userData.body) hitSpot(I, HIT_DEF[I.key][0], HIT_DEF[I.key][1], nh.p);   // 底鼓、点到鼓身：打默认的位置
  else I.g.localToWorld(nh.p.copy(loc));
  if(!playing){ CH.gaze = 0; CH.look.copy(nh.p); CH.lookT = 1.2; }   // 顺便转头看一眼要打的地方
}
const ptrs = new Map(); let moved = 0, pinch0 = 0, r0 = 0, panMode = false, mid0x = 0, mid0y = 0;
const _pr = new V3(), _pu = new V3();
function panBy(dx, dy){                      // 按屏幕方向平移看向点：手拖多少，画面就跟着走多少
  const h = canvas.clientHeight || 360, k = 2*clampR(orbit.r)*Math.tan(FOV0*Math.PI/360)*FOVK/h;
  _pr.setFromMatrixColumn(camera.matrixWorld, 0); _pu.setFromMatrixColumn(camera.matrixWorld, 1);
  orbit.target.addScaledVector(_pr, -dx*k).addScaledVector(_pu, dy*k); clampTarget();
}
canvas.addEventListener('contextmenu', e=>e.preventDefault());
canvas.addEventListener('mousedown', e=>{ if(e.button === 1) e.preventDefault(); });   // 中键拖动是平移，别触发浏览器的自动滚动
canvas.addEventListener('pointerdown', e=>{
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(ptrs.size === 1){ moved = 0; panMode = e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey; if(e.button === 1) e.preventDefault(); }
  if(ptrs.size === 2){ const [a,b] = [...ptrs.values()]; handOff(); pinch0 = Math.hypot(a.x-b.x, a.y-b.y) || 1; r0 = orbit.r; mid0x = (a.x+b.x)/2; mid0y = (a.y+b.y)/2; moved = 99; }
});
canvas.addEventListener('pointermove', e=>{
  const p = ptrs.get(e.pointerId); if(!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if(ptrs.size === 1){
    moved += Math.abs(dx) + Math.abs(dy);
    if(moved >= 5) handOff();               // 真拖起来才接管导播；单击点鼓不算
    if(panMode) panBy(dx, dy);
    else { orbit.th -= dx*0.008; orbit.ph = clampPh(orbit.ph - dy*0.006); }
  } else if(ptrs.size === 2){
    const [a,b] = [...ptrs.values()], mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
    orbit.r = clampR(r0*pinch0/(Math.hypot(a.x-b.x, a.y-b.y) || 1));
    panBy(mx - mid0x, my - mid0y); mid0x = mx; mid0y = my;     // 双指一起拖 = 平移
  }
});
function endPtr(e){
  if(e.type === 'pointerup' && ptrs.size === 1 && moved < 6 && !panMode && e.button === 0) aimAt(e.clientX, e.clientY);
  ptrs.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e=>{ e.preventDefault(); handOff(); orbit.r = clampR(orbit.r*Math.exp(e.deltaY*0.0012)); }, {passive:false});
Object.assign(window.__dbg, {SONG, LIB, loadSong, parseTab, parseMidi, analyzeAudio, handleFile, seekTo, setPlaying, clock:()=>[simT, SONG.T], setRearm:v=>{REARM=v;}, setLift:v=>{LIFT0=v;}, HITS});

// ---------- Squiddle：界面（js/ui.js）只通过这个接口和舞台打交道 ----------
// 事件：state {playing, loop, director, spot} · song {name, kind, mode, dur, loop, rate, speedLabel, meta} · lib [{i, name, kind, dur, bpm, current}]
//       hit {key, label, drum, vel, rn, x, z, speed, parts} · aim {x, y, key}（点中了鼓，屏幕坐标） · camera '导播 · 全景' · job {txt, p} | null · msg {txt, err}
// ---------- 省显卡：合并不动的零件 + 不动的影子只算一次 ----------
// 场景还是照原样一件件搭出来（改零件照旧改搭建代码）。搭好以后，同一个父节点下、同一种材质、自己从来不动的零件，
// 合成一块一起画；原件留在场景里（挪到第 31 层：不画，但点鼓的射线还能打到），每帧检查一遍：
// 哪件原件被代码动了（位置、旋转、缩放、显隐、材质、形状），它所在那块就自动拆回原样，所以以后加动画也不用改这里。
// 影子分两盏灯：直接挂在场景下、整场不动的零件，影子单独画进第二张影子图，只在开场和有零件拆回原样时画一次；
// 平时每帧只给会动的东西画影子。（three.js 这版的影子不认灯的图层，所以用"临时只让不动的零件投影、单独补画一帧"来做。）
const OPT = (()=>{
  const L_HIDE = 31;
  ray.layers.enable(L_HIDE);
  const sunS = new THREE.DirectionalLight(0xffffff, 0);        // 只投影、不打光
  sunS.position.copy(sun.position); sunS.target = sun.target; scene.add(sunS);
  sunS.castShadow = true; sunS.shadow.mapSize.copy(sun.shadow.mapSize);
  Object.assign(sunS.shadow.camera, {left:-6, right:6, top:6, bottom:-6, near:1, far:24}); sunS.shadow.camera.updateProjectionMatrix();
  sunS.shadow.bias = sun.shadow.bias; sunS.shadow.normalBias = sun.shadow.normalBias;
  sunS.shadow.autoUpdate = false; sunS.shadow.needsUpdate = false;
  const groups = [], statics = new Set(), dummy = new THREE.WebGLRenderTarget(1, 1);
  let staticDirty = true;
  const sig = g => Object.keys(g.attributes).sort().map(k => k + g.attributes[k].itemSize).join(',');
  // 材质按"长得一样"归类（搭建时每件零件各 new 一份材质）；着色器材质各有各的参数，只认同一个对象
  const hx = c => c ? c.getHex() : '';
  const msig = m => m.isShaderMaterial ? m.uuid : [m.type, hx(m.color), hx(m.emissive), m.map ? m.map.uuid : '', m.gradientMap ? m.gradientMap.uuid : '', m.side, m.vertexColors, m.opacity, m.fog, m.depthTest, m.depthWrite, m.polygonOffset, m.wireframe, m.visible].join('|');
  function eligible(o){
    if(!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o === floor || o === shadowCatcher || !o.parent) return false;
    if(Array.isArray(o.material) || (o.material.isShaderMaterial && !o.material.userData.mergeable) || o.material.transparent ||   // 自写着色器可能用局部坐标，只合并标了 mergeable 的
       o.renderOrder !== 0 || !o.visible || !o.layers.test(camera.layers)) return false;
    if(o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || JELLY.some(J=>J.m === o)) return false;
    const g = o.geometry; if(!g || !g.attributes.position || Object.keys(g.morphAttributes || {}).length) return false;   // 盒子、圆柱自带分组，单材质时不影响
    return true;
  }
  const snap = o => ({p:o.position.clone(), q:o.quaternion.clone(), s:o.scale.clone(), m:o.matrix.clone(), vis:o.visible, mat:o.material, ms:msig(o.material), geo:o.geometry, ver:o.geometry.attributes.position.version, ro:o.renderOrder});
  const changed = (o, k) => o.visible !== k.vis || o.material !== k.mat || msig(o.material) !== k.ms || o.geometry !== k.geo || o.renderOrder !== k.ro || o.geometry.attributes.position.version !== k.ver
    || !o.position.equals(k.p) || !o.quaternion.equals(k.q) || !o.scale.equals(k.s) || !o.matrix.equals(k.m);   // 有的零件直接改 matrix
  function mergeGeo(list){
    const g0 = list[0].geometry, names = Object.keys(g0.attributes), out = {}, idx = [];
    let nv = 0; for(const o of list) nv += o.geometry.attributes.position.count;
    for(const n of names) out[n] = new Float32Array(nv*g0.attributes[n].itemSize);
    const v = new V3(), nm = new THREE.Matrix3(); let base = 0;
    for(const o of list){
      const g = o.geometry, c = g.attributes.position.count; nm.getNormalMatrix(o.matrix);
      for(const n of names){
        const A = g.attributes[n], k = A.itemSize, O = out[n];
        for(let i=0; i<c; i++){
          if(n === 'position' || n === 'normal'){
            v.fromBufferAttribute(A, i); if(n === 'position') v.applyMatrix4(o.matrix); else v.applyMatrix3(nm).normalize();
            O[(base + i)*3] = v.x; O[(base + i)*3 + 1] = v.y; O[(base + i)*3 + 2] = v.z;
          } else for(let j=0; j<k; j++) O[(base + i)*k + j] = A.getComponent ? A.getComponent(i, j) : A.array[i*k + j];
        }
      }
      if(g.index){ const I = g.index.array; for(let i=0; i<I.length; i++) idx.push(I[i] + base); }
      else for(let i=0; i<c; i++) idx.push(base + i);
      base += c;
    }
    const m = new THREE.BufferGeometry();
    for(const n of names) m.setAttribute(n, new THREE.BufferAttribute(out[n], g0.attributes[n].itemSize, g0.attributes[n].normalized));
    m.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    m.computeBoundingSphere(); m.computeBoundingBox();
    return m;
  }
  function build(){
    const buckets = new Map();
    scene.traverse(o=>{
      if(!eligible(o)) return;
      const key = o.parent.uuid + '|' + msig(o.material) + '|' + o.castShadow + '|' + o.receiveShadow + '|' + o.frustumCulled + '|' + sig(o.geometry);
      if(o.matrixAutoUpdate) o.updateMatrix();
      if(!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(o);
    });
    for(const list of buckets.values()){
      const P = list[0].parent, stat = P === scene, G = {list, snaps:list.map(snap), stat, merged:null, dead:false};
      if(list.length > 1){
        const m = new THREE.Mesh(mergeGeo(list), list[0].material);
        m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow; m.frustumCulled = list[0].frustumCulled;
        m.matrixAutoUpdate = false;
        P.add(m); G.merged = m;
        for(const o of list) o.layers.set(L_HIDE);
      }
      if(stat){ G.cast = list[0].castShadow; const t = G.merged || list[0]; if(t.castShadow){ statics.add(t); t.castShadow = false; } }
      groups.push(G);
    }
    staticDirty = true;
  }
  function split(G){
    if(G.stat){ const t = G.merged || G.list[0]; if(statics.delete(t)) t.castShadow = G.cast; staticDirty = true; }
    if(G.merged){ G.merged.parent.remove(G.merged); G.merged.geometry.dispose(); G.merged = null; }
    for(const o of G.list) o.layers.set(0);
    G.dead = true;
  }
  let on = false;
  return {
    enable(){ if(on) return; on = true; build(); },
    disable(){ if(!on) return; on = false; groups.forEach(G=>{ if(!G.dead) split(G); }); groups.length = 0; staticDirty = true; },
    // 需要时先单独补画一帧：只让不动的零件投影，画进第二张影子图（画面画到 1×1 的空目标上丢掉）
    prepass(){
      if(!staticDirty) return; staticDirty = false;
      const off = []; scene.traverse(o=>{ if(o.isMesh && o.castShadow){ off.push(o); o.castShadow = false; } });
      statics.forEach(o=>{ o.castShadow = true; });
      sun.shadow.autoUpdate = false; sunS.shadow.needsUpdate = true;
      const rt0 = renderer.getRenderTarget(); renderer.setRenderTarget(dummy); renderer.render(scene, camera); renderer.setRenderTarget(rt0);
      statics.forEach(o=>{ o.castShadow = false; }); off.forEach(o=>{ o.castShadow = true; }); sun.shadow.autoUpdate = true;
    },
    check(){
      if(!on) return;
      for(const G of groups){ if(G.dead) continue; for(let i=0; i<G.list.length; i++) if(changed(G.list[i], G.snaps[i])){ split(G); break; } }
    },
    dirty(){ staticDirty = true; },     // 外部手动改了不动零件、又不想等自动检查时用
    stats(){ const live = groups.filter(G=>!G.dead); return {groups:live.length, merged:live.filter(G=>G.merged).reduce((a, G)=>a + G.list.length, 0), split:groups.length - live.length}; },
  };
})();
OPT.enable();
window.__dbg.OPT = OPT;
window.__dbg.redraw = ()=>{ scene.updateMatrixWorld(); OPT.prepass(); renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(postScene, postCam); };
window.__dbg.song = ()=>({buffer:!!SONG.buffer, src:!!songSrc});

// ---------- 记住拖进来的歌（存在本机 IndexedDB 里：鼓点 + 原音频文件），下次打开还在 ----------
// 内置节奏和示例鼓谱不存；上次放的是哪首记在 localStorage。存不了（隐私模式等）就跟以前一样只在本次有效。
const SAVE = (()=>{
  const LAST = 'squiddle.lastSong';
  let db = null, ready = null, restoring = true;
  const user = S => S && S.uid !== 'builtin' && S.uid !== 'example';
  function open(){
    if(ready) return ready;
    ready = new Promise(res=>{
      try{
        const r = indexedDB.open('squiddle', 1);
        r.onupgradeneeded = ()=>r.result.createObjectStore('songs', {keyPath:'uid'});
        r.onsuccess = ()=>{ db = r.result; res(db); };
        r.onerror = r.onblocked = ()=>res(null);
      } catch(_){ res(null); }
    });
    return ready;
  }
  const tx = (mode, f) => open().then(d=>{ if(!d) return null; return new Promise(res=>{
    try{ const t = d.transaction('songs', mode), q = f(t.objectStore('songs')); t.oncomplete = ()=>res(q && q.result); t.onerror = t.onabort = ()=>res(null); }
    catch(_){ res(null); }
  }); });
  function rec(S){
    return {uid:S.uid, order:S.order, name:S.name, kind:S.kind, mode:S.mode, bpm:S.bpm, dur:S.dur, loop:S.loop, bar0:S.bar0 || 0,
      auto:!!S.auto, pasted:!!S.pasted, beats:S.beats, env:S.env || null, audio:S.audioData || null, mime:S.mime || '',
      events:S.events.map(e=>({t:e.t, i:e.i, v:e.v, r:e.r, a:e.a}))};
  }
  return {
    put(S){
      if(!user(S)) return;
      if(!S.uid){ S.uid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); S.order = Date.now(); }
      tx('readwrite', st=>st.put(rec(S))).then(ok=>{ if(ok === null && S.audioData) msg('电脑空间不够，这首歌这次能放，但下次打开不会留着。', true); });
    },
    del(S){ if(user(S) && S.uid) tx('readwrite', st=>st.delete(S.uid)); },
    last(S){ if(!restoring) try{ localStorage.setItem(LAST, S.uid || ''); } catch(_){} },
    async restore(){
      const all = await tx('readonly', st=>st.getAll()) || [];
      all.sort((a, b)=>(a.order || 0) - (b.order || 0));
      for(const r of all){
        try{
          const S = {uid:r.uid, order:r.order, name:r.name, kind:r.kind, mode:r.mode, bpm:r.bpm, dur:r.dur, loop:r.loop, bar0:r.bar0,
            auto:r.auto, pasted:r.pasted, beats:r.beats, env:r.env, audioData:r.audio, mime:r.mime, buffer:null,
            events:r.events.map(e=>EV(e.t, e.i, e.v, e.r, e.a))};
          if(S.mode === 'audio' && !S.audioData) continue;
          LIB.push(prepSong(S));
        } catch(_){}
      }
      let id = null; try{ id = localStorage.getItem(LAST); } catch(_){}
      const S = id && LIB.find(X=>X.uid === id);
      restoring = false;
      if(S && S !== CUR) loadSong(S, false); else emit('lib', libInfo());
    },
  };
})();
SAVE.restore();

new ResizeObserver(()=>fitView(canvas.clientWidth, canvas.clientHeight)).observe(canvas);
fitView(canvas.clientWidth, canvas.clientHeight);
window.Squiddle = {
  on(type, f){ (BUS[type] = BUS[type] || []).push(f); },
  state, song:songInfo, lib:libInfo, camera:()=>camLabel,
  lane(){ return {phx:PHX, lw:LW, lh:LH, pps:PPS, row:LROW, col:LCOL}; },
  time(){ return {t:SONG.T < 0 ? 0 : Math.min(SONG.dur, songLocal(SONG.T)), dur:SONG.dur}; },
  fps:()=>FPS,
  play(on){ setPlaying(on === undefined ? !playing : !!on); },
  seek:seekTo, rewind, setLoop,
  setDirector(on){ setDirector(!!on); },
  setSpot(on){ SPOT.on = !!on; emit('state', state()); },
  resetView(){ if(DIR.on) setDirector(false); resetOrbit(); },
  setSpeed, setDrumVol, setSongVol, setTune,
  setFrameCap(n){ CAP = n > 0 ? n : 0; },
  loadFile:handleFile, loadTabText,
  selectSong(i){ const S = LIB[i]; if(S) loadSong(S, true); },
  removeSong(i){
    const S = LIB[i]; if(!S || LIB.length <= 1) return;
    LIB.splice(i, 1); SAVE.del(S);
    if(S === CUR) loadSong(LIB[Math.min(i, LIB.length - 1)], playing); else emit('lib', libInfo());
  },
  unlockAudio, hold(v){ HOLD = !!v; }, exampleTab:EXAMPLE_TAB, view:canvas,
};
})();
