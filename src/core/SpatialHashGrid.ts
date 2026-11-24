import { SPATIAL_CELL_SIZE } from '../types';

export interface SpatialItem {
  x: number;
  y: number;
}

/**
 * Uniform Spatial Hash Grid for O(1) spatial lookups.
 * Uses integer-packed keys and pooled bucket arrays to minimize GC overhead.
 */
export class SpatialHashGrid<T extends SpatialItem> {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly buckets: Map<number, T[]> = new Map();
  private readonly usedKeys: number[] = [];

  constructor(cellSize: number = SPATIAL_CELL_SIZE) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  private hash(cx: number, cy: number): number {
    // Offset coordinates into positive 16-bit signed range (supports +/- 32,768 cells => +/- 6.5M px)
    return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
  }

  /**
   * Clears all buckets without freeing underlying arrays (zero allocation per frame).
   */
  public clear(): void {
    for (let i = 0; i < this.usedKeys.length; i++) {
      const bucket = this.buckets.get(this.usedKeys[i]);
      if (bucket) {
        bucket.length = 0;
      }
    }
    this.usedKeys.length = 0;
  }

  /**
   * Inserts an item at its (x, y) point coordinate.
   */
  public insert(item: T): void {
    const cx = Math.floor(item.x * this.invCellSize);
    const cy = Math.floor(item.y * this.invCellSize);
    const key = this.hash(cx, cy);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    if (bucket.length === 0) {
      this.usedKeys.push(key);
    }
    bucket.push(item);
  }

  /**
   * Queries all items in cells intersecting the square bounding box [x - radius, x + radius].
   * Invokes callback(item) for each candidate; return false from callback to abort early.
   */
  public query(
    x: number,
    y: number,
    radius: number,
    callback: (item: T) => boolean | void
  ): void {
    const minCx = Math.floor((x - radius) * this.invCellSize);
    const maxCx = Math.floor((x + radius) * this.invCellSize);
    const minCy = Math.floor((y - radius) * this.invCellSize);
    const maxCy = Math.floor((y + radius) * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this.hash(cx, cy));
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          if (callback(bucket[i]) === false) {
            return;
          }
        }
      }
    }
  }

  /**
   * Queries all items in cells intersecting an explicit AABB (great for viewport culling).
   */
  public queryBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    callback: (item: T) => void
  ): void {
    const minCx = Math.floor(minX * this.invCellSize);
    const maxCx = Math.floor(maxX * this.invCellSize);
    const minCy = Math.floor(minY * this.invCellSize);
    const maxCy = Math.floor(maxY * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this.hash(cx, cy));
        if (!bucket || bucket.length === 0) continue;
        for (let i = 0; i < bucket.length; i++) {
          callback(bucket[i]);
        }
      }
    }
  }

  public getCellSize(): number {
    return this.cellSize;
  }
}
