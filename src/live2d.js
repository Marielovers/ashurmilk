import { clamp } from './logic.js';
import { loadMotions, motionValue } from './motions.js';
import { ParameterPort } from './parameter-port.js';
import { resolveHitAreaIndices, hitFromGeometry, toRendererPosition, HIT_PRIORITY } from './hit-test.js';

const CORE_LOCAL='./vendor/live2dcubismcore.min.js';
const CORE_OFFICIAL='https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js';

function injectScript(url){return new Promise((resolve,reject)=>{
  const el=document.createElement('script');el.src=url;
  el.onload=resolve;el.onerror=()=>{el.remove();reject(new Error(`Live2D Core 로딩 실패: ${url}`));};
  document.head.appendChild(el);
});}
async function loadCore(){
  if(window.Live2DCubismCore)return;
  try {
    const r=await fetch(CORE_LOCAL,{method:'HEAD'});
    if(r.ok&&!r.headers.get('content-type')?.includes('text/html'))await injectScript(CORE_LOCAL);
  }catch(err){console.warn('[Ashur] local Core unavailable:',err);}
  if(!window.Live2DCubismCore)await injectScript(CORE_OFFICIAL);
  if(!window.Live2DCubismCore)throw new Error('Cubism Core 06을 읽지 못했습니다. npm run postinstall로 준비하세요.');
}

export function parameterRanges(core){return new ParameterPort(core).ranges();}
const ease=(a,b,dt,speed)=>a+(b-a)*(1-Math.exp(-dt*speed));
const REQUIRED=['level','cheekX','cheekY','tears','BHLEFT','BHRIGHT','headattack','shy','leftshot','rightshot','moutgtype','rmhighlight','rmpupil'];

