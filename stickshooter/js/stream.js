/* ============================================================
   stream.js — the heart of the game.  v0.3

   Two design rules are now baked into every level script:

   RULE 1 — THE GIFT PRECEDES THE TEST.
   Every power-up drop is followed ~4s later by a surge it was
   sent to handle. Every heart precedes the hardest section of
   its level. Pickups aren't decoration; they're foreshadowing.
   Players learn: when something good falls, brace yourself —
   and missing the gift makes the next stretch genuinely harder.

   RULE 2 — LEVELS RUN ~120 SECONDS.
   Scripted action to ~105s, boss arrives ~106–110s, fight takes
   the rest. Sections of roughly 20s each: warm-up, gift→surge,
   rocks+mix, gift→surge, heart→hard stretch, breather, boss.

   ROCK PATTERNS: 14 named formations below. Levels either call
   one by name (a designed moment) or pass nothing for a random
   pick — randomly mirrored left↔right — so runs stay novel.
   ============================================================ */

"use strict";

const LANES = [70, 170, 270, 370, 470];
function laneX(lane) {
  if (lane === "r") return LANES[randInt(0, 4)] + rand(-20, 20);
  return LANES[lane];
}

/* ---------- ROCK PATTERN LIBRARY ----------
   Each entry: [secondsAfterStart, lane, sizeMul].
   Lanes 0..4 left→right. sizeMul ~0.6 small shard, ~1.6 boulder. */
const ROCK_PATTERNS = {
  wallGapLeft:    [[0,1,1.1],[0,2,1.1],[0,3,1.1],[0,4,1.1]],
  wallGapMid:     [[0,0,1.1],[0,1,1.1],[0,3,1.1],[0,4,1.1]],
  wallGapRight:   [[0,0,1.1],[0,1,1.1],[0,2,1.1],[0,3,1.1]],
  slalom:         [[0,0,1.0],[0.9,2,1.0],[1.8,4,1.0],[2.7,2,1.0]],
  pillars:        [[0,1,1.2],[0,3,1.2],[1.4,1,1.2],[1.4,3,1.2]],
  funnelIn:       [[0,0,1.2],[0,4,1.2],[0.8,1,1.0],[0.8,3,1.0]],     // squeezes you to centre
  funnelOut:      [[0,2,1.4],[0.8,1,1.0],[0.8,3,1.0]],               // pushes you to the edges
  staircase:      [[0,0,0.9],[0.5,1,0.9],[1.0,2,0.9],[1.5,3,0.9],[2.0,4,0.9]],
  gate:           [[0,0,1.3],[0,1,1.3],[0,3,1.3],[0,4,1.3]],         // big wall, centre gap
  scatterShards:  [[0,"r",0.6],[0.4,"r",0.65],[0.8,"r",0.6],[1.2,"r",0.7],[1.6,"r",0.6]],
  corridorLeft:   [[0,2,1.1],[0,3,1.1],[0,4,1.1],[1.2,2,1.1],[1.2,4,1.1]],  // hold the left
  corridorRight:  [[0,0,1.1],[0,1,1.1],[0,2,1.1],[1.2,0,1.1],[1.2,2,1.1]],  // hold the right
  theBigOne:      [[0,2,1.9]],                                       // one huge drillable boulder
  doubleGate:     [[0,1,1.2],[0,3,1.2],[1.6,0,1.2],[1.6,4,1.2]],
};

/* ---------- event builders ---------- */
function one(t, what, kind, lane)  { return [{ t, what, kind, lane }]; }
function drop(t, kind, lane)       { return one(t, "pickup", kind, lane); }
function bossAt(t, hp)             { return [{ t, what: "boss", hp }]; }

function wave(t, kind, n, gap, lane) {
  const ev = [];
  for (let i = 0; i < n; i++) ev.push({ t: t + i * gap, what: "enemy", kind, lane });
  return ev;
}
function sweep(t, kind, n, gap, dir) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const lane = dir > 0 ? i % 5 : 4 - (i % 5);
    ev.push({ t: t + i * gap, what: "enemy", kind, lane });
  }
  return ev;
}
function pincer(t, kind, gap) {
  return [
    { t,            what: "enemy", kind, lane: 0 },
    { t,            what: "enemy", kind, lane: 4 },
    { t: t + gap,   what: "enemy", kind, lane: 1 },
    { t: t + gap,   what: "enemy", kind, lane: 3 },
    { t: t + gap*2, what: "enemy", kind, lane: 2 },
  ];
}
/* n enemies, each a random kind from the list — chaotic mixed waves */
function burst(t, kinds, n, gap) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    ev.push({ t: t + i * gap, what: "enemy", kind: kinds[randInt(0, kinds.length - 1)], lane: "r" });
  }
  return ev;
}
/* a rock formation: named, or random (and randomly mirrored) if not */
function rocks(t, name) {
  const keys = Object.keys(ROCK_PATTERNS);
  const pat = ROCK_PATTERNS[name] || ROCK_PATTERNS[keys[randInt(0, keys.length - 1)]];
  const mirror = name ? false : Math.random() < 0.5;
  return pat.map(([dt, lane, s]) => ({
    t: t + dt,
    what: "obstacle",
    lane: (mirror && lane !== "r") ? 4 - lane : lane,
    sizeMul: s * rand(0.9, 1.1),
  }));
}

