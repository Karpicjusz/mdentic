/* MDentic: interfejs strony + scena WebGL z cząsteczkami.
 * Cząsteczki rysują kolejno: ząb z linii → diament z logo → pole linii
 * (tło usług) → napis MDentic → pinezkę. Przejścia sterowane są scrollem. */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = matchMedia('(hover: none)').matches;
const body = document.body;

/* ============================== UI ============================== */

body.classList.add('loading');
document.getElementById('year').textContent = new Date().getFullYear();

// opóźnienia kaskadowe dla grup elementów
document.querySelectorAll('.cards, .facts, .contact, .steps').forEach(group => {
  [...group.querySelectorAll('.reveal')].forEach((el, i) => el.style.setProperty('--d', `${i * 0.09}s`));
});

const io = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

function startReveals() {
  body.classList.add('revealed');
  document.querySelector('.hero__title').classList.add('in');
  document.querySelectorAll('.reveal, .eyebrow').forEach(el => io.observe(el));
}

let loaderHidden = false;
function hideLoader() {
  if (loaderHidden) return;
  loaderHidden = true;
  document.querySelector('.loader').classList.add('done');
  body.classList.remove('loading');
  // treść pojawia się, gdy cząsteczki już lecą do zęba — logo ma czystą scenę na rozprysk
  setTimeout(startReveals, reduceMotion ? 0 : 1300);
  window.dispatchEvent(new Event('mdentic:ready'));
}
// Kolejność ładowania (żeby nic się nie rwało):
// 1) czekamy, aż strona i czcionki się wczytają — dopiero wtedy startuje rysowanie logo,
// 2) logo rysuje się jedną ciągłą linią; w tle nie dzieje się nic ciężkiego,
// 3) gdy logo stoi, przygotowujemy scenę WebGL (logo tylko pulsuje na compositorze),
// 4) loader znika, a w tym samym miejscu logo z cząsteczek rozpryskuje się i składa w ząb.
const loaderEl = document.querySelector('.loader');
const pageLoaded = new Promise(r => (document.readyState === 'complete' ? r() : addEventListener('load', r, { once: true })));
const DRAW_MS = reduceMotion ? 50 : 3300;
const logoDrawn = Promise.race([
  Promise.all([pageLoaded, document.fonts.ready]),
  new Promise(r => setTimeout(r, 2500)), // nie czekamy w nieskończoność na wolne czcionki
]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  .then(() => { loaderEl.classList.add('go'); return new Promise(r => setTimeout(r, DRAW_MS)); });

logoDrawn
  .then(() => import('three'))
  .then(THREE => initGL(THREE))
  .catch(err => {
    console.warn('WebGL niedostępny:', err);
    body.classList.add('no-webgl');
  })
  .finally(() => requestAnimationFrame(() => requestAnimationFrame(hideLoader)));
setTimeout(hideLoader, 14000); // zabezpieczenie

// nawigacja: tło po scrollu i aktywny link
const nav = document.querySelector('.nav');
const navLinks = [...document.querySelectorAll('.nav__links a')];
const sections = [...document.querySelectorAll('section[data-shape]')];
const steps = document.querySelector('.steps');

function onScroll() {
  nav.classList.toggle('scrolled', scrollY > 40);
  const mid = scrollY + innerHeight * 0.5;
  let current = sections[0];
  for (const s of sections) if (s.offsetTop <= mid) current = s;
  navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${current.id}`));

  // linia osi czasu „wizyty” rośnie razem ze scrollem
  const r = steps.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (innerHeight * 0.7 - r.top) / r.height));
  steps.style.setProperty('--p', p.toFixed(3));
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// poświata kursora i podświetlenie kart
const glow = document.querySelector('.cursor-glow');
addEventListener('pointermove', e => {
  glow.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
}, { passive: true });
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

/* ============================ WebGL ============================= */

// scena startuje z sekwencji ładowania powyżej (initGL)

/* ---- kształty (współrzędne znormalizowane mniej więcej do [-1, 1]) ---- */

const SVGNS = 'http://www.w3.org/2000/svg';
const measureSvg = document.createElementNS(SVGNS, 'svg');
measureSvg.setAttribute('style', 'position:absolute;width:0;height:0;visibility:hidden');
document.body.appendChild(measureSvg);

function rand(seed) { // deterministyczny generator, by kształty były stabilne
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Rozkłada `n` punktów równomiernie wzdłuż ścieżek SVG.
 *  defs: [{ d, z, w, cx, cy, k }] — z: głębia, w: waga gęstości,
 *  (cx, cy, k): środek i skala normalizacji. */
function fromPaths(defs, n, seed) {
  const r = rand(seed);
  const out = new Float32Array(n * 3);
  const items = defs.map(def => {
    const el = document.createElementNS(SVGNS, 'path');
    el.setAttribute('d', def.d);
    measureSvg.appendChild(el);
    const len = el.getTotalLength();
    return { def, el, len, weight: len * (def.w ?? 1) };
  });
  const total = items.reduce((a, b) => a + b.weight, 0);
  let k = 0;
  items.forEach((it, idx) => {
    const count = idx === items.length - 1 ? n - k : Math.round(n * it.weight / total);
    const { cx = 50, cy = 50, k: sc = 50, z = 0, jitter = 0.35 } = it.def;
    // getPointAtLength jest wolne, więc próbkujemy ścieżkę raz (tablica punktów)
    // i dalej tylko interpolujemy liniowo
    const SAMPLES = 400;
    const lut = new Float32Array((SAMPLES + 1) * 2);
    for (let j = 0; j <= SAMPLES; j++) {
      const pt = it.el.getPointAtLength(j / SAMPLES * it.len);
      lut[j * 2] = pt.x; lut[j * 2 + 1] = pt.y;
    }
    for (let i = 0; i < count && k < n; i++, k++) {
      const f = (i + r()) / count * SAMPLES;
      const j = Math.min(SAMPLES - 1, Math.floor(f)), t = f - j;
      const px = lut[j * 2] + (lut[j * 2 + 2] - lut[j * 2]) * t;
      const py = lut[j * 2 + 1] + (lut[j * 2 + 3] - lut[j * 2 + 1]) * t;
      out[k * 3] = (px - cx + (r() - 0.5) * jitter) / sc;
      out[k * 3 + 1] = -(py - cy + (r() - 0.5) * jitter) / sc;
      out[k * 3 + 2] = z + (r() - 0.5) * 0.02;
    }
    it.el.remove();
  });
  return out;
}

/* Logo z cząsteczek — te same linie, które rysuje SVG w loaderze (index.html).
   Współrzędne w jednostkach viewBox loadera, środek (200, 52). */
const LOGO_PATH = 'M2 2 H398 V102 H2 Z M84 2 V102 M180 2 V102 M92 40 L110 22 L154 22 L172 40 L132 86 Z M92 40 L172 40 M110 22 L121 40 L132 22 L143 40 L154 22 M121 40 L132 86 L143 40';

function logoShape(n) {
  const nLines = Math.round(n * 0.6);
  const lines = fromPaths([{ d: LOGO_PATH, cx: 200, cy: 52, k: 1, jitter: 0.8 }], nLines, 66);
  // napisy „M” i „dentic” próbkowane z canvasa w tej samej skali co SVG
  const SC = 4, W = 424 * SC, H = 128 * SC;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.scale(SC, SC); g.translate(12, 12);
  g.font = '400 64px "Open Sans", sans-serif';
  g.textAlign = 'center'; g.fillStyle = '#fff';
  g.fillText('M', 43, 76);
  g.fillText('dentic', 288, 76);
  const data = g.getImageData(0, 0, W, H).data;
  const px = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 128) px.push(x, y);
  const r = rand(67);
  const out = new Float32Array(n * 3);
  out.set(lines);
  for (let i = nLines; i < n; i++) {
    const j = px.length ? Math.floor(r() * (px.length / 2)) * 2 : 0;
    const x = (px[j] ?? W / 2) / SC - 12, y = (px[j + 1] ?? H / 2) / SC - 12;
    out[i * 3] = x - 200 + (r() - 0.5) * 0.4;
    out[i * 3 + 1] = -(y - 52) + (r() - 0.5) * 0.4;
    out[i * 3 + 2] = 0;
  }
  return out;
}

const TOOTH = 'M50 18 C40 10 22 8 16 20 C9 34 14 52 22 62 C26 70 26 86 30 94 C33 99 38 97 39 90 C41 80 43 70 50 68 C57 70 59 80 61 90 C62 97 67 99 70 94 C74 86 74 70 78 62 C86 52 91 34 84 20 C78 8 60 10 50 18 Z';

function toothShape(n) {
  const defs = [];
  const layers = [1, 0.82, 0.64, 0.46];
  layers.forEach((s, i) => {
    // kontur skalowany wokół środka korony (50, 50)
    defs.push({ d: TOOTH, cx: 50, cy: 55, k: 50 / s, z: (i - 1.5) * -0.18, w: 1.15 - i * 0.12 });
  });
  defs.push({ d: 'M30 30 C40 38 45 31 50 26 C55 31 60 38 70 30', cx: 50, cy: 55, k: 50, z: 0.32, w: 1.4 });
  defs.push({ d: 'M86 12 L88 6 L90 12 L96 14 L90 16 L88 22 L86 16 L80 14 Z', cx: 50, cy: 55, k: 50, z: 0.3, w: 2.2 });
  return fromPaths(defs, n, 11);
}

function diamondShape(n) {
  const outline = 'M110 22 L154 22 L172 40 L132 86 L92 40 Z';
  const facets = 'M92 40 L110 22 L121 40 L132 22 L143 40 L154 22 L172 40 M92 40 L172 40 M121 40 L132 86 L143 40';
  const base = { cx: 132, cy: 52, k: 40 };
  return fromPaths([
    { ...base, d: outline, z: 0.12, w: 1.3 },
    { ...base, d: facets, z: 0.12, w: 1.1 },
    { ...base, d: outline, z: -0.22, w: 0.5, k: 46 },
    { ...base, d: 'M132 6 L132 0 M118 9 L114 4 M146 9 L150 4', z: 0.2, w: 2.5 },
  ], n, 22);
}

function linesShape(n) {
  const r = rand(33);
  const out = new Float32Array(n * 3);
  const rows = 18;
  for (let i = 0; i < n; i++) {
    const row = i % rows;
    const u = r() * 2 - 1;
    const y0 = (row / (rows - 1)) * 2 - 1;
    out[i * 3] = u;
    out[i * 3 + 1] = y0 + Math.sin(u * 3.2 + row * 0.55) * 0.05 + Math.sin(u * 7 + row) * 0.012;
    out[i * 3 + 2] = Math.cos(u * 2 + row * 0.3) * 0.25;
  }
  return out;
}

function textShape(n, text = 'MDentic') {
  const W = 1400, H = 360;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.font = '300 250px Sora, "Open Sans", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = '#fff'; g.lineWidth = 3;
  g.strokeText(text, W / 2, H / 2);
  g.fillStyle = 'rgba(255,255,255,.35)';
  g.fillText(text, W / 2, H / 2);
  const data = g.getImageData(0, 0, W, H).data;
  const strong = [], weak = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const a = data[(y * W + x) * 4 + 3];
    if (a > 160) strong.push(x, y); else if (a > 40) weak.push(x, y);
  }
  const r = rand(44);
  const out = new Float32Array(n * 3);
  const scale = W / 2;
  for (let i = 0; i < n; i++) {
    const src = (r() < 0.78 || !weak.length) && strong.length ? strong : weak;
    const j = Math.floor(r() * (src.length / 2)) * 2;
    out[i * 3] = (src[j] - W / 2 + r() - 0.5) / scale;
    out[i * 3 + 1] = -(src[j + 1] - H / 2 + r() - 0.5) / scale;
    out[i * 3 + 2] = (r() - 0.5) * 0.04;
  }
  return out;
}

function pinShape(n) {
  const base = { cx: 50, cy: 52, k: 46 };
  const pin = 'M50 86 C44 78 22 58 22 38 A28 28 0 1 1 78 38 C78 58 56 78 50 86 Z';
  const dot = 'M61 38 A11 11 0 1 1 39 38 A11 11 0 1 1 61 38 Z';
  const ring = (rx, ry) => `M${50 - rx} 92 A${rx} ${ry} 0 1 1 ${50 + rx} 92 A${rx} ${ry} 0 1 1 ${50 - rx} 92 Z`;
  return fromPaths([
    { ...base, d: pin, z: 0.1, w: 1.3 },
    { ...base, d: pin, z: -0.12, w: 0.5, k: 52 },
    { ...base, d: dot, z: 0.12, w: 1.6 },
    { ...base, d: ring(14, 4), z: 0, w: 1.2 },
    { ...base, d: ring(28, 7), z: 0, w: 0.8 },
    { ...base, d: ring(44, 11), z: 0, w: 0.5 },
  ], n, 55);
}

/* ------------------------------ scena ------------------------------ */

async function initGL(THREE) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    body.classList.add('no-webgl');
    return;
  }
  const PR = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
  camera.position.z = 10;

  try { await document.fonts.load('300 250px Sora'); } catch (e) { /* trudno, użyjemy zastępczej czcionki */ }

  const small = innerWidth < 760;
  const N = small ? 9000 : 18000;
  // kształty liczymy po kolei, oddając przeglądarce oddech między nimi
  const shapes = [];
  for (const make of [toothShape, diamondShape, linesShape, textShape, pinShape]) {
    shapes.push(make(N));
    await new Promise(res => setTimeout(res, 0));
  }
  try { await document.fonts.load('400 64px "Open Sans"'); } catch (e) { /* czcionka zastępcza */ }
  const logoPts = logoShape(N);
  const S = shapes.length;

  const geo = new THREE.BufferGeometry();
  shapes.forEach((arr, i) => geo.setAttribute(`p${i}`, new THREE.BufferAttribute(arr, 3)));
  geo.setAttribute('position', new THREE.BufferAttribute(shapes[0], 3));
  geo.setAttribute('pS', new THREE.BufferAttribute(logoPts, 3));
  const rnd = new Float32Array(N * 4);
  const r = rand(99);
  for (let i = 0; i < rnd.length; i++) rnd[i] = r();
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));

  const uniforms = {
    uTime: { value: 0 },
    uIdx: { value: 0 },
    uIntro: { value: reduceMotion ? 1 : 0 },
    uLogo: { value: 0.01 },
    uSize: { value: small ? 2.6 : 2.3 },
    uPR: { value: PR },
    uRot: { value: 0 },
    uMouse: { value: new THREE.Vector2(99, 99) },
    uMouseOn: { value: 0 },
    uOff: { value: Array.from({ length: S }, () => new THREE.Vector3()) },
    uScl: { value: Array.from({ length: S }, () => new THREE.Vector3(1, 1, 1)) },
    uA: { value: [1, 1, 0.5, 1, 1] },
    uRk: { value: [1, 1, 0.12, 0.45, 1] },
    uC1: { value: new THREE.Color('#dcebff') },
    uC2: { value: new THREE.Color('#7fd3ff') },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime, uIdx, uIntro, uSize, uPR, uRot, uMouseOn, uLogo;
      uniform vec2 uMouse;
      uniform vec3 uOff[${S}];
      uniform vec3 uScl[${S}];
      uniform float uA[${S}];
      uniform float uRk[${S}];
      attribute vec3 p0; attribute vec3 p1; attribute vec3 p2; attribute vec3 p3; attribute vec3 p4;
      attribute vec4 aRnd;
      attribute vec3 pS;
      varying float vAlpha;
      varying float vTint;

      vec3 raw(int i) {
        if (i == 0) return p0;
        if (i == 1) return p1;
        if (i == 2) return p2;
        if (i == 3) return p3;
        return p4;
      }
      vec3 shp(int i) {
        vec3 q = raw(i) * uScl[i];
        float a = uRot * uRk[i];
        float c = cos(a), s = sin(a);
        q.xz = mat2(c, -s, s, c) * q.xz;
        return q + uOff[i];
      }

      void main() {
        float fi = floor(uIdx);
        int i = int(fi);
        int j = min(i + 1, ${S - 1});
        float f = uIdx - fi;

        // każda cząsteczka startuje z innym opóźnieniem — linie „odklejają się” po kolei
        float t = clamp((f - aRnd.y * 0.35) / 0.65, 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);
        vec3 p = mix(shp(i), shp(j), t);

        // w połowie przejścia cząsteczki rozwiewają się w płynne smugi
        float chaos = sin(t * 3.14159);
        vec3 sd = vec3(aRnd.z, aRnd.w, aRnd.x) * 6.2831;
        p += vec3(
          sin(p.y * 0.9 + uTime * 0.7 + sd.x * 0.3),
          cos(p.x * 0.8 - uTime * 0.6 + sd.y * 0.3),
          sin(p.x * 1.2 + p.y * 1.1 + uTime * 0.5 + sd.z)
        ) * chaos * (0.18 + aRnd.x * 0.5);

        // delikatne „oddychanie”
        p += vec3(sin(uTime * 0.9 + sd.x), cos(uTime * 0.8 + sd.y), sin(uTime * 0.7 + sd.z)) * 0.012;

        // intro: cząsteczki startują dokładnie w liniach logo z loadera,
        // rozpryskują się na boki i lecą do zęba
        float it = clamp((uIntro - aRnd.y * 0.4) / 0.6, 0.0, 1.0);
        float ie = it * it * (3.0 - 2.0 * it);
        vec3 start = pS * uLogo;
        vec3 burstDir = normalize(vec3(start.xy, 0.0) + (vec3(aRnd.z, aRnd.w, aRnd.x) - 0.5) * 1.2 + 1e-3);
        float burst = sin(ie * 3.14159) * (0.3 + aRnd.w * 0.9);
        p = mix(start, p, ie) + burstDir * burst;

        // odpychanie kursorem
        vec2 d = p.xy - uMouse;
        float m = exp(-dot(d, d) * 2.5) * 0.4 * uMouseOn;
        p.xy += normalize(d + 1e-4) * m;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.45 + aRnd.x * 1.1) * uPR * (10.0 / -mv.z) * (1.0 + chaos * 0.6);

        vAlpha = mix(uA[i], uA[j], t) * (0.35 + 0.65 * aRnd.w) * (0.55 + 0.45 * ie) + chaos * 0.12;
        vTint = aRnd.z + m * 3.0 + chaos * 0.3;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uC1, uC2;
      varying float vAlpha;
      varying float vTint;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        vec3 col = mix(uC1, uC2, smoothstep(0.65, 0.9, vTint));
        gl_FragColor = vec4(col, a * vAlpha);
      }
    `,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  scene.add(points);

  // pył w tle dla głębi
  const DUST = small ? 350 : 800;
  const dpos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dpos[i * 3] = (r() - 0.5) * 30;
    dpos[i * 3 + 1] = (r() - 0.5) * 20;
    dpos[i * 3 + 2] = -r() * 20 - 2;
  }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({
    color: 0x9cc8ff, size: 0.05, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false;
  scene.add(dust);

  /* ---- układ: gdzie stoi kształt na danym ekranie ---- */
  let viewW = 1, viewH = 1;
  function layout() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    viewW = viewH * camera.aspect;

    const mobile = w < 760 || w / h < 0.9;
    const cx = mobile ? 0 : viewW * 0.25;
    const cy = mobile ? viewH * 0.24 : 0;
    const s = mobile ? Math.min(viewW * 0.34, viewH * 0.17) : Math.min(viewH * 0.33, viewW * 0.17);
    const set = (i, x, y, sx, sy = sx, sz = sx) => { uniforms.uOff.value[i].set(x, y, 0); uniforms.uScl.value[i].set(sx, sy, sz); };
    set(0, cx, cy, s);
    set(1, cx, cy - s * 0.05, s * 0.92);
    set(2, 0, 0, viewW * 0.56, viewH * 0.46, 1);
    set(3, cx, cy, mobile ? viewW * 0.44 : s * 1.25);
    set(4, cx, cy, s * 0.95);
    // skala logo z cząsteczek = skala SVG w loaderze (szerokość min(480px, 84vw), viewBox 424)
    uniforms.uLogo.value = (Math.min(480, w * 0.84) / 424) * (viewH / h);
  }
  layout();
  addEventListener('resize', layout);

  /* ---- scroll → indeks kształtu (z „przytrzymaniem” na środku sekcji) ---- */
  function targetIndex() {
    const maxScroll = document.documentElement.scrollHeight - innerHeight;
    // na telefonie kształt stoi nad treścią, więc „przystanek” to początek sekcji
    const mobile = innerWidth < 760 || innerWidth / innerHeight < 0.9;
    const stops = sections.map(sec => Math.min(maxScroll, Math.max(0,
      mobile ? sec.offsetTop : sec.offsetTop + sec.offsetHeight / 2 - innerHeight / 2)));
    const y = scrollY;
    if (y <= stops[0]) return 0;
    for (let i = 0; i < stops.length - 1; i++) {
      if (y < stops[i + 1]) {
        const t = (y - stops[i]) / Math.max(1, stops[i + 1] - stops[i]);
        return i + Math.min(1, Math.max(0, (t - 0.15) / 0.7));
      }
    }
    return stops.length - 1;
  }

  /* ---- kursor ---- */
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, on: 0 };
  if (!isTouch && !reduceMotion) {
    addEventListener('pointermove', e => {
      mouse.tx = (e.clientX / innerWidth) * 2 - 1;
      mouse.ty = -(e.clientY / innerHeight) * 2 + 1;
      mouse.on = 1;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { mouse.on = 0; });
  }

  /* ---- intro po zniknięciu loadera ---- */
  let introStart = -1;
  const beginIntro = () => { introStart = performance.now(); };
  if (loaderHidden) beginIntro(); else addEventListener('mdentic:ready', beginIntro, { once: true });

  let idx = targetIndex();
  let last = performance.now();
  let mouseOn = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    uniforms.uTime.value = time;

    const k = 1 - Math.exp(-dt * (reduceMotion ? 20 : 4.5));
    idx += (targetIndex() - idx) * k;
    uniforms.uIdx.value = Math.min(S - 1 - 1e-4, Math.max(0, idx));

    if (!reduceMotion && introStart > 0) {
      uniforms.uIntro.value = Math.min(1, (now - introStart) / 3000);
    }

    mouse.x += (mouse.tx - mouse.x) * 0.08;
    mouse.y += (mouse.ty - mouse.y) * 0.08;
    mouseOn += (mouse.on - mouseOn) * 0.05;
    uniforms.uMouse.value.set(mouse.x * viewW / 2, mouse.y * viewH / 2);
    uniforms.uMouseOn.value = mouseOn;
    uniforms.uRot.value = reduceMotion ? 0 : Math.sin(time * 0.3) * 0.35 + mouse.x * 0.4;

    points.rotation.x = -mouse.y * 0.08;
    dust.rotation.y = time * 0.01 + mouse.x * 0.05;
    dust.rotation.x = mouse.y * 0.03;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  // kompilacja shaderów i pierwsza klatka jeszcze pod loaderem
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
