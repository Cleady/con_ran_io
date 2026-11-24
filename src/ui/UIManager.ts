import {
  GameOverStats,
  GameState,
  LeaderboardEntry,
  SKINS,
  SkinDefinition,
} from '../types';

const NICKNAME_STORAGE_KEY = 'slither_nickname_v1';
const SKIN_STORAGE_KEY = 'slither_skin_idx_v1';

export interface UICallbacks {
  onPlay: (nickname: string, skin: SkinDefinition) => void;
  onChangeSkin: () => void;
  onToggleMute: () => boolean;
  onToggleNameplates: () => boolean;
}

export class UIManager {
  private readonly menuOverlay: HTMLElement;
  private readonly hudEl: HTMLElement;
  private readonly gameoverOverlay: HTMLElement;

  private readonly nicknameInput: HTMLInputElement;
  private readonly skinPrevBtn: HTMLButtonElement;
  private readonly skinNextBtn: HTMLButtonElement;
  private readonly skinNameEl: HTMLElement;
  public readonly skinPreviewCanvas: HTMLCanvasElement;
  private readonly playBtn: HTMLButtonElement;

  private readonly leaderboardList: HTMLOListElement;
  private readonly leaderboardExtra: HTMLElement;
  private readonly hudLength: HTMLElement;
  private readonly hudRank: HTMLElement;
  private readonly hudKills: HTMLElement;
  private readonly hudFps: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly muteIcon: HTMLElement;
  private readonly namesBtn: HTMLButtonElement;
  private readonly killBanner: HTMLElement;

  private readonly deathReasonEl: HTMLElement;
  private readonly statFinalLength: HTMLElement;
  private readonly statPeakRank: HTMLElement;
  private readonly statTimeSurvived: HTMLElement;
  private readonly statKills: HTMLElement;
  private readonly playAgainBtn: HTMLButtonElement;
  private readonly changeSkinBtn: HTMLButtonElement;

  private selectedSkinIdx = 0;
  private killBannerTimeout: number | null = null;
  private readonly callbacks: UICallbacks;

  constructor(callbacks: UICallbacks, initialMuted: boolean) {
    this.callbacks = callbacks;

    this.menuOverlay = this.reqEl('menu-overlay');
    this.hudEl = this.reqEl('hud');
    this.gameoverOverlay = this.reqEl('gameover-overlay');

    this.nicknameInput = this.reqEl('nickname-input') as HTMLInputElement;
    this.skinPrevBtn = this.reqEl('skin-prev') as HTMLButtonElement;
    this.skinNextBtn = this.reqEl('skin-next') as HTMLButtonElement;
    this.skinNameEl = this.reqEl('skin-name');
    this.skinPreviewCanvas = this.reqEl('skin-preview-canvas') as HTMLCanvasElement;
    this.playBtn = this.reqEl('play-btn') as HTMLButtonElement;

    this.leaderboardList = this.reqEl('leaderboard-list') as HTMLOListElement;
    this.leaderboardExtra = this.reqEl('leaderboard-player-extra');
    this.hudLength = this.reqEl('hud-length');
    this.hudRank = this.reqEl('hud-rank');
    this.hudKills = this.reqEl('hud-kills');
    this.hudFps = this.reqEl('hud-fps');
    this.muteBtn = this.reqEl('mute-btn') as HTMLButtonElement;
    this.muteIcon = this.reqEl('mute-icon');
    this.namesBtn = this.reqEl('names-btn') as HTMLButtonElement;
    this.killBanner = this.reqEl('kill-banner');

    this.deathReasonEl = this.reqEl('death-reason');
    this.statFinalLength = this.reqEl('stat-final-length');
    this.statPeakRank = this.reqEl('stat-peak-rank');
    this.statTimeSurvived = this.reqEl('stat-time-survived');
    this.statKills = this.reqEl('stat-kills');
    this.playAgainBtn = this.reqEl('play-again-btn') as HTMLButtonElement;
    this.changeSkinBtn = this.reqEl('change-skin-btn') as HTMLButtonElement;

    // Restore persisted user preferences
    const savedName = localStorage.getItem(NICKNAME_STORAGE_KEY);
    if (savedName) this.nicknameInput.value = savedName;

    const savedSkin = parseInt(localStorage.getItem(SKIN_STORAGE_KEY) || '0', 10);
    if (!Number.isNaN(savedSkin) && savedSkin >= 0 && savedSkin < SKINS.length) {
      this.selectedSkinIdx = savedSkin;
    }

    this.updateSkinLabel();
    this.updateMuteIcon(initialMuted);
    this.bindEvents();
  }

