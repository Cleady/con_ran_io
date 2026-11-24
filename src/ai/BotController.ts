import { SpatialHashGrid } from '../core/SpatialHashGrid';
import { FoodOrb } from '../entities/FoodOrb';
import { Snake, SnakeSegmentProxy } from '../entities/Snake';
import { BOOST_MIN_MASS, WORLD_RADIUS, normalizeAngle } from '../types';

export type BotArchetype = 'cautious' | 'opportunist' | 'aggressive' | 'hunter';

const BOT_NAMES: string[] = [
  'NeonViper',
  'HyperCoil',
  'ShadowFang',
  'KobraKai',
  'VoidSerpent',
  'GlitchTail',
  'ApexScale',
  'NovaSnek',
  'CyberMamba',
  'FrostBite',
  'TurboSlither',
  'SolarFlare',
  'VenomPulse',
  'StarDrifter',
  'PhantomCoil',
  'PixelHydra',
  'CrimsonArc',
  'ZestWinder',
  'LaserBoa',
  'OmegaWorm',
  'VortexJaws',
  'DriftKing',
  'SilentFang',
  'RiftRunner',
  'EchoNoodle',
  'ByteCobra',
  'PrismTail',
  'CobaltAdder',
  'BlazeTrack',
  'SparkCoil',
  'AstroEel',
  'VelvetViper',
  'FluxHunter',
  'TitanScale',
  'QuickStrike',
  'NimbusSnek',
  'MirageTail',
  'AetherFang',
  'QuantumBoa',
  'ZephyrCoil',
];

const FEELER_ANGLES = [0, -0.42, 0.42, -0.92, 0.92];

export class BotController {
  public readonly snake: Snake;
  public readonly archetype: BotArchetype;

  private decisionTimer = 0;
  private wanderPhase: number;
  private wanderFreq: number;
  private boostBurstTimer = 0;
  private interceptCooldown = 0;
  private desiredAngle: number;
  private desiredBoost = false;

  constructor(snake: Snake) {
    this.snake = snake;
    const roll = Math.random();
    if (roll < 0.25) {
      this.archetype = 'cautious';
    } else if (roll < 0.55) {
      this.archetype = 'opportunist';
    } else if (roll < 0.82) {
      this.archetype = 'aggressive';
    } else {
      this.archetype = 'hunter';
    }

    this.wanderPhase = Math.random() * Math.PI * 2;
    this.wanderFreq = 0.45 + Math.random() * 0.55;
    this.desiredAngle = snake.angle;
    // Stagger initial decision tick so 30 bots don't spike on the same frame
    this.decisionTimer = Math.random() * 0.08;
  }

  public static pickRandomName(activeNames: Set<string>): string {
    const available = BOT_NAMES.filter((n) => !activeNames.has(n));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
    return `Viper_${Math.floor(100 + Math.random() * 900)}`;
  }

  public update(
    dt: number,
    worldTime: number,
    segmentGrid: SpatialHashGrid<SnakeSegmentProxy>,
    foodGrid: SpatialHashGrid<FoodOrb>,
    allSnakes: Snake[]
  ): void {
    if (!this.snake.alive) return;

    this.decisionTimer -= dt;
    if (this.boostBurstTimer > 0) this.boostBurstTimer -= dt;
    if (this.interceptCooldown > 0) this.interceptCooldown -= dt;

    if (this.decisionTimer <= 0) {
      // Run AI perception at ~15Hz (super responsive + very low CPU)
      this.decisionTimer = 0.06 + Math.random() * 0.025;
      this.evaluateSteering(worldTime, segmentGrid, foodGrid, allSnakes);
    }

    this.snake.targetAngle = this.desiredAngle;
    this.snake.wantsBoost = this.desiredBoost || this.boostBurstTimer > 0;
  }

