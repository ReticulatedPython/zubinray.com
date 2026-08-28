/* ============================================================
   main.js — wires everything into a game.  v0.3

   New since v0.2: the enemyBullets pool (the boss's ammunition),
   rocks take damage from your fire and burst for score, and the
   boss's surviving shots vanish when it dies — your kill, your
   moment, no cheap posthumous hits.
   ============================================================ */

"use strict";

/* ---------------- Shared game objects ---------------- */
const hero         = new Hero();
const boss         = new Boss();
const bullets      = new Pool(() => new Bullet(),      90);
const enemyBullets = new Pool(() => new EnemyBullet(), 40);
const enemies      = new Pool(() => new Enemy(),       60);
const obstacles    = new Pool(() => new Obstacle(),    16);
const pickups      = new Pool(() => new Pickup(),      12);
const particles    = new Pool(() => new Particle(),    160);
const dust         = Array.from({ length: 36 }, () => new Dust());

const MAX_LIVES = 4;
const ROCK_SCORE = 15;

const run = {
  score: 0,
  lives: 3,
  best: 0,
  bestLevel: 0,
};

/* ---------------- Power-up timers ---------------- */
const power = { rapid: 0, spread: 0, sludge: 0 };

function tickPower(dt) {
  for (const k in power) if (power[k] > 0) power[k] -= dt;
}

function fireParams() {
  let interval = 0.16;
  if (power.rapid  > 0) interval *= 0.55;
  if (power.sludge > 0) interval *= 1.9;
  return { interval, spread: power.spread > 0 };
}

function applyPickup(kind) {
  if (kind === "rapid")  power.rapid  = PICKUP_KINDS.rapid.duration;
  if (kind === "spread") power.spread = PICKUP_KINDS.spread.duration;
  if (kind === "sludge") power.sludge = PICKUP_KINDS.sludge.duration;
  if (kind === "heart")  run.lives = Math.min(MAX_LIVES, run.lives + 1);
}

/* ---------------- Screen shake ---------------- */
const shake = { t: 0, mag: 0 };
function addShake(mag, time) { shake.mag = Math.max(shake.mag, mag); shake.t = Math.max(shake.t, time); }

/* ---------------- Persistence ---------------- */
try {
  run.best = Number(localStorage.getItem("ss_best") || 0);
  run.bestLevel = Number(localStorage.getItem("ss_bestlvl") || 0);
} catch (e) {}

function savePersistent() {
  if (run.score > run.best) run.best = run.score;
  const reached = Stream.levelIndex + 1 + Stream.loop * LEVELS.length;
  if (reached > run.bestLevel) run.bestLevel = reached;
  try {
    localStorage.setItem("ss_best", String(run.best));
    localStorage.setItem("ss_bestlvl", String(run.bestLevel));
  } catch (e) {}
}

function resetRun() {
  run.score = 0;
  run.lives = 3;
  power.rapid = power.spread = power.sludge = 0;
  hero.reset();
  boss.alive = false;
  bullets.clear(); enemyBullets.clear(); enemies.clear();
  obstacles.clear(); pickups.clear(); particles.clear();
  Stream.loop = 0;
  Stream.load(0);
}

function clearField() {
  power.rapid = power.spread = power.sludge = 0;
  hero.reset();
  boss.alive = false;
  bullets.clear(); enemyBullets.clear(); enemies.clear();
  obstacles.clear(); pickups.clear(); particles.clear();
}

/* ---------------- Hero takes a hit ---------------- */
function hurtHero() {
  popAt(particles, hero.x, hero.y - 20, true, 8);
  hero.hit();
  addShake(10, 0.3);
  run.lives -= 1;
  if (run.lives <= 0) {
    savePersistent();
    Engine.setState("GAME_OVER");
  }
}

/* ---------------- Drawing helpers ---------------- */
function chalkText(ctx, text, x, y, size, align, dim) {
  ctx.fillStyle = dim ? "rgba(233,229,216,0.55)" : "#e9e5d8";
  ctx.font = `${size}px "Courier New", monospace`;
  ctx.textAlign = align || "center";
  ctx.fillText(text, x, y);
}

function drawLanes(ctx) {
  ctx.strokeStyle = "rgba(233,229,216,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of [120, 220, 320, 420]) {
    ctx.moveTo(x, 0); ctx.lineTo(x, GAME.H);
  }
  ctx.stroke();
}

