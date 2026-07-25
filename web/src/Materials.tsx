/**
 * 「素材」区段:这个文件夹里有什么、还缺什么。
 *
 * 关键设计:缺件时那张卡不是灰掉的空壳,而是变成一张「行动卡」—— 说清缺什么、
 * 怎么补,并且就地补。fetch 因此不再是主菜单第 5 项,而是长在它真正该出现的地方。
 *
 * 补齐动作分两类:搜索(百毫秒)当场做,下载与识别(分钟级)交给任务系统 ——
 * 判据是"会不会让用户盯着转圈"。任务状态由 Workbench 持有,见下面 MaterialsProps 的注记。
 */
import {useState} from 'react';
import type {FormEvent} from 'react';
import {Image, Music, Search, Type} from 'lucide-react';
import type {ReactNode} from 'react';

import type {ApiResult} from './api';
import {installLyrics, searchAudio, searchLyrics} from './api';
import type {Capabilities, Remedy} from './capabilities';
import {JobPanel} from './JobPanel';
import {basename, thumbUrl} from './media';
import type {AudioCandidate, LyricsCandidate, ProjectResponse} from './types';
import {Blocked, CommandHint, Section} from './ui';
import type {JobRequest} from './useJob';
import type {useJob} from './useJob';
import {formatTime} from './useAudioPlayer';

/** 素材段能起的两种任务。渲染/导出属于「制作」,不在这里。 */
type MaterialJob = Extract<JobRequest, {kind: 'fetch-audio'} | {kind: 'lyrics'}>;

/** 与 cli/fetch.mjs 的 DURATION_WARN_SECONDS 一致:差得比这多就可能整段字幕错位。 */
const DURATION_WARN_SECONDS = 3;

/** yt-dlp 给的是 "3:45" 这样的字符串;万一按秒给,也按秒格式化。 */
const candidateDuration = (value: string | number | null): string =>
  typeof value === 'number' ? formatTime(value) : (value ?? '?:??');

/** 搜索失败的展示:yt-dlp 没装时后端把安装提示放在 fix 里,原样给出去,可复制。 */
const Failure = ({message, fix}: {message: string; fix: string | null}) => (
  <div className="fetch-failure">
    <p className="hint hint-error">{message}</p>
    {fix && <CommandHint command={fix} />}
  </div>
);

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

interface FetchProps {
  project: ProjectResponse;
  job: ReturnType<typeof useJob>;
  /** 当前跑着的任务是不是这张卡起的 */
  isActive: boolean;
  /** 别的地方起的任务正在跑 —— 服务端一次只跑一个,这时候按钮点了也是 409 */
  busy: boolean;
  onStart: (request: MaterialJob) => void;
  onReset: () => void;
}

/**
 * 缺音频时的在线搜索。关键词要用户自己给 —— 空素材夹里没有任何东西能推出查询词。
 */
const AudioFetch = ({project, job, isActive, busy, onStart, onReset}: FetchProps) => {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<ApiResult<{candidates: AudioCandidate[]}> | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setResult(await searchAudio(q));
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

  return (
    <div className="fetch">
      <form className="fetch-search" onSubmit={submit}>
        <input
          className="fetch-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="歌名 + 歌手"
          aria-label="搜索关键词"
        />
        <button className="fetch-button" type="submit" disabled={!query.trim() || searching}>
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
                className="fetch-candidate"
                disabled={busy}
                onClick={() =>
                  onStart({
                    kind: 'fetch-audio',
                    // artist 取上传者:yt-dlp 的搜索结果里没有独立的歌手字段,
                    // 而后端拿 title/artist 拼落地文件名,给个来源比留空强
                    options: {id: candidate.id, title: candidate.title, artist: candidate.uploader},
                  })
                }
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

      {busy && <p className="hint">另一项任务正在跑，等它结束再下载。</p>}
      <p className="hint">
        {candidates && candidates.length > 0 ? '选中一条就开始下载，' : '搜到的音频下载后'}
        会落进 {basename(project.path)}/audio。
      </p>
    </div>
  );
};

