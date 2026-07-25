/**
 * 本地网页工作台 server:Node 原生 http,不引入 express。
 * 五个 API(dirs / project / doctor / exif / thumb)+ 媒体透传(media)+ 静态前端
 * (`web/dist`,未构建时回退占位页)。除 /api/thumb 会往系统临时目录写缩略图缓存外,
 * 全部只读,不碰用户的素材夹。
 * `root` 是路径沙箱的允许根目录,由 cli/web.mjs 决定(锁定素材夹或用户主目录)。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {listDirs} from './web-api/dirs.mjs';
import {getDoctor} from './web-api/doctor.mjs';
import {getExif} from './web-api/exif.mjs';
import {getProject} from './web-api/project.mjs';
import {resolveMedia} from './web-api/media.mjs';
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

const serveStatic = (req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(STATIC_DIR, urlPath);
  // 静态资源只在 web/dist 内,不接受外部路径(简单前缀校验,已经是构建产物无用户输入)
  if (!filePath.startsWith(STATIC_DIR + path.sep) && filePath !== STATIC_DIR) {
    res.writeHead(403);
    res.end();
    return;
  }
  // web/dist 整个还没构建时,保持占位页兜底,不区分路径
  if (!isDistBuilt()) {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(PLACEHOLDER_HTML);
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(res, filePath);
    return;
  }
  // 已构建但没命中:带静态资源扩展名的路径确实是 404,其余(SPA 路由)回退到 index.html
  if (path.extname(urlPath) && STATIC_MIME_TYPES[path.extname(urlPath).toLowerCase()]) {
    res.writeHead(404);
    res.end();
    return;
  }
  serveFile(res, INDEX_HTML);
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

/**
 * @param {string} root 路径沙箱允许的根目录(绝对路径)
 * @returns {import('node:http').Server}
 */
export const createGalleryServer = (root) => {
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
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
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
    serveStatic(req, res);
  });
  return server;
};
