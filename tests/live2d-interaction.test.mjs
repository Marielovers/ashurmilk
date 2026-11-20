import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {triangleContains,drawableContains,toRendererPosition,hitFromGeometry,resolveHitAreaIndices} from '../src/hit-test.js';
import {ParameterPort} from '../src/parameter-port.js';
import {ModelController,parameterRanges} from '../src/live2d.js';
import {createRound,registerHit,TAPS} from '../src/logic.js';

const IDS=['level','cheekX','cheekY','BHLEFT','BHRIGHT','headattack','tears','shy','leftshot','rightshot','moutgtype','rmhighlight','rmpupil','ParamEyeLOpen'];
const DRAWABLES=['AnUnrelatedArtMesh','HitArearight','HitAreahead','HitArealeft','HitAreacheek'];
function fixture(){
  const info=IDS.map(id=>{
    const max=id==='level'?10:id==='moutgtype'?8:(id==='cheekX'||id==='cheekY')?2:1;
    return{id,min:(id==='cheekX'||id==='cheekY')?-2:0,max,def:0};
  });
  const values=new Float32Array(info.length);
  let snapshot=new Float32Array(values);
  let stringBasedCalls=0;
  const raw={
    parameters:{ids:info.map(v=>v.id),count:info.length,values,minimumValues:info.map(v=>v.min),maximumValues:info.map(v=>v.max),defaultValues:info.map(v=>v.def)},
    drawables:{ids:DRAWABLES,indices:[new Uint16Array([0,1,2])]},
  };
  const core={
    _model:raw,
    getParameterCount(){return info.length;},
    getParameterId(i){return{getString(){return{s:IDS[i]}}};},
    getParameterMinimumValue(i){return info[i].min;},
    getParameterMaximumValue(i){return info[i].max;},
    getParameterDefaultValue(i){return info[i].def;},
    // Real CubismModel EXPECTS A CubismIdHandle. A string is an unrelated key!
    setParameterValueById(id){if(typeof id==='string'){stringBasedCalls++;throw new Error('CubismIdHandle required');}},
    setParameterValueByIndex(i,v){values[i]=Math.min(info[i].max,Math.max(info[i].min,v));},
    getParameterValueByIndex(i){return values[i];},
    getDrawableIndex(id){return typeof id==='string'?-1:DRAWABLES.indexOf(id?.name);},
    saveParameters(){snapshot.set(values);},
    loadParameters(){values.set(snapshot);},
    update(){},
  };
  const handlers=new Map();
  const internal={coreModel:core,hitAreas:Object.fromEntries(DRAWABLES.slice(1).map(id=>[id,{index:-1}])),
    on(event,cb){handlers.set(event,cb);},
    getDrawableIDs(){return DRAWABLES;},
    getDrawableVertices(){return new Float32Array([0,0,100,0,0,100]);},
    update(){
      // Engine writes (and may overwrite custom parameters) prior to hook.
      values[IDS.indexOf('level')]=0;
      values[IDS.indexOf('cheekX')]=0;
      values[IDS.indexOf('BHLEFT')]=0;
      handlers.get('beforeModelUpdate')?.();
      core.update();core.loadParameters();
    },
  };
  return{core,internal,values,info,model:{internalModel:internal},getStringCallCount(){return stringBasedCalls;}};
}
async function controllerFixture(){
  const f=fixture();
  const prev=globalThis.fetch;
  globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(`../public/model/${String(url).split('/').at(-1)}`,import.meta.url),'utf8'))});
  try{const ctl=new ModelController();await ctl.attach(f.model);return{ctl,...f};}
  finally{globalThis.fetch=prev;}
}
const read=(f,id)=>f.values[IDS.indexOf(id)];

