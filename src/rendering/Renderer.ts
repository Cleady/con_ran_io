import { SpatialHashGrid } from '../core/SpatialHashGrid';
import { FoodOrb } from '../entities/FoodOrb';
import { Snake } from '../entities/Snake';
import {
  ORB_COLORS,
  Particle,
  SKINS,
  SkinDefinition,
  WORLD_RADIUS,
  clamp,
  normalizeAngle,
} from '../types';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  shakeX: number;
  shakeY: number;
}

const RAINBOW_STEPS = 24;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const cr = clamp(Math.round(r), 0, 255);
  const cg = clamp(Math.round(g), 0, 255);
  const cb = clamp(Math.round(b), 0, 255);
  return `#${((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1)}`;
}

function mixHex(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly minimapCanvas: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D;

  private width = 1280;
  private height = 720;
  private dpr = 1;

  // Pre-cached offscreen assets (ZERO ctx.shadowBlur in main render loop!)
  private hexPattern: CanvasPattern | null = null;
  private orbSprites: HTMLCanvasElement[] = [];
  private sparkSprites: HTMLCanvasElement[] = [];
  private boostGlowSprites: Map<string, HTMLCanvasElement> = new Map();
  private skinSegmentPalettes: Map<string, HTMLCanvasElement[]> = new Map();

  public showNameplates = true;

  constructor(canvas: HTMLCanvasElement, minimapCanvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to initialize 2D rendering context');
    this.ctx = ctx;

    this.minimapCanvas = minimapCanvas;
    const mCtx = minimapCanvas.getContext('2d');
    if (!mCtx) throw new Error('Failed to initialize minimap 2D context');
    this.minimapCtx = mCtx;

    this.buildHexPattern();
    this.buildOrbSprites();
    this.buildSparkSprites();
    this.buildSkinSprites();
    this.resize();
  }

  public resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  // ---------------------------------------------------------------------------
  // Startup Offscreen Sprite Pre-Caching
  // ---------------------------------------------------------------------------

  private buildHexPattern(): void {
    // Classic Slither.io dark honeycomb tile (#161c22 base with subtle #1f2730 bevels)
    const hexR = 34;
    const hexW = Math.sqrt(3) * hexR;
    const hexH = hexR * 2;
    const tileW = hexW;
    const tileH = hexH * 1.5;

    const tile = document.createElement('canvas');
    tile.width = Math.round(tileW);
    tile.height = Math.round(tileH);
    const tCtx = tile.getContext('2d');
    if (!tCtx) return;

    tCtx.fillStyle = '#11161c';
    tCtx.fillRect(0, 0, tile.width, tile.height);

    const drawHex = (cx: number, cy: number) => {
      const innerR = hexR - 2.2;
      tCtx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + Math.cos(a) * innerR;
        const py = cy + Math.sin(a) * innerR;
        if (i === 0) tCtx.moveTo(px, py);
        else tCtx.lineTo(px, py);
      }
      tCtx.closePath();

      // Subtle vertical bevel gradient inside each hexagon
      const grad = tCtx.createLinearGradient(cx, cy - innerR, cx, cy + innerR);
      grad.addColorStop(0, '#1f2730');
      grad.addColorStop(0.45, '#161c22');
      grad.addColorStop(1, '#12181e');
      tCtx.fillStyle = grad;
      tCtx.fill();

      // Subtle bevel rim highlight
      tCtx.strokeStyle = 'rgba(255, 255, 255, 0.032)';
      tCtx.lineWidth = 1.2;
      tCtx.stroke();

      // Tiny center dark dimple for extra honeycomb tactile depth
      tCtx.beginPath();
      tCtx.arc(cx, cy, innerR * 0.24, 0, Math.PI * 2);
      tCtx.fillStyle = 'rgba(8, 12, 16, 0.22)';
      tCtx.fill();
    };

    // Draw overlapping centers for seamless toroidal wrap
    const centers = [
      [0, 0],
      [tileW, 0],
      [tileW * 0.5, tileH * 0.5],
      [0, tileH],
      [tileW, tileH],
      [-tileW * 0.5, tileH * 0.5],
      [tileW * 1.5, tileH * 0.5],
    ];
    for (const [cx, cy] of centers) {
      drawHex(cx, cy);
    }

    this.hexPattern = this.ctx.createPattern(tile, 'repeat');
  }

  private buildOrbSprites(): void {
    const size = 64;
    const half = size * 0.5;
    this.orbSprites = ORB_COLORS.map((hex) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d')!;
      const [r, gr, b] = hexToRgb(hex);

      // Soft outer neon halo
      const halo = g.createRadialGradient(half, half, 2, half, half, half);
      halo.addColorStop(0, `rgba(255, 255, 255, 0.98)`);
      halo.addColorStop(0.18, `rgba(${r}, ${gr}, ${b}, 0.95)`);
      halo.addColorStop(0.42, `rgba(${r}, ${gr}, ${b}, 0.42)`);
      halo.addColorStop(0.72, `rgba(${r}, ${gr}, ${b}, 0.12)`);
      halo.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);

      g.fillStyle = halo;
      g.fillRect(0, 0, size, size);

      // Crisp bright inner core
      const core = g.createRadialGradient(half - 2, half - 2, 0.5, half, half, 11);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.55, `rgba(${Math.min(255, r + 80)}, ${Math.min(255, gr + 80)}, ${Math.min(255, b + 80)}, 0.9)`);
      core.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
      g.fillStyle = core;
      g.beginPath();
      g.arc(half, half, 11, 0, Math.PI * 2);
      g.fill();

      return c;
    });
  }

  private buildSparkSprites(): void {
    const size = 32;
    const half = size * 0.5;
    this.sparkSprites = ORB_COLORS.map((hex) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d')!;
      const [r, gr, b] = hexToRgb(hex);

      const grad = g.createRadialGradient(half, half, 1, half, half, half);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, `rgba(${r}, ${gr}, ${b}, 0.9)`);
      grad.addColorStop(0.7, `rgba(${r}, ${gr}, ${b}, 0.25)`);
      grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    });
  }

  private createBoostGlowSprite(hex: string): HTMLCanvasElement {
    const size = 96;
    const half = size * 0.5;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    const [r, gr, b] = hexToRgb(hex);

    const grad = g.createRadialGradient(half, half, 4, half, half, half);
    grad.addColorStop(0, `rgba(255, 255, 255, 0.45)`);
    grad.addColorStop(0.35, `rgba(${r}, ${gr}, ${b}, 0.35)`);
    grad.addColorStop(0.7, `rgba(${r}, ${gr}, ${b}, 0.1)`);
    grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  private createShadedSegmentSprite(baseHex: string): HTMLCanvasElement {
    const size = 72;
    const half = size * 0.5;
    const rad = half - 3;

    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;

    const highlightHex = mixHex(baseHex, '#ffffff', 0.42);
    const shadowHex = mixHex(baseHex, '#05080d', 0.52);
    const rimHex = mixHex(baseHex, '#020408', 0.68);

    // Subtle dark contact ring for separation between overlapping coils
    g.beginPath();
    g.arc(half, half, rad + 1.5, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0, 0, 0, 0.32)';
    g.fill();

    // Main 3D spherical radial gradient (studio light from top-left)
    const sphereGrad = g.createRadialGradient(
      half - rad * 0.28,
      half - rad * 0.32,
      rad * 0.08,
      half,
      half,
      rad
    );
    sphereGrad.addColorStop(0, highlightHex);
    sphereGrad.addColorStop(0.38, baseHex);
    sphereGrad.addColorStop(0.84, shadowHex);
    sphereGrad.addColorStop(1, rimHex);

    g.beginPath();
    g.arc(half, half, rad, 0, Math.PI * 2);
    g.fillStyle = sphereGrad;
    g.fill();

    // Glossy top-edge specular sheen
    g.save();
    g.beginPath();
    g.arc(half, half, rad * 0.88, 0, Math.PI * 2);
    g.clip();
    const specGrad = g.createRadialGradient(
      half - rad * 0.22,
      half - rad * 0.52,
      1,
      half - rad * 0.15,
      half - rad * 0.42,
      rad * 0.55
    );
    specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.58)');
    specGrad.addColorStop(0.55, 'rgba(255, 255, 255, 0.14)');
    specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = specGrad;
    g.fillRect(0, 0, size, size);
    g.restore();

    return c;
  }

  private buildSkinSprites(): void {
    for (const skin of SKINS) {
      if (!this.boostGlowSprites.has(skin.glowColor)) {
        this.boostGlowSprites.set(skin.glowColor, this.createBoostGlowSprite(skin.glowColor));
      }

      const sprites: HTMLCanvasElement[] = [];
      if (skin.pattern === 'rainbow') {
        for (let i = 0; i < RAINBOW_STEPS; i++) {
          const hue = (i / RAINBOW_STEPS) * 360;
          sprites.push(this.createShadedSegmentSprite(hslToHex(hue, 92, 56)));
        }
      } else if (skin.pattern === 'stripe') {
        // Sharp alternating stripes (each color repeated for clean bold bands)
        for (const col of skin.colors) {
          sprites.push(this.createShadedSegmentSprite(col));
        }
      } else {
        // Smooth multi-step gradient wave across skin palette
        const stepsPerEdge = 4;
        const cols = skin.colors;
        for (let i = 0; i < cols.length; i++) {
          const cA = cols[i];
          const cB = cols[(i + 1) % cols.length];
          for (let s = 0; s < stepsPerEdge; s++) {
            sprites.push(this.createShadedSegmentSprite(mixHex(cA, cB, s / stepsPerEdge)));
          }
        }
      }

      this.skinSegmentPalettes.set(skin.id, sprites);
    }
  }

  private getSegmentSprite(skin: SkinDefinition, segIndex: number): HTMLCanvasElement {
    const palette = this.skinSegmentPalettes.get(skin.id)!;
    if (skin.pattern === 'stripe') {
      // Every 2 segments shifts band for bold cyber stripes
      const band = Math.floor(segIndex / 2) % palette.length;
      return palette[band];
    }
    return palette[segIndex % palette.length];
  }

  // ---------------------------------------------------------------------------
  // Main Frame Render (Viewport Culled, 60+ FPS)
  // ---------------------------------------------------------------------------

  public render(
    camera: CameraState,
    worldTime: number,
    foodGrid: SpatialHashGrid<FoodOrb>,
    snakes: Snake[],
    particles: Particle[],
    player: Snake | null
  ): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const zoom = camera.zoom;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Base background fill
    ctx.fillStyle = '#0e1318';
    ctx.fillRect(0, 0, w, h);

    // Compute camera world transform
    const camX = camera.x + camera.shakeX;
    const camY = camera.y + camera.shakeY;

    ctx.translate(w * 0.5, h * 0.5);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    // Compute visible world bounding box for strict viewport culling
    const halfW = (w * 0.5) / zoom;
    const halfH = (h * 0.5) / zoom;
    const pad = 90;
    const viewMinX = camX - halfW - pad;
    const viewMaxX = camX + halfW + pad;
    const viewMinY = camY - halfH - pad;
    const viewMaxY = camY + halfH + pad;

    // 1. Hexagonal Honeycomb Background (aligned to world origin)
    if (this.hexPattern) {
      ctx.fillStyle = this.hexPattern;
      ctx.fillRect(viewMinX, viewMinY, viewMaxX - viewMinX, viewMaxY - viewMinY);
    }

    // 2. Crimson Danger Zone Outside Circular Arena Boundary
    this.renderArenaBoundary(ctx, viewMinX, viewMinY, viewMaxX, viewMaxY);

    // 3. Viewport-Culled Glowing Food Orbs
    this.renderFoodOrbs(ctx, foodGrid, viewMinX, viewMinY, viewMaxX, viewMaxY, worldTime);

    // 4. Particles (death bursts & boost sparks)
    this.renderParticles(ctx, particles, viewMinX, viewMinY, viewMaxX, viewMaxY);

    // 5. Snakes (draw bots first, player on top; each snake drawn tail-to-head)
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i];
      if (!s.alive || s.isPlayer) continue;
      if (
        s.maxX < viewMinX ||
        s.minX > viewMaxX ||
        s.maxY < viewMinY ||
        s.minY > viewMaxY
      ) {
        continue;
      }
      this.renderSnake(ctx, s, viewMinX, viewMinY, viewMaxX, viewMaxY);
    }

    if (player && player.alive) {
      this.renderSnake(ctx, player, viewMinX, viewMinY, viewMaxX, viewMaxY);
    }

    // 6. Floating Nameplates
    if (this.showNameplates) {
      this.renderNameplates(ctx, snakes, viewMinX, viewMinY, viewMaxX, viewMaxY);
    }

    ctx.restore();
  }

  private renderArenaBoundary(
    ctx: CanvasRenderingContext2D,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    // Only draw boundary & outside danger zone if viewport comes near/outside arena edge
    const furthestCorner = Math.max(
      Math.hypot(minX, minY),
      Math.hypot(maxX, minY),
      Math.hypot(minX, maxY),
      Math.hypot(maxX, maxY)
    );
    if (furthestCorner < WORLD_RADIUS - 80) return;

    // Crimson danger wash outside the circular wall (even-odd fill rule)
    ctx.save();
    ctx.beginPath();
    ctx.rect(minX - 200, minY - 200, maxX - minX + 400, maxY - minY + 400);
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(120, 12, 28, 0.44)';
    ctx.fill('evenodd');
    ctx.restore();

    // Multi-layered glowing crimson border (no shadowBlur!)
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS + 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 32, 64, 0.18)';
    ctx.lineWidth = 34;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 45, 78, 0.45)';
    ctx.lineWidth = 12;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff3355';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  private renderFoodOrbs(
    ctx: CanvasRenderingContext2D,
    foodGrid: SpatialHashGrid<FoodOrb>,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    worldTime: number
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    foodGrid.queryBounds(minX, minY, maxX, maxY, (orb) => {
      if (!orb.alive) return;
      if (orb.x < minX || orb.x > maxX || orb.y < minY || orb.y > maxY) return;

      const sprite = this.orbSprites[orb.colorIndex];
      // Pulsing scale for lively luminous orbs (death orbs pulse stronger)
      const pulseAmp = orb.type === 'death' ? 0.18 : 0.1;
      const pulseSpeed = orb.type === 'death' ? 5.5 : 3.0;
      const pulse = 1 + Math.sin(worldTime * pulseSpeed + orb.phase) * pulseAmp;

      // Shrink slightly right as orb finishes zipping into a snake's mouth
      let attractScale = 1;
      if (orb.attractedBy) {
        const progress = clamp(orb.attractTimer / orb.attractDuration, 0, 1);
        attractScale = 1 - progress * 0.45;
      }

      const drawSize = orb.radius * 3.8 * pulse * attractScale;
      const half = drawSize * 0.5;
      ctx.drawImage(sprite, orb.x - half, orb.y - half, drawSize, drawSize);
    });

    ctx.restore();
  }

  private renderParticles(
    ctx: CanvasRenderingContext2D,
    particles: Particle[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    if (particles.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      const size = p.radius * (2.6 + (1 - alpha) * 1.4);
      const half = size * 0.5;
      ctx.drawImage(this.sparkSprites[p.colorIndex], p.x - half, p.y - half, size, size);
    }

    ctx.restore();
  }

  private renderSnake(
    ctx: CanvasRenderingContext2D,
    snake: Snake,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const segs = snake.segments;
    const segCount = segs.length;
    if (segCount === 0) return;

    const boostGlow =
      snake.boostIntensity > 0.02
        ? this.boostGlowSprites.get(snake.skin.glowColor)
        : undefined;

    // 1. Optional additive neon boost aura underneath the spine
    if (boostGlow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const step = segCount > 90 ? 2 : 1;
      for (let i = segCount - 1; i >= 0; i -= step) {
        const seg = segs[i];
        if (seg.x < minX || seg.x > maxX || seg.y < minY || seg.y > maxY) continue;
        // Traveling neon energy pulse moving from head to tail
        const wave = 0.55 + 0.45 * Math.sin(i * 0.42 - snake.boostPulsePhase);
        ctx.globalAlpha = snake.boostIntensity * (0.35 + wave * 0.48);
        const auraSize = snake.radius * (3.2 + wave * 1.15);
        const half = auraSize * 0.5;
        ctx.drawImage(boostGlow, seg.x - half, seg.y - half, auraSize, auraSize);
      }
      ctx.restore();
    }

    // 2. Glossy 3D-shaded segments drawn strictly TAIL TO HEAD
    for (let i = segCount - 1; i >= 0; i--) {
      const seg = segs[i];
      if (seg.x < minX || seg.x > maxX || seg.y < minY || seg.y > maxY) continue;

      let r = snake.radius;
      const fromTail = segCount - 1 - i;
      if (fromTail < 4) {
        r = snake.radius * (0.68 + fromTail * 0.08);
      } else if (i === 0) {
        r = snake.radius * 1.04;
      }

      const sprite = this.getSegmentSprite(snake.skin, i);
      const drawDiameter = r * 2.18;
      const half = drawDiameter * 0.5;
      ctx.drawImage(sprite, seg.x - half, seg.y - half, drawDiameter, drawDiameter);
    }

    // 3. Traveling specular boost highlight along the spine center
    if (boostGlow && snake.boostIntensity > 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = segCount - 1; i >= 0; i -= 2) {
        const seg = segs[i];
        if (seg.x < minX || seg.x > maxX || seg.y < minY || seg.y > maxY) continue;
        const pulse = Math.sin(i * 0.42 - snake.boostPulsePhase);
        if (pulse < 0.2) continue;
        ctx.globalAlpha = snake.boostIntensity * (pulse - 0.2) * 0.55;
        const coreSize = snake.radius * 1.85;
        ctx.drawImage(boostGlow, seg.x - coreSize * 0.5, seg.y - coreSize * 0.5, coreSize, coreSize);
      }
      ctx.restore();
    }

    // 4. Expressive Cartoon Eyes on Head (tracking snake.targetAngle)
    const head = segs[0];
    if (head.x >= minX && head.x <= maxX && head.y >= minY && head.y <= maxY) {
      this.renderEyes(ctx, head.x, head.y, snake.radius * 1.04, snake.angle, snake.targetAngle);
    }
  }

  private renderEyes(
    ctx: CanvasRenderingContext2D,
    hx: number,
    hy: number,
    headRadius: number,
    heading: number,
    targetAngle: number
  ): void {
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const perpX = -sinH;
    const perpY = cosH;

    const forwardOffset = headRadius * 0.34;
    const sideOffset = headRadius * 0.44;
    const eyeRadius = Math.max(3.2, headRadius * 0.34);
    const pupilRadius = eyeRadius * 0.55;

    // Look smoothly toward target steering angle (clamped slightly so eyes stay natural)
    const lookDelta = clamp(normalizeAngle(targetAngle - heading), -1.15, 1.15);
    const lookAngle = heading + lookDelta;
    const pupilShift = eyeRadius * 0.36;
    const pOffX = Math.cos(lookAngle) * pupilShift;
    const pOffY = Math.sin(lookAngle) * pupilShift;

    for (let side = -1; side <= 1; side += 2) {
      const ex = hx + cosH * forwardOffset + perpX * sideOffset * side;
      const ey = hy + sinH * forwardOffset + perpY * sideOffset * side;

      // White sclera with crisp dark border
      ctx.beginPath();
      ctx.arc(ex, ey, eyeRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(10, 14, 20, 0.45)';
      ctx.lineWidth = Math.max(1, headRadius * 0.06);
      ctx.stroke();

      // Dark pupil tracking steering direction
      const px = ex + pOffX;
      const py = ey + pOffY;
      ctx.beginPath();
      ctx.arc(px, py, pupilRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1117';
      ctx.fill();

      // Crisp specular eye glint
      ctx.beginPath();
      ctx.arc(
        px - pupilRadius * 0.3,
        py - pupilRadius * 0.3,
        Math.max(1, pupilRadius * 0.28),
        0,
        Math.PI * 2
      );
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
    }
  }

  private renderNameplates(
    ctx: CanvasRenderingContext2D,
    snakes: Snake[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '600 13px "Inter", "Segoe UI", system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 12, 18, 0.72)';

    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i];
      if (!s.alive || !s.name) continue;
      if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;

      const labelY = s.y - s.radius - 10;
      ctx.strokeText(s.name, s.x, labelY);
      ctx.fillStyle = s.isPlayer ? 'rgba(0, 245, 255, 0.95)' : 'rgba(235, 244, 255, 0.78)';
      ctx.fillText(s.name, s.x, labelY);
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Circular Minimap (130x130)
  // ---------------------------------------------------------------------------

  public renderMinimap(snakes: Snake[], player: Snake | null, leader: Snake | null, worldTime: number): void {
    const ctx = this.minimapCtx;
    const size = this.minimapCanvas.width;
    const cx = size * 0.5;
    const cy = size * 0.5;
    const mapR = size * 0.5 - 5;
    const scale = mapR / WORLD_RADIUS;

    ctx.clearRect(0, 0, size, size);

    // Circular radar background
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 16, 23, 0.78)';
    ctx.fill();
    ctx.clip();

    // Subtle radar rings & crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, mapR * 0.5, 0, Math.PI * 2);
    ctx.moveTo(cx - mapR, cy);
    ctx.lineTo(cx + mapR, cy);
    ctx.moveTo(cx, cy - mapR);
    ctx.lineTo(cx, cy + mapR);
    ctx.stroke();

    // Draw other snakes (faint dots; slightly brighter for large contenders)
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i];
      if (!s.alive) continue;
      if (player && s.id === player.id) continue;
      if (leader && s.id === leader.id) continue;

      const mx = cx + s.x * scale;
      const my = cy + s.y * scale;
      const isLarge = s.mass > 90;
      ctx.beginPath();
      ctx.arc(mx, my, isLarge ? 2.4 : 1.7, 0, Math.PI * 2);
      ctx.fillStyle = isLarge ? 'rgba(180, 215, 255, 0.6)' : 'rgba(150, 175, 200, 0.32)';
      ctx.fill();
    }

    // #1 Leader dot (golden highlight + crown ring)
    if (leader && leader.alive && (!player || leader.id !== player.id)) {
      const lx = cx + leader.x * scale;
      const ly = cy + leader.y * scale;
      ctx.beginPath();
      ctx.arc(lx, ly, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 212, 59, 0.25)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly, 3.0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd43b';
      ctx.fill();
    }

    // Player glowing dot
    if (player && player.alive) {
      const px = cx + player.x * scale;
      const py = cy + player.y * scale;
      const pulse = 4.6 + Math.sin(worldTime * 6) * 1.4;
      ctx.beginPath();
      ctx.arc(px, py, pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 245, 255, 0.3)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#00f5ff';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.restore();

    // Crisp outer border
    ctx.beginPath();
    ctx.arc(cx, cy, mapR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 62, 96, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Live Animated Lobby Skin Preview
  // ---------------------------------------------------------------------------

  public renderSkinPreview(
    previewCanvas: HTMLCanvasElement,
    skin: SkinDefinition,
    timeSec: number
  ): void {
    const pCtx = previewCanvas.getContext('2d');
    if (!pCtx) return;

    const w = previewCanvas.width;
    const h = previewCanvas.height;
    pCtx.clearRect(0, 0, w, h);

    const segCount = 16;
    const radius = 14;
    const spacing = 10.5;
    const startX = w * 0.8;
    const centerY = h * 0.5;

    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < segCount; i++) {
      const x = startX - i * spacing;
      const y = centerY + Math.sin(timeSec * 4.2 - i * 0.45) * 11;
      pts.push({ x, y });
    }

    // Draw tail to head using pre-cached 3D segment sprites
    for (let i = segCount - 1; i >= 0; i--) {
      const fromTail = segCount - 1 - i;
      const r = fromTail < 4 ? radius * (0.68 + fromTail * 0.08) : radius;
      const sprite = this.getSegmentSprite(skin, i);
      const d = r * 2.18;
      pCtx.drawImage(sprite, pts[i].x - d * 0.5, pts[i].y - d * 0.5, d, d);
    }

    // Expressive eyes on preview head
    const head = pts[0];
    const neck = pts[1];
    const heading = Math.atan2(head.y - neck.y, head.x - neck.x);
    this.renderEyes(pCtx, head.x, head.y, radius * 1.04, heading, heading * 0.6);
  }
}
