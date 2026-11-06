/* Pointer, wheel and keyboard gestures shared by the two interactive charts. */
window.bindChartGestures = (canvas, options) => {
 const pointers = new Map();
 let drag = null, pinch = null, suppressClick = false;
 const ready = () => options.getMeta() && options.getView().to > options.getView().from;
 const anchorAt = clientX => {
  const rect = canvas.getBoundingClientRect(), meta = options.getMeta();
  return rect.width ? Math.max(0, Math.min(1, ((clientX - rect.left) / rect.width * meta.W - meta.left) / meta.pw)) : .5;
 };
 function zoom(factor, anchor = .5) {
  if (!ready()) return;
  const { from, to } = options.getView(), span = (to - from) * factor, pivot = from + (to - from) * anchor;
  options.onLeave();
  options.setView(pivot - span * anchor, pivot + span * (1 - anchor));
 }
 canvas.addEventListener('pointerdown', event => {
  if (!ready() || event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture?.(event.pointerId);
  if (pointers.size === 1) {
   const view = options.getView();
   drag = { x: event.clientX, y: event.clientY, ...view, moved: false };
   suppressClick = false;
  } else if (pointers.size === 2) {
   const [a, b] = [...pointers.values()], view = options.getView();
   pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor: anchorAt((a.x + b.x) / 2), ...view };
   drag = null; suppressClick = true; options.onLeave();
  }
 });
 canvas.addEventListener('pointermove', event => {
  if (!ready()) return;
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size >= 2) {
   const [a, b] = [...pointers.values()], distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
   const span = (pinch.to - pinch.from) * pinch.distance / distance, pivot = pinch.from + (pinch.to - pinch.from) * pinch.anchor;
   options.setView(pivot - span * pinch.anchor, pivot + span * (1 - pinch.anchor));
  } else if (drag) {
   const rect = canvas.getBoundingClientRect(), meta = options.getMeta();
   if (!rect.width) return;
   if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
   if (drag.moved) {
    suppressClick = true; canvas.classList.add('dragging'); options.onLeave();
    const delta = (event.clientX - drag.x) / rect.width * meta.W / meta.pw * (drag.to - drag.from);
    options.setView(drag.from - delta, drag.to - delta);
   }
  } else if (!pointers.size) options.onHover(event);
 });
 function release(event) {
  pointers.delete(event.pointerId);
  if (drag?.moved || pinch) suppressClick = true;
  drag = null;
  if (!pointers.size) pinch = null;
  canvas.classList.remove('dragging');
 }
 canvas.addEventListener('pointerup', release);
 canvas.addEventListener('pointercancel', release);
 canvas.addEventListener('lostpointercapture', release);
 canvas.addEventListener('click', event => {
  if (suppressClick) { suppressClick = false; return; }
  if (ready()) options.onSelect?.(event);
 });
 canvas.addEventListener('pointerleave', () => { if (!pointers.size) options.onLeave(); });
 canvas.addEventListener('wheel', event => {
  if (!ready()) return;
  event.preventDefault();
  zoom(event.deltaY > 0 ? 1.2 : 1 / 1.2, anchorAt(event.clientX));
 }, { passive: false });
 canvas.addEventListener('keydown', event => {
  if (!ready()) return;
  if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', '0', 'Enter', 'Escape'].includes(event.key)) event.preventDefault();
  if (event.key === '+' || event.key === '=') zoom(.7);
  else if (event.key === '-') zoom(1.4);
  else if (event.key === '0') options.onReset();
  else if (event.key === 'Escape') options.onClear?.();
  else if (event.key === 'Enter') options.onSelect?.();
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
   const { from, to } = options.getView(), shift = (to - from) * .15 * (event.key === 'ArrowRight' ? 1 : -1);
   options.onLeave(); options.setView(from + shift, to + shift);
  }
 });
 return { zoom };
};