/* ---------- THE LEVELS (~120s each) ---------- */
const LEVELS = [
  {
    name: "LEVEL 1 · FIRST CONTACT",
    speed: 1.0,
    events: [
      /* §1 warm-up (0–16): learn the sizes */
      ...wave(2, "grunt", 4, 0.8, "r"),
      ...wave(7, "grunt", 5, 0.6, "r"),
      ...sweep(12, "grunt", 5, 0.5, 1),

      /* §2 gift → surge (16–32) */
      ...drop(16, "rapid", 2),
      ...wave(20, "grunt", 8, 0.45, "r"),
      ...sweep(24, "grunt", 6, 0.4, -1),
      ...pincer(28, "grunt", 0.5),

      /* §3 rocks arrive (32–50) */
      ...rocks(33, "theBigOne"),               // meet a drillable boulder, alone
      ...wave(37, "grunt", 5, 0.55, "r"),
      ...rocks(42, "pillars"),
      ...wave(45, "grunt", 5, 0.5, "r"),
      ...wave(48, "zig", 2, 1.3, "r"),         // a taste of level 2

      /* §4 gift → surge (52–72) */
      ...drop(52, "spread", 1),
      ...sweep(56, "grunt", 7, 0.38, 1),
      ...sweep(58.5, "grunt", 7, 0.38, -1),
      ...wave(62, "zig", 3, 0.9, "r"),
      ...rocks(66, "slalom"),
      ...pincer(69, "grunt", 0.45),

      /* §5 heart → the hard stretch (76–98) */
      ...drop(76, "heart", "r"),
      ...pincer(81, "zig", 0.7),
      ...wave(84, "grunt", 10, 0.35, "r"),
      ...rocks(88, "gate"),
      ...sweep(91, "grunt", 8, 0.33, 1),
      ...wave(95, "zig", 3, 0.8, "r"),

      /* §6 breather, then the boss (~104) */
      ...wave(100, "grunt", 3, 0.8, "r"),
      ...bossAt(105, 40),
    ],
  },
  {
    name: "LEVEL 2 · THE ZIGZAGS",
    speed: 1.15,
    events: [
      /* §1 warm-up: zigzags own this level (0–16) */
      ...wave(2, "zig", 3, 1.0, "r"),
      ...wave(6, "grunt", 5, 0.5, "r"),
      ...rocks(10, "staircase"),
      ...wave(13, "zig", 3, 0.9, "r"),

      /* §2 gift → surge, with the first trap (16–34) */
      ...drop(17, "rapid", 1),
      ...one(17, "pickup", "sludge", 3),       // bait beside the prize
      ...sweep(21, "zig", 5, 0.7, 1),
      ...wave(25, "grunt", 8, 0.4, "r"),
      ...rocks(29, "wallGapMid"),
      ...pincer(31, "zig", 0.7),

      /* §3 rock gauntlet (34–54) */
      ...rocks(35, "funnelIn"),
      ...wave(38, "grunt", 6, 0.45, "r"),
      ...rocks(42),                            // random formation
      ...wave(45, "zig", 4, 0.7, "r"),
      ...rocks(49, "doubleGate"),
      ...burst(51, ["grunt", "zig"], 5, 0.5),

      /* §4 gift → surge (54–76) */
      ...drop(56, "spread", 2),
      ...sweep(60, "grunt", 9, 0.33, -1),
      ...wave(63, "zig", 5, 0.6, "r"),
      ...rocks(67, "corridorLeft"),
      ...pincer(70, "zig", 0.6),
      ...burst(73, ["grunt", "zig"], 6, 0.45),

      /* §5 heart → the hard stretch (78–100) */
      ...drop(78, "heart", "r"),
      ...one(82, "pickup", "sludge", 2),       // trap in the chaos
      ...rocks(83, "wallGapLeft"),
      ...wave(85, "zig", 6, 0.5, "r"),
      ...sweep(89, "grunt", 10, 0.3, 1),
      ...rocks(93),
      ...pincer(96, "zig", 0.5),

      /* §6 breather, boss (~106) */
      ...wave(101, "grunt", 3, 0.8, "r"),
      ...bossAt(106, 70),
    ],
  },
  {
    name: "LEVEL 3 · ROCKFALL",
    speed: 1.3,
    events: [
      /* §1 warm-up: meet the tank (0–18) */
      ...wave(2, "tank", 1, 0, 2),
      ...wave(5, "grunt", 6, 0.4, "r"),
      ...rocks(9, "scatterShards"),
      ...wave(12, "zig", 4, 0.7, "r"),
      ...wave(16, "tank", 1, 0, "r"),

      /* §2 gift → surge (18–38) */
      ...drop(19, "rapid", 2),
      ...wave(23, "tank", 2, 1.6, "r"),
      ...sweep(26, "grunt", 8, 0.33, 1),
      ...rocks(30, "funnelOut"),
      ...wave(33, "zig", 5, 0.6, "r"),
      ...burst(36, ["grunt", "zig"], 5, 0.4),

      /* §3 the rockfall (38–60) */
      ...rocks(39, "gate"),
      ...rocks(43),
      ...wave(44, "grunt", 6, 0.4, "r"),
      ...rocks(47, "slalom"),
      ...one(50, "pickup", "sludge", 2),
      ...drop(50.5, "spread", 0),              // prize and trap side by side
      ...rocks(53, "corridorRight"),
      ...wave(55, "zig", 5, 0.55, "r"),
      ...rocks(58, "scatterShards"),

      /* §4 surge (60–80) */
      ...sweep(61, "grunt", 10, 0.28, -1),
      ...wave(65, "tank", 2, 2.0, "r"),
      ...pincer(69, "zig", 0.55),
      ...rocks(73, "wallGapRight"),
      ...burst(75, ["grunt", "zig", "tank"], 6, 0.55),

      /* §5 heart → the hardest stretch in the game (82–102) */
      ...drop(82, "heart", "r"),
      ...rocks(86, "doubleGate"),
      ...wave(87, "zig", 6, 0.45, "r"),
      ...wave(91, "tank", 2, 1.8, "r"),
      ...sweep(93, "grunt", 12, 0.25, 1),
      ...rocks(97),
      ...pincer(99, "zig", 0.45),

      /* §6 breather, boss (~108) */
      ...wave(104, "grunt", 3, 0.8, "r"),
      ...bossAt(108, 110),
    ],
  },
];

