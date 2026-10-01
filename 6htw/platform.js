/* ═══════════════════════════════════════════════════════════════════════
   platform.js — 與遊戲平台的通訊層
   《友魚守護團：台灣海線任務》接入平台任務系統

   依「任務頁面通訊介面規格.md」實作：
     任務 → 平台：ready / complete / score / exit
     平台 → 任務：player_info（回應 ready）／ack（回應 complete）

   ⚠️ TASK_ID 必須跟後台「任務」分頁設定的這個任務的 ID 完全一致，
      平台用它在 openTaskWindows 裡找到對應視窗記錄。目前先填一個預設值，
      後台實際建立這個任務時如果 ID 不同，只要改這裡這一行即可。
   ═══════════════════════════════════════════════════════════════════════ */

const TASK_ID = '6htw';

// 平台徽章 ID 前綴：漁港章／行為勳章／魚紋章 這三類會同步成平台徽章
// （同伴章／難度章／勝場數 平台沒有對應資料可存，只在本次連線內累計，見 main.js 的 progress 物件）
const BADGE_PREFIX = {
    harbor: '6htw_harbor_',
    behavior: '6htw_behavior_',
    fish: '6htw_fish_'
};

function platformBadgeId(category, name) {
    return BADGE_PREFIX[category] + name;
}

const PLATFORM = {
    // ⚠️ 不能只看 window.opener——桌機/寬螢幕模式下，index.html 是被 desktop.html
    // 用 <iframe> 包起來執行的（見 index.html 開頭的寬螢幕自動導向邏輯）。iframe 屬於
    // 「巢狀框架」，跟 window.open() 開出來的「彈出視窗」是完全不同的兩件事，
    // iframe 裡的 window.opener 永遠是 null，不會繼承外層視窗的 opener。
    // window.top 在這種情境下會正確指向 desktop.html 自己的視窗，那個視窗才是
    // 真正被平台用 window.open() 開出來的，它的 .opener 才指得回平台。這裡只是
    // 用來判斷「連線鏈路上有沒有一個 opener 存在」，不代表送訊息時可以直接
    // postMessage 到這個對象上（見下面 sendToPlatform 的說明）。
    connected: (typeof window !== 'undefined' && !!(window.top || window).opener),
    ready: false,           // 是否已收到 player_info
    nickname: null,
    badgeIds: [],           // 平台回傳的「玩家擁有的全部徽章」（不分任務）
    myScore: null,          // 這個任務目前的個人最佳分數，沒玩過是 null
    _readyCallbacks: []
};

// 註冊「收到 player_info 後」要執行的函式；若已經收到過，立刻執行。
PLATFORM.onReady = function (fn) {
    if (PLATFORM.ready) fn();
    else PLATFORM._readyCallbacks.push(fn);
};

function _flushReadyCallbacks() {
    PLATFORM.ready = true;
    const cbs = PLATFORM._readyCallbacks.slice();
    PLATFORM._readyCallbacks.length = 0;
    cbs.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
}

// 送訊息給平台（任務頁面 → 平台的信封格式）。沒有 opener（直接用瀏覽器打開測試）就不送。
//
// ⚠️ 這裡不能用 (window.top || window).opener.postMessage(...) 直接「跳過」desktop.html
// 這層送給平台——postMessage 送出的訊息，接收端看到的 event.source 永遠是「實際執行這行
// 程式碼的視窗本身」，不會因為你是透過 window.top.opener 這種方式間接摸到平台視窗，
// event.source 就變成 window.top。這裡的程式碼是在 iframe 自己的執行環境裡跑的，
// 平台收到時 event.source 會是 iframe 自己，跟平台記錄的「window.open() 開出來的視窗」
// （也就是 desktop.html）對不上，會被平台的安全檢查判定「視窗物件不一致」直接忽略——
// 訊息確實送得到，但因為身分核對不過，等於白送。
//
// 正確做法：iframe 只送給自己的上一層（window.parent），如果目前不是在 iframe 裡
// （手機直接開，沒有套桌機外框），window.parent 就是 window 自己，效果等同直接送給
// window.opener。真正需要「轉發給平台」這個動作，交給 desktop.html 自己執行
// window.opener.postMessage(...)——那才是真正被平台開出來的視窗，這樣平台收到時
// event.source 才會正確對得上。
function sendToPlatform(type, payload) {
    if (!PLATFORM.connected) { console.log('[platform] (測試模式，未連接平台) ' + type, payload); return; }
    const msg = { source: 'culture-task', version: 1, taskId: TASK_ID, type: type };
    if (payload !== undefined) msg.payload = payload;
    const target = (window.self !== window.top) ? window.parent : window.opener;
    target.postMessage(msg, '*');
}

