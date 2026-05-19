import * as THREE from 'three';

// Free 6-DOF "spaceship" camera: pointer-lock mouse look + WASD/QE thrust,
// shift to boost, wheel to change cruise speed. No up-vector lock so you can
// roll over and fly in any direction — the SpaceEngine-style free roam.
export class FlyControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = false;
    this.speed = 120;            // scene units / second
    this.keys = new Set();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      this.euler.setFromQuaternion(camera.quaternion);
      this.euler.y -= e.movementX * 0.0022;
      this.euler.x -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.01;
      this.euler.x = Math.max(-lim, Math.min(lim, this.euler.x));
      camera.quaternion.setFromEuler(this.euler);
    };
    this._onKeyDown = (e) => this.keys.add(e.code);
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onWheel = (e) => {
      const f = Math.exp(-e.deltaY * 0.0012);
      this.speed = Math.max(2, Math.min(120000, this.speed * f));
    };
    this._onLockChange = () => {
      this.enabled = document.pointerLockElement === this.dom;
    };

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.dom.addEventListener('wheel', this._onWheel, { passive: true });
  }

  lock() { this.dom.requestPointerLock(); }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 6 : 1;
    const d = this.speed * boost * dt;
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();

    if (k.has('KeyW')) cam.position.addScaledVector(fwd, d);
    if (k.has('KeyS')) cam.position.addScaledVector(fwd, -d);
    if (k.has('KeyD')) cam.position.addScaledVector(right, d);
    if (k.has('KeyA')) cam.position.addScaledVector(right, -d);
    if (k.has('KeyE')) cam.position.y += d;
    if (k.has('KeyQ')) cam.position.y -= d;
  }
}
