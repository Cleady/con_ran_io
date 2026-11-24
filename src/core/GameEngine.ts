import { BotController } from '../ai/BotController';
import { SoundManager } from '../audio/SoundManager';
import { FoodOrb } from '../entities/FoodOrb';
import { Snake, SnakeSegmentProxy } from '../entities/Snake';
import { CameraState, Renderer } from '../rendering/Renderer';
import {
  BASE_RADIUS,
  DEATH_TRANSITION_DURATION,
  GameOverStats,
  GameState,
  LeaderboardEntry,
  MAX_RADIUS,
  MIN_MASS,
  ORB_COLORS,
  Particle,
  SKINS,
  SPATIAL_CELL_SIZE,
  SkinDefinition,
  TARGET_AMBIENT_ORBS,
  TARGET_BOT_COUNT,
  WORLD_RADIUS,
  clamp,
  lerp,
} from '../types';
import { UIManager } from '../ui/UIManager';
import { InputManager } from './InputManager';
import { SpatialHashGrid } from './SpatialHashGrid';

interface PendingDeath {
  snake: Snake;
  killer: Snake | null;
  reason: string;
}

export class GameEngine {
  private readonly renderer: Renderer;
  private readonly input: InputManager;
  private readonly sound: SoundManager;
  private readonly ui: UIManager;

  private readonly foodGrid: SpatialHashGrid<FoodOrb> = new SpatialHashGrid(SPATIAL_CELL_SIZE);
  private readonly segmentGrid: SpatialHashGrid<SnakeSegmentProxy> = new SpatialHashGrid(SPATIAL_CELL_SIZE);

  private snakes: Snake[] = [];
  private bots: BotController[] = [];
  private orbs: FoodOrb[] = [];
  private particles: Particle[] = [];
  private ambientOrbCount = 0;

  private player: Snake | null = null;
  private state: GameState = 'MENU';
  private worldTime = 0;
  private lastFrameMs = 0;
  private rafId = 0;

  // Camera state
  private camera: CameraState = {
    x: 0,
    y: 0,
    zoom: 0.9,
    shakeX: 0,
    shakeY: 0,
  };
  private shakeIntensity = 0;
  private deathTimer = 0;
  private deathFocusX = 0;
  private deathFocusY = 0;
  private spectateTargetId = -1;

  // Session stats
  private playerPeakRank = TARGET_BOT_COUNT + 1;
  private playerFinalStats: GameOverStats | null = null;

