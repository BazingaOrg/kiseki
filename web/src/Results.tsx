/**
 * 「成果」区段:做出来的东西在这里看。
 *
 * 唯一的 <audio> 由这里持有(见 useAudioPlayer 的说明),播放条与歌词都是它的消费者,
 * 所以听歌和看歌词是同一次播放,不会各放各的。
 */
import {useState} from 'react';
import {Pause, Play, Volume2, VolumeX} from 'lucide-react';

import type {Capabilities, Remedy} from './capabilities';
import {Lyrics} from './Lyrics';
import {mediaUrl} from './media';
import {PhotoGrid} from './PhotoGrid';
import {AssetCollection, fallbackAssetCollection} from './AssetCollection';
import {Player} from './Player';
import type {AssetItem, ProjectResponse} from './types';
import {Blocked, Section} from './ui';
import {MediaTimeline} from './MediaTimeline';
import {useAudioPlayer} from './useAudioPlayer';

interface ResultsProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
  assetBusy: boolean;
  onAsset: (item: AssetItem, action: 'rename' | 'delete', stem?: string) => void;
}

const photoTabMeta = (sourceCount: number, outputCount: number) => {
  if (sourceCount > 0 && outputCount > 0) return {text: `素材 ${sourceCount} · 作品 ${outputCount}`, description: `素材 ${sourceCount} 张，作品 ${outputCount} 张`};
  if (sourceCount > 0) return {text: `${sourceCount} 张素材`, description: `${sourceCount} 张素材`};
  if (outputCount > 0) return {text: `${outputCount} 张作品`, description: `${outputCount} 张作品`};
  return {text: '暂无', description: '暂无图片'};
};

