import readline from 'node:readline';

import {dim, promptPrefix} from './term.mjs';

export const PICK_BACK = Symbol('pick-back');

export class PromptAbortError extends Error {
  constructor() {
    super('用户取消');
    this.name = 'PromptAbortError';
    this.exitCode = 130;
  }
}

export class PromptQuitError extends Error {
  constructor() {
    super('用户退出');
    this.name = 'PromptQuitError';
    this.exitCode = 0;
  }
}

/** 键图例:段与段用 ` · ` 连接,整体 dim,视觉焦点留给问题文本. */
export const formatLegend = (segments, output = process.stdout) => {
  const filtered = segments.filter(Boolean);
  return filtered.length > 0 ? dim(` · ${filtered.join(' · ')}`, output) : '';
};

/** 提问行:`? 问题 [默认值] · 键 动作 · 键 动作: `,主体无码以免干扰行编辑. */
export const renderPrompt = ({text, defaultValue = null, legend = []}, output = process.stdout) =>
  `${promptPrefix(output)} ${text}` +
  `${defaultValue !== null ? ` [${defaultValue}]` : ''}` +
  `${formatLegend(legend, output)}: `;

const isQuit = (answer) => String(answer ?? '').trim().toLowerCase() === 'q';

/**
 * 共享交互问答层.SIGINT 与输入流提前关闭都按用户放弃处理,退出码为 130.
 * fn 收到的 ask 提供 confirm / pick / line 三种固定语义的问答.
 */
export const withPrompts = async (
  fn,
  {input = process.stdin, output = process.stdout} = {},
) => {
  const rl = readline.createInterface({input, output});
  let finished = false;
  let abortError = null;
  let rejectQuestion = null;
  const abort = () => {
    if (finished || abortError) return;
    abortError = new PromptAbortError();
    output.write('\n');
    rejectQuestion?.(abortError);
    rl.close();
  };
  rl.on('SIGINT', abort);
  rl.on('close', () => {
    if (!finished) abort();
  });
  const question = (prompt) => {
    if (abortError) return Promise.reject(abortError);
    return new Promise((resolve, reject) => {
      rejectQuestion = reject;
      rl.question(prompt, (answer) => {
        rejectQuestion = null;
        resolve(answer);
      });
    });
  };

  const ask = {
    async confirm(
      text,
      {
        defaultValue = true,
        defaultLabel = defaultValue ? '确认' : '取消',
        alternateKey = defaultValue ? 'n' : 'y',
        alternateLabel = defaultValue ? '取消' : '执行',
      } = {},
    ) {
      const legend = [`回车 ${defaultLabel}`, `${alternateKey} ${alternateLabel}`];
      const prompt = renderPrompt({text, legend}, output);
      for (;;) {
        const answer = (await question(prompt)).trim();
        if (isQuit(answer)) throw new PromptQuitError();
        if (!answer) return defaultValue;
        if (answer.toLowerCase() === alternateKey.toLowerCase()) return !defaultValue;
        output.write(`无效输入,可用键:${legend.join(' · ')}\n`);
      }
    },

    async pick(text, items, {allowBack = true, defaultIndex = null, enterLabel = '选默认项'} = {}) {
      const hasDefault = Number.isInteger(defaultIndex) && defaultIndex >= 0 && defaultIndex < items.length;
      const legend = [items.length === 1 ? '1 选择' : `1-${items.length} 选择`];
      if (hasDefault) legend.push(`回车 ${enterLabel}`);
      else legend.push('回车 放弃');
      if (allowBack) legend.push('0 返回');
      for (const [index, item] of items.entries()) {
        output.write(`  ${index + 1}. ${item}\n`);
      }
      const prompt = renderPrompt({text, legend}, output);
      for (;;) {
        const answer = (await question(prompt)).trim();
        if (isQuit(answer)) throw new PromptQuitError();
        if (!answer) {
          return hasDefault ? {index: defaultIndex, item: items[defaultIndex]} : null;
        }
        if (allowBack && answer === '0') return PICK_BACK;
        if (/^\d+$/.test(answer)) {
          const index = Number(answer) - 1;
          if (index >= 0 && index < items.length) return {index, item: items[index]};
        }
        output.write(`无效选择,可用键:${legend.join(' · ')}\n`);
      }
    },

    async line(
      text,
      {
        defaultValue,
        validate,
        allowBack = false,
        backLabel = '返回',
        emptyBack = false,
        allowQuit = true,
        enterLabel,
        legend: extraLegend = [],
      } = {},
    ) {
      const hasDefault = defaultValue !== undefined && defaultValue !== null;
      const legend = [];
      if (hasDefault) legend.push(`回车 ${enterLabel ?? '用默认值'}`);
      else if (emptyBack) legend.push('回车 留空返回');
      if (allowBack) legend.push(`0 ${backLabel}`);
      legend.push(...extraLegend);
      const prompt = renderPrompt(
        {text, defaultValue: hasDefault ? defaultValue : null, legend},
        output,
      );
      for (;;) {
        const answer = (await question(prompt)).trim();
        if (allowQuit && isQuit(answer)) throw new PromptQuitError();
        if (emptyBack && !answer) return PICK_BACK;
        if (allowBack && answer === '0') return PICK_BACK;
        const value = answer || (hasDefault ? String(defaultValue) : '');
        const result = validate ? await validate(value) : true;
        if (result === true || result === undefined) return value;
        output.write(`${typeof result === 'string' ? result : '输入无效'}\n`);
      }
    },
  };

  try {
    return await fn(ask);
  } finally {
    finished = true;
    rl.close();
  }
};
