import {defaultJsonWrite, jsonProgressEnabled} from './term.mjs';

const clampPercent = (value) =>
  Math.max(0, Math.min(100, Math.round(Number(value) * 100)));

const BAR_WIDTH = 20;

const formatBar = (percent) => {
  const filled = Math.floor((percent * BAR_WIDTH) / 100);
  return `[${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}]`;
};

/** Stable-width progress bar + percentage output for long-running renderer stages. */
export const createPercentProgress = ({
  stream = process.stdout,
  env = process.env,
  jsonWrite = defaultJsonWrite,
} = {}) => {
  let label = null;
  let percent = -1;
  let lastPrintedBucket = -1;
  const interactive = Boolean(stream.isTTY);
  const jsonEnabled = jsonProgressEnabled(env);

  const finishLine = () => {
    if (interactive && label !== null) stream.write('\n');
  };

  const currentLine = () =>
    `└ ${label.padEnd(18)} ${formatBar(percent)} ${String(percent).padStart(3)}%`;

  return {
    update(nextLabel, value) {
      const nextPercent = clampPercent(value);
      if (nextLabel !== label) {
        finishLine();
        label = nextLabel;
        percent = -1;
        lastPrintedBucket = -1;
      }
      if (nextPercent === percent) return;
      percent = nextPercent;
      if (jsonEnabled) jsonWrite({kind: 'progress', label: nextLabel, percent});
      const line = currentLine();

      if (interactive) {
        stream.write(`\r\x1b[2K${line}`);
        return;
      }

      // Redirected logs stay concise while still exposing deterministic progress.
      const bucket = percent === 100 ? 4 : Math.floor(percent / 25);
      if (bucket > lastPrintedBucket) {
        stream.write(`${line}\n`);
        lastPrintedBucket = bucket;
      }
    },
    /** 打印一行外部消息(如浏览器日志),不打断进行中的进度行。 */
    println(text) {
      if (interactive && label !== null && percent >= 0) {
        stream.write(`\r\x1b[2K${text}\n${currentLine()}`);
      } else {
        stream.write(`${text}\n`);
      }
    },
    finish() {
      finishLine();
      label = null;
    },
  };
};
