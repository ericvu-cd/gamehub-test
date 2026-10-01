/* =====================================================================
   平台＋所有任務共用的 Service Worker（放在網站根目錄，範圍涵蓋平台、
   /6htw/、/tasks/ 底下所有頁面）

   快取策略：
   - 程式與資料（HTML、JS、CSS、JSON、manifest）：每次先向伺服器拿最新版，
     拿不到（離線）才用手機裡存的舊版。確保程式修改、任務清單更新一上線就生效。
   - 圖片、音樂：先用手機裡存的版本立刻顯示，同時在背景向伺服器拿新版存起來，
     下次打開就是新的。換了同檔名的圖片不用手動改版本號，最多玩家晚一次才看到新圖。
   - 背景影片（mp4 等）：完全不經過這支程式。iPhone 播影片是分段下載，
     存進快取後很容易播不出來，交給瀏覽器照原本方式處理。
   - 其他網域的請求（Firebase、Google 字型等）、管理後台：一律不經手。

   新增任務時不用修改這支程式：檔案是「第一次用到才存」，沒有固定清單要維護。
   只有改變上面的快取策略本身時，才需要把 CACHE_NAME 的版本號加一，
   舊版快取會在新版啟用時自動清掉。
   ===================================================================== */

const CACHE_PREFIX = 'gamehub-';
const CACHE_NAME = CACHE_PREFIX + 'runtime-v1';

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|mp3|m4a|aac|ogg|wav|woff2?|ttf)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

self.addEventListener('install', () => {
    self.skipWaiting(); // 新版程式下載好就接手，不用等玩家把所有分頁關掉
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
            .map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;   // 其他網域：不經手
    if (url.pathname.includes('/admin/')) return;       // 管理後台：永遠直接連線
    if (VIDEO_EXT.test(url.pathname)) return;           // 影片：不經手

    if (MEDIA_EXT.test(url.pathname)) {
        if (request.headers.has('range')) {
            event.respondWith(serveRange(request, event));   // 分段請求（音樂播放常見）
        } else {
            event.respondWith(staleWhileRevalidate(request, event));
        }
        return;
    }

    event.respondWith(networkFirst(request));
});

function isCacheable(response) {
    return response && response.status === 200 && response.type === 'basic';
}

// 程式與資料：先拿最新，離線才用快取
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (isCacheable(response)) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

// 圖片音樂：先用快取立刻顯示，背景更新
async function staleWhileRevalidate(request, event) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const update = fetch(request).then(response => {
        if (isCacheable(response)) cache.put(request, response.clone());
        return response;
    }).catch(() => null);

    if (cached) {
        event.waitUntil(update);
        return cached;
    }
    const response = await update;
    return response || Response.error();
}

// 分段請求：瀏覽器播放音樂時常只要檔案的某一段（Range），
// 快取裡有完整檔案就切出那一段回傳；還沒快取過就這次照常走網路，
// 同時在背景把完整檔案存起來，下次就能從快取播放。
async function serveRange(request, event) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request.url);
    if (!cached) {
        event.waitUntil(cache.add(request.url).catch(() => {}));
        return fetch(request);
    }

    const buffer = await cached.arrayBuffer();
    const total = buffer.byteLength;
    const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
    let start = 0, end = total - 1;
    if (match) {
        if (match[1] === '' && match[2] !== '') {        // bytes=-500：最後 500 位元組
            start = Math.max(0, total - parseInt(match[2], 10));
        } else {
            if (match[1] !== '') start = parseInt(match[1], 10);
            if (match[2] !== '') end = Math.min(parseInt(match[2], 10), total - 1);
        }
    }
    if (start >= total || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    return new Response(buffer.slice(start, end + 1), {
        status: 206,
        headers: {
            'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes'
        }
    });
}
