export class InputManager {
  private mouseX = 0;
  private mouseY = 0;
  private hasPointerInput = false;
  private targetAngle = 0;
  private mouseDown = false;
  private spaceDown = false;
  private touchBoost = false;
  private enabled = false;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bindEvents();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.mouseDown = false;
      this.spaceDown = false;
      this.touchBoost = false;
    }
  }

  public getTargetAngle(fallbackAngle: number): number {
    if (!this.hasPointerInput) return fallbackAngle;
    return this.targetAngle;
  }

  public isBoostPressed(): boolean {
    return this.enabled && (this.mouseDown || this.spaceDown || this.touchBoost);
  }

  public setInitialAngle(angle: number): void {
    this.targetAngle = angle;
  }

  private updateAngleFromPoint(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // Ignore tiny deadzone right over the head center to avoid jitter
    if (dx * dx + dy * dy > 16) {
      this.mouseX = dx;
      this.mouseY = dy;
      this.targetAngle = Math.atan2(this.mouseY, this.mouseX);
      this.hasPointerInput = true;
    }
  }

  private bindEvents(): void {
    window.addEventListener('mousemove', (e: MouseEvent) => {
      this.updateAngleFromPoint(e.clientX, e.clientY);
    });

    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        // Ignore clicks on HUD buttons
        const target = e.target as HTMLElement | null;
        if (target && target.closest('button, input')) return;
        this.mouseDown = true;
        this.updateAngleFromPoint(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    });

    window.addEventListener('blur', () => {
      this.mouseDown = false;
      this.spaceDown = false;
      this.touchBoost = false;
    });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.enabled) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        this.spaceDown = true;
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        this.spaceDown = false;
      }
    });

    // Touch controls (1 finger steers, 2 fingers boosts)
    this.canvas.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (!this.enabled) return;
        if (e.touches.length > 0) {
          this.updateAngleFromPoint(e.touches[0].clientX, e.touches[0].clientY);
        }
        if (e.touches.length >= 2) {
          this.touchBoost = true;
        }
      },
      { passive: true }
    );

    this.canvas.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (!this.enabled) return;
        if (e.touches.length > 0) {
          this.updateAngleFromPoint(e.touches[0].clientX, e.touches[0].clientY);
        }
      },
      { passive: true }
    );

    this.canvas.addEventListener(
      'touchend',
      (e: TouchEvent) => {
        if (e.touches.length < 2) {
          this.touchBoost = false;
        }
      },
      { passive: true }
    );
  }
}
