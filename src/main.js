import './style.css';
import {
  ROUND_MS, MAX_LEVEL, STORAGE_KEY, TAPS, COMBO_RESET_MS, clamp,
  nextLevelCost, remainingMs, formatCash, freshSave, normalizeSave,
  createRound, hitReward, registerHit, closeRound, tryUpgrade,
} from './logic.js';
import { SoundEngine } from './sounds.js';
import { ModelController, initializeModel } from './live2d.js';

const $ = id => document.getElementById(id);
const ids = [
  'stage','live2d-canvas','model-loading','load-message','load-error','stage-level','popups',
  'result-cover','result-kicker','result-title','result-earnings','result-breakdown',
  'result-taps','result-combo','result-bonus','result-close',
  'mute-button','timer','timer-fill','run-cash','combo','next-reward','start-button',
  'bank','level','upgrade-price','upgrade-button','upgrade-note','upgrade-card','toast',
  'prologue','prologue-start',
];
const ui = Object.fromEntries(ids.map(id => [id, $(id)]));

function readSave() {
  try { return normalizeSave(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return freshSave(); }
}
let save = readSave();
let phase = 'loading'; // loading / ready / running / counting / settled / error
let round = null;
let live2d = null;
let cheekDrag = null;
let pendingStart = false;
let resultFrame = null;
let lastSaveAt = 0;
let lastPaintAt = 0;
let toastTimer = null;
const sounds = new SoundEngine();
const controller = new ModelController();

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); }
  catch (e) { console.warn('[Bakery] Could not save progress:', e); }
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2000);
}

function setPhase(next) {
  phase = next;
  document.body.dataset.phase = next;
  ui['start-button'].disabled = !['ready','settled'].includes(next);
  ui['start-button'].textContent = ({
    loading:'모델 로딩 중…', ready:'60초 마사지 시작', running:'우유 마사지 중! ✦',
    counting:'착유 중…', settled:'한 판 더 수유하기 ↻', error:'모델 로딩 실패',
  })[next];
  updateShop();
}

function updateShop() {
  ui['stage-level'].textContent = String(save.level);
  ui.level.textContent = String(save.level);
  ui.bank.textContent = formatCash(save.bank);
  const maxed = save.level >= MAX_LEVEL;
  const cost = nextLevelCost(save.level);
  ui['upgrade-price'].textContent = maxed ? '최대 레벨 달성!' : `${formatCash(cost)} 코인 필요`;
  ui['upgrade-button'].textContent = maxed ? 'Lv. MAX' : '레벨업 ↑';
  ui['upgrade-button'].disabled = phase !== 'settled' || maxed || save.bank < cost;
  ui['upgrade-note'].textContent = maxed ? '베이커리가 최고 레벨이 되었어요!' :
    save.bank >= cost ? '레벨업하면 타격당 기본 코인이 1 증가해요.' :
    `${formatCash(Math.max(0,cost-save.bank))} 코인 더 모으면 레벨업할 수 있어요.`;
}

function updateHUD(now=performance.now()) {
  const left = phase === 'running' && round ? remainingMs(round.startedAt,now) :
    phase === 'counting' || phase === 'settled' ? 0 : ROUND_MS;
  ui.timer.textContent = (left/1000).toFixed(1);
  ui['timer-fill'].style.width = `${clamp(left/ROUND_MS*100,0,100)}%`;
  ui['run-cash'].textContent = formatCash(round?.earnings ?? 0);
  ui.combo.textContent = formatCash(round?.combo ?? 0);
  // Show what the next tap really pays, including high-level and streak bonuses.
  const nextCombo = phase === 'running' && round && round.lastTapAt !== null &&
    now-round.lastTapAt < COMBO_RESET_MS ? round.combo+1 : 1;
  ui['next-reward'].textContent = formatCash(hitReward(save.level,nextCombo).total);
}

function floatAt(message,clientX,clientY,type='cash') {
  const rect=ui.stage.getBoundingClientRect();
  const tag=document.createElement('div');
  tag.className=`float-label ${type}`;
  tag.textContent=message;
  tag.style.left=`${clamp(clientX-rect.left,45,Math.max(45,rect.width-45))}px`;
  tag.style.top=`${clamp(clientY-rect.top,40,Math.max(40,rect.height-50))}px`;
  ui.popups.append(tag);
  // Don't accumulate hundreds of animated DOM nodes during rapid tapping.
  while(ui.popups.children.length>20) ui.popups.firstElementChild.remove();
  setTimeout(()=>tag.remove(),720);
}

