/* ============================================================
 *  页面衔接转场（方案 T1 · 心形扩张）
 *  ------------------------------------------------------------
 *  点站内链接时，一颗心形从按钮位置长出来、吞满整屏，
 *  盖满的那一刻跳转；新页面带着同一颗心进场，再从中心收缩消失。
 *
 *  实现要点：
 *  · 遮罩是一个全屏 <div>，里面一张 200×200 的 SVG 心形，
 *    靠 transform: translate(圆心) + scale 放大缩小；
 *  · 用 sessionStorage 传「我是转场来的」这一个信号，8 秒内有效；
 *  · 遮罩在 <head> 里就建好，保证新页面首帧不会先闪出内容；
 *  · 不支持的场景（锁定页、外链、新窗口、按住 Ctrl/⌘）自动放行。
 *  依赖：无（不引第三方库）
 * ============================================================ */
(function () {
  'use strict';
  if (window.__giftHeartMask) return;
  window.__giftHeartMask = true;

  /* ---------- 参数 ---------- */
  var ROUTES = ['index.html', 'cake.html', 'story.html', 'photos.html'];
  var STORE = 'gift_heart_route';
  var EXPAND = 620;     // 扩张：按钮中心 → 吞满整屏
  var HOLD = 90;        // 盖满后停留，这段里完成跳转
  var CONTRACT = 700;   // 从新页面的锚点收缩
  var EASE_OUT = 'cubic-bezier(.7,0,.2,1)';
  var EASE_IN = 'cubic-bezier(.62,0,.86,.36)';

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function dur(ms) { return reduced ? 1 : ms; }

  var HEART = 'M100 176 C55 144 8 111 8 70 C8 39 30 16 59 16 C78 16 93 27 100 44 ' +
              'C107 27 122 16 141 16 C170 16 192 39 192 70 C192 111 145 144 100 176 Z';

  /* ---------- 造遮罩（在 head 里就能建，避免首帧闪内容） ---------- */
  var style = document.createElement('style');
  style.textContent =
    '#giftHeartMask{position:fixed;left:0;top:0;z-index:9999;pointer-events:none;' +
    'display:none;transform-origin:0 0;will-change:transform,opacity}' +
    '#giftHeartMask svg{display:block;width:100%;height:100%;overflow:visible}';
  document.head.appendChild(style);

  var mask = document.createElement('div');
  mask.id = 'giftHeartMask';
  mask.setAttribute('aria-hidden', 'true');
  mask.innerHTML =
    '<svg viewBox="0 0 200 200" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="giftHeartFill" x1=".15" y1="0" x2=".85" y2="1">' +
          '<stop offset="0" stop-color="#2f0e20"/>' +
          '<stop offset=".55" stop-color="#1d0712"/>' +
          '<stop offset="1" stop-color="#170811"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="' + HEART + '" fill="url(#giftHeartFill)"/>' +
      '<path d="' + HEART + '" fill="none" stroke="rgba(255,209,102,.42)" ' +
            'stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
    '</svg>';
  document.documentElement.appendChild(mask);

  /* ---------- 尺寸与摆放 ----------
     心形在 200×200 视框里，中心到边界的最小半径约 80（归一化 0.4）。
     要盖住「锚点到最远屏幕角」的距离 far，需要边长 D ≥ 2.5 × far，
     再乘 1.15 余量，并限制上限防止极端比例下 SVG 过大。 */
  function maskSizeFor(cx, cy) {
    var W = window.innerWidth, H = window.innerHeight;
    var far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    return Math.max(260, Math.min(2.5 * far * 1.15, 6400));
  }

  function place(cx, cy, s, D, ms, ease) {
    mask.style.width = D + 'px';
    mask.style.height = D + 'px';
    mask.style.transition = ms > 0 ? 'transform ' + ms + 'ms ' + ease : 'none';
    mask.style.transform = 'translate3d(' + (cx - D / 2) + 'px,' + (cy - D / 2) + 'px,0) scale(' + s + ')';
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function viewportCenter() {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  /* ---------- 读 / 写进场信号 ---------- */
  function takeFlag() {
    var t = 0;
    try {
      t = parseInt(sessionStorage.getItem(STORE) || '0', 10);
      sessionStorage.removeItem(STORE);
    } catch (e) { t = 0; }
    return t && (Date.now() - t < 8000);
  }

  /* ---------- 进场：带着满屏心形，然后收缩露出页面 ---------- */
  var entering = takeFlag();
  var enterPoint = viewportCenter();
  if (entering) {
    var D0 = maskSizeFor(enterPoint.x, enterPoint.y);
    mask.style.display = 'block';
    place(enterPoint.x, enterPoint.y, 1, D0, 0, EASE_OUT);
  }

  function revealFrom(el) {
    var p = el ? centerOf(el) : viewportCenter();
    var D = maskSizeFor(p.x, p.y);
    /* 先无过渡地挪到锚点（此刻整屏还是被盖住的），再收缩 */
    place(p.x, p.y, 1, D, 0, EASE_OUT);
    void mask.offsetWidth;
    requestAnimationFrame(function () {
      place(p.x, p.y, 0.02, D, dur(CONTRACT), EASE_IN);
      setTimeout(function () {
        mask.style.transition = 'opacity 240ms ease';
        mask.style.opacity = '0';
        setTimeout(function () {
          mask.style.display = 'none';
          mask.style.opacity = '';
          mask.style.transition = 'none';
        }, 260);
      }, dur(CONTRACT));
    });
  }

  function startEnter() {
    if (!entering) return;
    entering = false;
    var anchor = document.querySelector('[data-enter-anchor]');
    revealFrom(anchor);
  }

  /* ---------- 出站：心形从按钮长出来然后跳转 ---------- */
  var busy = false;
  function isRoute(href) {
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin) return false;
      var file = u.pathname.split('/').pop() || 'index.html';
      return ROUTES.indexOf(file) >= 0;
    } catch (e) { return false; }
  }

  function leave(a) {
    if (busy) return;
    busy = true;
    var p = centerOf(a);
    var D = maskSizeFor(p.x, p.y);
    mask.style.display = 'block';
    mask.style.opacity = '1';
    place(p.x, p.y, 0.02, D, 0, EASE_OUT);
    void mask.offsetWidth;
    place(p.x, p.y, 1, D, dur(EXPAND), EASE_OUT);
    var href = a.href;
    setTimeout(function () {
      try { sessionStorage.setItem(STORE, String(Date.now())); } catch (e) {}
      location.href = href;
    }, dur(EXPAND) + dur(HOLD));
  }

  /* 用 window 的捕获阶段监听：抢在页面自己的点击特效之前拦下这次跳转 */
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button && e.button !== 0) return;
    if (document.documentElement.classList.contains('locked')) return;

    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('data-no-transition')) return;
    if (!isRoute(a.getAttribute('href'))) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    leave(a);
  }, true);

  /* ---------- 生命周期 ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startEnter);
  } else {
    startEnter();
  }

  /* 转场途中窗口被拉伸/旋转，直接收场，避免遮罩错位 */
  window.addEventListener('resize', function () {
    if (!busy && !entering) return;
    mask.style.display = 'none';
    mask.style.opacity = '';
    mask.style.transition = 'none';
    busy = false;
    entering = false;
  });

  /* 浏览器前进后退回来（页面在 bfcache 里）时把状态清干净 */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    mask.style.display = 'none';
    mask.style.opacity = '';
    mask.style.transition = 'none';
    busy = false;
    entering = false;
    try { sessionStorage.removeItem(STORE); } catch (err) {}
  });
})();
