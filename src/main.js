import * as THREE from 'three';
import { FlyControls } from './controls.js';
import { step, makeBody, circularOrbitVelocity } from './physics.js';
import { physicsOf } from './bodyinfo.js';
import { buildScene } from './scenes.js';
import { makeTextures, makeRingMesh, makeMoonTexture, styleFor } from './textures.js';
import { MOONS } from './moons.js';
import { setupUI } from './ui.js';

const SCALE = 40;                 // scene units per AU
const TRAIL_MAX = 600;            // points kept per trail

// ---- renderer / scene / camera ------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400000);
// Open on a framed overview of the system (elevated & tilted so the orbits
// read as ellipses and Saturn's rings show), not way out where it's a dot.
camera.position.set(0, 760, 1850);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0x223355, 0.55));

const controls = new FlyControls(camera, canvas);

// ---- distant starfield backdrop -----------------------------------------
function makeStarfield(count, radius) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = radius * (0.6 + Math.random() * 0.4);
    const t = Math.acos(2 * Math.random() - 1);
    const p = Math.random() * Math.PI * 2;
    pos[i * 3]     = r * Math.sin(t) * Math.cos(p);
    pos[i * 3 + 1] = r * Math.cos(t);
    pos[i * 3 + 2] = r * Math.sin(t) * Math.sin(p);
    c.setHSL(0.55 + Math.random() * 0.12, 0.5, 0.6 + Math.random() * 0.4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 90, sizeAttenuation: true,
    vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
  return new THREE.Points(g, m);
}
scene.add(makeStarfield(9000, 90000));
scene.add(makeStarfield(2500, 40000));

// ---- simulation state ----------------------------------------------------
const world = {
  bodies: [],
  time: 0,            // years
  rate: 1,            // years per second
  paused: false,
  trails: true,
  exaggerate: true,
  selected: null,
};

function load(presetName) {
  for (const b of world.bodies) disposeBody(b);
  world.bodies = buildScene(presetName).filter(b => b.name !== '_bc');
  world.time = 0;
  world.selected = null;
  setFollow(null); flight = null;
  ui.refresh();
}

function disposeBody(b) {
  if (b.mesh) {
    scene.remove(b.mesh);
    b.mesh.material.map?.dispose();
    b.mesh.material.bumpMap?.dispose();
    b.mesh.material.dispose();
  }
  if (b.ring) {
    scene.remove(b.ring);
    const disk = b.ring.children[0];
    disk.geometry.dispose(); disk.material.map?.dispose(); disk.material.dispose();
  }
  if (b.moons) for (const mo of b.moons) {
    scene.remove(mo.mesh);
    mo.mesh.material.map?.dispose();
    mo.mesh.material.bumpMap?.dispose();
    mo.mesh.material.dispose();
  }
  if (b.hitbox) b.hitbox.material.dispose();
  if (b.atmo) b.atmo.material.dispose();
  if (b.flares) for (const m of b.flares.children) {
    m.geometry.dispose(); m.material.dispose();
  }
  if (b.glow) scene.remove(b.glow);
  if (b.trailLine) { scene.remove(b.trailLine); b.trailLine.geometry.dispose(); }
}

// ---- meshes --------------------------------------------------------------
const sphereGeo = new THREE.SphereGeometry(1, 32, 24);

// Soft radial glow texture — a Sprite with no map is a hard square, which is
// why the star looked boxed. This fades alpha to 0 at the edge → round halo.
const glowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// A few looping prominence arcs off the star's surface. Built on a unit
// sphere (parented to the star mesh, so they scale & co-rotate with it).
// Subtle on purpose — small count, gentle pulse.
function makeFlares() {
  const group = new THREE.Group();
  const n = 3 + Math.floor(Math.random() * 2);          // 3–4
  for (let i = 0; i < n; i++) {
    const axis = new THREE.Vector3().randomDirection();
    let t = new THREE.Vector3(0, 1, 0).cross(axis);
    if (t.lengthSq() < 1e-4) t.set(1, 0, 0);
    t.normalize();
    const spread = 0.12 + Math.random() * 0.16;
    const f1 = axis.clone().addScaledVector(t, -spread).normalize();
    const f2 = axis.clone().addScaledVector(t, spread).normalize();
    const apexH = 1.25 + Math.random() * 0.55;
    const apex = axis.clone().multiplyScalar(apexH)
      .add(t.clone().multiplyScalar((Math.random() - 0.5) * 0.3));
    const curve = new THREE.QuadraticBezierCurve3(
      f1.multiplyScalar(0.98), apex, f2.multiplyScalar(0.98));
    const geo = new THREE.TubeGeometry(curve, 26,
      0.02 + Math.random() * 0.025, 6, false);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.07 + Math.random() * 0.05, 1, 0.6),
      transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.userData = { phase: Math.random() * 6.283,
                   speed: 0.5 + Math.random() * 0.9,
                   base: 0.30 + Math.random() * 0.30 };
    group.add(m);
  }
  return group;
}

