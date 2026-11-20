/**
 * Bind by ACTUAL Core parameter ARRAY INDEX, never by a string passed to
 * CubismModel.setParameterValueById(). That API expects a CubismIdHandle.
 * Missing IDs are not silently fabricated by CubismModel.getParameterIndex().
 */
export function cubismString(id) {
  if (typeof id === 'string') return id;
  if (id == null) return '';
  if (typeof id.s === 'string') return id.s;
  if (typeof id._s === 'string') return id._s;
  if (typeof id.getString === 'function') return cubismString(id.getString());
  return '';
}

export class ParameterPort {
  constructor(core) {
    if (!core) throw new Error('Live2D coreModel is not available');
    this.core = core;
    this.byId = new Map();
    const raw = core._model?.parameters ?? core.getModel?.()?.parameters;
    if (raw?.ids?.length) {
      for (let i=0;i<raw.ids.length;i++) {
        const id=cubismString(raw.ids[i]);
        if (!id) continue;
        this.byId.set(id, {
          index: i,
          min: Number(raw.minimumValues?.[i] ?? -Infinity),
          max: Number(raw.maximumValues?.[i] ?? Infinity),
          def: Number(raw.defaultValues?.[i] ?? 0),
        });
      }
    } else if (typeof core.getParameterCount==='function') {
      for (let i=0;i<core.getParameterCount();i++) {
        const id=cubismString(core.getParameterId(i));
        if (!id) continue;
        this.byId.set(id, {index:i,min:core.getParameterMinimumValue(i),max:core.getParameterMaximumValue(i),def:core.getParameterDefaultValue(i)});
      }
    }
    if (!this.byId.size) throw new Error('moc3 파라미터 ID를 읽을 수 없습니다. Cubism Core 호환성을 확인하세요.');
  }
  has(id) { return this.byId.has(id); }
  range(id, fallback={min:-1,max:1,def:0}) { return this.byId.get(id) ?? fallback; }
  get(id) {
    const entry=this.byId.get(id);
    if (!entry) return undefined;
    if (typeof this.core.getParameterValueByIndex === 'function') return this.core.getParameterValueByIndex(entry.index);
    return this.core._model?.parameters?.values?.[entry.index];
  }
  set(id, value) {
    const entry=this.byId.get(id);
    if (!entry || !Number.isFinite(value)) return false;
    const v=Math.max(entry.min,Math.min(entry.max,value));
    if (typeof this.core.setParameterValueByIndex === 'function') this.core.setParameterValueByIndex(entry.index,v);
    else if (this.core._model?.parameters?.values) this.core._model.parameters.values[entry.index]=v;
    else throw new Error('Cubism Core 파라미터 인덱스 설정을 지원하지 않습니다.');
    return true;
  }
  require(ids) {
    const missing=ids.filter(id=>!this.has(id));
    if (missing.length) throw new Error(`모델에서 필수 파라미터를 찾을 수 없습니다: ${missing.join(', ')}`);
  }
  ranges() { return new Map([...this.byId].map(([id,v])=>[id,{min:v.min,max:v.max,def:v.def}])); }
}
