import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, registerHit, closeRound, remainingMs, ROUND_MS, TAPS, freshSave, tryUpgrade, nextLevelCost, MAX_LEVEL, normalizeSave } from '../src/logic.js';
import { sampleCurve, motionValue } from '../src/motions.js';
import { readFile } from 'node:fs/promises';

test('60-second deadline is exact', () => {
  assert.equal(remainingMs(1000, 1000), ROUND_MS);
  assert.equal(remainingMs(1000, 1000 + ROUND_MS - 1), 1);
  assert.equal(remainingMs(1000, 1000 + ROUND_MS), 0);
  assert.equal(remainingMs(1000, 1000 + ROUND_MS + 200), 0);
});

test('left/right earn exactly one coin and combo grows', () => {
  const r = createRound(0);
  assert.equal(registerHit(r, TAPS.LEFT, 10), 1);
  assert.equal(registerHit(r, TAPS.RIGHT, 110), 1);
  assert.equal(r.left, 1); assert.equal(r.right, 1);
  assert.equal(r.earnings, 2); assert.equal(r.maxCombo, 2);
  assert.equal(registerHit(r, TAPS.LEFT, 2000), 1);
  assert.equal(r.combo, 1);
});

test('head and cheek give no money, but count separately', () => {
  const r = createRound(0);
  assert.equal(registerHit(r, TAPS.HEAD, 100), 0);
  assert.equal(registerHit(r, TAPS.CHEEK, 200), 0);
  assert.equal(r.earnings, 0);
  assert.equal(r.head, 1); assert.equal(r.cheek, 1);
});

test('post-deadline input and closed rounds are ignored', () => {
  const r = createRound(10);
  assert.equal(registerHit(r, TAPS.LEFT, 60010), 0);
  closeRound(r, 60010);
  assert.equal(registerHit(r, TAPS.LEFT, 60011), 0);
  assert.equal(r.earnings, 0);
});

test('level upgrades use money, and stop exactly at level ten', () => {
  const s = freshSave(); s.bank = 99_999;
  for(let i = 0;i < MAX_LEVEL;i++) {
    const before = s.bank, cost = nextLevelCost(i);
    const response = tryUpgrade(s);
    assert.equal(response.ok,true);
    assert.equal(s.level, i+1);
    assert.equal(s.bank, before-cost);
  }
  assert.equal(tryUpgrade(s).reason, 'max');
  assert.equal(s.level, 10);
});

test('malformed saved data is normalized and level clamped', () => {
  const normalized = normalizeSave({ level: 999, bank: -500, rounds: '2.8', best: 'ok' });
  assert.equal(normalized.level, 10);
  assert.equal(normalized.bank, 0);
  assert.equal(normalized.rounds, 2);
  assert.equal(normalized.best, 0);
});

test('all three supplied Cubism motions contain their correct active curves', async () => {
  const root = new URL('../public/model/', import.meta.url);
  for(const [file, id] of [['왼쪽.motion3.json','BHLEFT'],['오른쪽.motion3.json','BHRIGHT'],['꿀밤.motion3.json','headattack']]) {
    const motion = JSON.parse(await readFile(new URL(file, root), 'utf8'));
    const curve = motion.Curves.find(c => c.Id === id);
    assert.ok(curve, `${file} is missing ${id}`);
    assert.ok(sampleCurve(curve, 0.15) > 0.85);
    assert.ok(sampleCurve(curve, motion.Meta.Duration) < 0.005);
    assert.ok(motion.Meta.Duration > 0);
  }
});
