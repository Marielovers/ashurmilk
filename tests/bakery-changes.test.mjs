import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRound,registerHit,hitReward,TAPS,ROUND_MS} from '../src/logic.js';
import {ModelController} from '../src/live2d.js';

function fakePort() {
  const store = new Map();
  const getRange = (id) => id==='level' ? {min:0,max:10,def:0} :
    ['cheekX','cheekY'].includes(id) ? {min:-2,max:2,def:0} : {min:0,max:1,def:0};
  return {store,port:{set(id,value){store.set(id,value);return true;},get(id){return store.get(id);},range:getRange}};
}

test('level boosts the first hit, and longer combo pays more per tap',()=>{
  assert.deepEqual(hitReward(0,1),{base:1,comboBonus:0,bigHitBonus:0,total:1});
  assert.equal(hitReward(5,1).total,6);
  assert.ok(hitReward(5,11).total>hitReward(5,1).total);
  assert.ok(hitReward(5,50).total>hitReward(5,11).total);
  assert.ok(hitReward(10,50).total>hitReward(5,50).total);
  assert.ok(hitReward(10,150).total===hitReward(10,121).total,'combo cap');
});

test('larger single-hit subtotal adds an extra bonus',()=>{
  const reward=hitReward(8,30);
  assert.ok(reward.comboBonus>0);
  assert.ok(reward.bigHitBonus>0);
  assert.equal(reward.total,reward.base+reward.comboBonus+reward.bigHitBonus);
});

test('round coins count base and extra accurately, combo loss resets bonuses',()=>{
  const r=createRound(0);
  for(let i=0;i<40;i++)registerHit(r,TAPS.LEFT,1+i*100,4);
  assert.ok(r.bonusEarnings>0);
  assert.equal(r.earnings,r.baseEarnings+r.bonusEarnings);
  const prev=r.earnings;
  assert.equal(registerHit(r,TAPS.RIGHT,9000,4),hitReward(4,1).total);
  assert.equal(r.combo,1);
  assert.equal(r.earnings,prev+hitReward(4,1).total);
  assert.equal(registerHit(r,TAPS.HEAD,9100,4),0);
  assert.equal(registerHit(r,TAPS.CHEEK,9150,4),0);
  assert.equal(registerHit(r,TAPS.LEFT,ROUND_MS,4),0);
});

test('cheek crying begins on pointer down and persists during drag, fading after release',()=>{
  const ctl=new ModelController();
  const {store,port}=fakePort();
  ctl.port=port;
  ctl.model={internalModel:{coreModel:{update(){},saveParameters(){}}}};
  ctl.setCheekDrag(.5,-.3);
  assert.equal(ctl.cheekDragging,true);
  assert.ok(store.get('tears')>=.7,'tears visible immediately');
  assert.ok(store.get('ParamEyeLOpen')<.5,'pain face appears while dragging');
  ctl.setCheekDrag(.9,.8);
  assert.equal(store.get('cheekX'),1.8);
  assert.equal(store.get('cheekY'),1.6);
  assert.ok(store.get('tears')>=.7);
  ctl.releaseCheek();
  assert.equal(ctl.cheekDragging,false);
  assert.ok(store.get('tears')>=.7,'tears do not abruptly start on release');
  ctl.applyToCore({},performance.now()+3000);
  assert.ok(store.get('tears')<1,'tears start to fade');
});

test('user-modified prologue, title and model layout values are preserved',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../src/live2d.js',import.meta.url),'utf8');
  assert.match(html,/슈르 수유 베이커리/);
  assert.match(html,/id="prologue"/);
  assert.match(html,/ashur-story\.png/);
  assert.match(script,/scale\*1\.50/);
  assert.match(script,/model\.y=h\*\.40/);
  assert.match(script,/\/\/ this\.set\(core,'ParamBodyAngleX'/);
});


test('revised opening explains the milk shortage and Ashur’s plan',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/우유가 똑 떨어진 것/);
  assert.match(html,/자신의 <strong>모유를 빵집 재료로 쓰기로/);
  assert.match(html,/가슴 마사지로 가슴을 키우고, 우유를 착유해/);
  assert.match(html,/id="prologue-start"/);
  assert.doesNotMatch(html,/손님은 뜸하고, 재료비는 자꾸 오르고/);
});
