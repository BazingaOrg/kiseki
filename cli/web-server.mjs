/** 本地工作台 HTTP 服务。所有文件与任务路由都受 root 沙箱约束。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {listDirs} from './web-api/dirs.mjs';
import {createDoctorService} from './web-api/doctor.mjs';
import {getExif} from './web-api/exif.mjs';
import {resetFetchState, searchAudioCandidates, searchLyricsCandidates, saveLyrics, validateLyricsCandidate} from './web-api/fetch.mjs';
import {createJobManager, JobValidationError} from './web-api/jobs.mjs';
import {AssetMutationError, clearRecognizedLyrics, mutateAsset, resetAssetMutationState, undoAssetDelete} from './web-api/assets.mjs';
import {getProject} from './web-api/project.mjs';
import {resolveMedia} from './web-api/media.mjs';
import {resolveSafePath} from './web-api/sandbox.mjs';
import {resolveThumb} from './web-api/thumb.mjs';
import {sourceRuntimeLayout} from './runtime-layout.mjs';
import {createImmutableRootController, createWriteActivityGate} from './root-controller.mjs';


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
  '<!doctype html><html><head><meta charset="utf-8"><title>kiseki 工作台</title></head>' +
  '<body style="font-family: sans-serif; padding: 2rem;">' +
  '<h1>kiseki 本地工作台</h1>' +
  '<p>前端页面尚未构建。API 已就绪:/api/dirs、/api/project、/media。</p>' +
  '</body></html>';

const sendJson = (res, {status, body}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(payload);
};

const sendMedia = (res, result, createReadStream = fs.createReadStream) => {
  if (result.status >= 400) {
    res.writeHead(result.status, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(result.body);
    return;
  }
  res.writeHead(result.status, result.headers);
  if (result.status === 304) {
    res.end();
    return;
  }
  const stream = createReadStream(result.streamPath, result.streamOptions);
  stream.on('error', () => res.end());
  stream.pipe(res);
};

const isDistBuilt = (staticDir) => {
  const indexHtml = path.join(staticDir, 'index.html');
  return fs.existsSync(indexHtml) && fs.statSync(indexHtml).isFile();
};

const staticEtag = (filePath) => {
  const {size, mtimeNs} = fs.statSync(filePath, {bigint: true});
  return `"${size}-${mtimeNs}"`;
};

const serveFile = (req, res, filePath, assetsDir) => {
  const contentType = STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const headers = {'Content-Type': contentType};
  if (filePath.startsWith(assetsDir + path.sep)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else {
    headers['Cache-Control'] = 'private, no-cache';
    let etag = null;
    try { etag = staticEtag(filePath); } catch {}
    if (etag !== null) {
      headers.ETag = etag;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, {'Cache-Control': 'private, no-cache', ETag: etag});
        res.end();
        return;
      }
    }
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
};

/**
 * index.html 需要在返回前注入任务 API 用的 token，因此不能直接流式返回。
 * HTML 不缓存:token 每次启动都换,且它引用的哈希资源必须能立刻切换到新版本.
 */
const serveIndexHtml = (res, token, indexHtml) => {
  const html = fs.readFileSync(indexHtml, 'utf8');
  const escapedToken = token.replaceAll('"', '&quot;');
  const withToken = html.replace('</head>', `<meta name="kiseki-token" content="${escapedToken}">\n</head>`);
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache'});
  res.end(withToken);
};

const serveStatic = (req, res, token, staticDir) => {
  const indexHtml = path.join(staticDir, 'index.html');
  const assetsDir = path.join(staticDir, 'assets');
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(staticDir, urlPath);
  if (!filePath.startsWith(staticDir + path.sep) && filePath !== staticDir) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!isDistBuilt(staticDir)) {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(PLACEHOLDER_HTML);
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (filePath === indexHtml) {
      serveIndexHtml(res, token, indexHtml);
      return;
    }
    serveFile(req, res, filePath, assetsDir);
    return;
  }
  if (path.extname(urlPath) && STATIC_MIME_TYPES[path.extname(urlPath).toLowerCase()]) {
    res.writeHead(404);
    res.end();
    return;
  }
  serveIndexHtml(res, token, indexHtml);
};