// Star evolution by radius. The buttons multiply radius by 5 / 10, so anchor
// the giant thresholds to multiples of the Sun's ~7e5 km so one tap of 5×+ on
// the Sun lands exactly on red giant, one tap of 10×+ lands on dark red giant,
// and a follow-up tap pushes it past the core-collapse threshold.
const STAR_PHASE_GIANT_KM = 3.5e6;   // ~5× the Sun  → red giant
const STAR_PHASE_DARK_KM  = 7.0e6;   // ~10× the Sun → dark red giant
const SUPERNOVA_KM        = 2.5e7;   // ~35× the Sun → goes nova

// Glow + point-light tint per phase. 'normal' inherits the body's user-chosen
// hue so the colour picker still does something.
const STAR_PHASE_TINT = {
  giant:      { glow: 0xff5a28, light: 0xff6a3a, intensity: 1.6 },
  dark_giant: { glow: 0x8a1808, light: 0x6e1a10, intensity: 0.85 },
};

function starPhaseFor(b) {
  const km = dispKmOf(b);                     // follow the visible size
  if (km >= STAR_PHASE_DARK_KM)  return 'dark_giant';
  if (km >= STAR_PHASE_GIANT_KM) return 'giant';
  return 'normal';
}

// Rebuild texture + retint glow/light when the star crosses a phase boundary.
function updateStarPhase(b) {
  if (b.type !== 'star') return;
  const want = starPhaseFor(b);
  if (b.__starPhase === want) return;
  b.__starPhase = want;
  const tex = makeTextures(b);                  // styleFor now sees __starPhase
  b.mesh.material.map?.dispose();
  b.mesh.material.map = tex.map;
  b.mesh.material.needsUpdate = true;
  const t = STAR_PHASE_TINT[want];
  if (b.glow)  b.glow.material.color.setHex(t ? t.glow : b.color);
  if (b.light) {
    b.light.color.setHex(t ? t.light : 0xfff0d0);
    b.light.intensity = t ? t.intensity : 2.5;
  }
}

function animateFlares(tSec) {
  for (const b of world.bodies) {
    if (!b.flares || !b.flares.visible) continue;
    for (const m of b.flares.children) {
      const u = m.userData;
      // gentle breathing + occasional stronger eruption
      const pulse = 0.4 + 0.6 * Math.pow(
        Math.max(0, Math.sin(tSec * u.speed + u.phase)), 2);
      const erupt = Math.pow(
        Math.max(0, Math.sin(tSec * 0.13 + u.phase * 1.7)), 8) * 0.6;
      m.material.opacity = u.base * pulse + erupt;
      // uniform scale from the star centre → the arc rises/recedes a little
      m.scale.setScalar(1 + 0.05 * Math.sin(tSec * u.speed * 1.3 + u.phase)
                          + erupt * 0.35);
    }
  }
}

// Atmosphere "amount" ≈ real surface pressure as a proxy. 0 → no shell.
// [amount, tint]. Gas giants are mostly atmosphere; Mercury has none.
const ATMO = {
  Venus:   [1.00, 0xe6c87a],
  Earth:   [0.45, 0x6db3ff],
  Mars:    [0.08, 0xd9a07a],
  Jupiter: [0.85, 0xd9b48a],
  Saturn:  [0.75, 0xe3d6a8],
  Uranus:  [0.78, 0x9fe3e8],
  Neptune: [0.82, 0x5c7bff],
};
function atmoFor(b) {
  if (b.type !== 'planet') return null;
  if (ATMO[b.name]) return ATMO[b.name];
  if (b.name in { Mercury: 1 }) return null;
  const s = styleFor(b);                       // user-added bodies
  if (s === 'gas') return [0.7, b.color];
  if (s === 'rock') return [0.12, b.color];
  return null;
}

function buildAtmosphere(b) {
  const a = atmoFor(b);
  if (!a) return;
  const [amount, color] = a;
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, side: THREE.BackSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: Math.min(0.8, 0.12 + 0.6 * amount),
  });
  b.atmo = new THREE.Mesh(sphereGeo, mat);
  b.atmo.scale.setScalar(1.04 + 0.16 * amount);   // thicker air → bigger shell
  b.mesh.add(b.atmo);                              // tracks the planet's size
}

function ensureMesh(b) {
  if (b.mesh) return;
  const isStar = b.type === 'star';
  const tex = makeTextures(b);
  const mat = isStar
    ? new THREE.MeshBasicMaterial({ map: tex.map })
    : new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bump,
        bumpScale: 1.5, roughness: 0.92, metalness: 0.0 });
  b.mesh = new THREE.Mesh(sphereGeo, mat);
  b.mesh.userData.body = b;
  if (b.spin === undefined) b.spin = (isStar ? 0.6 : 4 + Math.random() * 8);
  scene.add(b.mesh);

  const ring = makeRingMesh(styleFor(b), b.id);
  if (ring) { b.ring = ring; scene.add(ring); }

  buildMoons(b);
  buildAtmosphere(b);

  // Invisible "click halo" — a larger transparent sphere that makes small
  // bodies easy to hit with the cursor. Carries a userData.body backref so
  // the raycaster resolves it to the actual body.
  const hitMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide });
  b.hitbox = new THREE.Mesh(sphereGeo, hitMat);
  b.hitbox.userData.body = b;
  b.mesh.add(b.hitbox);

  if (isStar) {
    const light = new THREE.PointLight(0xfff0d0, 2.5, 0, 0.0);
    b.light = light;
    b.mesh.add(light);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture, color: b.color, transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending });
    b.glow = new THREE.Sprite(glowMat);
    scene.add(b.glow);

    b.flares = makeFlares();
    b.mesh.add(b.flares);          // inherits star scale & rotation
  }
}

