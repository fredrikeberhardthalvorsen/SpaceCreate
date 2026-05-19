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
  setFollow(null);
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

  if (isStar) {
    const light = new THREE.PointLight(0xfff0d0, 2.5, 0, 0.0);
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
function radiusOf(b) {
  return Math.max(0.6, kmToUnits(b.radiusKm || 1)) * (world.exaggerate ? 1 : 0.55);
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

function syncMeshes() {
  // drop meshes for bodies removed by merges/deletion
  for (const obj of [...scene.children]) {
    const b = obj.userData && obj.userData.body;
    if (b && !world.bodies.includes(b)) disposeBody(b);
  }
  for (const b of world.bodies) {
    ensureMesh(b);
    const r = radiusOf(b);
    b.mesh.position.copy(b.pos).multiplyScalar(SCALE);
    b.mesh.scale.setScalar(r);
    b.mesh.rotation.y = (world.time * (b.spin || 0)) % (Math.PI * 2);
    const info = physicsOf(b);
    applyState(b, info);
    if (b.flares) b.flares.visible = info.accent === 'star' || info.accent === 'normal';
    if (b.atmo) b.atmo.visible = info.accent === 'normal';   // gone if collapsed
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

  const meshes = world.bodies.map(b => b.mesh).filter(Boolean);
  const hit = raycaster.intersectObjects(meshes, false)[0];

  if (hit) {
    selectBody(hit.object.userData.body);
    return;
  }
  if (placing) { placeNewBody(); return; }
  setFollow(null);                // empty space → release follow & fly free
  controls.lock();
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
  const b = makeBody({
    name: placing.name, type: placing.type, mass: placing.mass,
    color: placing.type === 'star' ? 0xffd27a : 0x6fb0ff,
    pos: posAU, vel: new THREE.Vector3(),
  });
  if (center) b.vel.copy(circularOrbitVelocity(posAU, center, THREE));
  world.bodies.push(b);
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
const followPrev = new THREE.Vector3();
const followTmp = new THREE.Vector3();

function setFollow(b) {
  followTarget = b || null;
  if (b && b.mesh) followPrev.copy(b.mesh.position);
}

function updateFollow() {
  if (!followTarget) return;
  if (!world.bodies.includes(followTarget)) { followTarget = null; return; }
  const p = followTarget.mesh.position;
  camera.position.add(followTmp.subVectors(p, followPrev));
  followPrev.copy(p);
}

function selectBody(b) {
  world.selected = b;
  ui.showEditor(b);
  focusCamera(b);          // snap to it…
  setFollow(b);            // …then follow it as it orbits
}

function focusCamera(b) {
  const target = b.mesh.position;
  const off = radiusOf(b) * 6 + 30;
  camera.position.set(target.x + off, target.y + off * 0.4, target.z + off);
  camera.lookAt(target);
  controls.euler.setFromQuaternion(camera.quaternion);
  setFollow(b);
}

// ---- UI wiring -----------------------------------------------------------
const ui = setupUI(world, {
  load,
  startPlacing(spec) { placing = spec; },
  cancelPlacing() { placing = null; },
  focus(b) { focusCamera(b); },
  deleteBody(b) {
    const i = world.bodies.indexOf(b);
    if (i >= 0) world.bodies.splice(i, 1);
    if (world.selected === b) world.selected = null;
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
  syncMeshes();
  updateFollow();                // ride along with the selected body
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
