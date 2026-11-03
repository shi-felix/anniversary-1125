/* ==========================================================
 *  二开部分：故事长页（story.html）
 *  ----------------------------------------------------------
 *  上游 heart-code 负责爱心页（index.html）；蛋糕页是 cake.html；
 *  这个文件把 js/data.js 里的内容渲染成故事长页 + 照片灯箱 + 音乐。
 *  所有文案都在 js/data.js，这里一般不用动。
 * ========================================================== */
(function () {
  'use strict';

  var G = window.GIFT || {};
  var body = document.body;
  var IS_STORY_PAGE = body.classList.contains('page-story');
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function $(sel) {
    return document.querySelector(sel);
  }
  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseDate(str) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str || '').trim());
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function fmtDate(d, sep) {
    return d ? d.getFullYear() + sep + pad2(d.getMonth() + 1) + sep + pad2(d.getDate()) : '';
  }

  /* ---------------- 日期 ---------------- */
  var now = new Date();
  var startDate = parseDate(G.togetherDate) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var years = Math.max(1, Number(G.years) || 1);
  var endDate = new Date(startDate.getFullYear() + years, startDate.getMonth(), startDate.getDate());
  var startMid = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  var nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var daysTogether = Math.max(1, Math.round((nowMid - startMid) / 86400000));
  var mainMsg = G.mainMessage || '一周年快乐';
  var signText = G.sign || G.from || '';

  /* ---------------- 各种小模块 ---------------- */
  function buildCountdown() {
    var list = G.countdowns || (G.countdown ? [G.countdown] : []);
    var chips = [];
    list.forEach(function (c) {
      var target = parseDate(c && c.date);
      if (!target || !c.label) return;
      var mid = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      var days = Math.round((mid - nowMid) / 86400000);
      var guard = 0;
      while (days < 0 && guard < 6) {
        mid = new Date(mid.getFullYear() + 1, mid.getMonth(), mid.getDate());
        days = Math.round((mid - nowMid) / 86400000);
        guard += 1;
      }
      if (days === 0) {
        chips.push('<p class="countdown-chip is-today">今天就是' + esc(String(c.label).replace(/^距离/, '')) + ' ♡</p>');
      } else {
        chips.push('<p class="countdown-chip">' + esc(c.label) + '还有 <b>' + days + '</b> 天</p>');
      }
    });
    if (!chips.length) return '';
    return '<div class="countdown-row">' + chips.join('') + '</div>';
  }

  function buildChapters() {
    var list = G.chapters || G.story || [];
    if (!list.length) return '';
    var items = list
      .map(function (it, i) {
        var photo = it.photo
          ? '<figure class="chapter-photo"><img src="' + esc((G.photoDir || 'assets/photos/') + it.photo) +
            '" alt="" loading="lazy" onerror="this.parentNode.style.display=\'none\'"></figure>'
          : '';
        return (
          '<article class="chapter">' +
          '<div class="chapter-head">' +
          (it.stage ? '<span class="chapter-stage">' + esc(it.stage) + '</span>' : '') +
          '<span class="chapter-date">' + esc(it.date) + '</span>' +
          '</div>' +
          '<h4 class="chapter-title">' + esc(it.title) + '</h4>' +
          '<p class="chapter-text">' + esc(it.text) + '</p>' +
          photo +
          '</article>'
        );
      })
      .join('');
    return '<div class="chapters">' + items + '</div>';
  }

  function buildNumbers() {
    var list = G.numbers || [];
    if (!list.length) return '';
    var items = list
      .map(function (n) {
        return (
          '<div class="number-card">' +
          '<div class="num">' + esc(n.value) + '<span class="unit">' + esc(n.unit || '') + '</span></div>' +
          '<div class="nlabel">' + esc(n.label) + '</div>' +
          '</div>'
        );
      })
      .join('');
    return '<div class="numbers">' + items + '</div>';
  }

  function buildAboutHer() {
    var list = G.aboutHer || [];
    if (!list.length) return '';
    var items = list
      .map(function (it) {
        return (
          '<div class="about-item">' +
          '<div class="q">' + esc(it.q) + '</div>' +
          '<div class="a">' + esc(it.a) + '</div>' +
          '</div>'
        );
      })
      .join('');
    return '<div class="about">' + items + '</div>';
  }

  function buildMoments() {
    var list = G.moments || [];
    if (!list.length) return '';
    return (
      '<div class="moments">' +
      list
        .map(function (it) {
          return (
            '<div class="moment">' +
            '<div class="ico">' + esc(it.icon || '♡') + '</div>' +
            '<h4>' + esc(it.title) + '</h4>' +
            '<p>' + esc(it.text) + '</p>' +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function buildSmallThings() {
    var list = G.smallThings || [];
    if (!list.length) return '';
    return (
      '<ul class="small-things">' +
      list
        .map(function (it) {
          return (
            '<li class="thing' + (it.done ? ' is-done' : '') + '">' +
            '<span class="mark">' + (it.done ? '✓' : '○') + '</span>' +
            '<span class="thing-text">' + esc(it.text) + '</span>' +
            (it.done ? '<span class="tag">已做过</span>' : '<span class="tag tag-todo">想做</span>') +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function buildLoveNotes() {
    var list = G.loveNotes || [];
    if (!list.length) return '';
    return (
      '<div class="love-note-card">' +
      '<p class="love-note-text" id="loveNoteText">' + esc(list[0]) + '</p>' +
      '<button class="note-btn" id="nextNoteBtn" type="button">换一句 ♡</button>' +
      '</div>'
    );
  }

  function buildFutureLetter() {
    var fl = G.futureLetter || {};
    if (!fl.title && !fl.text) return '';
    return (
      '<div class="future-letter" id="futureLetter">' +
      '<button class="fl-cover" id="openFutureBtn" type="button">' +
      '<span class="fl-icon">✉</span>' +
      '<span class="fl-title">' + esc(fl.title || '给一年后的我们') + '</span>' +
      '<span class="fl-hint">点一下打开</span>' +
      '</button>' +
      '<div class="fl-body"><p>' + esc(fl.text || '') + '</p></div>' +
      '</div>'
    );
  }

  /* ---------------- 渲染故事页 ---------------- */
  function buildStory() {
    var story = $('#story');
    if (!story) return;

    var sections = [];
    var no = 0;
    function add(title, html) {
      if (!html) return;
      no += 1;
      sections.push(
        '<section class="block"><h3 class="block-title"><span>' +
          (no < 10 ? '0' + no : no) +
          '</span>' + title +
          '</h3>' + html + '</section>'
      );
    }

    add('我们的故事', buildChapters());
    add('一年数据档案', buildNumbers());
    add('关于她的小档案', buildAboutHer());
    add('我们的点点滴滴', buildMoments());
    add('照片里的我们', '<div class="photos" id="photos"></div>');
    add('一起做的小事', buildSmallThings());
    add(
      '写给你的一封信',
      '<article class="letter">' +
        (G.letter || [])
          .map(function (p, i) {
            return '<p' + (i === 0 ? ' class="no-indent"' : '') + '>' + esc(p) + '</p>';
          })
          .join('') +
        '<p class="sign">' + esc(signText) + '</p></article>'
    );
    add('想对你说的话', buildLoveNotes());
    add('给一年后的我们', buildFutureLetter());
    add(
      '以后想和你一起做的事',
      (G.promise || []).length
        ? '<ul class="promise">' +
            (G.promise || [])
              .map(function (x) {
                return '<li>' + esc(x) + '</li>';
              })
              .join('') +
            '</ul>'
        : ''
    );

    story.innerHTML =
      '<div class="story-inner">' +
      '<header class="story-head">' +
      '<p class="eyebrow">ONE YEAR WITH YOU</p>' +
      '<h2 class="story-title">' + esc(G.to || '亲爱的') + '，' + esc(mainMsg) + '</h2>' +
      '<p class="story-sub">从 <b>' + fmtDate(startDate, '.') + '</b> 到今天，我们已经一起走了 <b>' +
      daysTogether + '</b> 天</p>' +
      buildCountdown() +
      '<div class="scroll-hint"><span>往下看</span><i></i></div>' +
      '</header>' +
      sections.join('') +
      '<footer class="story-foot">' +
      '<div class="foot-heart">♥</div>' +
      '<p class="foot-title">' + esc(mainMsg) + '</p>' +
      '<p class="foot-sign">' + fmtDate(endDate, '.') + ' · 写给你</p>' +
      '<div class="foot-actions">' +
      '<a class="btn-primary" href="index.html">再看一次</a>' +
      '<a class="btn-ghost" href="cake.html">回到蛋糕</a>' +
      '</div>' +
      '</footer>' +
      '</div>';

    bindStoryWidgets();
    renderPhotos();
  }

  function bindStoryWidgets() {
    var list = G.loveNotes || [];
    var noteText = $('#loveNoteText');
    var nextBtn = $('#nextNoteBtn');
    if (noteText && nextBtn && list.length) {
      var idx = 0;
      nextBtn.addEventListener('click', function () {
        idx = (idx + 1) % list.length;
        noteText.textContent = list[idx];
        noteText.classList.remove('flip');
        void noteText.offsetWidth;
        noteText.classList.add('flip');
      });
    }

    var future = $('#futureLetter');
    var openBtn = $('#openFutureBtn');
    if (future && openBtn) {
      openBtn.addEventListener('click', function () {
        future.classList.add('is-open');
        openBtn.setAttribute('aria-expanded', 'true');
      });
    }
  }

  function renderPhotos() {
    var box = $('#photos');
    if (!box) return;
    var dir = G.photoDir || 'assets/photos/';
    box.innerHTML = '';

    (G.photos || []).forEach(function (ph) {
      var fig = document.createElement('figure');
      fig.className = 'photo-card';
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');

      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = ph.caption || '';
      img.src = dir + ph.file;
      img.addEventListener('error', function () {
        img.remove();
        fig.classList.add('is-placeholder');
        fig.insertAdjacentHTML('afterbegin', '<span class="ph-heart">♥</span>');
      });
      fig.appendChild(img);

      if (ph.caption) {
        var cap = document.createElement('figcaption');
        cap.textContent = ph.caption;
        fig.appendChild(cap);
      }

      function open() {
        if (fig.classList.contains('is-placeholder')) return;
        openLightbox(img.currentSrc || img.src, ph.caption);
      }
      fig.addEventListener('click', open);
      fig.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
      box.appendChild(fig);
    });
  }

  /* ---------------- 灯箱 ---------------- */
  var lightbox = $('#lightbox');
  var lbImg = $('#lbImg');
  var lbCap = $('#lbCap');

  function openLightbox(src, caption) {
    if (!lightbox || !lbImg) return;
    lbImg.src = src;
    if (lbCap) lbCap.textContent = caption || '';
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
  }
  if (lightbox) {
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox || e.target.id === 'lbClose') closeLightbox();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });

  /* ---------------- 背景音乐 ---------------- */
  var bgm = $('#bgm');
  var musicBtn = $('#musicBtn');
  var fadeTimer = 0;

  function setupMusic() {
    if (!bgm || !G.music) {
      removeMusicButton();
      return;
    }
    bgm.src = G.music;
    bgm.volume = 0;
    bgm.addEventListener('error', removeMusicButton);
    if (musicBtn) {
      musicBtn.addEventListener('click', function () {
        if (bgm.paused) {
          var p = playMusic();
          musicBtn.classList.add('is-on', 'is-playing');
          musicBtn.classList.remove('is-paused');
          if (p) {
            p.catch(function () {
              musicBtn.classList.remove('is-playing');
              musicBtn.classList.add('is-paused');
            });
          }
        } else {
          bgm.pause();
          musicBtn.classList.remove('is-playing');
          musicBtn.classList.add('is-paused');
        }
      });
    }
  }
  function removeMusicButton() {
    if (musicBtn && musicBtn.parentNode) musicBtn.parentNode.removeChild(musicBtn);
  }
  function fadeTo(target) {
    if (!bgm) return;
    clearInterval(fadeTimer);
    var steps = 24;
    var i = 0;
    bgm.volume = 0;
    fadeTimer = setInterval(function () {
      i++;
      bgm.volume = Math.min(target, (target * i) / steps);
      if (i >= steps) clearInterval(fadeTimer);
    }, 90);
  }
  function playMusic() {
    if (!bgm || !G.music) return null;
    var p = bgm.play();
    fadeTo(0.55);
    return p && p.catch ? p : null;
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    document.title = (G.to ? G.to + ' · ' : '') + mainMsg;
    buildStory();
    setupMusic();

    if (IS_STORY_PAGE) {
      var story = $('#story');
      if (story) {
        story.classList.add('is-open');
        story.setAttribute('aria-hidden', 'false');
      }
      if (musicBtn) musicBtn.classList.add('is-on');
    }

    if (REDUCED) document.documentElement.classList.add('reduced-motion');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
