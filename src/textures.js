import * as THREE from 'three';

// Procedural planet/star textures. Equirectangular canvases built from tiling
// fractal value-noise, then lightly posterized for a clean "stylised 4k" look.
// No external images — everything is generated offline at body creation.

const W = 1024, H = 512;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Value noise on a lattice that wraps in X (gx columns) so there's no seam.
function makeNoise(rand, gx, gy) {
  const grid = new Float32Array(gx * gy);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {                       // x,y in [0,1)
    const fx = x * gx, fy = y * gy;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const xa = ((x0 % gx) + gx) % gx, xb = (xa + 1) % gx;
    const ya = Math.max(0, Math.min(gy - 1, y0));
    const yb = Math.max(0, Math.min(gy - 1, y0 + 1));
    const v00 = grid[ya * gx + xa], v10 = grid[ya * gx + xb];
    const v01 = grid[yb * gx + xa], v11 = grid[yb * gx + xb];
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) +
           (v01 * (1 - tx) + v11 * tx) * ty;
  };
}

function fbm(rand, octaves, base) {
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const g = base * (1 << o);
    layers.push({ n: makeNoise(rand, g * 2, g), amp: 1 / (1 << o) });
  }
  const norm = layers.reduce((s, l) => s + l.amp, 0);
  return (x, y) => {
    let v = 0;
    for (const l of layers) v += l.n(x, y) * l.amp;
    return v / norm;
  };
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const post = (v, steps) => Math.round(v * steps) / steps;   // posterize → cartoon
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ramp: array of [stop(0..1), [r,g,b]] — returns interpolated colour
function ramp(stops, t) {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      return mix(a[1], b[1], (t - a[0]) / (b[0] - a[0] || 1));
    }
  }
  return stops[stops.length - 1][1];
}

// Classify a body into a visual style from its name / type / mass.
export function styleFor(body) {
  if (body.type === 'star') {
    if (body.__starPhase === 'dark_giant') return 'dark_red_giant';
    if (body.__starPhase === 'giant')      return 'red_giant';
    return 'star';
  }
  const n = (body.name || '').toLowerCase();
  if (n.includes('mercury')) return 'rock_gray';
  if (n.includes('venus')) return 'venus';
  if (n.includes('earth')) return 'earth';
  if (n.includes('mars')) return 'mars';
  if (n.includes('jupiter')) return 'jupiter';
  if (n.includes('saturn')) return 'saturn';
  if (n.includes('uranus')) return 'uranus';
  if (n.includes('neptune')) return 'neptune';
  return body.mass > 5e-5 ? 'gas' : 'rock';   // user-added: by mass
}