/** 在线找歌词:查询词后端从音频推,前端只管点一下和挑一条。 */
const LyricsSearch = ({project, onDone}: {project: ProjectResponse; onDone: () => void}) => {
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<ApiResult<{candidates: LyricsCandidate[]; query: string}> | null>(null);
  const [installing, setInstalling] = useState<LyricsCandidate['id'] | null>(null);
  const [failure, setFailure] = useState<{message: string; fix: string | null} | null>(null);
  // 空串 = 让后端从音频 tag / 文件名自己推;搜过一次之后把它推出来的词填回来,
  // 用户就知道刚才是拿什么在搜、改哪里能搜得更准
  const [query, setQuery] = useState('');

  const search = async () => {
    if (searching) return;
    setSearching(true);
    setFailure(null);
    const outcome = await searchLyrics(project.path, query);
    setResult(outcome);
    // 把后端实际用的查询词填回输入框:用户想在推断词基础上微调,不必整句重打
    if (outcome.ok && !query.trim()) setQuery(outcome.data.query);
    setSearching(false);
  };

  const install = async (candidate: LyricsCandidate) => {
    if (installing !== null) return;
    setInstalling(candidate.id);
    const outcome = await installLyrics(project.path, candidate.id);
    setInstalling(null);
    // 成功后不必收拾本地状态:歌词到位,这整块 UI 会被 onDone 触发的刷新换掉
    if (outcome.ok) onDone();
    else setFailure({message: outcome.message, fix: outcome.fix});
  };

  const candidates = result?.ok ? result.data.candidates : null;

  return (
    <>
      <div className="fetch-search">
        <input
          className="fetch-input"
          value={query}
          placeholder="留空则按音频信息自动匹配" 
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') search();
          }}
          aria-label="歌词搜索关键词"
        />
        <button className="fetch-button" onClick={search} disabled={searching}>
          <Search size={13} />
          {searching ? '找歌词中…' : result ? '再找一次' : '找歌词'}
        </button>
      </div>

      {result && !result.ok && <Failure message={result.message} fix={result.fix} />}
      {failure && <Failure message={failure.message} fix={failure.fix} />}
      {candidates?.length === 0 && (
        <p className="hint">没找到对得上的。音频文件名写成「歌手 - 歌名」通常更容易匹配。</p>
      )}

      {candidates && candidates.length > 0 && (
        <ul className="fetch-candidates">
          {candidates.map((candidate) => {
            const off = candidate.delta !== null && candidate.delta > DURATION_WARN_SECONDS;
            return (
              <li key={candidate.id}>
                <button
                  className="fetch-candidate"
                  disabled={installing !== null}
                  onClick={() => install(candidate)}
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
                    {installing === candidate.id && <span> · 正在写入…</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};

interface LyricsFetchProps extends FetchProps {
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
  onRefresh: () => void;
}

/**
 * 缺歌词时的两条路:在线找现成的,或本地识别。并列摆着,各自按自己的能力门禁。
 * 两条路都缺音频时会各自说一遍原因 —— 重复,但每一行解释的是它自己那一条路,
 * 比合并成一句"先补音频"更贴事实。
 */
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
}: LyricsFetchProps) => {
  if (isActive && job.status !== 'idle') {
    return (
      <JobPanel
        verb="识别"
        status={job.status}
        events={job.events}
        error={job.error}
        note="第一次识别要先下载 whisper 模型（几百 MB，没有百分比，这段时间看着像不动，是正常的）。"
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
          <LyricsSearch project={project} onDone={onRefresh} />
        ) : (
          <Blocked capability={capabilities.fetchLyrics} onRemedy={onRemedy} />
        )}
      </div>

      <div className="fetch-path">
        <span className="fetch-path-label">本地识别</span>
        {capabilities.recognizeLyrics.enabled ? (
          <>
            <button
              className="fetch-button"
              disabled={busy}
              onClick={() => onStart({kind: 'lyrics'})}
            >
              开始识别
            </button>
            <p className="hint">
              用 whisper 把人声转成带时间的歌词，几分钟。第一次还要先下模型（几百 MB，没有百分比），
              可以放着不管。
            </p>
            {busy && <p className="hint">另一项任务正在跑，等它结束再识别。</p>}
          </>
        ) : (
          <Blocked capability={capabilities.recognizeLyrics} onRemedy={onRemedy} />
        )}
      </div>
    </div>
  );
};

interface MaterialsProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
  /**
   * 任务状态由 Workbench 持有,不在这里 useJob —— 切区段会卸载 Materials,
   * hook 的 cleanup 会关掉 EventSource 并丢掉 jobId,回来就再没有入口能取消。
   */
  job: ReturnType<typeof useJob>;
  activeKind: MaterialJob['kind'] | null;
  onStart: (request: MaterialJob) => void;
  onReset: () => void;
  /** 歌词落地走的是普通端点,没有任务结束事件,得自己触发一次刷新 */
  onRefresh: () => void;
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
}: MaterialsProps) => {
  const photos = project.photos;
  const lyricLines = project.lyrics?.length ?? 0;
  const running = job.status === 'running';

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
          {!project.audio &&
            (capabilities.fetchAudio.enabled ? (
              <AudioFetch
                project={project}
                job={job}
                isActive={activeKind === 'fetch-audio'}
                busy={running && activeKind !== 'fetch-audio'}
                onStart={onStart}
                onReset={onReset}
              />
            ) : (
              <Blocked capability={capabilities.fetchAudio} onRemedy={onRemedy} />
            ))}
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
          {lyricLines > 0 ? (
            /* 原先只列前 3 行,刚下完歌词的人看到的就是"显示不全"。这里是素材段,
               确认自己拿到的是哪一份歌词正是它的用途,所以列全,超高了自己滚。 */
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
              busy={running && activeKind !== 'lyrics'}
              onStart={onStart}
              onReset={onReset}
              onRefresh={onRefresh}
            />
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
