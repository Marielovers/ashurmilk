/** ArtMesh triangle picking in model canvas pixels (not CSS stage pixels). */
export const HIT_PRIORITY=Object.freeze(['HitAreacheek','HitAreahead','HitArealeft','HitArearight']);

export function triangleContains(x,y,ax,ay,bx,by,cx,cy) {
  const v0x=cx-ax,v0y=cy-ay,v1x=bx-ax,v1y=by-ay,v2x=x-ax,v2y=y-ay;
  const d=v0x*v1y-v1x*v0y;
  if(Math.abs(d)<1e-12)return false;
  const u=(v2x*v1y-v1x*v2y)/d,v=(v0x*v2y-v2x*v0y)/d;
  return u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6;
}
export function drawableContains(x,y,vertices,indices) {
  if (!vertices?.length||!indices?.length) return false;
  for(let i=0;i+2<indices.length;i+=3){
    const a=indices[i]*2,b=indices[i+1]*2,c=indices[i+2]*2;
    if(a+1>=vertices.length||b+1>=vertices.length||c+1>=vertices.length)continue;
    if(triangleContains(x,y,vertices[a],vertices[a+1],vertices[b],vertices[b+1],vertices[c],vertices[c+1]))return true;
  }
  return false;
}
export function toRendererPosition(clientX,clientY,rect,screenW,screenH) {
  if(!rect?.width||!rect?.height)return{x:NaN,y:NaN};
  return{x:(clientX-rect.left)*screenW/rect.width,y:(clientY-rect.top)*screenH/rect.height};
}

/**
 * CubismModel.getDrawableIndex() wants a CubismIdHandle and returns -1 for a
 * plain string! Use the actual raw string ID array, not internal.hitAreas index.
 */
export function resolveHitAreaIndices(internal,core,names=HIT_PRIORITY) {
  const raw=core?._model?.drawables?.ids ?? core?.getModel?.()?.drawables?.ids;
  const namesFromSDK=internal?.getDrawableIDs?.();
  const ids=(raw?.length?Array.from(raw):Array.from(namesFromSDK??[]));
  if (!ids.length) throw new Error('Live2D Drawable ID 목록을 가져오지 못했습니다.');
  const normalized=ids.map(x=>typeof x==='string'?x:(x?.getString?.()?.s??x?.s??''));
  const areas={};
  for (const name of names) {
    const index=normalized.indexOf(name);
    areas[name]={index};
  }
  const missing=names.filter(name=>areas[name].index<0);
  if(missing.length)throw new Error(`모델에 HitArea 아트메시가 없습니다: ${missing.join(', ')}`);
  return areas;
}

export function drawableGeometry(internal,core,index){
  const indices=core?.getDrawableVertexIndices?.(index)??core?._model?.drawables?.indices?.[index];
  let vertices;
  if(typeof internal?.getDrawableVertices==='function')vertices=internal.getDrawableVertices(index);
  else {
    const raw=core?._model;
    const rawPoints=raw?.drawables?.vertexPositions?.[index];
    if (!rawPoints)return{indices,vertices:null};
    const width=internal?.originalWidth??raw?.canvasinfo?.CanvasWidth??0;
    const height=internal?.originalHeight??raw?.canvasinfo?.CanvasHeight??0;
    const ppu=internal?.pixelsPerUnit??raw?.canvasinfo?.PixelsPerUnit??1;
    vertices=new Float32Array(rawPoints.length);
    for(let i=0;i<vertices.length;i+=2){vertices[i]=rawPoints[i]*ppu+width/2;vertices[i+1]=-rawPoints[i+1]*ppu+height/2;}
  }
  return{indices,vertices};
}

export function hitFromGeometry(internal,core,x,y,hitAreas=internal?.hitAreas??{}) {
  for(const name of HIT_PRIORITY){
    const index=hitAreas[name]?.index;
    if (!Number.isInteger(index)||index<0)continue;
    const {vertices,indices}=drawableGeometry(internal,core,index);
    if(indices?.length && vertices?.length && drawableContains(x,y,vertices,indices))return name;
    if(!indices?.length&&vertices?.length){
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      for(let i=0;i<vertices.length;i+=2){minX=Math.min(minX,vertices[i]);maxX=Math.max(maxX,vertices[i]);minY=Math.min(minY,vertices[i+1]);maxY=Math.max(maxY,vertices[i+1]);}
      if(x>=minX&&x<=maxX&&y>=minY&&y<=maxY)return name;
    }
  }
  return null;
}
