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
  const reducedPresence = reducedMotion.slice(reducedMotion.indexOf('.doctor-panel.transition-presence'), reducedMotion.indexOf('}', reducedMotion.indexOf('.doctor-panel.transition-presence')) + 1);
  assert.doesNotMatch(indexCss, /\*::before[\s\S]*0\.01ms/);
  assert.ok(appCss.includes('transition-duration: 200ms;'));
  assert.equal(reducedSpinner, '.job-spinner {\n    display: none;\n  }');
  assert.equal(reducedIndeterminate, '.job-progress-indeterminate::after {\n    display: none;\n  }');
  assert.match(ordinaryPresence, /transition: opacity 150ms ease-out, transform 150ms ease-out;/);
  assert.match(reducedPresence, /\.doctor-panel\.transition-presence,\s*\.make-form-presence\.transition-presence\s*\{[\s\S]*transform: none;[\s\S]*transition-property: opacity;[\s\S]*transition-duration: 120ms;[\s\S]*transition-timing-function: ease-out;[\s\S]*transition-delay: 0;/);
  assert.doesNotMatch(reducedPresence, /transition-duration: 150ms/);
  assert.ok(!appCss.includes('job-status-pulse'));
  assert.ok(presence.includes("event.currentTarget !== event.target || event.propertyName !== 'opacity' || desiredOpen.current"));
  assert.ok(presence.includes('const [generation, setGeneration] = useState(0);'));
  assert.ok(presence.includes('window.setTimeout'));
  assert.ok(make.includes('aria-hidden={!expanded}'));
  assert.ok(make.includes('onTransitionEnd={optionsPresence.onTransitionEnd}'));
  assert.ok(make.includes("panel.setAttribute('inert', '')"));
  assert.ok(doctor.includes('aria-hidden={!open}'));
  assert.ok(doctor.includes('onTransitionEnd={panelPresence.onTransitionEnd}'));
  assert.ok(doctor.includes("panel.setAttribute('inert', '')"));
});

test('photo hover and progress updates avoid layout-moving animation', async () => {
  const [appCss, jobPanel] = await Promise.all([source('App.css'), source('JobPanel.tsx')]);
  assert.match(appCss, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.photo-card:hover/);
  assert.doesNotMatch(appCss, /\.photo-card:hover\s*\{[^}]*(translateY|shadow-photo-large)/);
  assert.doesNotMatch(appCss, /transition: width/);
  assert.match(jobPanel, /role="progressbar"/);
  assert.match(jobPanel, /scaleX\(/);
});

test('material and result tabs share restrained motion styles', async () => {
  const appCss = await source('App.css');
  assert.match(appCss, /\.material-tab,\s*\.result-tab/);
  assert.match(appCss, /transition: color 0\.16s ease-out, border-color 0\.16s ease-out/);
});

test('featured render styles use abstract explanatory previews with motion safeguards', async () => {
  const [appCss, make, materials, fieldHelp] = await Promise.all([source('App.css'), source('Make.tsx'), source('Materials.tsx'), source('FieldHelp.tsx')]);
  const preview = make.slice(make.indexOf('const PreviewArtwork'), make.indexOf('const KIND_VERB'));
  assert.match(make, /FEATURED_TEMPLATE_IDS = \['slow-cinema', 'filmstrip', 'polaroid'\]/);
  assert.match(make, />成片风格 <FieldHelp label="了解成片风格">/);
  assert.match(make, />不套用风格</);
  assert.match(make, />成片时长</);
  assert.match(make, /智能收尾（推荐）[\s\S]*完整歌曲/);
  assert.doesNotMatch(make, /跟随素材夹/);
  assert.match(make, /trim: 'auto'/);
  assert.match(make, /trim: preset\.options\.trim \?\? 'auto'/);
  assert.match(make, /根据照片数量，在音乐合适的节拍处结束/);
  assert.match(make, /始终渲染到歌曲结束，成片可能更长/);
  assert.match(make, /<FieldHelp label="了解成片风格">卡片使用抽象图形演示布局和动效，选中后会循环播放，以成片为准。<\/FieldHelp>/);
  assert.match(make, /<p className="make-field-hint">只影响布局、转场和字幕；滤镜单独设置。<\/p>/);
  assert.match(make, /<FieldHelp label="了解渲染速度">省着点约占四分之一资源，均衡约占一半，快则尽量使用全部资源。<\/FieldHelp>/);
  assert.match(make, /<p className="make-field-hint">只影响电脑资源占用，不影响成片质量。<\/p>/);
  assert.match(make, /<FieldHelp label="了解滤镜">这些是接近经典相机与胶片观感的风格效果，并非品牌官方模拟；实际效果会受原片色彩和曝光影响。<\/FieldHelp>/);
  assert.match(make, /<p className="make-field-hint">\s*\{TRIM_LABELS\.find/);
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
  assert.equal([...make.matchAll(/make-field-label make-field-label-with-help/g)].length, 3);
  assert.doesNotMatch(make, /约四分之一核心|约一半核心|几乎占满，风扇会转起来/);
  assert.doesNotMatch(make, /晴天 海边 午后|SAMPLE_CAPTION/);
  assert.match(preview, /template-preview-caption">字幕</);
  assert.match(preview, /variant="three" className="template-preview-scene template-preview-scene-three"/);
  assert.doesNotMatch(preview, /<img|thumbUrl|photos\[/);
  assert.match(appCss, /@keyframes template-cinema-one/);
  assert.match(appCss, /@keyframes template-filmstrip-current/);
  assert.match(appCss, /@keyframes template-filmstrip-three/);
  assert.match(appCss, /60%, 82% \{ transform: translateX\(68px\); \}/);
  assert.match(appCss, /@keyframes template-polaroid-one/);
  assert.match(appCss, /\.make-template-card:has\(input:checked\) \{\s*--template-preview-iterations: infinite;/);
  assert.match(appCss, /animation: var\(--template-cinema-one, none\)[^;]*var\(--template-preview-iterations, 1\)/);
  assert.match(appCss, /@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.make-template-card:hover/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.template-preview-scene,[\s\S]*?animation: none !important;/);
});

test('filter picker exposes only grouped classic styles and preserves a selected legacy value', async () => {
  const make = await source('Make.tsx');
  assert.match(make, /\{id: 'camera', label: '经典相机'\}/);
  assert.match(make, /\{id: 'film', label: '经典胶片'\}/);
  assert.match(make, /filter\.id === options\.filter && filter\.group === 'legacy'/);
  assert.match(make, /<optgroup label="旧项目滤镜">/);
  assert.match(make, /FILTERS\.filter\(\(filter\) => filter\.group === group\.id\)/);
  assert.match(make, /<FieldHelp label="了解滤镜">这些是接近经典相机与胶片观感的风格效果/);
});
