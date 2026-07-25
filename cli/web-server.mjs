/**
 * 本地网页工作台 server:Node 原生 http,不引入 express。
 * 五个 API(dirs / project / doctor / exif / thumb)+ 媒体透传(media)+ 静态前端
 * (`web/dist`,未构建时回退占位页)。除 /api/thumb 会往系统临时目录写缩略图缓存外,
 * 全部只读,不碰用户的素材夹。
 * `root` 是路径沙箱的允许根目录,由 cli/web.mjs 决定(锁定素材夹或用户主目录)。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {listDirs} from './web-api/dirs.mjs';
import {getDoctor} from './web-api/doctor.mjs';
import {getExif} from './web-api/exif.mjs';
import {createJobManager, JobValidationError} from './web-api/jobs.mjs';
import {getProject} from './web-api/project.mjs';
import {resolveMedia} from './web-api/media.mjs';
import {resolveSafePath} from './web-api/sandbox.mjs';
import {resolveThumb} from './web-api/thumb.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATIC_DIR = path.join(REPO, 'web', 'dist');

const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const PLACEHOLDER_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>tsuzuri 画廊</title></head>' +
  '<body style="font-family: sans-serif; padding: 2rem;">' +
  '<h1>tsuzuri 本地画廊</h1>' +
  '<p>前端页面尚未构建。API 已就绪:/api/dirs、/api/project、/media。</p>' +
  '</body></html>';

const sendJson = (res, {status, body}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(payload);
};

const sendMedia = (res, result) => {
  if (result.status >= 400) {
    res.writeHead(result.status, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(result.body);
    return;
  }
  res.writeHead(result.status, result.headers);
  const stream = fs.createReadStream(result.streamPath, result.streamOptions);
  stream.on('error', () => res.end());
  stream.pipe(res);
};

const INDEX_HTML = path.join(STATIC_DIR, 'index.html');
const isDistBuilt = () => fs.existsSync(INDEX_HTML) && fs.statSync(INDEX_HTML).isFile();

const serveFile = (res, filePath) => {
  const contentType = STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {'Content-Type': contentType});
  fs.createReadStream(filePath).pipe(res);
};

/**
 * index.html 需要在返回前注入任务 API 用的 token(契约二:token 通过
 * `<meta name="tsuzuri-token">` 下发,不做 GET /api/token 端点白送出去),
 * 所以这里不能再用 fs.createReadStream 直接管道,要先读出内容改字符串。
 */
const serveIndexHtml = (res, token) => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const escapedToken = token.replaceAll('"', '&quot;');
  const withToken = html.replace('</head>', `<meta name="tsuzuri-token" content="${escapedToken}">\n</head>`);
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end(withToken);
};

const serveStatic = (req, res, token) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(STATIC_DIR, urlPath);
  // 静态资源只在 web/dist 内,不接受外部路径(简单前缀校验,已经是构建产物无用户输入)
  if (!filePath.startsWith(STATIC_DIR + path.sep) && filePath !== STATIC_DIR) {
    res.writeHead(403);
    res.end();
    return;
  }
  // web/dist 整个还没构建时,保持占位页兜底,不区分路径,也不需要注入 token
  // (反正 API 还没有前端可用)
  if (!isDistBuilt()) {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(PLACEHOLDER_HTML);
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (filePath === INDEX_HTML) {
      serveIndexHtml(res, token);
      return;
    }
    serveFile(res, filePath);
    return;
  }
  // 已构建但没命中:带静态资源扩展名的路径确实是 404,其余(SPA 路由)回退到 index.html
  if (path.extname(urlPath) && STATIC_MIME_TYPES[path.extname(urlPath).toLowerCase()]) {
    res.writeHead(404);
    res.end();
    return;
  }
  serveIndexHtml(res, token);
};

/**
 * 校验请求的 Host 头,只允许 localhost/127.0.0.1 加上 server 实际监听的端口。
 * server 只绑定 127.0.0.1,理论上外部拿不到直连,但攻击者网页可用 DNS
 * rebinding 把自己的域名重新解析到 127.0.0.1,浏览器就会带着"同源"的假象
 * 发起请求——不校验 Host 就会让这类页面读到 home 目录下的任意文件。
 * @param {string} hostHeader req.headers.host
 * @param {number} port server 实际监听的端口
 * @returns {boolean}
 */
