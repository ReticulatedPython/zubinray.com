/* ============================================================
   engine.js — the foundations everything else stands on.

   Owns: the canvas, the resolution, the clock, the states.
   Knows nothing about heroes or monsters.

   KEY IDEA #1 — Logical resolution.
   All game code lives in a fixed 540 x 960 portrait world
   ("logical units"). The engine scales that world to whatever
   real screen it finds — an iPhone, a Pixel, your MacBook —
   and multiplies by devicePixelRatio so lines stay crisp on
   Retina/AMOLED. Game code never thinks about screens.

   KEY IDEA #2 — Fixed timestep.
   Physics updates in exact 1/60s slices no matter how fast the
   display runs. A 120Hz iPhone and a struggling old Android
   play the *same game*, just drawn more or less often.

   KEY IDEA #3 — State machine.
   The game is always in exactly one state (TITLE, PLAYING,
   GAME_OVER...). Each state is a tiny object with enter /
   update / draw. Adding PAUSED or LEVEL_CLEAR later is just
   adding another object — no spaghetti.
   ============================================================ */

"use strict";

/* ---------- The logical world ---------- */
const GAME = {
  W: 540,          // logical width  (portrait, phone-shaped)
  H: 960,          // logical height
  STEP: 1 / 60,    // fixed physics step in seconds
};

/* ---------- Maths & collision helpers ---------- */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function rand(lo, hi)     { return lo + Math.random() * (hi - lo); }
function randInt(lo, hi)  { return Math.floor(rand(lo, hi + 1)); }

/* Circle vs circle — our only collision shape in M0.
   Cheap, robust, and honestly fine for most SHMUPs. */
function circlesHit(ax, ay, ar, bx, by, br) {
  const dx = ax - bx, dy = ay - by, r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/* ---------- Object pool ----------
   Phones hate garbage collection mid-game (it causes stutter).
   So bullets/enemies/particles are created ONCE, up front, and
   recycled forever: get() hands you a dormant one, you set
   .active = false to give it back. Nothing is ever destroyed. */
class Pool {
  constructor(factory, size) {
    this.factory = factory;
    this.items = [];
    for (let i = 0; i < size; i++) {
      const o = factory();
      o.active = false;
      this.items.push(o);
    }
  }
  get() {                          // fetch a dormant object
    for (const o of this.items) {
      if (!o.active) { o.active = true; return o; }
    }
    const o = this.factory();      // pool exhausted: grow (rare)
    o.active = true;
    this.items.push(o);
    return o;
  }
  forEach(fn) {                    // visit only the live ones
    for (const o of this.items) if (o.active) fn(o);
  }
  clear() { for (const o of this.items) o.active = false; }
  countActive() {
    let n = 0;
    for (const o of this.items) if (o.active) n++;
    return n;
  }
}

/* ---------- The engine itself ---------- */
const Engine = {
  canvas: null,
  ctx: null,
  scale: 1,          // logical-unit -> CSS-pixel scale (input.js needs it)
  states: {},
  state: null,
  stateName: "",
  time: 0,           // total seconds in current state

  init(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    window.addEventListener("resize", () => this.resize());
    this.resize();
  },

  /* Fit the 540x960 board to the window, then render at
     devicePixelRatio for crispness. ctx.setTransform means all
     game drawing stays in logical units forever. */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const margin = 16; // breathing room around the frame
    const s = Math.min(
      (window.innerWidth  - margin) / GAME.W,
      (window.innerHeight - margin) / GAME.H
    );
    this.scale = s;
    this.canvas.style.width  = Math.floor(GAME.W * s) + "px";
    this.canvas.style.height = Math.floor(GAME.H * s) + "px";
    this.canvas.width  = Math.floor(GAME.W * s * dpr);
    this.canvas.height = Math.floor(GAME.H * s * dpr);
    this.ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
  },

  addState(name, obj) { this.states[name] = obj; },

  setState(name) {
    this.state = this.states[name];
    this.stateName = name;
    this.time = 0;
    if (this.state.enter) this.state.enter();
  },

  /* The heartbeat. Accumulate real elapsed time, spend it in
     fixed STEP-sized updates, then draw once per display frame. */
  start(firstState) {
    this.setState(firstState);
    let last = performance.now();
    let acc = 0;
    const frame = (now) => {
      // Clamp huge gaps (tab was hidden) so we don't fast-forward chaos.
      acc += Math.min((now - last) / 1000, 0.25);
      last = now;
      while (acc >= GAME.STEP) {
        this.time += GAME.STEP;
        this.state.update(GAME.STEP);
        Input.endStep();           // per-step input bookkeeping
        acc -= GAME.STEP;
      }
      this.ctx.clearRect(0, 0, GAME.W, GAME.H);
      this.state.draw(this.ctx);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // Mobile manners: pause when the app/tab goes to background.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.stateName === "PLAYING") {
        this.setState("PAUSED");
      }
    });
  },
};
