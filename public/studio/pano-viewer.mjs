// 等距柱状全景：拖动改变朝向，只画当前视野，不生成新图。
export function panoYaw(start, deltaX, width) {
  const span = Math.max(1, Number(width) || 1);
  let yaw = Number(start) || 0;
  yaw += (Number(deltaX) || 0) / span * 360;
  yaw %= 360;
  if (yaw < 0) yaw += 360;
  return yaw;
}

export function mountPano(canvas, source) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let yaw = 180, dragging = false, last = 0;
  const draw = () => {
    const img = canvas._panoImage;
    if (!img?.width) return;
    const view = img.width / 4;
    const x = (yaw / 360) * img.width - view / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const srcX = (x + img.width) % img.width;
    const first = Math.min(view, img.width - srcX);
    ctx.drawImage(img, srcX, 0, first, img.height, 0, 0, canvas.width * (first / view), canvas.height);
    if (first < view) ctx.drawImage(img, 0, 0, view - first, img.height, canvas.width * (first / view), 0, canvas.width * ((view - first) / view), canvas.height);
  };
  const img = new Image();
  img.onload = () => { canvas._panoImage = img; draw(); };
  img.src = source;
  const down = event => { dragging = true; last = event.clientX; };
  const move = event => { if (!dragging) return; yaw = panoYaw(yaw, event.clientX - last, canvas.width); last = event.clientX; draw(); };
  const up = () => { dragging = false; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.style.touchAction = 'none';
  canvas.title = '拖动查看 360° 全景';
  return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
}
