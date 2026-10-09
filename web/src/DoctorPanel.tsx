/**
 * 环境还没准备好时才出现。依赖齐全且已填写 DeepSeek API Key 时不占位置。
 * 内容放在页面中央的弹窗里，避免把顶栏或欢迎页的按钮挤走。
 */
import {useEffect, useState} from 'react';
import {Check, X} from 'lucide-react';

import {installSetupTool, saveCaptionKey} from './api';
import type {DoctorState} from './types';

interface DoctorPanelProps {
  doctor: DoctorState;
  onRecheck: () => void;
  photoCaptionConfigured: boolean;
  portableTools?: boolean;
  onCaptionKeySaved: () => void;
  requestOpen?: number;
}

const DOWNLOADABLE = new Set(['uv', 'ffmpeg', 'analyzer']);

const toolAction = (id: string, portable: boolean, busy: boolean) => {
  if (busy) return portable ? '正在下载…' : '正在安装…';
  if (id === 'ffmpeg') return portable ? '下载 FFmpeg' : '安装 FFmpeg';
  if (id === 'analyzer') return '下载分析组件';
  return portable ? '下载 uv' : '安装 uv';
};

export const DoctorPanel = ({doctor, onRecheck, photoCaptionConfigured, portableTools = false, onCaptionKeySaved, requestOpen = 0}: DoctorPanelProps) => {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checks = typeof doctor === 'string' ? [] : doctor.checks;
  const missing = checks.filter((check) => !check.ok && !check.optional);
  const needsTools = doctor === 'unavailable' || missing.length > 0;
  const needsKey = !photoCaptionConfigured;
  const visible = doctor !== 'loading' && (needsTools || needsKey);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busy === null) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy]);

  useEffect(() => {
    if (requestOpen > 0) setOpen(true);
  }, [requestOpen]);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  if (!visible) return null;

  const title = needsTools ? '准备这台电脑' : '给照片写一句旁白';

  return (
    <div className="doctor">
      <button className="doctor-trigger" onClick={() => setOpen(true)}>
        {needsTools ? '准备这台电脑' : '填写 DeepSeek API Key'}
      </button>

      {open && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && busy === null) setOpen(false);
          }}
        >
          <section className="dialog doctor-dialog" role="dialog" aria-modal="true" aria-labelledby="doctor-title">
            <h2 id="doctor-title">{title}</h2>
            {portableTools && needsTools && (
              <p className="hint">FFmpeg 用来处理画面和声音。分析组件用来对齐节拍，没有歌词文件时也会在这台电脑上识别歌词。下载后保存在这台电脑里。</p>
            )}

            {doctor === 'unavailable' && (
              <p>没能检查这台电脑。确认工作台还开着，再试一次。</p>
            )}

            {needsTools && checks.filter((check) => !check.ok && !check.optional).map((check) => (
              <div className="doctor-row" key={check.id}>
                <span className="doctor-icon"><X size={14} /></span>
                <div>
                  <span>{check.line}</span>
                  {DOWNLOADABLE.has(check.id) && (
                    <button
                      className="doctor-recheck"
                      disabled={busy !== null}
                      onClick={() => {
                        setBusy(check.id);
                        setNotice(check.id === 'analyzer' ? '分析组件要下载一会儿。' : null);
                        void installSetupTool(check.id as 'uv' | 'ffmpeg' | 'analyzer').then((result) => {
                          setBusy(null);
                          if (!result.ok) setNotice(result.message);
                          else {
                            const done = check.id === 'ffmpeg' ? 'FFmpeg' : check.id === 'analyzer' ? '分析组件' : 'uv';
                            setNotice(`${done}已${portableTools ? '下载' : '安装'}，正在重新检查。`);
                            onRecheck();
                          }
                        });
                      }}
                    >
                      {toolAction(check.id, portableTools, busy === check.id)}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {needsKey && (
              <form
                className="doctor-key"
                onSubmit={(event) => {
                  event.preventDefault();
                  setBusy('key');
                  setNotice(null);
                  void saveCaptionKey(apiKey).then((result) => {
                    setBusy(null);
                    if (!result.ok) setNotice(result.message);
                    else {
                      setApiKey('');
                      setNotice('已保存。之后可以给照片写一句旁白。');
                      onCaptionKeySaved();
                    }
                  });
                }}
              >
                <label htmlFor="caption-key">DeepSeek API Key</label>
                <p className="hint">可选。填了之后，制作时可以给照片配上一句旁白。Key 只保存在这台电脑上，保存后页面不再显示。</p>
                <input
                  id="caption-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="DeepSeek API Key"
                />
                <button className="primary-button" type="submit" disabled={busy !== null || apiKey.trim() === ''}>
                  {busy === 'key' ? '正在保存…' : '保存'}
                </button>
              </form>
            )}

            {needsTools && checks.some((check) => check.ok) && (
              <p className="hint doctor-ready-note">
                <Check size={14} /> 其余项目已经可用。
              </p>
            )}
            {notice && <p className="hint" role="status">{notice}</p>}
            <div className="dialog-actions">
              <button className="link-button" disabled={busy !== null} onClick={onRecheck}>重新检查</button>
              <button className="primary-button" disabled={busy !== null} onClick={() => setOpen(false)}>关闭</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
