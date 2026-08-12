/** 引号安全字符白名单:字母数字与 _./-=%: 不需要引号;其余(含空格/$/`/\/单引号/空串)都要单引号包裹. */
const SAFE_CHARS_RE = /^[A-Za-z0-9_./=%:-]+$/;

const quoteArg = (arg) => (SAFE_CHARS_RE.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`);

/**
 * 把 argv 拼成可直接复制执行的命令行,POSIX 单引号规则:双引号对 `$`、反引号、`\`
 * 不安全,统一改用单引号 + `'\''` 转义.
 * @param {string[]} argv
 * @param {{program?: string, env?: Record<string,string>}} [opts]
 */
export const formatCommand = (argv, {program = 'node cli/kiseki.mjs', env = {}} = {}) => {
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const parts = [program, ...argv.map(quoteArg)];
  return envPrefix ? `${envPrefix} ${parts.join(' ')}` : parts.join(' ');
};

/** 从仓库运行时可直接复制执行的等效命令(含空格的路径加引号). */
export const formatEquivalentCommand = (argv) => formatCommand(argv, {program: 'node cli/kiseki.mjs'});
