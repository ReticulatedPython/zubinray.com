/* ============================================================
   input.js — one input layer, two devices, zero special cases.

   THE MOBILE-FIRST FILE. Game code asks two questions only:

     Input.moveDelta()  -> "how far does the player want to move
                            this step?" (logical units, +right)
     Input.tapped()     -> "did they tap/click/press-Enter?"
                            (used for start / restart)

   It never knows whether the answer came from a thumb or a key.

   Touch uses RELATIVE drag — the genre standard. Your finger
   anywhere on the screen drags the hero by the same distance it
   moved, so your thumb never has to cover the hero. Keyboard
   arrows translate to a steady drag speed. Same signal, merged.
   ============================================================ */

"use strict";

const Input = {
  // -- internal state --
  _keys: new Set(),
  _dragDX: 0,        // accumulated finger/mouse movement (logical units)
  _pointerDown: false,
  _lastPointerX: 0,
  _tap: false,       // edge-triggered: true until consumed/step-end
  _pause: false,     // edge-triggered pause request (P key)

  KEY_SPEED: 520,    // logical units per second when holding an arrow

  init(canvas) {
    /* Keyboard — the desktop development convenience */
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === "Enter" || e.code === "Space") this._tap = true;
      if (e.code === "KeyP" || e.code === "Escape") this._pause = true;
      if (["ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this._keys.delete(e.code));

    /* Pointer events cover touch, mouse and stylus in one API. */
    const logicalX = (e) => {
      const rect = canvas.getBoundingClientRect();
      return (e.clientX - rect.left) / Engine.scale;
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      this._pointerDown = true;
      this._lastPointerX = logicalX(e);
      this._tap = true;
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this._pointerDown) return;
      const x = logicalX(e);
      this._dragDX += x - this._lastPointerX;   // relative drag
      this._lastPointerX = x;
      e.preventDefault();
    });
    const up = (e) => { this._pointerDown = false; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  },

  /* How far the hero should move this physics step (logical units).
     Touch drag distance and keyboard velocity merge into one number. */
  moveDelta(dt) {
    let dx = this._dragDX;
    this._dragDX = 0;
    if (this._keys.has("ArrowLeft")  || this._keys.has("KeyA")) dx -= this.KEY_SPEED * dt;
    if (this._keys.has("ArrowRight") || this._keys.has("KeyD")) dx += this.KEY_SPEED * dt;
    return dx;
  },

  /* Edge-triggered events: read once, then they reset. */
  tapped()      { const t = this._tap;   this._tap = false;   return t; },
  pausePressed(){ const p = this._pause; this._pause = false; return p; },

  /* Called by the engine after every physics step so stale
     edge-triggers never leak across steps. */
  endStep() { this._tap = false; this._pause = false; },
};
