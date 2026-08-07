/**
 * "最近一次在跑的任务"落盘记录:页面刷新后 localStorage 还在,服务端内存里的
 * 任务却可能随重启消失。刷新时若 current 为 null 而本地留有记录,用这个 id
 * 查服务端是否还认识它 —— 404 说明服务重启过、任务已丢,该明确告知而不是
 * 静默回到"可以开工";正常结束会在 end 事件里清掉记录,不会误报。
 */
const LAST_JOB_KEY = 'tsuzuri-last-job';

export interface LastJobRecord {
  id: string;
  kind: string;
  folder: string;
  at: number;
}

export const readLastJobRecord = (): LastJobRecord | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as LastJobRecord).id !== 'string') return null;
    return parsed as LastJobRecord;
  } catch {
    return null;
  }
};

export const writeLastJobRecord = (record: LastJobRecord) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LAST_JOB_KEY, JSON.stringify(record));
  } catch {
    // 隐私模式等写不进 storage 的场景:记录可丢,不影响功能
  }
};

export const clearLastJobRecord = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LAST_JOB_KEY);
  } catch {}
};
