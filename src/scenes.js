import * as THREE from 'three';
import { makeBody, circularOrbitVelocity } from './physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Real-ish solar system: semi-major axis (AU) and mass (M☉).
const PLANETS = [
  ['Mercury', 0.387, 1.65e-7, 0xb9b2a8, 1.4],
  ['Venus',   0.723, 2.45e-6, 0xe6c98a, 2.4],
  ['Earth',   1.000, 3.00e-6, 0x4f8fff, 2.6],
  ['Mars',    1.524, 3.21e-7, 0xd9694b, 1.9],
  ['Jupiter', 5.203, 9.54e-4, 0xd8b48a, 7.5],
  ['Saturn',  9.537, 2.86e-4, 0xe3d6a8, 6.5],
  ['Uranus', 19.190, 4.37e-5, 0x9fe3e8, 4.5],
  ['Neptune',30.070, 5.15e-5, 0x5c7bff, 4.4],
];

function sun() {
  return makeBody({ name: 'Sun', type: 'star', mass: 1, color: 0xffe28a,
    pos: V(0, 0, 0), vel: V(0, 0, 0), displayRadius: 12 });
}

export function buildScene(name) {
  if (name === 'empty') return [];

  if (name === 'solar') {
    const star = sun();
    const bodies = [star];
    for (const [pn, a, m, c, r] of PLANETS) {
      const angle = Math.random() * Math.PI * 2;
      const pos = V(Math.cos(angle) * a, 0, Math.sin(angle) * a);
      const body = makeBody({ name: pn, type: 'planet', mass: m, color: c,
        pos, vel: V(0, 0, 0), displayRadius: r });
      body.vel.copy(circularOrbitVelocity(pos, star, THREE));
      bodies.push(body);
    }
    return bodies;
  }

  if (name === 'binary') {
    // Two stars orbiting their common centre of mass, with circumbinary planets.
    const sep = 4, m1 = 1.0, m2 = 0.7, M = m1 + m2;
    const r1 = sep * m2 / M, r2 = sep * m1 / M;
    const vrel = Math.sqrt((4 * Math.PI * Math.PI) * M / sep);
    const aStar = makeBody({ name: 'Alpha', type: 'star', mass: m1, color: 0xffd27a,
      pos: V(-r1, 0, 0), vel: V(0, 0, -vrel * m2 / M), displayRadius: 11 });
    const bStar = makeBody({ name: 'Beta', type: 'star', mass: m2, color: 0xff9a6a,
      pos: V(r2, 0, 0), vel: V(0, 0, vrel * m1 / M), displayRadius: 9 });
    const bodies = [aStar, bStar];
    const barycentre = makeBody({ name: '_bc', type: 'star', mass: M,
      pos: V(0, 0, 0), vel: V(0, 0, 0) });
    for (let i = 0; i < 3; i++) {
      const a = 14 + i * 9;
      const pos = V(Math.cos(i) * a, 0, Math.sin(i) * a);
      const p = makeBody({ name: 'Planet ' + (i + 1), type: 'planet',
        mass: 5e-5, color: 0x88c0ff, pos, vel: V(0, 0, 0), displayRadius: 3 });
      p.vel.copy(circularOrbitVelocity(pos, barycentre, THREE));
      bodies.push(p);
    }
    return bodies;
  }

  if (name === 'chaos') {
    // A heavy star plus a cloud of randomly flung bodies — expect collisions.
    const bodies = [sun()];
    bodies[0].mass = 2;
    for (let i = 0; i < 16; i++) {
      const a = 3 + Math.random() * 22;
      const ang = Math.random() * Math.PI * 2;
      const pos = V(Math.cos(ang) * a, (Math.random() - 0.5) * 6, Math.sin(ang) * a);
      const base = circularOrbitVelocity(pos, bodies[0], THREE);
      base.multiplyScalar(0.5 + Math.random() * 0.9);   // perturb → chaos
      bodies.push(makeBody({
        name: 'Body ' + (i + 1), type: 'planet',
        mass: 1e-5 + Math.random() * 4e-4,
        color: new THREE.Color().setHSL(Math.random(), 0.6, 0.6).getHex(),
        pos, vel: base, displayRadius: 2 + Math.random() * 3,
      }));
    }
    return bodies;
  }

  return buildScene('solar');
}