// 小提示 Toast：優先用 welcome-screen.js 已有的 wsShowToast，沒有的話退回 console。
function _platformToast(msg) {
    if (typeof window.wsShowToast === 'function') window.wsShowToast(msg, 2400);
    else console.log('[platform] ' + msg);
}

/* ── 監聽平台回傳的訊息 ── */
window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || data.source !== 'culture-platform') return; // 過濾不相關訊息

    if (data.type === 'player_info') {
        const p = data.payload || {};
        PLATFORM.nickname = p.nickname || '守護員';
        PLATFORM.badgeIds = Array.isArray(p.badges) ? p.badges : [];
        PLATFORM.myScore = (p.myScore && typeof p.myScore.scoreValue === 'number') ? p.myScore.scoreValue : null;
        _flushReadyCallbacks();
    } else if (data.type === 'ack' && data.forType === 'complete') {
        const r = data.result || {};
        const parts = [];
        if (r.coinsAwarded) parts.push('+' + r.coinsAwarded + ' 金幣');
        if (r.badgesAwarded && r.badgesAwarded.length) parts.push('新徽章 x' + r.badgesAwarded.length);
        if (parts.length) _platformToast('🎉 ' + parts.join('，'));
        else if (r.rejectedReason) console.log('[platform] 金幣未發放：' + r.rejectedReason);
    }
});

/* ── 任務 → 平台：ready（頁面準備好時發送一次） ── */
function sendReady() {
    sendToPlatform('ready');
}

/* ── 任務 → 平台：complete（發放獎勵；每個新徽章各自送一次，符合規格建議） ──
   coins：這次要發放的金幣數；badgeId：選填，單一徽章 ID。 */
function reportComplete(coins, badgeId) {
    const payload = {};
    if (coins) payload.coins = coins;
    if (badgeId) payload.badgeIds = [badgeId];
    sendToPlatform('complete', payload);
}

// 把「本局新解鎖」的漁港章／行為勳章／魚紋章，合併成同一則 complete 訊息一次送出
// （不要拆成一枚一枚各自送——拆開送會變成好幾次「各自獨立」的訊息處理，彼此併發
// 搶著讀寫同一份使用者文件，就是先前「解鎖3個徽章、只有1個真的存進後台」的成因。
// 合併成一則之後，後台 tasks.js 是用 for...await 依序處理同一則訊息裡的 badgeIds，
// 不會有併發問題）。
// 首次取得各類徽章的金幣：漁港章 +3、魚紋章 +1、行為勳章 +8（數量多、門檻低，
// 單枚價值低一點；行為勳章要達成特定條件才拿得到，價值最高）。
// coins 上限抓 MAX_SINGLE_TX()=50（跟 firestore.rules 一致），一次解鎖很多枚時
// 金幣會被封頂，不會因為超過單筆上限被後台拒絕整筆。
const BADGE_COIN_VALUE = { harbor: 3, fish: 1, behavior: 8 };