const isAllowedHost = (hostHeader, port) =>
  hostHeader === `localhost:${port}` || hostHeader === `127.0.0.1:${port}`;

const JOB_ID_RE = /^\/api\/jobs\/([^/]+)$/;
const JOB_EVENTS_RE = /^\/api\/jobs\/([^/]+)\/events$/;
const JOB_CANCEL_RE = /^\/api\/jobs\/([^/]+)\/cancel$/;

// 这两个是仅有的两条非 GET 路由,其余路由维持 GET-only,与下方全局方法拦截配合。
// 必须同时校验 method,否则"路径对但方法错"(比如 PUT /api/jobs)会被当成合法的
// job-post-route 放过 405 拦截,一路落到 serveStatic 的 SPA fallback。
const isJobPostRoute = (method, pathname) =>
  method === 'POST' && (pathname === '/api/jobs' || JOB_CANCEL_RE.test(pathname));

/**
 * @param {string} root 路径沙箱允许的根目录(绝对路径)
 * @param {{spawnImpl?: Function}} [deps] spawnImpl 供测试注入假的子进程实现,
 *   避免单测真的起渲染进程;生产环境不传即用真实 child_process.spawn。
 * @returns {{server: import('node:http').Server, token: string}}
 */
export const createGalleryServer = (root, {spawnImpl} = {}) => {
  // 所有非 GET 请求(创建/取消任务)必须带上这个 token(契约二安全前提 3),
  // 与既有的 Host 头校验彼此独立、互不替代,构成双控制。
  const token = crypto.randomBytes(32).toString('hex');
  const jobManager = createJobManager(spawnImpl ? {spawnImpl} : {});

  const checkToken = (req, res) => {
    if (req.headers['x-tsuzuri-token'] !== token) {
      res.writeHead(403);
      res.end();
      return false;
    }
    return true;
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const server = http.createServer((req, res) => {
    // 监听端口在 listen() 之后才确定,这里从连接的本地端口读取,
    // 与调用方实际调用 server.listen() 时使用的端口一致。
    const port = req.socket.localPort;
    if (!isAllowedHost(req.headers.host, port)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && !isJobPostRoute(req.method, url.pathname)) {
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      if (!checkToken(req, res)) return;
      readBody(req)
        .then(async (raw) => {
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            sendJson(res, {status: 400, body: {error: '请求体不是合法 JSON'}});
            return;
          }
          const safeFolder = resolveSafePath(root, body?.folder);
          if (safeFolder === null) {
            res.writeHead(403);
            res.end();
            return;
          }
          // resolveSafePath 只管越界,不管目标是不是目录——不带 folder 启动时沙箱根是
          // 整个用户主目录,不校验的话可以对任意子目录(甚至文件)起任务。
          let isDirectory;
          try {
            isDirectory = fs.statSync(safeFolder).isDirectory();
          } catch {
            isDirectory = false;
          }
          if (!isDirectory) {
            sendJson(res, {status: 400, body: {error: 'folder 不是一个存在的目录'}});
            return;
          }
          try {
            const result = jobManager.createJob({kind: body?.kind, folder: safeFolder, options: body?.options});
            if (result.error === 'busy') {
              sendJson(res, {status: 409, body: {error: '已有任务在执行,请等待完成'}});
              return;
            }
            sendJson(res, {status: 201, body: {id: result.id}});
          } catch (error) {
            if (error instanceof JobValidationError) {
              sendJson(res, {status: 400, body: {error: error.message, field: error.field}});
              return;
            }
            throw error;
          }
        })
        .catch(() => sendJson(res, {status: 500, body: {error: '创建任务失败'}}));
      return;
    }
    if (req.method === 'POST' && JOB_CANCEL_RE.test(url.pathname)) {
      if (!checkToken(req, res)) return;
      const [, id] = url.pathname.match(JOB_CANCEL_RE);
      const ok = jobManager.cancelJob(id);
      sendJson(res, ok ? {status: 200, body: {ok: true}} : {status: 404, body: {error: '任务不存在或已结束'}});
      return;
    }
    if (req.method === 'GET' && JOB_EVENTS_RE.test(url.pathname)) {
      const [, id] = url.pathname.match(JOB_EVENTS_RE);
      // 必须先判断任务是否存在、再 writeHead——subscribeEvents 对历史事件是
      // *同步回放* 的(见 jobs.mjs),如果先订阅再 writeHead,历史事件的
      // res.write() 会发生在 writeHead 之前,Node 隐式发出默认响应头,随后的
      // writeHead 抛 ERR_HTTP_HEADERS_SENT,没人接住就是整个进程崩溃。
      if (!jobManager.getJob(id)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // writeHead 不会立即把响应头刷到 socket——Node 默认等到第一次 write() 才
      // 真正发送,SSE 场景下可能长时间没有事件,客户端会一直卡在等响应头上,
      // 必须显式 flush 一次,让连接尽早建立起来。
      res.flushHeaders();
      const unsubscribe = jobManager.subscribeEvents(id, (chunk) => {
        res.write(chunk);
        // 任务已经结束(subscribeEvents 立即补发 end 帧,或订阅期间任务跑完了)
        // 服务端主动关闭连接——否则只能靠浏览器主动 close,curl 之类的客户端
        // 会永久挂在这个连接上。
        if (chunk.startsWith('event: end\n')) res.end();
      });
      // 客户端断开(切页面/关标签页)时必须解除订阅,否则任务管理器里的监听者
      // 集合会一直攒着一个再也不会被调用的回调,直到任务结束才清空——长任务
      // 场景下会造成持续的内存泄漏。
      req.on('close', unsubscribe);
      return;
    }
    if (req.method === 'GET' && JOB_ID_RE.test(url.pathname)) {
      const [, id] = url.pathname.match(JOB_ID_RE);
      const job = jobManager.getJob(id);
      sendJson(res, job ? {status: 200, body: job} : {status: 404, body: {error: '任务不存在'}});
      return;
    }
    if (url.pathname === '/api/dirs') {
      sendJson(res, listDirs(root, url.searchParams.get('path')));
      return;
    }
    if (url.pathname === '/api/project') {
      sendJson(res, getProject(root, url.searchParams.get('path')));
      return;
    }
    if (url.pathname === '/api/doctor') {
      sendJson(res, getDoctor());
      return;
    }
    if (url.pathname === '/api/exif') {
      // 唯一的异步 handler(exifr 解析)。失败一律回 500 而不是让 promise 逃逸,
      // 否则未捕获的 rejection 会连整个 server 一起带走。
      getExif(root, url.searchParams.get('path'))
        .then((result) => sendJson(res, result))
        .catch(() => sendJson(res, {status: 500, body: {error: '读取 EXIF 失败'}}));
      return;
    }
    if (url.pathname === '/media') {
      sendMedia(res, resolveMedia(root, url.searchParams.get('path'), req.headers.range));
      return;
    }
    if (url.pathname === '/api/thumb') {
      resolveThumb(root, url.searchParams.get('path'), url.searchParams.get('w'))
        .then((result) => sendMedia(res, result))
        .catch(() => sendMedia(res, {status: 500, body: '生成缩略图失败'}));
      return;
    }
    if (JOB_CANCEL_RE.test(url.pathname)) {
      // 走到这里说明路径形状是"取消任务"但方法不是 POST(POST 请求在上面已经被
      // 具体分支接住并 return 了)——不该把它当成 SPA 路由回退成页面。
      res.writeHead(405);
      res.end();
      return;
    }
    serveStatic(req, res, token);
  });
  // killAll 交给调用方在进程退出时收尾:子进程是 detached 的,收不到终端的
  // Ctrl+C,不显式杀掉就会变成孤儿继续跑(见 jobs.mjs 的说明)。
  return {server, token, killAll: jobManager.killAll};
};