export const Results = ({project, capabilities, onRemedy, assetBusy, onAsset}: ResultsProps) => {
  const initialTab = project.output.videos.length > 0 ? 'videos' : project.photos.length > 0 || project.output.stills.length > 0 ? 'photos' : 'music';
  const [tab, setTab] = useState<'videos' | 'music' | 'photos'>(initialTab);
  const audios = project.audios ?? (project.audio ? [project.audio] : []);
  const lyricsFiles = project.lyricsFiles ?? (project.lyricsFile ? [project.lyricsFile] : []);
  const audioAssets = project.assets?.audios ?? fallbackAssetCollection('audio', audios);
  const lyricsAssets = project.assets?.lyrics ?? fallbackAssetCollection('lyrics', lyricsFiles);
  const videoAssets = project.assets?.videos ?? fallbackAssetCollection('video', project.output.videos);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  // 以位置而不是扫描 id 记住选择：重命名会派生新 id，刷新后仍应留在原成片。
  const currentVideo = videoAssets.items[Math.min(currentVideoIndex, Math.max(videoAssets.items.length - 1, 0))] ?? null;
  // 旧 audio 字段仍兼容旧客户端；新 UI 只在唯一音频时播放，绝不把多候选的第一份
  // 静默当作主音频。
  const playableAudio = audioAssets.state === 'ready' ? audios[0] : null;
  const {mediaProps: audioProps, state, toggle, seekTo, setVolume, toggleMute} = useAudioPlayer<HTMLAudioElement>(playableAudio ? mediaUrl(playableAudio) : null);
  const photoMeta = photoTabMeta(project.photos.length, project.output.stills.length);
  const tabs = [
    {key: 'videos' as const, label: '成片', meta: project.output.videos.length > 0 ? `${project.output.videos.length} 个` : '暂无', description: project.output.videos.length > 0 ? `${project.output.videos.length} 个成片` : '暂无成片'},
    {key: 'music' as const, label: '音乐与歌词', meta: audioAssets.state === 'ready' ? '已就绪' : audioAssets.state === 'empty' ? '暂无' : '需处理', description: audioAssets.state === 'ready' ? '音乐与歌词已就绪' : audioAssets.state === 'empty' ? '暂无音乐与歌词' : '音乐与歌词需处理'},
    {key: 'photos' as const, label: '图片', meta: photoMeta.text, description: photoMeta.description},
  ];

  const lyrics = project.lyrics ?? [];

  return (
    <Section title="成果" titleHidden>
      <div className="result-tabs" role="tablist" aria-label="成果分类">
        {tabs.map(({key, label, meta, description}) => (
          <button
            key={key}
            className={tab === key ? 'result-tab result-tab-active' : 'result-tab'}
            onClick={() => setTab(key)}
            role="tab"
            aria-selected={tab === key}
            id={`result-tab-${key}`}
            aria-controls={`result-panel-${key}`}
            aria-label={`${label}，${description}`}
          >
            <span className="result-tab-label">{label}</span>
            <span className="result-tab-meta" aria-hidden="true">{meta}</span>
          </button>
        ))}
      </div>

      {tab === 'videos' && (
        <div role="tabpanel" id="result-panel-videos" aria-labelledby="result-tab-videos">
          {capabilities.playVideo.enabled ? (
            <>
              <Player video={currentVideo?.path ?? null} />
              <AssetCollection collection={videoAssets} empty="" ambiguous={() => ''} busy={assetBusy} currentId={currentVideo?.id ?? null} onSelect={(item) => setCurrentVideoIndex(videoAssets.items.findIndex((candidate) => candidate.id === item.id))} onRename={(item, stem) => onAsset(item, 'rename', stem)} onDelete={(item) => onAsset(item, 'delete')} />
            </>
          ) : (
            <Blocked capability={capabilities.playVideo} onRemedy={onRemedy} />
          )}
        </div>
      )}

      {/* audio 始终挂载，切换成果分类不会中断播放或重置进度。 */}
      <div role="tabpanel" id="result-panel-music" aria-labelledby="result-tab-music" hidden={tab !== 'music'}>
        {project.lyricsSource === 'recognized' && <p className="section-meta">本地识别歌词可能不准确</p>}
        <audio {...audioProps} />
        {audioAssets.state === 'ready' && playableAudio ? (
          <div className="audio-bar">
            <button
              className="audio-toggle"
              type="button"
              onClick={toggle}
              aria-label={state.playing ? '暂停' : '播放'}
              title={state.playing ? '暂停' : '播放'}
            >
              {state.playing ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
            </button>
            <MediaTimeline currentTime={state.currentTime} duration={state.duration} buffered={state.buffered} onSeek={seekTo} />
            <button className="audio-utility" type="button" onClick={toggleMute} aria-label={state.muted || state.volume === 0 ? '取消静音' : '静音'} title={state.muted || state.volume === 0 ? '取消静音' : '静音'}>
              {state.muted || state.volume === 0 ? <VolumeX aria-hidden="true" size={17} /> : <Volume2 aria-hidden="true" size={17} />}
            </button>
            <input className="media-volume audio-volume" type="range" min={0} max={1} step={0.05} value={state.muted ? 0 : state.volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="音量" aria-valuetext={`${Math.round((state.muted ? 0 : state.volume) * 100)}%`} />
            {state.status === 'buffering' && <span className="media-buffering audio-buffering" role="status">正在缓冲</span>}
            {state.error && <span className="media-error audio-error" role="alert">{state.error}</span>}
          </div>
        ) : audioAssets.state === 'ambiguous' ? (
          <AssetCollection
            collection={audioAssets}
            empty=""
            ambiguous={(count) => `有 ${count} 份音频，不能确认哪一份应播放；请先在素材步骤处理。`}
            busy={assetBusy}
            onRename={(item, stem) => onAsset(item, 'rename', stem)}
            onDelete={(item) => onAsset(item, 'delete')}
          />
        ) : (
          <Blocked capability={capabilities.followLyrics} onRemedy={onRemedy} />
        )}

        {lyricsAssets.state !== 'empty' && (
          <AssetCollection
            collection={lyricsAssets}
            empty=""
            ambiguous={(count) => `有 ${count} 份歌词，当前展示全部文件，不会隐式匹配其中一份。`}
            busy={assetBusy}
            onRename={(item, stem) => onAsset(item, 'rename', stem)}
            onDelete={(item) => onAsset(item, 'delete')}
          />
        )}

        {playableAudio && lyricsAssets.state !== 'ambiguous' &&
          (capabilities.followLyrics.enabled ? (
            <Lyrics lyrics={lyrics} currentTime={state.currentTime} onSeek={seekTo} />
          ) : (
            <Blocked capability={capabilities.followLyrics} onRemedy={onRemedy} />
          ))}
      </div>

      {tab === 'photos' && (
        <div role="tabpanel" id="result-panel-photos" aria-labelledby="result-tab-photos">
          {capabilities.browsePhotos.enabled ? (
            <>
              <PhotoGrid project={project} />
              <AssetCollection collection={project.assets?.stills ?? fallbackAssetCollection('still', project.output.stills)} empty="" ambiguous={() => ''} busy={assetBusy} onRename={(item, stem) => onAsset(item, 'rename', stem)} onDelete={(item) => onAsset(item, 'delete')} />
            </>
          ) : (
            <Blocked capability={capabilities.browsePhotos} onRemedy={onRemedy} />
          )}
        </div>
      )}
    </Section>
  );
};