  private reqEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing required DOM element #${id}`);
    return el;
  }

  public getSelectedSkin(): SkinDefinition {
    return SKINS[this.selectedSkinIdx];
  }

  public getNickname(): string {
    const raw = this.nicknameInput.value.trim();
    return raw.length > 0 ? raw : 'You';
  }

  private bindEvents(): void {
    this.skinPrevBtn.addEventListener('click', () => {
      this.selectedSkinIdx = (this.selectedSkinIdx - 1 + SKINS.length) % SKINS.length;
      localStorage.setItem(SKIN_STORAGE_KEY, String(this.selectedSkinIdx));
      this.updateSkinLabel();
    });

    this.skinNextBtn.addEventListener('click', () => {
      this.selectedSkinIdx = (this.selectedSkinIdx + 1) % SKINS.length;
      localStorage.setItem(SKIN_STORAGE_KEY, String(this.selectedSkinIdx));
      this.updateSkinLabel();
    });

    const triggerPlay = () => {
      const nick = this.nicknameInput.value.trim();
      localStorage.setItem(NICKNAME_STORAGE_KEY, nick);
      this.callbacks.onPlay(this.getNickname(), this.getSelectedSkin());
    };

    this.playBtn.addEventListener('click', triggerPlay);
    this.playAgainBtn.addEventListener('click', triggerPlay);

    this.nicknameInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerPlay();
      }
    });

    this.changeSkinBtn.addEventListener('click', () => {
      this.callbacks.onChangeSkin();
    });

    this.muteBtn.addEventListener('click', () => {
      const nowMuted = this.callbacks.onToggleMute();
      this.updateMuteIcon(nowMuted);
    });

    this.namesBtn.addEventListener('click', () => {
      const visible = this.callbacks.onToggleNameplates();
      this.namesBtn.classList.toggle('active', visible);
    });
  }

  private updateSkinLabel(): void {
    const skin = this.getSelectedSkin();
    this.skinNameEl.textContent = skin.name;
    this.skinNameEl.style.color = skin.glowColor;
  }

  private updateMuteIcon(muted: boolean): void {
    this.muteIcon.textContent = muted ? '🔇' : '🔊';
    this.muteBtn.classList.toggle('muted', muted);
  }

  public setState(state: GameState): void {
    this.menuOverlay.classList.toggle('visible', state === 'MENU');
    this.menuOverlay.classList.toggle('hidden', state !== 'MENU');

    const showHud = state === 'PLAYING' || state === 'DYING';
    this.hudEl.classList.toggle('hidden', !showHud);

    this.gameoverOverlay.classList.toggle('visible', state === 'GAMEOVER');
    this.gameoverOverlay.classList.toggle('hidden', state !== 'GAMEOVER');
  }

  public showGameOver(stats: GameOverStats): void {
    this.deathReasonEl.textContent = stats.deathReason;
    this.statFinalLength.textContent = stats.finalLength.toLocaleString();
    this.statPeakRank.textContent = `#${stats.peakRank}`;
    this.statTimeSurvived.textContent = this.formatDuration(stats.timeSurvived);
    this.statKills.textContent = String(stats.kills);
    this.setState('GAMEOVER');
  }

  public showKillToast(victimName: string): void {
    this.killBanner.textContent = `Eliminated ${victimName}!`;
    this.killBanner.classList.remove('hidden');
    this.killBanner.classList.add('show');

    if (this.killBannerTimeout !== null) {
      window.clearTimeout(this.killBannerTimeout);
    }
    this.killBannerTimeout = window.setTimeout(() => {
      this.killBanner.classList.remove('show');
      this.killBanner.classList.add('hidden');
      this.killBannerTimeout = null;
    }, 1800);
  }

  public updateHUD(
    top10: LeaderboardEntry[],
    playerEntry: LeaderboardEntry | null,
    totalSnakes: number,
    kills: number,
    fps: number
  ): void {
    // Update stats
    if (playerEntry) {
      this.hudLength.textContent = playerEntry.length.toLocaleString();
      this.hudRank.textContent = `${playerEntry.rank} / ${totalSnakes}`;
    }
    this.hudKills.textContent = String(kills);
    this.hudFps.textContent = `${Math.round(fps)} FPS`;

    // Render Top 10 leaderboard cleanly
    let html = '';
    let playerInTop10 = false;
    for (let i = 0; i < top10.length; i++) {
      const e = top10[i];
      if (e.isPlayer) playerInTop10 = true;
      const cls = e.isPlayer ? 'lb-row lb-player' : i === 0 ? 'lb-row lb-leader' : 'lb-row';
      html += `<li class="${cls}"><span class="lb-rank">#${e.rank}</span><span class="lb-name">${this.escapeHtml(e.name)}</span><span class="lb-score">${e.length.toLocaleString()}</span></li>`;
    }
    this.leaderboardList.innerHTML = html;

    if (playerEntry && !playerInTop10) {
      this.leaderboardExtra.classList.remove('hidden');
      this.leaderboardExtra.innerHTML = `<div class="lb-row lb-player"><span class="lb-rank">#${playerEntry.rank}</span><span class="lb-name">${this.escapeHtml(playerEntry.name)}</span><span class="lb-score">${playerEntry.length.toLocaleString()}</span></div>`;
    } else {
      this.leaderboardExtra.classList.add('hidden');
    }
  }

  private formatDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