  private evaluateSteering(
    worldTime: number,
    segmentGrid: SpatialHashGrid<SnakeSegmentProxy>,
    foodGrid: SpatialHashGrid<FoodOrb>,
    allSnakes: Snake[]
  ): void {
    const s = this.snake;
    const heading = s.angle;
    this.desiredBoost = false;

    // ---------------------------------------------------------
    // 1. BOUNDARY AVOIDANCE (Critical Safety)
    // ---------------------------------------------------------
    const distFromCenter = Math.hypot(s.x, s.y);
    const margin = 460 + s.radius * 3;
    if (distFromCenter > WORLD_RADIUS - margin) {
      const toCenter = Math.atan2(-s.y, -s.x);
      const urgency = Math.min(1, (distFromCenter - (WORLD_RADIUS - margin)) / (margin * 0.65));
      const delta = normalizeAngle(toCenter - heading);
      this.desiredAngle = normalizeAngle(heading + delta * (0.45 + urgency * 0.55));

      // Still check immediate obstacles near the wall
      const wallObstacle = this.checkCollisionAvoidance(segmentGrid);
      if (wallObstacle.danger > 0.7) {
        this.desiredAngle = wallObstacle.escapeAngle;
      }
      return;
    }

    // ---------------------------------------------------------
    // 2. COLLISION AVOIDANCE (Highest Priority — 5 Forward Feelers)
    // ---------------------------------------------------------
    const avoidance = this.checkCollisionAvoidance(segmentGrid);
    if (avoidance.danger > 0.15) {
      this.desiredAngle = avoidance.escapeAngle;
      if (avoidance.boxedIn && s.mass > BOOST_MIN_MASS + 6) {
        this.boostBurstTimer = 0.28;
      }
      return;
    }

    // ---------------------------------------------------------
    // 3. OPPORTUNISTIC LOOT RUSH (High-Value Death Orbs)
    // ---------------------------------------------------------
    const visionRange = this.archetype === 'opportunist' ? 480 : 380;
    let bestDeathClusterX = 0;
    let bestDeathClusterY = 0;
    let deathWeightSum = 0;

    let foodSumX = 0;
    let foodSumY = 0;
    let foodWeightSum = 0;

    foodGrid.query(s.x, s.y, visionRange, (orb) => {
      if (!orb.alive || orb.attractedBy) return;
      const dx = orb.x - s.x;
      const dy = orb.y - s.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > visionRange * visionRange || distSq < 100) return;

      const dist = Math.sqrt(distSq);
      const angleToOrb = Math.atan2(dy, dx);
      const angleDiff = Math.abs(normalizeAngle(angleToOrb - heading));
      // Slight forward preference so bots don't endlessly loop backwards
      const forwardBias = angleDiff < 1.7 ? 1.5 : 0.45;

      if (orb.type === 'death') {
        const w = (orb.value * 4.5 * forwardBias) / (dist + 40);
        bestDeathClusterX += orb.x * w;
        bestDeathClusterY += orb.y * w;
        deathWeightSum += w;
      } else {
        const w = (orb.value * forwardBias) / (dist + 55);
        foodSumX += orb.x * w;
        foodSumY += orb.y * w;
        foodWeightSum += w;
      }
    });

    if (deathWeightSum > 0.16) {
      const tx = bestDeathClusterX / deathWeightSum;
      const ty = bestDeathClusterY / deathWeightSum;
      this.desiredAngle = Math.atan2(ty - s.y, tx - s.x);
      // Rush toward death loot if we have spare mass
      if (
        s.mass > BOOST_MIN_MASS + 8 &&
        (this.archetype === 'opportunist' || this.archetype === 'hunter' || deathWeightSum > 0.42)
      ) {
        const distToLoot = Math.hypot(tx - s.x, ty - s.y);
        if (distToLoot > 90 && distToLoot < 440) {
          this.desiredBoost = true;
        }
      }
      return;
    }

    // ---------------------------------------------------------
    // 4. AGGRESSIVE INTERCEPTION / CUT-OFF
    // ---------------------------------------------------------
    if (
      (this.archetype === 'aggressive' || this.archetype === 'hunter') &&
      s.mass > BOOST_MIN_MASS + 14 &&
      this.interceptCooldown <= 0
    ) {
      const target = this.findInterceptTarget(allSnakes);
      if (target) {
        const leadDist = 110 + target.radius * 3.2;
        const cutX = target.x + Math.cos(target.angle) * leadDist;
        const cutY = target.y + Math.sin(target.angle) * leadDist;
        this.desiredAngle = Math.atan2(cutY - s.y, cutX - s.x);
        this.desiredBoost = true;
        if (Math.random() < 0.08) {
          this.interceptCooldown = 2.5;
        }
        return;
      }
    }

    // ---------------------------------------------------------
    // 5. WANDERING & LOCAL AMBIENT GRAZING
    // ---------------------------------------------------------
    const wanderOffset =
      Math.sin(worldTime * this.wanderFreq + this.wanderPhase) * 0.55 +
      Math.cos(worldTime * (this.wanderFreq * 0.43) + this.wanderPhase * 1.7) * 0.35;

