/* ------------------------------------------------------------
   专属入口：纪念日口令
   ------------------------------------------------------------
   配置写在 js/data.js 的 lock 里：
     lock: {
       question: '我们在一起的纪念日，是哪一天？',
       hint:     '2025.11.25 这样写就行，11月25日 也认',
       answer:   '2025-11-25',
       rememberDays: 30,      // 答对后这台设备记多久，0 = 每次都问
     }
   答对后写入 localStorage，之后直接进；地址加 ?lock=1 可以重新锁上。
   ------------------------------------------------------------ */
(function () {
  var G = window.GIFT || {};
  var cfg = G.lock || {};
  var KEY = 'gift_unlock_v1';
  var DAY = 24 * 60 * 60 * 1000;
  var html = document.documentElement;

  /* 没配答案就不拦 */
  if (!cfg.answer) {
    html.classList.remove('locked');
    return;
  }

  var answer = String(cfg.answer);
  var digits = answer.replace(/\D/g, ''); // 20251125
  var accepted = {};
  if (digits.length >= 8) {
    accepted[digits] = 1;                 // 20251125
    accepted[digits.slice(2)] = 1;        // 251125
    accepted[digits.slice(4)] = 1;        // 1125
  } else {
    accepted[digits] = 1;
  }

  /* 地址加 ?lock=1 表示强制重锁一次 */
  var force = /[?&]lock=1\b/.test(location.search);
  if (force) {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  /* 这台设备之前答对过就放行 */
  if (!force) {
    try {
      var until = parseInt(localStorage.getItem(KEY) || '0', 10);
      if (until && until > Date.now()) {
        html.classList.remove('locked');
        html.classList.add('unlocked');
        return;
      }
    } catch (e) {}
  }

  var remembered = cfg.rememberDays;
  if (remembered == null) remembered = 30;

  var root = document.createElement('div');
  root.id = 'lock';
  root.innerHTML =
    '<div class="lock-inner">' +
      '<div class="lock-heart">♡</div>' +
      '<p class="lock-eyebrow">For Us Only</p>' +
      '<h1 class="lock-q"></h1>' +
      '<p class="lock-sub">答对了，才进得来</p>' +
      '<form class="lock-form" novalidate>' +
        '<input class="lock-input" id="lockInput" type="text" inputmode="numeric" ' +
          'autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="24">' +
        '<button class="lock-btn" type="submit">进 门</button>' +
      '</form>' +
      '<p class="lock-err" id="lockErr"></p>' +
      '<p class="lock-hint"></p>' +
    '</div>';

  var q = root.querySelector('.lock-q');
  var input = root.querySelector('.lock-input');
  var form = root.querySelector('.lock-form');
  var err = root.querySelector('.lock-err');
  var hint = root.querySelector('.lock-hint');

  q.textContent = cfg.question || '我们在一起的纪念日，是哪一天？';
  input.placeholder = cfg.placeholder || 'YYYY.MM.DD';
  hint.textContent = cfg.hint || '';

  document.body.appendChild(root);
  html.classList.add('locked');

  window.setTimeout(function () {
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  }, 60);

  function fail(msg) {
    err.textContent = msg;
    err.classList.add('on');
    input.classList.remove('lock-shake');
    void input.offsetWidth;
    input.classList.add('lock-shake');
    input.select();
  }

  function pass() {
    err.classList.remove('on');
    if (remembered > 0) {
      try { localStorage.setItem(KEY, String(Date.now() + remembered * DAY)); } catch (e) {}
    }
    html.classList.remove('locked');
    html.classList.add('unlocked');
    root.classList.add('out');
    window.setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    }, 780);
    window.dispatchEvent(new CustomEvent('gift:unlock'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = String(input.value).replace(/\D/g, '');
    if (!v) {
      fail('先写下那一天的日期呀');
      return;
    }
    if (accepted[v]) {
      pass();
    } else {
      fail('不对哦，再想想我们开始的那一天 ♡');
    }
  });

  input.addEventListener('input', function () {
    if (err.classList.contains('on')) err.classList.remove('on');
  });
})();