// Real radius (km) → scene units. Cube-root keeps the huge dynamic range
// viewable (Earth ≈ 2.5, Jupiter ≈ 5.6, Sun ≈ 12). Floor so a collapsed
// body is still a clickable dot rather than vanishing.
const kmToUnits = (km) => Math.cbrt(Math.max(1, km)) * 0.135;

// The *displayed* radius lags behind the real one so size edits ease in
// rather than snapping. `dispKm` chases `radiusKm`; everything visual (mesh
// scale, moons, and the star-phase / supernova thresholds) reads dispKm, so a
// growing star visibly swells, reddens, then bursts mid-grow.
const dispKmOf = (b) => b.dispKm ?? b.radiusKm ?? 1;

// Ease dispKm toward radiusKm in cube-root space, so the on-screen size grows
// at a steady visual rate regardless of how huge the jump is. ~0.7s to settle.
function easeRadius(b, dtReal) {
  if (b.dispKm === undefined) { b.dispKm = b.radiusKm; return; }
  if (b.dispKm === b.radiusKm) return;
  const ct = Math.cbrt(b.radiusKm), cd = Math.cbrt(b.dispKm);
  if (Math.abs(ct - cd) < 1e-3) { b.dispKm = b.radiusKm; return; }
  const k = 1 - Math.pow(0.02, dtReal);          // frame-rate independent
  const nd = cd + (ct - cd) * k;
  b.dispKm = nd * nd * nd;
}

function radiusOf(b) {
  return Math.max(0.6, kmToUnits(dispKmOf(b))) * (world.exaggerate ? 1 : 0.55);
}

// Build moon satellites for a planet. They are NOT N-body bodies (a moon's
// real orbit is days/0.002 AU — far below this year-scale integrator's
// resolution). Instead each rides a stable Kepler orbit around its parent's
// live position, sized with the same scale as planets so it stays small.
const MOON_K = 0.25 / Math.pow(384400, 1.5);     // → Moon period ≈ 0.25 yr
function buildMoons(b) {
  const list = MOONS[b.name];
  if (!list || b.type !== 'planet') return;
  const smas = list.map(m => Math.log(m[2]));
  const lo = Math.min(...smas), hi = Math.max(...smas);
  b.moons = list.map(([name, rKm, sma, tint], i) => {
    const mt = makeMoonTexture(name, tint, (b.id * 131 + i + 1) >>> 0);
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({
      map: mt.map, bumpMap: mt.bump, bumpScale: 0.6, roughness: 0.95 }));
    scene.add(mesh);
    return {
      mesh, name, rKm, sma,
      frac: hi > lo ? (Math.log(sma) - lo) / (hi - lo) : 0.5,
      period: MOON_K * Math.pow(sma, 1.5),
      phase: Math.random() * Math.PI * 2,
      incl: (Math.random() - 0.5) * 0.24,
    };
  });
}

function updateMoons(b) {
  if (!b.moons) return;
  const c = b.mesh.position;
  const pr = radiusOf(b);
  for (const mo of b.moons) {
    const R = pr * (1.9 + 4.0 * mo.frac);          // real relative spacing
    const a = mo.phase + (2 * Math.PI) * (world.time / mo.period);
    const ca = Math.cos(a), sa = Math.sin(a);
    mo.mesh.position.set(
      c.x + R * ca,
      c.y + R * sa * Math.sin(mo.incl),
      c.z + R * sa * Math.cos(mo.incl),
    );
    mo.mesh.scale.setScalar(
      Math.max(0.05, kmToUnits(mo.rKm)) * (world.exaggerate ? 1 : 0.55));
  }
}

function ensureGlow(b) {
  if (b.glow) return b.glow;
  const m = new THREE.SpriteMaterial({ map: glowTexture, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending });
  b.glow = new THREE.Sprite(m);
  scene.add(b.glow);
  return b.glow;
}

// Make the body LOOK like what it physically became.
function applyState(b, info) {
  const mat = b.mesh.material;
  const baseEmissive = b.type === 'star';
  if (info.accent === 'bh') {
    mat.color.set(0x000000);
    if (mat.emissive) mat.emissive.set(0x000000);
    const g = ensureGlow(b);
    g.material.color.set(0xff7a2a);          // accretion-like halo
    g.material.opacity = 1.0;
    b.glowScale = 3.2;
    if (b.light) {                            // a black hole shouldn't keep
      b.light.intensity = 0.15;               // lighting the system like a sun
      b.light.color.setHex(0xffa050);
    }
  } else if (info.accent === 'degenerate') {
    mat.color.set(0xffffff);
    if (mat.emissive) { mat.emissive.set(0xcfe0ff); mat.emissiveIntensity = 1.4; }
    const g = ensureGlow(b);
    g.material.color.set(0xdfe9ff); g.material.opacity = 0.8; b.glowScale = 3;
  } else if (info.accent === 'star') {
    mat.color.set(0xffffff);
    if (mat.emissive) { mat.emissive.set(0xffcaa0); mat.emissiveIntensity = 1.3; }
    const g = ensureGlow(b);
    g.material.color.set(0xffd27a); g.material.opacity = 0.9; b.glowScale = 4.5;
  } else {
    mat.color.set(0xffffff);
    if (mat.emissive && !baseEmissive) { mat.emissive.set(0x000000); mat.emissiveIntensity = 1; }
    if (b.glow && b.type !== 'star') {
      scene.remove(b.glow); b.glow.material.dispose(); b.glow = null;
    } else if (b.glow) { b.glow.material.color.set(b.color); b.glow.material.opacity = 0.9; b.glowScale = 4.5; }
  }
}