/**
 * 校验请求的 Host 头,只允许 localhost/127.0.0.1 加上 server 实际监听的端口.
 * server 只绑定 127.0.0.1,理论上外部拿不到直连,但攻击者网页可用 DNS
 * rebinding 把自己的域名重新解析到 127.0.0.1,浏览器就会带着"同源"的假象
 * 发起请求——不校验 Host 就会让这类页面读到 home 目录下的任意文件.
 * @param {string} hostHeader req.headers.host
 * @param {number} port server 实际监听的端口
 * @returns {boolean}
 */
const isAllowedHost = (hostHeader, port) =>
  hostHeader === `localhost:${port}` || hostHeader === `127.0.0.1:${port}`;

const JOB_ID_RE = /^\/api\/jobs\/([^/]+)$/;
const JOB_EVENTS_RE = /^\/api\/jobs\/([^/]+)\/events$/;
const JOB_CANCEL_RE = /^\/api\/jobs\/([^/]+)\/cancel$/;
const ASSET_UNDO_RE = /^\/api\/assets\/undo$/;
const CLEAR_RECOGNIZED_LYRICS_RE = /^\/api\/assets\/recognized-lyrics\/clear$/;
const VALIDATE_LYRICS_PATH = '/api/fetch/lyrics-validate';

// 仅这些路径接受 POST；其他方法必须在进入 SPA fallback 前被拒绝。
const isAllowedPostRoute = (method, pathname) =>
  method === 'POST'
  && (pathname === '/api/jobs' || pathname === '/api/fetch/lyrics' || pathname === VALIDATE_LYRICS_PATH || pathname === '/api/assets/mutate' || ASSET_UNDO_RE.test(pathname) || CLEAR_RECOGNIZED_LYRICS_RE.test(pathname) || JOB_CANCEL_RE.test(pathname));

/**
 * @param {string} root 路径沙箱允许的根目录(绝对路径)
 * @param {{spawnImpl?: Function, runImpl?: Function, doctorGet?: Function, thumbDeps?: object, createReadStream?: Function, jobManagerDeps?: object, assetMutationDeps?: object}} [deps]
 *   spawnImpl 供测试注入假的子进程实现,避免单测真的起渲染进程;
 *   runImpl 同理注入 /api/fetch/* 用的异步进程执行器,避免单测真的联网.
 *   doctorGet 可注入 doctor service,避免路由测试依赖本机的外部命令.
 *   jobManagerDeps 仅供 HTTP 路由测试注入 lease/liveness 等任务依赖.
 *   assetMutationDeps 仅供 HTTP 路由测试注入资产变更 lease 依赖.
 *   生产环境两个都不传.
 * @returns {{server: import('node:http').Server, token: string}}
 */
