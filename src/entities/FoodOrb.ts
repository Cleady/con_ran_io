import { ORB_COLORS } from '../types';
import { Snake } from './Snake';

export type FoodOrbType = 'ambient' | 'boost' | 'death';

let nextOrbId = 1;

export class FoodOrb {
  public readonly id: number;
  public x: number;
  public y: number;
  public baseX: number;
  public baseY: number;
  public value: number;
  public radius: number;
  public colorIndex: number;
  public phase: number;
  public type: FoodOrbType;
  public age = 0;
  public alive = true;

  // Magnetic pull state
  public attractedBy: Snake | null = null;
  public attractTimer = 0;
  public readonly attractDuration = 0.12;
  public startX = 0;
  public startY = 0;

  private readonly driftRadius: number;

  constructor(
    x: number,
    y: number,
    value: number,
    type: FoodOrbType,
    colorIndex?: number
  ) {
    this.id = nextOrbId++;
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.baseY = y;
    this.value = value;
    this.type = type;
    this.colorIndex =
      colorIndex !== undefined
        ? ((colorIndex % ORB_COLORS.length) + ORB_COLORS.length) % ORB_COLORS.length
        : Math.floor(Math.random() * ORB_COLORS.length);
    this.phase = Math.random() * Math.PI * 2;

    if (type === 'death') {
      this.radius = Math.min(18, 9.5 + Math.sqrt(value) * 2.1);
      this.driftRadius = 5.5;
    } else if (type === 'boost') {
      this.radius = 6.2;
      this.driftRadius = 4.0;
    } else {
      this.radius = 4.8 + Math.min(4.8, value * 2.1);
      this.driftRadius = 7.5;
    }
  }

  public startAttraction(snake: Snake): void {
    if (this.attractedBy !== null) return;
    this.attractedBy = snake;
    this.attractTimer = 0;
    this.startX = this.x;
    this.startY = this.y;
  }

  /**
   * Updates idle sinusoidal bobbing OR magnetic acceleration into the target snake's mouth.
   * Returns true if the orb has been consumed this frame.
   */
  public update(dt: number, worldTime: number): boolean {
    if (!this.alive) return false;
    this.age += dt;

    if (this.attractedBy) {
      if (!this.attractedBy.alive) {
        // Release orb gracefully if the attracting snake died mid-pull
        this.attractedBy = null;
        this.baseX = this.x;
        this.baseY = this.y;
        return false;
      }

      this.attractTimer += dt;
      const t = Math.min(1, this.attractTimer / this.attractDuration);
      // Accelerating ease-in curve with slight swirl toward the mouth
      const ease = t * t * (2 - t * 0.4);
      const targetX = this.attractedBy.x;
      const targetY = this.attractedBy.y;

      const dx = targetX - this.startX;
      const dy = targetY - this.startY;
      // Subtle perpendicular arc so the pull looks organic and fluid
      const arc = Math.sin(t * Math.PI) * 10 * (this.id % 2 === 0 ? 1 : -1);
      const len = Math.hypot(dx, dy) || 1;
      const perpX = -dy / len;
      const perpY = dx / len;

      this.x = this.startX + dx * ease + perpX * arc;
      this.y = this.startY + dy * ease + perpY * arc;

      const remDx = targetX - this.x;
      const remDy = targetY - this.y;
      if (t >= 1 || remDx * remDx + remDy * remDy < this.attractedBy.radius * this.attractedBy.radius * 0.5) {
        this.attractedBy.addMass(this.value);
        this.alive = false;
        return true;
      }
      return false;
    }

    // Idle sinusoidal floating drift
    const speed = this.type === 'death' ? 2.4 : 1.5;
    this.x = this.baseX + Math.cos(worldTime * speed + this.phase) * this.driftRadius;
    this.y = this.baseY + Math.sin(worldTime * (speed * 1.17) + this.phase * 1.3) * this.driftRadius;

    // Soft expiry on very old boost/death orbs so arena never bloats indefinitely
    if (this.type === 'boost' && this.age > 28) {
      this.alive = false;
    } else if (this.type === 'death' && this.age > 55) {
      this.alive = false;
    }

    return false;
  }
}