function drawHUD(ctx) {
  chalkText(ctx, `SCORE ${run.score}`, 18, 40, 26, "left");
  chalkText(ctx, "♥".repeat(run.lives) + "♡".repeat(MAX_LIVES - run.lives), GAME.W - 18, 42, 26, "right");
  chalkText(ctx, Stream.levelName(), GAME.W / 2, 78, 16, "center", true);

  let py = 70;
  const tag = (label, t, red) => {
    ctx.fillStyle = red ? "#e8908f" : "rgba(233,229,216,0.8)";
    ctx.font = '16px "Courier New", monospace';
    ctx.textAlign = "left";
    ctx.fillText(`${label} ${Math.ceil(t)}`, 18, py);
    py += 22;
  };
  if (power.rapid  > 0) tag("RAPID",  power.rapid,  false);
  if (power.spread > 0) tag("SPREAD", power.spread, false);
  if (power.sludge > 0) tag("SLUDGE", power.sludge, true);

  if (boss.alive) {
    const w = 320, x = (GAME.W - w) / 2, y = 100;
    ctx.strokeStyle = "#e9e5d8";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, 12);
    ctx.fillStyle = "#e8908f";
    ctx.fillRect(x + 2, y + 2, (w - 4) * Math.max(0, boss.hp / boss.maxHp), 8);
  }
}

function drawWorld(ctx) {
  for (const d of dust) d.draw(ctx);
  drawLanes(ctx);
  particles.forEach((p) => p.draw(ctx));
  pickups.forEach((p) => p.draw(ctx));
  obstacles.forEach((o) => o.draw(ctx));
  bullets.forEach((b) => b.draw(ctx));
  enemyBullets.forEach((b) => b.draw(ctx));
  enemies.forEach((e) => e.draw(ctx));
  boss.draw(ctx);
  hero.draw(ctx);
}

/* ---------------- States ---------------- */
Engine.addState("TITLE", {
  enter() { resetRun(); },
  update(dt) {
    for (const d of dust) d.update(dt, 0.5);
    hero.update(dt);
    if (Input.tapped()) Engine.setState("PLAYING");
  },
  draw(ctx) {
    for (const d of dust) d.draw(ctx);
    chalkText(ctx, "STICK SHOOTER", GAME.W / 2, 300, 52);
    chalkText(ctx, "drag or use arrows to move", GAME.W / 2, 390, 22, "center", true);
    chalkText(ctx, "firing is automatic", GAME.W / 2, 425, 22, "center", true);
    chalkText(ctx, "white helps · red hurts", GAME.W / 2, 460, 22, "center", true);
    chalkText(ctx, "— tap to start —", GAME.W / 2, 560, 26);
    if (run.best > 0) chalkText(ctx, `best score ${run.best} · best level ${run.bestLevel}`, GAME.W / 2, 620, 20, "center", true);
    hero.draw(ctx);
  },
});