// ---- phase transitions: planet → star → supernova ----------------------
// Once a body's mass crosses the fusion threshold we mutate its `type` (so
// ensureMesh rebuilds it with star lighting/glow/flares), and past the
// core-collapse threshold we play a one-shot supernova and leave a neutron
// star remnant behind so anything orbiting it keeps its orbit.
const STAR_IGNITE_MSUN = 0.08;       // real fusion threshold

function disposePlanetVisuals(b) {
  // Tear down everything ensureMesh built, so it re-creates as a star next
  // frame. Keep the body's trail / id / pos so the transition is in-place.
  if (b.mesh) {
    scene.remove(b.mesh);
    b.mesh.material.map?.dispose();
    b.mesh.material.bumpMap?.dispose();
    b.mesh.material.dispose();
    b.mesh = null;
  }
  if (b.atmo) { b.atmo.material.dispose(); b.atmo = null; }
  if (b.ring) {
    scene.remove(b.ring);
    const disk = b.ring.children[0];
    disk.geometry.dispose(); disk.material.map?.dispose(); disk.material.dispose();
    b.ring = null;
  }
  if (b.moons) {
    for (const mo of b.moons) {
      scene.remove(mo.mesh);
      mo.mesh.material.map?.dispose();
      mo.mesh.material.bumpMap?.dispose();
      mo.mesh.material.dispose();
    }
    b.moons = null;
  }
  if (b.flares) {
    for (const m of b.flares.children) { m.geometry.dispose(); m.material.dispose(); }
    b.flares = null;
  }
  if (b.hitbox) { b.hitbox.material.dispose(); b.hitbox = null; }
  if (b.glow) { scene.remove(b.glow); b.glow.material.dispose(); b.glow = null; }
  b.__starPhase = undefined;
}

function promoteToStar(b) {
  b.type = 'star';
  disposePlanetVisuals(b);             // ensureMesh will rebuild as a star
}

const supernovae = [];
const SN_DURATION_MS = 10000;
const SN_PARTICLES = 1400;

