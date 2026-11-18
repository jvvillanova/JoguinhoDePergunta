"use client";
/**
 * Estúdio de áudio do jogo (somente no navegador).
 * - Música de fundo procedural (Web Audio API), com intensidade crescente por nível.
 * - Efeitos sonoros sintetizados (sem arquivos de terceiros).
 * - Barramentos independentes: música, voz, efeitos e alertas, com ducking durante a narração.
 * - Narração pela Web Speech API (vozes do sistema). Sem suporte: legendas e modo silencioso.
 */

export type AudioSettings = {
  musicVolume: number; // 0..1
  sfxVolume: number;
  voiceVolume: number;
  musicOn: boolean;
  narrationOn: boolean;
  subtitlesOn: boolean;
  voiceURI: string;
  rate: number; // 0.7..1.3
};

export const DEFAULT_AUDIO: AudioSettings = {
  musicVolume: 0.35,
  sfxVolume: 0.6,
  voiceVolume: 1,
  musicOn: true,
  narrationOn: true,
  subtitlesOn: true,
  voiceURI: "",
  rate: 1,
};

const STORAGE_KEY = "show-conhecimento-audio";

export function loadAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_AUDIO;
  try {
    return { ...DEFAULT_AUDIO, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULT_AUDIO;
  }
}

export function saveAudioSettings(s: AudioSettings) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

type SfxName = "select" | "lock" | "suspense" | "correct" | "wrong" | "prize" | "help" | "victory" | "defeat" | "tick" | "open";

// Progressão em Lá menor (Am - F - C - G) para a trilha procedural.
const CHORDS = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
];

