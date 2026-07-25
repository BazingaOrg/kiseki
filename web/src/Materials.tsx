/**
 * 「素材」区段:这个文件夹里有什么、还缺什么。
 *
 * 关键设计:缺件时那张卡不是灰掉的空壳,而是变成一张「行动卡」—— 说清缺什么、
 * 怎么补。fetch 因此不再是主菜单第 5 项,而是长在它真正该出现的地方。
 */
import {Image, Music, Type} from 'lucide-react';
import type {ReactNode} from 'react';

import type {Capabilities, Remedy} from './capabilities';
import {basename, thumbUrl} from './media';
import type {ProjectResponse} from './types';
import {Blocked, Section} from './ui';

interface CardProps {
  icon: ReactNode;
  title: string;
  present: boolean;
  detail: ReactNode;
  children?: ReactNode;
}

const MaterialCard = ({icon, title, present, detail, children}: CardProps) => (
  <div className={present ? 'material-card' : 'material-card material-card-missing'}>
    <div className="material-icon">{icon}</div>
    <div className="material-body">
      <h3 className="material-title">{title}</h3>
      <div className="material-detail">{detail}</div>
      {children}
    </div>
  </div>
);

interface MaterialsProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
}

export const Materials = ({project, capabilities, onRemedy}: MaterialsProps) => {
  const photos = project.photos;
  const lyricLines = project.lyrics?.length ?? 0;

  return (
    <Section title="素材" meta={project.path}>
      <div className="material-cards">
        <MaterialCard
          icon={<Image size={20} strokeWidth={1.5} />}
          title="照片"
          present={photos.length > 0}
          detail={
            photos.length > 0
              ? `${photos.length} 张`
              : '把照片放进这个文件夹就行，jpg / png / webp 都可以。'
          }
        >
          {photos.length > 0 && (
            <div className="material-thumbs">
              {photos.slice(0, 12).map((photoPath) => (
                <img key={photoPath} src={thumbUrl(photoPath, 128)} alt="" loading="lazy" decoding="async" />
              ))}
              {photos.length > 12 && <span className="material-more">+{photos.length - 12}</span>}
            </div>
          )}
        </MaterialCard>

        <MaterialCard
          icon={<Music size={20} strokeWidth={1.5} />}
          title="音乐"
          present={project.audio !== null}
          detail={
            project.audioCount > 1
              ? `文件夹里有 ${project.audioCount} 份音频，只能留一份。`
              : project.audio
                ? basename(project.audio)
                : '还差一首歌。可以拖一份进文件夹，也可以在线找。'
          }
        >
          {!project.audio && (
            <Blocked capability={capabilities.fetchAudio} onRemedy={onRemedy} />
          )}
        </MaterialCard>

        <MaterialCard
          icon={<Type size={20} strokeWidth={1.5} />}
          title="歌词"
          present={lyricLines > 0}
          detail={
            lyricLines > 0
              ? `${lyricLines} 行 · ${project.lyricsSource === 'lrc' ? '来自 .lrc' : '本地识别'}`
              : '没有歌词也能渲染，成片只是不带字幕。'
          }
        >
          {lyricLines > 0 && (
            <ol className="material-lyric-preview">
              {project.lyrics!.slice(0, 3).map((line, index) => (
                <li key={`${line.time}-${index}`}>{line.text || '⋯'}</li>
              ))}
            </ol>
          )}
        </MaterialCard>
      </div>

      {project.unsupportedVideos.length > 0 && (
        <p className="note">
          忽略了 {project.unsupportedVideos.length} 个视频文件，tsuzuri 目前只处理照片。
        </p>
      )}
    </Section>
  );
};