export const createGalleryServer = (root, {spawnImpl, runImpl, doctorGet, thumbDeps, createReadStream, jobManagerDeps, assetMutationDeps, runtime = sourceRuntimeLayout, commandResolver} = {}) => {
  const rootController = typeof root === 'string' ? createImmutableRootController(root) : root;
  const writeGate = createWriteActivityGate();
  let closing = false;
  const fetchDeps = {...(runImpl ? {run: runImpl} : {}), runtime, ...(commandResolver ? {commandResolver} : {})};
  const requestDoctor = doctorGet ?? createDoctorService({runtime}).getDoctor;
  const token = crypto.randomBytes(32).toString('hex');
  const jobManager = createJobManager({...jobManagerDeps, ...(spawnImpl ? {spawnImpl} : {}), runtime, ...(commandResolver ? {commandResolver} : {})});

  const checkToken = (req, res) => {
    if (req.headers['x-kiseki-token'] !== token) {
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
    const port = req.socket.localPort;
    if (!isAllowedHost(req.headers.host, port)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (closing && (req.method !== 'GET' || url.pathname.startsWith('/api/'))) { sendJson(res, {status: 503, body: {error: '服务正在关闭'}}); return; }
    if (req.method !== 'GET' && !isAllowedPostRoute(req.method, url.pathname)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const rootlessRoute = req.method === 'GET' && (url.pathname === '/api/doctor' || (!url.pathname.startsWith('/api/') && url.pathname !== '/media'));
    let root = null;
    if (!rootlessRoute) {
      try { root = rootController.getSnapshot().path; } catch {
        sendJson(res, {status: 409, body: {error: '项目根目录不可用'}});
        return;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      if (!checkToken(req, res)) return;
      const releaseWrite = writeGate.enter();
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
          // 整个用户主目录,不校验的话可以对任意子目录(甚至文件)起任务.
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
        .catch(() => sendJson(res, {status: 500, body: {error: '创建任务失败'}}))
        .finally(releaseWrite);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/fetch/lyrics') {
      if (!checkToken(req, res)) return;
      const releaseWrite = writeGate.enter();
      readBody(req)
        .then((raw) => {
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            sendJson(res, {status: 400, body: {error: '请求体不是合法 JSON'}});
            return null;
          }
          // folder 的沙箱校验在 saveLyrics 内部统一做(与 GET 端点同一条路径).
          return saveLyrics(root, body, {...fetchDeps, isJobRunning: jobManager.hasRunningJob}).then((result) => sendJson(res, result));
        })
        .catch(() => sendJson(res, {status: 500, body: {error: '保存歌词失败'}}))
        .finally(releaseWrite);
      return;
    }
    if (req.method === 'POST' && url.pathname === VALIDATE_LYRICS_PATH) {
      if (!checkToken(req, res)) return;
      readBody(req)
        .then((raw) => {
          let body;
          try { body = JSON.parse(raw); } catch {
            sendJson(res, {status: 400, body: {error: '请求体不是合法 JSON'}});
            return null;
          }
          return validateLyricsCandidate(root, body, {...fetchDeps, isJobRunning: jobManager.hasRunningJob}).then((result) => sendJson(res, result));
        })
        .catch(() => sendJson(res, {status: 500, body: {error: '时间轴校验失败'}}));
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/assets/mutate' || ASSET_UNDO_RE.test(url.pathname) || CLEAR_RECOGNIZED_LYRICS_RE.test(url.pathname))) {
      if (!checkToken(req, res)) return;
      const releaseWrite = writeGate.enter();
      readBody(req)
        .then((raw) => {
          let body;
          try { body = JSON.parse(raw); } catch {
            sendJson(res, {status: 400, body: {error: '请求体不是合法 JSON'}});
            return;
          }
          const folder = resolveSafePath(root, body?.folder);
          if (!folder) {
            sendJson(res, {status: 403, body: {error: '路径越界或无效'}});
            return;
          }
          try {
            if (!fs.statSync(folder).isDirectory()) throw new Error('not directory');
          } catch {
            sendJson(res, {status: 400, body: {error: 'folder 不是一个存在的目录'}});
            return;
          }
          try {
            const data = url.pathname === '/api/assets/mutate'
              ? mutateAsset({...assetMutationDeps, folder, assetId: body?.assetId, action: body?.action, stem: body?.stem, isJobRunning: jobManager.hasRunningJob})
              : ASSET_UNDO_RE.test(url.pathname)
                ? undoAssetDelete({...assetMutationDeps, folder, undoId: body?.undoId, isJobRunning: jobManager.hasRunningJob})
                : clearRecognizedLyrics({...assetMutationDeps, folder, isJobRunning: jobManager.hasRunningJob});
            sendJson(res, {status: 200, body: data});
          } catch (error) {
            if (error instanceof AssetMutationError) {
              const recoveryUndoId = typeof error.details?.recoveryUndoId === 'string' ? error.details.recoveryUndoId : undefined;
              const recoveryRequired = error.details?.recoveryRequired === true ? true : undefined;
              sendJson(res, {status: error.status, body: {error: error.message, ...(recoveryUndoId ? {recoveryUndoId} : {}), ...(recoveryRequired ? {recoveryRequired} : {})}});
              return;
            }
            sendJson(res, {status: 500, body: {error: '文件操作失败'}});
          }
        })
        .catch(() => sendJson(res, {status: 500, body: {error: '文件操作失败'}}))
        .finally(releaseWrite);
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
      // writeHead 抛 ERR_HTTP_HEADERS_SENT,没人接住就是整个进程崩溃.
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
      // 必须显式 flush 一次,让连接尽早建立起来.
      res.flushHeaders();
      const unsubscribe = jobManager.subscribeEvents(id, (chunk) => {
        res.write(chunk);
        // 任务已经结束(subscribeEvents 立即补发 end 帧,或订阅期间任务跑完了)
        // 服务端主动关闭连接——否则只能靠浏览器主动 close,curl 之类的客户端
        // 会永久挂在这个连接上.
        if (chunk.startsWith('event: end\n')) res.end();
      });
      // 客户端断开(切页面/关标签页)时必须解除订阅,否则任务管理器里的监听者
      // 集合会一直攒着一个再也不会被调用的回调,直到任务结束才清空——长任务
      // 场景下会造成持续的内存泄漏.
      req.on('close', unsubscribe);
      return;
    }
    // 必须放在 JOB_ID_RE 判断之前:JOB_ID_RE 是 `/^\/api\/jobs\/([^/]+)$/`,
    // 会把 'current' 当成任意 job id 吃掉,这条更具体的路由排在后面就永远走不到.
    // 与 GET /api/jobs/:id/events 同为 GET,按既有约定不需要 token.
    if (req.method === 'GET' && url.pathname === '/api/jobs/current') {
      sendJson(res, {status: 200, body: {job: jobManager.getRunningJob()}});
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
      requestDoctor({refresh: url.searchParams.get('refresh') === '1'})
        .then((result) => sendJson(res, result))
        .catch(() => sendJson(res, {status: 500, body: {error: '检查环境失败'}}));
      return;
    }
    if (url.pathname === '/api/exif') {
      // 唯一的异步 handler(exifr 解析).失败一律回 500 而不是让 promise 逃逸,
      // 否则未捕获的 rejection 会连整个 server 一起带走.
      getExif(root, url.searchParams.get('path'))
        .then((result) => sendJson(res, result))
        .catch(() => sendJson(res, {status: 500, body: {error: '读取 EXIF 失败'}}));
      return;
    }
    // 这两条 GET 会 spawn 外部进程(yt-dlp / ffprobe / curl),所以**破例也要校验
    // token**.Host 校验只挡 DNS rebinding,挡不住任意网页直接请求 localhost ——
    // 那样一个页面就能无限起进程把机器拖垮.其余只读 GET 不需要这道闸.
    if (url.pathname === '/api/fetch/lyrics-search' || url.pathname === '/api/fetch/audio-search') {
      if (!checkToken(req, res)) return;
    }
    if (url.pathname === '/api/fetch/lyrics-search') {
      // 这几个 handler 都是异步的(外部进程走异步 spawn,不能阻塞单线程 server),
      // 与 /api/exif 一样必须自己接住 rejection,否则会连整个 server 一起带走.
      searchLyricsCandidates(root, url.searchParams.get('folder'), {...fetchDeps, query: url.searchParams.get('q')})
        .then((result) => sendJson(res, result))
        .catch(() => sendJson(res, {status: 500, body: {error: '搜索歌词失败'}}));
      return;
    }
    if (url.pathname === '/api/fetch/audio-search') {
      searchAudioCandidates(url.searchParams.get('q'), fetchDeps)
        .then((result) => sendJson(res, result))
        .catch(() => sendJson(res, {status: 500, body: {error: '搜索音频失败'}}));
      return;
    }
    if (url.pathname === '/media') {
      sendMedia(res, resolveMedia(root, url.searchParams.get('path'), req.headers.range), createReadStream);
      return;
    }
    if (url.pathname === '/api/thumb') {
      resolveThumb(root, url.searchParams.get('path'), url.searchParams.get('w'), req.headers['if-none-match'], {...thumbDeps, runtime})
        .then((result) => sendMedia(res, result, createReadStream))
        .catch(() => sendMedia(res, {status: 500, body: '生成缩略图失败'}, createReadStream));
      return;
    }
    if (JOB_CANCEL_RE.test(url.pathname) || url.pathname === '/api/fetch/lyrics' || url.pathname === VALIDATE_LYRICS_PATH || url.pathname === '/api/assets/mutate' || ASSET_UNDO_RE.test(url.pathname) || CLEAR_RECOGNIZED_LYRICS_RE.test(url.pathname)) {
      // 走到这里说明路径形状是"取消任务"/"保存歌词"但方法不是 POST(POST 请求在上面
      // 已经被具体分支接住并 return 了)——不该把它当成 SPA 路由回退成页面.
      res.writeHead(405);
      res.end();
      return;
    }
    serveStatic(req, res, token, runtime.webDist);
  });
  // killAll 交给调用方在进程退出时收尾:子进程是 detached 的,收不到终端的
  // Ctrl+C,不显式杀掉就会变成孤儿继续跑(见 jobs.mjs 的说明).
  return {server, token, killAll: jobManager.killAll, jobManager, rootController, writeGate, beginClosing: () => { closing = true; server.closeAllConnections?.(); }, resetRootState: () => {
    if (!resetAssetMutationState()) return false;
    jobManager.resetIdleState();
    resetFetchState();
    return true;
  }};
};
