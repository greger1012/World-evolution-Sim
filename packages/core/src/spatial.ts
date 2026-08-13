/**
 * Uniform-grid spatial index over a square arena. Rebuilt each step; queries
 * prune by cell, then the caller filters by exact distance against live
 * positions. Because creatures move a little between rebuild and query, cell
 * pruning pads the radius by `slack` so near-boundary neighbours are not
 * missed.
 *
 * Queries return a shared scratch array (no per-call allocation). Consume the
 * result before issuing the next query on the same grid.
 */
export class SpatialGrid<T extends { x: number; y: number }> {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly slack: number;
  private readonly cells: T[][];
  private readonly scratch: T[] = [];

  constructor(arenaSize: number, cellSize: number, slack = 4) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(arenaSize / cellSize));
    this.slack = slack;
    this.cells = Array.from({ length: this.cols * this.cols }, () => []);
  }

  rebuild(items: readonly T[]): void {
    for (const cell of this.cells) cell.length = 0;
    for (const it of items) this.cellOf(it.x, it.y).push(it);
  }

  insert(item: T): void {
    this.cellOf(item.x, item.y).push(item);
  }

  private cellOf(x: number, y: number): T[] {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.cols - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return this.cells[cy * this.cols + cx]!;
  }

  /**
   * Every item in cells overlapping the (padded) radius. Returns a scratch
   * array reused by the next call — consume it immediately.
   */
  near(x: number, y: number, radius: number): readonly T[] {
    const r = radius + this.slack;
    const x0 = Math.min(this.cols - 1, Math.max(0, Math.floor((x - r) / this.cellSize)));
    const x1 = Math.min(this.cols - 1, Math.max(0, Math.floor((x + r) / this.cellSize)));
    const y0 = Math.min(this.cols - 1, Math.max(0, Math.floor((y - r) / this.cellSize)));
    const y1 = Math.min(this.cols - 1, Math.max(0, Math.floor((y + r) / this.cellSize)));
    const out = this.scratch;
    out.length = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.cols + cx]!;
        for (let i = 0; i < cell.length; i++) out.push(cell[i]!);
      }
    }
    return out;
  }
}
