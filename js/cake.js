/* ============================================================
 * 蛋糕 v2 —— 演示「炫酷」这件事能到哪一步
 * 关键手法：
 *   1. 自己写一条 postprocess 链（亮部提取 + 两次高斯模糊 + 合成）
 *      让火焰/星星真正「发光溢出」，而不是贴一张发光贴图
 *   2. ACES 胶片映射 + 暗角 + 轻微色偏，压出电影感
 *   3. 开场 2.6s 推镜（easeOutCubic），之后缓慢自转
 *   4. 吹灭：火焰塌陷 → 烛烟上升 → 三波烟花 + 字幕浮起
 *   5. 麦克风吹蜡烛（可选）：getUserMedia 音量过阈值即触发
 * ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var mobile = window.innerWidth < 720;
  var hint = document.getElementById('hint');
  var btnBlow = document.getElementById('btnBlow');
  var btnMic = document.getElementById('btnMic');
  var micState = document.getElementById('micState');

  /* ---------- 基础 ---------- */
  var renderer, scene, camera;
  var clock = new THREE.Clock();
  var cakeGroup, plaque;
  var flames = [], candleLights = [], smokes = [], sparks = null;
  var blowAt = -1, blown = false, finaleShown = false;

  if (!window.WebGLRenderingContext) { document.body.innerHTML = '<p style="padding:40px">这个浏览器跑不了 WebGL</p>'; return; }

  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    document.body.innerHTML = '<p style="padding:40px">WebGL 初始化失败：' + e.message + '</p>';
    return;
  }
  var DPR = Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.25);
  renderer.setPixelRatio(DPR);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x120610, 28, 60);

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);

  /* ---------- 背景：内翻穹顶 + 地平线暖光 ---------- */
  (function buildSky() {
    var geo = new THREE.SphereGeometry(70, 32, 20);
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: [
        'varying vec3 vP;',
        'void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vP;',
        'uniform float uTime;',
        'void main(){',
        '  float h = normalize(vP).y;',
        '  vec3 top = vec3(0.035, 0.012, 0.028);',
        '  vec3 mid = vec3(0.115, 0.030, 0.062);',
        '  vec3 low = vec3(0.055, 0.014, 0.026);',
        '  vec3 c = mix(low, mid, smoothstep(-0.55, 0.02, h));',
        '  c = mix(c, top, smoothstep(0.02, 0.85, h));',
        '  float glow = exp(-pow((h - 0.02) * 5.2, 2.0));',
        '  c += vec3(0.30, 0.10, 0.15) * glow * 0.55;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'
      ].join('\n')
    });
    sky = new THREE.Mesh(geo, mat);
    scene.add(sky);
  })();
  var sky;

  /* ---------- 环境贴图（程序化，无外部文件） ---------- */
  (function buildEnv() {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.00, '#1a0812');
    g.addColorStop(0.36, '#6d2438');
    g.addColorStop(0.50, '#ffc9a4');
    g.addColorStop(0.62, '#5a1c2c');
    g.addColorStop(1.00, '#080205');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    for (var i = 0; i < 7; i++) {
      var cx = Math.random() * 512, cy = 40 + Math.random() * 150, r = 26 + Math.random() * 60;
      var rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, 'rgba(255,214,170,0.55)');
      rg.addColorStop(1, 'rgba(255,214,170,0)');
      x.fillStyle = rg; x.beginPath(); x.arc(cx, cy, r, 0, 6.3); x.fill();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    var pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
  })();

  /* ---------- 光照 ---------- */
  scene.add(new THREE.HemisphereLight(0x552233, 0x080305, 0.55));

  var key = new THREE.DirectionalLight(0xffd9c2, 1.35);
  key.position.set(5.2, 8.5, 7.4);
  scene.add(key);

  var fill = new THREE.DirectionalLight(0x7a4cff, 0.55);
  fill.position.set(-7, 4.2, -3.4);
  scene.add(fill);

  var rim = new THREE.DirectionalLight(0xff5f9e, 2.0);
  rim.position.set(-3.5, 3.2, -8.5);
  scene.add(rim);

  var under = new THREE.PointLight(0xff6b9a, 1.4, 16, 2);
  under.position.set(0, 0.35, 3.4);
  scene.add(under);

  /* ---------- 程序化噪声贴图（粗糙度 / 凹凸） ---------- */
  function noiseTex(size, strength) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var x = c.getContext('2d');
    var img = x.createImageData(size, size);
    for (var i = 0; i < size * size; i++) {
      var v = 128 + (Math.random() - 0.5) * 255 * strength;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }
  var roughTex = noiseTex(256, 0.55);
  var bumpTex = noiseTex(256, 0.35);

  /* ---------- 圆角蛋糕层（Lathe） ---------- */
  function tierGeometry(r, h, rr) {
    var pts = [], i, a, N = 7;
    pts.push(new THREE.Vector2(0.0, 0.0));
    pts.push(new THREE.Vector2(r - rr, 0.0));
    for (i = 0; i <= N; i++) {
      a = -Math.PI / 2 + (Math.PI / 2) * (i / N);
      pts.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, rr + Math.sin(a) * rr));
    }
    for (i = 0; i <= N; i++) {
      a = (Math.PI / 2) * (i / N);
      pts.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, h - rr + Math.sin(a) * rr));
    }
    pts.push(new THREE.Vector2(0.0, h));
    var g = new THREE.LatheGeometry(pts, 96);
    g.computeVertexNormals();
    return g;
  }

  var ICING = [
    { color: 0xf0dfcc, r: 3.05, h: 1.42 },
    { color: 0xf0b9c9, r: 2.34, h: 1.16 },
    { color: 0xf2e2cf, r: 1.62, h: 0.98 }
  ];

  cakeGroup = new THREE.Group();
  cakeGroup.position.y = 0.06;
  scene.add(cakeGroup);

  var tierMats = [];
  var yBase = 0;
  ICING.forEach(function (t, idx) {
    var mat = new THREE.MeshPhysicalMaterial({
      color: t.color,
      roughness: 0.62,
      metalness: 0.0,
      clearcoat: 0.42,
      clearcoatRoughness: 0.55,
      roughnessMap: roughTex,
      bumpMap: bumpTex,
      bumpScale: 0.012,
      envMapIntensity: 0.75
    });
    tierMats.push(mat);
    var mesh = new THREE.Mesh(tierGeometry(t.r, t.h, 0.15), mat);
    mesh.position.y = yBase;
    cakeGroup.add(mesh);

    /* 顶端奶油边：一圈略外扩的扁圆环 */
    var rimGeo = new THREE.TorusGeometry(t.r - 0.02, 0.11, 12, 96);
    var rim = new THREE.Mesh(rimGeo, new THREE.MeshPhysicalMaterial({
      color: 0xfffaf2, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.4, envMapIntensity: 0.9
    }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = yBase + t.h - 0.06;
    cakeGroup.add(rim);

    /* 奶油滴落：沿上边缘一圈小球 */
    var dripMat = new THREE.MeshPhysicalMaterial({
      color: 0xfffaf3, roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.4, envMapIntensity: 0.95
    });
    var nDrip = mobile ? 22 : 34;
    for (var d = 0; d < nDrip; d++) {
      var ang = (d / nDrip) * Math.PI * 2 + Math.random() * 0.09;
      var rr = 0.07 + Math.random() * 0.06;
      var len = 0.10 + Math.random() * 0.34;
      var sp = new THREE.Mesh(new THREE.SphereGeometry(rr, 10, 8), dripMat);
      sp.position.set(Math.cos(ang) * (t.r - 0.045), yBase + t.h - 0.10 - len * 0.5, Math.sin(ang) * (t.r - 0.045));
      sp.scale.set(1, 1 + len * 2.4, 1);
      cakeGroup.add(sp);
    }

    /* 糖针 */
    var sprColors = [0xff6b9a, 0xffd166, 0x8ad4ff, 0xa8f0c0, 0xd8b4ff, 0xffffff];
    var nSpr = mobile ? 26 : 56;
    for (var s = 0; s < nSpr; s++) {
      var rad = Math.random() * (t.r - 0.4);
      var th = Math.random() * Math.PI * 2;
      var box = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.028, 0.028),
        new THREE.MeshStandardMaterial({ color: sprColors[s % sprColors.length], roughness: 0.42, metalness: 0.05 })
      );
      box.position.set(Math.cos(th) * rad, yBase + t.h + 0.012, Math.sin(th) * rad);
      box.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      cakeGroup.add(box);
    }

    yBase += t.h + 0.02;
  });

  /* ---------- 托盘 ---------- */
  (function buildPlate() {
    var g = new THREE.Group();
    var disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.62, 3.34, 0.17, 96),
      new THREE.MeshStandardMaterial({ color: 0xd8a06a, roughness: 0.22, metalness: 0.95, envMapIntensity: 1.4 })
    );
    disc.position.y = -0.09;
    g.add(disc);
    var rimT = new THREE.Mesh(
      new THREE.TorusGeometry(3.58, 0.055, 16, 120),
      new THREE.MeshStandardMaterial({ color: 0xffd6a0, roughness: 0.16, metalness: 1.0, envMapIntensity: 1.6 })
    );
    rimT.rotation.x = Math.PI / 2;
    rimT.position.y = -0.005;
    g.add(rimT);
    cakeGroup.add(g);
  })();

  /* ---------- 铭牌 ---------- */
  (function buildPlaque() {
    var c = document.createElement('canvas');
    c.width = 640; c.height = 200;
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 200);
    g.addColorStop(0, '#3a1220'); g.addColorStop(0.5, '#5c1c2e'); g.addColorStop(1, '#2a0c16');
    x.fillStyle = g; x.fillRect(0, 0, 640, 200);
    x.strokeStyle = 'rgba(255,214,160,0.85)'; x.lineWidth = 6;
    x.strokeRect(10, 10, 620, 180);
    x.fillStyle = 'rgba(255,240,225,0.55)';
    x.font = '22px "Segoe UI", sans-serif';
    x.textAlign = 'center';
    x.fillText('O N E   Y E A R   W I T H   Y O U', 320, 62);
    x.fillStyle = '#fff6ec';
    x.font = '76px KaiTi, STKaiti, serif';
    x.fillText('一周年快乐', 320, 148);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;

    var mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.35, metalness: 0.25, envMapIntensity: 1.1,
      emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.12
    });
    var geo = new THREE.PlaneGeometry(1.62, 0.5);
    plaque = new THREE.Mesh(geo, mat);
    plaque.position.set(0, 0.72, 3.06);
    cakeGroup.add(plaque);
  })();

  /* ---------- 蜡烛 + 火焰 ---------- */
  function flameTexture(soft) {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 74, 0, 64, 74, 62);
    if (soft) {
      g.addColorStop(0.0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,236,190,0.95)');
      g.addColorStop(0.55, 'rgba(255,168,80,0.45)');
      g.addColorStop(1.0, 'rgba(255,120,40,0)');
    } else {
      g.addColorStop(0.0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,250,235,0.9)');
      g.addColorStop(0.7, 'rgba(255,214,150,0.25)');
      g.addColorStop(1.0, 'rgba(255,190,120,0)');
    }
    x.fillStyle = g;
    x.beginPath(); x.arc(64, 74, 62, 0, 6.3); x.fill();
    /* 拉一点向上的尖 */
    var g2 = x.createLinearGradient(0, 0, 0, 60);
    g2.addColorStop(0, 'rgba(255,150,60,0)');
    g2.addColorStop(1, 'rgba(255,225,170,0.85)');
    x.fillStyle = g2;
    x.beginPath(); x.ellipse(64, 34, 26, 40, 0, 0, 6.3); x.fill();
    return new THREE.CanvasTexture(c);
  }
  var flameTex = flameTexture(false);
  var coreTex = flameTexture(true);

  var candleAngles = [-0.62, 0, 0.62];
  candleAngles.forEach(function (a, i) {
    var cg = new THREE.Group();
    var x0 = Math.sin(a) * 0.52, z0 = Math.cos(a) * 0.52;
    cg.position.set(x0, ICING[0].h + ICING[1].h + ICING[2].h + 0.06, z0);

    var wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.066, 0.78, 20),
      new THREE.MeshPhysicalMaterial({ color: 0xfff0d8, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.45, envMapIntensity: 0.9 })
    );
    wax.position.y = 0.39;
    cg.add(wax);

    var wick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.10, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.9 })
    );
    wick.position.y = 0.82;
    cg.add(wick);

    var flameMat = new THREE.SpriteMaterial({
      map: flameTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, color: new THREE.Color(2.9, 2.0, 1.05)
    });
    var flame = new THREE.Sprite(flameMat);
    flame.scale.set(0.44, 0.78, 1);
    flame.position.y = 0.96;
    cg.add(flame);

    var coreMat = new THREE.SpriteMaterial({
      map: coreTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, color: new THREE.Color(3.2, 2.6, 1.8)
    });
    var core = new THREE.Sprite(coreMat);
    core.scale.set(0.19, 0.34, 1);
    core.position.y = 0.9;
    cg.add(core);

    var light = new THREE.PointLight(0xffb066, 2.2, 7.5, 2);
    light.position.set(0, 0.98, 0.05);
    cg.add(light);

    cakeGroup.add(cg);
    flames.push({ flame: flame, core: core, light: light, seed: i * 2.1, baseY: 0.96 });
  });

  /* 烛烟贴图 */
  var smokeTex = (function () {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, 'rgba(230,220,225,0.5)');
    g.addColorStop(0.5, 'rgba(200,190,200,0.16)');
    g.addColorStop(1, 'rgba(180,170,180,0)');
    x.fillStyle = g; x.beginPath(); x.arc(64, 64, 62, 0, 6.3); x.fill();
    return new THREE.CanvasTexture(c);
  })();

  /* ---------- 空中尘埃 / 星点 ---------- */
  (function buildDust() {
    var N = mobile ? 90 : 170;
    var pos = new Float32Array(N * 3), col = new Float32Array(N * 3), siz = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var r = 6 + Math.random() * 16, th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
      pos[i * 3 + 1] = Math.abs(Math.cos(ph)) * 8 - 1;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
      var w = 0.6 + Math.random() * 0.8;
      col[i * 3] = 2.2 * w; col[i * 3 + 1] = 1.5 * w; col[i * 3 + 2] = 1.7 * w;
      siz[i] = 0.05 + Math.random() * 0.16;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(siz, 1));
    var m = new THREE.PointsMaterial({
      size: 0.14, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var pts = new THREE.Points(g, m);
    scene.add(pts);
    scene.userData.dust = pts;
  })();

  /* ============================================================
   *  自写后处理：亮部提取 → 两次高斯模糊 → 叠加合成
   * ============================================================ */
  var rtScene, rtBright, rtBlurA, rtBlurB;
  var quadScene = new THREE.Scene();
  var quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  var matBright, matBlur, matComp;
  var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quadScene.add(quad);

  var VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  matBright = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, threshold: { value: 1.05 } },
    vertexShader: VS,
    fragmentShader: [
      'varying vec2 vUv;',
      'uniform sampler2D tDiffuse;',
      'uniform float threshold;',
      'void main(){',
      '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
      '  float l = max(c.r, max(c.g, c.b));',
      '  float k = max(0.0, l - threshold);',
      '  gl_FragColor = vec4(c * (k / max(l, 0.0001)), 1.0);',
      '}'
    ].join('\n')
  });

  matBlur = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) } },
    vertexShader: VS,
    fragmentShader: [
      'varying vec2 vUv;',
      'uniform sampler2D tDiffuse;',
      'uniform vec2 dir;',
      'void main(){',
      '  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;',
      '  s += texture2D(tDiffuse, vUv + dir * 1.3846).rgb * 0.3162162;',
      '  s += texture2D(tDiffuse, vUv - dir * 1.3846).rgb * 0.3162162;',
      '  s += texture2D(tDiffuse, vUv + dir * 3.2308).rgb * 0.0702703;',
      '  s += texture2D(tDiffuse, vUv - dir * 3.2308).rgb * 0.0702703;',
      '  gl_FragColor = vec4(s, 1.0);',
      '}'
    ].join('\n')
  });

  matComp = new THREE.ShaderMaterial({
    uniforms: {
      tBase: { value: null }, tBloom: { value: null },
      strength: { value: mobile ? 0.8 : 0.95 }
    },
    vertexShader: VS,
    fragmentShader: [
      'varying vec2 vUv;',
      'uniform sampler2D tBase;',
      'uniform sampler2D tBloom;',
      'uniform float strength;',
      'void main(){',
      '  vec3 base = texture2D(tBase, vUv).rgb;',
      '  vec3 bloom = texture2D(tBloom, vUv).rgb;',
      '  vec3 col = base + bloom * strength;',
      '  vec2 p = vUv - 0.5;',
      '  float vig = smoothstep(0.92, 0.26, length(p));',
      '  col *= mix(0.55, 1.0, vig);',
      '  col = pow(max(col, 0.0), vec3(0.97, 0.99, 1.04));',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });

  function makeRT(w, h, hdr) {
    return new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: !!hdr,
      stencilBuffer: false
    });
  }

  var W = 1, H = 1;
  function buildTargets() {
    var bw = Math.round(W * DPR), bh = Math.round(H * DPR);
    rtScene = makeRT(bw, bh, true);
    rtBright = makeRT(bw / 5, bh / 5, true);
    rtBlurA = makeRT(bw / 5, bh / 5, true);
    rtBlurB = makeRT(bw / 5, bh / 5, true);
  }

  function fullscreenPass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(quadScene, quadCam);
  }

  function renderWithBloom() {
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    matBright.uniforms.tDiffuse.value = rtScene.texture;
    fullscreenPass(matBright, rtBright);

    matBlur.uniforms.tDiffuse.value = rtBright.texture;
    matBlur.uniforms.dir.value.set(1.0 / (rtBright.width), 0);
    fullscreenPass(matBlur, rtBlurA);

    matBlur.uniforms.tDiffuse.value = rtBlurA.texture;
    matBlur.uniforms.dir.value.set(0, 1.0 / (rtBright.height));
    fullscreenPass(matBlur, rtBlurB);


    matComp.uniforms.tBase.value = rtScene.texture;
    matComp.uniforms.tBloom.value = rtBlurB.texture;
    fullscreenPass(matComp, null);
  }

  /* ============================================================
   *  相机：开场推镜 + 拖动 + 呼吸
   * ============================================================ */
  var camYaw = 0, camTargetYaw = 0, camPitch = 0, camTargetPitch = 0;
  var drag = false, lastX = 0, lastY = 0;
  var INTRO_MS = 2600, introT = 0;
  var camFrom = new THREE.Vector3(0, 6.4, 21.5);
  var camTo = new THREE.Vector3(0, 2.9, 14.2);
  /* 竖屏水平视角只有约 26°，镜头要拉远，否则蛋糕会顶满左右 */
  var PORTRAIT = window.innerWidth / window.innerHeight < 0.8;
  if (PORTRAIT) { camFrom.set(0, 8.2, 27.5); camTo.set(0, 3.6, 18.8); }
  var lookAt = new THREE.Vector3(0, 1.95, 0);

  canvas.addEventListener('pointerdown', function (e) {
    drag = true; lastX = e.clientX; lastY = e.clientY;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    camTargetYaw += (e.clientX - lastX) * 0.0055;
    camTargetPitch = Math.max(-0.16, Math.min(0.3, camTargetPitch + (e.clientY - lastY) * 0.0022));
    lastX = e.clientX; lastY = e.clientY;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    canvas.addEventListener(ev, function () { drag = false; });
  });

  /* 点蜡烛也能吹 */
  var flashes = [];
  var raycaster = new THREE.Raycaster();
  canvas.addEventListener('click', function (e) {
    if (drag) return;
    var r = canvas.getBoundingClientRect();
    var m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(m, camera);
    var hits = raycaster.intersectObjects(flames.map(function (f) { return f.flame; }), false);
    if (hits.length) doBlow();
  });

  /* ============================================================
   *  吹灭 → 烛烟 → 烟花 → 字幕
   * ============================================================ */
  function doBlow() {
    if (blown) return;
    blown = true;
    blowAt = performance.now() / 1000;
    btnBlow.disabled = true;
    btnMic.disabled = true;
    document.body.classList.add('blown');
    if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });

    /* 三支蜡烛的烟 */
    flames.forEach(function (f, i) {
      for (var k = 0; k < 7; k++) {
        var s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: smokeTex, transparent: true, opacity: 0.0, depthWrite: false,
          color: new THREE.Color(0.85, 0.82, 0.86)
        }));
        s.position.copy(f.flame.getWorldPosition(new THREE.Vector3()));
        s.position.x += (Math.random() - 0.5) * 0.06;
        s.position.z += (Math.random() - 0.5) * 0.06;
        s.scale.setScalar(0.16 + Math.random() * 0.12);
        s.userData = {
          t0: performance.now() / 1000 + i * 0.06 + k * 0.16,
          vy: 0.35 + Math.random() * 0.5,
          drift: (Math.random() - 0.5) * 0.35,
          rot: Math.random() * 6.28,
          life: 3.2 + Math.random() * 1.6
        };
        scene.add(s);
        smokes.push(s);
      }
    });

    /* 两波烟花，延迟 0.5s / 1.15s */
    setTimeout(function () { burst(new THREE.Vector3(0, 5.8, 2.4), 230, 0xff6b9a); }, 480);
    setTimeout(function () { burst(new THREE.Vector3(-3.6, 6.6, 1.2), 200, 0xffd166); }, 1150);
    setTimeout(function () { burst(new THREE.Vector3(3.6, 6.2, 1.2), 170, 0x8ad4ff); }, 1750);
  }

  function burst(center, count, colorHex) {
    var n = mobile ? Math.round(count * 0.6) : count;
    var pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 3);
    var base = new THREE.Color(colorHex);
    for (var i = 0; i < n; i++) {
      pos[i * 3] = center.x; pos[i * 3 + 1] = center.y; pos[i * 3 + 2] = center.z;
      var th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1);
      var sp = 3.2 + Math.random() * 6.4;
      vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      vel[i * 3 + 1] = Math.cos(ph) * sp * 0.85 + 1.2;
      vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      var c = base.clone().offsetHSL((Math.random() - 0.5) * 0.09, 0, (Math.random() - 0.5) * 0.2);
      col[i * 3] = c.r * 3.2; col[i * 3 + 1] = c.g * 3.2; col[i * 3 + 2] = c.b * 3.2;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var m = new THREE.PointsMaterial({
      size: 0.24, sizeAttenuation: true, vertexColors: true, map: dotTex, alphaTest: 0.02,
      transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var pts = new THREE.Points(g, m);
    pts.userData.t = 0;
    scene.add(pts);
    sparks = sparks || [];
    sparks.push({ pts: pts, vel: vel, life: 2.8 });
  }

  /* ============================================================
   *  麦克风吹蜡烛
   * ============================================================ */
  var micStream = null, micCtx = null, micAnalyser = null, micBuf = null, micOn = false;
  function startMic() {
    if (micOn) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micState.textContent = '浏览器不支持';
      return;
    }
    micState.textContent = '请求麦克风…';
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then(function (stream) {
        micStream = stream;
        micCtx = new (window.AudioContext || window.webkitAudioContext)();
        var src = micCtx.createMediaStreamSource(stream);
        micAnalyser = micCtx.createAnalyser();
        micAnalyser.fftSize = 512;
        src.connect(micAnalyser);
        micBuf = new Uint8Array(micAnalyser.frequencyBinCount);
        micOn = true;
        btnMic.textContent = '对着手机吹';
        btnMic.classList.add('hot');
        micState.textContent = '听得到，使劲吹';
      })
      .catch(function () {
        micState.textContent = '麦克风被拒绝';
        micOn = false;
      });
  }
  function micLevel() {
    if (!micOn) return 0;
    micAnalyser.getByteFrequencyData(micBuf);
    var sum = 0, n = Math.min(micBuf.length, 120);
    for (var i = 0; i < n; i++) sum += micBuf[i];
    return sum / n / 255;
  }

  btnBlow.addEventListener('click', doBlow);
  btnMic.addEventListener('click', startMic);

  /* ============================================================
   *  氛围层：背景光斑 + 蛋糕周围闪烁星点（加法混合，吃泛光）
   * ============================================================ */
  var ambience = null, glowTex = null, dotTex = null;

  function buildAmbience() {
    var bokehTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 128;
      var x = c.getContext('2d');
      var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,238,220,1)');
      g.addColorStop(0.32, 'rgba(255,186,156,0.6)');
      g.addColorStop(1, 'rgba(255,140,130,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();

    var starTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 128;
      var x = c.getContext('2d');
      x.translate(64, 64);
      var g = x.createRadialGradient(0, 0, 0, 0, 0, 58);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,232,214,0.55)');
      g.addColorStop(1, 'rgba(255,200,190,0)');
      x.fillStyle = g; x.fillRect(-64, -64, 128, 128);
      x.globalCompositeOperation = 'lighter';
      for (var k = 0; k < 4; k++) {
        x.save(); x.rotate(Math.PI / 2 * k);
        var lg = x.createLinearGradient(0, 0, 0, -56);
        lg.addColorStop(0, 'rgba(255,255,255,0.95)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = lg;
        x.beginPath(); x.moveTo(-1.7, 0); x.lineTo(1.7, 0); x.lineTo(0, -56); x.closePath(); x.fill();
        x.restore();
      }
      return new THREE.CanvasTexture(c);
    })();

    glowTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 128;
      var x = c.getContext('2d');
      var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.28, 'rgba(255,214,190,0.62)');
      g.addColorStop(1, 'rgba(255,160,150,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();

    /* 烟花粒子的圆点贴图（默认方点太像像素块） */
    dotTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 64;
      var x = c.getContext('2d');
      var g2 = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g2.addColorStop(0, 'rgba(255,255,255,1)');
      g2.addColorStop(0.45, 'rgba(255,255,255,0.72)');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g2; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();

    var bokeh = [], stars = [], i, s;
    for (i = 0; i < (mobile ? 26 : 46); i++) {
      var mat = new THREE.SpriteMaterial({
        map: bokehTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        opacity: 0.14 + Math.random() * 0.24,
        color: new THREE.Color().setHSL(0.04 + Math.random() * 0.06, 0.72, 0.7)
      });
      s = new THREE.Sprite(mat);
      var ang = Math.random() * Math.PI * 2, rad = 6 + Math.random() * 9;
      s.position.set(Math.cos(ang) * rad, -1.5 + Math.random() * 10, Math.sin(ang) * rad - 2);
      var sc = 0.7 + Math.random() * 1.9;
      s.scale.set(sc, sc, 1);
      s.userData = { speed: 0.12 + Math.random() * 0.3, phase: Math.random() * 6.28, base: mat.opacity };
      scene.add(s); bokeh.push(s);
    }
    for (i = 0; i < (mobile ? 18 : 30); i++) {
      var mat2 = new THREE.SpriteMaterial({
        map: starTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        opacity: 0, color: new THREE.Color(1, 0.95, 0.9)
      });
      s = new THREE.Sprite(mat2);
      var a2 = Math.random() * Math.PI * 2, r2 = 3.4 + Math.random() * 4.2;
      s.position.set(Math.cos(a2) * r2, 0.4 + Math.random() * 4.6, Math.sin(a2) * r2 - 0.6);
      var sc2 = 0.18 + Math.random() * 0.32;
      s.scale.set(sc2, sc2, 1);
      s.userData = { phase: Math.random() * 6.28, speed: 0.7 + Math.random() * 1.5, base: sc2 };
      scene.add(s); stars.push(s);
    }
    ambience = { bokeh: bokeh, stars: stars };
  }

  function updateAmbience(t, dt) {
    if (!ambience) return;
    var i;
    for (i = 0; i < ambience.bokeh.length; i++) {
      var b = ambience.bokeh[i];
      b.position.y += b.userData.speed * dt;
      if (b.position.y > 9.6) b.position.y = -1.8;
      b.material.opacity = b.userData.base * (0.62 + 0.38 * Math.sin(t * 0.8 + b.userData.phase));
    }
    for (i = 0; i < ambience.stars.length; i++) {
      var st = ambience.stars[i];
      var tw = Math.max(0, Math.sin(t * st.userData.speed + st.userData.phase));
      st.material.opacity = Math.pow(tw, 2.2) * 0.95;
      var k = st.userData.base * (0.72 + 0.6 * tw);
      st.scale.set(k, k, 1);
    }
  }

  /* ============================================================
   *  尺寸
   * ============================================================ */
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < 0.8 ? 46 : 38;
    camera.updateProjectionMatrix();
    buildTargets();
  }
  window.addEventListener('resize', function () {
    clearTimeout(window.__rt);
    window.__rt = setTimeout(resize, 180);
  });

  /* ============================================================
   *  主循环
   * ============================================================ */
  var t0 = performance.now();
  var skyMat;

  function frame() {
    requestAnimationFrame(frame);
    var t = performance.now() / 1000;
    var dt = Math.min(0.05, clock.getDelta());

    /* 开场推镜 */
    if (introT < 1) {
      introT = Math.min(1, (performance.now() - t0) / INTRO_MS);
      var e = 1 - Math.pow(1 - introT, 3);
      camera.position.lerpVectors(camFrom, camTo, e);
    } else {
      if (!drag) camTargetYaw += dt * 0.055;
    }
    camYaw += (camTargetYaw - camYaw) * 0.06;
    camPitch += (camTargetPitch - camPitch) * 0.08;

    if (introT >= 1) {
      var r = PORTRAIT ? 18.8 : 14.2;
      camera.position.x = Math.sin(camYaw) * r;
      camera.position.z = Math.cos(camYaw) * r;
      camera.position.y = 2.9 + camPitch * 7.5;
    }
    camera.lookAt(lookAt);

    /* 火焰闪烁 + 吹灭塌陷 */
    var since = blowAt > 0 ? (t - blowAt) : -1;
    flames.forEach(function (f, i) {
      var fl = 0.82 + Math.sin(t * 9 + f.seed) * 0.09 + Math.sin(t * 21 + f.seed * 3) * 0.05;
      var kill = since >= 0 ? Math.max(0, 1 - since / 0.55) : 1;
      /* 吹的时候先歪一下再灭 */
      var tilt = since >= 0 ? Math.max(0, 1 - since / 0.5) * 0.5 : 0;
      f.flame.scale.set(0.44 * fl * kill + tilt * 0.5, 0.78 * fl * kill, 1);
      f.flame.material.opacity = kill;
      f.flame.position.x = tilt * 0.16;
      f.core.scale.set(0.19 * fl * kill, 0.34 * fl * kill, 1);
      f.core.material.opacity = kill;
      f.core.position.x = tilt * 0.16;
      f.light.intensity = 2.2 * fl * kill;
      f.light.color.setRGB(1.0, 0.62 + 0.1 * fl, 0.34);
    });

    /* 烛烟 */
    for (var s = smokes.length - 1; s >= 0; s--) {
      var sp = smokes[s], ud = sp.userData;
      if (t < ud.t0) { sp.material.opacity = 0; continue; }
      var age = t - ud.t0;
      var lifeP = age / ud.life;
      if (lifeP >= 1) { scene.remove(sp); smokes.splice(s, 1); continue; }
      sp.position.y += ud.vy * dt * (1 - lifeP * 0.4);
      sp.position.x += Math.sin(age * 1.7 + ud.rot) * ud.drift * dt;
      sp.position.z += Math.cos(age * 1.3 + ud.rot) * ud.drift * dt;
      sp.scale.setScalar((0.16 + age * 0.16) * (mobile ? 0.8 : 1));
      sp.material.opacity = 0.42 * Math.sin(Math.PI * Math.min(1, lifeP * 1.15)) * (1 - lifeP * 0.5);
      sp.material.rotation = age * 0.35 + ud.rot;
    }

    /* 烟花 */
    if (sparks) {
      for (var k = sparks.length - 1; k >= 0; k--) {
        var b = sparks[k];
        b.pts.userData.t += dt;
        var arr = b.pts.geometry.attributes.position.array;
        for (var j = 0; j < arr.length / 3; j++) {
          b.vel[j * 3 + 1] -= 9.4 * dt;
          b.vel[j * 3] *= 0.985; b.vel[j * 3 + 2] *= 0.985;
          arr[j * 3] += b.vel[j * 3] * dt;
          arr[j * 3 + 1] += b.vel[j * 3 + 1] * dt;
          arr[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
        }
        b.pts.geometry.attributes.position.needsUpdate = true;
        b.pts.material.opacity = Math.max(0, 1 - b.pts.userData.t / b.life);
        if (b.pts.userData.t > b.life) {
          scene.remove(b.pts);
          b.pts.geometry.dispose();
          b.pts.material.dispose();
          sparks.splice(k, 1);
        }
      }
    }

    /* 尘埃缓慢漂 */
    if (scene.userData.dust) {
      scene.userData.dust.rotation.y = t * 0.012;
      scene.userData.dust.position.y = Math.sin(t * 0.4) * 0.14;
    }
    if (sky && sky.material.uniforms) sky.material.uniforms.uTime.value = t;
    updateAmbience(t, dt);

    /* 麦克风音量 → 吹灭 */
    if (micOn && !blown) {
      var lv = micLevel();
      micState.textContent = lv > 0.05 ? '吹！' : '听得到，使劲吹';
      if (lv > 0.30) doBlow();
    }

    /* 铭牌轻微呼吸光 */
    if (plaque) plaque.material.emissiveIntensity = 0.12 + Math.sin(t * 1.6) * 0.05;

    renderWithBloom();

    if (!finaleShown && since > 1.0) {
      finaleShown = true;
    }
  }

  buildAmbience();
  resize();
  document.body.classList.add('ready');
  frame();
})();