function startRound() {
  if(!['ready','settled'].includes(phase)) return;
  void sounds.unlock();
  cancelAnimationFrame(resultFrame);
  ui['result-cover'].hidden=true;
  ui['result-breakdown'].hidden=true;
  ui['result-close'].hidden=true;
  ui['upgrade-card'].hidden=true;
  round=createRound(performance.now());
  controller.syncRound(round);
  setPhase('running');
  updateHUD();
}

function finishRound(now=performance.now()) {
  if(phase!=='running' || !round) return;
  closeRound(round,now);
  round.combo=0;
  controller.syncRound(round);
  save.best=Math.max(save.best,round.earnings);
  save.rounds++;
  persist();
  setPhase('counting');
  updateHUD();
  ui['result-cover'].hidden=false;
  ui['result-breakdown'].hidden=true;
  ui['result-close'].hidden=true;
  ui['result-kicker'].textContent='열심히 모은 우유를 짜는 중…';
  ui['result-title'].textContent='착유중...';
  ui['result-earnings'].textContent='0';
  const started=performance.now();
  const duration=2000;
  const animate=(time)=>{
    if(phase!=='counting') return;
    const t=clamp((time-started)/duration,0,1);
    ui['result-earnings'].textContent=formatCash(Math.round((1-(1-t)**3)*round.earnings));
    if(t<1) resultFrame=requestAnimationFrame(animate);
    else revealResult();
  };
  resultFrame=requestAnimationFrame(animate);
}

function revealResult() {
  if(phase!=='counting' || !round) return;
  ui['result-kicker'].textContent='착유 성공! 빵집 재료가 늘었어요';
  ui['result-title'].textContent='착유 완료 ♡';
  ui['result-earnings'].textContent=formatCash(round.earnings);
  ui['result-taps'].textContent=formatCash(round.left+round.right);
  ui['result-combo'].textContent=formatCash(round.maxCombo);
  ui['result-bonus'].textContent=formatCash(round.bonusEarnings);
  ui['result-breakdown'].hidden=false;
  ui['result-close'].hidden=false;
  setPhase('settled');
}

function onGameHit(kind,x,y) {
  if(phase!=='running')return;
  const now=performance.now();
  if(remainingMs(round.startedAt,now)<=0){finishRound(now);return;}
  const earned=registerHit(round,kind,now,save.level);
  controller.syncRound(round);
  if(kind===TAPS.LEFT||kind===TAPS.RIGHT){
    controller.trigger(kind,now);
    sounds.play(kind,.65);
    if(earned>0){
      save.bank+=earned;
      save.lifetime+=earned;
      const hasBonus=round.lastReward?.comboBonus+round.lastReward?.bigHitBonus>0;
      floatAt(`+${formatCash(earned)} 🪙${hasBonus?' ✦':''}`,x,y);
    }
  }else if(kind===TAPS.HEAD){
    controller.trigger('head',now);
    sounds.play('facehit',.85);
    sounds.play('touch',.7);
    floatAt('아야! 💢',x,y,'ouch');
  }
  updateHUD(now);
}

function hitName(event) {
  if(!live2d?.hitAt)return null;
  try{return live2d.hitAt(event.clientX,event.clientY);}
  catch(error){console.error('[Bakery] HitArea failed:',error);return null;}
}

function pointerDown(event) {
  if(phase!=='running')return;
  if(event.pointerType==='mouse' && event.button!==0)return;
  const name=hitName(event);
  if(name==='HitAreacheek') {
    cheekDrag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
      lastX:event.clientX,lastY:event.clientY,moved:false};
    ui.stage.setPointerCapture?.(event.pointerId);
    // Immediately start crying, even before the cheek starts moving.
    controller.setCheekDrag(0,0);
    ui.stage.classList.add('dragging-cheek');
    event.preventDefault();
    return;
  }
  if(name==='HitAreahead')onGameHit(TAPS.HEAD,event.clientX,event.clientY);
  else if(name==='HitArealeft')onGameHit(TAPS.LEFT,event.clientX,event.clientY);
  else if(name==='HitArearight')onGameHit(TAPS.RIGHT,event.clientX,event.clientY);
}

