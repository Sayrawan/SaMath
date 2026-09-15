export function formatTimer(deadline) {
  const remaining = Math.floor((deadline - Date.now()) / 1000);
  const overtime = remaining < 0;
  const absolute = Math.abs(remaining);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  return `${overtime ? "-" : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export class CalmTimer {
  constructor(onTick) {
    this.onTick = onTick;
    this.interval = null;
  }

  start(deadline) {
    this.stop();
    const tick = () => this.onTick(formatTimer(deadline));
    tick();
    this.interval = window.setInterval(tick, 1000);
  }

  stop() {
    if (this.interval) window.clearInterval(this.interval);
    this.interval = null;
  }
}
