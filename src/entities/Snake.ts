import {
  BASE_RADIUS,
  BASE_SPEED,
  BASE_TURN_SPEED,
  BOOST_MIN_MASS,
  BOOST_SPEED_MULT,
  MIN_MASS,
  Segment,
  SkinDefinition,
  clamp,
  lerp,
  massToDisplayLength,
  massToRadius,
  massToSegmentCount,
  normalizeAngle,
} from '../types';

export interface PathVertex {
  x: number;
  y: number;
  cumDist: number;
}

export interface SnakeSegmentProxy {
  snake: Snake;
  segIndex: number;
  x: number;
  y: number;
  radius: number;
}

export interface BoostDropEvent {
  x: number;
  y: number;
  value: number;
  colorIndex: number;
}

let nextSnakeId = 1;

export class Snake {
  public readonly id: number;
  public readonly isPlayer: boolean;
  public name: string;
  public skin: SkinDefinition;

  public x: number;
  public y: number;
  public angle: number;
  public targetAngle: number;
  public speed: number = BASE_SPEED;

  public mass: number;
  public radius: number;
  public segmentSpacing: number;
  public segments: Segment[] = [];
  public segmentProxies: SnakeSegmentProxy[] = [];

  public wantsBoost = false;
  public isBoosting = false;
  public boostIntensity = 0; // 0..1 smooth visual ramp
  public boostPulsePhase = 0;

  public alive = true;
  public kills = 0;
  public spawnTime: number;

  // World-space AABB for O(1) viewport culling
  public minX = 0;
  public maxX = 0;
  public minY = 0;
  public maxY = 0;

  // High-resolution polyline history (head is at path[path.length - 1])
  private path: PathVertex[] = [];
  private boostDrainAccum = 0;
  private readonly boostOrbColorIndex: number;

  constructor(
    x: number,
    y: number,
    angle: number,
    initialMass: number,
    name: string,
    skin: SkinDefinition,
    isPlayer: boolean,
    nowSec: number
  ) {
    this.id = nextSnakeId++;
    this.isPlayer = isPlayer;
    this.name = name;
    this.skin = skin;
    this.x = x;
    this.y = y;
    this.angle = normalizeAngle(angle);
    this.targetAngle = this.angle;
    this.mass = Math.max(MIN_MASS, initialMass);
    this.radius = massToRadius(this.mass);
    this.segmentSpacing = this.radius * 0.48;
    this.spawnTime = nowSec;
    this.boostOrbColorIndex = Math.floor(Math.random() * 10);

    this.initPathAndSegments();
  }

  private initPathAndSegments(): void {
    const segCount = massToSegmentCount(this.mass);
    const totalLength = (segCount + 2) * this.segmentSpacing;
    const step = 4;
    const numPts = Math.max(8, Math.ceil(totalLength / step));
    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);

    this.path.length = 0;
    for (let i = numPts; i >= 0; i--) {
      const backDist = i * step;
      this.path.push({
        x: this.x - dx * backDist,
        y: this.y - dy * backDist,
        cumDist: (numPts - i) * step,
      });
    }

