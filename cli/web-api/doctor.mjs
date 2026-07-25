/**
 * GET /api/doctor —— 环境依赖状态,直接复用 doctor.mjs 的 collectDoctorChecks,
 * 与 `tsuzuri doctor` 是同一份判定,不另立一套。
 *
 * 前端拿它来决定哪些能力可用(缺 ffmpeg 就禁用渲染并写明原因),
 * 所以每项都带 `fix` 安装提示,前端可直接展示成"怎么补"。
 * 不接受任何请求参数,不碰文件系统沙箱。
 */
import {collectDoctorChecks} from '../doctor.mjs';

/** @returns {{status: number, body: object}} */
export const getDoctor = () => {
  const checks = collectDoctorChecks();
  return {
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
  };
};
