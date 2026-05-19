# SpaceCreate

A browser space sandbox: real **N-body gravity** (like Universe Sandbox) with
**free 6-DOF flight** through a solar system and a distant starfield (like
SpaceEngine). Three.js, no build step, no npm install.

## Run

```
node server.mjs
```

Then open **http://localhost:5173** in Chrome.

(Modules + import maps need HTTP — opening `index.html` directly won't work.)

## Controls

| Action | Key |
|---|---|
| Capture mouse / start flying | click empty space in the scene |
| Look around | mouse |
| Move | `W` `A` `S` `D` |
| Down / up | `Q` / `E` |
| Boost ×6 | `Shift` |
| Change cruise speed | mouse wheel |
| Release mouse | `Esc` |
| Select & inspect a body | click it |

## Sandbox (right panel)

- **Time** — pause, single-step, reverse, and a rate slider (years/second).
  Trails and size-exaggeration toggles.
- **Scenes** — Solar system, Binary star, Random chaos, Empty.
- **Add body** — set type/name/mass, click *Place in orbit*, then click in the
  scene. It's dropped into a circular orbit around the heaviest body.
- **Selected** — rename, change mass / display radius / colour, scale velocity
  (slingshot or stop a body), focus the camera, or delete it.

Bodies that collide **merge**, conserving momentum — perturb an orbit enough and
systems destabilise, eject planets, or fall together.

## Units

Astronomical: distance in AU, mass in solar masses (M☉), time in years, so
G = 4π². Earth orbits the Sun once per simulated year. Velocity-Verlet
integrator with substepping and gravitational softening for stability.

## Files

- `index.html` / `src/style.css` — page & panel
- `src/physics.js` — N-body integrator, collisions, orbit helper
- `src/scenes.js` — preset systems
- `src/controls.js` — free-flight camera
- `src/main.js` — Three.js scene, rendering, picking, glue
- `src/ui.js` — control-panel logic
- `server.mjs` — static file server