function reportNewBadges(newlyUnlocked, extraCoins) {
    const harborIds = (newlyUnlocked.badges || []).map(function (n) { return platformBadgeId('harbor', n); });
    const behaviorIds = (newlyUnlocked.behaviorBadges || []).map(function (n) { return platformBadgeId('behavior', n); });
    const fishIds = (newlyUnlocked.fish || []).map(function (n) { return platformBadgeId('fish', n); });
    const ids = [].concat(harborIds, behaviorIds, fishIds);

    const badgeCoins = harborIds.length * BADGE_COIN_VALUE.harbor
        + fishIds.length * BADGE_COIN_VALUE.fish
        + behaviorIds.length * BADGE_COIN_VALUE.behavior;
    const coins = Math.min(badgeCoins + (extraCoins || 0), 50);
    if (ids.length === 0 && coins <= 0) return ids;
    sendToPlatform('complete', coins > 0 ? { coins: coins, badgeIds: ids } : { badgeIds: ids });
    return ids;
}

/* ── 任務 → 平台：score（排行榜分數） ──
   只有比目前已知的個人最佳分數更高，才會真的送出；平台那邊本來就會再擋一次比大小。
   破紀錄的 +1 金幣不在這裡送，是合併進 win-screen.js 那則 complete 訊息裡一起送出
   （理由見 platform.js 上面 reportNewBadges 的註解——避免又多一則訊息造成併發衝突）。 */
function reportScoreIfHigher(totalScore) {
    if (typeof totalScore !== 'number') return;
    const isFirstTime = PLATFORM.myScore === null;
    if (!isFirstTime && totalScore <= PLATFORM.myScore) return;

    sendToPlatform('score', { scoreLabel: totalScore + ' 分', scoreValue: totalScore });
    PLATFORM.myScore = totalScore; // 樂觀更新本地暫存的「目前最佳」，讓同一個連線內下一局比較基準跟著變
}

/* ── 任務 → 平台：exit（離開任務，回平台） ── */
function exitToPlatform() {
    sendToPlatform('exit');
    // postMessage 是非同步的，如果送完立刻同步關閉視窗，桌機外框模式下這則 exit
    // 訊息還要多轉一手（iframe → window.parent → 轉發給平台），視窗有可能在轉發
    // 完成前就被關掉，導致平台收到訊息時記錄已經被判定失效（其他任務實測遇過
    // 「exit 訊息但查無記錄」的警告）。延遲一小段時間再關閉，確保訊息有時間走完整趟轉發。
    // 桌機外框模式下要關的是 window.top（desktop.html 那個真正的視窗），
    // 不是這個 iframe 自己——iframe 沒有「關閉自己」這回事，window.close()
    // 對 iframe 呼叫不會有任何效果。
    if (PLATFORM.connected) setTimeout(function () { (window.top || window).close(); }, 150);
}

// 遊戲進行中按下「返回」：先二次確認，避免手滑中斷正在進行的一局。
function confirmExitDuringGame() {
    if (window.confirm('確定要離開任務、返回平台嗎？\n目前這一局的進度不會被保留。')) {
        exitToPlatform();
    }
}

// 結算畫面的「關閉」按鈕：不需要二次確認（已經是結算畫面，沒有進行中的局要中斷）。
function closeTaskToPlatform() {
    exitToPlatform();
}

// ── 攔截瀏覽器「上一頁」（含手機滑動返回手勢）：不要讓它直接把分頁導覽走 ──
// 原理：先塞一筆假的瀏覽紀錄，使用者按上一頁時只會觸發 popstate（不會真的離開），
// 這時候把假紀錄補回去、跳我們自己的確認視窗；確定要走才真的送 exit + 關閉分頁。
if (typeof window !== 'undefined' && window.history && window.history.pushState) {
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', function () {
        history.pushState(null, '', location.href); // 補回一筆，擋住這次「上一頁」
        if (typeof confirmExitDuringGame === 'function') confirmExitDuringGame();
    });
}

window.PLATFORM = PLATFORM;
window.platformBadgeId = platformBadgeId;
window.reportNewBadges = reportNewBadges;
window.reportScoreIfHigher = reportScoreIfHigher;
window.exitToPlatform = exitToPlatform;
window.confirmExitDuringGame = confirmExitDuringGame;
window.closeTaskToPlatform = closeTaskToPlatform;

// 頁面載入完成即回報 ready（監聽器已經在上面掛好，不會漏接 player_info）。
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendReady);
} else {
    sendReady();
}
