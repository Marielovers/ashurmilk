const SITE_BASE = typeof window === 'undefined' ? './' : import.meta.env.BASE_URL;
const SOURCES = {
  left: `${SITE_BASE}sound/left.wav`,
  right: `${SITE_BASE}sound/right.wav`,
  facehit: `${SITE_BASE}sound/facehit.wav`,
  touch: `${SITE_BASE}sound/touch.wav`,
  voice: `${SITE_BASE}sound/Voice_Ashur_Touch2.wav`,
};

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.active = new Map();
    this.voice = null;
    this.muted = false;
    this.fallback = new Map();
    this.loading = null;
  }

  async unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { this.ctx = null; }
    }
    if (this.ctx?.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* no audio permission */ }
    }
    this.loading ??= this.loadAll();
    return this.loading;
  }

  async loadAll() {
    if (!this.ctx) return;
    await Promise.all(Object.entries(SOURCES).map(async ([name, path]) => {
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.arrayBuffer();
        this.buffers.set(name, await this.ctx.decodeAudioData(data));
      } catch (error) {
        console.warn(`Sound ${name} could not be decoded:`, error);
      }
    }));
  }

  play(name, volume = 0.72) {
    if (this.muted || !SOURCES[name]) return;
    if (!this.ctx || !this.buffers.has(name)) return this.playFallback(name, volume);

    const count = this.active.get(name) || 0;
    if (count >= (name === 'voice' ? 1 : 16)) return;
    if (name === 'voice' && this.voice) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = this.buffers.get(name);
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);
    this.active.set(name, count + 1);
    if (name === 'voice') this.voice = source;
    source.onended = () => {
      this.active.set(name, Math.max(0, (this.active.get(name) || 1) - 1));
      if (this.voice === source) this.voice = null;
      source.disconnect(); gain.disconnect();
    };
    source.start();
  }

  playFallback(name, volume) {
    if (name === 'voice' && this.voice) return;
    try {
      const audio = new Audio(SOURCES[name]);
      audio.volume = volume;
      if (name === 'voice') {
        this.voice = audio;
        audio.onended = audio.onerror = () => { if (this.voice === audio) this.voice = null; };
      }
      audio.play().catch(() => {});
    } catch { /* sound is optional */ }
  }
}