function triggerSupernova(b) {
  b.__wentNova = true;
  const origin = b.mesh.position.clone();
  const baseR = radiusOf(b);

  // Bright initial flash — a swelling additive sprite. Reuses glowTexture so
  // the bloom edge is round, not square.
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xffffff, transparent: true, opacity: 1.0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flash.position.copy(origin);
  flash.scale.setScalar(baseR * 8);
  scene.add(flash);

  // Camera-facing shockwave ring. We re-billboard it each frame in update.
  const shock = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1.0, 80),
    new THREE.MeshBasicMaterial({
      color: 0xfff0c0, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
  shock.position.copy(origin);
  shock.scale.setScalar(baseR * 2);
  scene.add(shock);

  // Filamentary ejecta — cluster particles along ~12 random axes so the
  // cloud reads as streamers rather than a smooth puff (Cas-A-ish look).
  const FILAMENTS = 12;
  const filDirs = [];
  for (let f = 0; f < FILAMENTS; f++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    filDirs.push([s * Math.cos(t), u, s * Math.sin(t)]);
  }
  const palette = [
    [0.60, 0.32, 1.00],   // violet
    [1.00, 0.38, 0.85],   // magenta
    [0.40, 0.92, 1.00],   // cyan
    [1.00, 0.85, 0.45],   // gold
    [1.00, 0.98, 0.85],   // white-hot
    [1.00, 0.55, 0.35],   // ember
  ];
  const positions = new Float32Array(SN_PARTICLES * 3);
  const colors    = new Float32Array(SN_PARTICLES * 3);
  const vels      = new Float32Array(SN_PARTICLES * 3);
  for (let i = 0; i < SN_PARTICLES; i++) {
    // 70% along a filament with small scatter; 30% fully isotropic halo
    let dx, dy, dz;
    if (Math.random() < 0.7) {
      const f = filDirs[i % FILAMENTS];
      const sc = 0.18;
      dx = f[0] + (Math.random() - 0.5) * sc;
      dy = f[1] + (Math.random() - 0.5) * sc;
      dz = f[2] + (Math.random() - 0.5) * sc;
    } else {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      dx = s * Math.cos(t); dy = u; dz = s * Math.sin(t);
    }
    const inv = 1 / Math.hypot(dx, dy, dz);
    dx *= inv; dy *= inv; dz *= inv;
    // Wide speed spread → trailing filament look (slow inner, fast leading)
    const speed = baseR * (5 + Math.pow(Math.random(), 0.5) * 18);
    vels[i*3]     = dx * speed;
    vels[i*3 + 1] = dy * speed;
    vels[i*3 + 2] = dz * speed;
    positions[i*3]     = origin.x;
    positions[i*3 + 1] = origin.y;
    positions[i*3 + 2] = origin.z;
    const c = palette[Math.floor(Math.random() * palette.length)];
    colors[i*3] = c[0]; colors[i*3 + 1] = c[1]; colors[i*3 + 2] = c[2];
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pgeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(pgeo, new THREE.PointsMaterial({
    size: 7, vertexColors: true, transparent: true, opacity: 1.0,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  scene.add(points);

  // The progenitor is gone — completely dispersed. Anything that was
  // orbiting it loses its anchor and flies off on its last tangent.
  disposeBody(b);
  const idx = world.bodies.indexOf(b);
  if (idx >= 0) world.bodies.splice(idx, 1);
  if (world.selected === b) { world.selected = null; ui.refresh(); }

  supernovae.push({ flash, shock, points, vels, positions, t0: performance.now() });
  return true;                    // tell syncMeshes to skip this body
}

function updateSupernovae(dtReal) {
  for (let i = supernovae.length - 1; i >= 0; i--) {
    const sn = supernovae[i];
    const elapsed = performance.now() - sn.t0;
    const u = Math.min(1, elapsed / SN_DURATION_MS);

    // Flash: bright initial pop that fades over ~22% of the timeline
    sn.flash.scale.multiplyScalar(1 + dtReal * 1.8);
    sn.flash.material.opacity = Math.max(0, 1 - elapsed / (SN_DURATION_MS * 0.22));
    if (sn.flash.material.opacity <= 0 && sn.flash.parent) {
      scene.remove(sn.flash); sn.flash.material.dispose();
    }

    // Shockwave ring keeps growing and faces the camera so it stays visible
    sn.shock.scale.multiplyScalar(1 + dtReal * 0.85);
    sn.shock.lookAt(camera.position);
    sn.shock.material.opacity = Math.max(0, 0.85 * (1 - u));

    // Ejecta drift with mild drag — keeps the leading edge sharp
    const pos = sn.positions, v = sn.vels;
    const drag = Math.pow(0.85, dtReal);     // frame-rate independent decay
    for (let j = 0; j < SN_PARTICLES; j++) {
      pos[j*3]     += v[j*3]     * dtReal;
      pos[j*3 + 1] += v[j*3 + 1] * dtReal;
      pos[j*3 + 2] += v[j*3 + 2] * dtReal;
      v[j*3]     *= drag;
      v[j*3 + 1] *= drag;
      v[j*3 + 2] *= drag;
    }
    sn.points.geometry.attributes.position.needsUpdate = true;
    sn.points.material.opacity = u < 0.45 ? 1 : Math.max(0, (1 - u) / 0.55);

    if (u >= 1) {
      scene.remove(sn.shock);
      sn.shock.geometry.dispose(); sn.shock.material.dispose();
      scene.remove(sn.points);
      sn.points.geometry.dispose(); sn.points.material.dispose();
      if (sn.flash.parent) scene.remove(sn.flash);
      supernovae.splice(i, 1);
    }
  }
}

// ---- "Explode planet" button effect -------------------------------------
// Blow the crust off as tumbling shards and reveal a glowing molten core for
// exactly 0.97 s, then the debris keeps flying and fades out. Purely cosmetic
// — the body is removed from the sim the instant it's detonated.
const explosions = [];
const CORE_VISIBLE_MS  = 970;      // show the core for 0.97 s, as requested
const DEBRIS_DURATION_MS = 2600;   // shards keep flying a bit after that
const shardGeo = new THREE.IcosahedronGeometry(1, 0);   // shared faceted chunk

function triggerExplosion(b) {
  const origin = b.mesh.position.clone();
  const r = radiusOf(b);                    // displayed planet radius (units)
  const color = b.color;

  // Molten core — bright additive sphere + soft halo, revealed at the centre.
  const core = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
    color: 0xff5a1e, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  core.position.copy(origin);
  core.scale.setScalar(r * 0.6);
  scene.add(core);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xff8c3a, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  coreGlow.position.copy(origin);
  coreGlow.scale.setScalar(r * 2.4);
  scene.add(coreGlow);

  // Crust shards — tumbling chunks tinted to the planet, flung outward.
  const CHUNKS = 70;
  const chunks = [];
  for (let i = 0; i < CHUNKS; i++) {
    const dir = new THREE.Vector3().randomDirection();
    const mesh = new THREE.Mesh(shardGeo, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.25,
      roughness: 0.85, metalness: 0, transparent: true, opacity: 1 }));
    mesh.position.copy(origin).addScaledVector(dir, r * (0.5 + Math.random() * 0.5));
    mesh.scale.setScalar(r * (0.06 + Math.random() * 0.16));
    scene.add(mesh);
    chunks.push({
      mesh,
      vel: dir.clone().multiplyScalar(r * (3 + Math.random() * 9)),
      spin: new THREE.Vector3((Math.random() - 0.5) * 7,
                              (Math.random() - 0.5) * 7,
                              (Math.random() - 0.5) * 7),
    });
  }

  explosions.push({ core, coreGlow, chunks, coreGone: false, t0: performance.now() });

  // The planet is gone — remove from the sim so nothing keeps orbiting it.
  disposeBody(b);
  const idx = world.bodies.indexOf(b);
  if (idx >= 0) world.bodies.splice(idx, 1);
  if (world.selected === b) { world.selected = null; ui.refresh(); }
}

function freeCore(ex) {
  scene.remove(ex.core); ex.core.material.dispose();
  scene.remove(ex.coreGlow); ex.coreGlow.material.dispose();
  ex.coreGone = true;
}

function updateExplosions(dtReal) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    const elapsed = performance.now() - ex.t0;

    // Core stays for 0.97 s, dimming as it goes, then is freed.
    if (!ex.coreGone) {
      const cu = elapsed / CORE_VISIBLE_MS;
      if (cu >= 1) freeCore(ex);
      else {
        const op = 1 - cu * cu;                       // ease-out fade
        ex.core.material.opacity = op;
        ex.coreGlow.material.opacity = op * 0.95;
        ex.core.scale.setScalar(ex.core.scale.x * (1 + dtReal * 0.4));  // swell
      }
    }

    // Shards fly out, tumble, slow with drag, fade over the final stretch.
    const du = Math.min(1, elapsed / DEBRIS_DURATION_MS);
    const drag = Math.pow(0.45, dtReal);
    for (const c of ex.chunks) {
      c.mesh.position.addScaledVector(c.vel, dtReal);
      c.mesh.rotation.x += c.spin.x * dtReal;
      c.mesh.rotation.y += c.spin.y * dtReal;
      c.mesh.rotation.z += c.spin.z * dtReal;
      c.vel.multiplyScalar(drag);
      if (du > 0.55) c.mesh.material.opacity = Math.max(0, (1 - du) / 0.45);
    }

    if (elapsed >= DEBRIS_DURATION_MS) {
      if (!ex.coreGone) freeCore(ex);
      for (const c of ex.chunks) { scene.remove(c.mesh); c.mesh.material.dispose(); }
      explosions.splice(i, 1);
    }
  }
}

function checkPhaseTransition(b) {
  if (b.type === 'planet' && b.mass >= STAR_IGNITE_MSUN) {
    promoteToStar(b);
    return false;
  }
  if (b.type === 'star' && dispKmOf(b) >= SUPERNOVA_KM && !b.__wentNova && b.mesh) {
    return triggerSupernova(b);         // true → body removed, skip rendering
  }
  return false;
}

function syncMeshes(dtReal = 0) {
  // drop meshes for bodies removed by merges/deletion
  for (const obj of [...scene.children]) {
    const b = obj.userData && obj.userData.body;
    if (b && !world.bodies.includes(b)) disposeBody(b);
  }
  // snapshot the list because checkPhaseTransition may splice it (supernova)
  for (const b of [...world.bodies]) {
    easeRadius(b, dtReal);             // grow/shrink toward the new size first…
    if (checkPhaseTransition(b)) continue;   // …so phases fire as it visibly grows
    ensureMesh(b);
    const r = radiusOf(b);
    b.mesh.position.copy(b.pos).multiplyScalar(SCALE);
    b.mesh.scale.setScalar(r);
    b.mesh.rotation.y = world.time * (b.spin || 0);   // no mod → monotonic for follow-spin
    if (b.hitbox) b.hitbox.scale.setScalar(Math.max(1.5, 4 / r));
    const info = physicsOf(b);
    updateStarPhase(b);                       // handle red-giant flip first…
    applyState(b, info);                      // …then BH override can win
    if (b.flares) b.flares.visible = info.accent === 'star' || info.accent === 'normal';
    if (b.atmo) {
      // hide when collapsed, AND when the camera is *inside* the shell
      // (otherwise the back-side haze blankets the ground after landing).
      const shellR = r * b.atmo.scale.x;
      const inside = camera.position.distanceTo(b.mesh.position) < shellR * 0.98;
      b.atmo.visible = info.accent === 'normal' && !inside;
    }
    updateMoons(b);
    if (b.ring) {
      b.ring.position.copy(b.mesh.position);
      b.ring.scale.setScalar(r);
      b.ring.visible = info.accent === 'normal';   // gone if it collapsed
    }
    if (b.glow) {
      b.glow.position.copy(b.mesh.position);
      b.glow.scale.setScalar(r * (b.glowScale || 4.5));
    }
    updateTrail(b);
  }
}

function updateTrail(b) {
  if (!world.trails) {
    if (b.trailLine) { b.trailLine.visible = false; }
    return;
  }
  b.trail.push(b.pos.clone());
  if (b.trail.length > TRAIL_MAX) b.trail.shift();
  const pts = b.trail.map(p => p.clone().multiplyScalar(SCALE));
  if (!b.trailLine) {
    const g = new THREE.BufferGeometry();
    const m = new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.5 });
    b.trailLine = new THREE.Line(g, m);
    scene.add(b.trailLine);
  }
  b.trailLine.visible = true;
  b.trailLine.geometry.setFromPoints(pts);
}

