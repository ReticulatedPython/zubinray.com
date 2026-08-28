/* ============================================================
   entities.js — the things that exist in the world.  v0.3

   New this version:
   · Enemies roll a SIZE at spawn — big ones are slower, tougher
     and worth more. Reading silhouettes matters now.
   · Rocks are DESTRUCTIBLE: they have HP like the boss, crack
     visibly as they take fire, and burst when drilled through.
     Dodge them for free, or pay bullets to clear a path.
   · The Boss FIGHTS BACK: a charge-up telegraph (inner glow),
     then either a volley aimed at you or a downward fan. Red
     means dodge — same colour language as the sludge.
   · EnemyBullet: the boss's ammunition. Pooled like ours.
   ============================================================ */

"use strict";

const CHALK       = "#e9e5d8";
const CHALK_DIM   = "rgba(233,229,216,0.45)";
const CHALK_FAINT = "rgba(233,229,216,0.14)";
const CHALK_RED   = "#e8908f";

/* ---------------- Hero ---------------- */
class Hero {
  constructor() {
    this.x = GAME.W / 2;
    this.y = GAME.H - 110;
    this.r = 26;
    this.invuln = 0;
    this.fireCooldown = 0;
  }
  reset() { this.x = GAME.W / 2; this.invuln = 0; this.fireCooldown = 0; }

  update(dt) {
    this.x = clamp(this.x + Input.moveDelta(dt), 40, GAME.W - 40);
    if (this.invuln > 0) this.invuln -= dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
  }

  tryFire(bullets, interval, spread) {
    if (this.fireCooldown > 0) return;
    this.fireCooldown = interval;
    const y = this.y - 58;
    bullets.get().spawn(this.x, y, 0);
    if (spread) {
      bullets.get().spawn(this.x - 6, y, -170);
      bullets.get().spawn(this.x + 6, y, +170);
    }
  }

  hit() { this.invuln = 1.4; }

  draw(ctx) {
    if (this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0) return;
    const x = this.x, y = this.y;
    ctx.strokeStyle = CHALK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y - 44, 9, 0, Math.PI * 2);
    ctx.moveTo(x, y - 35); ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y - 6);  ctx.lineTo(x - 12, y + 22);
    ctx.moveTo(x, y - 6);  ctx.lineTo(x + 12, y + 22);
    ctx.moveTo(x, y - 28); ctx.lineTo(x - 14, y - 16);
    ctx.moveTo(x, y - 28); ctx.lineTo(x + 10, y - 40);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 40); ctx.lineTo(x + 10, y - 62);
    ctx.stroke();
  }
}

/* ---------------- Hero bullet ---------------- */
class Bullet {
  constructor() { this.active=false; this.x=0; this.y=0; this.vx=0; this.r=4; this.vy=-780; }
  spawn(x, y, vx) { this.x = x; this.y = y; this.vx = vx || 0; }
  update(dt) {
    this.y += this.vy * dt;
    this.x += this.vx * dt;
    if (this.y < -30 || this.x < -20 || this.x > GAME.W + 20) this.active = false;
  }
  draw(ctx) {
    ctx.strokeStyle = CHALK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx * 0.02, this.y + 16);
    ctx.stroke();
  }
}

/* ---------------- Enemy bullet (the boss's) ----------------
   Red chalk, travels in any direction. Touch = pain. */
class EnemyBullet {
  constructor() { this.active=false; this.x=0; this.y=0; this.vx=0; this.vy=300; this.r=6; }
  spawn(x, y, vx, vy) { this.x = x; this.y = y; this.vx = vx; this.vy = vy; }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y > GAME.H + 30 || this.y < -60 || this.x < -30 || this.x > GAME.W + 30) {
      this.active = false;
    }
  }
  draw(ctx) {
    ctx.strokeStyle = CHALK_RED;
    ctx.lineWidth = 5;
    const len = 0.045;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx * len, this.y - this.vy * len);
    ctx.stroke();
  }
}

/* ---------------- Enemies ----------------
   sizeMul rolled at spawn: small fry dart, giants lumber.
   Giants (≥ the bonus threshold) gain +1 HP and +50% score —
   a fat target that's worth focusing. */
const ENEMY_KINDS = {
  grunt: { r: 20, hp: 1, vy: 165, wobble: 26,  score: 10, sizeMin: 0.7,  sizeMax: 1.6  },
  zig:   { r: 23, hp: 2, vy: 145, wobble: 105, score: 25, sizeMin: 0.8,  sizeMax: 1.45 },
  tank:  { r: 36, hp: 5, vy: 78,  wobble: 5,   score: 60, sizeMin: 0.9,  sizeMax: 1.3  },
};
const SIZE_BONUS_AT = 1.3;   // this big or bigger => +1 HP, +50% score

