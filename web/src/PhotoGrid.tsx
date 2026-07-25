/**
 * 照片墙。相对旧版的三处改动:
 * 1. 素材照片(project.photos)也展示 —— 旧版只显示 output/stills,原始素材从未被消费,
 *    等于"看照片"这个页签看不到用户自己放进去的照片。
 * 2. 大图查看换成 yet-another-react-lightbox。焦点陷阱、键盘、触摸手势、缩放、
 *    ARIA 自己写必然做不全,这是明确的"用库不造轮子"。
 * 3. 大图底部挂 EXIF 展签,按需请求 /api/exif —— 与成片上印的是同一份格式化结果。
 */
import {useEffect, useState} from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';

import {basename, mediaUrl, thumbUrl} from './media';
import type {ExifResponse, ProjectResponse} from './types';

// 把原始路径挂在 slide 上,让 render.slideFooter 从回调参数里取 —— 不要读闭包里的
// 当前 index:lightbox 会同时挂载前后各若干张幻灯片,它们都会拿到同一个 index,
// 于是每翻一页就发出 3~5 个重复的 /api/exif 请求,而且相邻页挂着当前页的 EXIF;
// 加上 view 回调是在切换动画结束后才触发,翻页途中还会闪一下上一张的参数。
declare module 'yet-another-react-lightbox' {
  interface GenericSlide {
    photoPath?: string;
  }
}

interface Group {
  key: string;
  title: string;
  hint: string;
  paths: string[];
}

interface OpenState {
  groupKey: string;
  index: number;
}

const ExifTag = ({path}: {path: string}) => {
  const [exif, setExif] = useState<ExifResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setExif(null);
    fetch(`/api/exif?path=${encodeURIComponent(path)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ExifResponse | null) => {
        if (!cancelled) setExif(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);

  // 没有 EXIF 的照片(截图、导出图)是常态,不占位、不报错,安静地什么都不显示
  if (!exif?.displayable || !exif.exif) return null;
  const {camera, lens, params, datetime} = exif.exif;

  return (
    <figcaption className="exif-tag">
      {camera && <span>{camera}</span>}
      {lens && <span>{lens}</span>}
      {params && params.length > 0 && <span>{params.join(' · ')}</span>}
      {datetime && <span className="exif-tag-time">{datetime}</span>}
    </figcaption>
  );
};

export const PhotoGrid = ({project}: {project: ProjectResponse}) => {
  const [open, setOpen] = useState<OpenState | null>(null);

  const groups: Group[] = [
    {
      key: 'stills',
      title: '导出作品',
      hint: '按成片同款视觉导出的静态图',
      paths: project.output.stills,
    },
    {
      key: 'photos',
      title: '素材照片',
      hint: '这个文件夹里的原始照片',
      paths: project.photos,
    },
  ].filter((group) => group.paths.length > 0);

  const activeGroup = groups.find((group) => group.key === open?.groupKey) ?? null;

  return (
    <div className="photo-groups">
      {groups.map((group) => (
        <div className="photo-group" key={group.key}>
          <div className="photo-group-head">
            <h3>{group.title}</h3>
            <span className="section-meta">
              {group.paths.length} 张 · {group.hint}
            </span>
          </div>
          <div className="photo-grid">
            {group.paths.map((photoPath, index) => (
              <button
                key={photoPath}
                className="photo-card"
                onClick={() => setOpen({groupKey: group.key, index})}
                aria-label={basename(photoPath)}
              >
                {/* 网格用缩略图,点开的大图才走 /media 拿原图 */}
                <img src={thumbUrl(photoPath, 400)} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        </div>
      ))}

      {activeGroup && open && (
        <Lightbox
          open
          index={open.index}
          close={() => setOpen(null)}
          slides={activeGroup.paths.map((photoPath) => ({src: mediaUrl(photoPath), photoPath}))}
          plugins={[Counter, Zoom]}
          // 单张时不渲染左右翻页,避免出现点了没反应的箭头
          carousel={{finite: activeGroup.paths.length <= 1}}
          on={{view: ({index}) => setOpen({groupKey: activeGroup.key, index})}}
          render={{
            slideFooter: ({slide}) =>
              slide.photoPath ? <ExifTag path={slide.photoPath} /> : null,
          }}
          styles={{container: {backgroundColor: 'rgba(12, 12, 14, 0.94)'}}}
        />
      )}
    </div>
  );
};