// ---- picking & placement -------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let placing = null;               // {type, name, mass} when arming a new body

canvas.addEventListener('click', (e) => {
  if (controls.enabled) return;   // flying — ignore clicks
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const targets = [];
  for (const b of world.bodies) {
    if (b.mesh) targets.push(b.mesh);
    if (b.hitbox) targets.push(b.hitbox);
  }
  const hit = raycaster.intersectObjects(targets, false)[0];

  if (hit) {
    selectBody(hit.object.userData.body);
    return;
  }
  if (placing) { placeNewBody(); return; }
  setFollow(null); flight = null; camera.up.set(0, 1, 0);
  controls.lock();
});

// Hover label — raycast on mousemove and show the body's name near the
// cursor. Skipped while pointer-locked (flying) so it doesn't flicker.
const hoverEl = document.getElementById('hover');
canvas.addEventListener('mousemove', (e) => {
  if (controls.enabled || controls.rightDrag) { hoverEl.hidden = true; return; }
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const tg = [];
  for (const b of world.bodies) {
    if (b.mesh) tg.push(b.mesh);
    if (b.hitbox) tg.push(b.hitbox);
  }
  const hit = raycaster.intersectObjects(tg, false)[0];
  if (hit && hit.object.userData.body) {
    const b = hit.object.userData.body;
    // body colour → label theme; very dark bodies (black holes) get a
    // readable fallback so the border doesn't vanish.
    const c = b.color;
    const r = (c >> 16) & 255, g = (c >> 8) & 255, bl = c & 255;
    const tint = (r + g + bl) < 40 ? '#ff8a3a' : '#' + c.toString(16).padStart(6, '0');
    hoverEl.textContent = b.name;
    hoverEl.style.left = e.clientX + 'px';
    hoverEl.style.top  = e.clientY + 'px';
    hoverEl.style.color = tint;
    hoverEl.style.borderColor = tint;
    hoverEl.style.boxShadow = '0 0 10px ' + tint + '55';
    hoverEl.hidden = false;
    canvas.style.cursor = 'pointer';
  } else {
    hoverEl.hidden = true;
    canvas.style.cursor = '';
  }
});

