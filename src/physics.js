// N-body gravity in astronomical units.
//   distance : AU
//   mass     : solar masses (M☉)
//   time     : years
//   velocity : AU / year
// With these units the gravitational constant is exactly G = 4π²,
// so Earth (1 AU, circular) orbits the Sun (1 M☉) once per year at v = 2π.

import { defaultRadiusKm, AU_KM } from './bodyinfo.js';

export const G = 4 * Math.PI * Math.PI;

// Softening length (AU). Stops accelerations exploding to infinity when two
// bodies pass arbitrarily close — keeps the integrator stable.
const SOFTENING2 = 1e-6;

let _id = 1;

export function makeBody({ name, mass, type = 'planet', color = 0xffffff,
                            pos, vel, radiusKm }) {
  return {
    id: _id++,
    name,
    type,                 // 'star' | 'planet'
    mass,                 // M☉
    color,
    pos: pos.clone(),     // THREE.Vector3, AU
    vel: vel.clone(),     // THREE.Vector3, AU/yr
    acc: { x: 0, y: 0, z: 0 },
    radiusKm: radiusKm ?? defaultRadiusKm(mass, type),  // real radius (km)
    trail: [],            // recent THREE.Vector3 positions (AU)
    mesh: null,
    glow: null,
    trailLine: null,
  };
}

// Merge/collision cross-section (AU): the body's REAL radius, with a small
// floor so encounters still resolve at this toy's scaled distances (without
// it, bodies would numerically tunnel through each other between substeps).
// Bloat a planet → bigger target; shrink to a black hole → only the small
// floor "capture radius" remains, so it mostly just slingshots things.
function collisionRadius(b) {
  return Math.max(0.01, (b.radiusKm || 1) / AU_KM);
}

function computeAccelerations(bodies) {
  for (const b of bodies) { b.acc.x = b.acc.y = b.acc.z = 0; }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dz = b.pos.z - a.pos.z;
      const r2 = dx * dx + dy * dy + dz * dz + SOFTENING2;
      const invR3 = 1 / (r2 * Math.sqrt(r2));
      const s = G * invR3;
      a.acc.x += s * b.mass * dx;
      a.acc.y += s * b.mass * dy;
      a.acc.z += s * b.mass * dz;
      b.acc.x -= s * a.mass * dx;
      b.acc.y -= s * a.mass * dy;
      b.acc.z -= s * a.mass * dz;
    }
  }
}

// One velocity-Verlet (leapfrog) step over dt years, split into substeps so
// large time-rates stay accurate. Returns list of merge events for the UI.
export function step(bodies, dt, substeps = 8) {
  const merges = [];
  if (bodies.length === 0) return merges;
  const h = dt / substeps;

  for (let s = 0; s < substeps; s++) {
    computeAccelerations(bodies);
    for (const b of bodies) {
      b.vel.x += 0.5 * h * b.acc.x;
      b.vel.y += 0.5 * h * b.acc.y;
      b.vel.z += 0.5 * h * b.acc.z;
      b.pos.x += h * b.vel.x;
      b.pos.y += h * b.vel.y;
      b.pos.z += h * b.vel.z;
    }
    computeAccelerations(bodies);
    for (const b of bodies) {
      b.vel.x += 0.5 * h * b.acc.x;
      b.vel.y += 0.5 * h * b.acc.y;
      b.vel.z += 0.5 * h * b.acc.z;
    }
    const m = resolveCollisions(bodies);
    if (m.length) merges.push(...m);
  }
  return merges;
}

// Inelastic merge: when two bodies overlap, the heavier absorbs the lighter,
// conserving total momentum (the chaotic Universe-Sandbox-style behaviour).
function resolveCollisions(bodies) {
  const merges = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const rsum = collisionRadius(a) + collisionRadius(b);
      if (a.pos.distanceToSquared(b.pos) > rsum * rsum) continue;

      const big = a.mass >= b.mass ? a : b;
      const small = big === a ? b : a;
      const M = a.mass + b.mass;
      big.vel.set(
        (a.mass * a.vel.x + b.mass * b.vel.x) / M,
        (a.mass * a.vel.y + b.mass * b.vel.y) / M,
        (a.mass * a.vel.z + b.mass * b.vel.z) / M,
      );
      big.pos.set(
        (a.mass * a.pos.x + b.mass * b.pos.x) / M,
        (a.mass * a.pos.y + b.mass * b.pos.y) / M,
        (a.mass * a.pos.z + b.mass * b.pos.z) / M,
      );
      big.mass = M;
      // volumes add → combined radius (keeps the merged body's real density)
      big.radiusKm = Math.cbrt((a.radiusKm ** 3) + (b.radiusKm ** 3));
      merges.push({ kept: big, removed: small });
      bodies.splice(bodies.indexOf(small), 1);
      return merges.concat(resolveCollisions(bodies));
    }
  }
  return merges;
}

// Circular-orbit velocity for a body at `pos` around a dominant `center`.
export function circularOrbitVelocity(pos, center, THREE) {
  const r = new THREE.Vector3().subVectors(pos, center.pos);
  const dist = r.length();
  if (dist < 1e-6) return new THREE.Vector3();
  const speed = Math.sqrt(G * center.mass / dist);
  // Velocity perpendicular to r, in a plane tilted toward the ecliptic (XZ).
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3().crossVectors(up, r).normalize();
  if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
  return dir.multiplyScalar(speed).add(center.vel);
}