/* ---------- The Stream runtime ---------- */
const Stream = {
  levelIndex: 0,
  loop: 0,
  time: 0,
  queue: [],
  bossSpawned: false,

  speedMul() { return LEVELS[this.levelIndex].speed * (1 + this.loop * 0.2); },
  levelName() {
    const n = LEVELS[this.levelIndex].name;
    return this.loop > 0 ? `${n} · LOOP ${this.loop + 1}` : n;
  },

  load(index) {
    this.levelIndex = index;
    this.time = 0;
    this.bossSpawned = false;
    this.queue = LEVELS[index].events.slice().sort((a, b) => a.t - b.t);
  },

  update(dt) {
    this.time += dt;
    while (this.queue.length && this.queue[0].t <= this.time) {
      this.fire(this.queue.shift());
    }
  },

  fire(ev) {
    const mul = this.speedMul();
    if (ev.what === "enemy") {
      enemies.get().spawn(ev.kind, laneX(ev.lane), mul);
    } else if (ev.what === "obstacle") {
      obstacles.get().spawn(laneX(ev.lane), mul, ev.sizeMul);
    } else if (ev.what === "pickup") {
      pickups.get().spawn(ev.kind, laneX(ev.lane));
    } else if (ev.what === "boss") {
      boss.activate(Math.round(ev.hp * (1 + this.loop * 0.5)), mul);
      this.bossSpawned = true;
    }
  },

  isCleared() {
    return this.queue.length === 0 &&
           enemies.countActive() === 0 &&
           !boss.alive;
  },

  hasNextLevel() { return this.levelIndex + 1 < LEVELS.length; },

  advance() {
    if (this.hasNextLevel()) {
      this.load(this.levelIndex + 1);
    } else {
      this.loop += 1;
      this.load(0);
    }
  },
};
