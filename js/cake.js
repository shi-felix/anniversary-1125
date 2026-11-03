/* ============================================================
 *  一周年快乐 · 3D 蛋糕页
 *  ------------------------------------------------------------
 *  纯静态、file:// 可直接打开：
 *    - Three.js r128（vendor/three/three.min.js，全局 THREE）
 *    - 内容全部来自 js/data.js 的 window.GIFT
 *
 *  结构：
 *    1. 文案注入 / 工具
 *    2. WebGL 检测 + 降级
 *    3. 场景、材质、光照、蛋糕、漂浮装饰
 *    4. 指针拖拽 / resize / 可见性暂停
 *    5. 吹蜡烛 -> 灭焰 + 烟 + 礼花 + 大字
 *
 *  性能策略：手机自动降低粒子数量；prefers-reduced-motion 降低动画；
 *  document.hidden 时停止更新（rAF 本身也会暂停，这里再兜一层）。
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 0. 文案与工具
   * ============================================================ */
  var G = window.GIFT || {};
  var MAIN = G.mainMessage || '一周年快乐';
  var TO = G.to || '宝宝';
  var YEARS = parseInt(G.years, 10) || 1;
  var CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
  var YEARS_CN = CN_NUM[YEARS] || String(YEARS);

  function parseDay(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDay(d) { return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()); }

  var START = parseDay(G.togetherDate) || new Date(2025, 10, 3);
  var TODAY = new Date();
  var DAYS = Math.max(0, Math.round((stripTime(TODAY) - stripTime(START)) / 86400000));
  var DATE_LINE = fmtDay(START) + ' — ' + fmtDay(TODAY);

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function easeInOutCubic(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }

  /* 文案注入 */
  var $ = function (id) { return document.getElementById(id); };
  var elTopSub = $('topSub');
  var elReveal = $('reveal');
  var elRevealTitle = $('revealTitle');
  var elRevealSub = $('revealSub');
  var elRevealDays = $('revealDays');
  var elBlow = $('blowBtn');
  var elDock = $('dock');
  var elDragHint = $('dragHint');
  var elFlash = $('flash');
  var elFallback = $('fallback');
  var elFbTitle = $('fbTitle');
  var elFbText = $('fbText');
  var elFbBless = $('fbBless');
  var elFbRetry = $('fbRetry');
  var elCanvas = $('scene');

  if (elTopSub) elTopSub.textContent = DATE_LINE + ' · 相恋 ' + DAYS + ' 天';
  if (elRevealTitle) elRevealTitle.textContent = MAIN;
  if (elRevealSub) elRevealSub.textContent = TO + ' · ' + YEARS_CN + '周年';
  if (elRevealDays) elRevealDays.textContent = '一起走过 ' + DAYS + ' 天';
  if (!TO) { /* 占位，避免空引用 */ }
  if (elReveal && !elReveal.getAttribute('aria-hidden')) elReveal.setAttribute('aria-hidden', 'true');

  /* 运行状态 */
  var S = {
    mode: 'boot',          // 3d | fallback
    webgl: null,
    ready: false,
    blown: false,
    revealed: false,
    blowT: -1,
    fwStarted: false,
    revealScheduled: false,
    t: 0,
    lowEnd: false,
    reduced: false,
    fallbackShown: false,
    paused: false
  };
  var debug = window.__cake = {
    mode: 'boot',
    webgl: null,
    counts: {},
    blown: false,
    revealed: false,
    ready: false,
    errors: []
  };
  function dbgError(msg) {
    debug.errors.push(String(msg));
    if (window.console && console.error) console.error('[cake] ' + msg);
  }

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { REDUCED = false; }
  S.reduced = !!REDUCED;
  S.lowEnd = Math.min(window.innerWidth || 390, window.innerHeight || 844) < 640;
  /* 性能分级：low = 手机 / mid = 普通桌面 / high = 高分屏桌面
     掉帧时还会自动再降一档（见 tick 里的 adaptQuality） */
  S.quality = S.lowEnd ? 'low' : ((window.devicePixelRatio || 1) > 2 ? 'high' : 'mid');
  S.dprCap = S.quality === 'low' ? 1.25 : (S.quality === 'mid' ? 1.5 : 1.75);
  debug.quality = S.quality;

  /* 场景级变量（在 init 里赋值） */
  var scene = null;
  var camera = null;
  var renderer = null;
  var cakeGroup = null;
  var bgGroup = null;
  var cakeYaw = 0;
  var camBase = { dist: 12, targetY: 2, elev: 0.17 };
  var camMul = 1.15;
  var camPush = 1;

  var flames = [];
  var smokePool = [];
  var pendingSmoke = [];
  var confetti = null;
  var bursts = [];
  var boomLight = null;
  var starGroup = null;
  var decorItems = [];
  var bokehSprites = [];
  var clockLast = 0;
  var rafId = 0;
  var bootTime = 0;

  var pointer = { nx: 0, ny: 0 };
  var drag = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    yawTarget: 0,
    tilt: 0,
    tiltTarget: 0,
    idle: 99
  };

  /* ============================================================
   * 1. 展台尺寸（塔盘 + 三层 + 蜡烛）
   * ============================================================ */
  var TRAY = { r: 2.62, topY: 0.16 };
  var LAYERS = [
    { r: 2.04, h: 1.00, color: 0xffe4c2, baseY: TRAY.topY },   // 奶油白（偏暖）
    { r: 1.58, h: 0.90, color: 0xe98daa, baseY: TRAY.topY + 1.00 }, // 玫瑰粉
    { r: 1.17, h: 0.82, color: 0xd9ad69, baseY: TRAY.topY + 1.90 }  // 香槟金
  ];
  LAYERS.forEach(function (l) { l.topY = l.baseY + l.h; });
  var TOP_Y = LAYERS[2].topY; // 2.88
  var CAKE_W = 5.6;
  var CAKE_H = 4.0;

  var CANDLE_DEFS = [
    { x: -0.46, z: 0.26, h: 0.62, color: 0xff7fa8 },
    { x: 0.46, z: 0.26, h: 0.72, color: 0xffc266 },
    { x: 0.0, z: -0.46, h: 0.55, color: 0xfff2d8 }
  ];
  var SPRINKLE_COLORS = [0xff6b9a, 0xffd166, 0x7ad1ff, 0x9ee7a8, 0xffa45c, 0xd8b4ff];
  var CONFETTI_COLORS = [0xff6b9a, 0xffd166, 0x7ad1ff, 0x9ee7a8, 0xffa45c, 0xd8b4ff, 0xff4f7d, 0xfff1e0];

  /* ============================================================
   * 2. WebGL 检测 / 降级
   * ============================================================ */
  function detectWebGL() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return null;
      var ver = gl.getParameter(gl.VERSION) || '';
      var lost = gl.isContextLost && gl.isContextLost();
      var ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      if (lost) return null;
      return /WebGL\s*2/i.test(ver) ? 'webgl2' : 'webgl1';
    } catch (e) {
      return null;
    }
  }

  function showFallback(title, text) {
    if (S.fallbackShown) return;
    S.fallbackShown = true;
    S.mode = 'fallback';
    debug.mode = 'fallback';
    document.body.classList.add('no3d');
    document.body.classList.add('ready');
    if (elFbTitle && title) elFbTitle.textContent = title;
    if (elFbText && text) elFbText.textContent = text;
    if (elFallback) elFallback.hidden = false;
    if (elDragHint) elDragHint.classList.add('gone');
  }

  /* ============================================================
   * 3. 画布贴图（全部本地 Canvas 生成，不加载任何外部资源）
   * ============================================================ */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function toTexture(canvas, useMip, sRGB) {
    var t = new THREE.CanvasTexture(canvas);
    if (sRGB !== false) t.encoding = THREE.sRGBEncoding;
    var maxAniso = 1;
    try { maxAniso = renderer.capabilities.getMaxAnisotropy(); } catch (e) { maxAniso = 1; }
    t.anisotropy = Math.min(8, maxAniso);
    if (useMip) {
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
    } else {
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
    }
    return t;
  }
  function radialFill(ctx, x, y, r, inner, outer, blend) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    var old = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = blend || 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = old;
  }

  function makeGlowTexture() {
    var c = makeCanvas(128, 128), x = c.getContext('2d');
    radialFill(x, 64, 64, 62, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 'source-over');
    return toTexture(c);
  }
  function makeStarTexture() {
    var c = makeCanvas(64, 64), x = c.getContext('2d');
    radialFill(x, 32, 32, 30, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 'source-over');
    radialFill(x, 32, 32, 14, 'rgba(255,255,255,.9)', 'rgba(255,255,255,0)', 'source-over');
    return toTexture(c);
  }
  function makeFlameTexture() {
    var c = makeCanvas(128, 256), x = c.getContext('2d');
    x.clearRect(0, 0, 128, 256);
    radialFill(x, 64, 172, 108, 'rgba(255,146,52,.75)', 'rgba(255,120,30,0)', 'source-over');
    var g = x.createLinearGradient(0, 26, 0, 236);
    g.addColorStop(0, 'rgba(255,142,40,.10)');
    g.addColorStop(0.42, 'rgba(255,178,72,.62)');
    g.addColorStop(0.78, 'rgba(255,232,168,.95)');
    g.addColorStop(1, 'rgba(255,252,236,1)');
    x.beginPath();
    x.moveTo(64, 238);
    x.bezierCurveTo(22, 206, 24, 128, 64, 24);
    x.bezierCurveTo(104, 128, 106, 206, 64, 238);
    x.closePath();
    x.fillStyle = g;
    x.fill();
    var core = x.createRadialGradient(64, 196, 2, 64, 190, 40);
    core.addColorStop(0, 'rgba(255,255,246,.98)');
    core.addColorStop(0.55, 'rgba(255,240,190,.55)');
    core.addColorStop(1, 'rgba(255,220,150,0)');
    x.fillStyle = core;
    x.beginPath();
    x.ellipse(64, 192, 20, 42, 0, 0, Math.PI * 2);
    x.fill();
    return toTexture(c);
  }
  function makeSmokeTexture() {
    var c = makeCanvas(128, 128), x = c.getContext('2d');
    radialFill(x, 64, 64, 60, 'rgba(196,190,206,.34)', 'rgba(196,190,206,0)', 'source-over');
    radialFill(x, 44, 52, 28, 'rgba(210,205,220,.20)', 'rgba(210,205,220,0)', 'source-over');
    radialFill(x, 84, 76, 34, 'rgba(180,174,196,.18)', 'rgba(180,174,196,0)', 'source-over');
    return toTexture(c);
  }
  function makeHeartTexture() {
    var c = makeCanvas(128, 128), x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    function heartPath() {
      x.beginPath();
      x.moveTo(64, 114);
      x.bezierCurveTo(24, 84, 10, 58, 10, 40);
      x.bezierCurveTo(10, 20, 25, 8, 41, 8);
      x.bezierCurveTo(53, 8, 61, 16, 64, 26);
      x.bezierCurveTo(67, 16, 75, 8, 87, 8);
      x.bezierCurveTo(103, 8, 118, 20, 118, 40);
      x.bezierCurveTo(118, 58, 104, 84, 64, 114);
      x.closePath();
    }
    x.save();
    x.shadowColor = 'rgba(255,120,160,.9)';
    x.shadowBlur = 22;
    heartPath();
    x.fillStyle = 'rgba(255,150,180,.7)';
    x.fill();
    x.restore();
    var g = x.createLinearGradient(24, 20, 104, 110);
    g.addColorStop(0, 'rgba(255,240,244,1)');
    g.addColorStop(0.45, 'rgba(255,166,196,1)');
    g.addColorStop(1, 'rgba(255,110,150,1)');
    heartPath();
    x.fillStyle = g;
    x.fill();
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255,245,248,.55)';
    x.stroke();
    return toTexture(c);
  }
  function makeButterflyTexture() {
    var c = makeCanvas(128, 128), x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    function wing(sx) {
      x.save();
      x.translate(64, 64);
      x.scale(sx, 1);
      var g = x.createLinearGradient(0, -30, 46, 40);
      g.addColorStop(0, 'rgba(255,226,240,.96)');
      g.addColorStop(0.55, 'rgba(255,158,200,.9)');
      g.addColorStop(1, 'rgba(255,190,140,.6)');
      x.beginPath();
      x.moveTo(4, -4);
      x.bezierCurveTo(10, -52, 52, -54, 50, -22);
      x.bezierCurveTo(49, 2, 26, 10, 4, 4);
      x.closePath();
      x.fillStyle = g;
      x.fill();
      x.beginPath();
      x.moveTo(3, 6);
      x.bezierCurveTo(18, 22, 40, 34, 34, 46);
      x.bezierCurveTo(24, 56, 6, 32, 3, 12);
      x.closePath();
      x.fillStyle = 'rgba(255,170,205,.82)';
      x.fill();
      x.restore();
    }
    wing(1);
    wing(-1);
    x.strokeStyle = 'rgba(120,60,80,.55)';
    x.lineWidth = 3.4;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(64, 34);
    x.bezierCurveTo(60, 58, 60, 74, 64, 96);
    x.stroke();
    x.strokeStyle = 'rgba(255,250,245,.5)';
    x.lineWidth = 1.4;
    x.beginPath();
    x.moveTo(64, 34);
    x.bezierCurveTo(60, 58, 60, 74, 64, 96);
    x.stroke();
    return toTexture(c);
  }
  function makeSparkTexture() {
    var c = makeCanvas(128, 128), x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(0.2, 'rgba(255,240,220,.6)');
    g.addColorStop(1, 'rgba(255,220,190,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    x.save();
    x.translate(64, 64);
    x.fillStyle = 'rgba(255,255,255,.92)';
    for (var i = 0; i < 4; i++) {
      x.beginPath();
      x.moveTo(0, -60);
      x.quadraticCurveTo(5, -8, 0, 0);
      x.quadraticCurveTo(-5, -8, 0, -60);
      x.closePath();
      x.fill();
      x.rotate(Math.PI / 2);
    }
    x.restore();
    return toTexture(c);
  }
  function makeContactShadowTexture() {
    var c = makeCanvas(256, 256), x = c.getContext('2d');
    radialFill(x, 128, 128, 126, 'rgba(0,0,0,.62)', 'rgba(0,0,0,0)', 'source-over');
    return toTexture(c);
  }
  function makeBokehTexture() {
    var c = makeCanvas(128, 128), x = c.getContext('2d');
    radialFill(x, 64, 64, 62, 'rgba(255,205,170,.55)', 'rgba(255,150,120,0)', 'source-over');
    return toTexture(c);
  }
  function makeEnvTexture() {
    var c = makeCanvas(512, 256), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0a0710');
    g.addColorStop(0.28, '#1e1026');
    g.addColorStop(0.44, '#4a2432');
    g.addColorStop(0.5, '#ffb474');
    g.addColorStop(0.57, '#3a1c28');
    g.addColorStop(0.8, '#140c1a');
    g.addColorStop(1, '#07060b');
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 256);
    radialFill(x, 366, 120, 92, 'rgba(255,226,180,.85)', 'rgba(255,190,120,0)');
    radialFill(x, 120, 104, 72, 'rgba(255,110,150,.5)', 'rgba(255,110,150,0)');
    radialFill(x, 468, 74, 58, 'rgba(150,120,255,.32)', 'rgba(150,120,255,0)');
    radialFill(x, 40, 210, 90, 'rgba(255,120,90,.16)', 'rgba(255,120,90,0)');
    var t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  /* 巧克力牌：曲面巧克力带，文字用 CanvasTexture 写 GIFT.mainMessage */
  function makePlaqueTexture() {
    var W = 1024, H = 512;
    var c = makeCanvas(W, H), x = c.getContext('2d');
    x.clearRect(0, 0, W, H);
    var pad = 10, r = 56;
    function roundRect(px, py, pw, ph, rr) {
      x.beginPath();
      x.moveTo(px + rr, py);
      x.arcTo(px + pw, py, px + pw, py + ph, rr);
      x.arcTo(px + pw, py + ph, px, py + ph, rr);
      x.arcTo(px, py + ph, px, py, rr);
      x.arcTo(px, py, px + pw, py, rr);
      x.closePath();
    }
    /* 巧克力底 */
    var bg = x.createLinearGradient(0, pad, 0, H - pad);
    bg.addColorStop(0, '#5a3726');
    bg.addColorStop(0.45, '#3f2418');
    bg.addColorStop(1, '#28150e');
    roundRect(pad, pad, W - pad * 2, H - pad * 2, r);
    x.fillStyle = bg;
    x.fill();
    /* 内描金边 */
    x.lineWidth = 7;
    var gold = x.createLinearGradient(0, 0, W, H);
    gold.addColorStop(0, 'rgba(255,226,176,.95)');
    gold.addColorStop(0.5, 'rgba(214,160,92,.85)');
    gold.addColorStop(1, 'rgba(255,232,190,.95)');
    x.strokeStyle = gold;
    roundRect(pad + 15, pad + 15, W - pad * 2 - 30, H - pad * 2 - 30, r - 11);
    x.stroke();
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255,240,205,.32)';
    roundRect(pad + 28, pad + 28, W - pad * 2 - 56, H - pad * 2 - 56, r - 20);
    x.stroke();

    /* 顶部小字 */
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(240,202,150,.92)';
    x.font = '500 24px "Georgia","Times New Roman",serif';
    var cap = 'ONE YEAR WITH YOU';
    var capW = 0;
    var i;
    for (i = 0; i < cap.length; i++) capW += x.measureText(cap.charAt(i)).width + 9;
    var cx0 = W / 2 - capW / 2;
    for (i = 0; i < cap.length; i++) {
      x.textAlign = 'left';
      x.fillText(cap.charAt(i), cx0, 92);
      cx0 += x.measureText(cap.charAt(i)).width + 9;
    }

    /* 主文案：自动缩小字号，最长 14 字也放得下 */
    var fontSize = 150;
    var fontOf = function (fs) {
      return '700 ' + fs + 'px "Kaiti SC","STKaiti",KaiTi,"Songti SC",STSong,serif';
    };
    x.font = fontOf(fontSize);
    while (x.measureText(MAIN).width > 760 && fontSize > 52) {
      fontSize -= 6;
      x.font = fontOf(fontSize);
    }
    var txtGrad = x.createLinearGradient(0, 200, 0, 360);
    txtGrad.addColorStop(0, '#fff6dd');
    txtGrad.addColorStop(0.55, '#f6d39b');
    txtGrad.addColorStop(1, '#d19a55');
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.save();
    x.shadowColor = 'rgba(0,0,0,.55)';
    x.shadowBlur = 14;
    x.shadowOffsetY = 5;
    x.fillStyle = txtGrad;
    x.fillText(MAIN, W / 2, 275);
    x.restore();

    /* 底部日期 */
    x.font = '500 27px "Georgia","Times New Roman",serif';
    x.fillStyle = 'rgba(238,205,164,.78)';
    x.fillText(DATE_LINE, W / 2, 415);

    /* 两侧小爱心 */
    function tinyHeart(hx, hy, s, alpha) {
      x.save();
      x.translate(hx, hy);
      x.scale(s, s);
      x.beginPath();
      x.moveTo(0, 10);
      x.bezierCurveTo(-12, 0, -11, -9, -3.4, -9);
      x.bezierCurveTo(-1.2, -9, -0.3, -7.6, 0, -6.4);
      x.bezierCurveTo(0.3, -7.6, 1.2, -9, 3.4, -9);
      x.bezierCurveTo(11, -9, 12, 0, 0, 10);
      x.closePath();
      x.fillStyle = 'rgba(255,190,210,' + alpha + ')';
      x.fill();
      x.restore();
    }
    tinyHeart(W / 2 - 240, 414, 1.6, 0.75);
    tinyHeart(W / 2 + 240, 414, 1.6, 0.75);

    return toTexture(c, true);
  }

  /* ============================================================
   * 4. 构建场景
   * ============================================================ */
  var MAT = {};

  function init3D() {
    /* 手机（low）关抗锯齿，省填充率；桌面保留 */
    var aa = S.quality !== 'low';
    renderer = new THREE.WebGLRenderer({
      canvas: elCanvas,
      alpha: true,
      antialias: aa,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false
    });
    S.webgl = detectWebGL() || 'webgl1';
    debug.webgl = S.webgl;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, S.dprCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    renderer.setClearColor(0x000000, 0);
    /* 阴影：手机一律关（掉帧大头），桌面先开，掉帧时自动关 */
    var shadowOn = S.quality !== 'low';
    renderer.shadowMap.enabled = shadowOn;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 220);

    /* 环境反射（程序化生成，让金色托盘和奶油有质感） */
    try {
      var pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      var envSrc = makeEnvTexture();
      var envRT = pmrem.fromEquirectangular(envSrc);
      scene.environment = envRT.texture;
      envSrc.dispose();
      pmrem.dispose();
    } catch (e) {
      if (window.console && console.warn) console.warn('[cake] env map skipped:', e && e.message);
    }

    buildMaterials();
    buildLights();
    cakeGroup = new THREE.Group();
    scene.add(cakeGroup);
    buildCake();
    buildBackground();
    buildFireworks();

    layoutCamera();
    camMul = REDUCED ? 1 : 1.16;
    camPush = 1;

    /* 指针拖拽 */
    bindPointer();
    /* resize */
    var rTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rTimer);
      rTimer = setTimeout(onResize, 120);
    });
    /* 可见性暂停 */
    document.addEventListener('visibilitychange', function () {
      S.paused = document.hidden;
      clockLast = 0;
      debug.paused = S.paused;
    });
    /* WebGL 上下文丢失 -> 降级提示 + 重试 */
    elCanvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      S.paused = true;
      dbgError('webglcontextlost');
      showFallback('3D 画面被浏览器收回了', '点「再试一次」重新加载页面，通常马上就能恢复。');
    }, false);
    elCanvas.addEventListener('webglcontextrestored', function () {
      window.location.reload();
    }, false);

    S.mode = '3d';
    debug.mode = '3d';
    debug.counts = {
      stars: starGroup ? starGroup.userData.count : 0,
      decor: decorItems.length,
      flames: flames.length,
      confetti: confetti ? confetti.count : 0,
      bursts: bursts.length
    };
    debug.ready = true;
    S.ready = true;
    debug.ready = true;
    console.info('[cake] 3D ready · ' + S.webgl + ' · stars=' + debug.counts.stars +
      ' confetti=' + debug.counts.confetti + ' mobile=' + S.lowEnd + ' reduced=' + S.reduced);
  }

  function buildMaterials() {
    MAT.cream = new THREE.MeshStandardMaterial({
      color: 0xffe4c2, roughness: 0.82, metalness: 0.02, envMapIntensity: 0.45
    });
    MAT.rose = new THREE.MeshStandardMaterial({
      color: 0xe98daa, roughness: 0.78, metalness: 0.03, envMapIntensity: 0.5
    });
    MAT.champagne = new THREE.MeshStandardMaterial({
      color: 0xe0b878, roughness: 0.72, metalness: 0.05, envMapIntensity: 0.6
    });
    MAT.creamPipe = new THREE.MeshStandardMaterial({
      color: 0xfff7e9, roughness: 0.52, metalness: 0.02, envMapIntensity: 0.6
    });
    MAT.gold = new THREE.MeshStandardMaterial({
      color: 0xd9a95f, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.2
    });
    MAT.goldLight = new THREE.MeshStandardMaterial({
      color: 0xffdda2, roughness: 0.2, metalness: 0.92, envMapIntensity: 1.45
    });
    MAT.choco = new THREE.MeshStandardMaterial({
      color: 0x3a2116, roughness: 0.5, metalness: 0.12, envMapIntensity: 0.7
    });
    MAT.plaque = new THREE.MeshStandardMaterial({
      map: makePlaqueTexture(), roughness: 0.46, metalness: 0.18, envMapIntensity: 0.75
    });
    MAT.sprinkle = new THREE.MeshStandardMaterial({
      roughness: 0.42, metalness: 0.06, envMapIntensity: 0.7
    });
    MAT.wick = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.95, metalness: 0 });
    MAT.contact = new THREE.MeshBasicMaterial({
      map: makeContactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false
    });
  }

  function buildLights() {
    var low = S.quality === 'low';
    var ambient = new THREE.AmbientLight(0x8d7aa8, low ? 0.46 : 0.3);
    scene.add(ambient);

    var hemi = new THREE.HemisphereLight(0xffd7c0, 0x140d1c, low ? 0.52 : 0.38);
    hemi.position.set(0, 8, 0);
    scene.add(hemi);

    var spot = new THREE.SpotLight(0xffe0bd, low ? 1.25 : 1.05, 0, 0.78, 0.9, 1);
    spot.position.set(3.2, 8.6, 6.4);
    spot.target.position.set(0, 1.35, 0);
    spot.castShadow = renderer.shadowMap.enabled;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0006;
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 30;
    scene.add(spot);
    scene.add(spot.target);

    /* 补光数量按性能档位给：手机只要能看清蛋糕就行，别堆灯 */
    if (S.quality === 'high') {
      var fillRose = new THREE.PointLight(0xff5c8b, 0.8, 0, 1);
      fillRose.position.set(-5.4, 2.3, 3.8);
      scene.add(fillRose);

      var fillIndigo = new THREE.PointLight(0x7f8cff, 0.62, 0, 1);
      fillIndigo.position.set(4.8, 2.9, -4.4);
      scene.add(fillIndigo);

      var rim = new THREE.PointLight(0xff9a4d, 0.45, 0, 1);
      rim.position.set(0, 4.8, -6.2);
      scene.add(rim);

      var front = new THREE.PointLight(0xffd9b0, 0.32, 0, 1);
      front.position.set(0, 1.5, 5.2);
      scene.add(front);
    } else if (S.quality === 'mid') {
      var front2 = new THREE.PointLight(0xffd9b0, 0.5, 0, 1);
      front2.position.set(0, 1.5, 5.2);
      scene.add(front2);

      var rose2 = new THREE.PointLight(0xff5c8b, 0.55, 0, 1);
      rose2.position.set(-5.4, 2.3, 3.8);
      scene.add(rose2);
    } else {
      var front3 = new THREE.PointLight(0xffd9b0, 0.55, 0, 1);
      front3.position.set(0, 1.6, 5.2);
      scene.add(front3);
    }

    boomLight = new THREE.PointLight(0xffcf9a, 0, 18, 1.4);
    boomLight.position.set(0, 3.4, 1.2);
    scene.add(boomLight);
  }

  function buildCake() {
    var i, j;

    /* 接触阴影，压住塔盘，避免整个蛋糕飘着 */
    var shadow = new THREE.Mesh(new THREE.CircleGeometry(3.6, 48), MAT.contact);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.078;
    cakeGroup.add(shadow);

    /* 金色托盘：底盘 + 脚 + 边沿 */
    var plate = new THREE.Mesh(new THREE.CylinderGeometry(TRAY.r, TRAY.r * 0.965, 0.12, 80), MAT.gold);
    plate.position.y = 0.10;
    plate.castShadow = true;
    plate.receiveShadow = true;
    cakeGroup.add(plate);

    var plateRim = new THREE.Mesh(new THREE.TorusGeometry(TRAY.r - 0.01, 0.052, 10, 100), MAT.goldLight);
    plateRim.rotation.x = Math.PI / 2;
    plateRim.position.y = TRAY.topY;
    plateRim.castShadow = true;
    cakeGroup.add(plateRim);

    var foot = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.32, 0.17, 64), MAT.gold);
    foot.position.y = 0.0;
    foot.castShadow = true;
    cakeGroup.add(foot);

    var footRim = new THREE.Mesh(new THREE.TorusGeometry(1.31, 0.036, 8, 64), MAT.goldLight);
    footRim.rotation.x = Math.PI / 2;
    footRim.position.y = -0.078;
    cakeGroup.add(footRim);

    /* 三层蛋糕体 */
    var mats = [MAT.cream, MAT.rose, MAT.champagne];
    LAYERS.forEach(function (L, idx) {
      var body = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r * 1.004, L.h, 72), mats[idx]);
      body.position.y = L.baseY + L.h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      cakeGroup.add(body);

      /* 层顶奶油环 */
      var ring = new THREE.Mesh(new THREE.TorusGeometry(L.r + 0.005, 0.062, 12, 100), MAT.creamPipe);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = L.topY;
      ring.castShadow = true;
      cakeGroup.add(ring);

      /* 层底一圈稍暗的收边，让层次更清楚 */
      var baseRing = new THREE.Mesh(new THREE.TorusGeometry(L.r * 0.998, 0.028, 8, 90), MAT.creamPipe);
      baseRing.rotation.x = Math.PI / 2;
      baseRing.position.y = L.baseY + 0.005;
      cakeGroup.add(baseRing);
    });

    /* 奶油滴落：一个 InstancedMesh 搞定 */
    var dripDefs = [];
    LAYERS.forEach(function (L, li) {
      var n = L.r > 1.8 ? 30 : (L.r > 1.3 ? 24 : 18);
      if (S.lowEnd) n = Math.round(n * 0.7);
      for (var k = 0; k < n; k++) {
        var ang = (k / n) * Math.PI * 2 + rand(-0.06, 0.06);
        /* 正面巧克力牌那一段空出来，不然奶油会挡住字 */
        if (li === 0 && Math.abs(Math.atan2(Math.sin(ang - Math.PI / 2), Math.cos(ang - Math.PI / 2))) < 0.55) continue;
        var len = rand(0.12, 0.3) * (0.7 + L.r * 0.15);
        var rad = L.r + 0.008;
        dripDefs.push({
          x: Math.cos(ang) * rad,
          z: Math.sin(ang) * rad,
          y: L.topY - len * 0.5 + 0.02,
          sx: rand(0.042, 0.068),
          sy: len * 0.5,
          sz: rand(0.042, 0.066),
          ry: ang
        });
      }
    });
    var dripGeo = new THREE.SphereGeometry(1, 8, 6);
    var drips = new THREE.InstancedMesh(dripGeo, MAT.creamPipe, dripDefs.length);
    var m4 = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var eul = new THREE.Euler();
    var vp = new THREE.Vector3();
    var vs = new THREE.Vector3();
    for (i = 0; i < dripDefs.length; i++) {
      var d = dripDefs[i];
      vp.set(d.x, d.y, d.z);
      eul.set(0, d.ry, 0);
      q.setFromEuler(eul);
      vs.set(d.sx, d.sy, d.sz);
      m4.compose(vp, q, vs);
      drips.setMatrixAt(i, m4);
    }
    drips.instanceMatrix.needsUpdate = true;
    drips.castShadow = true;
    drips.frustumCulled = false;
    cakeGroup.add(drips);

    /* 彩色糖针：分布在每层露出来的顶面上 */
    var sprinkleDefs = [];
    var ringSpecs = [
      { rIn: 1.66, rOut: 1.97, y: LAYERS[0].topY, n: 24 },
      { rIn: 1.24, rOut: 1.51, y: LAYERS[1].topY, n: 20 },
      { rIn: 0.16, rOut: 1.06, y: LAYERS[2].topY, n: 28 }
    ];
    ringSpecs.forEach(function (sp) {
      var n = S.lowEnd ? Math.round(sp.n * 0.62) : sp.n;
      for (var k = 0; k < n; k++) {
        var ang = Math.random() * Math.PI * 2;
        var rr = rand(sp.rIn, sp.rOut);
        sprinkleDefs.push({
          x: Math.cos(ang) * rr,
          z: Math.sin(ang) * rr,
          y: sp.y + 0.012,
          ry: Math.random() * Math.PI * 2,
          tilt: rand(-0.14, 0.14),
          color: SPRINKLE_COLORS[(Math.random() * SPRINKLE_COLORS.length) | 0]
        });
      }
    });
    var sprGeo = new THREE.SphereGeometry(1, 7, 5);
    var sprMesh = new THREE.InstancedMesh(
      sprGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.08, envMapIntensity: 0.8 }),
      sprinkleDefs.length
    );
    var col = new THREE.Color();
    for (i = 0; i < sprinkleDefs.length; i++) {
      var sd = sprinkleDefs[i];
      vp.set(sd.x, sd.y, sd.z);
      eul.set(sd.tilt, sd.ry, 0);
      q.setFromEuler(eul);
      vs.set(0.09, 0.022, 0.022);
      m4.compose(vp, q, vs);
      sprMesh.setMatrixAt(i, m4);
      col.setHex(sd.color);
      sprMesh.setColorAt(i, col);
    }
    sprMesh.instanceMatrix.needsUpdate = true;
    if (sprMesh.instanceColor) sprMesh.instanceColor.needsUpdate = true;
    sprMesh.castShadow = false;
    sprMesh.frustumCulled = false;
    cakeGroup.add(sprMesh);

    /* 正面巧克力牌：一段曲面圆柱带 + CanvasTexture 写主文案 */
    var bandArc = 0.9;
    var bandRadius = LAYERS[0].r + 0.045;
    var bandCenterY = LAYERS[0].baseY + 0.44;
    var bandGeo = new THREE.CylinderGeometry(
      bandRadius, bandRadius, 0.72, 40, 1, true, -bandArc / 2, bandArc
    );
    var band = new THREE.Mesh(bandGeo, MAT.plaque);
    band.position.y = bandCenterY;
    band.castShadow = true;
    cakeGroup.add(band);
    /* 巧克力带上下两道金边，遮住贴图接缝 */
    [bandCenterY - 0.34, bandCenterY + 0.34].forEach(function (yy) {
      var trim = new THREE.Mesh(new THREE.TorusGeometry(bandRadius, 0.022, 8, 80), MAT.goldLight);
      trim.rotation.x = Math.PI / 2;
      trim.position.y = yy;
      cakeGroup.add(trim);
    });

    /* 顶部蜡烛 + 火焰 */
    var flameTex = makeFlameTexture();
    var glowTex = makeGlowTexture();
    CANDLE_DEFS.forEach(function (C, ci) {
      var g = new THREE.Group();
      g.position.set(C.x, TOP_Y, C.z);
      cakeGroup.add(g);

      var bodyMat = new THREE.MeshStandardMaterial({
        color: C.color, roughness: 0.55, metalness: 0.03, envMapIntensity: 0.6,
        emissive: new THREE.Color(C.color).multiplyScalar(0.06)
      });
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, C.h, 20, 1), bodyMat);
      body.position.y = C.h / 2;
      body.castShadow = true;
      g.add(body);

      var stripeMat = new THREE.MeshStandardMaterial({ color: 0xfff8ee, roughness: 0.6, metalness: 0.02 });
      [0.26, 0.5, 0.74].forEach(function (f) {
        var s = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.011, 6, 24), stripeMat);
        s.rotation.x = Math.PI / 2;
        s.position.y = C.h * f;
        g.add(s);
      });

      var wick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.07, 6), MAT.wick);
      wick.position.y = C.h + 0.028;
      g.add(wick);

      var flame = new THREE.Group();
      flame.position.y = C.h + 0.075;
      g.add(flame);

      var fw = 0.2 * (0.85 + C.h * 0.24);
      var fh = 0.36 * (0.85 + C.h * 0.24);
      var glowW = fw * 2.5;
      var glowH = fh * 2.0;

      var glowMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0xff9a4a, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      var glow = new THREE.Sprite(glowMat);
      glow.scale.set(glowW, glowH, 1);
      glow.position.y = 0.05;
      flame.add(glow);

      var flameMat = new THREE.SpriteMaterial({
        map: flameTex, color: 0xffffff, transparent: true, opacity: 0.96,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      var flameSpr = new THREE.Sprite(flameMat);
      flameSpr.scale.set(fw, fh, 1);
      flameSpr.position.y = 0.02;
      flame.add(flameSpr);

      var coreMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0xfff6db, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      var core = new THREE.Sprite(coreMat);
      core.scale.set(0.13, 0.2, 1);
      core.position.y = -0.03;
      flame.add(core);

      /* 蜡烛点光源只在高端档加；手机用火焰贴图的发光就够，省一盏灯 */
      var light = null;
      if (S.quality === 'high') {
        light = new THREE.PointLight(0xffb066, 0.5, 3.4, 1.6);
        light.position.set(0, 0.06, 0);
        flame.add(light);
      }

      flames.push({
        group: g,
        flame: flame,
        flameSpr: flameSpr,
        flameMat: flameMat,
        core: core,
        coreMat: coreMat,
        glow: glow,
        glowMat: glowMat,
        light: light,
        baseLight: 0.5,
        baseW: fw,
        baseH: fh,
        glowW: glowW,
        glowH: glowH,
        phase: Math.random() * Math.PI * 2,
        outAt: Infinity,
        dying: false,
        diedAt: 0,
        dead: false,
        diedSmoke: false
      });
      if (ci === 0) {
        /* 让火焰初始就有一点点随机状态 */
        flame.rotation.z = rand(-0.05, 0.05);
      }
    });

    /* 烟：先建好 sprite 池，吹灭后用 */
    var smokeTex = makeSmokeTexture();
    var smokeN = S.lowEnd ? 12 : 18;
    for (i = 0; i < smokeN; i++) {
      var sm = new THREE.SpriteMaterial({
        map: smokeTex, color: 0xc9c2d4, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.NormalBlending, toneMapped: false
      });
      var spr = new THREE.Sprite(sm);
      spr.visible = false;
      spr.scale.set(0.2, 0.2, 1);
      scene.add(spr);
      smokePool.push({ sprite: spr, mat: sm, active: false, t: 0, life: 1.7, vx: 0, vy: 0, vz: 0, s0: 0.16, s1: 0.62 });
    }
  }

  function buildBackground() {
    bgGroup = new THREE.Group();
    scene.add(bgGroup);
    starGroup = new THREE.Group();
    bgGroup.add(starGroup);

    /* 星尘粒子 */
    var starTex = makeStarTexture();
    var base = S.lowEnd ? 300 : 680;
    var starN = S.reduced ? Math.round(base * 0.5) : base;
    var pos = new Float32Array(starN * 3);
    var cols = new Float32Array(starN * 3);
    var c = new THREE.Color();
    var starCols = [0xfff3e2, 0xffd9c0, 0xffb8cf, 0xd9d4ff, 0xffe7b8];
    for (var i = 0; i < starN; i++) {
      var r = rand(6.5, 17);
      var th = Math.random() * Math.PI * 2;
      var ph = Math.acos(rand(-1, 1));
      var x = r * Math.sin(ph) * Math.cos(th);
      var y = r * Math.sin(ph) * Math.sin(th) * 0.8 + 2.4;
      var z = r * Math.cos(ph);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      c.setHex(starCols[(Math.random() * starCols.length) | 0]);
      var dim = rand(0.42, 1);
      cols[i * 3] = c.r * dim;
      cols[i * 3 + 1] = c.g * dim;
      cols[i * 3 + 2] = c.b * dim;
    }
    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    var starMat = new THREE.PointsMaterial({
      size: S.lowEnd ? 0.062 : 0.05,
      map: starTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false
    });
    var stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    stars.userData.count = starN;
    starGroup.userData.count = starN;
    starGroup.add(stars);

    /* 漂浮装饰：小爱心 / 蝴蝶 / 星点 */
    var heartTex = makeHeartTexture();
    var butterflyTex = makeButterflyTexture();
    var sparkTex = makeSparkTexture();
    var heartColors = [0xffb1c8, 0xff8fb1, 0xffd2a0, 0xffc0d8, 0xffe0b0];
    var heartN = S.lowEnd ? 5 : 8;
    var butterflyN = S.lowEnd ? 3 : 4;
    var sparkN = S.reduced ? 6 : (S.lowEnd ? 8 : 12);

    function addDecor(kind, tex, n, sizeMin, sizeMax, tint) {
      for (var k = 0; k < n; k++) {
        var mat = new THREE.SpriteMaterial({
          map: tex,
          color: tint[k % tint.length],
          transparent: true,
          opacity: kind === 'spark' ? 0.8 : rand(0.55, 0.9),
          depthWrite: false,
          blending: kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending,
          toneMapped: false
        });
        var spr = new THREE.Sprite(mat);
        var ang = Math.random() * Math.PI * 2;
        var rad = rand(2.9, 5.4);
        var base = new THREE.Vector3(
          Math.cos(ang) * rad,
          rand(0.7, 5.9),
          Math.sin(ang) * rad
        );
        var size = rand(sizeMin, sizeMax);
        spr.scale.set(size, size, 1);
        spr.position.copy(base);
        bgGroup.add(spr);
        decorItems.push({
          kind: kind,
          sprite: spr,
          mat: mat,
          base: base,
          size: size,
          phase: Math.random() * Math.PI * 2,
          speed: rand(0.16, 0.42),
          amp: rand(0.14, 0.42) * (S.reduced ? 0.4 : 1),
          spin: rand(-0.12, 0.12),
          op: mat.opacity
        });
      }
    }
    addDecor('heart', heartTex, heartN, 0.3, 0.52, heartColors);
    addDecor('butterfly', butterflyTex, butterflyN, 0.34, 0.52, [0xffffff, 0xffe2f0, 0xffd9b0]);
    addDecor('spark', sparkTex, sparkN, 0.16, 0.32, [0xfff4dc, 0xffc8dc, 0xffe0b0]);

    /* 远处大颗散景，增加景深 */
    var bokehTex = makeBokehTexture();
    var bokehN = S.lowEnd ? 3 : 5;
    for (var b = 0; b < bokehN; b++) {
      var bm = new THREE.SpriteMaterial({
        map: bokehTex, color: b % 2 ? 0xffb0c8 : 0xffc99a, transparent: true,
        opacity: rand(0.08, 0.16), depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
      });
      var bs = new THREE.Sprite(bm);
      var sz = rand(2.2, 4.2);
      bs.scale.set(sz, sz, 1);
      bs.position.set(rand(-7, 7), rand(1.5, 6.5), rand(-9, -3));
      bgGroup.add(bs);
      bokehSprites.push(bs);
    }
  }

  /* 礼花：彩带碎片 InstancedMesh + 三组火花 Points */
  function buildFireworks() {
    var C = S.reduced ? 110 : (S.lowEnd ? 180 : 340);
    var confGeo = new THREE.PlaneGeometry(0.09, 0.16);
    var confMat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide, transparent: true, opacity: 1, toneMapped: false, depthWrite: false
    });
    var mesh = new THREE.InstancedMesh(confGeo, confMat, C);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    var cCol = new THREE.Color();
    for (var i = 0; i < C; i++) {
      cCol.setHex(CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0]);
      mesh.setColorAt(i, cCol);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);

    confetti = {
      mesh: mesh,
      mat: confMat,
      count: C,
      p: new Float32Array(C * 3),
      v: new Float32Array(C * 3),
      rot: new Float32Array(C * 3),
      rv: new Float32Array(C * 3),
      scale: new Float32Array(C * 2),
      active: false,
      t: 0,
      life: 4.2
    };

    var sparkTex = makeStarTexture();
    var burstN = 3;
    for (var b = 0; b < burstN; b++) {
      var n = S.reduced ? 70 : (S.lowEnd ? 100 : 170);
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(n * 3);
      var colArr = new Float32Array(n * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      var mat = new THREE.PointsMaterial({
        size: S.lowEnd ? 0.16 : 0.14,
        map: sparkTex,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        toneMapped: false
      });
      var pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      scene.add(pts);
      bursts.push({
        points: pts,
        geo: geo,
        mat: mat,
        count: n,
        p: pos,
        v: new Float32Array(n * 3),
        baseCol: new Float32Array(n * 3),
        colArr: colArr,
        active: false,
        t: 0,
        life: 1.7,
        origin: new THREE.Vector3()
      });
    }
  }

  /* ============================================================
   * 5. 相机 / 布局
   * ============================================================ */
  function layoutCamera() {
    if (!camera) return;
    var W = window.innerWidth;
    var H = window.innerHeight;
    var aspect = W / H;
    var tan = Math.tan((camera.fov * Math.PI) / 360);
    var shortScreen = H < 560;
    var d;
    if (aspect < 0.92) {
      /* 手机竖屏：宽度优先，蛋糕接近铺满屏宽 */
      var needW = CAKE_W / 0.96;
      d = needW / (2 * tan * aspect);
    } else {
      /* 横屏 / 桌面：高度优先，底部留给按钮 */
      var needH = CAKE_H / (shortScreen ? 0.42 : 0.5);
      d = needH / (2 * tan);
      var needW2 = CAKE_W / 0.56;
      if (2 * d * tan * aspect < needW2) d = needW2 / (2 * tan * aspect);
    }
    camBase.dist = Math.max(6.5, d);
    camBase.targetY = aspect < 0.92 ? 1.6 : (shortScreen ? 1.62 : 1.5);
    camBase.elev = aspect < 0.92 ? 0.25 : 0.3;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    applyCamera();
  }

  function applyCamera() {
    if (!camera) return;
    var d = camBase.dist * camMul * camPush;
    var targetY = camBase.targetY;
    var elev = camBase.elev + drag.tilt;
    var px = REDUCED ? 0 : pointer.nx * 0.4;
    var py = REDUCED ? 0 : -pointer.ny * 0.22;
    camera.position.set(px, targetY + d * Math.sin(elev) + py, d * Math.cos(elev));
    camera.lookAt(0, targetY, 0);
  }

  function onResize() {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, S.dprCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    layoutCamera();
  }

  /* ============================================================
   * 6. 拖拽 / 指针
   * ============================================================ */
  function bindPointer() {
    function down(e) {
      if (S.fallbackShown || S.blown) return;
      drag.active = true;
      drag.pointerId = e.pointerId;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.tiltTarget = drag.tilt;
      drag.idle = 0;
      document.body.classList.add('dragging');
      if (elDragHint) elDragHint.classList.add('gone');
      try { elCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    function move(e) {
      /* 非拖拽时也记录指针位置，做一点点相机视差 */
      if (window.innerWidth > 0 && window.innerHeight > 0) {
        pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.ny = (e.clientY / window.innerHeight) * 2 - 1;
      }
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      var dx = e.clientX - drag.lastX;
      var dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.yawTarget = clamp(drag.yawTarget + dx * 0.0052, -0.85, 0.85);
      drag.tiltTarget = clamp(drag.tiltTarget + dy * 0.0022, -0.055, 0.1);
      drag.idle = 0;
    }
    function up(e) {
      if (!drag.active) return;
      if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
      drag.active = false;
      drag.idle = 0;
      document.body.classList.remove('dragging');
      try { elCanvas.releasePointerCapture(drag.pointerId); } catch (err) { /* ignore */ }
    }
    elCanvas.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('blur', up);

    /* 上下键 / 左右键也能转，键盘用户友好 */
    window.addEventListener('keydown', function (e) {
      if (S.fallbackShown || S.blown) return;
      if (e.key === 'ArrowLeft') drag.yawTarget = clamp(drag.yawTarget - 0.12, -0.85, 0.85);
      else if (e.key === 'ArrowRight') drag.yawTarget = clamp(drag.yawTarget + 0.12, -0.85, 0.85);
    });
  }

  /* ============================================================
   * 7. 每帧更新
   * ============================================================ */
  function updateCamera(dt) {
    /* 开场镜头：从稍远处推近；动画按真实时间走，低帧率设备也不会卡在半路 */
    var intro = S.reduced ? 1 : clamp01(S.t / 1.6);
    var baseMul = 1 + 0.16 * (1 - easeOutCubic(intro));
    /* 吹完蜡烛，镜头再轻轻推近一点 */
    var push = 1;
    if (S.blown) {
      var pp = clamp01((S.t - S.blowT - 0.35) / 1.8);
      push = 1 - 0.055 * easeOutCubic(pp);
    }
    camMul = baseMul * push;
    drag.tilt += (drag.tiltTarget - drag.tilt) * Math.min(1, dt * 6);
    /* 松手 1.5 秒后慢慢转回正面，保证巧克力牌一直看得到 */
    if (!drag.active && !S.blown) {
      drag.idle += dt;
      if (drag.idle > 1.5) {
        drag.yawTarget += (0 - drag.yawTarget) * Math.min(1, dt * 0.9);
        drag.tiltTarget += (0 - drag.tiltTarget) * Math.min(1, dt * 0.9);
      }
    }
    applyCamera();
  }

  function updateCake(dt, t) {
    if (!cakeGroup) return;
    var target;
    if (S.blown) {
      target = S.revealed && !S.reduced ? Math.sin(t * 0.24) * 0.16 : 0;
    } else if (drag.active) {
      target = drag.yawTarget;
    } else {
      target = drag.yawTarget + (S.reduced ? 0 : Math.sin(t * 0.27) * 0.05);
    }
    cakeYaw += (target - cakeYaw) * Math.min(1, dt * 4.2);
    cakeGroup.rotation.y = cakeYaw;
    /* 极轻微的整体呼吸，让画面不呆 */
    cakeGroup.position.y = S.reduced ? 0 : Math.sin(t * 0.9) * 0.012;
  }

  function updateFlames(dt, t) {
    for (var i = 0; i < flames.length; i++) {
      var f = flames[i];
      if (f.dead) continue;
      if (S.blown && !f.dying && t >= f.outAt) {
        f.dying = true;
        f.diedAt = t;
        spawnSmoke(f, t);
      }
      if (f.dying) {
        var p = clamp01((t - f.diedAt) / 0.5);
        var e = easeOutCubic(p);
        var inv = 1 - e;
        f.flame.scale.setScalar(1 - e * 0.92);
        f.flameSpr.material.opacity = 0.96 * inv * inv;
        f.coreMat.opacity = 0.75 * inv;
        f.glowMat.opacity = 0.42 * inv;
        f.light && (f.light.intensity = f.baseLight * inv * inv);
        if (p >= 1) {
          f.dead = true;
          f.flame.visible = false;
          if (f.light) f.light.intensity = 0;
        }
        continue;
      }
      /* 火焰闪烁 */
      var fl = 0.82 + Math.sin(t * 11.3 + f.phase) * 0.08 +
        Math.sin(t * 19.7 + f.phase * 2.1) * 0.055 +
        Math.sin(t * 3.3 + f.phase) * 0.05;
      var wob = 1 + Math.sin(t * 7.1 + f.phase) * 0.035;
      f.flameSpr.scale.set(f.baseW * (0.94 + fl * 0.09) * wob, f.baseH * (0.9 + fl * 0.22), 1);
      f.flameSpr.position.x = Math.sin(t * 5.3 + f.phase) * 0.012;
      f.flameSpr.position.y = 0.02 + (fl - 0.82) * 0.05;
      f.flameSpr.material.rotation = Math.sin(t * 4.2 + f.phase) * 0.06;
      f.coreMat.opacity = 0.5 + fl * 0.1;
      f.glow.scale.set(
        f.glowW * (0.94 + fl * 0.1),
        f.glowH * (0.94 + fl * 0.1),
        1
      );
      f.glowMat.opacity = 0.24 + fl * 0.1;
      if (f.light) f.light.intensity = f.baseLight * (0.7 + fl * 0.38);
    }
  }

  function spawnSmoke(f, t) {
    if (f.diedSmoke) return;
    f.diedSmoke = true;
    var wp = new THREE.Vector3();
    f.flame.getWorldPosition(wp);
    for (var i = 0; i < 3; i++) {
      pendingSmoke.push({ at: t + i * 0.16, x: wp.x, y: wp.y + 0.06, z: wp.z, phase: Math.random() * 6.28 });
    }
  }

  function spawnSmokePuff(item) {
    for (var i = 0; i < smokePool.length; i++) {
      var s = smokePool[i];
      if (s.active) continue;
      s.active = true;
      s.t = 0;
      s.life = rand(1.3, 1.9);
      s.sprite.position.set(item.x + rand(-0.03, 0.03), item.y, item.z + rand(-0.03, 0.03));
      s.vx = rand(-0.06, 0.06);
      s.vy = rand(0.26, 0.46);
      s.vz = rand(-0.06, 0.06);
      s.s0 = rand(0.12, 0.2);
      s.s1 = rand(0.45, 0.72);
      s.sprite.visible = true;
      s.mat.opacity = 0;
      s.sprite.scale.set(s.s0, s.s0, 1);
      return;
    }
  }

  function updateSmoke(dt) {
    for (var i = 0; i < pendingSmoke.length; i++) {
      var it = pendingSmoke[i];
      if (!it) continue;
      if (S.t >= it.at) {
        spawnSmokePuff(it);
        pendingSmoke.splice(i, 1);
        i--;
      }
    }
    for (var k = 0; k < smokePool.length; k++) {
      var s = smokePool[k];
      if (!s.active) continue;
      s.t += dt;
      var p = clamp01(s.t / s.life);
      s.sprite.position.x += (s.vx + Math.sin(S.t * 1.1 + p * 3) * 0.05) * dt;
      s.sprite.position.y += s.vy * dt;
      s.sprite.position.z += s.vz * dt;
      var sc = lerp(s.s0, s.s1, easeOutCubic(p));
      s.sprite.scale.set(sc, sc, 1);
      var fade = p < 0.22 ? p / 0.22 : 1 - (p - 0.22) / 0.78;
      s.mat.opacity = clamp01(fade) * 0.3;
      s.mat.rotation = s.t * 0.25;
      if (p >= 1) {
        s.active = false;
        s.sprite.visible = false;
        s.mat.opacity = 0;
      }
    }
  }

  function updateDecor(dt, t) {
    if (!bgGroup) return;
    if (!S.reduced) {
      starGroup.rotation.y += dt * 0.006;
      starGroup.rotation.x = Math.sin(t * 0.05) * 0.02;
    }
    for (var i = 0; i < decorItems.length; i++) {
      var d = decorItems[i];
      var ph = t * d.speed + d.phase;
      d.sprite.position.x = d.base.x + Math.sin(ph) * d.amp;
      d.sprite.position.y = d.base.y + Math.cos(ph * 1.35) * d.amp * 0.9;
      d.sprite.position.z = d.base.z + Math.sin(ph * 0.78 + 1.1) * d.amp * 0.7;
      d.mat.rotation = Math.sin(ph * 0.7) * 0.16;
      if (d.kind === 'butterfly') {
        var flap = 0.58 + 0.42 * Math.abs(Math.sin(t * 6.4 + d.phase));
        d.sprite.scale.set(d.size * flap, d.size, 1);
        d.sprite.position.y += Math.sin(t * 1.7 + d.phase) * 0.16;
      } else if (d.kind === 'spark') {
        d.mat.opacity = d.op * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.3 + d.phase)));
      } else {
        d.sprite.scale.set(d.size * (1 + Math.sin(ph * 1.6) * 0.06), d.size * (1 + Math.sin(ph * 1.6) * 0.06), 1);
      }
    }
    for (var b = 0; b < bokehSprites.length; b++) {
      var bs = bokehSprites[b];
      bs.position.y += Math.sin(t * 0.2 + b) * 0.0007;
    }
  }

  /* ---------- 礼花 ---------- */
  function startFireworks() {
    if (S.fwStarted) return;
    S.fwStarted = true;
    if (!confetti) { showReveal(); return; }

    var C = confetti.count;
    var meshes = confetti;
    for (var i = 0; i < C; i++) {
      var th = Math.random() * Math.PI * 2;
      var speed = rand(1.2, 6.4);
      var ox = rand(-0.7, 0.7);
      var oz = rand(-0.7, 0.7);
      meshes.p[i * 3] = ox;
      meshes.p[i * 3 + 1] = TOP_Y + 0.25 + rand(-0.2, 0.5);
      meshes.p[i * 3 + 2] = oz;
      meshes.v[i * 3] = Math.cos(th) * speed;
      meshes.v[i * 3 + 1] = rand(2.6, 8.4);
      meshes.v[i * 3 + 2] = Math.sin(th) * speed;
      meshes.rot[i * 3] = Math.random() * 6.28;
      meshes.rot[i * 3 + 1] = Math.random() * 6.28;
      meshes.rot[i * 3 + 2] = Math.random() * 6.28;
      meshes.rv[i * 3] = rand(-9, 9);
      meshes.rv[i * 3 + 1] = rand(-9, 9);
      meshes.rv[i * 3 + 2] = rand(-9, 9);
      var streamer = Math.random() < 0.36;
      meshes.scale[i * 2] = streamer ? rand(0.5, 1.0) : rand(0.7, 1.3);
      meshes.scale[i * 2 + 1] = streamer ? rand(2.2, 4.2) : rand(0.8, 1.5);
    }
    confetti.active = true;
    confetti.t = 0;
    confetti.mat.opacity = 1;
    confetti.mesh.visible = true;

    /* 三束烟花 */
    var origins = [
      new THREE.Vector3(-1.2, TOP_Y + 0.6, 0.4),
      new THREE.Vector3(1.35, TOP_Y + 1.0, -0.3),
      new THREE.Vector3(0.1, TOP_Y + 1.4, 0.7)
    ];
    for (var b = 0; b < bursts.length; b++) {
      spawnBurst(b, origins[b]);
    }
    boomLight.intensity = 3.2;
    boomLight.color.setHex(0xffc98a);
    boomLight.position.set(0.2, TOP_Y + 1.2, 1.2);

    if (elFlash && !S.reduced) {
      elFlash.classList.remove('on');
      /* 强制重排，让动画能重播 */
      void elFlash.offsetWidth;
      elFlash.classList.add('on');
    }
  }

  function spawnBurst(idx, origin) {
    var b = bursts[idx];
    if (!b) return;
    var n = b.count;
    b.origin.copy(origin);
    var palettes = [
      [0xffd7a0, 0xfff0cc],
      [0xff9fbe, 0xffd0e0],
      [0x9fc7ff, 0xd9ecff]
    ];
    var pal = palettes[idx % palettes.length];
    var cA = new THREE.Color(pal[0]);
    var cB = new THREE.Color(pal[1]);
    for (var i = 0; i < n; i++) {
      b.p[i * 3] = origin.x;
      b.p[i * 3 + 1] = origin.y;
      b.p[i * 3 + 2] = origin.z;
      var th = Math.random() * Math.PI * 2;
      var up = rand(-0.35, 1);
      var sp = rand(1.6, 4.6);
      var horiz = Math.sqrt(Math.max(0, 1 - up * up));
      b.v[i * 3] = Math.cos(th) * horiz * sp;
      b.v[i * 3 + 1] = up * sp + 1.2;
      b.v[i * 3 + 2] = Math.sin(th) * horiz * sp;
      var mix = Math.random();
      var cr = lerp(cA.r, cB.r, mix);
      var cg = lerp(cA.g, cB.g, mix);
      var cb = lerp(cA.b, cB.b, mix);
      b.baseCol[i * 3] = cr;
      b.baseCol[i * 3 + 1] = cg;
      b.baseCol[i * 3 + 2] = cb;
    }
    b.t = idx * 0.26;
    b.active = true;
    b.points.visible = true;
    b.geo.attributes.position.needsUpdate = true;
    b.geo.attributes.color.needsUpdate = true;
  }

  function updateConfetti(dt) {
    if (!confetti || !confetti.active) return;
    confetti.t += dt;
    var t = confetti.t;
    var C = confetti.count;
    var mesh = confetti.mesh;
    var dummy = updateConfetti._dummy;
    if (!dummy) {
      dummy = updateConfetti._dummy = new THREE.Object3D();
    }
    var fade = t > 3.0 ? clamp01(1 - (t - 3.0) / 0.9) : 1;
    confetti.mat.opacity = fade;
    for (var i = 0; i < C; i++) {
      var i3 = i * 3;
      confetti.v[i3 + 1] -= 6.6 * dt;
      confetti.v[i3] *= (1 - 0.5 * dt);
      confetti.v[i3 + 2] *= (1 - 0.5 * dt);
      confetti.p[i3] += confetti.v[i3] * dt;
      confetti.p[i3 + 1] += confetti.v[i3 + 1] * dt;
      confetti.p[i3 + 2] += confetti.v[i3 + 2] * dt;
      if (confetti.p[i3 + 1] < -1.4) {
        confetti.p[i3 + 1] = -1.4;
        confetti.v[i3 + 1] = 0;
        confetti.v[i3] *= 0.5;
        confetti.v[i3 + 2] *= 0.5;
      }
      confetti.rot[i3] += confetti.rv[i3] * dt;
      confetti.rot[i3 + 1] += confetti.rv[i3 + 1] * dt;
      confetti.rot[i3 + 2] += confetti.rv[i3 + 2] * dt;
      dummy.position.set(confetti.p[i3], confetti.p[i3 + 1], confetti.p[i3 + 2]);
      dummy.rotation.set(confetti.rot[i3], confetti.rot[i3 + 1], confetti.rot[i3 + 2]);
      dummy.scale.set(confetti.scale[i * 2], confetti.scale[i * 2 + 1], 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (t > confetti.life) {
      confetti.active = false;
      mesh.visible = false;
    }
  }

  function updateBursts(dt) {
    for (var b = 0; b < bursts.length; b++) {
      var burst = bursts[b];
      if (!burst.active) continue;
      burst.t += dt;
      if (burst.t < 0) continue;
      var t = burst.t;
      var n = burst.count;
      if (t > burst.life) {
        burst.active = false;
        burst.points.visible = false;
        continue;
      }
      var fade = Math.pow(1 - t / burst.life, 1.6);
      for (var i = 0; i < n; i++) {
        var i3 = i * 3;
        burst.v[i3 + 1] -= 4.2 * dt;
        burst.v[i3] *= (1 - 0.55 * dt);
        burst.v[i3 + 1] *= (1 - 0.55 * dt);
        burst.v[i3 + 2] *= (1 - 0.55 * dt);
        burst.p[i3] += burst.v[i3] * dt;
        burst.p[i3 + 1] += burst.v[i3 + 1] * dt;
        burst.p[i3 + 2] += burst.v[i3 + 2] * dt;
        burst.colArr[i3] = burst.baseCol[i3] * fade;
        burst.colArr[i3 + 1] = burst.baseCol[i3 + 1] * fade;
        burst.colArr[i3 + 2] = burst.baseCol[i3 + 2] * fade;
      }
      burst.geo.attributes.position.needsUpdate = true;
      burst.geo.attributes.color.needsUpdate = true;
      burst.mat.opacity = fade;
    }
    if (boomLight && boomLight.intensity > 0.01) {
      boomLight.intensity *= Math.pow(0.02, dt);
      if (boomLight.intensity < 0.02) boomLight.intensity = 0;
    }
  }

  /* ============================================================
   * 8. 吹蜡烛 / 揭晓
   * ============================================================ */
  function blow() {
    if (S.blown) return;
    S.blown = true;
    debug.blown = true;
    S.blowT = S.t;
    S.fwStartAt = S.t + 1.02;
    S.revealAt = S.t + 1.5;
    document.body.classList.add('blown');
    if (elBlow) elBlow.disabled = true;
    if (S.mode !== '3d') {
      /* 降级模式：直接给结果 */
      setTimeout(showReveal, 260);
      return;
    }
    for (var i = 0; i < flames.length; i++) {
      flames[i].outAt = S.t + 0.14 + i * 0.24;
    }
    drag.yawTarget = 0;
    drag.tiltTarget = 0;
  }

  function showReveal() {
    if (S.revealed) return;
    S.revealed = true;
    debug.revealed = true;
    document.body.classList.add('revealed');
    if (elReveal) elReveal.setAttribute('aria-hidden', 'false');
    if (elDragHint) elDragHint.classList.add('gone');
  }

  function updateBlowTimeline() {
    if (!S.blown) return;
    if (!S.fwStarted && S.t >= S.fwStartAt) startFireworks();
    if (!S.revealed && S.t >= S.revealAt) showReveal();
  }

  /* ============================================================
   * 9. 主循环
   * ============================================================ */
  /* 自适应画质：连续掉帧就降分辨率、再不行关阴影，保证画面先流畅 */
  var perf = { acc: 0, frames: 0, level: 0, warm: 0 };
  function adaptQuality(raw) {
    if (!renderer || perf.level >= 2) return;
    perf.warm += raw;
    if (perf.warm < 1.5) return;
    perf.acc += raw;
    perf.frames += 1;
    if (perf.acc < 2.0) return;
    var fps = perf.frames / perf.acc;
    perf.acc = 0;
    perf.frames = 0;
    if (fps >= 42) return;
    perf.level += 1;
    if (perf.level === 1) {
      var cur = renderer.getPixelRatio();
      var next = Math.max(1, Math.min(cur, S.dprCap) * 0.78);
      renderer.setPixelRatio(next);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      debug.quality = 'dpr-' + next.toFixed(2);
      if (window.console && console.info) console.info('[cake] 掉帧（' + fps.toFixed(0) + 'fps），渲染分辨率降到 ' + next.toFixed(2));
    } else {
      if (renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = false;
        scene.traverse(function (o) {
          if (o.isMesh && o.material) {
            var arr = Array.isArray(o.material) ? o.material : [o.material];
            for (var i = 0; i < arr.length; i++) arr[i].needsUpdate = true;
          }
        });
      }
      debug.quality = 'no-shadow';
      if (window.console && console.info) console.info('[cake] 仍然掉帧（' + fps.toFixed(0) + 'fps），关闭阴影');
    }
  }

  function tick(now) {
    rafId = window.requestAnimationFrame(tick);
    if (!renderer) return;
    if (document.hidden || S.paused) {
      clockLast = 0;
      return;
    }
    if (!clockLast) clockLast = now;
    var raw = (now - clockLast) / 1000;
    clockLast = now;
    if (!(raw > 0)) raw = 1 / 60;
    if (raw > 0.5) raw = 0.5; // 超大帧（切回标签页等）不让动画跳太远
    var dt = Math.min(raw, 0.1); // 物理步长上限，避免礼花穿透
    S.t += raw;
    adaptQuality(raw);

    try {
      updateCamera(dt);
      updateCake(dt, S.t);
      updateFlames(dt, S.t);
      updateSmoke(dt);
      updateDecor(dt, S.t);
      updateBlowTimeline();
      updateConfetti(dt);
      updateBursts(dt);
      renderer.render(scene, camera);
    } catch (err) {
      dbgError('render: ' + (err && err.message));
      /* 渲染循环里出错就停掉，避免每帧刷屏 */
      window.cancelAnimationFrame(rafId);
      showFallback('3D 渲染出了点问题', '点「再试一次」重新加载页面看看，或者直接看祝福。');
      return;
    }

    if (!S.ready) {
      S.ready = true;
      debug.ready = true;
    }
    if (!document.body.classList.contains('ready')) {
      document.body.classList.add('ready');
    }
  }

  /* ============================================================
   * 10. 启动
   * ============================================================ */
  function boot() {
    if (!window.THREE) {
      showFallback('3D 引擎没加载出来', 'vendor/three/three.min.js 没有找到。确认整个文件夹一起发送/解压，再刷新试试。');
      return;
    }
    var webgl = detectWebGL();
    if (!webgl) {
      showFallback('这台设备没开 3D 加速', '浏览器没有拿到 WebGL 上下文（常见于旧版浏览器或关了硬件加速）。换最新版 Chrome / Edge / Safari，或者点下面直接看祝福。');
      return;
    }
    S.webgl = webgl;
    debug.webgl = webgl;
    try {
      init3D();
    } catch (err) {
      dbgError('init: ' + (err && err.message));
      if (renderer) {
        try { renderer.dispose(); } catch (e2) { /* ignore */ }
        renderer = null;
      }
      showFallback('3D 蛋糕没画出来', '初始化 3D 场景时出错了。点「再试一次」重新加载，或者直接看祝福。');
      return;
    }
    window.requestAnimationFrame(tick);
    /* 场景建好后稍微提前把顶部文字亮出来，别等第一帧 */
    setTimeout(function () { document.body.classList.add('ready'); }, 60);
  }

  /* UI 事件：吹蜡烛 / 降级里的两个按钮 */
  if (elBlow) {
    elBlow.addEventListener('click', function (e) {
      e.preventDefault();
      blow();
    });
  }
  if (elFbBless) {
    elFbBless.addEventListener('click', function () {
      if (elFallback) elFallback.hidden = true;
      if (!S.blown) {
        S.blown = true;
        debug.blown = true;
        document.body.classList.add('blown');
      }
      showReveal();
    });
  }
  if (elFbRetry) {
    elFbRetry.addEventListener('click', function () { window.location.reload(); });
  }

  /* 给测试脚本 / 控制台留一个入口，也方便以后手动调试 */
  debug.blow = blow;
  debug.reveal = showReveal;
  debug.info = function () {
    return {
      mode: S.mode,
      webgl: S.webgl,
      blown: S.blown,
      revealed: S.revealed,
      reduce: S.reduced,
      lowEnd: S.lowEnd,
      counts: debug.counts,
      camDist: camBase.dist,
      errors: debug.errors.slice()
    };
  };
  /* 调试用：把蛋糕关键点投影回屏幕坐标，方便检查不同尺寸下的构图 */
  debug.layout = function () {
    if (!camera) return null;
    var W = window.innerWidth;
    var H = window.innerHeight;
    var v = new THREE.Vector3();
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    function add(x, y, z) {
      v.set(x, y, z).project(camera);
      var px = (v.x * 0.5 + 0.5) * W;
      var py = (-v.y * 0.5 + 0.5) * H;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      return [Math.round(px), Math.round(py)];
    }
    var i, ang;
    for (i = 0; i < 32; i++) {
      ang = (i / 32) * Math.PI * 2;
      add(Math.cos(ang) * TRAY.r, 0.16, Math.sin(ang) * TRAY.r);
      add(Math.cos(ang) * TRAY.r * 0.96, 0.04, Math.sin(ang) * TRAY.r * 0.96);
    }
    var flameTops = [];
    for (i = 0; i < CANDLE_DEFS.length; i++) {
      var C = CANDLE_DEFS[i];
      flameTops.push(add(C.x, TOP_Y + C.h + 0.36, C.z));
    }
    var cakeTop = add(0, TOP_Y, 0);
    return {
      viewport: W + 'x' + H,
      camera: camera.position.toArray().map(function (n) { return Math.round(n * 100) / 100; }),
      camDist: Math.round(camBase.dist * 100) / 100,
      camMul: Math.round(camMul * 1000) / 1000,
      cake: { left: Math.round(minX), right: Math.round(maxX), top: Math.round(minY), bottom: Math.round(maxY) },
      widthPct: Math.round(((maxX - minX) / W) * 1000) / 10,
      heightPct: Math.round(((maxY - minY) / H) * 1000) / 10,
      flameTops: flameTops,
      cakeTop: cakeTop
    };
  };

  boot();
})();
