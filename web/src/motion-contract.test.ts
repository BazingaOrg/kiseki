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
