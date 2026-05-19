// Real-world consequences of a body's mass + radius. Used both for the editor
// readout and to drive how an over-compressed body looks in the scene.

const G = 6.674e-11;              // m³ kg⁻¹ s⁻²
const C = 299792458;             // m/s
const M_SUN = 1.98847e30;        // kg
const M_EARTH = 5.972e24;        // kg
const R_EARTH_KM = 6371;
const G_EARTH = 9.80665;         // m/s²
export const AU_KM = 1.495978707e8;

// Mean density (kg/m³) used to pick a sensible default radius per body type.
const DEFAULT_DENSITY = { star: 1410, gas: 1300, rock: 5510 };

export function defaultRadiusKm(massSolar, type) {
  const rho = DEFAULT_DENSITY[type === 'star' ? 'star'
              : massSolar > 5e-5 ? 'gas' : 'rock'];
  const m = massSolar * M_SUN;
  const rM = Math.cbrt((3 * m) / (4 * Math.PI * rho));
  return rM / 1000;
}

// Everything derived from current mass (M☉) + radius (km).
export function physicsOf(b) {
  const m = b.mass * M_SUN;
  const rM = Math.max(1, (b.radiusKm || 1)) * 1000;
  const volume = (4 / 3) * Math.PI * rM ** 3;
  const density = m / volume;                       // kg/m³
  const gSurf = (G * m) / (rM * rM);                // m/s²
  const vEsc = Math.sqrt((2 * G * m) / rM);         // m/s
  const rSchwarzKm = (2 * G * m) / (C * C) / 1000;  // km

  let klass, accent, note;
  const dens_cc = density / 1000;                   // g/cm³

  if (b.radiusKm <= rSchwarzKm) {
    klass = '★ BLACK HOLE — collapsed inside its Schwarzschild radius';
    accent = 'bh';
    note = 'Its gravity at a distance is UNCHANGED (depends only on mass), so ' +
           'everything keeps orbiting it exactly as before — only the surface ' +
           'is gone.';
  } else if (dens_cc > 4e14) {
    klass = 'neutron-star density — would collapse further';
    accent = 'degenerate';
    note = 'Denser than an atomic nucleus. Nothing solid survives this.';
  } else if (dens_cc > 1e4) {
    klass = 'white-dwarf density — degenerate matter';
    accent = 'degenerate';
    note = 'Electron-degeneracy pressure territory; a teaspoon weighs tonnes.';
  } else if (m >= 0.08 * M_SUN) {
    klass = 'stellar mass — fusion ignites: this is a STAR';
    accent = 'star';
    note = 'Above ~0.08 M☉ the core fuses hydrogen — it shines on its own.';
  } else if (dens_cc < 0.05) {
    klass = 'puffball — too diffuse to hold together';
    accent = 'diffuse';
    note = 'Lighter than styrofoam overall; it would disperse, not stay a ball.';
  } else if (dens_cc < 0.3) {
    klass = 'gas giant';
    accent = 'normal';
    note = 'Low density, no solid surface — Jupiter-like.';
  } else if (dens_cc < 2) {
    klass = 'ice / water world';
    accent = 'normal';
    note = '';
  } else {
    klass = 'rocky / terrestrial';
    accent = 'normal';
    note = '';
  }

  const gE = gSurf / G_EARTH;
  let gravNote = '';
  if (gE > 50) gravNote = 'crushing surface gravity';
  else if (gE < 0.05) gravNote = 'almost no surface gravity';

  return {
    radiusEarth: b.radiusKm / R_EARTH_KM,
    densityCC: dens_cc,
    gravityG: gE,
    escapeKmS: vEsc / 1000,
    schwarzKm: rSchwarzKm,
    klass, accent, note, gravNote,
  };
}

// Human-friendly number with units.
export function fmtSci(n, unit, dp = 2) {
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-2 || a >= 1e5)) return n.toExponential(dp) + ' ' + unit;
  return (a < 10 ? n.toFixed(dp) : Math.round(n).toLocaleString()) + ' ' + unit;
}
