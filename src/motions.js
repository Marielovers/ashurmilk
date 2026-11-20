// Replay the user's actual .motion3.json curve data at a click-friendly speed.
// This avoids motion-manager reservations swallowing rapid successive inputs.
const SITE_BASE = typeof window === 'undefined' ? './' : import.meta.env.BASE_URL;
export const MOTION_FILES = Object.freeze({
  left: `${SITE_BASE}model/왼쪽.motion3.json`,
  right: `${SITE_BASE}model/오른쪽.motion3.json`,
  head: `${SITE_BASE}model/꿀밤.motion3.json`,
});

const cubic = (a,b,c,d,t) => {
  const u=1-t;
  return u*u*u*a + 3*u*u*t*b + 3*u*t*t*c + t*t*t*d;
};

export function sampleCurve(curve, time) {
  const s = curve?.Segments;
  if (!Array.isArray(s) || s.length < 2) return 0;
  if (time <= s[0]) return s[1];
  let x = s[0], y = s[1], i = 2;
  while (i < s.length) {
    const type = s[i++];
    if (type === 0) { // linear
      if (i + 1 >= s.length) break;
      const nx=s[i++], ny=s[i++];
      if (time <= nx) return y + (ny-y)*Math.max(0, Math.min(1,(time-x)/Math.max(0.00001,nx-x)));
      x=nx; y=ny;
    } else if (type === 1) { // Cubism cubic Bezier, x is time
      if (i + 5 >= s.length) break;
      const x1=s[i++],y1=s[i++],x2=s[i++],y2=s[i++],nx=s[i++],ny=s[i++];
      if (time <= nx) {
        let lo=0,hi=1;
        for (let j=0;j<18;j++) {
          const mid=(lo+hi)/2;
          if (cubic(x,x1,x2,nx,mid)<time) lo=mid;
          else hi=mid;
        }
        return cubic(y,y1,y2,ny,(lo+hi)/2);
      }
      x=nx; y=ny;
    } else if (type === 2 || type === 3) { // stepped, inverse stepped
      if (i + 1 >= s.length) break;
      const nx=s[i++],ny=s[i++];
      if (time <= nx) return type === 2 ? y : ny;
      x=nx;y=ny;
    } else break;
  }
  return y;
}

export async function loadMotions() {
  const values = await Promise.all(Object.entries(MOTION_FILES).map(async ([kind, path]) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Motion ${kind}: HTTP ${response.status}`);
    return [kind, await response.json()];
  }));
  return Object.fromEntries(values);
}

export function motionValue(motions, kind, paramId, fraction) {
  const motion = motions?.[kind];
  const curve = motion?.Curves?.find(c => c.Target === 'Parameter' && c.Id === paramId);
  if (!curve) return 0;
  const duration = motion.Meta?.Duration || 2.983;
  return sampleCurve(curve, Math.max(0,Math.min(1,fraction))*duration);
}
