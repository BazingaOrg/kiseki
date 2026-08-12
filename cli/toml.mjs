/**
 * 严格的 TOML 标量子集解析器(不是完整 TOML).
 * 只支持顶层 `key = value` 的一行一项配置,值类型为 bool / int / float / string.
 * 不支持 [table]、数组、内联表、多行字符串、点号键——出现即报错,不做静默降级.
 *
 * 之所以自己写而不用现成 TOML 库:kiseki.toml 只需要这个极小子集,手写解析器
 * 能精确控制"字符串内的 # 不是注释"这类边界情况(旧实现 cli/still.mjs 用
 * `raw.includes(' #')` 简单查找,会把 `outro_text = "a # b"` 这种合法配置错误截断).
 */

const isWs = (ch) => ch === ' ' || ch === '\t';

const syntaxError = (lineNo, message) => {
  const err = new Error(`第 ${lineNo} 行: ${message}`);
  err.line = lineNo;
  return err;
};

/** 基本字符串(双引号)转义:\b \t \n \f \r \" \\ \uXXXX \UXXXXXXXX. */
const readEscape = (line, i, lineNo) => {
  const c = line[i + 1];
  const simple = {b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\'};
  if (c !== undefined && Object.prototype.hasOwnProperty.call(simple, c)) {
    return {char: simple[c], next: i + 2};
  }
  if (c === 'u' || c === 'U') {
    const len = c === 'u' ? 4 : 8;
    const hex = line.slice(i + 2, i + 2 + len);
    if (hex.length !== len || !/^[0-9A-Fa-f]+$/.test(hex)) {
      throw syntaxError(lineNo, `非法的转义序列: \\${c}${hex}`);
    }
    return {char: String.fromCodePoint(parseInt(hex, 16)), next: i + 2 + len};
  }
  throw syntaxError(lineNo, `不支持的转义序列: \\${c ?? ''}`);
};

/** 读取双引号基本字符串,line[start] 必须是开头的 `"`.返回值与紧随其后的下标. */
const readBasicString = (line, start, lineNo) => {
  let i = start + 1;
  let buf = '';
  const len = line.length;
  while (i < len && line[i] !== '"') {
    if (line[i] === '\\') {
      const esc = readEscape(line, i, lineNo);
      buf += esc.char;
      i = esc.next;
      continue;
    }
    buf += line[i];
    i++;
  }
  if (i >= len) throw syntaxError(lineNo, '字符串未闭合(缺少结尾的 ")');
  return {value: buf, next: i + 1};
};

// TOML 十进制整数不允许前导零;每个下划线两侧都必须是数字.
const DEC = String.raw`(?:0|[1-9](?:_?\d)*)`;
const INT_RE = new RegExp(
  `^([+-]?)(0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|${DEC})$`,
);
const FLOAT_RE = new RegExp(
  `^([+-]?)(${DEC})(\\.(${DEC}))?([eE]([+-]?)(${DEC}))?$`,
);
const INF_NAN_RE = /^([+-]?)(inf|nan)$/;

/** 解析裸词数值(int/float/bool 之外的字面量已被上层过滤),失败返回 null. */
const parseBareNumber = (raw) => {
  const intMatch = raw.match(INT_RE);
  if (intMatch) {
    const sign = intMatch[1] === '-' ? -1 : 1;
    const body = intMatch[2];
    // TOML 只允许十进制整数带正负号;0x/0o/0b 字面量必须无符号.
    if (intMatch[1] && /^(0x|0o|0b)/.test(body)) return null;
    let n;
    if (body.startsWith('0x')) n = parseInt(body.slice(2).replace(/_/g, ''), 16);
    else if (body.startsWith('0o')) n = parseInt(body.slice(2).replace(/_/g, ''), 8);
    else if (body.startsWith('0b')) n = parseInt(body.slice(2).replace(/_/g, ''), 2);
    else n = Number(body.replace(/_/g, ''));
    if (!Number.isSafeInteger(n)) return null;
    return {kind: /^(0x|0o|0b)/.test(body) ? 'int-base' : 'int', value: sign * n};
  }
  const infNan = raw.match(INF_NAN_RE);
  if (infNan) {
    const sign = infNan[1] === '-' ? -1 : 1;
    const value = infNan[2] === 'inf' ? sign * Infinity : NaN;
    return {kind: 'float', value};
  }
  const floatMatch = raw.match(FLOAT_RE);
  if (floatMatch && (floatMatch[3] || floatMatch[5])) {
    const cleaned = raw.replace(/_/g, '');
    return {kind: 'float', value: Number(cleaned)};
  }
  return null;
};

const parseBareValue = (raw, lineNo, key) => {
  if (raw === 'true') return {kind: 'bool', value: true};
  if (raw === 'false') return {kind: 'bool', value: false};
  if (raw.includes('_') && /^[+-]?\d/.test(raw)) {
    throw syntaxError(lineNo, `${key}: 数字不允许下划线,请改用不带下划线的十进制`);
  }
  const num = parseBareNumber(raw);
  if (num) return num;
  throw syntaxError(
    lineNo,
    `${key}: 无法识别的值 ${raw};字符串需加引号(如 "#FFFFFF"),数字直接写(如 0.8),布尔写 true/false`,
  );
};

/**
 * 解析一份 flat TOML 文本.
 * 返回 `{values, lineOf, kinds}`:
 * - values: {key: JS 值}(bool→boolean,int/float→number,string→string)
 * - lineOf: {key: 首次出现的行号},供上层拼接报错
 * - kinds:  {key: 'bool'|'int'|'float'|'string'},供上层区分"60" (int) 与
 *   "60.0"(float)字面量——数值上相等但 TOML 类型不同,int 字段不接受 float 字面量.
 * 语法错误抛出 Error,并带 `.line` 属性.
 */
export const parseFlatToml = (text) => {
  const values = {};
  const lineOf = {};
  const kinds = {};
  const lines = text.split(/\r\n|\n|\r/);

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx];

    if (line.includes('"""') || line.includes("'''")) {
      throw syntaxError(lineNo, '不支持多行字符串');
    }

    const len = line.length;
    let i = 0;
    while (i < len && isWs(line[i])) i++;
    if (i >= len || line[i] === '#') continue;

    if (line[i] === '[') {
      throw syntaxError(lineNo, '不支持 [table] / 数组表,配置必须是顶层平铺的 key = value');
    }

    let key;
    if (line[i] === '"') {
      const {value, next} = readBasicString(line, i, lineNo);
      key = value;
      i = next;
    } else {
      const start = i;
      while (i < len && /[A-Za-z0-9_-]/.test(line[i])) i++;
      if (i === start) throw syntaxError(lineNo, `无法识别的配置行: ${line.trim()}`);
      key = line.slice(start, i);
    }

    while (i < len && isWs(line[i])) i++;
    if (line[i] === '.') throw syntaxError(lineNo, '不支持点号键');
    if (line[i] !== '=') throw syntaxError(lineNo, `缺少 =: ${line.trim()}`);
    i++;
    while (i < len && isWs(line[i])) i++;
    if (i >= len || line[i] === '#') throw syntaxError(lineNo, `${key} 缺少值`);

    let kind;
    let value;
    if (line[i] === '[' || line[i] === '{') {
      throw syntaxError(lineNo, '不支持数组 / 内联表');
    } else if (line[i] === '"') {
      const result = readBasicString(line, i, lineNo);
      value = result.value;
      kind = 'string';
      i = result.next;
    } else if (line[i] === "'") {
      throw syntaxError(lineNo, `${key}: 字符串只允许双引号字符串,请改用 "..."`);
    } else {
      const start = i;
      while (i < len && !isWs(line[i]) && line[i] !== '#') i++;
      const parsed = parseBareValue(line.slice(start, i), lineNo, key);
      value = parsed.value;
      kind = parsed.kind;
    }

    while (i < len && isWs(line[i])) i++;
    if (i < len && line[i] !== '#') {
      throw syntaxError(
        lineNo,
        `无法识别的值 ${line.slice(i)};字符串需加引号(如 "#FFFFFF"),数字直接写(如 0.8),布尔写 true/false`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw syntaxError(lineNo, `重复配置项 ${key}(第 ${lineOf[key]} 行已出现)`);
    }
    values[key] = value;
    lineOf[key] = lineNo;
    kinds[key] = kind;
  }

  return {values, lineOf, kinds};
};
