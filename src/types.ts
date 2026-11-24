export type GameState = 'MENU' | 'PLAYING' | 'DYING' | 'GAMEOVER';

export const WORLD_RADIUS = 3600;
export const SPATIAL_CELL_SIZE = 200;
export const TARGET_AMBIENT_ORBS = 1400;
export const TARGET_BOT_COUNT = 30;
export const MIN_MASS = 10;
export const BOOST_MIN_MASS = 15;
export const BASE_SPEED = 205;
export const BOOST_SPEED_MULT = 1.85;
export const BASE_RADIUS = 11;
export const RADIUS_K = 2.65;
export const MAX_RADIUS = 46;
export const BASE_TURN_SPEED = 4.6; // rad/s for small nimble snakes
export const DEATH_TRANSITION_DURATION = 1.2; // seconds

export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  x: number;
  y: number;
  angle: number;
}

export interface SkinDefinition {
  id: string;
  name: string;
  pattern: 'solid' | 'gradient-wave' | 'stripe' | 'rainbow';
  colors: string[];
  glowColor: string;
  eyeSclera?: string;
  eyePupil?: string;
}

export const SKINS: SkinDefinition[] = [
  {
    id: 'neon-cyan',
    name: 'Neon Cyan',
    pattern: 'gradient-wave',
    colors: ['#00f5ff', '#00d2ff', '#00a8e8', '#00d2ff'],
    glowColor: '#00f5ff',
  },
  {
    id: 'crimson-ember',
    name: 'Crimson Ember',
    pattern: 'gradient-wave',
    colors: ['#ff2a55', '#ff5722', '#ff8c00', '#ff5722'],
    glowColor: '#ff3b5c',
  },
  {
    id: 'toxic-lime',
    name: 'Toxic Lime',
    pattern: 'gradient-wave',
    colors: ['#7dff00', '#38ef7d', '#00d68f', '#38ef7d'],
    glowColor: '#6eff24',
  },
  {
    id: 'royal-amethyst',
    name: 'Royal Amethyst',
    pattern: 'gradient-wave',
    colors: ['#b54cff', '#8e2de2', '#6a11cb', '#9b51e0'],
    glowColor: '#b95cff',
  },
  {
    id: 'solar-gold',
    name: 'Solar Gold',
    pattern: 'gradient-wave',
    colors: ['#fff066', '#ffd000', '#ff9e00', '#ffd000'],
    glowColor: '#ffd43b',
  },
  {
    id: 'classic-rainbow',
    name: 'Classic Rainbow',
    pattern: 'rainbow',
    colors: [
      '#ff3b5c',
      '#ff8c00',
      '#ffe600',
      '#4dff4d',
      '#00f0ff',
      '#4d79ff',
      '#c44dff',
    ],
    glowColor: '#ffffff',
  },
  {
    id: 'cyber-stripe',
    name: 'Cyber Stripe',
    pattern: 'stripe',
    colors: ['#00f5d4', '#1a202c', '#ff007f', '#1a202c'],
    glowColor: '#00f5d4',
  },
  {
    id: 'sakura-pastel',
    name: 'Sakura Pastel',
    pattern: 'gradient-wave',
    colors: ['#ffb7d5', '#ff8fab', '#ffc8dd', '#f4a2c8'],
    glowColor: '#ff9ebb',
  },
  {
    id: 'ocean-wave',
    name: 'Ocean Wave',
    pattern: 'gradient-wave',
    colors: ['#00b4d8', '#0077b6', '#48cae4', '#023e8a'],
    glowColor: '#48cae4',
  },
  {
    id: 'ghost-white',
    name: 'Ghost White',
    pattern: 'gradient-wave',
    colors: ['#f8fafc', '#cbd5e1', '#e2e8f0', '#94a3b8'],
    glowColor: '#e2e8f0',
  },
];

export const ORB_COLORS: string[] = [
  '#00f5ff', // cyan
  '#ff3b7f', // magenta pink
  '#7dff00', // toxic lime
  '#ffe600', // neon yellow
  '#ff6b35', // bright orange
  '#b967ff', // neon purple
  '#00ffa3', // mint green
  '#38b6ff', // electric blue
  '#ff4d6d', // coral red
  '#f8f9fa', // starlight white
];

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
  colorIndex: number;
}

export interface LeaderboardEntry {
  id: number;
  name: string;
  length: number;
  isPlayer: boolean;
  rank: number;
}

export interface GameOverStats {
  finalLength: number;
  peakRank: number;
  timeSurvived: number;
  kills: number;
  deathReason: string;
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function massToDisplayLength(mass: number): number {
  return Math.max(10, Math.floor(mass * 3));
}

export function massToRadius(mass: number): number {
  const r = BASE_RADIUS + RADIUS_K * Math.pow(Math.max(mass, MIN_MASS), 0.35);
  return Math.min(r, MAX_RADIUS);
}

export function massToSegmentCount(mass: number): number {
  return Math.floor(10 + Math.pow(Math.max(mass, MIN_MASS), 0.68) * 1.65);
}