class Enemy {
  constructor() {
    this.active=false; this.kind="grunt";
    this.x=0; this.y=0; this.r=20; this.vy=150;
    this.hp=1; this.maxHp=1; this.score=10;
    this.wobblePhase=0; this.wobbleAmp=0; this.flash=0;
  }
  spawn(kind, x, speedMul) {
    const k = ENEMY_KINDS[kind];
    this.kind = kind;
    const size = rand(k.sizeMin, k.sizeMax);
    this.x = x; this.y = -60;
    this.r = k.r * size;
    // big ones lumber, small ones dart
    this.vy = k.vy * speedMul * rand(0.9, 1.1) * (size >= 1.2 ? 0.82 : (size <= 0.85 ? 1.18 : 1));
    const bonus = size >= SIZE_BONUS_AT;
    this.hp = this.maxHp = k.hp + (bonus ? 1 : 0);
    this.score = Math.round(k.score * (bonus ? 1.5 : 1));
    this.wobblePhase = rand(0, Math.PI * 2);
    this.wobbleAmp = k.wobble * rand(0.8, 1.2);
    this.flash = 0;
  }
  update(dt) {
    this.y += this.vy * dt;
    this.wobblePhase += dt * (this.kind === "zig" ? 3.4 : 2.2);
    this.x += Math.sin(this.wobblePhase) * this.wobbleAmp * dt;
    this.x = clamp(this.x, this.r, GAME.W - this.r);
    if (this.flash > 0) this.flash -= dt;
    if (this.y > GAME.H + 80) this.active = false;
  }
  damage(n) {
    this.hp -= n;
    this.flash = 0.08;
    return this.hp <= 0;
  }
  draw(ctx) {
    const x=this.x, y=this.y, r=this.r;
    ctx.strokeStyle = this.flash > 0 ? "#ffffff" : CHALK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    const e = r * 0.32;
    if (this.kind === "grunt") {
      ctx.moveTo(x-e-4, y-e-4); ctx.lineTo(x-e+4, y-e+4);
      ctx.moveTo(x-e+4, y-e-4); ctx.lineTo(x-e-4, y-e+4);
      ctx.moveTo(x+e-4, y-e-4); ctx.lineTo(x+e+4, y-e+4);
      ctx.moveTo(x+e+4, y-e-4); ctx.lineTo(x+e-4, y-e+4);
      ctx.moveTo(x-e, y+r*0.4); ctx.lineTo(x+e, y+r*0.4);
    } else if (this.kind === "zig") {
      ctx.moveTo(x-e-5, y-e); ctx.lineTo(x-e+5, y-e+3);
      ctx.moveTo(x+e+5, y-e); ctx.lineTo(x+e-5, y-e+3);
      ctx.moveTo(x-e, y+r*0.35);
      ctx.lineTo(x-e/2, y+r*0.5); ctx.lineTo(x, y+r*0.35);
      ctx.lineTo(x+e/2, y+r*0.5); ctx.lineTo(x+e, y+r*0.35);
    } else {
      ctx.moveTo(x-r*0.6, y-r*0.7); ctx.lineTo(x-r*0.9, y-r*1.25);
      ctx.moveTo(x+r*0.6, y-r*0.7); ctx.lineTo(x+r*0.9, y-r*1.25);
      ctx.moveTo(x-e-6, y-e-2); ctx.lineTo(x-e+6, y-e+2);
      ctx.moveTo(x+e+6, y-e-2); ctx.lineTo(x+e-6, y-e+2);
      ctx.moveTo(x-e, y+r*0.4); ctx.lineTo(x+e, y+r*0.4);
    }
    ctx.stroke();

    if (this.maxHp > 1) {
      ctx.lineWidth = 3;
      ctx.beginPath();
      const w = 8, total = this.hp * w + (this.hp - 1) * 4;
      let px = x - total / 2;
      for (let i = 0; i < this.hp; i++) {
        ctx.moveTo(px, y + r + 10); ctx.lineTo(px + w, y + r + 10);
        px += w + 4;
      }
      ctx.stroke();
    }
  }
}

/* ---------------- Obstacle (rock) ----------------
   Now destructible: HP scales with size (~1 hit per 5px of
   radius). Cracks appear at 2/3 and 1/3 health, then it bursts
   for a small score. Still hurts on contact — the choice is
   yours: spend bullets to drill, or spend attention to dodge. */