export class AudioStudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private voiceBus!: GainNode;
  private sfxBus!: GainNode;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private intensity = 0;
  private playing = false;
  private queue: { text: string; priority: boolean }[] = [];
  private speaking = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  settings: AudioSettings = DEFAULT_AUDIO;
  onSubtitle: ((text: string | null) => void) | null = null;
  onSpeakingChange: ((speaking: boolean) => void) | null = null;

  /** Deve ser chamado a partir de um gesto do usuário (política de autoplay). */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.voiceBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.voiceBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.master.gain.value = 0.9;
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.applyVolumes();
  }

  applySettings(s: AudioSettings) {
    this.settings = s;
    this.applyVolumes();
    if (!s.narrationOn) this.cancelSpeech();
    if (this.ctx && this.playing) this.musicBus.gain.value = s.musicOn ? s.musicVolume : 0;
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.sfxBus.gain.value = s.sfxVolume;
    this.voiceBus.gain.value = s.voiceVolume;
    this.musicBus.gain.value = this.playing && s.musicOn ? s.musicVolume : 0;
  }

  // ---------- Música ----------
  startMusic(level = 0): void {
    if (!this.ctx) return;
    this.intensity = Math.min(level / 16, 1);
    if (this.playing) return;
    this.playing = true;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setValueAtTime(0, this.ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(this.settings.musicOn ? this.settings.musicVolume : 0, this.ctx.currentTime + 1.5);
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.scheduleMusic(), 90);
  }

  /** Aumenta a tensão conforme o avanço do jogador. */
  setIntensity(level: number): void {
    this.intensity = Math.min(level / 16, 1);
  }

  stopMusic(fadeSeconds = 1.2): void {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
    this.musicBus.gain.linearRampToValueAtTime(0, now + fadeSeconds);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const bpm = 98 + this.intensity * 34;
    const eighth = 60 / bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const s = this.step % 32;
      const chord = CHORDS[Math.floor(s / 8) % CHORDS.length];
      const t = this.nextTime;
      if (s % 4 === 0) this.tone(chord[0] / 2, t, eighth * 1.6, "sine", 0.28, this.musicBus, 0.12, 0.2);
      if (s % 2 === 0) this.tone(chord[(s / 2) % 3] * 2, t, eighth * 1.8, "triangle", 0.12, this.musicBus);
      if (this.intensity > 0.3 && s % 2 === 1) this.hat(t, 0.05 + this.intensity * 0.05);
      if (this.intensity > 0.6 && s % 8 === 4) this.tone(chord[2] * 4, t, eighth * 0.5, "square", 0.04, this.musicBus);
      this.nextTime += eighth;
      this.step++;
    }
  }

  // ---------- Efeitos ----------
  play(name: SfxName): void {
    if (!this.ctx || !this.settings.sfxVolume) return;
    const t = this.ctx.currentTime + 0.01;
    const bus = this.sfxBus;
    switch (name) {
      case "open":
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.12, 0.25, "triangle", 0.3, bus));
        break;
      case "select":
        this.tone(880, t, 0.08, "sine", 0.25, bus);
        break;
      case "lock":
        this.tone(220, t, 0.25, "square", 0.2, bus, 0.01, 0.2);
        this.tone(110, t, 0.35, "sine", 0.3, bus);
        break;
      case "suspense":
        for (let i = 0; i < 8; i++) this.tone(300 + i * 40, t + i * 0.22, 0.2, "sawtooth", 0.08, bus);
        break;
      case "tick":
        this.tone(1400, t, 0.03, "square", 0.12, bus);
        break;
      case "correct":
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.09, 0.35, "triangle", 0.35, bus));
        break;
      case "wrong":
        [330, 277, 220, 165].forEach((f, i) => this.tone(f, t + i * 0.22, 0.4, "sawtooth", 0.2, bus));
        break;
      case "prize":
        for (let i = 0; i < 6; i++) this.tone(1200 + (i % 2) * 300, t + i * 0.05, 0.12, "sine", 0.2, bus);
        break;
      case "help":
        this.sweep(300, 1200, t, 0.5, bus);
        break;
      case "victory":
        [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.16, 0.3, "triangle", 0.35, bus));
        break;
      case "defeat":
        [392, 349, 330, 262].forEach((f, i) => this.tone(f, t + i * 0.35, 0.5, "sine", 0.35, bus));
        break;
    }
  }

  private tone(freq: number, when: number, dur: number, type: OscillatorType, gain: number, bus: GainNode, attack = 0.01, sweep = 0) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * (1 - sweep)), when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(bus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  private sweep(from: number, to: number, when: number, dur: number, bus: GainNode) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(from, when);
    osc.frequency.exponentialRampToValueAtTime(to, when + dur);
    g.gain.setValueAtTime(0.15, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(bus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  private hat(when: number, gain: number) {
    if (!this.ctx || !this.noise) return;
    const src = this.ctx.createBufferSource();
    const hp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = this.noise;
    hp.type = "highpass";
    hp.frequency.value = 7000;
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(when, Math.random() * 0.5, 0.06);
  }

  // ---------- Narração ----------
  voices(): SpeechSynthesisVoice[] {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("pt"));
  }

  get narrationSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  /**
   * Fala um texto. Prioridade alta interrompe a fila (ex.: resultado). Legendas são sempre emitidas
   * quando habilitadas, mesmo sem voz disponível.
   */
  say(text: string, priority = false): void {
    if (!text) return;
    if (priority) {
      this.queue = [];
      this.cancelSpeech();
    }
    this.queue.push({ text, priority });
    this.drain();
  }

  private drain() {
    if (this.speaking || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (!next) return;
    if (this.settings.subtitlesOn) this.onSubtitle?.(next.text);
    if (!this.settings.narrationOn || !this.narrationSupported) {
      // Sem voz: mantém a legenda visível pelo tempo de leitura e segue a fila.
      this.speaking = true;
      setTimeout(() => {
        this.speaking = false;
        if (this.queue.length === 0) this.onSubtitle?.(null);
        this.drain();
      }, Math.min(6000, 1200 + next.text.length * 45));
      return;
    }
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(next.text);
    const voice = this.voices().find((v) => v.voiceURI === this.settings.voiceURI) ?? this.voices()[0];
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "pt-BR";
    u.rate = this.settings.rate;
    u.volume = Math.min(1, Math.max(0, this.settings.voiceVolume));
    u.pitch = 1.05;
    this.speaking = true;
    this.onSpeakingChange?.(true);
    this.duck(true);
    const finish = () => {
      if (this.watchdog) clearTimeout(this.watchdog);
      this.speaking = false;
      this.onSpeakingChange?.(false);
      if (this.queue.length === 0) {
        this.duck(false);
        this.onSubtitle?.(null);
      }
      this.drain();
    };
    u.onend = finish;
    u.onerror = finish;
    // Vigia: evita fila travada se o navegador não disparar o evento de fim.
    this.watchdog = setTimeout(() => {
      synth.cancel();
      finish();
    }, Math.min(30000, 3000 + next.text.length * 120));
    synth.speak(u);
  }

  cancelSpeech() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (this.watchdog) clearTimeout(this.watchdog);
    this.speaking = false;
    this.onSpeakingChange?.(false);
    this.duck(false);
    this.onSubtitle?.(null);
  }

  /** Reduz a música enquanto o apresentador fala (prioridade da narração). */
  private duck(on: boolean) {
    if (!this.ctx || !this.playing) return;
    const target = on ? 0.35 : 1;
    const base = this.settings.musicOn ? this.settings.musicVolume : 0;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(base * target, this.ctx.currentTime + 0.4);
  }
}

let instance: AudioStudio | null = null;
export function getStudio(): AudioStudio {
  if (!instance) instance = new AudioStudio();
  return instance;
}
