/* ==========================================================
 *  照片集：环绕照片墙（three.js）+ 杂志式照片集 + 翻卡片
 *  数据：assets/photos/photos.json
 * ========================================================== */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var BASE = "assets/photos/";
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DATA = null;
  var LB = { list: [], i: 0, open: false };

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function monthLabel(k) {
    var a = k.split("-");
    return a[0] + "\u2009年\u2009" + Number(a[1]) + "\u2009月";
  }
  function dotDate(d) {
    var a = d.split("-");
    return a[0] + "." + a[1] + "." + a[2];
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    fetch(BASE + "photos.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        LB.list = d.photos;
        $("#n").textContent = d.count;
        $("#range").textContent = dotDate(d.range[0]) + " — " + dotDate(d.range[1]);
        buildMagazine(d);
        buildStack(d);
        initLightbox();
        initWall(d);
        initHeroFade();
      })
      .catch(function (e) { console.error("照片数据加载失败", e); });
  }

  /* ======================================================
   *  效果②：杂志式照片集
   * ====================================================== */
  var magLastW = 0;

  function buildMagazine(d) {
    var host = $("#months");
    var W = host.clientWidth || window.innerWidth - 32;
    magLastW = W;

    var GAP = 8;
    var TARGET = W < 520 ? 1.85 : Math.min(4.2, Math.max(2.6, W / 300));

    var groups = [], map = {};
    d.photos.forEach(function (p) {
      var k = p.date.slice(0, 7);
      if (!map[k]) { map[k] = { key: k, items: [] }; groups.push(map[k]); }
      map[k].items.push(p);
    });

    var frag = document.createDocumentFragment();
    var delay = 0;

    function flush(items, sumA) {
      var n = items.length;
      var growTotal = sumA >= TARGET ? sumA : TARGET;
      var h = (W - GAP * (n - 1)) / growTotal;
      var row = document.createElement("div");
      row.className = "row";
      row.style.height = h.toFixed(1) + "px";
      items.forEach(function (p) {
        var cell = document.createElement("div");
        cell.className = "cell";
        cell.style.flexGrow = (p.w / p.h).toFixed(4);
        cell.style.animationDelay = Math.min(delay, 260) + "ms";
        delay += 22;
        cell.dataset.id = p.id;
        var img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.src = BASE + p.thumb;
        img.alt = dotDate(p.date);
        cell.appendChild(img);
        row.appendChild(cell);
      });
      if (growTotal > sumA + 0.001) {
        var sp = document.createElement("div");
        sp.className = "spacer";
        sp.style.flexGrow = (growTotal - sumA).toFixed(4);
        row.appendChild(sp);
      }
      frag.appendChild(row);
    }

    groups.forEach(function (g) {
      var head = document.createElement("div");
      head.className = "m-head";
      head.innerHTML = '<span class="y"></span><span class="n"></span>';
      head.querySelector(".y").textContent = monthLabel(g.key);
      head.querySelector(".n").textContent = g.items.length + " 张";
      frag.appendChild(head);

      var row = [], sum = 0;
      g.items.forEach(function (p) {
        row.push(p);
        sum += p.w / p.h;
        if (sum >= TARGET) { flush(row, sum); row = []; sum = 0; }
      });
      if (row.length) flush(row, sum);
    });

    host.innerHTML = "";
    host.appendChild(frag);

    host.onclick = function (e) {
      var cell = e.target.closest(".cell");
      if (!cell) return;
      openLightbox(+cell.dataset.id);
    };
  }

  /* ======================================================
   *  效果①：环绕照片墙
   * ====================================================== */
  var wall = null;

  function initWall(d) {
    if (!window.THREE || REDUCED) return;
    var canvas = $("#wall");
    var mobile = window.innerWidth < 720;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.75 : 2));
    if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(56, 1, 0.1, 100);
    camera.position.set(0, 0, 0);

    var group = new THREE.Group();
    scene.add(group);

    var ROWS = mobile ? 3 : 4;
    var RADIUS = mobile ? 6.0 : 8.4;
    var CH = mobile ? 1.78 : 1.62;
    var YS = mobile ? [-2.28, 0, 2.28] : [-2.88, -0.96, 0.96, 2.88];

    var photos = d.photos.slice();
    if (mobile) photos = photos.filter(function (_, i) { return i % 2 === 0; });

    var loader = new THREE.TextureLoader();
    var per = Math.ceil(photos.length / ROWS);

    // 打散顺序：时间相邻的照片排在一起会显得重复，用固定种子的洗牌
    var order = photos.slice();
    var seed = 20261110;
    for (var si = order.length - 1; si > 0; si--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var sj = seed % (si + 1);
      var tmp = order[si]; order[si] = order[sj]; order[sj] = tmp;
    }

    for (var r = 0; r < ROWS; r++) {
      var slice = order.slice(r * per, (r + 1) * per);
      if (!slice.length) continue;
      var step = (Math.PI * 2) / slice.length;
      for (var j = 0; j < slice.length; j++) {
        (function (p, j, r, step) {
          var asp = p.w / p.h;
          asp = Math.max(0.56, Math.min(1.9, asp));
          var w = CH * asp;
          var geo = new THREE.PlaneGeometry(w, CH);
          var mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, side: THREE.DoubleSide });
          var mesh = new THREE.Mesh(geo, mat);
          var a = j * step + r * step * 0.5 + (r % 2 ? step * 0.25 : 0);
          mesh.position.set(Math.sin(a) * RADIUS, YS[r], Math.cos(a) * RADIUS);
          mesh.rotation.y = a + Math.PI;
          mesh.userData.baseY = YS[r];
          group.add(mesh);

          loader.load(BASE + p.mini, function (tex) {
            if (tex.colorSpace !== undefined && THREE.SRGBColorSpace !== undefined) {
              tex.colorSpace = THREE.SRGBColorSpace;
            } else if (tex.encoding !== undefined && THREE.sRGBEncoding !== undefined) {
              tex.encoding = THREE.sRGBEncoding;
            }
            tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            mat.map = tex;
            mat.needsUpdate = true;
          }, undefined, function () {});
        })(slice[j], j, r, step);
      }
    }

    var targetRotY = 0, rotY = 0, targetRotX = 0, rotX = 0, vel = 0;
    var dragging = false, lastX = 0, lastY = 0, fov = 56, targetFov = 56, lastMove = 0;

    function resize() {
      var w = canvas.clientWidth || window.innerWidth;
      var h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    canvas.addEventListener("pointerdown", function (e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      vel = 0;
      lastMove = performance.now();
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      targetRotY += dx * 0.0042;
      targetRotX = Math.max(-0.34, Math.min(0.34, targetRotX + dy * 0.0016));
      vel = dx * 0.0042;
      lastMove = performance.now();
    });
    function endDrag() { dragging = false; }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", endDrag);

    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      targetFov = Math.max(42, Math.min(72, targetFov + e.deltaY * 0.024));
    }, { passive: false });

    var visible = true;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
      }, { threshold: 0.02 }).observe(canvas);
    }

    var t0 = performance.now();
    function frame(t) {
      requestAnimationFrame(frame);
      if (!visible) return;

      if (!dragging) {
        targetRotY += vel;
        vel *= 0.94;
        if (Math.abs(vel) < 0.00012 && !REDUCED) targetRotY += 0.00042;
      }
      rotY += (targetRotY - rotY) * 0.09;
      rotX += (targetRotX - rotX) * 0.09;
      group.rotation.y = rotY;
      group.rotation.x = rotX;

      fov += (targetFov - fov) * 0.1;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    }

    resize();
    wall = { resize: resize };
    requestAnimationFrame(frame);

    var rt = null;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        resize();
        var nowMobile = window.innerWidth < 720;
        if (nowMobile !== mobile) location.reload();
      }, 220);
    });
  }

  /* ---------------- 首屏文字随滚动淡出 ---------------- */
  function initHeroFade() {
    var inner = $(".hero-inner");
    var hint = $(".hint");
    if (!inner) return;
    var ticking = false;
    function apply() {
      var y = window.scrollY || 0;
      var h = window.innerHeight || 1;
      var k = Math.min(1, y / (h * 0.55));
      inner.style.opacity = (1 - k).toFixed(3);
      inner.style.transform = "translate3d(0," + (-k * 34).toFixed(1) + "px,0)";
      if (hint) hint.style.opacity = (1 - k * 1.4 > 0 ? 1 - k * 1.4 : 0).toFixed(3);
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
    apply();
  }

  /* ======================================================
   *  效果③：翻卡片
   * ====================================================== */
  function buildStack(d) {
    var stage = $("#stage");
    var photos = d.photos;
    var n = photos.length;
    var cur = 0, cards = [];

    photos.forEach(function (p, i) {
      var c = document.createElement("article");
      c.className = "card";
      var img = document.createElement("img");
      img.alt = dotDate(p.date);
      img.decoding = "async";
      var cap = document.createElement("span");
      cap.className = "cap";
      cap.textContent = dotDate(p.date);
      c.appendChild(img);
      c.appendChild(cap);
      c.dataset.i = i;
      stage.appendChild(c);
      cards.push(c);
    });

    function ensureSrc(i) {
      for (var k = i - 1; k <= i + 2; k++) {
        if (k < 0 || k >= n) continue;
        var img = cards[k].querySelector("img");
        if (!img.getAttribute("src")) img.src = BASE + photos[k].thumb;
      }
    }

    var flying = -1;

    function transformFor(o) {
      if (o === 0) return { t: "translate3d(0,0,0) rotate(0deg) scale(1)", o: 1 };
      if (o === 1) return { t: "translate3d(15px,13px,-65px) rotate(2.2deg) scale(0.99)", o: 0.9 };
      if (o === 2) return { t: "translate3d(-13px,25px,-138px) rotate(-2deg) scale(0.975)", o: 0.62 };
      if (o === 3) return { t: "translate3d(21px,36px,-205px) rotate(1.4deg) scale(0.96)", o: 0.3 };
      return { t: "translate3d(0,0,-260px) scale(0.94)", o: 0 };
    }

    function place() {
      ensureSrc(cur);
      cards.forEach(function (c, i) {
        if (i === flying) return;
        var o = i - cur;
        if (o < -1 || o > 4) {
          c.style.transition = "none";
          c.style.opacity = 0;
          c.style.transform = "translate3d(0,40px,-320px) scale(0.9)";
          c.style.zIndex = 1;
          return;
        }
        if (o < 0) {
          c.style.transition = "none";
          c.style.opacity = 0;
          c.style.transform = "translate3d(-130%,-6%,-120px) rotate(-16deg)";
          c.style.zIndex = 60;
          return;
        }
        c.style.transition = "";
        var f = transformFor(o);
        c.style.transform = f.t;
        c.style.opacity = f.o;
        c.style.zIndex = String(40 - o);
      });
      updateBar();
    }

    function updateBar() {
      $("#fill").style.width = ((cur + 1) / n * 100).toFixed(2) + "%";
      $("#count").textContent = (cur + 1) + " / " + n + "　" + dotDate(photos[cur].date);
    }

    function go(next) {
      if (next < 0 || next >= n) {
        place();
        return;
      }
      var old = cur;
      var dir = next > old ? -1 : 1;
      var now = cards[old];
      flying = old;
      cur = next;
      now.style.transition = "transform .46s cubic-bezier(.3,.7,.3,1), opacity .4s ease";
      now.style.transform = "translate3d(" + (dir * 126) + "%," + (dir * 3) + "%," + (-70) + "px) rotate(" + (dir * 15) + "deg)";
      now.style.opacity = 0;
      now.style.zIndex = 60;
      place();
      setTimeout(function () { if (flying === old) flying = -1; }, 480);
    }

    var down = false, sx = 0, dx = 0, moved = false;
    stage.addEventListener("pointerdown", function (e) {
      down = true; sx = e.clientX; dx = 0; moved = false;
      if (stage.setPointerCapture) stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", function (e) {
      if (!down) return;
      dx = e.clientX - sx;
      if (Math.abs(dx) > 4) moved = true;
      var c = cards[cur];
      c.style.transition = "";
      c.style.transform = "translate3d(" + dx + "px," + (dx * 0.05).toFixed(1) + "px,0) rotate(" + (dx * 0.028).toFixed(2) + "deg)";
    });
    function up() {
      if (!down) return;
      down = false;
      if (Math.abs(dx) > 68) {
        go(dx < 0 ? cur + 1 : cur - 1);
      } else {
        place(false);
        if (!moved) openLightbox(photos[cur].id);
      }
    }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("pointerleave", function () { if (down) { down = false; place(false); } });

    document.addEventListener("keydown", function (e) {
      if (LB.open) return;
      if (e.key === "ArrowRight") go(cur + 1);
      if (e.key === "ArrowLeft") go(cur - 1);
    });

    place(false);
  }

  /* ======================================================
   *  灯箱
   * ====================================================== */
  function initLightbox() {
    var box = $("#lb");
    var img = box.querySelector("img");
    var meta = box.querySelector(".lb-meta");
    var closeBtn = box.querySelector(".lb-close");
    var prev = box.querySelector(".prev");
    var next = box.querySelector(".next");

    function show(i) {
      var list = LB.list;
      if (i < 0) i = list.length - 1;
      if (i >= list.length) i = 0;
      LB.i = i;
      var p = list[i];
      img.classList.remove("ready");
      img.src = BASE + p.full;
      img.onload = function () { img.classList.add("ready"); };
      meta.textContent = dotDate(p.date) + "　" + (i + 1) + " / " + list.length;
    }

    window.openLightbox = function (id) {
      var i = 0;
      for (var k = 0; k < LB.list.length; k++) { if (LB.list[k].id === id) { i = k; break; } }
      LB.open = true;
      box.classList.add("on");
      document.body.style.overflow = "hidden";
      show(i);
    };
    // 供内部使用
    LB.openAt = window.openLightbox;

    function close() {
      LB.open = false;
      box.classList.remove("on");
      document.body.style.overflow = "";
    }

    closeBtn.addEventListener("click", close);
    prev.addEventListener("click", function (e) { e.stopPropagation(); show(LB.i - 1); });
    next.addEventListener("click", function (e) { e.stopPropagation(); show(LB.i + 1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });

    document.addEventListener("keydown", function (e) {
      if (!LB.open) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") show(LB.i + 1);
      if (e.key === "ArrowLeft") show(LB.i - 1);
    });

    var sx = 0, active = false;
    box.addEventListener("pointerdown", function (e) { active = true; sx = e.clientX; });
    box.addEventListener("pointerup", function (e) {
      if (!active) return;
      active = false;
      var d = e.clientX - sx;
      if (Math.abs(d) > 60) show(LB.i + (d < 0 ? 1 : -1));
    });
  }

  /* 翻卡片点击也能开灯箱 */
  function openLightbox(id) {
    if (LB.openAt) LB.openAt(id);
  }

  /* 断点变化时重建杂志流 */
  var rz = null;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(function () {
      var host = $("#months");
      if (!host || !DATA) return;
      if (Math.abs(host.clientWidth - magLastW) > 24) buildMagazine(DATA);
    }, 260);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
