/**
 * web 展示的"等效终端命令"必须和服务端实际执行的 argv 同源,避免像过去那样
 * 命令展示写死成 `kiseki <folder>`、画幅/滤镜/EXIF/草稿/倍率全部对不上。
 * 这里直接复用 cli/job-argv.mjs 的纯函数,渲染层只管拼字符串。
 */
import {buildJobInvocation} from '../../cli/job-argv.mjs';
import {formatCommand} from '../../cli/command-format.mjs';

type Kind = 'render' | 'still';

/**
 * @param kind - 'render' | 'still'
 * @param folder - 素材夹路径原值,不要预先加引号,quote 逻辑统一在 formatCommand 里做
 * @param options - 与发给服务端的 options 相同的结构
 */
export const equivalentCommand = (kind: Kind, folder: string, options: unknown): string => {
  try {
    const {argv, env} = buildJobInvocation({kind, folder, options: options ?? {}});
    return formatCommand(argv, {program: 'kiseki', env});
  } catch {
    // 展示纯粹是锦上添花,选项非法(理论上表单已经保证合法)也绝不能让它在 render
    // 路径上抛出导致白屏,退化成只显示文件夹路径。
    return formatCommand([folder], {program: 'kiseki'});
  }
};