// Build {map, bump} canvas textures for a body.
export function makeTextures(body) {
  const style = styleFor(body);
  const seed = (body.id * 2654435761) >>> 0;
  const rand = mulberry32(seed);
  const base = hex(body.color);

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const bp = document.createElement('canvas'); bp.width = W; bp.height = H;
  const img = cv.getContext('2d').createImageData(W, H);
  const bmp = bp.getContext('2d').createImageData(W, H);
  const d = img.data, bd = bmp.data;

  const land = fbm(rand, 5, 3);
  const detail = fbm(rand, 4, 8);
  const warp = fbm(rand, 3, 2);

  for (let y = 0; y < H; y++) {
    const v = y / H;
    const polar = Math.abs(v - 0.5) * 2;            // 0 equator → 1 pole
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let h = land(u, v);                            // height / field 0..1
      let col, height = h;

      if (style === 'earth') {
        h = post(h, 14);
        if (h < 0.48) {
          col = ramp([[0, [10, 40, 90]], [0.5, [20, 80, 140]],
                      [1, [40, 120, 165]]], h / 0.48);
        } else {
          const e = (h - 0.48) / 0.52;
          col = ramp([[0, [196, 184, 120]], [0.15, [70, 130, 60]],
                      [0.55, [50, 100, 45]], [0.8, [110, 95, 70]],
                      [1, [235, 240, 245]]], e);
        }
        const ice = smooth(0.78, 0.96, polar + (detail(u, v) - 0.5) * 0.25);
        col = mix(col, [240, 246, 250], ice);
        const cloud = smooth(0.55, 0.8, detail(u + warp(u, v) * 0.1, v) * 0.7 + h * 0.3);
        col = mix(col, [255, 255, 255], cloud * 0.75);

      } else if (style === 'mars') {
        h = post(h, 10);
        col = ramp([[0, [120, 55, 35]], [0.4, [165, 85, 50]],
                    [0.7, [200, 120, 75]], [1, [225, 165, 120]]], h);
        col = mix(col, [235, 240, 245], smooth(0.88, 1, polar));

      } else if (style === 'rock_gray' || style === 'rock') {
        const tint = style === 'rock' ? base : [140, 140, 140];
        h = post(h * 0.6 + detail(u, v) * 0.4, 8);
        const craters = smooth(0.62, 0.66, detail(u, v)) * 0.35;
        col = mix(mix([60, 60, 60], tint, 0.5),
                  mix(tint, [235, 235, 235], 0.4), h);
        col = mix(col, [40, 40, 45], craters);

      } else if (style === 'venus') {
        const s = post(0.4 + 0.6 * land(u + warp(u, v) * 0.3, v), 9);
        col = ramp([[0, [150, 110, 60]], [0.5, [205, 165, 100]],
                    [1, [240, 215, 165]]], s);

      } else if (style === 'jupiter' || style === 'saturn' ||
                 style === 'uranus' || style === 'neptune' || style === 'gas') {
        const pal = {
          jupiter: [[200,170,130],[150,95,60],[225,205,170],[120,70,50],[210,180,140]],
          saturn:  [[230,210,165],[205,180,130],[240,225,185],[215,195,150]],
          uranus:  [[150,210,215],[175,225,228],[135,195,205],[185,230,232]],
          neptune: [[40,70,170],[60,95,200],[30,55,140],[80,120,215]],
          gas: [base, mix(base,[255,255,255],0.35), mix(base,[0,0,0],0.3),
                mix(base,[255,255,255],0.15)],
        }[style];
        const lat = v + (warp(u, v) - 0.5) * 0.06;     // wavy band edges
        const bands = pal.length;
        const f = (Math.sin(lat * Math.PI * bands * 2) * 0.5 + 0.5);
        const idx = Math.min(bands - 1, Math.floor(post(f, bands) * bands));
        col = pal[idx].slice();
        col = mix(col, mix(col, [255, 255, 255], 0.5), (detail(u, v) - 0.5) * 0.3 + 0.5 - 0.5);
        // storm spots
        if (style === 'jupiter') {
          const dx = (u - 0.62), dy = (v - 0.58);
          col = mix(col, [200, 90, 60], smooth(0.05, 0.0, Math.hypot(dx * 1.6, dy)));
        }
        if (style === 'neptune') {
          const dx = (u - 0.35), dy = (v - 0.45);
          col = mix(col, [20, 30, 80], smooth(0.045, 0.0, Math.hypot(dx * 1.5, dy)));
        }
        height = f;

      } else if (style === 'star') {
        const g = post(0.35 + 0.65 * fbmStar(land, detail, u, v), 7);
        col = ramp([[0, [180, 60, 0]], [0.5, [255, 170, 40]],
                    [0.8, [255, 225, 130]], [1, [255, 250, 225]]], g);
        col = mix(col, base, 0.25);
        height = g;
      } else if (style === 'red_giant') {       // bloated, cooler surface
        const g = post(0.30 + 0.70 * fbmStar(land, detail, u, v), 6);
        col = ramp([[0, [70, 10, 0]], [0.4, [170, 45, 15]],
                    [0.75, [230, 90, 35]], [1, [255, 160, 80]]], g);
        height = g;
      } else if (style === 'dark_red_giant') {  // late-stage: dim, near collapse
        const g = post(0.18 + 0.78 * fbmStar(land, detail, u, v), 5);
        col = ramp([[0, [22, 0, 0]], [0.35, [78, 12, 4]],
                    [0.7, [140, 32, 14]], [1, [195, 70, 28]]], g);
        height = g;
      } else {
        col = base;
      }

      const i = (y * W + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      const bv = Math.max(0, Math.min(255, height * 255));
      bd[i] = bd[i + 1] = bd[i + 2] = bv; bd[i + 3] = 255;
    }
  }

  cv.getContext('2d').putImageData(img, 0, 0);
  bp.getContext('2d').putImageData(bmp, 0, 0);

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(bp);
  return { map, bump,
    isStar: style === 'star' || style === 'red_giant' || style === 'dark_red_giant' };
}

