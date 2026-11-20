export const ROUND_MS = 60_000;
export const MAX_LEVEL = 10;
// The existing v3 save is intentionally retained so prior progress survives.
export const STORAGE_KEY = 'ashur-milk-clicker-save-v1';
export const TAPS = Object.freeze({ LEFT: 'left', RIGHT: 'right', HEAD: 'head', CHEEK: 'cheek' });
export const COMBO_RESET_MS = 850;

export const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
export const nextLevelCost = level => clamp(Math.ceil(30 * 2 ** level), 0, 9_999_999);
export const remainingMs = (startedAt, now, duration = ROUND_MS) => Math.max(0, duration - (now - startedAt));
export const formatCash = cash => Math.max(0, Math.floor(cash)).toLocaleString('ko-KR');

export function freshSave() {
  return { bank: 0, level: 0, lifetime: 0, best: 0, rounds: 0 };
}

export function normalizeSave(input) {
  const clean = freshSave();
  if (!input || typeof input !== 'object') return clean;
  for (const name of Object.keys(clean)) {
    const value = Number(input[name]);
    if (Number.isFinite(value) && value >= 0) clean[name] = Math.floor(value);
  }
  clean.level = clamp(clean.level, 0, MAX_LEVEL);
  return clean;
}

export function createRound(startedAt) {
  return {
    startedAt, endedAt: null, left: 0, right: 0, head: 0, cheek: 0,
    earnings: 0, baseEarnings: 0, bonusEarnings: 0,
    maxCombo: 0, combo: 0, lastTapAt: null, lastReward: null,
  };
}

/**
 * A high-level hit produces more coins, which also grows the streak bonus.
 * Lv0/1st hit = 1; level L base = L+1.
 * Every ten consecutive hits add roughly one more base worth of coins.
 * As each hit gets bigger, a further 12.5% of its subtotal is paid as a
 * 'large hit' bonus. Streak is capped at 120 for balanced upper bounds.
 */
export function hitReward(level, combo) {
  const base = clamp(Math.floor(level), 0, MAX_LEVEL) + 1;
  const streak = clamp(Math.floor(combo) - 1, 0, 120);
  const comboBonus = Math.floor(base * streak / 10);
  const bigHitBonus = Math.floor((base + comboBonus) / 8);
  return { base, comboBonus, bigHitBonus, total: base + comboBonus + bigHitBonus };
}

export function registerHit(round, kind, at, level = 0) {
  if (!round || round.endedAt != null || remainingMs(round.startedAt, at) <= 0) return 0;
  if (kind === TAPS.LEFT || kind === TAPS.RIGHT) {
    round[kind]++;
    round.combo = round.lastTapAt !== null && at - round.lastTapAt < COMBO_RESET_MS ? round.combo + 1 : 1;
    round.maxCombo = Math.max(round.maxCombo, round.combo);
    round.lastTapAt = at;
    const reward = hitReward(level, round.combo);
    round.earnings += reward.total;
    round.baseEarnings += reward.base;
    round.bonusEarnings += reward.comboBonus + reward.bigHitBonus;
    round.lastReward = reward;
    return reward.total;
  }
  if (kind === TAPS.HEAD || kind === TAPS.CHEEK) {
    round[kind]++;
    return 0;
  }
  return 0;
}

export function closeRound(round, at) {
  if (!round || round.endedAt !== null) return round;
  round.endedAt = Math.min(at, round.startedAt + ROUND_MS);
  return round;
}

export function tryUpgrade(save) {
  if (save.level >= MAX_LEVEL) return { ok: false, reason: 'max', save };
  const cost = nextLevelCost(save.level);
  if (save.bank < cost) return { ok: false, reason: 'cash', required: cost, save };
  save.bank -= cost;
  save.level++;
  return { ok: true, cost, level: save.level, save };
}