test('client coordinates use renderer dimensions, not raw device pixels',()=>{
  assert.deepEqual(toRendererPosition(350,250,{left:100,top:50,width:500,height:400},1000,800),{x:500,y:400});
});
test('actual triangle excludes rectangle-only hits',()=>{
  const verts=new Float32Array([0,0,100,0,0,100]),tris=new Uint16Array([0,1,2]);
  assert.equal(triangleContains(10,10,0,0,100,0,0,100),true);
  assert.equal(drawableContains(90,90,verts,tris),false);
  assert.equal(drawableContains(12,12,verts,tris),true);
});
test('HitAreas resolve from real drawable strings even if SDK internal indices are -1',()=>{
  const f=fixture();
  const areas=resolveHitAreaIndices(f.internal,f.core);
  assert.equal(areas.HitAreacheek.index,4);
  assert.equal(areas.HitArealeft.index,3);
  assert.equal(areas.HitArearight.index,1);
  assert.equal(areas.HitAreahead.index,2);
});
test('HitArea prioritizes cheek when meshes overlap',()=>{
  const f=fixture();
  const areas=resolveHitAreaIndices(f.internal,f.core);
  f.core.getDrawableVertexIndices=()=>new Uint16Array([0,1,2]);
  assert.equal(hitFromGeometry(f.internal,f.core,10,10,areas),'HitAreacheek');
});
test('index port rejects missing IDs, reads ranges and uses no string-id setter',()=>{
  const f=fixture(),port=new ParameterPort(f.core);
  port.require(['cheekX','level','moutgtype']);
  assert.deepEqual(port.ranges().get('cheekX'),{min:-2,max:2,def:0});
  port.set('level',6);assert.equal(port.get('level'),6);
  port.set('cheekX',5);assert.equal(port.get('cheekX'),2);
  assert.equal(port.set('nosuch',1),false);
  assert.throws(()=>port.require(['nosuch']),/nosuch/);
  assert.equal(f.getStringCallCount(),0);
});
test('fallback CubismIdHandle -> string correctly resolved during parameter enumeration',()=>{
  const f=fixture(),port=new ParameterPort({
    getParameterCount:()=>IDS.length,
    getParameterId:i=>({getString:()=>({_s:IDS[i]})}),
    getParameterMinimumValue:i=>f.info[i].min,
    getParameterMaximumValue:i=>f.info[i].max,
    getParameterDefaultValue:i=>f.info[i].def,
    setParameterValueByIndex:i=>i,
  });
  assert.equal(port.range('level').max,10);
});
test('real renderer beforeModelUpdate persists level 7 through engine reset/loadParameters',async()=>{
  const f=await controllerFixture();f.ctl.setLevel(7);
  assert.equal(read(f,'level'),7);
  for(let i=0;i<10;i++)f.internal.update(16,performance.now());
  assert.equal(read(f,'level'),7);
  assert.equal(f.getStringCallCount(),0);
  assert.ok(f.ctl.updatedFrames>0);
});
test('original motion curves yield BHLEFT BHRIGHT headattack on index-based model',async()=>{
  const f=await controllerFixture(),t=performance.now();
  f.ctl.trigger('left',t);f.ctl.applyToCore(f.core,t+120);assert.ok(read(f,'BHLEFT')>.5);
  f.ctl.trigger('right',t+210);f.ctl.applyToCore(f.core,t+325);assert.ok(read(f,'BHRIGHT')>.5);
  f.ctl.trigger('head',t+400);f.ctl.applyToCore(f.core,t+520);assert.ok(read(f,'headattack')>.5);
  assert.ok(read(f,'tears')>.05);
});
test('cheek X,Y move INSTANTLY on drag and return to rest after release',async()=>{
  const f=await controllerFixture(),t=performance.now();
  f.ctl.setCheekDrag(.75,-.6);
  assert.ok(read(f,'cheekX')>1.45);
  assert.ok(read(f,'cheekY')< -1.15);
  f.internal.update(16,t+20);
  assert.ok(read(f,'cheekX')>1.45);
  f.ctl.releaseCheek();
  for(let i=1;i<=45;i++)f.ctl.applyToCore(f.core,t+i*16);
  assert.ok(Math.abs(read(f,'cheekX'))<.15);
  assert.ok(Math.abs(read(f,'cheekY'))<.15);
});
test('combo/shy + level>=5 side100/shot + 50-tap integer mouth',async()=>{
  const f=await controllerFixture(),round=createRound(0),t=performance.now();
  f.ctl.setLevel(5);
  for(let i=0;i<49;i++)registerHit(round,TAPS.LEFT,10+i*75);
  f.ctl.syncRound(round);assert.equal(f.ctl.mouthType,0);
  registerHit(round,TAPS.RIGHT,3750);f.ctl.syncRound(round);assert.equal(f.ctl.mouthType,1);
  for(let i=50;i<100;i++)registerHit(round,TAPS.LEFT,10+i*75);
  f.ctl.syncRound(round);assert.equal(f.ctl.mouthType,2);
  assert.equal(f.ctl.shyTarget,1);
  assert.equal(f.ctl.leftShotTarget,.99);
  assert.equal(f.ctl.rightShotTarget,.01);
  for(let i=1;i<=90;i++)f.ctl.applyToCore(f.core,t+i*16);
  assert.ok(read(f,'shy')>.99);assert.ok(read(f,'leftshot')>.98);
  assert.equal(read(f,'moutgtype'),2);
  registerHit(round,TAPS.LEFT,7500);f.ctl.syncRound(round);assert.equal(f.ctl.leftShotTarget,1);
  f.ctl.setLevel(4);f.ctl.syncRound(round);assert.equal(f.ctl.leftShotTarget,0);
});
test('model source has the hit mesh IDs and all parameter IDs as raw strings',async()=>{
  const moc=await readFile(new URL('../public/model/슈르.moc3',import.meta.url));
  for(const id of [...IDS.filter(id=>!id.startsWith('ParamEye')), ...DRAWABLES.slice(1)])assert.ok(moc.includes(Buffer.from(id)),id);
});
test('model3.json refers to three short non-looping gameplay motions',async()=>{
  const p=new URL('../public/model/',import.meta.url),model=JSON.parse(await readFile(new URL('슈르.model3.json',p),'utf8'));
  for(const key of ['TapLeft','TapRight','TapHead']){
    const motion=JSON.parse(await readFile(new URL(model.FileReferences.Motions[key][0].File,p),'utf8'));
    assert.equal(motion.Meta.Loop,false);
    assert.equal(motion.Meta.Duration,.82);
  }
});