class Obstacle {
  constructor() {
    this.active=false; this.x=0; this.y=0; this.r=34; this.vy=90;
    this.verts=[]; this.hp=6; this.maxHp=6; this.flash=0;
    this.crack1=[]; this.crack2=[];
  }
  spawn(x, speedMul, sizeMul) {
    const size = sizeMul || 1;
    this.x = x; this.y = -70;
    this.r = clamp(30 * size * rand(0.92, 1.08), 16, 58);
    this.vy = 90 * speedMul;
    this.hp = this.maxHp = Math.max(3, Math.round(this.r / 5));
    this.flash = 0;
    this.verts = [];
    const n = randInt(7, 10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = this.r * rand(0.72, 1.15);
      this.verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    // two pre-rolled crack paths, revealed as HP drops
    const crack = () => {
      const a = rand(0, Math.PI * 2);
      return [
        [Math.cos(a) * this.r * 0.8, Math.sin(a) * this.r * 0.8],
        [rand(-0.3, 0.3) * this.r,    rand(-0.3, 0.3) * this.r],
        [Math.cos(a + 2.5) * this.r * 0.7, Math.sin(a + 2.5) * this.r * 0.7],
      ];
    };
    this.crack1 = crack();
    this.crack2 = crack();
  }
  update(dt) {
    this.y += this.vy * dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.y > GAME.H + 80) this.active = false;
  }
  damage(n) {
    this.hp -= n;
    this.flash = 0.07;
    return this.hp <= 0;
  }
  draw(ctx) {
    ctx.strokeStyle = this.flash > 0 ? "#ffffff" : CHALK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.x + this.verts[0][0], this.y + this.verts[0][1]);
    for (let i = 1; i < this.verts.length; i++) {
      ctx.lineTo(this.x + this.verts[i][0], this.y + this.verts[i][1]);
    }
    ctx.closePath();
    ctx.stroke();

    const frac = this.hp / this.maxHp;
    const drawCrack = (c) => {
      ctx.beginPath();
      ctx.moveTo(this.x + c[0][0], this.y + c[0][1]);
      ctx.lineTo(this.x + c[1][0], this.y + c[1][1]);
      ctx.lineTo(this.x + c[2][0], this.y + c[2][1]);
      ctx.stroke();
    };
    ctx.lineWidth = 2;
    if (frac <= 0.67) drawCrack(this.crack1);
    if (frac <= 0.34) drawCrack(this.crack2);
  }
}

/* ---------------- Pickups ---------------- */
const PICKUP_KINDS = {
  rapid:  { label: "R",  good: true,  duration: 8 },
  spread: { label: "W",  good: true,  duration: 8 },
  heart:  { label: "+",  good: true,  duration: 0 },
  sludge: { label: "✕",  good: false, duration: 6 },
};

class Pickup {
  constructor() { this.active=false; this.kind="rapid"; this.x=0; this.y=0; this.r=20; this.vy=120; this.bob=0; }
  spawn(kind, x) { this.kind = kind; this.x = x; this.y = -40; this.bob = rand(0, Math.PI*2); }
  update(dt) {
    this.y += this.vy * dt;
    this.bob += dt * 4;
    if (this.y > GAME.H + 50) this.active = false;
  }
  draw(ctx) {
    const k = PICKUP_KINDS[this.kind];
    const x = this.x, y = this.y + Math.sin(this.bob) * 3;
    ctx.strokeStyle = k.good ? CHALK : CHALK_RED;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x - 16, y - 20, 32, 40, 14);
    ctx.stroke();
    ctx.fillStyle = k.good ? CHALK : CHALK_RED;
    ctx.font = '22px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.fillText(k.label, x, y + 8);
  }
}

/* ---------------- Boss ----------------
   The fight now has three verbs:
   · SWAY   — drifts across the top, body-blocking your lane.
   · COUGH  — spits a pair of grunts every few seconds.
   · SHOOT  — charges up (inner glow = the telegraph, ~0.45s),
              then fires: an AIMED volley at where you are, or a
              FAN you must find the gap in. Patterns alternate.
   All projectiles are red. Red = dodge. */
class Boss {
  constructor() {
    this.alive = false;
    this.x = GAME.W/2; this.y = -120; this.r = 70;
    this.hp = 0; this.maxHp = 0;
    this.t = 0; this.flash = 0;
    this.coughTimer = 5;
    this.gunTimer = 2.5; this.charge = 0; this.nextPattern = "aimed";
    this.speedMul = 1;
  }
  activate(hp, speedMul) {
    this.alive = true;
    this.hp = this.maxHp = hp;
    this.x = GAME.W/2; this.y = -120;
    this.t = 0; this.flash = 0;
    this.coughTimer = 5;
    this.gunTimer = 2.5; this.charge = 0; this.nextPattern = "aimed";
    this.speedMul = speedMul;
  }
  inPosition() { return this.y >= 195; }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    if (this.y < 200) this.y += 90 * dt;
    this.x = GAME.W/2 + Math.sin(this.t * 0.9) * 160;
    if (this.flash > 0) this.flash -= dt;