function fbmStar(a, b, u, v) { return a(u, v) * 0.6 + b(u * 2, v * 2) * 0.4; }

// ---- moon textures -------------------------------------------------------
// Smaller canvas than planets (there are ~20 moons). Generic moons are
// cratered rock tinted to their real colour; a few famous ones get their
// real distinctive look.
const ICY_MOONS = new Set(['Mimas', 'Enceladus', 'Tethys', 'Dione', 'Rhea',
  'Europa', 'Miranda', 'Ariel', 'Umbriel', 'Titania', 'Oberon']);

export function makeMoonTexture(name, tintHex, seed) {
  const MW = 512, MH = 256;
  const rand = mulberry32((seed * 374761393) >>> 0);
  const tint = hex(tintHex);
  const cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
  const bp = document.createElement('canvas'); bp.width = MW; bp.height = MH;
  const img = cv.getContext('2d').createImageData(MW, MH);
  const bmp = bp.getContext('2d').createImageData(MW, MH);
  const d = img.data, bd = bmp.data;

  const ground = fbm(rand, 4, 4);
  const fine = fbm(rand, 4, 9);
  const warp = fbm(rand, 2, 3);
  const ridged = (x, y) => 1 - Math.abs(2 * fine(x, y) - 1);   // crack/streak field

  for (let y = 0; y < MH; y++) {
    const v = y / MH;
    for (let x = 0; x < MW; x++) {
      const u = x / MW;
      let g = ground(u, v), col, height = g;

      if (name === 'Io') {                       // sulfur yellows + dark spots
        g = post(g, 8);
        col = ramp([[0, [120, 70, 20]], [0.4, [225, 190, 70]],
                    [0.7, [240, 220, 130]], [1, [250, 245, 210]]], g);
        col = mix(col, [70, 40, 30], smooth(0.66, 0.7, fine(u, v)) * 0.6);
      } else if (name === 'Titan') {             // smooth orange haze
        const s = post(0.45 + 0.55 * ground(u + warp(u, v) * 0.2, v), 7);
        col = ramp([[0, [150, 95, 40]], [0.5, [205, 150, 75]],
                    [1, [232, 190, 120]]], s);
      } else if (name === 'Triton') {            // pink cantaloupe + streaks
        g = post(g, 9);
        col = ramp([[0, [180, 150, 140]], [0.5, [212, 190, 178]],
                    [1, [238, 226, 214]]], g);
        col = mix(col, [120, 90, 95], smooth(0.55, 0.5, ridged(u, v)) * 0.4);
      } else if (name === 'Europa') {            // bright ice, reddish lineae
        col = mix([224, 230, 236], [205, 214, 224], post(g, 6));
        const crack = smooth(0.78, 0.92, ridged(u + warp(u, v) * 0.15, v));
        col = mix(col, [150, 95, 70], crack * 0.8);
        height = 0.5 + crack * 0.3;
      } else if (ICY_MOONS.has(name)) {          // bright cratered ice
        const t = post(g, 7);
        col = mix([170, 178, 188], [236, 240, 245], t);
        const cr = smooth(0.6, 0.64, fine(u, v));
        col = mix(col, [120, 128, 140], cr * 0.5);
        height = t * (1 - cr);
      } else {                                   // generic cratered rock
        const t = post(g * 0.6 + fine(u, v) * 0.4, 6);
        col = mix(mix([45, 42, 40], tint, 0.65),
                  mix(tint, [225, 222, 218], 0.35), t);
        const cr = smooth(0.6, 0.645, fine(u, v));
        col = mix(col, [30, 28, 26], cr * 0.55);
        height = t * (1 - cr);
      }

      const i = (y * MW + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      const bv = Math.max(0, Math.min(255, height * 255));
      bd[i] = bd[i + 1] = bd[i + 2] = bv; bd[i + 3] = 255;
    }
  }
  cv.getContext('2d').putImageData(img, 0, 0);
  bp.getContext('2d').putImageData(bmp, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map, bump: new THREE.CanvasTexture(bp) };
}

// ---- ring systems --------------------------------------------------------
// extents/bands in PLANET RADII; tilt = real axial tilt (rad). `arcs` adds
// Neptune-style brightness clumps on the outermost band. Inner rocky planets
// are absent → no rings, exactly as in reality.
const DEG = Math.PI / 180;
const RING_SPECS = {
  jupiter: {                                   // 4 faint, dusty rings
    inner: 1.40, outer: 3.10, tilt: 3.1 * DEG, base: [120, 110, 100],
    bands: [[1.40, 1.71, 0.05], [1.71, 1.81, 0.16],
            [1.81, 2.55, 0.045], [2.55, 3.10, 0.03]],
  },
  saturn: {                                    // C, B, Cassini gap, A, F
    inner: 1.20, outer: 2.40, tilt: 26.7 * DEG, base: [225, 205, 165],
    bands: [[1.24, 1.53, 0.40], [1.53, 1.95, 0.95],
            [2.02, 2.27, 0.70], [2.32, 2.36, 0.55]],
  },
  uranus: {                                    // 13 narrow, dark rings
    inner: 1.50, outer: 2.02, tilt: 97.8 * DEG, base: [120, 140, 145],
    bands: Array.from({ length: 13 }, (_, i) => {
      const r = 1.50 + (i / 12) * 0.46;
      return [r, r + 0.012, i === 12 ? 0.7 : 0.18 + 0.04 * (i % 3)];
    }),
  },
  neptune: {                                   // 5 faint rings; Adams has arcs
    inner: 1.70, outer: 2.55, tilt: 28.3 * DEG, base: [90, 110, 170], arcs: true,
    bands: [[1.70, 1.73, 0.20], [1.90, 1.93, 0.16], [2.10, 2.20, 0.10],
            [2.30, 2.33, 0.14], [2.50, 2.54, 0.30]],
  },
};

export function hasRings(style) { return !!RING_SPECS[style]; }

function ringTexture(spec, rand) {
  const RW = 1024, RH = 256;
  const cv = document.createElement('canvas'); cv.width = RW; cv.height = RH;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(RW, RH);
  const d = img.data;
  const span = spec.outer - spec.inner;
  const grain = fbm(rand, 4, 6);
  for (let x = 0; x < RW; x++) {
    const rr = spec.inner + (x / RW) * span;          // radius in planet-radii
    let a = 0;
    for (const [r0, r1, alpha] of spec.bands) {
      if (rr >= r0 && rr <= r1) {
        const edge = Math.min(rr - r0, r1 - rr) / ((r1 - r0) * 0.5 + 1e-6);
        a = Math.max(a, alpha * Math.min(1, edge * 3 + 0.2));
      }
    }
    for (let y = 0; y < RH; y++) {
      let av = a * (0.75 + 0.25 * grain(x / RW, y / RH));
      if (spec.arcs && rr > spec.outer - 0.08) {        // Neptune Adams arcs
        const arc = Math.sin((y / RH) * Math.PI * 2 * 3 + 1.3);
        av *= arc > 0.4 ? 1 : 0.15;
      }
      const i = (y * RW + x) * 4;
      d[i] = spec.base[0]; d[i + 1] = spec.base[1]; d[i + 2] = spec.base[2];
      d[i + 3] = Math.max(0, Math.min(255, av * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Returns a Group (positioned/scaled by caller) or null if the body has none.
// Geometry is in planet-radii so scaling it by the planet's screen radius
// keeps the rings correctly proportioned as you resize the planet.
export function makeRingMesh(style, seed) {
  const spec = RING_SPECS[style];
  if (!spec) return null;
  const geo = new THREE.RingGeometry(spec.inner, spec.outer, 160, 1);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const r = Math.hypot(x, y);
    uv.setXY(i, (r - spec.inner) / (spec.outer - spec.inner),
                 Math.atan2(y, x) / (Math.PI * 2) + 0.5);
  }
  uv.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({
    map: ringTexture(spec, mulberry32((seed || 1) ^ 0x9e3779b9)),
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const disk = new THREE.Mesh(geo, mat);
  disk.rotation.x = -Math.PI / 2;                 // lay flat in the XZ plane
  const group = new THREE.Group();
  group.add(disk);
  group.rotation.z = spec.tilt;                   // real axial tilt
  return group;
}
