const MUTE_STORAGE_KEY = 'slither_muted_v1';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private lastEatSoundTime = 0;
  private eatCombo = 0;

  // Boost continuous synth nodes
  private boostOsc1: OscillatorNode | null = null;
  private boostOsc2: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;
  private boostActive = false;

  constructor() {
    this.muted = localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_STORAGE_KEY, String(this.muted));
    if (this.muted) {
      this.setBoosting(false);
    }
    return this.muted;
  }

  /**
   * Unlocks/resumes Web Audio Context safely upon any user interaction.
   */
  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public playEat(orbValue: number): void {
    if (this.muted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    // Throttle rapid pops slightly to keep rapid loot pickup crisp and pleasant
    if (now - this.lastEatSoundTime < 0.055) return;

    if (now - this.lastEatSoundTime < 0.28) {
      this.eatCombo = Math.min(12, this.eatCombo + 1);
    } else {
      this.eatCombo = 0;
    }
    this.lastEatSoundTime = now;

    const baseFreq = (orbValue > 2.5 ? 420 : 540) + this.eatCombo * 28 + (Math.random() - 0.5) * 30;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = orbValue > 2.5 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.42, now + 0.065);

    const peakGain = orbValue > 2.5 ? 0.095 : 0.06;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public setBoosting(active: boolean): void {
    if (this.muted) active = false;
    if (active === this.boostActive) return;
    this.boostActive = active;

    if (active) {
      this.unlock();
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') {
        this.boostActive = false;
        return;
      }

      this.ensureBoostNodes(ctx);
      if (this.boostGain) {
        const now = ctx.currentTime;
        this.boostGain.gain.cancelScheduledValues(now);
        this.boostGain.gain.setTargetAtTime(0.055, now, 0.05);
      }
    } else if (this.ctx && this.boostGain) {
      const now = this.ctx.currentTime;
      this.boostGain.gain.cancelScheduledValues(now);
      this.boostGain.gain.setTargetAtTime(0.0001, now, 0.06);
    }
  }

  private ensureBoostNodes(ctx: AudioContext): void {
    if (this.boostGain) return;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 92;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 184.5;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();

    this.boostOsc1 = osc1;
    this.boostOsc2 = osc2;
    this.boostGain = gain;
  }

  public playKill(): void {
    if (this.muted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5 - E5 - G5 bright chime
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  public playDeath(): void {
    this.setBoosting(false);
    if (this.muted) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const now = ctx.currentTime;

    // 1. Deep resonant thump
    const bassOsc = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(145, now);
    bassOsc.frequency.exponentialRampToValueAtTime(34, now + 0.45);
    bassGain.gain.setValueAtTime(0.18, now);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    bassOsc.connect(bassGain);
    bassGain.connect(ctx.destination);
    bassOsc.start(now);
    bassOsc.stop(now + 0.5);

    // 2. Descending dissolve shimmer
    const shimmer = ctx.createOscillator();
    const shimmerFilter = ctx.createBiquadFilter();
    const shimmerGain = ctx.createGain();

    shimmer.type = 'sawtooth';
    shimmer.frequency.setValueAtTime(480, now);
    shimmer.frequency.exponentialRampToValueAtTime(95, now + 0.65);

    shimmerFilter.type = 'bandpass';
    shimmerFilter.frequency.setValueAtTime(1200, now);
    shimmerFilter.frequency.exponentialRampToValueAtTime(180, now + 0.65);
    shimmerFilter.Q.value = 3;

    shimmerGain.gain.setValueAtTime(0.12, now);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.68);

    shimmer.connect(shimmerFilter);
    shimmerFilter.connect(shimmerGain);
    shimmerGain.connect(ctx.destination);
    shimmer.start(now);
    shimmer.stop(now + 0.7);
  }

  public dispose(): void {
    this.boostOsc1?.stop();
    this.boostOsc2?.stop();
    void this.ctx?.close();
  }
}