  // Throttled HUD & FPS smoothing
  private hudUpdateAccum = 0;
  private botRespawnAccum = 0;
  private smoothFps = 60;
  private currentLeader: Snake | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    minimapCanvas: HTMLCanvasElement
  ) {
    this.renderer = new Renderer(canvas, minimapCanvas);
    this.input = new InputManager(canvas);
    this.sound = new SoundManager();

    this.ui = new UIManager(
      {
        onPlay: (nickname, skin) => this.startGame(nickname, skin),
        onChangeSkin: () => this.returnToMenu(),
        onToggleMute: () => this.sound.toggleMute(),
        onToggleNameplates: () => {
          this.renderer.showNameplates = !this.renderer.showNameplates;
          return this.renderer.showNameplates;
        },
      },
      this.sound.isMuted()
    );

    window.addEventListener('resize', () => this.renderer.resize());

    this.initWorld();
    this.ui.setState('MENU');
  }

  public start(): void {
    this.lastFrameMs = performance.now();
    const tick = (nowMs: number) => {
      const rawDt = (nowMs - this.lastFrameMs) / 1000;
      this.lastFrameMs = nowMs;
      // Clamped timestep (max 0.05s) for rock-solid physics stability
      const dt = clamp(rawDt, 0.001, 0.05);

      if (rawDt > 0.0005) {
        const instFps = 1 / rawDt;
        this.smoothFps = lerp(this.smoothFps, clamp(instFps, 1, 240), 0.08);
      }

      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public stop(): void {
    cancelAnimationFrame(this.rafId);
    this.sound.dispose();
  }

  // ---------------------------------------------------------------------------
  // World Initialization & Spawning
  // ---------------------------------------------------------------------------

  private initWorld(): void {
    this.snakes = [];
    this.bots = [];
    this.orbs = [];
    this.particles = [];
    this.ambientOrbCount = 0;

    // Seed ~1400 glowing ambient orbs uniformly across circular arena
    for (let i = 0; i < TARGET_AMBIENT_ORBS; i++) {
      this.spawnAmbientOrb();
    }

    // Seed live population of 30 AI bots with realistic size distribution
    for (let i = 0; i < TARGET_BOT_COUNT; i++) {
      const roll = Math.random();
      let initialMass = MIN_MASS + Math.random() * 24;
      if (roll > 0.88) {
        // A few large contenders roaming the arena
        initialMass = 85 + Math.random() * 140;
      } else if (roll > 0.62) {
        initialMass = 32 + Math.random() * 55;
      }
      this.spawnBot(initialMass);
    }

    // Focus camera near the center/leader initially
    if (this.snakes.length > 0) {
      this.camera.x = this.snakes[0].x;
      this.camera.y = this.snakes[0].y;
    }
  }

  private spawnAmbientOrb(): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * (WORLD_RADIUS - 90);
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist;
    const value = Math.random() < 0.16 ? 1.4 + Math.random() * 0.9 : 0.65 + Math.random() * 0.55;
    this.orbs.push(new FoodOrb(x, y, value, 'ambient'));
    this.ambientOrbCount++;
  }

  private findSafeSpawnPoint(maxRadiusRatio: number = 0.82): { x: number; y: number } {
    let bestX = 0;
    let bestY = 0;
    let bestMinDistSq = -1;

    const candidates = 14;
    for (let c = 0; c < candidates; c++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (WORLD_RADIUS * maxRadiusRatio);
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;

      let nearestSq = Infinity;
      for (let i = 0; i < this.snakes.length; i++) {
        const s = this.snakes[i];
        if (!s.alive) continue;
        // Sample head and every 4th segment for fast safety check
        for (let k = 0; k < s.segments.length; k += 4) {
          const seg = s.segments[k];
          const dx = cx - seg.x;
          const dy = cy - seg.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < nearestSq) nearestSq = dSq;
        }
      }

      if (nearestSq > bestMinDistSq) {
        bestMinDistSq = nearestSq;
        bestX = cx;
        bestY = cy;
      }
    }

    return { x: bestX, y: bestY };
  }

  private spawnBot(initialMass?: number): void {
    const activeNames = new Set<string>();
    for (let i = 0; i < this.snakes.length; i++) {
      if (this.snakes[i].alive) activeNames.add(this.snakes[i].name);
    }

    const pos = this.findSafeSpawnPoint(0.84);
    const angle = Math.atan2(-pos.y, -pos.x) + (Math.random() - 0.5) * 2.2;
    const mass = initialMass ?? (MIN_MASS + Math.random() * 26 + (Math.random() < 0.14 ? 45 + Math.random() * 65 : 0));
    const skin = SKINS[Math.floor(Math.random() * SKINS.length)];
    const name = BotController.pickRandomName(activeNames);

    const snake = new Snake(pos.x, pos.y, angle, mass, name, skin, false, this.worldTime);
    this.snakes.push(snake);
    this.bots.push(new BotController(snake));
  }

  // ---------------------------------------------------------------------------
  // State Transitions
  // ---------------------------------------------------------------------------

  private startGame(nickname: string, skin: SkinDefinition): void {
    this.sound.unlock();

    // Remove previous dead player reference if any
    if (this.player && this.player.alive) {
      this.player.alive = false;
    }

    const pos = this.findSafeSpawnPoint(0.72);
    const angle = Math.atan2(-pos.y, -pos.x) + (Math.random() - 0.5) * 1.4;
    const player = new Snake(pos.x, pos.y, angle, MIN_MASS, nickname, skin, true, this.worldTime);

    this.player = player;
    this.snakes.push(player);
    this.playerPeakRank = this.snakes.length;
    this.playerFinalStats = null;
    this.shakeIntensity = 0;

    // Snap camera gently near player spawn so transition feels immediate & crisp
    this.camera.x = player.x;
    this.camera.y = player.y;
    this.camera.zoom = 1.02;

    this.input.setInitialAngle(angle);
    this.input.setEnabled(true);
    this.state = 'PLAYING';
    this.ui.setState('PLAYING');
    this.updateLeaderboardAndHUD();
  }

  private returnToMenu(): void {
    this.state = 'MENU';
    this.input.setEnabled(false);
    this.sound.setBoosting(false);
    this.ui.setState('MENU');
  }

  // ---------------------------------------------------------------------------
  // Core Simulation Loop
  // ---------------------------------------------------------------------------

  private update(dt: number): void {
    this.worldTime += dt;

    // 1. Rebuild SpatialHashGrids (zero-GC bucket reuse)
    this.rebuildSpatialGrids();

    // 2. Update Player Input
    if (this.state === 'PLAYING' && this.player && this.player.alive) {
      this.player.targetAngle = this.input.getTargetAngle(this.player.angle);
      this.player.wantsBoost = this.input.isBoostPressed();
      this.sound.setBoosting(this.player.isBoosting);
    } else {
      this.sound.setBoosting(false);
    }

    // 3. Update AI Controllers
    for (let i = 0; i < this.bots.length; i++) {
      this.bots[i].update(dt, this.worldTime, this.segmentGrid, this.foodGrid, this.snakes);
    }

    // 4. Advance Snake Kinematics & Spawn Boost Exhaust Orbs
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.alive) continue;
      const boostDrop = s.update(dt);
      if (boostDrop) {
        this.orbs.push(
          new FoodOrb(boostDrop.x, boostDrop.y, boostDrop.value, 'boost', boostDrop.colorIndex)
        );
        // Subtle boost tail spark
        if (Math.random() < 0.45 && this.particles.length < 360) {
          this.particles.push({
            x: boostDrop.x,
            y: boostDrop.y,
            vx: (Math.random() - 0.5) * 45,
            vy: (Math.random() - 0.5) * 45,
            radius: 3.5 + Math.random() * 2.5,
            life: 0.28,
            maxLife: 0.28,
            colorIndex: boostDrop.colorIndex,
          });
        }
      }
    }

    // 5. Refresh segment grid with latest positions before exact collision checks
    this.rebuildSegmentGrid();

    // 6. Food Magnetic Pull & Consumption
    this.updateFoodAndMagnetism(dt);

    // 7. Boundary, Head-to-Body, and Head-to-Head Collisions
    this.resolveCollisions();

    // 8. Update Particles
    this.updateParticles(dt);

    // 9. Replenish Ambient Orbs & Maintain Bot Population (~30 bots)
    this.maintainArenaPopulation(dt);

    // 10. Death Transition Timer (1.2s linger before Game Over card)
    if (this.state === 'DYING') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0 && this.playerFinalStats) {
        this.state = 'GAMEOVER';
        this.ui.showGameOver(this.playerFinalStats);
      }
    }

    // 11. Update Camera Smooth Lerp, Dynamic Zoom & Screen Shake
    this.updateCamera(dt);

    // 12. Throttled HUD & Leaderboard Update (~10Hz)
    this.hudUpdateAccum += dt;
    if (this.hudUpdateAccum >= 0.1) {
      this.hudUpdateAccum = 0;
      this.updateLeaderboardAndHUD();
    }
  }

  private rebuildSpatialGrids(): void {
    this.foodGrid.clear();
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      if (orb.alive) {
        this.foodGrid.insert(orb);
      }
    }
    this.rebuildSegmentGrid();
  }

  private rebuildSegmentGrid(): void {
    this.segmentGrid.clear();
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.alive) continue;
      const proxies = s.segmentProxies;
      for (let k = 0; k < proxies.length; k++) {
        this.segmentGrid.insert(proxies[k]);
      }
    }
  }

  private updateFoodAndMagnetism(dt: number): void {
    // Initiate magnetic pull for orbs entering any snake's eatRadius (headRadius * 2.4)
    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.alive) continue;
      const eatR = s.eatRadius;
      const eatRSq = eatR * eatR;

      this.foodGrid.query(s.x, s.y, eatR, (orb) => {
        if (!orb.alive || orb.attractedBy !== null) return;
        const dx = orb.x - s.x;
        const dy = orb.y - s.y;
        if (dx * dx + dy * dy <= eatRSq) {
          orb.startAttraction(s);
        }
      });
    }

    // Update all orbs and compact dead orbs in-place
    let writeIdx = 0;
    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      const consumed = orb.update(dt, this.worldTime);
      if (consumed && orb.attractedBy?.isPlayer) {
        this.sound.playEat(orb.value);
      }
      if (orb.alive) {
        this.orbs[writeIdx++] = orb;
      } else if (orb.type === 'ambient') {
        this.ambientOrbCount = Math.max(0, this.ambientOrbCount - 1);
      }
    }
    this.orbs.length = writeIdx;
  }

  private resolveCollisions(): void {
    const deaths: PendingDeath[] = [];
    const dyingIds = new Set<number>();

    const markDeath = (snake: Snake, killer: Snake | null, reason: string) => {
      if (dyingIds.has(snake.id)) return;
      dyingIds.add(snake.id);
      deaths.push({ snake, killer, reason });
    };

    for (let i = 0; i < this.snakes.length; i++) {
      const s = this.snakes[i];
      if (!s.alive || dyingIds.has(s.id)) continue;

      // 1. Arena Boundary Collision
      const distOrigin = Math.hypot(s.x, s.y);
      if (distOrigin + s.radius >= WORLD_RADIUS) {
        markDeath(s, null, 'Touched the crimson arena barrier');
        continue;
      }

      // 2. Head-to-Body & Head-to-Head Collision via SpatialHashGrid
      const queryR = s.radius + MAX_RADIUS + 8;
      this.segmentGrid.query(s.x, s.y, queryR, (proxy) => {
        const other = proxy.snake;
        // Never collide with self!
        if (other.id === s.id || !other.alive) return;

        const dx = proxy.x - s.x;
        const dy = proxy.y - s.y;
        const distSq = dx * dx + dy * dy;

        if (proxy.segIndex > 0) {
          // Head-to-Body check
          const hitDist = (s.radius + proxy.radius) * 0.84;
          if (distSq < hitDist * hitDist) {
            markDeath(s, other, `Collided with ${other.name}`);
            return false;
          }
        } else {
          // Head-to-Head check (resolve by relative facing angles)
          const hitDist = (s.radius + other.radius) * 0.86;
          if (distSq < hitDist * hitDist && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const ny = dy / dist;

            // Alignment of each snake's nose toward the other snake's head
            const dotSelf = Math.cos(s.angle) * nx + Math.sin(s.angle) * ny;
            const dotOther = Math.cos(other.angle) * -nx + Math.sin(other.angle) * -ny;

            if (dotSelf > 0.35 && dotOther > 0.35 && Math.abs(dotSelf - dotOther) < 0.32) {
              // Nose-to-nose mutual collision
              markDeath(s, other, `Head-on clash with ${other.name}`);
              markDeath(other, s, `Head-on clash with ${s.name}`);
            } else if (dotSelf >= dotOther) {
              // Self struck the side/front of other
              markDeath(s, other, `Outmaneuvered by ${other.name}`);
            } else {
              // Other struck the side of self
              markDeath(other, s, `Outmaneuvered by ${s.name}`);
            }
            return false;
          }
        }
        return true;
      });
    }

    // Execute all deaths simultaneously so simultaneous head-ons resolve fairly
    for (let i = 0; i < deaths.length; i++) {
      const { snake, killer, reason } = deaths[i];
      this.killSnake(snake, killer, reason);
    }

    // Compact dead snakes & bots
    if (deaths.length > 0) {
      this.snakes = this.snakes.filter((s) => s.alive);
      this.bots = this.bots.filter((b) => b.snake.alive);
    }
  }

  private killSnake(snake: Snake, killer: Snake | null, reason: string): void {
    if (!snake.alive) return;
    snake.alive = false;

    if (killer && killer.alive && killer.id !== snake.id) {
      killer.kills++;
      if (killer.isPlayer) {
        this.sound.playKill();
        this.ui.showKillToast(snake.name);
      }
    }

    // Convert entire snake body into a dense trail of large glowing death-loot orbs
    const segs = snake.segments;
    const totalLootMass = Math.max(8, snake.mass * 0.78);
    // Drop dense trail along spine (1 orb per segment up to ~85 orbs so mega-deaths stay 60fps)
    const step = Math.max(1, Math.floor(segs.length / 80));
    const dropCount = Math.max(1, Math.ceil(segs.length / step));
    const valuePerOrb = clamp(totalLootMass / dropCount, 1.8, 18);

    // Pick a color index harmonious with the snake's skin or vivid neon variety
    const baseColorIdx = Math.floor(Math.random() * ORB_COLORS.length);
    for (let i = 0; i < segs.length; i += step) {
      const seg = segs[i];
      const jitterR = snake.radius * 0.65;
      const ox = seg.x + (Math.random() - 0.5) * 2 * jitterR;
      const oy = seg.y + (Math.random() - 0.5) * 2 * jitterR;
      const colorIdx = (baseColorIdx + (i % 3)) % ORB_COLORS.length;
      this.orbs.push(new FoodOrb(ox, oy, valuePerOrb, 'death', colorIdx));
    }

    // Emit glowing particle burst along body (if near viewport or player)
    const distToCam = Math.hypot(snake.x - this.camera.x, snake.y - this.camera.y);
    if (snake.isPlayer || distToCam < 1600) {
      const sparkCount = Math.min(75, Math.max(24, Math.floor(segs.length * 0.8)));
      for (let i = 0; i < sparkCount; i++) {
        if (this.particles.length >= 420) break;
        const seg = segs[Math.floor((i / sparkCount) * segs.length)];
        const burstAngle = Math.random() * Math.PI * 2;
        const burstSpeed = 55 + Math.random() * 190;
        const maxLife = 0.45 + Math.random() * 0.55;
        this.particles.push({
          x: seg.x,
          y: seg.y,
          vx: Math.cos(burstAngle) * burstSpeed,
          vy: Math.sin(burstAngle) * burstSpeed,
          radius: 4.5 + Math.random() * 5.5,
          life: maxLife,
          maxLife,
          colorIndex: (baseColorIdx + i) % ORB_COLORS.length,
        });
      }
    }

    // Handle Player Death Transition
    if (snake.isPlayer && this.state === 'PLAYING') {
      this.sound.playDeath();
      this.input.setEnabled(false);
      this.state = 'DYING';
      this.deathTimer = DEATH_TRANSITION_DURATION;
      this.deathFocusX = snake.x;
      this.deathFocusY = snake.y;
      this.shakeIntensity = 18;

      this.playerFinalStats = {
        finalLength: snake.displayLength,
        peakRank: this.playerPeakRank,
        timeSurvived: Math.max(0, this.worldTime - snake.spawnTime),
        kills: snake.kills,
        deathReason: reason,
      };
    }
  }

  private updateParticles(dt: number): void {
    let writeIdx = 0;
    const drag = Math.pow(0.08, dt);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      this.particles[writeIdx++] = p;
    }
    this.particles.length = writeIdx;
  }

  private maintainArenaPopulation(dt: number): void {
    // Smoothly replenish ambient orbs up to ~1400
    let spawnBudget = 12;
    while (this.ambientOrbCount < TARGET_AMBIENT_ORBS && spawnBudget > 0) {
      this.spawnAmbientOrb();
      spawnBudget--;
    }

    // Keep steady population of ~30 AI bots
    this.botRespawnAccum += dt;
    if (this.botRespawnAccum >= 0.45) {
      this.botRespawnAccum = 0;
      if (this.bots.length < TARGET_BOT_COUNT) {
        this.spawnBot();
      }
    }
  }

  private updateCamera(dt: number): void {
    let targetX = this.camera.x;
    let targetY = this.camera.y;
    let targetZoom = 0.86;

    if (this.state === 'PLAYING' && this.player && this.player.alive) {
      // Slightly lead camera ahead of the snake's nose for natural tactical feel
      const lead = this.player.isBoosting ? 24 : 12;
      targetX = this.player.x + Math.cos(this.player.angle) * lead;
      targetY = this.player.y + Math.sin(this.player.angle) * lead;
      // Dynamically zoom out smoothly as snake radius increases
      const growth = Math.max(0, this.player.radius - BASE_RADIUS);
      targetZoom = clamp(1.04 - growth * 0.015, 0.48, 1.04);
    } else if (this.state === 'DYING') {
      // Linger over player's exploding orbs during the 1.2s death transition
      targetX = this.deathFocusX;
      targetY = this.deathFocusY;
      targetZoom = clamp(this.camera.zoom * 0.995, 0.55, 0.92);
    } else {
      // MENU or GAMEOVER: smoothly spectate live bot arena (#1 leader or active contender)
      let spectate: Snake | null = null;
      if (this.spectateTargetId !== -1) {
        spectate = this.snakes.find((s) => s.id === this.spectateTargetId && s.alive) ?? null;
      }
      if (!spectate && this.currentLeader && this.currentLeader.alive) {
        spectate = this.currentLeader;
        this.spectateTargetId = spectate.id;
      } else if (!spectate && this.snakes.length > 0) {
        spectate = this.snakes[0];
        this.spectateTargetId = spectate.id;
      }

      if (spectate) {
        targetX = spectate.x;
        targetY = spectate.y;
        const growth = Math.max(0, spectate.radius - BASE_RADIUS);
        targetZoom = clamp(0.88 - growth * 0.011, 0.52, 0.88);
      }
    }

    const followRate = this.state === 'PLAYING' ? 9.5 : 3.2;
    const tPos = clamp(1 - Math.exp(-followRate * dt), 0, 1);
    const tZoom = clamp(1 - Math.exp(-2.8 * dt), 0, 1);

    this.camera.x = lerp(this.camera.x, targetX, tPos);
    this.camera.y = lerp(this.camera.y, targetY, tPos);
    this.camera.zoom = lerp(this.camera.zoom, targetZoom, tZoom);

    // Subtle decaying screen shake on death
    if (this.shakeIntensity > 0.15) {
      this.camera.shakeX = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      this.camera.shakeY = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.03, dt);
    } else {
      this.shakeIntensity = 0;
      this.camera.shakeX = 0;
      this.camera.shakeY = 0;
    }
  }

  private updateLeaderboardAndHUD(): void {
    const alive = this.snakes.filter((s) => s.alive);
    alive.sort((a, b) => b.mass - a.mass);

    this.currentLeader = alive.length > 0 ? alive[0] : null;

    const top10: LeaderboardEntry[] = [];
    let playerEntry: LeaderboardEntry | null = null;

    for (let i = 0; i < alive.length; i++) {
      const s = alive[i];
      const rank = i + 1;
      const entry: LeaderboardEntry = {
        id: s.id,
        name: s.name,
        length: s.displayLength,
        isPlayer: s.isPlayer,
        rank,
      };

      if (i < 10) {
        top10.push(entry);
      }
      if (s.isPlayer) {
        playerEntry = entry;
        if (rank < this.playerPeakRank) {
          this.playerPeakRank = rank;
        }
      }
    }

    if (this.state === 'PLAYING' || this.state === 'DYING') {
      const kills = this.player ? this.player.kills : 0;
      this.ui.updateHUD(top10, playerEntry, alive.length, kills, this.smoothFps);
    }
  }

  private render(): void {
    this.renderer.render(
      this.camera,
      this.worldTime,
      this.foodGrid,
      this.snakes,
      this.particles,
      this.player
    );

    if (this.state === 'PLAYING' || this.state === 'DYING') {
      this.renderer.renderMinimap(this.snakes, this.player, this.currentLeader, this.worldTime);
    } else if (this.state === 'MENU') {
      this.renderer.renderSkinPreview(
        this.ui.skinPreviewCanvas,
        this.ui.getSelectedSkin(),
        this.worldTime
      );
    }
  }
}