    if (foodWeightSum > 0.025) {
      const fx = foodSumX / foodWeightSum;
      const fy = foodSumY / foodWeightSum;
      const foodAngle = Math.atan2(fy - s.y, fx - s.x);
      const delta = normalizeAngle(foodAngle - heading);
      this.desiredAngle = normalizeAngle(heading + delta * 0.72 + wanderOffset * 0.25);
    } else {
      this.desiredAngle = normalizeAngle(heading + wanderOffset * 0.65);
    }
  }

  private checkCollisionAvoidance(
    segmentGrid: SpatialHashGrid<SnakeSegmentProxy>
  ): { danger: number; escapeAngle: number; boxedIn: boolean } {
    const s = this.snake;
    const heading = s.angle;
    const lookahead = (this.archetype === 'cautious' ? 230 : 185) + s.radius * 3.8 + (s.isBoosting ? 75 : 0);

    let repulseX = 0;
    let repulseY = 0;
    let maxDanger = 0;
    let leftThreats = 0;
    let rightThreats = 0;

    // Sample space around forward lookahead cone using the SpatialHashGrid
    const probeCenterX = s.x + Math.cos(heading) * (lookahead * 0.48);
    const probeCenterY = s.y + Math.sin(heading) * (lookahead * 0.48);
    const queryRadius = lookahead * 0.72;

    segmentGrid.query(probeCenterX, probeCenterY, queryRadius, (proxy) => {
      if (proxy.snake.id === s.id || !proxy.snake.alive) return;

      const dx = proxy.x - s.x;
      const dy = proxy.y - s.y;
      const distSq = dx * dx + dy * dy;
      const safeDist = lookahead + proxy.radius + s.radius;
      if (distSq > safeDist * safeDist || distSq < 0.01) return;

      const dist = Math.sqrt(distSq);
      const angleToObs = Math.atan2(dy, dx);
      const relAngle = normalizeAngle(angleToObs - heading);

      // Focus on obstacles in the forward 140° hemisphere (or immediately beside us)
      if (Math.abs(relAngle) > 1.35 && dist > s.radius + proxy.radius + 45) {
        return;
      }

      // Evaluate alignment against the 5 forward feelers
      let feelerHit = 0;
      for (let i = 0; i < FEELER_ANGLES.length; i++) {
        const diff = Math.abs(normalizeAngle(relAngle - FEELER_ANGLES[i]));
        if (diff < 0.38) {
          const proximity = 1 - Math.min(1, (dist - s.radius - proxy.radius) / lookahead);
          const centerWeight = i === 0 ? 1.35 : i <= 2 ? 1.0 : 0.72;
          const score = Math.max(0, proximity) * centerWeight;
          if (score > feelerHit) feelerHit = score;
        }
      }

      if (feelerHit > 0.05) {
        if (feelerHit > maxDanger) maxDanger = feelerHit;
        const strength = feelerHit * feelerHit * 2.5;
        repulseX -= (dx / dist) * strength;
        repulseY -= (dy / dist) * strength;

        if (relAngle < 0) leftThreats += feelerHit;
        else rightThreats += feelerHit;
      }
    });

    if (maxDanger <= 0.15) {
      return { danger: 0, escapeAngle: heading, boxedIn: false };
    }

    let escapeAngle: number;
    if (repulseX * repulseX + repulseY * repulseY > 0.001) {
      escapeAngle = Math.atan2(repulseY, repulseX);
    } else {
      // Turn sharply away from the denser side
      escapeAngle = normalizeAngle(heading + (leftThreats > rightThreats ? 1.45 : -1.45));
    }

    const boxedIn = leftThreats > 0.85 && rightThreats > 0.85 && maxDanger > 0.6;
    return { danger: maxDanger, escapeAngle, boxedIn };
  }

  private findInterceptTarget(allSnakes: Snake[]): Snake | null {
    const s = this.snake;
    let bestTarget: Snake | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < allSnakes.length; i++) {
      const other = allSnakes[i];
      if (!other.alive || other.id === s.id) continue;
      // Prefer targets of equal or smaller mass (hunters will also challenge larger snakes)
      if (this.archetype === 'aggressive' && other.mass > s.mass * 1.25) continue;

      const dx = other.x - s.x;
      const dy = other.y - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 110 || dist > 330) continue;

      // Target should be roughly beside/ahead and moving somewhat parallel
      const headingDiff = Math.abs(normalizeAngle(other.angle - s.angle));
      const relAngle = Math.abs(normalizeAngle(Math.atan2(dy, dx) - s.angle));
      if (headingDiff < 0.85 && relAngle < 1.15) {
        if (dist < bestScore) {
          bestScore = dist;
          bestTarget = other;
        }
      }
    }

    return bestTarget;
  }
}