    this.resampleSegments();
  }

  public get displayLength(): number {
    return massToDisplayLength(this.mass);
  }

  public get eatRadius(): number {
    return this.radius * 2.4;
  }

  public get maxTurnSpeed(): number {
    // Nimble when small, wider turning radius as snake grows thicker
    const sizeFactor = Math.max(0, this.radius - BASE_RADIUS);
    return BASE_TURN_SPEED / (1 + sizeFactor * 0.036);
  }

  public addMass(amount: number): void {
    if (!this.alive) return;
    this.mass = Math.max(MIN_MASS, this.mass + amount);
  }

  /**
   * Advances steering, boost physics, path recording, and arc-length segment resampling.
   * Returns an optional BoostDropEvent if a tail exhaust orb should be spawned this tick.
   */
  public update(dt: number): BoostDropEvent | null {
    if (!this.alive) return null;

    // 1. Boost eligibility & mass drain
    this.isBoosting = this.wantsBoost && this.mass > BOOST_MIN_MASS;
    let boostDrop: BoostDropEvent | null = null;

    if (this.isBoosting) {
      // Drain mass smoothly while boosting
      const drainRate = 3.8 + this.mass * 0.0025;
      const drained = Math.min(this.mass - BOOST_MIN_MASS + 0.05, drainRate * dt);
      this.mass = Math.max(MIN_MASS, this.mass - drained);
      this.boostDrainAccum += drained;

      // Spawn a glowing exhaust orb behind the tail tip every ~1.25 mass drained
      if (this.boostDrainAccum >= 1.25) {
        this.boostDrainAccum -= 1.25;
        const tail = this.segments[this.segments.length - 1] ?? {
          x: this.x,
          y: this.y,
          angle: this.angle,
        };
        const jitterX = (Math.random() - 0.5) * this.radius * 0.6;
        const jitterY = (Math.random() - 0.5) * this.radius * 0.6;
        boostDrop = {
          x: tail.x - Math.cos(tail.angle) * this.radius * 0.65 + jitterX,
          y: tail.y - Math.sin(tail.angle) * this.radius * 0.65 + jitterY,
          value: 1.05,
          colorIndex: this.boostOrbColorIndex,
        };
      }

      if (this.mass <= BOOST_MIN_MASS) {
        this.isBoosting = false;
      }
    }

    // Smooth visual boost glow ramp & traveling spine pulse
    const targetBoostIntensity = this.isBoosting ? 1 : 0;
    this.boostIntensity = lerp(this.boostIntensity, targetBoostIntensity, clamp(dt * 10, 0, 1));
    if (this.boostIntensity > 0.01) {
      this.boostPulsePhase += dt * 11;
    }

    // 2. Smooth speed interpolation
    const targetSpeed = this.isBoosting ? BASE_SPEED * BOOST_SPEED_MULT : BASE_SPEED;
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * 12, 0, 1));

    // 3. Continuous 360° angular steering clamped by maxTurnSpeed
    const diff = normalizeAngle(this.targetAngle - this.angle);
    const maxStep = this.maxTurnSpeed * dt;
    if (Math.abs(diff) <= maxStep) {
      this.angle = normalizeAngle(this.targetAngle);
    } else {
      this.angle = normalizeAngle(this.angle + Math.sign(diff) * maxStep);
    }

    // 4. Advance head along heading and append to polyline history
    const moveDist = this.speed * dt;
    this.x += Math.cos(this.angle) * moveDist;
    this.y += Math.sin(this.angle) * moveDist;

    const lastPt = this.path[this.path.length - 1];
    if (moveDist > 0.0001) {
      this.path.push({
        x: this.x,
        y: this.y,
        cumDist: lastPt.cumDist + moveDist,
      });
    }

    // 5. Update body radius & arc-length spacing smoothly
    const targetRadius = massToRadius(this.mass);
    this.radius = lerp(this.radius, targetRadius, clamp(dt * 8, 0, 1));
    this.segmentSpacing = this.radius * 0.48;

    // 6. Resample exact segments along path history
    this.resampleSegments();

    return boostDrop;
  }

  /**
   * Walks backward along the recorded head polyline at exact fixed arc-length
   * intervals (this.segmentSpacing) so segments never bunch up or stretch during boost.
   */
  private resampleSegments(): void {
    const segCount = massToSegmentCount(this.mass);
    const path = this.path;
    const lastIdx = path.length - 1;
    const headDist = path[lastIdx].cumDist;
    const spacing = this.segmentSpacing;

    // Grow or shrink pooled arrays without reallocating objects unnecessarily
    while (this.segments.length < segCount) {
      this.segments.push({ x: this.x, y: this.y, angle: this.angle });
    }
    this.segments.length = segCount;

    while (this.segmentProxies.length < segCount) {
      const idx = this.segmentProxies.length;
      this.segmentProxies.push({
        snake: this,
        segIndex: idx,
        x: this.x,
        y: this.y,
        radius: this.radius,
      });
    }
    this.segmentProxies.length = segCount;

    // Segment 0 is the head
    const headSeg = this.segments[0];
    headSeg.x = this.x;
    headSeg.y = this.y;
    headSeg.angle = this.angle;

    const headProxy = this.segmentProxies[0];
    headProxy.x = this.x;
    headProxy.y = this.y;
    headProxy.radius = this.radius;

    let minX = this.x;
    let maxX = this.x;
    let minY = this.y;
    let maxY = this.y;

    let pIdx = lastIdx;

    for (let k = 1; k < segCount; k++) {
      const targetDist = headDist - k * spacing;

      while (pIdx > 1 && path[pIdx - 1].cumDist > targetDist) {
        pIdx--;
      }

      const pA = path[pIdx - 1];
      const pB = path[pIdx];
      const span = pB.cumDist - pA.cumDist;

      let sx: number;
      let sy: number;
      let sAngle: number;

      if (span > 0.00001) {
        const t = clamp((targetDist - pA.cumDist) / span, 0, 1);
        sx = pA.x + (pB.x - pA.x) * t;
        sy = pA.y + (pB.y - pA.y) * t;
        sAngle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
      } else {
        sx = pA.x;
        sy = pA.y;
        sAngle = this.segments[k - 1].angle;
      }

      const seg = this.segments[k];
      seg.x = sx;
      seg.y = sy;
      seg.angle = sAngle;

      // Tail tapers slightly over the final 4 segments for organic silhouette
      let segRadius = this.radius;
      const fromTail = segCount - 1 - k;
      if (fromTail < 4) {
        segRadius = this.radius * (0.68 + fromTail * 0.08);
      }

      const proxy = this.segmentProxies[k];
      proxy.segIndex = k;
      proxy.x = sx;
      proxy.y = sy;
      proxy.radius = segRadius;

      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }

    const pad = this.radius * 2.2;
    this.minX = minX - pad;
    this.maxX = maxX + pad;
    this.minY = minY - pad;
    this.maxY = maxY + pad;

    // Trim stale tail path vertices periodically to keep memory bounded
    if (pIdx > 140) {
      const removeCount = pIdx - 24;
      path.splice(0, removeCount);
    }
  }
}