function placeNewBody() {
  // intersect the click ray with the ecliptic plane (y = 0) so new bodies
  // share the orbital plane; fall back to a point in front of the camera.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) {
    raycaster.ray.at(3000, hit);
  }
  const posAU = hit.multiplyScalar(1 / SCALE);

  const center = heaviestNear(posAU);
  // Sagittarius A* preset: real mass + radius just inside the Schwarzschild
  // radius, so physicsOf classifies it as a black hole and applyState paints
  // it black with the accretion-glow halo we already use for collapsed bodies.
  const isSagA = placing.type === 'sagA';
  const b = makeBody({
    name: placing.name,
    type: isSagA ? 'star' : placing.type,
    mass: isSagA ? 4.15e6 : placing.mass,
    color: isSagA ? 0x000000
         : placing.type === 'star' ? 0xffd27a : 0x6fb0ff,
    pos: posAU, vel: new THREE.Vector3(),
    radiusKm: isSagA ? 1.1e7 : undefined,        // just inside R_Schwarzschild
  });
  if (center) b.vel.copy(circularOrbitVelocity(posAU, center, THREE));
  world.bodies.push(b);
  ui.refresh();                                  // dropdown picks up the new body
  selectBody(b);
  ui.armPlacing(false);
  placing = null;
}

function heaviestNear(posAU) {
  let best = null, bestM = 0;
  for (const b of world.bodies) {
    if (b.mass > bestM) { bestM = b.mass; best = b; }
  }
  return best;
}

// Camera follow: ride along with a body. We track its per-frame displacement
// and shift the camera by the same amount, so the planet stays put in view
// while you can still look around / fly relative to it.
let followTarget = null;
let followSurface = false;        // true when landed — also rotate with spin
let followPrevRotY = 0;
const followPrev = new THREE.Vector3();
const followTmp = new THREE.Vector3();
const SPIN_AXIS = new THREE.Vector3(0, 1, 0);

function setFollow(b, surface = false) {
  followTarget = b || null;
  followSurface = !!(b && surface);
  if (b && b.mesh) {
    followPrev.copy(b.mesh.position);
    followPrevRotY = b.mesh.rotation.y;
  }
}

function updateFollow() {
  if (!followTarget) return;
  if (!world.bodies.includes(followTarget)) { followTarget = null; return; }
  const p = followTarget.mesh.position;
  camera.position.add(followTmp.subVectors(p, followPrev));
  followPrev.copy(p);

  if (followSurface) {
    // Carry the camera with the planet's rotation, so a landing spot stays
    // glued to that *spot on the surface* rather than drifting as it spins.
    const rotY = followTarget.mesh.rotation.y;
    const dRot = rotY - followPrevRotY;
    followPrevRotY = rotY;
    if (dRot !== 0) {
      camera.position.sub(p).applyAxisAngle(SPIN_AXIS, dRot).add(p);
      camera.up.applyAxisAngle(SPIN_AXIS, dRot);
      const q = new THREE.Quaternion().setFromAxisAngle(SPIN_AXIS, dRot);
      camera.quaternion.premultiply(q);
      controls.euler.setFromQuaternion(camera.quaternion);
    }
  }
}

