const SPEEDS = [1, 3, 10];

export interface PlayerOptions<E> {
  /** Called whenever the player lands on an event. `forward` is true for a single step ahead. */
  show(ev: E, index: number, forward: boolean): void;
  caption(ev: E): string;
  /** Milliseconds an event stays on screen at speed ×1. */
  dwell(ev: E): number;
  /** Events worth jumping to; enables the player's skip button. */
  milestone?(ev: E): boolean;
  /** Which of the speed steps (×1, ×3, ×10) to start on. */
  speed?: number;
}

/**
 * Transport controls over a recorded trace: play, pause, step either way, scrub.
 * It owns no algorithm state, only an index into the trace, and works for any
 * kind of event.
 */
export class Player<E> {
  private trace: E[] = [];
  private index = 0;
  private playing = false;
  private speed: number;
  private timer: number | undefined;

  private readonly range: HTMLInputElement;
  private readonly captionEl: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private readonly speedEl: HTMLButtonElement;

  constructor(root: HTMLElement, private readonly options: PlayerOptions<E>) {
    this.range = root.querySelector('input[type="range"]')!;
    this.captionEl = root.querySelector('.player-caption')!;
    this.toggleEl = root.querySelector('[data-act="toggle"]')!;
    this.speedEl = root.querySelector('[data-act="speed"]')!;
    this.speed = options.speed ?? 0;
    this.speedEl.textContent = `×${SPEEDS[this.speed]}`;

    root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'toggle') this.playing ? this.pause() : this.play();
      else if (act === 'restart') this.seek(0);
      else if (act === 'back') this.seek(this.index - 1);
      else if (act === 'forward') this.seek(this.index + 1, true);
      else if (act === 'skip') this.seek(this.nextMilestone(), true);
      else if (act === 'speed') {
        this.speed = (this.speed + 1) % SPEEDS.length;
        this.speedEl.textContent = `×${SPEEDS[this.speed]}`;
        if (this.playing) this.schedule();
      }
    });
    this.range.addEventListener('input', () => this.seek(Number(this.range.value)));
  }

  get atStart(): boolean {
    return this.index === 0;
  }

  /** Swaps in a new trace and rewinds, without drawing anything. */
  load(trace: E[]): void {
    this.pause();
    this.trace = trace;
    this.index = 0;
    this.range.max = String(Math.max(trace.length - 1, 0));
    this.sync();
  }

  /** Draws the current event again, e.g. when its step scrolls back into view. */
  render(): void {
    if (this.trace.length > 0) this.options.show(this.trace[this.index], this.index, false);
  }

  play(): void {
    if (this.trace.length < 2) return;
    if (this.index >= this.trace.length - 1) this.go(0, false);
    this.playing = true;
    this.sync();
    this.schedule();
  }

  pause(): void {
    this.playing = false;
    window.clearTimeout(this.timer);
    this.sync();
  }

  /** Jumps to an event and stops playback. */
  seek(index: number, forward = false): void {
    this.pause();
    this.go(index, forward && index === this.index + 1);
  }

  private go(index: number, forward: boolean): void {
    if (this.trace.length === 0) return;
    this.index = Math.min(Math.max(index, 0), this.trace.length - 1);
    this.sync();
    this.options.show(this.trace[this.index], this.index, forward);
  }

  private nextMilestone(): number {
    const isMilestone = this.options.milestone;
    if (isMilestone) {
      for (let i = this.index + 1; i < this.trace.length; i++) {
        if (isMilestone(this.trace[i])) return i;
      }
    }
    return this.trace.length - 1;
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    const wait = this.options.dwell(this.trace[this.index]) / SPEEDS[this.speed];
    this.timer = window.setTimeout(() => {
      if (!this.playing) return;
      if (this.index >= this.trace.length - 1) {
        this.pause();
        return;
      }
      this.go(this.index + 1, true);
      this.schedule();
    }, wait);
  }

  private sync(): void {
    this.range.value = String(this.index);
    this.toggleEl.dataset.state = this.playing ? 'playing' : 'paused';
    this.toggleEl.setAttribute('aria-label', this.playing ? 'Mettre en pause' : 'Lancer la lecture');
    const ev = this.trace[this.index];
    this.captionEl.textContent = ev === undefined ? '' : this.options.caption(ev);
  }
}
