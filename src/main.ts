import { GameEngine } from './core/GameEngine';

function bootstrap(): void {
  const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;

  if (!gameCanvas || !minimapCanvas) {
    throw new Error('Required canvas elements not found in DOM.');
  }

  const engine = new GameEngine(gameCanvas, minimapCanvas);
  engine.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
