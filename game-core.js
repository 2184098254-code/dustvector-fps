/* DUSTVECTOR simulation. No DOM or graphics dependencies; shared by the browser and mechanics tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DustvectorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const COLLIDERS = [
    { x: -25, y: 4, z: 0, w: 2, h: 8, d: 52 },
    { x: 25, y: 4, z: 0, w: 2, h: 8, d: 52 },
    { x: 0, y: 4, z: -25, w: 52, h: 8, d: 2 },
    { x: 0, y: 3, z: 25, w: 52, h: 6, d: 2 },
    { x: 0, y: 4.6, z: -7, w: 5, h: 9.2, d: 5 },
    { x: -19.5, y: 3.8, z: -5, w: 7, h: 7.6, d: 15 },
    { x: 17, y: 4.5, z: -17, w: 10, h: 9, d: 10 },
    { x: -7, y: .9, z: 6, w: 3.5, h: 1.8, d: 2.6 },
    { x: 7, y: .9, z: 6, w: 3.5, h: 1.8, d: 2.6 },
    { x: -10, y: 1.7, z: -12, w: 4, h: 3.4, d: 5 },
    { x: 11, y: 1.15, z: -3, w: 3.6, h: 2.3, d: 3.2 },
    { x: -14, y: .7, z: 16, w: 3.6, h: 1.4, d: 3 },
    { x: 15, y: 1.25, z: 15, w: 4, h: 2.5, d: 3.8 },
    { x: 3, y: .65, z: -18, w: 4, h: 1.3, d: 2 },
  ];
  function rayBox(origin, dir, box) {
    let lo = 0, hi = Infinity;
    for (const [axis, size] of [['x', 'w'], ['y', 'h'], ['z', 'd']]) {
      const min = box[axis] - box[size] * .5, max = box[axis] + box[size] * .5;
      if (Math.abs(dir[axis]) < 1e-8) {
        if (origin[axis] < min || origin[axis] > max) return Infinity;
      } else {
        let a = (min - origin[axis]) / dir[axis], b = (max - origin[axis]) / dir[axis];
        if (a > b) [a, b] = [b, a];
        lo = Math.max(lo, a); hi = Math.min(hi, b);
        if (lo > hi) return Infinity;
      }
    }
    return hi >= 0 ? lo : Infinity;
  }
  function raySphere(origin, dir, center, radius) {
    const x = origin.x - center.x, y = origin.y - center.y, z = origin.z - center.z;
    const b = x * dir.x + y * dir.y + z * dir.z;
    const c = x * x + y * y + z * z - radius * radius, disc = b * b - c;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : c <= 0 ? 0 : Infinity;
  }
  function wallDistance(origin, dir) {
    let nearest = Infinity;
    for (const box of COLLIDERS) nearest = Math.min(nearest, rayBox(origin, dir, box));
    return nearest;
  }
  function occupied(x, z, radius = .4, y = 1) {
    return COLLIDERS.some(b => y < b.y + b.h / 2 && y > b.y - b.h / 2 &&
      x + radius > b.x - b.w / 2 && x - radius < b.x + b.w / 2 &&
      z + radius > b.z - b.d / 2 && z - radius < b.z + b.d / 2);
  }
  function move(body, dx, dz, radius, y) {
    // Substeps prevent sprinting through thin cover at a low frame rate.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .2));
    for (let i = 0; i < steps; i++) {
      if (!occupied(body.x + dx / steps, body.z, radius, y)) body.x += dx / steps;
      if (!occupied(body.x, body.z + dz / steps, radius, y)) body.z += dz / steps;
    }
  }
  function seededRandom(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const SPAWNS = [[-9, -18], [7, -15], [-18, 10], [18, 4], [-6, -17], [9, -11], [-12, 0], [18, 19], [-20, 20]];
  class Game {
    constructor(seed = Date.now()) { this.random = seededRandom(seed); this.events = []; this.state = 'menu'; this.reset(); }
    reset(hard = false) {
      this.hard = hard; this.player = { x: 0, y: 1.65, z: 18, yaw: 0, pitch: 0, hp: 100 };
      this.ammo = 24; this.reserve = 120; this.reloadTime = 0; this.fireCooldown = 0;
      this.wave = 0; this.waveDelay = 0; this.time = 0; this.score = 0; this.kills = 0; this.shots = 0; this.hits = 0;
      this.enemies = []; this.projectiles = []; this.events = []; this.nextId = 5; this.damageGrace = 0;
      this.pickups = [
        {id:1,x:-11,y:.45,z:12,kind:'health'},{id:2,x:10,y:.45,z:13,kind:'ammo'},
        {id:3,x:-6,y:.45,z:-14,kind:'ammo'},{id:4,x:10,y:.45,z:-20,kind:'health'}
      ];
    }
    start(hard = false) { this.reset(hard); this.state = 'playing'; this.spawnWave(); }
    emit(type, data = {}) { this.events.push({ type, ...data }); }
    drainEvents() { const out = this.events; this.events = []; return out; }
    spawnWave() {
      this.wave++; this.waveDelay = 0;
      const count = 2 + this.wave * 2 + (this.hard ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const spawn = SPAWNS[(i + (this.wave - 1) * 2) % SPAWNS.length];
        let x = spawn[0] + (this.random() - .5) * 1.8, z = spawn[1] + (this.random() - .5) * 1.8;
        if (occupied(x, z, .8, 2)) { x = spawn[0]; z = spawn[1]; }
        this.enemies.push({ id: this.nextId++, x, y: 2.05 + this.random() * .6, z, hp: this.hard ? 80 : 64,
          phase: this.random() * TAU, cooldown: 2 + this.random() * 2, flash: 0, turn: this.random() > .5 ? 1 : -1 });
      }
      this.emit('wave', { wave: this.wave, count });
    }
    reload() {
      if (this.state !== 'playing' || this.reloadTime > 0 || this.ammo === 24) return false;
      if (this.reserve <= 0) { this.emit('noReserve'); return false; }
      this.reloadTime = 1.65; this.emit('reload'); return true;
    }
    shoot() {
      if (this.state !== 'playing' || this.fireCooldown > 0 || this.reloadTime > 0) return false;
      if (this.ammo <= 0) { this.reload(); return false; }
      this.ammo--; this.shots++; this.fireCooldown = .115;
      const p = this.player, cp = Math.cos(p.pitch);
      const dir = { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp };
      const wall = wallDistance(p, dir);
      let closest = null, t = Math.min(wall, 75);
      for (const e of this.enemies) {
        const hit = raySphere(p, dir, e, .88);
        if (hit < t) { t = hit; closest = e; }
      }
      const end = { x: p.x + dir.x * t, y: p.y + dir.y * t, z: p.z + dir.z * t };
      this.emit('shot', { end, hit: !!closest });
      if (closest) {
        this.hits++; closest.hp -= 34; closest.flash = .13;
        this.emit('hit', { enemy: closest });
        if (closest.hp <= 0) this.killEnemy(closest);
      } else if (wall < 75) this.emit('impact', { ...end });
      if (this.ammo === 0 && this.reserve > 0) this.reload();
      return true;
    }
    killEnemy(e) {
      const index = this.enemies.indexOf(e); if (index < 0) return;
      this.enemies.splice(index, 1); this.kills++; this.score += this.hard ? 150 : 100;
      this.emit('kill', { ...e });
      if (this.kills % 3 === 0) this.pickups.push({ id: this.nextId++, x: e.x, y: .45, z: e.z, kind: this.kills % 6 === 0 ? 'health' : 'ammo' });
      if (this.enemies.length === 0) {
        this.projectiles = [];
        if (this.wave === 3) { this.score += Math.round(this.player.hp * 5 + Math.max(0, 360 - this.time) * 2); this.state = 'won'; this.emit('won'); }
        else { this.waveDelay = 4.5; this.player.hp = Math.min(100, this.player.hp + 20); this.reserve += 48; this.emit('waveClear', { wave: this.wave }); }
      }
    }
    damage(amount) {
      if (this.state !== 'playing' || this.damageGrace > 0) return;
      this.player.hp = Math.max(0, this.player.hp - amount); this.damageGrace = .18; this.emit('damage', { amount });
      if (this.player.hp <= 0) { this.state = 'lost'; this.emit('lost'); }
    }
    update(dt, input = {}) {
      if (this.state !== 'playing') return;
      dt = clamp(dt, 0, .05); this.time += dt;
      this.fireCooldown = Math.max(0, this.fireCooldown - dt); this.damageGrace = Math.max(0, this.damageGrace - dt);
      if (this.reloadTime > 0) {
        this.reloadTime = Math.max(0, this.reloadTime - dt);
        if (this.reloadTime === 0) { const add = Math.min(24 - this.ammo, this.reserve); this.ammo += add; this.reserve -= add; this.emit('reloaded'); }
      }
      const p = this.player;
      p.yaw += (input.turn || 0) * dt * 1.9;
      p.pitch = clamp(p.pitch + (input.look || 0) * dt * 1.3, -1.18, 1.18);
      let forward = input.forward || 0, strafe = input.strafe || 0;
      const norm = Math.hypot(forward, strafe); if (norm > 1) { forward /= norm; strafe /= norm; }
      const speed = (input.sprint && this.reloadTime === 0 ? 7 : 4.5) * dt;
      move(p, (-Math.sin(p.yaw) * forward + Math.cos(p.yaw) * strafe) * speed,
        (-Math.cos(p.yaw) * forward - Math.sin(p.yaw) * strafe) * speed, .38, 1);
      if (input.fire) this.shoot();
      if (this.state !== 'playing') return;
      if (this.waveDelay > 0) {
        this.waveDelay -= dt;
        if (this.waveDelay <= 0) this.spawnWave();
      }
      for (const e of this.enemies) {
        e.flash = Math.max(0, e.flash - dt); e.phase += dt * 2;
        e.y = 2.25 + Math.sin(e.phase) * .24;
        const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
        const origin = { x: e.x, y: e.y, z: e.z }, target = { x: dx / d, y: (p.y - e.y) / d, z: dz / d };
        const len = Math.hypot(target.x, target.y, target.z); target.x /= len; target.y /= len; target.z /= len;
        const sight = wallDistance(origin, target) > Math.hypot(dx, p.y - e.y, dz);
        let mx = 0, mz = 0;
        if (d > 9 || !sight) { mx = dx / d; mz = dz / d; }
        else if (d < 5) { mx = -dx / d * .65; mz = -dz / d * .65; }
        else { mx = dz / d * .45 * e.turn; mz = -dx / d * .45 * e.turn; }
        const droneSpeed = (this.hard ? 2.15 : 1.55) + this.wave * .16;
        const before = { x: e.x, z: e.z };
        move(e, mx * dt * droneSpeed, mz * dt * droneSpeed, .7, 2);
        if (Math.hypot(e.x - before.x, e.z - before.z) < dt * .2 && (Math.abs(mx) + Math.abs(mz) > .2)) {
          move(e, -mz * e.turn * dt * droneSpeed, mx * e.turn * dt * droneSpeed, .7, 2);
          e.stuck = (e.stuck || 0) + dt;
          if (e.stuck > 1.5) { e.turn *= -1; e.stuck = 0; }
        } else e.stuck = 0;
        e.cooldown -= dt;
        if (sight && d < 26 && e.cooldown <= 0) {
          const variance = this.hard ? .025 : .065;
          const vx = target.x + (this.random() - .5) * variance, vz = target.z + (this.random() - .5) * variance;
          const speed = this.hard ? 13.5 : 10;
          this.projectiles.push({ x: e.x, y: e.y, z: e.z, vx: vx * speed, vy: target.y * speed, vz: vz * speed, life: 5 });
          e.cooldown = (this.hard ? 1.4 : 2.5) + this.random() * 1.1; this.emit('enemyShot', { x: e.x, z: e.z });
        }
      }
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const b = this.projectiles[i], speed = Math.hypot(b.vx, b.vy, b.vz), travel = speed * dt;
        const direction = { x: b.vx / speed, y: b.vy / speed, z: b.vz / speed };
        const wall = wallDistance(b, direction), hit = raySphere(b, direction, p, .48);
        b.life -= dt;
        if (hit <= travel && hit < wall) { this.damage(this.hard ? 14 : 9); this.projectiles.splice(i, 1); }
        else if (wall <= travel || b.life <= 0 || b.y < .1) { this.projectiles.splice(i, 1); }
        else { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; }
      }
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const item = this.pickups[i];
        if (distance(p, item) < 1.7 && (item.kind !== 'health' || p.hp < 100)) {
          if (item.kind === 'health') p.hp = Math.min(100, p.hp + 35);
          else this.reserve += 36;
          this.pickups.splice(i, 1); this.emit('pickup', { kind: item.kind });
        }
      }
      // Supplies are always available between waves, including after all dropped ammo was spent.
      if (this.ammo === 0 && this.reserve > 0 && this.reloadTime === 0) this.reload();
    }
  }
  return { Game, COLLIDERS, clamp, distance, rayBox, raySphere, wallDistance, occupied, move, seededRandom };
});
