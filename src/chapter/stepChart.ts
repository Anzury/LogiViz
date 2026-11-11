const SVG = 'http://www.w3.org/2000/svg';
const DEFAULT_HEIGHT = 132;
const MARGIN = { left: 40, right: 16, top: 20, bottom: 22 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Round tick values covering [min, max], two to four of them. */
function ticks(min: number, max: number): number[] {
  const rough = Math.max(max - min, 0.5) / 2;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!;
  const first = Math.floor(min / step) * step;
  const result: number[] = [];
  for (let value = first; value < max + step - 1e-9; value += step) result.push(Number(value.toFixed(6)));
  return result;
}

export interface ChartData {
  /** One value per event of the trace being played. */
  values: number[];
  color: string;
  /** Unit printed above the axis, e.g. "km". */
  unit: string;
  /** Full text for a value, used by the tooltip, the end label and screen readers. */
  format(value: number): string;
  /** What the series is, for the accessible name: "Longueur de la tournée". */
  name: string;
  /** A horizontal line to measure against; the figure's caption says what it is. */
  reference?: { value: number; label: string; color: string };
}

/**
 * One quantity over the steps of a trace, drawn as a step line. It reads the
 * same trace as the scene: the marker follows the player, and clicking the
 * chart seeks the player.
 */
export class StepChart {
  private data: ChartData | null = null;
  private index = 0;
  private x = (_i: number) => 0;
  private y = (_value: number) => 0;
  private marker: SVGCircleElement | null = null;
  private crosshair: SVGLineElement | null = null;
  private readonly tip = document.createElement('div');

  constructor(
    private readonly plot: HTMLElement,
    private readonly onSeek: (index: number) => void,
    private readonly height = DEFAULT_HEIGHT,
  ) {
    plot.style.height = `${height}px`;
    this.tip.className = 'chart-tip';
    this.tip.hidden = true;
    new ResizeObserver(() => this.draw()).observe(plot);

    plot.addEventListener('pointermove', (e) => this.hover(e));
    plot.addEventListener('pointerleave', () => this.hover(null));
    plot.addEventListener('click', (e) => {
      const index = this.nearest(e);
      if (index !== null) this.onSeek(index);
    });
  }

  setData(data: ChartData): void {
    this.data = data;
    this.index = 0;
    this.draw();
  }

  setIndex(index: number): void {
    this.index = index;
    const value = this.data?.values[index];
    if (value === undefined || !this.marker) return;
    this.marker.setAttribute('cx', String(this.x(index)));
    this.marker.setAttribute('cy', String(this.y(value)));
  }

  private draw(): void {
    const width = this.plot.clientWidth;
    const data = this.data;
    if (!width || !data || data.values.length === 0) return;
    const { values, reference } = data;
    const extent = reference ? [...values, reference.value] : values;
    const marks = ticks(Math.min(...extent), Math.max(...extent));
    const low = marks[0];
    const high = marks[marks.length - 1];
    const innerWidth = width - MARGIN.left - MARGIN.right;
    const innerHeight = this.height - MARGIN.top - MARGIN.bottom;
    const last = Math.max(values.length - 1, 1);
    this.x = (i) => MARGIN.left + (i / last) * innerWidth;
    this.y = (value) => MARGIN.top + (1 - (value - low) / (high - low)) * innerHeight;

    const root = svg('svg', { width, height: this.height, viewBox: `0 0 ${width} ${this.height}`, role: 'img' });
    root.setAttribute('aria-label', `${data.name} : de ${data.format(values[0])} à ${data.format(values[values.length - 1])}`);

    for (const mark of marks) {
      root.append(svg('line', { class: 'chart-grid', x1: MARGIN.left, x2: width - MARGIN.right, y1: this.y(mark), y2: this.y(mark) }));
      const label = svg('text', { class: 'chart-tick', x: MARGIN.left - 8, y: this.y(mark), 'text-anchor': 'end', dy: '0.32em' });
      label.textContent = mark.toLocaleString('fr-FR');
      root.append(label);
    }
    const unit = svg('text', { class: 'chart-tick', x: MARGIN.left - 8, y: 9, 'text-anchor': 'end' });
    unit.textContent = data.unit;
    const axis = svg('text', { class: 'chart-tick', x: width - MARGIN.right, y: this.height - 5, 'text-anchor': 'end' });
    axis.textContent = `${last.toLocaleString('fr-FR')} étapes`;
    const origin = svg('text', { class: 'chart-tick', x: MARGIN.left, y: this.height - 5 });
    origin.textContent = 'départ';
    root.append(unit, axis, origin);

    if (reference) {
      // Named in the figure's caption rather than in the plot, where it would
      // collide with a series that ends up hugging the line.
      const at = this.y(reference.value);
      const line = svg('line', { class: 'chart-reference', x1: MARGIN.left, x2: width - MARGIN.right, y1: at, y2: at, stroke: reference.color });
      const title = svg('title', {});
      title.textContent = `${reference.label} : ${data.format(reference.value)}`;
      line.append(title);
      root.append(line);
    }

    // A quantity that only changes when a step is taken reads best as a staircase.
    let path = `M${this.x(0)},${this.y(values[0])}`;
    for (let i = 1; i < values.length; i++) path += `H${this.x(i)}V${this.y(values[i])}`;
    root.append(svg('path', { class: 'chart-line', d: path, stroke: data.color }));

    const end = svg('text', { class: 'chart-end', x: width - MARGIN.right, y: this.y(values[values.length - 1]) - 9, 'text-anchor': 'end' });
    end.textContent = data.format(values[values.length - 1]);
    root.append(end);

    this.crosshair = svg('line', { class: 'chart-crosshair', y1: MARGIN.top, y2: this.height - MARGIN.bottom, visibility: 'hidden' });
    this.marker = svg('circle', { class: 'chart-marker', r: 5, fill: data.color });
    root.append(this.crosshair, this.marker);

    this.plot.replaceChildren(root, this.tip);
    this.setIndex(this.index);
  }

  private nearest(e: PointerEvent | MouseEvent): number | null {
    if (!this.data || this.data.values.length === 0) return null;
    const rect = this.plot.getBoundingClientRect();
    const innerWidth = rect.width - MARGIN.left - MARGIN.right;
    const ratio = (e.clientX - rect.left - MARGIN.left) / innerWidth;
    return Math.round(Math.min(Math.max(ratio, 0), 1) * (this.data.values.length - 1));
  }

  private hover(e: PointerEvent | null): void {
    const index = e ? this.nearest(e) : null;
    if (index === null || !this.crosshair || !this.data) {
      this.tip.hidden = true;
      this.crosshair?.setAttribute('visibility', 'hidden');
      return;
    }
    const x = this.x(index);
    this.crosshair.setAttribute('x1', String(x));
    this.crosshair.setAttribute('x2', String(x));
    this.crosshair.setAttribute('visibility', 'visible');

    const value = document.createElement('strong');
    value.textContent = this.data.format(this.data.values[index]);
    const label = document.createElement('span');
    label.textContent = index === 0 ? 'départ' : `étape ${index.toLocaleString('fr-FR')}`;
    this.tip.replaceChildren(value, label);
    this.tip.hidden = false;
    const half = this.tip.offsetWidth / 2;
    this.tip.style.left = `${Math.min(Math.max(x, half), this.plot.clientWidth - half)}px`;
  }
}