export class ModelController {
  constructor(){
    this.model=null;this.port=null;this.ranges=new Map();this.motions=null;
    this.level=0;this.updatedFrames=0;
    this.pulses={left:-Infinity,right:-Infinity,head:-Infinity};
    this.durations={left:820,right:820,head:850};
    this.lastNative={left:-Infinity,right:-Infinity,head:-Infinity};
    this.painStart=-Infinity;this.painDuration=1600;this.painStrength=0;
    this.cheekDragging=false;this.cheekInput={x:0,y:0};this.cheekPosition={x:0,y:0};
    this.gaze={x:0,y:0,targetX:0,targetY:0,nextAt:0};this.nextBlinkAt=0;this.blinkAt=-Infinity;
    this.clockStart=performance.now();this.lastUpdate=this.clockStart;
    this.shyTarget=0;this.shy=0;
    this.leftShotTarget=0;this.rightShotTarget=0;this.leftShot=0;this.rightShot=0;
    this.mouthType=0;this.tears=0;
    this.lockedTears=false;this.lockedHighlight=false;this.lockedPupil=false;
    this.currentRound=null;
    this.hitAreas=null;
  }
  async attach(model){
    const internal=model?.internalModel;
    if(!internal?.coreModel)throw new Error('Live2D 모델 내부 Core가 없습니다.');
    this.port=new ParameterPort(internal.coreModel);
    this.port.require(REQUIRED);
    this.ranges=this.port.ranges();
    this.hitAreas=resolveHitAreaIndices(internal,internal.coreModel);
    this.motions=await loadMotions();
    this.model=model;
    this.lastUpdate=this.clockStart=performance.now();
    console.info('[Ashur] Cubism parameter indices:',Object.fromEntries(REQUIRED.map(id=>[id,this.port.byId.get(id)?.index])));
    console.info('[Ashur] True HitArea drawable indices:',Object.fromEntries(HIT_PRIORITY.map(id=>[id,this.hitAreas[id].index])));
    // This fires AFTER native motions, blink, focus and physics have written
    // parameters, but BEFORE Cubism regenerates the drawable vertices.
    // Applying on an unrelated browser rAF gets overwritten on each frame.
    let didFire=false;
    if(typeof internal.on==='function'){
      internal.on('beforeModelUpdate',()=>{
        didFire=true;
        this.applyToCore(internal.coreModel,performance.now());
        internal.coreModel.saveParameters?.();
      });
    }
    // Compatibility fallback for forks without the event. Do not apply twice.
    if(typeof internal.update==='function'){
      const previous=internal.update;
      const controller=this;
      internal.update=function(...args){
        didFire=false;
        const result=previous.apply(this,args);
        if(!didFire){
          controller.applyToCore(internal.coreModel,performance.now());
          internal.coreModel.update?.();
          internal.coreModel.saveParameters?.();
        }
        return result;
      };
    }
    this.applyImmediately();
    // A real readback verifies that the INDEX writer talks to the Core model.
    const before=this.level;
    this.port.set('level',Math.min(this.port.range('level').max,Math.max(this.port.range('level').min,before)));
    const actual=this.port.get('level');
    if(!Number.isFinite(actual))throw new Error('Core level 파라미터 읽기 검증 실패');
  }
  range(id,fallback={min:-1,max:1,def:0}){return this.port?.range(id,fallback)??fallback;}
  set(core,id,v){return this.port?.set(id,v)??false;}
  read(id){return this.port?.get(id);}
  setLevel(level){this.level=clamp(Math.floor(level),0,10);this.applyImmediately();}
  syncRound(round){
    // A new round is the only event that clears the previous round's
    // earned expression milestones. A broken combo does NOT clear them.
    if(round && round!==this.currentRound){
      this.currentRound=round;
      this.shy=0;this.shyTarget=0;
      this.leftShot=0;this.rightShot=0;
      this.tears=0;
      this.lockedTears=false;
      this.lockedHighlight=false;
      this.lockedPupil=false;
      this.painStart=-Infinity;
    }
    const total=(round?.left??0)+(round?.right??0);
    // Keep the highest combo achieved within this round, not the live combo.
    this.shyTarget=clamp((round?.maxCombo??0)/100,0,1);
    this.leftShotTarget=this.level>=5?clamp((round?.left??0)/100,0,1):0;
    this.rightShotTarget=this.level>=5?clamp((round?.right??0)/100,0,1):0;
    this.mouthType=Math.floor(total/50);
    this.lockedTears=total>=150;
    this.lockedHighlight=total>=200;
    this.lockedPupil=total>=250;
  }
  trigger(kind,now=performance.now()){
    if(!(kind in this.pulses))return;
    this.pulses[kind]=now;
    if(kind==='head')this.hurt(1,1700,now);
    this.applyImmediately();
    // Use the native motion manager too (author's motion3 curves). Its async
    // loading/reservation may drop rapid taps, so the indexed pulse above
    // guarantees a frame-perfect response to every click.
    if(this.model?.motion && now-this.lastNative[kind]>160){
      this.lastNative[kind]=now;
      const group={left:'TapLeft',right:'TapRight',head:'TapHead'}[kind];
      Promise.resolve().then(()=>this.model?.motion(group,0,3)).catch(e=>{
        if(!this.warnedMotion){console.warn('[Ashur] native motion fallback is active:',e);this.warnedMotion=true;}
      });
    }
  }
  hurt(strength=.8,duration=1500,now=performance.now()){
    this.painStart=now;this.painDuration=duration;this.painStrength=strength;
  }
  setCheekDrag(x,y){
    this.cheekDragging=true;
    this.cheekInput.x=clamp(x,-1,1);this.cheekInput.y=clamp(y,-1,1);
    // Direct input, not a zero-dt ease which used to leave variables unchanged.
    this.cheekPosition.x=this.cheekTarget('cheekX',this.cheekInput.x);
    this.cheekPosition.y=this.cheekTarget('cheekY',this.cheekInput.y);
    // Tears and painful expression begin DURING the grab, not on release.
    // The initial jump avoids an invisible first frame when dt is near zero.
    this.tears=Math.max(this.tears,.72);
    this.applyImmediately();
  }
  cheekTarget(id,normalized){
    const r=this.range(id);
    return r.def+(normalized>=0?(r.max-r.def):(r.def-r.min))*normalized;
  }
  releaseCheek(){
    if(!this.cheekDragging)return;
    this.cheekDragging=false;this.cheekInput={x:0,y:0};this.hurt(.85,1800);
  }
  applyImmediately(){
    const core=this.model?.internalModel?.coreModel;
    if(!core||!this.port)return;
    this.applyToCore(core,performance.now());
    core.update?.();core.saveParameters?.();
  }
  pulseValue(kind,id,now){
    const fraction=(now-this.pulses[kind])/this.durations[kind];
    if(fraction<0||fraction>=1)return 0;
    return motionValue(this.motions,kind,id,fraction);
  }
  applyToCore(core,now){
    if(!this.port)return;
    const dt=clamp((now-this.lastUpdate)/1000,0,.08);
    this.lastUpdate=now;
    const s=(now-this.clockStart)/1000;
    if(now>=this.gaze.nextAt){
      this.gaze.targetX=Math.random()*1.1-.55;
      this.gaze.targetY=Math.random()*.65-.325;
      this.gaze.nextAt=now+1800+Math.random()*2500;
    }
    this.gaze.x=ease(this.gaze.x,this.gaze.targetX,dt,1.35);
    this.gaze.y=ease(this.gaze.y,this.gaze.targetY,dt,1.35);
    if(now>=this.nextBlinkAt){this.blinkAt=now;this.nextBlinkAt=now+2400+Math.random()*3000;}
    const blinkT=(now-this.blinkAt)/200;
    const eye=(blinkT>=0&&blinkT<1)?1-Math.sin(Math.PI*blinkT)**2:1;
    const t=now-this.painStart;
    const lingeringPain=(t>=0&&t<this.painDuration)?this.painStrength*(1-t/this.painDuration)**.6:0;
    const pain=this.cheekDragging?1:lingeringPain;
    const left=this.pulseValue('left','BHLEFT',now);
    const right=this.pulseValue('right','BHRIGHT',now);
    const head=this.pulseValue('head','headattack',now);
    if(!this.cheekDragging){
      this.cheekPosition.x=ease(this.cheekPosition.x,this.range('cheekX').def,dt,7);
      this.cheekPosition.y=ease(this.cheekPosition.y,this.range('cheekY').def,dt,7);
    }
    this.shy=ease(this.shy,this.shyTarget,dt,9);
    this.leftShot=ease(this.leftShot,this.level>=5?this.leftShotTarget:0,dt,7);
    this.rightShot=ease(this.rightShot,this.level>=5?this.rightShotTarget:0,dt,7);
    this.tears=this.lockedTears?1:ease(this.tears,this.cheekDragging?1:clamp(pain*1.5,0,1),dt,this.cheekDragging?24:12);
    this.set(core,'BHLEFT',left);
    this.set(core,'BHRIGHT',right);
    this.set(core,'headattack',head);
    this.set(core,'cheekX',this.cheekPosition.x);
    this.set(core,'cheekY',this.cheekPosition.y);
    this.set(core,'level',this.level);
    this.set(core,'shy',this.range('shy',{min:0,max:1,def:0}).def+this.shy*(this.range('shy',{min:0,max:1,def:0}).max-this.range('shy',{min:0,max:1,def:0}).def));
    this.set(core,'leftshot',this.leftShot);
    this.set(core,'rightshot',this.rightShot);
    const tearsR=this.range('tears',{min:0,max:1,def:0});
    this.set(core,'tears',this.lockedTears?1:tearsR.def+this.tears*(tearsR.max-tearsR.def));
    this.set(core,'rmhighlight',this.lockedHighlight?1:0);
    this.set(core,'rmpupil',this.lockedPupil?1:0);
    this.set(core,'moutgtype',Math.round(this.mouthType)); // INT ONLY
    this.set(core,'ParamEyeLOpen',eye*(1-pain*.56));
    this.set(core,'ParamEyeROpen',eye*(1-pain*.56));
    this.set(core,'ParamEyeBallX',this.gaze.x);
    this.set(core,'ParamEyeBallY',this.gaze.y);
    this.set(core,'ParamAngleX',3*Math.sin(s*.43)+this.gaze.x*7);
    this.set(core,'ParamAngleY',2*Math.sin(s*.56)-pain*7);
    this.set(core,'ParamAngleZ',1.7*Math.sin(s*.64)+pain*2);
    // this.set(core,'ParamBodyAngleX',1.6*Math.sin(s*.39));
    this.set(core,'ParamBreath',.5+.43*Math.sin(s*2));
    this.set(core,'ParamMouthOpenY',.34*pain);
    this.set(core,'ParamBrowLY',-.65*pain);
    this.set(core,'ParamBrowRY',-.65*pain);
    this.set(core,'ParamBrowLAngle',-.65*pain);
    this.set(core,'ParamBrowRAngle',.65*pain);
    this.updatedFrames++;
  }
}

