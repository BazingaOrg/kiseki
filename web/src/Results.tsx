/** 「成果」区段只展示生成产物：成片与导出静态图。 */
import {useEffect, useState} from 'react';

import type {Capabilities, Remedy} from './capabilities';
import {PhotoGrid} from './PhotoGrid';
import {AssetCollection, fallbackAssetCollection} from './AssetCollection';
import {Player} from './Player';
import type {AssetItem, ProjectResponse} from './types';
import {Blocked, Section} from './ui';
import {useTabs} from './useTabs';

interface ResultsProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
  assetBusy: boolean;
  onAsset: (item: AssetItem, action: 'rename' | 'delete', stem?: string) => void;
}

export const Results = ({project, capabilities, onRemedy, assetBusy, onAsset}: ResultsProps) => {
  const initialTab: 'videos' | 'photos' = project.output.videos.length > 0 ? 'videos' : 'photos';
  const [tab, setTab] = useState<'videos' | 'photos'>(initialTab);
  const resultTabValues: ('videos' | 'photos')[] = [
    ...(project.output.videos.length > 0 ? ['videos' as const] : []),
    ...(project.output.stills.length > 0 ? ['photos' as const] : []),
  ];
  const tabsBehavior = useTabs({values: resultTabValues, value: tab, onValueChange: setTab, idPrefix: 'results'});
  useEffect(() => {
    if (tab === 'photos' && project.output.stills.length === 0 && project.output.videos.length > 0) setTab('videos');
    if (tab === 'videos' && project.output.videos.length === 0 && project.output.stills.length > 0) setTab('photos');
  }, [project.output.stills.length, project.output.videos.length, tab]);
  const videoAssets = project.assets?.videos ?? fallbackAssetCollection('video', project.output.videos);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  // 以位置而不是扫描 id 记住选择：重命名会派生新 id，刷新后仍应留在原成片。
  const currentVideo = videoAssets.items[Math.min(currentVideoIndex, Math.max(videoAssets.items.length - 1, 0))] ?? null;
  const tabs = [
    ...(project.output.videos.length > 0 ? [{key: 'videos' as const, label: '成片', meta: `${project.output.videos.length} 个`, description: `${project.output.videos.length} 个成片`}] : []),
    ...(project.output.stills.length > 0 ? [{key: 'photos' as const, label: '静态图', meta: `${project.output.stills.length} 张`, description: `${project.output.stills.length} 张静态图`}] : []),
  ];
  const hasResultTabs = tabs.length > 1;
  const videoPanelProps = hasResultTabs ? tabsBehavior.getPanelProps('videos') : {};
  const photoPanelProps = hasResultTabs ? tabsBehavior.getPanelProps('photos') : {};

  return (
    <Section title="成果" titleHidden>
      {hasResultTabs && <div className="result-tabs" {...tabsBehavior.tabListProps} aria-label="成果分类">
        {tabs.map(({key, label, meta, description}) => (
          <button
            key={key}
            className={tab === key ? 'result-tab result-tab-active' : 'result-tab'}
            {...tabsBehavior.getTabProps(key)}
            aria-label={`${label}，${description}`}
          >
            <span className="result-tab-label">{label}</span>
            <span className="result-tab-meta" aria-hidden="true">{meta}</span>
          </button>
        ))}
      </div>}

      {project.output.videos.length > 0 && <div {...videoPanelProps}>
          {capabilities.playVideo.enabled ? (
            <div className="result-video result-video-with-playlist">
              <Player video={currentVideo?.path ?? null} />
              <aside className="result-video-picker" aria-label="成片播放列表">
                <div className="result-video-picker-inner">
                  <p className="result-video-position">播放列表 · {videoAssets.items.length} 个</p>
                  <AssetCollection collection={videoAssets} empty="" ambiguous={() => ''} busy={assetBusy} currentId={currentVideo?.id ?? null} onSelect={(item) => setCurrentVideoIndex(videoAssets.items.findIndex((candidate) => candidate.id === item.id))} onRename={(item, stem) => onAsset(item, 'rename', stem)} onDelete={(item) => onAsset(item, 'delete')} />
                </div>
              </aside>
            </div>
          ) : (
            <Blocked capability={capabilities.playVideo} onRemedy={onRemedy} />
          )}
      </div>}

      {project.output.stills.length > 0 && <div {...photoPanelProps}>
          {capabilities.browsePhotos.enabled ? (
            <>
              <PhotoGrid
                project={project}
                groups={[
                  {key: 'stills', title: '导出静态图', hint: '按成片同款视觉导出的静态图', paths: project.output.stills, assets: project.assets?.stills.items ?? fallbackAssetCollection('still', project.output.stills).items},
                ]}
                busy={assetBusy}
                onRename={(item, stem) => onAsset(item, 'rename', stem)}
                onDelete={(item) => onAsset(item, 'delete')}
              />
            </>
          ) : (
            <Blocked capability={capabilities.browsePhotos} onRemedy={onRemedy} />
          )}
      </div>}
    </Section>
  );
};
