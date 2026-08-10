import React from 'react';
import {Composition} from 'remotion';
import {Diary} from './Diary';
import {Filmstrip} from './Filmstrip';
import {PolaroidWall} from './PolaroidWall';
import {Still, defaultStillProps} from './Still';
import fixture from '../../examples/fixture/timeline.json';
import type {Timeline} from './types';
import {CANVAS} from './theme';

// Studio 默认加载 fixture 便于直接预览;
// CLI 渲染时用 --props=<timeline.json> 覆盖完整时间线。
const defaultTimeline = fixture as unknown as Timeline;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Diary"
        component={Diary}
        defaultProps={defaultTimeline}
        width={CANVAS.width}
        height={CANVAS.height}
        fps={CANVAS.fps}
        durationInFrames={Math.round(defaultTimeline.meta.duration * defaultTimeline.meta.fps)}
        calculateMetadata={({props}) => ({
          durationInFrames: Math.round(props.meta.duration * props.meta.fps),
          fps: props.meta.fps,
          width: props.meta.width,
          height: props.meta.height,
        })}
      />
      <Composition
        id="Still"
        component={Still}
        defaultProps={defaultStillProps}
        width={CANVAS.width}
        height={CANVAS.height}
        fps={1}
        durationInFrames={1}
        calculateMetadata={({props}) => ({
          durationInFrames: 1,
          fps: 1,
          width: props.width,
          height: props.height,
        })}
      />
      <Composition
        id="PolaroidWall"
        component={PolaroidWall}
        defaultProps={defaultTimeline}
        width={CANVAS.width}
        height={CANVAS.height}
        fps={CANVAS.fps}
        durationInFrames={Math.round(defaultTimeline.meta.duration * defaultTimeline.meta.fps)}
        calculateMetadata={({props}) => ({
          durationInFrames: Math.round(props.meta.duration * props.meta.fps),
          fps: props.meta.fps,
          width: props.meta.width,
          height: props.meta.height,
        })}
      />
      <Composition
        id="Filmstrip"
        component={Filmstrip}
        defaultProps={defaultTimeline}
        width={CANVAS.width}
        height={CANVAS.height}
        fps={CANVAS.fps}
        durationInFrames={Math.round(defaultTimeline.meta.duration * defaultTimeline.meta.fps)}
        calculateMetadata={({props}) => ({
          durationInFrames: Math.round(props.meta.duration * props.meta.fps),
          fps: props.meta.fps,
          width: props.meta.width,
          height: props.meta.height,
        })}
      />
    </>
  );
};