function selectBody(b) {
  world.selected = b;
  ui.showEditor(b);
  flyTo(b);                // smooth glide in, then follow on arrival
}

// Smooth camera flight to a body — eases in over ~1.1s, then hands off to
// the follow system. Cancelled if the user starts steering (keys / pointer
// lock), so you can always seize control mid-flight.
let flight = null;
const flightOff = new THREE.Vector3();
const flightTo  = new THREE.Vector3();
const FLY_MS = 1100;

function flyTo(b, opts) {
  if (!b || !b.mesh) return;
  setFollow(null);
  camera.up.set(0, 1, 0);                              // reset world-up
  const land = opts && opts.land;
  if (land) {
    // Land hugging the surface on the side currently facing the camera,
    // looking forward but tilted slightly down — feet on the ground, ground
    // visible in the foreground (not a flat-horizon stare).
    const normal = new THREE.Vector3()
      .subVectors(camera.position, b.mesh.position);
    if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
    normal.normalize();
    const r = radiusOf(b);
    flightOff.copy(normal).multiplyScalar(r * 1.005 + 0.15);   // ~ankle-deep
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const tangent = fwd.sub(normal.clone().multiplyScalar(fwd.dot(normal)));
    if (tangent.lengthSq() < 1e-4)
      tangent.set(1, 0, 0).sub(normal.clone().multiplyScalar(normal.x));
    tangent.normalize();
    flight = { body: b, from: camera.position.clone(),
               t0: performance.now(), land: true, normal, tangent,
               pitch: -0.22 };                                  // look ~13° down
  } else {
    const off = radiusOf(b) * 6 + 30;
    flightOff.set(off, off * 0.4, off);
    flight = { body: b, from: camera.position.clone(), t0: performance.now() };
  }
}

function updateFlight() {
  if (!flight) return;
  if (!world.bodies.includes(flight.body) ||
      controls.enabled || controls.keys.size > 0) { flight = null; return; }
  const u = Math.min(1, (performance.now() - flight.t0) / FLY_MS);
  const e = 1 - Math.pow(1 - u, 3);                    // easeOutCubic
  flightTo.copy(flight.body.mesh.position).add(flightOff);
  camera.position.lerpVectors(flight.from, flightTo, e);
  if (flight.land) {
    // look along the tangent, tilted slightly down so the ground fills the
    // bottom of the frame — the "standing on the planet" view.
    const c = Math.cos(flight.pitch), s = Math.sin(flight.pitch);
    const lookDir = flight.tangent.clone().multiplyScalar(c)
      .add(flight.normal.clone().multiplyScalar(s));
    camera.up.copy(flight.normal);
    camera.lookAt(camera.position.clone().add(lookDir.multiplyScalar(1000)));
  } else {
    camera.lookAt(flight.body.mesh.position);
  }
  controls.euler.setFromQuaternion(camera.quaternion);
  if (u >= 1) { setFollow(flight.body, flight.land); flight = null; }
}

function focusCamera(b) { flyTo(b); }                  // button → same glide
function landOn(b)     { flyTo(b, { land: true }); }

// ---- UI wiring -----------------------------------------------------------
const ui = setupUI(world, {
  load,
  startPlacing(spec) { placing = spec; },
  cancelPlacing() { placing = null; },
  focus(b) { focusCamera(b); },
  land(b)  { landOn(b); },
  goto(b)  { selectBody(b); },        // dropdown → select + smooth-fly-to
  explode(b) { triggerExplosion(b); },   // blow it apart + reveal the core
  deleteBody(b) {
    const i = world.bodies.indexOf(b);
    if (i >= 0) world.bodies.splice(i, 1);
    if (world.selected === b) world.selected = null;
    ui.refresh();
  },
  _speed: () => controls.speed,
  THREE,
});

load('solar');

// ---- main loop -----------------------------------------------------------
let stepOnce = false;
ui.onStepRequest(() => { stepOnce = true; });

let last = performance.now();
function frame(now) {
  const dtReal = Math.min((now - last) / 1000, 0.05);
  last = now;

  let simDt = 0;
  if (stepOnce) { simDt = world.rate === 0 ? 0.02 : Math.abs(world.rate) * 0.05 * Math.sign(world.rate || 1); stepOnce = false; }
  else if (!world.paused) simDt = world.rate * dtReal;

  if (simDt !== 0 && world.bodies.length) {
    const merges = step(world.bodies, simDt);
    world.time += simDt;
    for (const m of merges) {
      if (world.selected === m.removed) world.selected = m.kept;
    }
    if (merges.length) ui.refresh();
  }

  controls.update(dtReal);
  syncMeshes(dtReal);
  updateFlight();                // smooth glide to a clicked body
  updateFollow();                // …then ride along with it
  updateSupernovae(dtReal);      // expanding shells from any recent ★ deaths
  updateExplosions(dtReal);      // "Explode planet" debris + molten core
  animateFlares(now / 1000);     // wall-clock → flares pulse even when paused
  ui.tick();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
