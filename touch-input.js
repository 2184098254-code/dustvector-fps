/* Two-thumb game controls. Pointer ownership survives leaving the starting region. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DustvectorTouch = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  class TouchInput {
    static bindActivation(button, action, coarsePointer) {
      let pressedWith = null;
      const remember = event => { pressedWith = event.pointerType || null; };
      const rememberTouch = () => { pressedWith = 'touch'; };
      const clear = () => { pressedWith = null; };
      const activate = event => {
        // Compatibility clicks can say "mouse" after a real finger press.
        // Prefer the initiating press, preserving actual mouse use on hybrid PCs.
        const source = pressedWith || (event.sourceCapabilities?.firesTouchEvents ? 'touch' : event.pointerType);
        const touch = source ? source === 'touch' : coarsePointer();
        clear(); action(event, touch);
      };
      button.addEventListener('pointerdown', remember);
      button.addEventListener('touchstart', rememberTouch, { passive: true });
      button.addEventListener('pointercancel', clear);
      button.addEventListener('touchcancel', clear);
      button.addEventListener('keydown', clear);
      button.addEventListener('click', activate);
      return () => {
        button.removeEventListener('pointerdown', remember); button.removeEventListener('touchstart', rememberTouch);
        button.removeEventListener('pointercancel', clear); button.removeEventListener('touchcancel', clear);
        button.removeEventListener('keydown', clear); button.removeEventListener('click', activate);
      };
    }
    constructor(surface, stick, thumb, options) {
      this.surface = surface; this.stick = stick; this.thumb = thumb; this.options = options;
      this.pointers = new Map(); this.firePointers = new Set(); this.moveId = null; this.lookId = null;
      this.x = 0; this.y = 0; this.sprint = false; this.sensitivity = 1;
      this.down = this.down.bind(this); this.motion = this.motion.bind(this); this.up = this.up.bind(this);
      surface.addEventListener('pointerdown', this.down, { passive: false });
      surface.addEventListener('pointermove', this.motion, { passive: false });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(type, this.up);
    }
    get fire() { return this.firePointers.size > 0; }
    down(event) {
      if (!this.options.active() || event.pointerType === 'mouse') return;
      const button = event.target.closest('button');
      if (button && button.id !== 'touch-fire') return;
      const rect = this.surface.getBoundingClientRect();
      const isFire = button && button.id === 'touch-fire';
      const mode = isFire ? 'fire' : event.clientX < rect.left + rect.width * .46 ? 'move' : 'look';
      if (mode === 'move' && this.moveId !== null) return;
      if (mode === 'look' && this.lookId !== null) return;
      const pointer = { mode, x: event.clientX, y: event.clientY };
      this.pointers.set(event.pointerId, pointer);
      if (mode === 'move') {
        this.moveId = event.pointerId;
        const radius = this.stick.offsetWidth / 2;
        pointer.originX = event.clientX - rect.left; pointer.originY = event.clientY - rect.top;
        this.stick.style.left = clamp(pointer.originX, radius + 12, rect.width * .46 - 8) + 'px';
        this.stick.style.top = clamp(pointer.originY, radius + 12, rect.height - radius - 12) + 'px';
        this.stick.classList.add('engaged');
      } else {
        if (this.lookId === null) this.lookId = event.pointerId;
        if (isFire) { this.firePointers.add(event.pointerId); this.options.wake(); }
      }
      try { this.surface.setPointerCapture(event.pointerId); } catch { /* pointer already ended */ }
      this.surface.classList.toggle('is-firing', this.fire);
      event.preventDefault();
    }
    motion(event) {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer || !this.options.active()) return;
      if (pointer.mode === 'move') {
        const rect = this.surface.getBoundingClientRect(), radius = Math.max(32, this.stick.offsetWidth * .34);
        let dx = event.clientX - rect.left - pointer.originX, dy = event.clientY - rect.top - pointer.originY;
        const distance = Math.hypot(dx, dy), amount = Math.min(1, distance / radius);
        if (distance > radius) { dx *= radius / distance; dy *= radius / distance; }
        const deadzone = .1, strength = amount < deadzone ? 0 : (amount - deadzone) / (1 - deadzone);
        this.x = strength ? dx / Math.max(1, Math.hypot(dx, dy)) * strength : 0;
        this.y = strength ? dy / Math.max(1, Math.hypot(dx, dy)) * strength : 0;
        this.sprint = distance > radius * 1.35 && this.y < -.65;
        this.thumb.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (this.lookId === event.pointerId) {
        const scale = .0045 * this.sensitivity;
        this.options.look((event.clientX - pointer.x) * scale, (event.clientY - pointer.y) * scale);
      }
      pointer.x = event.clientX; pointer.y = event.clientY;
      event.preventDefault();
    }
    up(event) {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.delete(event.pointerId); this.firePointers.delete(event.pointerId);
      if (this.moveId === event.pointerId) {
        this.moveId = null; this.x = 0; this.y = 0; this.sprint = false;
        this.stick.classList.remove('engaged'); this.stick.style.left = ''; this.stick.style.top = ''; this.thumb.style.transform = '';
      }
      if (this.lookId === event.pointerId) this.lookId = null;
      this.surface.classList.toggle('is-firing', this.fire);
    }
    reset() {
      const captured = [...this.pointers.keys()];
      this.pointers.clear(); this.firePointers.clear(); this.moveId = null; this.lookId = null;
      this.x = 0; this.y = 0; this.sprint = false;
      this.stick.classList.remove('engaged'); this.stick.style.left = ''; this.stick.style.top = ''; this.thumb.style.transform = '';
      this.surface.classList.remove('is-firing');
      for (const id of captured) { try { this.surface.releasePointerCapture(id); } catch { /* capture already lost */ } }
    }
    destroy() {
      this.reset(); this.surface.removeEventListener('pointerdown', this.down); this.surface.removeEventListener('pointermove', this.motion);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.surface.removeEventListener(type, this.up);
    }
  }
  return TouchInput;
});
