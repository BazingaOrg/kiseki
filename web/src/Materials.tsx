import {useRef, useState} from 'react';
import type {FormEvent} from 'react';
import {CircleHelp, Search} from 'lucide-react';

import type {ApiResult} from './api';
import {installLyrics, normalizeSearchQuery, searchAudio, searchLyrics, validateLyrics} from './api';
import type {Capabilities, Remedy} from './capabilities';
import {JobPanel} from './JobPanel';
import {basename} from './media';
import {PhotoGrid} from './PhotoGrid';
import {AssetCollection, fallbackAssetCollection} from './AssetCollection';
import type {AssetItem, AudioCandidate, LyricsCandidate, LyricsValidation, ProjectResponse} from './types';
import {Blocked, CommandHint, Section} from './ui';
import type {JobRequest} from './useJob';
import type {useJob} from './useJob';
import {formatTime} from './useAudioPlayer';
import {useTabs} from './useTabs';

type MaterialJob = Extract<JobRequest, {kind: 'fetch-audio'} | {kind: 'lyrics'}>;

/** 与 cli/fetch.mjs 的 DURATION_WARN_SECONDS 一致:差得比这多就可能整段字幕错位。 */
const DURATION_WARN_SECONDS = 3;

/** yt-dlp 给的是 "3:45" 这样的字符串;万一按秒给,也按秒格式化。 */
const candidateDuration = (value: string | number | null): string =>
  typeof value === 'number' ? formatTime(value) : (value ?? '?:??');

/** 与 cli/fetch.mjs 的 sanitizeFilePart 保持相同的窄规则，确认框展示实际落盘名。 */
const sanitizeFilePart = (value: string): string => value
  .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/[. ]+$/g, '')
  .trim();

const Failure = ({message, fix}: {message: string; fix: string | null}) => (
  <div className="fetch-failure">
    <p className="hint hint-error">{message}</p>
    {fix && <CommandHint command={fix} />}
  </div>
);

interface FetchProps {
  project: ProjectResponse;
  job: ReturnType<typeof useJob>;
  /** 当前跑着的任务是不是这张卡起的 */
  isActive: boolean;
  /** 别的地方起的任务正在跑 —— 服务端一次只跑一个,这时候按钮点了也是 409 */
  busy: boolean;
  onStart: (request: MaterialJob) => Promise<boolean>;
  onReset: () => void;
}

const AudioFetch = ({project, job, isActive, busy, onStart, onReset}: FetchProps) => {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<ApiResult<{candidates: AudioCandidate[]}> | null>(null);
  const [selected, setSelected] = useState<AudioCandidate | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const searchGeneration = useRef(0);
  const queryRef = useRef(query);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const querySnapshot = queryRef.current;
    const q = normalizeSearchQuery(querySnapshot);
    if (!q) return;
    const generation = ++searchGeneration.current;
    setSelected(null);
    setResult(null);
    setSearching(true);
    const outcome = await searchAudio(q);
    if (generation !== searchGeneration.current || queryRef.current !== querySnapshot) return;
    setResult(outcome);
    setSearching(false);
  };

  if (isActive && job.status !== 'idle') {
    return (
      <JobPanel
        verb="下载"
        status={job.status}
        events={job.events}
        error={job.error}
        onCancel={job.cancel}
        onReset={() => {
          setResult(null);
          onReset();
        }}
        resetLabel="重新搜索"
      />
    );
  }

  const candidates = result?.ok ? result.data.candidates : null;
  const fileStem = [sanitizeFilePart(title), sanitizeFilePart(artist)].filter(Boolean).join(' - ');

  return (
    <div className="fetch">
      <form className="fetch-search" onSubmit={submit}>
        <input
          className="fetch-input"
          value={query}
          onChange={(event) => {
            searchGeneration.current += 1;
            queryRef.current = event.target.value;
            setQuery(event.target.value);
            setResult(null);
            setSelected(null);
            setSearching(false);
          }}
          placeholder="输入关键词，例如：晴天 周杰伦"
          aria-label="搜索关键词"
        />
        <button className="fetch-button" type="submit" disabled={!query.trim()}>
          <Search size={13} />
          {searching ? '搜索中…' : '搜索'}
        </button>
      </form>

      {result && !result.ok && <Failure message={result.message} fix={result.fix} />}
      {candidates?.length === 0 && <p className="hint">没搜到，换个说法试试。</p>}

      {candidates && candidates.length > 0 && (
        <ul className="fetch-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <button
                className={candidate.id === selected?.id ? 'fetch-candidate fetch-candidate-selected' : 'fetch-candidate'}
                disabled={busy}
                onClick={() => {
                  setSelected(candidate);
                  setTitle(candidate.title);
                  // uploader/channel 只是来源信息，不会被当作歌手写入文件名。
                  setArtist('');
                }}
              >
                <span className="fetch-candidate-title">{candidate.title}</span>
                <span className="fetch-candidate-meta">
                  {candidateDuration(candidate.duration)} · {candidate.uploader}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="audio-confirm" role="dialog" aria-label="确认下载歌曲">
          <p className="audio-confirm-title">确认歌曲信息</p>
          <label className="audio-confirm-field">
            歌名
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="audio-confirm-field">
            歌手
            <input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="请确认或填写" />
          </label>
          <p className="hint">将保存为：{fileStem || '歌名 - 歌手'}.m4a</p>
          <div className="audio-confirm-actions">
            <button className="link-button" onClick={() => setSelected(null)}>取消</button>
            <button
              className="fetch-button"
              disabled={busy || !sanitizeFilePart(title) || !sanitizeFilePart(artist)}
              onClick={() => {
                onStart({kind: 'fetch-audio', options: {id: selected.id, title: sanitizeFilePart(title), artist: sanitizeFilePart(artist)}});
                setSelected(null);
              }}
            >
              确认下载
            </button>
          </div>
        </div>
      )}

      {busy && <p className="hint">另一项任务正在跑，等它结束再下载。</p>}
      <p className="hint">
        {candidates && candidates.length > 0 ? '选中后先确认歌名和歌手，再下载；' : '搜到的音频确认后'}会落进 {basename(project.path)}/audio。
      </p>
    </div>
  );
};

