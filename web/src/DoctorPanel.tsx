/**
 * 环境依赖面板。doctor 不是与"渲染视频"平级的一个功能,它是横切的前置条件 ——
 * 所以它在顶栏常驻成一个状态点,而不是主菜单里的第 4 项。
 */
import {Check, RotateCw, X} from 'lucide-react';

import type {DoctorState} from './types';

interface DoctorPanelProps {
  doctor: DoctorState;
  open: boolean;
  onToggle: () => void;
  onRecheck: () => void;
}

export const DoctorPanel = ({doctor, open, onToggle, onRecheck}: DoctorPanelProps) => {
  const checks = typeof doctor === 'string' ? [] : doctor.checks;
  const missing = checks.filter((check) => !check.ok && !check.optional);
  const status =
    doctor === 'loading' ? 'loading' :
    doctor === 'unavailable' ? 'bad' :
    missing.length === 0 ? 'ok' : 'bad';

  const label =
    doctor === 'loading' ? '检查中' :
    doctor === 'unavailable' ? '环境未知' :
    missing.length > 0 ? `缺 ${missing.length} 项依赖` : '环境';

  return (
    <div className="doctor">
      <button className="doctor-trigger" onClick={onToggle} aria-expanded={open} title="环境依赖">
        <span className={`doctor-dot doctor-dot-${status}`} />
        {label}
      </button>

      {open && (
        <div className="doctor-panel">
          {doctor === 'loading' && <p className="hint">正在检查…</p>}

          {doctor === 'unavailable' && (
            <p className="hint">没能查到环境状态。装好依赖后，或者接口恢复后再试一次。</p>
          )}

          {checks.map((check) => (
            <div className="doctor-row" key={check.id}>
              <span className={check.ok ? 'doctor-icon doctor-icon-ok' : 'doctor-icon'}>
                {check.ok ? <Check size={14} /> : <X size={14} />}
              </span>
              <div>
                <span className={check.optional && !check.ok ? 'doctor-line-muted' : undefined}>
                  {check.line}
                </span>
                {!check.ok && check.fix && (
                  <button
                    className="doctor-fix"
                    title="点击复制"
                    onClick={() => navigator.clipboard?.writeText(check.fix!)}
                  >
                    <code>{check.fix}</code>
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* 装完依赖不该逼用户刷新整个页面 */}
          {doctor !== 'loading' && (
            <button className="doctor-recheck" onClick={onRecheck}>
              <RotateCw size={13} /> 重新检查
            </button>
          )}
        </div>
      )}
    </div>
  );
};
