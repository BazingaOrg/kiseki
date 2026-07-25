/**
 * 成片播放。
 *
 * 刻意保留原生 <video controls>:整帧媒体的原生控件是用户预期,且自带全屏、画中画、
 * 键盘与屏幕阅读器支持,自己重写一套要补的窟窿远多于收益。音频那侧不同 —— 原生
 * <audio> 控件在这个页面里格格不入,且要和歌词共享播放状态,所以那边自建控制条。
 */
import {useState} from 'react';

import {basename, mediaUrl} from './media';

export const Player = ({videos}: {videos: string[]}) => {
  // 调用方已按 playVideo 能力把关,但那个不变量在另一个文件里 —— 在本地兜住,
  // 免得以后有人直接用这个组件时 basename(undefined) 抛错
  const [activeVideo, setActiveVideo] = useState<string | null>(videos[0] ?? null);
  if (videos.length === 0) return null;
  const current = activeVideo !== null && videos.includes(activeVideo) ? activeVideo : videos[0];

  return (
    <div className="player">
      {videos.length > 1 && (
        <ul className="video-list">
          {videos.map((videoPath) => (
            <li key={videoPath}>
              <button
                className={videoPath === current ? 'video-item video-item-active' : 'video-item'}
                onClick={() => setActiveVideo(videoPath)}
              >
                {basename(videoPath)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* key 让切换成片时重建元素,否则 <video> 会保留上一条的播放进度与缓冲 */}
      <video key={current} className="player-video" controls preload="metadata" src={mediaUrl(current)} />
      <p className="player-caption">{basename(current)}</p>
    </div>
  );
};