Engine.addState("PLAYING", {
  update(dt) {
    if (Input.pausePressed()) { Engine.setState("PAUSED"); return; }

    const mul = Stream.speedMul();
    for (const d of dust) d.update(dt, mul);

    Stream.update(dt);
    tickPower(dt);

    hero.update(dt);
    const fp = fireParams();
    hero.tryFire(bullets, fp.interval, fp.spread);

    bullets.forEach((b) => b.update(dt));
    enemyBullets.forEach((b) => b.update(dt));
    enemies.forEach((e) => e.update(dt));
    obstacles.forEach((o) => o.update(dt));
    pickups.forEach((p) => p.update(dt));
    particles.forEach((p) => p.update(dt));
    boss.update(dt);

    if (shake.t > 0) shake.t -= dt;

    /* ---- collisions ---- */

    // your bullets drill into rocks (and stop there)
    obstacles.forEach((o) => {
      bullets.forEach((b) => {
        if (b.active && o.active && circlesHit(b.x, b.y, b.r, o.x, o.y, o.r * 0.9)) {
          b.active = false;
          particles.get().spawn(b.x, b.y, false);
          if (o.damage(1)) {
            o.active = false;
            run.score += ROCK_SCORE;
            popAt(particles, o.x, o.y, false, 10);
            addShake(5, 0.15);
          }
        }
      });
      // rocks are cover: they soak the boss's shots too
      enemyBullets.forEach((b) => {
        if (b.active && o.active && circlesHit(b.x, b.y, b.r, o.x, o.y, o.r * 0.9)) {
          b.active = false;
          particles.get().spawn(b.x, b.y, true);
        }
      });
    });

    // bullets vs enemies
    enemies.forEach((e) => {
      bullets.forEach((b) => {
        if (b.active && e.active && circlesHit(b.x, b.y, b.r, e.x, e.y, e.r)) {
          b.active = false;
          if (e.damage(1)) {
            e.active = false;
            run.score += e.score;
            popAt(particles, e.x, e.y, false);
          }
        }
      });
    });

    // bullets vs boss
    if (boss.alive) {
      bullets.forEach((b) => {
        if (b.active && circlesHit(b.x, b.y, b.r, boss.x, boss.y, boss.r)) {
          b.active = false;
          if (boss.damage(1)) {
            run.score += 500;
            popAt(particles, boss.x, boss.y, false, 24);
            addShake(14, 0.5);
            enemyBullets.clear();      // its dying shots die with it
          }
        }
      });
    }

    // things touching the hero
    const hx = hero.x, hy = hero.y - 20, hr = hero.r;
    enemies.forEach((e) => {
      if (e.active && hero.invuln <= 0 && circlesHit(e.x, e.y, e.r, hx, hy, hr)) {
        e.active = false;
        hurtHero();
      }
    });
    enemyBullets.forEach((b) => {
      if (b.active && hero.invuln <= 0 && circlesHit(b.x, b.y, b.r, hx, hy, hr)) {
        b.active = false;
        hurtHero();
      }
    });
    obstacles.forEach((o) => {
      if (o.active && hero.invuln <= 0 && circlesHit(o.x, o.y, o.r * 0.85, hx, hy, hr)) {
        hurtHero();
      }
    });
    if (boss.alive && hero.invuln <= 0 && circlesHit(boss.x, boss.y, boss.r, hx, hy, hr)) {
      hurtHero();
    }
    pickups.forEach((p) => {
      if (p.active && circlesHit(p.x, p.y, p.r, hx, hy, hr + 6)) {
        p.active = false;
        applyPickup(p.kind);
        popAt(particles, p.x, p.y, p.kind === "sludge", 5);
      }
    });

    /* ---- level cleared? ---- */
    if (Engine.stateName === "PLAYING" && Stream.isCleared()) {
      run.score += 100;
      savePersistent();
      Engine.setState("LEVEL_CLEAR");
    }
  },

  draw(ctx) {
    ctx.save();
    if (shake.t > 0) ctx.translate(rand(-shake.mag, shake.mag), rand(-shake.mag, shake.mag));
    drawWorld(ctx);
    ctx.restore();
    drawHUD(ctx);
    if (Stream.time < 2.2 && !boss.alive) {
      chalkText(ctx, Stream.levelName(), GAME.W / 2, GAME.H / 2 - 60, 30);
    }
  },
});

Engine.addState("PAUSED", {
  update(dt) {
    if (Input.pausePressed() || Input.tapped()) Engine.setState("PLAYING");
  },
  draw(ctx) {
    Engine.states.PLAYING.draw(ctx);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, GAME.W, GAME.H);
    chalkText(ctx, "PAUSED", GAME.W / 2, GAME.H / 2 - 10, 44);
    chalkText(ctx, "tap or P to resume", GAME.W / 2, GAME.H / 2 + 40, 22, "center", true);
  },
});

Engine.addState("LEVEL_CLEAR", {
  enter() { this.cooldown = 0.9; },
  update(dt) {
    this.cooldown -= dt;
    for (const d of dust) d.update(dt, 0.5);
    particles.forEach((p) => p.update(dt));
    if (this.cooldown <= 0 && Input.tapped()) {
      clearField();
      Stream.advance();
      Engine.setState("PLAYING");
    }
  },
  draw(ctx) {
    for (const d of dust) d.draw(ctx);
    particles.forEach((p) => p.draw(ctx));
    hero.draw(ctx);
    chalkText(ctx, "LEVEL CLEAR", GAME.W / 2, 360, 48);
    chalkText(ctx, `score ${run.score}`, GAME.W / 2, 430, 28);
    const next = Stream.hasNextLevel()
      ? "— tap for next level —"
      : "— tap to loop, faster —";
    chalkText(ctx, next, GAME.W / 2, 540, 26);
  },
});

Engine.addState("GAME_OVER", {
  enter() { this.cooldown = 0.8; },
  update(dt) {
    this.cooldown -= dt;
    particles.forEach((p) => p.update(dt));
    enemies.forEach((e) => e.update(dt));
    if (this.cooldown <= 0 && Input.tapped()) Engine.setState("TITLE");
  },
  draw(ctx) {
    particles.forEach((p) => p.draw(ctx));
    enemies.forEach((e) => e.draw(ctx));
    chalkText(ctx, "GAME OVER", GAME.W / 2, 360, 52);
    chalkText(ctx, `score ${run.score}`, GAME.W / 2, 430, 28);
    chalkText(ctx, `best ${run.best}`, GAME.W / 2, 472, 22, "center", true);
    chalkText(ctx, "— tap to retry —", GAME.W / 2, 560, 26);
  },
});

/* ---------------- Ignition ---------------- */
Engine.init("game");
Input.init(Engine.canvas);
Engine.start("TITLE");