    if (!this.inPosition()) return;

    // cough up minions
    this.coughTimer -= dt;
    if (this.coughTimer <= 0) {
      this.coughTimer = 6;
      enemies.get().spawn("grunt", this.x - 60, this.speedMul);
      enemies.get().spawn("grunt", this.x + 60, this.speedMul);
    }

    // gun cycle: cooldown -> charge (telegraph) -> fire
    if (this.charge > 0) {
      this.charge -= dt;
      if (this.charge <= 0) this.fire();
    } else {
      this.gunTimer -= dt;
      if (this.gunTimer <= 0) {
        this.charge = 0.45;                       // glow first — fair warning
        this.gunTimer = Math.max(1.5, 2.6 / this.speedMul);
      }
    }
  }

  fire() {
    const sp = 300 * this.speedMul;
    const muzzleY = this.y + this.r * 0.7;
    if (this.nextPattern === "aimed") {
      // three shots converging on the hero's position
      const dx = hero.x - this.x, dy = hero.y - 40 - muzzleY;
      const base = Math.atan2(dy, dx);
      for (const off of [-0.16, 0, 0.16]) {
        enemyBullets.get().spawn(this.x, muzzleY,
          Math.cos(base + off) * sp, Math.sin(base + off) * sp);
      }
      this.nextPattern = "fan";
    } else {
      // five-shot downward fan — find the gap
      for (const off of [-0.55, -0.27, 0, 0.27, 0.55]) {
        const a = Math.PI / 2 + off;      // straight down ± spread
        enemyBullets.get().spawn(this.x, muzzleY,
          Math.cos(a) * sp * 0.9, Math.sin(a) * sp * 0.9);
      }
      this.nextPattern = "aimed";
    }
  }

  damage(n) {
    this.hp -= n;
    this.flash = 0.08;
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  }

  draw(ctx) {
    if (!this.alive) return;
    const x=this.x, y=this.y, r=this.r;

    // charge telegraph: a red glow swelling in its core
    if (this.charge > 0) {
      const g = 1 - this.charge / 0.45;
      ctx.strokeStyle = CHALK_RED;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.25 + 0.45 * g), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = this.flash > 0 ? "#ffffff" : CHALK;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      const a = -Math.PI/2 + i * 0.45;
      ctx.moveTo(x + Math.cos(a)*r, y + Math.sin(a)*r);
      ctx.lineTo(x + Math.cos(a)*r*1.35, y + Math.sin(a)*r*1.35);
    }
    const e = r * 0.3;
    ctx.moveTo(x-e-10, y-e-8); ctx.lineTo(x-e+10, y-e+4);
    ctx.moveTo(x+e+10, y-e-8); ctx.lineTo(x+e-10, y-e+4);
    ctx.moveTo(x-e, y+r*0.45);
    ctx.lineTo(x-e/2, y+r*0.3); ctx.lineTo(x, y+r*0.45);
    ctx.lineTo(x+e/2, y+r*0.3); ctx.lineTo(x+e, y+r*0.45);
    ctx.stroke();
  }
}

/* ---------------- Particle ---------------- */
class Particle {
  constructor() { this.active=false; this.x=0; this.y=0; this.vx=0; this.vy=0; this.life=0; this.red=false; }
  spawn(x, y, red) {
    this.x = x; this.y = y;
    const a = rand(0, Math.PI*2), sp = rand(120, 340);
    this.vx = Math.cos(a)*sp; this.vy = Math.sin(a)*sp;
    this.life = rand(0.25, 0.5);
    this.red = !!red;
  }
  update(dt) {
    this.x += this.vx*dt; this.y += this.vy*dt;
    this.life -= dt;
    if (this.life <= 0) this.active = false;
  }
  draw(ctx) {
    ctx.strokeStyle = this.red ? CHALK_RED : CHALK_DIM;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - this.vx*0.03, this.y - this.vy*0.03);
    ctx.stroke();
  }
}

function popAt(particles, x, y, red, count) {
  for (let i = 0; i < (count || 6); i++) particles.get().spawn(x, y, red);
}

/* ---------------- Drifting chalk dust ---------------- */
class Dust {
  constructor() {
    this.x = rand(0, GAME.W);
    this.y = rand(0, GAME.H);
    this.v = rand(40, 140);
    this.s = rand(1, 2.5);
  }
  update(dt, speedMul) {
    this.y += this.v * speedMul * dt;
    if (this.y > GAME.H) { this.y = -5; this.x = rand(0, GAME.W); }
  }
  draw(ctx) {
    ctx.fillStyle = CHALK_FAINT;
    ctx.fillRect(this.x, this.y, this.s, this.s * 3);
  }
}
