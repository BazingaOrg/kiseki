import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = (name: string) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');

test('motion uses component-level reduced-motion rules and keeps panel exits mounted', async () => {
  const [indexCss, appCss, make, doctor, presence] = await Promise.all([
    source('index.css'), source('App.css'), source('Make.tsx'), source('DoctorPanel.tsx'), source('useTransitionPresence.ts'),
  ]);
  const reducedMotion = appCss.slice(appCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  const ordinaryPresence = appCss.slice(appCss.indexOf('.transition-presence {'), appCss.indexOf('}', appCss.indexOf('.transition-presence {')) + 1);
  const reducedSpinner = reducedMotion.slice(reducedMotion.indexOf('.job-spinner'), reducedMotion.indexOf('}', reducedMotion.indexOf('.job-spinner')) + 1);
  const reducedIndeterminate = reducedMotion.slice(reducedMotion.indexOf('.job-progress-indeterminate::after'), reducedMotion.indexOf('}', reducedMotion.indexOf('.job-progress-indeterminate::after')) + 1);
  const reducedPresence = reducedMotion.slice(reducedMotion.indexOf('.make-form-presence.transition-presence'), reducedMotion.indexOf('}', reducedMotion.indexOf('.make-form-presence.transition-presence')) + 1);
  assert.doesNotMatch(indexCss, /\*::before[\s\S]*0\.01ms/);
  assert.ok(appCss.includes('transition-duration: 200ms;'));
  assert.equal(reducedSpinner, '.job-spinner {\n    display: none;\n  }');
  assert.equal(reducedIndeterminate, '.job-progress-indeterminate::after {\n    display: none;\n  }');
  assert.match(ordinaryPresence, /transition: opacity 150ms ease-out, transform 150ms ease-out;/);
  assert.match(reducedPresence, /\.make-form-presence\.transition-presence\s*\{[\s\S]*transform: none;[\s\S]*transition-property: opacity;[\s\S]*transition-duration: 120ms;[\s\S]*transition-timing-function: ease-out;[\s\S]*transition-delay: 0;/);
  assert.doesNotMatch(reducedPresence, /transition-duration: 150ms/);
  assert.ok(!appCss.includes('job-status-pulse'));
  assert.match(appCss, /@keyframes welcome-in/);
  assert.match(appCss, /@keyframes logo-dot-in/);
  assert.match(appCss, /@keyframes job-done-in/);
  assert.match(appCss, /\.logo-hero \{\s*flex-direction: column;[\s\S]*animation: welcome-in 420ms/);
  assert.match(reducedMotion, /\.logo-hero,\s*\.logo-hero \.logo-mark-dot,\s*\.welcome-lead,\s*\.job-status-done\s*\{[\s\S]*animation: none;/);
  assert.ok(presence.includes("event.currentTarget !== event.target || event.propertyName !== 'opacity' || desiredOpen.current"));
  assert.ok(presence.includes('const [generation, setGeneration] = useState(0);'));
  assert.ok(presence.includes('window.setTimeout'));
  assert.ok(make.includes('aria-hidden={!expanded}'));
  assert.ok(make.includes('onTransitionEnd={optionsPresence.onTransitionEnd}'));
  assert.ok(make.includes("panel.setAttribute('inert', '')"));
  assert.ok(doctor.includes('role="dialog"'));
  assert.ok(doctor.includes('aria-modal="true"'));
  assert.ok(doctor.includes("if (!visible) return null"));
});

test('photo hover and progress updates avoid layout-moving animation', async () => {
  const [appCss, jobPanel] = await Promise.all([source('App.css'), source('JobPanel.tsx')]);
  assert.match(appCss, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.photo-card:hover/);
  assert.doesNotMatch(appCss, /\.photo-card:hover\s*\{[^}]*(translateY|shadow-photo-large)/);
  assert.doesNotMatch(appCss, /\.asset-name:active/);
  assert.match(appCss, /\.result-video-picker \.asset-name::before/);
  assert.doesNotMatch(appCss, /transition: width/);
  assert.match(jobPanel, /role="progressbar"/);
  assert.match(jobPanel, /job-context/);
  assert.match(jobPanel, /scaleX\(/);
});

test('material and result tabs share restrained motion styles', async () => {
  const appCss = await source('App.css');
  assert.match(appCss, /\.material-tab,\s*\.result-tab/);
  assert.match(appCss, /transition: color 0\.16s ease-out, border-color 0\.16s ease-out/);
});

test('featured render styles use abstract explanatory previews with motion safeguards', async () => {
  const [appCss, make, materials, fieldHelp] = await Promise.all([source('App.css'), source('Make.tsx'), source('Materials.tsx'), source('FieldHelp.tsx')]);
  assert.doesNotMatch(make, /FEATURED_TEMPLATE_IDS|成片风格|不套用风格|电影舒缓|胶片带|拍立得/);
  assert.doesNotMatch(make, /成片时长|智能收尾|渲染速度|草稿模式|方形/);
  assert.doesNotMatch(make, /跟随素材夹/);
  assert.match(make, /trim: 'full'/);
  assert.match(make, /speed: 'balanced'/);
  assert.match(make, /template: null/);
  assert.match(make, /<FieldHelp label="了解歌词显示">当前歌词没有中文译文，将显示原文。<\/FieldHelp>/);
  assert.match(make, /<FieldHelp label="了解图片旁白">为照片补上一句画外之意。开启后会将缩小后的预览发给 DeepSeek，全部生成后再开始制作。原图不会上传。<\/FieldHelp>/);
  assert.match(make, /<FieldHelp label="了解滤镜">这些是接近经典相机与胶片观感的风格效果，并非品牌官方模拟；实际效果会受原片色彩和曝光影响。<\/FieldHelp>/);
  assert.doesNotMatch(make, /改变照片布局、转场和字幕样式|抽象图形仅说明布局与动效|非品牌官方模拟，效果会受原片色彩和曝光影响。/);
  assert.doesNotMatch(make, /title=\{item\.hint\}/);
  assert.match(fieldHelp, /import \{Info\} from 'lucide-react';/);
  assert.match(fieldHelp, /aria-expanded=\{open\}/);
  assert.match(fieldHelp, /aria-controls=\{tooltipId\}/);
  assert.match(fieldHelp, /aria-describedby=\{tooltipId\}/);
  assert.match(fieldHelp, /role="tooltip"/);
  assert.match(fieldHelp, /onMouseEnter=\{\(\) => setOpen\(true\)\}/);
  assert.match(fieldHelp, /onMouseLeave=\{\(\) => \{\s*if \(!rootRef\.current\?\.contains\(document\.activeElement\)\) setOpen\(false\);/);
  assert.match(fieldHelp, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(fieldHelp, /event\.key === 'Escape'/);
  assert.match(fieldHelp, /document\.addEventListener\('pointerdown'/);
  assert.match(materials, /<FieldHelp label="了解本地识别">用 whisper/);
  assert.doesNotMatch(materials, /CircleHelp|fetch-path-help/);
  assert.doesNotMatch(appCss, /fetch-path-help|fetch-path-tooltip|make-template-intro/);
  assert.match(appCss, /@media \(max-width: 600px\) \{\s*\.field-help-tooltip \{\s*position: fixed;[\s\S]*right: 1rem;[\s\S]*bottom: 1rem;[\s\S]*left: 1rem;/);
  assert.match(appCss, /\.make-field-label \{\s*display: block;/);
  assert.match(appCss, /\.make-field-label-with-help \{\s*display: flex;[\s\S]*align-items: center;[\s\S]*gap: 0\.3rem;/);
  assert.equal([...make.matchAll(/make-field-label make-field-label-with-help/g)].length, 2);
  assert.doesNotMatch(make, /约四分之一核心|约一半核心|几乎占满，风扇会转起来/);
  assert.doesNotMatch(make, /晴天 海边 午后|SAMPLE_CAPTION/);
});

test('filter picker exposes only grouped classic styles and preserves a selected legacy value', async () => {
  const make = await source('Make.tsx');
  assert.match(make, /\{id: 'camera', label: '经典相机'\}/);
  assert.match(make, /\{id: 'film', label: '经典胶片'\}/);
  assert.match(make, /filter\.id === value && filter\.group === 'legacy'/);
  assert.match(make, /role="group" aria-label="旧项目滤镜"/);
  assert.match(make, /role="listbox" aria-label="滤镜选项"/);
  assert.match(make, /FILTERS\.filter\(\(filter\) => filter\.group === group\.id\)/);
  assert.match(make, /<FieldHelp label="了解滤镜">这些是接近经典相机与胶片观感的风格效果/);
});
