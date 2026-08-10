import {cancelRender, continueRender, delayRender} from 'remotion';
import notoSerifJP from './fonts/NotoSerifJP-VF.ttf';
import notoSerifSC from './fonts/NotoSerifSC-VF.ttf';
import notoSerif from './fonts/NotoSerif-VF.ttf';
import notoSansJP from './fonts/NotoSansJP-VF.woff2';
import notoSansSC from './fonts/NotoSansSC-VF.woff2';
import notoSans from './fonts/NotoSans-VF.woff2';

// 字体随 bundle 打包(webpack asset/resource),不走 public dir——
// CLI 渲染时 public dir 指向用户素材文件夹,不能依赖它存放字体。
// 黑体用 woff2(比 TTF 小一半);serif 保持既有 TTF 不变。

const loadFont = (family: string, url: string, descriptors?: FontFaceDescriptors, format = 'truetype-variations') => {
  if (typeof document === 'undefined') return;
  // CJK 变量字体 13–25MB,渲染多页并发时解析可能远超默认 30s 超时
  const handle = delayRender(`loading font ${family}`, {
    timeoutInMilliseconds: 180_000,
    retries: 2,
  });
  const face = new FontFace(family, `url(${url}) format('${format}')`, descriptors);
  face
    .load()
    .then(() => {
      // 部分 TS lib.dom 版本缺 FontFaceSet.add 定义,运行时存在
      (document.fonts as unknown as {add(f: FontFace): void}).add(face);
      continueRender(handle);
    })
    .catch((err) => cancelRender(err));
};

loadFont('Noto Serif JP', notoSerifJP, {weight: '200 900'});
loadFont('Noto Serif SC', notoSerifSC, {weight: '200 900'});
loadFont('Noto Serif', notoSerif, {weight: '200 900'});
loadFont('Noto Sans JP', notoSansJP, {weight: '200 900'}, 'woff2-variations');
loadFont('Noto Sans SC', notoSansSC, {weight: '200 900'}, 'woff2-variations');
loadFont('Noto Sans', notoSans, {weight: '200 900'}, 'woff2-variations');