function pointerMove(event) {
  if(!cheekDrag || cheekDrag.pointerId!==event.pointerId)return;
  cheekDrag.lastX=event.clientX;
  cheekDrag.lastY=event.clientY;
  if(Math.hypot(event.clientX-cheekDrag.startX,event.clientY-cheekDrag.startY)>=6)cheekDrag.moved=true;
  const size=Math.max(58,Math.min(ui.stage.clientWidth,ui.stage.clientHeight)*.20);
  controller.setCheekDrag((event.clientX-cheekDrag.startX)/size,
    -(event.clientY-cheekDrag.startY)/size);
  event.preventDefault();
}

function pointerUp(event) {
  if(!cheekDrag || cheekDrag.pointerId!==event.pointerId)return;
  const {lastX,lastY,moved}=cheekDrag;
  cheekDrag=null;
  controller.releaseCheek();
  ui.stage.classList.remove('dragging-cheek');
  if(ui.stage.hasPointerCapture?.(event.pointerId))ui.stage.releasePointerCapture(event.pointerId);
  if(moved && event.type!=='pointercancel' && phase==='running' &&
    remainingMs(round.startedAt,performance.now())>0){
    registerHit(round,TAPS.CHEEK,performance.now(),save.level);
    sounds.play('voice',.95);
    floatAt('으아앙… 💧',lastX,lastY,'ouch');
  }
}

function upgrade() {
  if(phase!=='settled')return;
  const result=tryUpgrade(save);
  if(!result.ok)return;
  controller.setLevel(save.level);
  controller.syncRound(round);
  persist();
  updateShop();
  updateHUD();
  toast(`레벨 ${save.level}! 다음 타격 기본 보상 +1 🥐`);
}

function loop(now) {
  if(phase==='running' && round){
    if(round.combo && round.lastTapAt!=null && now-round.lastTapAt>=COMBO_RESET_MS){
      round.combo=0;
      controller.syncRound(round);
    }
    if(remainingMs(round.startedAt,now)<=0)finishRound(now);
    else if(now-lastPaintAt>50){
      updateHUD(now);
      lastPaintAt=now;
      if(now-lastSaveAt>1800){persist();lastSaveAt=now;}
    }
  }
  requestAnimationFrame(loop);
}

ui.stage.addEventListener('pointerdown',pointerDown,{passive:false});
ui.stage.addEventListener('pointermove',pointerMove,{passive:false});
ui.stage.addEventListener('pointerup',pointerUp);
ui.stage.addEventListener('pointercancel',pointerUp);
ui['start-button'].addEventListener('click',startRound);
ui['upgrade-button'].addEventListener('click',upgrade);
ui['result-close'].addEventListener('click',()=>{
  ui['result-cover'].hidden=true;
  ui['upgrade-card'].hidden=false;
  updateShop();
});
ui['mute-button'].addEventListener('click',()=>{
  sounds.muted=!sounds.muted;
  ui['mute-button'].textContent=sounds.muted?'🔇':'🔊';
  ui['mute-button'].title=sounds.muted?'소리 켜기':'소리 끄기';
});
ui['prologue-start'].addEventListener('click',()=>{
  void sounds.unlock();
  ui.prologue.hidden=true;
  if(phase==='ready')startRound();
  else if(phase==='loading')pendingStart=true;
  else if(phase==='error')toast('모델 로딩 상태를 확인해 주세요.');
});
window.addEventListener('pagehide',persist);
window.addEventListener('blur',persist);

setPhase('loading');
updateHUD();
requestAnimationFrame(loop);
initializeModel(ui['live2d-canvas'],ui.stage,controller,message=>{
  ui['load-message'].textContent=message;
}).then(result=>{
  live2d=result;
  controller.setLevel(save.level);
  controller.syncRound(round);
  ui['model-loading'].hidden=true;
  setPhase('ready');
  updateHUD();
  if(pendingStart){pendingStart=false;startRound();}
}).catch(error=>{
  console.error('[Bakery] Live2D loading failed:',error);
  ui['load-message'].textContent='Live2D 모델 로딩 실패';
  ui['load-error'].textContent=`${error instanceof Error ? error.message:String(error)}\n\nmoc3 v6 모델은 Cubism Core 06이 필요합니다. npm run postinstall 또는 공식 Core 6.x 설치를 확인하세요.`;
  ui['load-error'].hidden=false;
  setPhase('error');
});