export async function initializeModel(canvas,stage,controller,onStatus) {
  onStatus('Cubism Core 06 준비 중…');
  await loadCore();
  onStatus('Live2D 엔진 로딩 중…');
  const [{Application,Ticker,Point},{Live2DModel}] = await Promise.all([
    import('pixi.js'),import('@laplace.live/pixijs-live2d'),
  ]);
  const app=new Application();
  await app.init({canvas,resizeTo:stage,backgroundAlpha:0,antialias:true,preference:'webgl',preferWebGLVersion:2,
    resolution:Math.min(window.devicePixelRatio||1,2),autoDensity:true});
  Live2DModel.registerTicker(Ticker);
  onStatus('슈르 모델 로딩 중…');
  const model=await Live2DModel.from('./model/슈르.model3.json',{autoInteract:false});
  app.stage.addChild(model);
  model.anchor.set(.5,.5);

  const resize=()=>{
    const w=stage.clientWidth,h=stage.clientHeight;
    const availableWidth=w*(w<620?.96:.88);
    const availableHeight=h*.90;
    const rawWidth=model.width/model.scale.x||model.width;
    const rawHeight=model.height/model.scale.y||model.height;
    const scale=Math.min(availableWidth/Math.max(1,rawWidth),availableHeight/Math.max(1,rawHeight));
    // +10% size and +10% stage-height lower than the original v3 placement.
    model.scale.set(scale*1.50*(controller.userZoom||1));
    model.x=w*.5;
    model.y=h*.40;
  };
  const observer=new ResizeObserver(resize);
  observer.observe(stage);
  resize();
  await controller.attach(model);

  function modelPosition(point) {
    // toModelPosition reverses BOTH Pixi world/anchor and Cubism's model canvas
    // layout transform. Coordinates now match internal.getDrawableVertices().
    if(typeof model.toModelPosition==='function')return model.toModelPosition(point);
    const p=model.worldTransform.applyInverse(point);
    return model.internalModel.localTransform?.applyInverse(p)??p;
  }
  function hitAt(clientX,clientY) {
    const pos=toRendererPosition(clientX,clientY,canvas.getBoundingClientRect(),app.screen.width,app.screen.height);
    if(!Number.isFinite(pos.x)||!Number.isFinite(pos.y))return null;
    const point=modelPosition(new Point(pos.x,pos.y));
    return hitFromGeometry(model.internalModel,model.internalModel.coreModel,point.x,point.y,controller.hitAreas);
  }
  onStatus('준비 완료!');
  return {model,app,resize,observer,hitAt};
}