test('shy is based on highest combo and does not regress when the combo breaks', async()=>{
  const f=await controllerFixture();
  const round=createRound(0);
  for(let i=0;i<80;i++)registerHit(round,TAPS.LEFT,10+i*60);
  f.ctl.syncRound(round);
  assert.equal(round.maxCombo,80);
  assert.equal(f.ctl.shyTarget,.8);
  f.ctl.applyToCore(f.core,performance.now()+1000);
  const beforeBreak=read(f,'shy');
  registerHit(round,TAPS.RIGHT,10000);
  assert.equal(round.combo,1);
  assert.equal(round.maxCombo,80);
  f.ctl.syncRound(round);
  assert.equal(f.ctl.shyTarget,.8);
  f.ctl.applyToCore(f.core,performance.now()+1100);
  assert.ok(read(f,'shy')>=beforeBreak,'shy must not decrease after a combo break');
  // Emulate the idle combo reset performed by the main frame loop.
  round.combo=0;
  f.ctl.syncRound(round);
  assert.equal(f.ctl.shyTarget,.8);
  assert.ok(read(f,'shy')>0);
});

test('tears 150 / rmhighlight 200 / rmpupil 250 trigger at exact cumulative hit thresholds and latch',async()=>{
  const f=await controllerFixture();
  const round=createRound(0);
  const hit=()=>{
    const count=round.left+round.right;
    registerHit(round,count%2?TAPS.RIGHT:TAPS.LEFT,10+count*80);
    f.ctl.syncRound(round);
    f.ctl.applyToCore(f.core,performance.now()+2000+count*17);
  };
  for(let i=0;i<149;i++)hit();
  assert.equal(f.ctl.lockedTears,false);
  assert.equal(read(f,'rmhighlight'),0);
  assert.equal(read(f,'rmpupil'),0);
  // Temporary pain can raise tears, but the 150-hit latch is not yet active.
  f.ctl.releaseCheek();
  hit();
  assert.equal(round.left+round.right,150);
  assert.equal(read(f,'tears'),1);
  assert.equal(f.ctl.lockedTears,true);
  for(let i=150;i<199;i++)hit();
  assert.equal(read(f,'rmhighlight'),0);
  assert.equal(read(f,'rmpupil'),0);
  hit();
  assert.equal(round.left+round.right,200);
  assert.equal(read(f,'rmhighlight'),1);
  for(let i=200;i<249;i++)hit();
  assert.equal(read(f,'rmpupil'),0);
  hit();
  assert.equal(round.left+round.right,250);
  assert.equal(read(f,'rmpupil'),1);
  assert.equal(read(f,'tears'),1);
  assert.equal(read(f,'rmhighlight'),1);
  // Combo breaks and round settlement should not clear the effects.
  round.combo=0;
  f.ctl.syncRound(round);
  f.ctl.applyToCore(f.core,performance.now()+9999);
  assert.equal(read(f,'tears'),1);
  assert.equal(read(f,'rmhighlight'),1);
  assert.equal(read(f,'rmpupil'),1);
});

test('starting another round clears the locked expression milestones without modifying level',async()=>{
  const f=await controllerFixture();
  f.ctl.setLevel(8);
  const oldRound=createRound(0);
  oldRound.left=175;oldRound.right=100;oldRound.combo=0;oldRound.maxCombo=96;
  f.ctl.syncRound(oldRound);
  f.ctl.applyToCore(f.core,performance.now()+1000);
  assert.equal(read(f,'tears'),1);
  assert.equal(read(f,'rmhighlight'),1);
  assert.equal(read(f,'rmpupil'),1);
  assert.equal(f.ctl.shyTarget,.96);
  const newRound=createRound(80000);
  f.ctl.syncRound(newRound);
  f.ctl.applyToCore(f.core,performance.now()+1100);
  assert.equal(read(f,'tears'),0);
  assert.equal(read(f,'rmhighlight'),0);
  assert.equal(read(f,'rmpupil'),0);
  assert.equal(f.ctl.shyTarget,0);
  assert.equal(read(f,'shy'),0);
  assert.equal(read(f,'level'),8);
});
