/* ============================================================
 * 读谱训练器 — Service Worker
 *
 * 策略：应用外壳「预缓存 + 缓存优先、网络更新」；导航请求「网络优先、失败回退缓存」。
 * 只拦截本源的 GET 请求；file: 以及其它非 http(s) 协议一律放行不拦截。
 * 本项目零依赖、不联网，因此不存在需要缓存的第三方资源。
 *
 * 版本号：修改以下 VERSION 会让 activate 阶段清掉旧缓存，
 *        用户下次打开即为新版本（也可以由构建脚本改写）。
 * ============================================================ */

'use strict';

const VERSION = 'v2';
const CACHE_NAME = 'yuedu-trainer-' + VERSION;

/* 需要预缓存的应用外壳（脚本顺序与 index.html 一致） */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/core/util.js',
  './src/core/theory.js',
  './src/core/generator.js',
  './src/core/renderer.js',
  './vendor/vexflow.js',
  './src/core/vexrender.js',
  './src/core/jianpu.js',
  './src/audio/tuner.js',
  './src/audio/engine.js',
  './src/data/instruments.js',
  './src/export/exporter.js',
  './src/features/library.js',
  './src/features/ear.js',
  './src/features/practice.js',
  './src/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* ---------------- install：预缓存 ---------------- */
self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_NAME);
    try {
      /* 首选批量预缓存；只要有任意一个 404 就会整体失败 */
      await cache.addAll(APP_SHELL);
    } catch (err) {
      /* 容错：逐个重试，用 allSettled 容忍个别文件缺失（例如尚未写完的模块） */
      const results = await Promise.allSettled(APP_SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }));
      }));
      const failed = results.filter(function (r) { return r.status === 'rejected'; }).length;
      if (failed) {
        console.warn('[sw] 预缓存有 ' + failed + ' 项失败（已忽略，其余仍可用）');
      }
    }
    await self.skipWaiting();
  })());
});

/* ---------------- activate：清理旧版本缓存 ---------------- */
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.map(function (name) {
      if (name.indexOf('yuedu-trainer-') === 0 && name !== CACHE_NAME) {
        console.log('[sw] 清理旧缓存：' + name);
        return caches.delete(name);
      }
      return Promise.resolve(false);
    }));
    await self.clients.claim();
  })());
});

/* ---------------- 工具 ---------------- */
function isCacheable(request) {
  if (!request || request.method !== 'GET') return false;
  let url;
  try { url = new URL(request.url); } catch (e) { return false; }
  /* 只处理 http / https；file: 与其它协议一律放行 */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  /* 只处理同源；第三方资源不缓存 */
  if (url.origin !== self.location.origin) return false;
  return true;
}

/* 网络优先：用于导航（HTML 文档）请求 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type !== 'opaque') {
      cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    const cached = (await cache.match(request)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>离线</title></head>' +
      '<body style="background:#0f1420;color:#e8eefc;font:16px/1.8 system-ui,sans-serif;padding:32px">' +
      '<h1>当前处于离线状态</h1><p>应用外壳尚未缓存成功，请连网后重新打开一次。</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* 缓存优先、网络更新：用于静态资源 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then(function (res) {
    if (res && res.ok && res.type !== 'opaque') cache.put(request, res.clone());
    return res;
  }).catch(function () { return null; });

  if (cached) {
    /* 后台顺带更新，不阻塞本次响应 */
    network.catch(function () {});
    return cached;
  }
  const res = await network;
  if (res) return res;
  return new Response('离线且无缓存：' + new URL(request.url).pathname, {
    status: 504,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

/* ---------------- fetch：只拦截同源 GET ---------------- */
self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (!isCacheable(request)) return; /* 放行：非 GET / 非 http(s) / 跨源 */

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
