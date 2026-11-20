import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const output = 'dist';
const resources = [
  'index.html', '.nojekyll',
  'model/슈르.model3.json', 'model/슈르.moc3',
  'model/슈르.physics3.json', 'model/슈르.cdi3.json',
  'model/슈르.2048/texture_00.png',
  'model/왼쪽.motion3.json', 'model/오른쪽.motion3.json', 'model/꿀밤.motion3.json',
  'sound/left.wav', 'sound/right.wav', 'sound/facehit.wav',
  'sound/touch.wav', 'sound/Voice_Ashur_Touch2.wav',
  'ashur-story.png', 'vendor/live2dcubismcore.min.js',
];
for (const file of resources) {
  const path = join(output, file);
  const item = await stat(path).catch(() => null);
  if (!item?.isFile()) throw new Error(`GitHub Pages 배포 리소스 누락: ${path}`);
}
const html = await readFile(join(output, 'index.html'), 'utf8');
if (!/src=["']\.\/assets\/.+\.js["']/.test(html)) {
  throw new Error('Vite JS 진입 경로가 상대 경로로 빌드되지 않았습니다.');
}
if (!/슈르/.test((await readFile(join(output,'model/슈르.model3.json'),'utf8')))) {
  throw new Error('Live2D model3.json 확인 실패');
}
const core = await stat(join(output, 'vendor/live2dcubismcore.min.js'));
if (core.size < 100_000) throw new Error('Live2D Cubism Core가 손상되었습니다.');
console.log(`Pages 배포 준비 완료: 필수 정적 파일 ${resources.length}개, Live2D Core ${core.size} bytes`);