/** 在线找歌词:空输入由后端自动匹配，手输内容走关键词搜索。 */
const LyricsSearch = ({project, locked, onDone}: {project: ProjectResponse; locked: boolean; onDone: () => void}) => {
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<ApiResult<{candidates: LyricsCandidate[]; query: string}> | null>(null);
  const [installing, setInstalling] = useState<LyricsCandidate['id'] | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<LyricsValidation | null>(null);
  const [failure, setFailure] = useState<{message: string; fix: string | null} | null>(null);
  const [selected, setSelected] = useState<LyricsCandidate | null>(null);
  // 保留原始用户输入；空串始终表示自动匹配，不能被推断词改写成手动搜索。
  const [query, setQuery] = useState('');
  const searchGeneration = useRef(0);
  const queryRef = useRef(query);

  const search = async () => {
    const querySnapshot = queryRef.current;
    const normalized = normalizeSearchQuery(querySnapshot);
    const generation = ++searchGeneration.current;
    setSelected(null);
    setResult(null);
    setSearching(true);
    setFailure(null);
    const outcome = await searchLyrics(project.path, normalized);
    if (generation !== searchGeneration.current || queryRef.current !== querySnapshot) return;
    setResult(outcome);
    setSearching(false);
  };

  const install = async (candidate: LyricsCandidate, offset = 0) => {
    if (locked || installing !== null) return;
    setInstalling(candidate.id);
    const outcome = await installLyrics(project.path, candidate.id, offset);
    setInstalling(null);
    // 成功后不必收拾本地状态:歌词到位,这整块 UI 会被 onDone 触发的刷新换掉
    if (outcome.ok) onDone();
    else setFailure({message: outcome.message, fix: outcome.fix});
  };

  const validate = async (candidate: LyricsCandidate) => {
    if (locked || validating || installing !== null) return;
    setValidating(true);
    setFailure(null);
    const outcome = await validateLyrics(project.path, candidate.id);
    setValidating(false);
    if (outcome.ok) setValidation(outcome.data);
    else setFailure({message: outcome.message, fix: outcome.fix});
  };

  const candidates = result?.ok ? result.data.candidates : null;

  return (
    <>
      <div className="fetch-search">
        <input
          className="fetch-input"
          value={query}
          placeholder="留空自动匹配，也可输入歌名 歌手"
          onChange={(event) => {
            searchGeneration.current += 1;
            queryRef.current = event.target.value;
            setQuery(event.target.value);
            setResult(null);
            setSelected(null);
            setValidation(null);
            setFailure(null);
            setSearching(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') search();
          }}
          aria-label="歌词搜索关键词"
        />
        <button className="fetch-button" onClick={search}>
          <Search size={13} />
          {searching ? '找歌词中…' : result ? '再找一次' : '找歌词'}
        </button>
      </div>

      {result && !result.ok && <Failure message={result.message} fix={result.fix} />}
      {failure && <Failure message={failure.message} fix={failure.fix} />}
      {result?.ok && <p className="hint">{normalizeSearchQuery(query) ? '手动关键词' : '自动匹配'}：按「{result.data.query}」搜索。</p>}
      {candidates?.length === 0 && (
        <p className="hint">没找到对得上的。音频文件名写成「歌名 - 歌手」通常更容易匹配。</p>
      )}

      {candidates && candidates.length > 0 && (
        <ul className="fetch-candidates">
          {candidates.map((candidate) => {
            const off = candidate.delta !== null && candidate.delta > DURATION_WARN_SECONDS;
            const uncertain = !candidate.metadataMatch;
            return (
              <li key={candidate.id}>
                <button
                  className={candidate.id === selected?.id ? 'fetch-candidate fetch-candidate-selected' : 'fetch-candidate'}
                  disabled={installing !== null}
                  onClick={() => { setSelected(candidate); setValidation(null); }}
                >
                  <span className="fetch-candidate-title">{candidate.title}</span>
                  <span className="fetch-candidate-meta">
                    {candidate.artist} · {candidateDuration(candidate.duration)}
                    {candidate.delta !== null &&
                      (off ? (
                        <span className="fetch-warn">
                          与音频差 {Math.round(candidate.delta)}s，时间轴可能错位
                        </span>
                      ) : (
                        <span> · 时长吻合</span>
                      ))}
                    {uncertain && <span className="fetch-warn"> · 歌名或歌手未完全对上</span>}
                    {installing === candidate.id && <span> · 正在写入…</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="audio-confirm" role="dialog" aria-label="确认歌词">
          <p className="audio-confirm-title">{selected.title}</p>
          <p className="hint">
            {selected.artist} · {candidateDuration(selected.duration)}
            {selected.delta !== null &&
              (selected.delta > DURATION_WARN_SECONDS ? (
                <span className="fetch-warn">与音频差 {Math.round(selected.delta)}s，时间轴可能错位</span>
              ) : (
                <span> · 时长吻合</span>
              ))}
            {!selected.metadataMatch && <span className="fetch-warn"> · 请确认歌名和歌手，同时长也可能是其他版本</span>}
          </p>
          {validation?.status === 'matched' && <p className="lyrics-validation lyrics-validation-ok">已用本地人声校验 {validation.anchorCount} 个锚点，时间轴基本吻合。</p>}
          {validation?.status === 'offset' && <p className="lyrics-validation lyrics-validation-warn">检测到稳定偏移 {validation.recommendedOffset! >= 0 ? '+' : ''}{validation.recommendedOffset!.toFixed(1)}s，保存时会自动校准。</p>}
          {validation?.status === 'mismatch' && <p className="lyrics-validation lyrics-validation-error">锚点偏移不断变化，这很可能是另一个演唱或编曲版本，不建议保存。</p>}
          {validation?.status === 'inconclusive' && <p className="lyrics-validation lyrics-validation-warn">可匹配的人声锚点不足，无法可靠判断这份时间轴。</p>}
          <div className="audio-confirm-actions">
            <button className="link-button" onClick={() => setSelected(null)}>取消</button>
            {validation && !['matched', 'offset'].includes(validation.status) && <button className="link-button" disabled={locked || installing !== null} onClick={() => { install(selected); setSelected(null); }}>仍然保存</button>}
            {validation && ['matched', 'offset'].includes(validation.status) ? (
              <button className="fetch-button" disabled={locked || installing !== null} onClick={() => {
                install(selected, validation.status === 'offset' ? (validation.recommendedOffset ?? 0) : 0);
                setSelected(null);
              }}>{installing !== null ? '正在写入…' : validation.status === 'offset' ? '校准并保存' : '保存这份歌词'}</button>
            ) : (
              <button className="fetch-button" disabled={locked || validating || installing !== null} onClick={() => validate(selected)}>
                {validating ? '正在识别人声…' : '校验时间轴'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};

interface LyricsFetchProps extends FetchProps {
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
  onRefresh: () => void;
  locked: boolean;
}

const LyricsFetch = ({
  project,
  capabilities,
  onRemedy,
  job,
  isActive,
  busy,
  onStart,
  onReset,
  onRefresh,
  locked,
}: LyricsFetchProps) => {
  if (isActive && job.status !== 'idle') {
    return (
      <JobPanel
        verb="识别"
        status={job.status}
        events={job.events}
        error={job.error}
        note="第一次识别要先下载 whisper 模型（几百 MB）。模型下载期间不会显示百分比，完成后会自动继续。"
        onCancel={job.cancel}
        onReset={onReset}
        resetLabel="收起"
      />
    );
  }

  return (
    <div className="fetch fetch-paths">
      <div className="fetch-path">
        <span className="fetch-path-label">在线找</span>
        {capabilities.fetchLyrics.enabled ? (
          <LyricsSearch project={project} locked={locked} onDone={onRefresh} />
        ) : (
          <Blocked capability={capabilities.fetchLyrics} onRemedy={onRemedy} currentSection="materials" />
        )}
      </div>

      <div className="fetch-path">
        <span className="fetch-path-label fetch-path-label-with-help">
          本地识别
          <span className="fetch-path-help">
            <button className="fetch-path-help-button" type="button" aria-label="了解本地识别" aria-describedby="recognize-lyrics-help">
              <CircleHelp size={13} strokeWidth={1.6} aria-hidden="true" />
            </button>
            <span className="fetch-path-tooltip" id="recognize-lyrics-help" role="tooltip">
              用 whisper 把人声转成带时间的歌词，几分钟。第一次还要先下模型（几百 MB，没有百分比），可以放着不管。
            </span>
          </span>
        </span>
        {capabilities.recognizeLyrics.enabled ? (
          <>
            <button
              className="fetch-button"
              disabled={busy || locked}
              onClick={() => onStart({kind: 'lyrics'})}
            >
              开始识别
            </button>
            {busy && <p className="hint">另一项任务正在跑，等它结束再识别。</p>}
          </>
        ) : (
          <Blocked capability={capabilities.recognizeLyrics} onRemedy={onRemedy} currentSection="materials" />
        )}
      </div>
    </div>
  );
};

interface MaterialsProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
  /** 由 Workbench 持有，以便切换区段时保留任务与取消入口。 */
  job: ReturnType<typeof useJob>;
  activeKind: MaterialJob['kind'] | null;
  onStart: (request: MaterialJob) => Promise<boolean>;
  onReset: () => void;
  /** 歌词落地走的是普通端点,没有任务结束事件,得自己触发一次刷新 */
  onRefresh: () => void;
  onReplaceRecognizedLyrics: () => void;
  onClearRecognizedLyrics: () => void;
  assetBusy: boolean;
  locked: boolean;
  onAsset: (item: AssetItem, action: 'rename' | 'delete', stem?: string) => void;
}

export const Materials = ({
  project,
  capabilities,
  onRemedy,
  job,
  activeKind,
  onStart,
  onReset,
  onRefresh,
  onReplaceRecognizedLyrics,
  onClearRecognizedLyrics,
  assetBusy,
  locked,
  onAsset,
}: MaterialsProps) => {
  const photos = project.photos;
  const audios = project.audios ?? (project.audio ? [project.audio] : []);
  const lyricsFiles = project.lyricsFiles ?? (project.lyricsFile ? [project.lyricsFile] : []);
  const audioAssets = project.assets?.audios ?? fallbackAssetCollection('audio', audios);
  const lyricsAssets = project.assets?.lyrics ?? fallbackAssetCollection('lyrics', lyricsFiles);
  const lyricLines = project.lyrics?.length ?? 0;
  const running = job.status === 'running';
  const initialTab = running && activeKind === 'fetch-audio'
    ? 'music'
    : running && activeKind === 'lyrics'
      ? 'lyrics'
      : audioAssets.state !== 'ready'
        ? 'music'
        : lyricsAssets.state === 'ambiguous'
          ? 'lyrics'
          : 'photos';
  const [tab, setTab] = useState<'photos' | 'music' | 'lyrics'>(initialTab);
  const tabsBehavior = useTabs({values: ['photos', 'music', 'lyrics'] as const, value: tab, onValueChange: setTab, idPrefix: 'materials'});
  const tabs = [
    {key: 'photos' as const, label: '照片', meta: photos.length > 0 ? `${photos.length} 张` : '暂无', description: photos.length > 0 ? `${photos.length} 张照片` : '暂无照片'},
    {
      key: 'music' as const,
      label: '音乐',
      meta: activeKind === 'fetch-audio' && running ? '进行中' : audioAssets.state === 'ready' ? '已就绪' : audioAssets.state === 'ambiguous' ? '需处理' : '暂无',
      description: activeKind === 'fetch-audio' && running ? '音乐下载进行中' : audioAssets.state === 'ready' ? '音乐已就绪' : audioAssets.state === 'ambiguous' ? '音乐需处理' : '暂无音乐',
    },
    {
      key: 'lyrics' as const,
      label: '歌词',
      meta: activeKind === 'lyrics' && running ? '进行中' : lyricsAssets.state === 'ambiguous' ? '需处理' : lyricLines > 0 ? `${lyricLines} 行` : '暂无',
      description: activeKind === 'lyrics' && running ? '歌词识别进行中' : lyricsAssets.state === 'ambiguous' ? '歌词需处理' : lyricLines > 0 ? `${lyricLines} 行歌词` : '暂无歌词',
    },
  ];

  return (
    <Section title="素材" titleHidden>
      <div className="material-tabs" {...tabsBehavior.tabListProps} aria-label="素材分类">
        {tabs.map(({key, label, meta, description}) => (
          <button key={key} className={tab === key ? 'material-tab material-tab-active' : 'material-tab'} {...tabsBehavior.getTabProps(key)} aria-label={`${label}，${description}`}>
            <span>{label}</span>
            <span className="material-tab-meta" aria-hidden="true">{meta}</span>
          </button>
        ))}
      </div>

      <div {...tabsBehavior.getPanelProps('photos')}>
        {photos.length > 0 ? (
          <PhotoGrid project={project} groups={[{key: 'materials', title: '全部照片', hint: '', paths: photos, assets: project.assets?.photos.items ?? fallbackAssetCollection('photo', photos).items, showHeader: false}]} busy={assetBusy} onRename={(item, stem) => onAsset(item, 'rename', stem)} onDelete={(item) => onAsset(item, 'delete')} />
        ) : (
          <p className="material-empty">把照片放进这个文件夹就行，jpg / png / webp 都可以。</p>
        )}
      </div>

      <div {...tabsBehavior.getPanelProps('music')}>
          {audioAssets.state !== 'empty' && (
            <AssetCollection
              collection={audioAssets}
              empty=""
              ambiguous={(count) => `检测到 ${count} 份音频；渲染和歌词识别不会猜测第一份，请保留唯一文件后继续。`}
              busy={assetBusy}
              onRename={(item, stem) => onAsset(item, 'rename', stem)}
              onDelete={(item) => onAsset(item, 'delete')}
            />
          )}
          {audioAssets.state === 'empty' &&
            (capabilities.fetchAudio.enabled ? (
              <AudioFetch
                project={project}
                job={job}
                isActive={activeKind === 'fetch-audio'}
                busy={locked || (running && activeKind !== 'fetch-audio')}
                onStart={onStart}
                onReset={onReset}
              />
            ) : (
              <Blocked capability={capabilities.fetchAudio} onRemedy={onRemedy} currentSection="materials" />
            ))}
      </div>

      <div {...tabsBehavior.getPanelProps('lyrics')}>
          {lyricLines > 0 && <p className="section-meta">{project.lyricsSource === 'lrc' ? '来自 .lrc' : '本地识别'}</p>}
          {lyricsAssets.state !== 'empty' && (
            <AssetCollection
              collection={lyricsAssets}
              empty=""
              ambiguous={(count) => `检测到 ${count} 份歌词；当前只读展示全部文件，渲染前请保留唯一的一份。`}
              busy={assetBusy}
              onRename={(item, stem) => onAsset(item, 'rename', stem)}
              onDelete={(item) => onAsset(item, 'delete')}
            />
          )}
          {activeKind === 'lyrics' && job.status !== 'idle' ? (
            <JobPanel verb="识别" status={job.status} events={job.events} error={job.error} onCancel={job.cancel} onReset={onReset} resetLabel="收起" />
          ) : lyricsAssets.state === 'ambiguous' ? null : lyricLines > 0 ? (
            <ol className="material-lyric-preview">
              {project.lyrics!.map((line, index) => (
                <li key={`${line.time}-${index}`}>{line.text || '⋯'}</li>
              ))}
            </ol>
          ) : (
            <LyricsFetch
              project={project}
              capabilities={capabilities}
              onRemedy={onRemedy}
              job={job}
              isActive={activeKind === 'lyrics'}
              busy={locked || (running && activeKind !== 'lyrics')}
              locked={locked}
              onStart={onStart}
              onReset={onReset}
              onRefresh={onRefresh}
            />
          )}
          {project.lyricsSource === 'recognized' && project.recognizedLyricsManageable === true && (
            <div className="asset-actions">
              <button className="link-button" disabled={locked || assetBusy || running} onClick={onReplaceRecognizedLyrics}>重新识别</button>
              <button className="link-button" disabled={locked || assetBusy || running} onClick={onClearRecognizedLyrics}>清除识别结果</button>
            </div>
          )}
      </div>

      {project.unsupportedVideos.length > 0 && (
        <p className="note">
          忽略了 {project.unsupportedVideos.length} 个视频文件，tsuzuri 目前只处理照片。
        </p>
      )}
    </Section>
  );
};
