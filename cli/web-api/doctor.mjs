/**
 * GET /api/doctor —— 环境依赖状态,直接复用 doctor.mjs 的 collectDoctorChecks,
 * 与 `kiseki doctor` 是同一份判定,不另立一套.
 *
 * 前端拿它来决定哪些能力可用(缺 ffmpeg 就禁用渲染并写明原因),
 * 所以每项都带 `fix` 安装提示,前端可直接展示成"怎么补".
 * 仅接受调用方的 refresh 标记以绕过已完成缓存,不碰文件系统沙箱.
 */
import {collectWebDoctorChecks} from '../doctor.mjs';

const TTL_MS = 5000;

const responseFor = (checks) => ({
  status: 200,
  body: {
    // 只有必需依赖会影响 ok;可选项(yt-dlp/analyzer venv)从不判定失败
    ok: checks.every((check) => check.ok || check.optional === true),
    checks: checks.map((check) => ({
      id: check.id,
      ok: check.ok,
      optional: check.optional === true,
      line: check.line,
      fix: check.fix ?? null,
    })),
  },
});

/** 每个 web server 应有自己的一份缓存与 single-flight 状态. */
export const createDoctorService = ({collect = collectWebDoctorChecks, now = Date.now, ttlMs = TTL_MS} = {}) => {
  let cached = null;
  let inFlight = null;

  const getDoctor = ({refresh = false} = {}) => {
    if (refresh) cached = null;
    if (cached && now() - cached.completedAt < ttlMs) return Promise.resolve(cached.result);
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(collect)
      .then((checks) => {
        const result = responseFor(checks);
        // TTL 从完整成功探测完成后开始计算,不能从请求发起时算.
        cached = {result, completedAt: now()};
        return result;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  return {getDoctor};
};

const defaultService = createDoctorService();

/** @returns {Promise<{status: number, body: object}>} */
export const getDoctor = (options) => defaultService.getDoctor(options);
