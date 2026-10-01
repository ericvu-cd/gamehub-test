/* ═══════════════════════════════════════════════════════════════════════
   main.js — 遊戲核心邏輯
   《友魚守護團：台灣海線任務》卡牌遊戲主程式

   本檔案負責的功能（依出現順序）：
     1. 對話佇列 / 玩家收集進度（改接平台 player_info／complete，不用 localStorage）與成就勳章系統
     2. 開場故事、圖鑑說明、收集圖鑑等彈窗 UI
     3. 卡牌預覽、手牌與桌面渲染（renderUI / renderTable）
     4. 海洋背景特效（魚群、氣泡、海底光束動畫）
     5. 核心遊戲流程：抽召喚卡 → 玩家出牌 → AI 跟牌 → 結算 → 下一回合
     6. 媽祖贈牌（特殊事件卡）邏輯
     7. AI 出牌策略（依難度與角色個性調整出牌正確率）
     8. 出牌 / 退牌 / 贈牌的飛行動畫與回合結算彈窗
     9. 手機版手牌抽屜（Drawer）手勢與渲染
    10. 聯絡我們表單

   重要全域狀態（於檔案中段宣告，遊戲執行期間會持續被修改）：
     players      — 所有玩家陣列；players[0] 固定是真人玩家，其餘為 AI
     deckS        — 召喚卡牌堆（一般召喚卡 summonDB ＋ 媽祖卡 mazuCards 混合洗牌）
     table        — 本回合已出的牌，格式為 [{ pIdx, card }, ...]
     currentS     — 本回合抽到的召喚卡物件，currentS.c(fish) 可判斷某張魚是否符合條件
     callerIdx    — 本回合「召喚者」是 players 陣列中的第幾位（index）
     phase        — 遊戲狀態機，可能值：
                      "WAIT"         AI 抽到神秘召喚，等待揭曉
                      "PLAYER_TURN"  輪到玩家依召喚條件出牌
                      "PLAYER_MAZU"  輪到玩家依媽祖指示挑一張牌送人
                      "AI_FOLLOWING" 玩家出牌後，等待其餘 AI 跟牌
                      "RESULT"       本回合出牌已完成，等待結算畫面

   依賴的外部資料／函式（定義於同目錄其他檔案，需先於本檔載入）：
     db.js       — fishDB（魚卡資料）、summonDB／mazuCards（召喚卡）、
                   characterDB（AI 角色）、locationDB（漁港）、dialogueDB（AI 台詞）
     sfx.js      — SFX 音效物件
     win-screen.js — showWinScreen()

   ⚠️ 反向依賴（會被其他檔案動態改寫，修改時要留意）：
     tutorial.js 會在載入後整個覆蓋（monkey-patch）本檔案定義的
     playerAction()、confirmMazuGift()、showCardPreview() 三個函式，
     藉此插入新手教學邏輯。這代表：
       1) index.html 裡 tutorial.js 的 <script> 必須排在 main.js 之後。
       2) 若在本檔案修改這三個函式的名稱或參數簽名，tutorial.js 會悄悄
          失效（不會報錯，但新手教學會表現異常），務必同步檢查 tutorial.js。
   ═══════════════════════════════════════════════════════════════════════ */

// 預設難度：讀 db.js 的 difficultyDB 第一級（目前是「新手」0.4），
// 不在這裡寫死數字，難度設定要改就只改 db.js。
let gameDifficulty = difficultyDB[0].value;

// ── 對話排隊系統 ────────────────────────
// 同時間可能有多個 AI 想講話，若直接全部顯示會疊在畫面上互相覆蓋。
// 這裡用一個簡單佇列，依序「push 進來」→「每隔 _interval 毫秒顯示下一句」。
const chatQueue = {
    _q: [],
    _timer: null,
    _interval: 1800,

    push(p, msg) {
        this._q.push({ p, msg });
        if (!this._timer) this._flush();
    },

    _flush() {
        if (!this._q.length) { this._timer = null; return; }
        const { p, msg } = this._q.shift();
        showChat(p, msg);
        this._timer = setTimeout(() => this._flush(), this._interval);
    },

    clear() {
        this._q = [];
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    }
};

// ── 玩家收集進度系統（改接平台，不再用 localStorage） ──────────────────────────
// 關鍵原則：畫面上看到的「已收集」，一定要是「後台已經確定收到」的，不能是「本地剛
// 解鎖、還沒送出去」的——不然中途離開（例如按「返回」直接關閉分頁）會出現「畫面顯示
// 已收集，但後台其實沒存到」的落差。所以這裡分成兩份：
//   _confirmed → 已經送給平台、確定存到的部分（開局時用 player_info.badges 回填；
//                之後每次「這局結算」送出成功後，才會把 _pending 併進來）。
//                所有畫面顯示（我的海紋收集、我的收藏進度）都只讀這一份。
//   _pending  → 本局遊戲中新解鎖、但「還沒送出/還沒結算」的暫存區，只用來給遊戲內部
//                邏輯判斷「這張是不是已經解鎖過」，不會被拿去顯示。
// 漁港章／魚紋章雖然一進港/發牌當下就會判定解鎖，但都只先進 _pending；要等這一局
// 結算（win-screen.js 的 showWinScreen）送給平台之後，才會搬進 _confirmed、畫面才會
// 顯示出來。同伴章／難度章／勝場數已經整個拿掉，不在這份資料裡。
const progress = {
    _confirmed: { badges: [], fish: [], behaviorBadges: [] },
    _pending: { badges: [], fish: [], behaviorBadges: [] },

    // 收到平台 player_info 後呼叫：把已擁有的漁港章／行為勳章／魚紋章整批覆寫回填
    // （依規格建議整批覆寫，不要合併疊加，避免跨帳號污染）。
    syncFromPlatform(platformBadgeIds) {
        const ids = platformBadgeIds || [];
        function stripPrefix(prefix) {
            return ids.filter(id => id.indexOf(prefix) === 0).map(id => id.slice(prefix.length));
        }
        this._confirmed.badges = stripPrefix(BADGE_PREFIX.harbor);
        this._confirmed.behaviorBadges = stripPrefix(BADGE_PREFIX.behavior);
        this._confirmed.fish = stripPrefix(BADGE_PREFIX.fish);
    },

    // 畫面顯示一律讀「已確認」的部分
    load(name) { return this._confirmed; },
    save(name, data) { /* no-op：狀態直接改 _confirmed/_pending，platform.js 負責跟平台同步 */ },

    // 判斷「這張是不是已經解鎖過」時，已確認＋暫存都要算，避免同一局內重複觸發
    _owns(category, name) {
        return this._confirmed[category].includes(name) || this._pending[category].includes(name);
    },

    unlockBadge(name, badgeName) {
        if (!this._owns('badges', badgeName)) this._pending.badges.push(badgeName);
    },

    unlockFish(name, fishName) {
        if (!this._owns('fish', fishName)) this._pending.fish.push(fishName);
    },

    // 行為型勳章：條件要整局打完才能判斷（見 win-screen.js checkAndUnlock），
    // 一樣先進 _pending，局末結算時再一起送出、一起搬進 _confirmed。
    unlockBehaviorBadge(name, badgeName) {
        if (!this._owns('behaviorBadges', badgeName)) this._pending.behaviorBadges.push(badgeName);
    },

    // 這一局結算成功、把 _pending 送出去之後呼叫：把暫存的合併進「已確認」，
    // 從這一刻起，畫面上（我的海紋收集／我的收藏進度）才會顯示出這些新項目。
    commitPending() {
        ['badges', 'fish', 'behaviorBadges'].forEach(cat => {
            this._pending[cat].forEach(n => {
                if (!this._confirmed[cat].includes(n)) this._confirmed[cat].push(n);
            });
        });
        this._pending = { badges: [], fish: [], behaviorBadges: [] };
    }
};

// 收到平台資料後，立刻把已擁有的徽章回填進 progress（不用等玩家開牌局）
if (typeof PLATFORM !== 'undefined') {
    PLATFORM.onReady(function () { progress.syncFromPlatform(PLATFORM.badgeIds); });
}

let roundChatCount = 0; // 每回合對話上限計數器（上限 2）
let sfxEnabled = sessionStorage.getItem("sfxEnabled") !== "false";
let showSummaryMode = true; // 預設開啟結算頁面
let roundReport = [];       // 每回合出牌結果紀錄
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 省電模式：整場遊戲期間持續播放的背景海洋影片是目前最大的耗電來源
// （不像其他偶發動畫只跑幾秒），開啟後改用「凍結在目前這一幀」的方式
// 顯示背景，不再持續解碼。玩家自己的選擇存在 sessionStorage；如果玩家
// 從沒選過，預設跟隨手機系統的「減少動態效果」設定。
let powerSaveMode = (function () {
    const saved = sessionStorage.getItem("powerSaveMode");
    if (saved !== null) return saved === "true";
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
})();

// 依目前 powerSaveMode 套用到背景影片與切換按鈕的圖示。
function applyPowerSaveMode() {
    const vid = document.getElementById("ocean-bg-video");
    const btn = document.getElementById("power-save-control");

    // 讓 CSS 知道目前是不是省電模式：手牌固定停在資訊頁、不播翻轉過場（見 style.css）
    document.body.classList.toggle("power-save", powerSaveMode);

    if (powerSaveMode) {
        if (vid && !vid.paused) vid.pause(); // 直接凍結在目前這一幀，不用另外準備靜態圖
        if (btn) { btn.innerText = "🔋"; btn.style.opacity = "1"; btn.title = "省電模式：開（點擊關閉）"; }
    } else {
        // 只有遊戲已經開始（body 有 game-started）才需要恢復播放；
        // 還沒開始遊戲時影片可能還沒建立，或只是選漁港時先下載、還不該播放。
        // 被瀏覽器擋下時同樣改成等玩家下一次觸碰畫面再重試。
        if (vid && vid.paused && document.body.classList.contains("game-started")) {
            playOceanVideoWithRetry(vid);
        }
        if (btn) { btn.innerText = "🔋"; btn.style.opacity = "0.4"; btn.title = "省電模式：關（點擊開啟）"; }
    }

    // 立刻重繪 AI 頭像，讓「動態 webp ↔ 靜態 jpg」的切換即時生效，
    // 不用等下一次回合更新（players 還沒建立時略過，例如還在歡迎畫面就先切換）。
    if (typeof players !== "undefined" && players.length && typeof renderAIStatus === "function") {
        renderAIStatus();
    }
}

// 切換省電模式，並記住玩家這次的選擇。
function togglePowerSave() {
    powerSaveMode = !powerSaveMode;
    sessionStorage.setItem("powerSaveMode", powerSaveMode ? "true" : "false");
    applyPowerSaveMode();
}

// 預載圖片功能
/**
 * 依編號批次預載圖片（例如 prefix="P" → image/P1.jpg ~ image/P{count}.jpg）。
 * 用 decode() 在背景先解碼好，之後真正顯示這張圖時就不會卡頓。
 */
function preloadImages(prefix, count) {
    for (let i = 1; i <= count; i++) {
        const img = new Image();
        img.src = `image/${prefix}${i}.jpg`;
        img.decode().catch(() => {}); // 背景解碼，避免顯示時卡頓
    }
}

// ── 桌機展示模式偵測（desktop.html 用 iframe 包住 index.html?embedded=1）──
// 只有在 iframe 裡執行才視為桌機展示模式；手機直接開永遠是 false，不受影響。
const isDesktopMode = (window.self !== window.top);

// 手牌左右按鈕：桌機展示模式專用（手機用觸控滑動，不需要這個）。
// 一次捲動約 2 張卡的寬度（卡片74px + 間距6px ≈ 80px/張）。
function scrollHand(direction) {
    const hand = document.getElementById("player-hand");
    if (!hand) return;
    hand.scrollBy({ left: direction * 160, behavior: "smooth" });
}

document.addEventListener('DOMContentLoaded', () => {
    // 素材下載順序（原本全部在這裡一開啟就同時下載，互相搶網路，是玩家反映
    // 「什麼都載很慢」的主因）：
    //   1. 故事圖 P1-P9 + 開場音樂：頁面一開啟就下載（intro.js）
    //   2. 上面兩者都下載完成 → 下載主遊戲背景音樂 #bgm（intro.js）
    //   3. 進入主遊戲 → 預載全部魚卡，完成後接著預載說明頁音樂（initGame）
    //   4. 說明圖 F1-F18：玩家點擊「簡介說明」時才預載（openInfo）
    //   5. 背景影片：歡迎畫面選好漁港時下載（preloadOceanVideo）
    if (isDesktopMode) {
        document.body.classList.add('desktop-mode');
    }
});

// 預載魚圖片
// 把 fishDB 裡每一種魚的卡圖（fishdb/魚名.png）全部預先載入，
// 確保遊戲中第一次翻牌、抽屜開啟時圖片是「秒顯示」不延遲。
// 回傳一個 Promise，全部魚卡都下載完成（個別失敗也算完成，不卡住後續流程）才 resolve，
// 讓 initGame() 可以在魚卡預載完之後接著預載說明頁音樂。
// 同一個分頁只真正執行一次，之後重玩再呼叫直接回傳同一個 Promise。
let fishImagesPreload = null;
function preloadFishImages() {
    if (fishImagesPreload) return fishImagesPreload;
    if (typeof fishDB === "undefined") return Promise.resolve();
    fishImagesPreload = Promise.all(fishDB.map(f => new Promise(resolve => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = `fishdb/${f.n}.png`;
        img.decode().catch(() => {}); // 背景解碼，顯示時零延遲
    })));
    return fishImagesPreload;
}

// 魚卡預載完成後接著預載說明頁音樂：建立音樂物件就會開始下載，
// 之後玩家打開說明頁或進入教學時直接使用同一個，不用再等下載。
function preloadInfoBGM() {
    const music = getInfoBGM();
    music.preload = "auto";
}

// --- 故事與說明功能 ---
let storyIdx = 1;
let storyTimer = null;
const totalStories = 9;
// 說明頁／教學共用的背景音樂：不在頁面載入時就建立（new Audio 一建立就會開始下載），
// 改成第一次真正要播放時才建立，之後重複使用同一個。教學（tutorial.js）也透過
// getInfoBGM() 取用，確保兩邊用的是同一個音樂物件。
let infoBGM = null;
function getInfoBGM() {
    if (!infoBGM) {
        infoBGM = new Audio('MZ.mp3');
        infoBGM.loop = true; // 設定循環播放
    }
    return infoBGM;
}

// --- 故事滑動控制變數 ---
let touchStartX = 0;
let touchEndX = 0;

// 故事/圖鑑共用的「上一頁」邏輯：先停止自動翻頁計時器，
// 確認還有上一頁才切換，切換完再重新啟動自動翻頁倒數。
function prevStory() {
    stopStoryTimer();
    if (storyIdx > 1) { storyIdx--; updateStory(); startStoryTimer(); }
}

// 依手指滑動的水平距離判斷方向：往左滑（diff 為負）→ 下一頁；往右滑 → 上一頁。
// 50px 是滑動判定的最小距離門檻，避免誤觸。
function handleSwipe() {
    const diff = touchEndX - touchStartX;
    if (diff < -50) nextStory();
    else if (diff > 50) prevStory();
}

// --- 說明功能變數 ---
let infoIdx = 1;
let infoTimer = null;
const totalInfo = 18;
let infoTouchStartX = 0;
let infoTouchEndX = 0;

// 判斷滑動方向（左滑下一頁，右滑上一頁）
// 圖鑑說明版的「上一頁」，邏輯與 prevStory() 相同。
function prevInfo() {
    stopInfoTimer();
    if (infoIdx > 1) { infoIdx--; updateInfo(); startInfoTimer(); }
}

// 圖鑑說明版的滑動方向判斷，邏輯與 handleSwipe() 相同。
function handleSwipeInfo() {
    const diff = infoTouchEndX - infoTouchStartX;
    if (diff < -50) nextInfo();
    else if (diff > 50) prevInfo();
}

/**
 * 開啟圖鑑說明全螢幕頁面：重置頁碼為第 1 頁、切換背景音樂為 infoBGM、
 * 啟動自動翻頁計時器，並綁定觸控滑動事件以支援手動切頁。
 */
let infoImagesPreloaded = false;
function openInfo() {
    // 說明圖 F1-F18：玩家點擊「簡介說明」時才預載（第 1 張由下面 updateInfo() 直接顯示，
    // 其餘在自動翻頁期間背景下載），同一個分頁只預載一次
    if (!infoImagesPreloaded) {
        infoImagesPreloaded = true;
        preloadImages('F', 18);
    }
    infoIdx = 1;
    updateInfo();
    const overlay = document.getElementById("info-overlay");
    overlay.style.display = "flex";
    overlay.style.visibility = "visible";
    overlay.style.opacity = "1";
	
	const infoMusic = getInfoBGM(); // 打開說明頁才建立音樂、開始下載
	infoMusic.currentTime = 0; // 從頭播放
    if (sfxEnabled) {
        infoMusic.play().catch(e => console.log("音樂播放受阻，需使用者互動過才能播放:", e));
    }
	
    startInfoTimer();

    // 綁定觸控事件 (使用 on 避免重複綁定)
    overlay.ontouchstart = (e) => {
        infoTouchStartX = e.changedTouches[0].screenX;
    };

    overlay.ontouchend = (e) => {
        infoTouchEndX = e.changedTouches[0].screenX;
        handleSwipeInfo();
    };
}

// 依目前 infoIdx 換上對應的說明圖片（image/F{idx}.jpg）並更新頁碼文字。
function updateInfo() {
    document.getElementById("info-img").src = `image/F${infoIdx}.jpg`;
    document.getElementById("info-page-num").innerText = `${infoIdx} / ${totalInfo}`;
}

// 切換到下一頁說明圖；若已是最後一頁則直接關閉整個說明視窗。
function nextInfo() {
    stopInfoTimer();
    if (infoIdx < totalInfo) {
        infoIdx++;
        updateInfo();
        startInfoTimer();
    } else {
        closeInfo();
    }
}

// 啟動「10 秒自動換下一頁」的計時器；每次換頁都會重新呼叫此函式重新倒數。
function startInfoTimer() {
    stopInfoTimer();
    infoTimer = setTimeout(() => {
        if (infoIdx < totalInfo) {
            infoIdx++;
            updateInfo();
            startInfoTimer();
        } else {
            closeInfo();
        }
    }, 10000); // 10秒自動換頁
}

// 清除自動換頁計時器（玩家手動切換頁面、或關閉視窗時呼叫）。
function stopInfoTimer() {
    if (infoTimer) clearTimeout(infoTimer);
}

// 關閉圖鑑說明視窗：停止自動換頁、隱藏 overlay、暫停 infoBGM。
function closeInfo() {
    stopInfoTimer();
    document.getElementById("info-overlay").style.display = "none";
	if (infoBGM) infoBGM.pause(); // 還沒打開過說明頁時音樂根本沒建立，不用暫停
}

// 日誌視窗功能
// 開啟「出牌紀錄」視窗（內容由 renderLog() 依 roundLog／gameEndSummary 重新組出）。
function openLog() {
    document.getElementById("log-modal").style.display = "flex";
}
// 關閉「出牌紀錄」視窗。
function closeLog() {
    document.getElementById("log-modal").style.display = "none";
}

/**
 * 開啟「我的海紋收集」彈窗，彙整玩家目前已解鎖的五大類收藏：
 *   漁港章（造訪過的漁港）、難度章（玩過的難度）、同伴章（遇過的 AI 角色）、
 *   魚紋章（出過的魚卡）、神祕任務章（達成的行為型勳章）。
 * 內部會就地宣告 5 個排版小函式（xxxBadgeBlock），各自畫出一塊「進度條 + 格子」UI。
 */
function openCollection() {
    const name = window.playerName && window.playerName !== '守護員' ? window.playerName : null;
    const data = name ? (progress.load(name) || { badges: [], fish: [] }) : { badges: [], fish: [] };

    const locationBadges = typeof locationDB !== 'undefined'
        ? locationDB.map(l => l.badge)
        : [];
    const fishList = typeof fishDB !== 'undefined' ? fishDB.map(f => f.n) : [];

    const unlockedB = data.badges || [];
    const unlockedF = data.fish || [];
    const unlockedBehav = data.behaviorBadges || [];

    const totalAll = locationBadges.length + fishList.length + BEHAVIOR_BADGE_DB.length;
    const totalUnlocked = unlockedB.length + unlockedF.length + unlockedBehav.length;

    function pct(got, total) { return total ? Math.round(got / total * 100) : 0; }

    // 漁港章：可點選已收集項目 → 放大顯示圖片
    function locationBadgeBlock(list, unlocked) {
        const got = list.filter(n => unlocked.includes(n)).length;
        const cols = 3;
        return `
        <div style="margin-bottom:1.4rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:500;color:rgba(255,255,255,0.6);letter-spacing:0.04em;">漁港章</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.45);">${got} / ${list.length}</span>
          </div>
          <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:3px;margin-bottom:10px;overflow:hidden;">
            <div style="height:100%;border-radius:99px;background:#1D9E75;width:${pct(got,list.length)}%;transition:width 0.6s ease;"></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;">
            ${list.map(n => {
                const isUnlocked = unlocked.includes(n);
                const clickable = isUnlocked ? `onclick="showCollectionZoom('image/${n}.jpg','${n}')" style="cursor:pointer;"` : '';
                return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:4px;" ${clickable}>
                  <div style="width:100%;aspect-ratio:3/2;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,${isUnlocked?'0.22':'0.06'});background:rgba(255,255,255,0.05);${isUnlocked?'':'filter:grayscale(1) brightness(0.3)'};${isUnlocked?'box-shadow:0 2px 8px rgba(29,158,117,0.35);':''}">
                    <img src="image/${n}.jpg" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // 魚紋章：已收集的魚可點選 → 用 showCardPreview 放大 2X 魚卡
    function fishBadgeBlock(list, unlocked) {
        const got = list.filter(n => unlocked.includes(n)).length;
        const cols = 4;
        return `
        <div style="margin-bottom:1.4rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:500;color:rgba(255,255,255,0.6);letter-spacing:0.04em;">魚紋章</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.45);">${got} / ${list.length}</span>
          </div>
          <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:3px;margin-bottom:10px;overflow:hidden;">
            <div style="height:100%;border-radius:99px;background:#1D9E75;width:${pct(got,list.length)}%;transition:width 0.6s ease;"></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;">
            ${list.map((n, idx) => {
                const isUnlocked = unlocked.includes(n);
                // 用 fishDB 的真實 index 傳入，onclick 呼叫輔助函式拉高 z-index 再顯示
                const dbIdx = (typeof fishDB !== 'undefined') ? fishDB.findIndex(f => f.n === n) : -1;
                const clickAttr = (isUnlocked && dbIdx >= 0)
                    ? `onclick="showCollectionFishPreview(${dbIdx})" style="cursor:pointer;"`
                    : '';
                return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:4px;" ${clickAttr}>
                  <div style="width:100%;aspect-ratio:3/2;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,${isUnlocked?'0.18':'0.06'});background:rgba(255,255,255,0.05);${isUnlocked?'':'filter:grayscale(1) brightness(0.3)'};${isUnlocked?'box-shadow:0 2px 6px rgba(29,158,117,0.3);':''}">
                    <img src="fishdb/${n}.png" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">
                  </div>
                  <div style="font-size:9px;text-align:center;color:rgba(255,255,255,${isUnlocked?'0.75':'0.25'});line-height:1.2;">${n}</div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // 神祕任務章：圖片顯示，未解鎖灰暗，已解鎖可點選放大
    function behaviorBadgeBlock(list, unlocked) {
        const got = list.filter(b => unlocked.includes(b.key)).length;
        const cols = 4;
        return `
        <div style="margin-bottom:1.4rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:500;color:rgba(255,255,255,0.6);letter-spacing:0.04em;">神祕任務章</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.45);">${got} / ${list.length}</span>
          </div>
          <div style="background:rgba(255,255,255,0.08);border-radius:99px;height:3px;margin-bottom:10px;overflow:hidden;">
            <div style="height:100%;border-radius:99px;background:#1D9E75;width:${pct(got,list.length)}%;transition:width 0.6s ease;"></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;">
            ${list.map(b => {
                const isUnlocked = unlocked.includes(b.key);
                const clickable = isUnlocked
                    ? `onclick="showCollectionZoom('image/${b.key}.png','${b.key}')" style="cursor:pointer;"`
                    : '';
                return `
                <div style="display:flex;flex-direction:column;align-items:center;gap:4px;" ${clickable}>
                  <div style="width:100%;aspect-ratio:1/1;border-radius:8px;overflow:hidden;
                    ${isUnlocked
                        ? 'border:1px solid rgba(255,255,255,0.22);box-shadow:0 2px 8px rgba(29,158,117,0.35);'
                        : 'border:3px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.35);'
                    }
                    display:flex;align-items:center;justify-content:center;">
                    ${isUnlocked
                        ? `<img src="image/${b.key}.png" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">`
                        : `<span style="font-size:42px;font-weight:900;color:#e02020;line-height:1;text-shadow:0 2px 8px rgba(0,0,0,0.5);">？</span>`
                    }
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // 注入已解鎖魚的 fish 物件到 window，讓 onclick 能取用
    if (typeof fishDB !== 'undefined') {
        fishDB.forEach(f => {
            const key = '_collFish_' + f.n.replace(/[^a-zA-Z0-9]/g,'_');
            window[key] = f;
        });
    }

    const existing = document.getElementById('collection-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'collection-modal';
    modal.style.cssText = `
        position:fixed;inset:0;z-index:6000;
        background:rgba(0,0,0,0.7);
        display:flex;flex-direction:column;justify-content:flex-end;
        backdrop-filter:blur(4px);
    `;

    modal.innerHTML = `
        <div style="background:rgba(10,18,35,0.97);border-radius:20px 20px 0 0;max-height:85vh;display:flex;flex-direction:column;border-top:1px solid rgba(255,255,255,0.1);">
          <div style="width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.2);margin:12px auto 0;flex-shrink:0;"></div>
          <div style="display:flex;align-items:center;justify-content:flex-end;padding:10px 16px 10px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;">
            <button onclick="closeCollection()" style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:rgba(255,255,255,0.6);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
          </div>
          ${name ? `
          <div style="padding:10px 16px;background:rgba(160,215,235,0.18);border:1px solid rgba(160,215,235,0.25);border-radius:12px;margin:10px 16px;flex-shrink:0;display:flex;align-items:center;gap:10px;">
            <div style="width:34px;height:34px;border-radius:50%;background:rgba(29,158,117,0.35);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:#5DCAA5;">${name.charAt(0)}</div>
            <div>
              <div style="font-size:14px;font-weight:500;color:rgba(200,235,245,0.92);">${name}</div>
              <div style="font-size:12px;color:rgba(160,215,235,0.7);">已收集 ${totalUnlocked} / ${totalAll}</div>
            </div>
          </div>` : `
          <div style="padding:10px 16px;font-size:13px;color:rgba(255,255,255,0.4);border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;">未輸入暱稱，不記錄收集進度</div>`}
          <div style="overflow-y:auto;padding:16px;-webkit-overflow-scrolling:touch;">
            ${locationBadgeBlock(locationBadges, unlockedB)}
            ${fishBadgeBlock(fishList, unlockedF)}
            ${behaviorBadgeBlock(BEHAVIOR_BADGE_DB, unlockedBehav)}
          </div>
        </div>
    `;

    modal.addEventListener('click', e => { if (e.target === modal) closeCollection(); });
    document.body.appendChild(modal);
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const panel = modal.querySelector('div[style*="border-radius:20px"]');
        if (panel) panel.style.transform = 'translateY(0)';
    }));
}

// 收集頁魚卡放大：先把 card-preview-overlay 拉到最上層再顯示
// 收集圖鑑裡點擊「已解鎖的魚卡」→ 用 showCardPreview() 放大顯示。
// 先把預覽層的 z-index 拉到比收集圖鑑更高，避免被收集視窗蓋住。
function showCollectionFishPreview(dbIdx) {
    if (typeof fishDB === 'undefined' || !fishDB[dbIdx]) return;
    const ov = document.getElementById('card-preview-overlay');
    if (ov) ov.style.zIndex = '7100';
    showCardPreview(null, fishDB[dbIdx], false);
}

// 收集頁放大檢視（漁港章、難度章）
// 收集圖鑑裡點擊「已解鎖的漁港章／難度章」→ 全螢幕放大顯示該張圖片＋標籤文字。
function showCollectionZoom(imgSrc, label) {
    const existing = document.getElementById('collection-zoom-overlay');
    if (existing) existing.remove();
    const ov = document.createElement('div');
    ov.id = 'collection-zoom-overlay';
    ov.style.cssText = `
        position:fixed;inset:0;z-index:7000;
        background:rgba(0,0,0,0.82);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        backdrop-filter:blur(6px);
    `;
    ov.innerHTML = `
        <div style="max-width:88vw;max-height:80vh;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.7);">
            <img src="${imgSrc}" style="width:100%;max-height:72vh;object-fit:contain;display:block;" onerror="this.style.display='none'">
        </div>
        <div style="margin-top:14px;font-size:1rem;color:rgba(255,255,255,0.85);letter-spacing:0.08em;">${label}</div>
        <button onclick="document.getElementById('collection-zoom-overlay').remove()" style="margin-top:18px;padding:10px 30px;border-radius:50px;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:1rem;cursor:pointer;backdrop-filter:blur(4px);">關閉</button>
    `;
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
}

// 收集頁放大檢視（同伴章：圓形）
// 收集圖鑑裡點擊「已解鎖的同伴章」→ 全螢幕放大顯示圓形大頭貼＋角色名稱。
function showCompanionZoom(imgSrc, label) {
    const existing = document.getElementById('collection-zoom-overlay');
    if (existing) existing.remove();
    const ov = document.createElement('div');
    ov.id = 'collection-zoom-overlay';
    ov.style.cssText = `
        position:fixed;inset:0;z-index:7000;
        background:rgba(0,0,0,0.82);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        backdrop-filter:blur(6px);
    `;
    ov.innerHTML = `
        <div style="width:72vw;max-width:260px;aspect-ratio:1/1;border-radius:50%;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.7);border:3px solid rgba(100,180,255,0.5);">
            <img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none'">
        </div>
        <div style="margin-top:16px;font-size:1.1rem;color:rgba(255,255,255,0.9);letter-spacing:0.1em;">${label}</div>
        <button onclick="document.getElementById('collection-zoom-overlay').remove()" style="margin-top:18px;padding:10px 30px;border-radius:50px;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:1rem;cursor:pointer;backdrop-filter:blur(4px);">關閉</button>
    `;
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
}

// 關閉「我的海紋收集」彈窗。
function closeCollection() {
    const modal = document.getElementById('collection-modal');
    if (modal) modal.remove();
}

/* phase 狀態機五個值的完整說明見檔頭（第 23~28 行）。
   ⚠️ 這個變數會被 tutorial.js 的 patchPlayerAction() 讀取（判斷是否為
   PLAYER_MAZU 階段），修改狀態名稱或新增狀態時記得同步檢查 tutorial.js，
   並同步更新檔頭的狀態說明，避免兩處描述不一致。 */
let players = [], deckS = [], table = [], currentS = null, callerIdx = 0, phase = "WAIT";
let initialHands = []; // 各局開始時的初始手牌快照，遊戲結束時寫入 LOG

// 真正均勻的 Fisher-Yates 洗牌（取代有偏的 sort+random）
/**
 * Fisher-Yates 洗牌演算法（原地洗牌，回傳同一個陣列）。
 * 比起常見的「sort(() => Math.random()-0.5)」寫法，這個演算法的
 * 每種排列出現機率是真正均勻的，不會有特定順序被洗到的機率偏高。
 */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// UI 鎖定：等待動畫/AI計算時，攔截所有使用者觸控
// 鎖住整個操作層（顯示一個全螢幕透明遮罩攔截所有觸控），
// 用在「動畫播放中」或「AI 計算中」等不希望玩家亂點打斷流程的時刻。
function lockUI() {
    const el = document.getElementById("ui-lock");
    if (el) el.style.display = "block";
}
// 解除 lockUI() 的鎖定，恢復玩家可操作狀態。
function unlockUI() {
    const el = document.getElementById("ui-lock");
    if (el) el.style.display = "none";
}

// --- 標籤生成邏輯 ---
// 產生卡片正面要顯示的特性標籤 HTML（季節／漁法／洄游或定棲／產地）。
// 漁法標籤會依是否屬於友善漁法（ecoMethods 清單）分別套用綠色／警示色樣式。
function getFishTags(f) {
    let html = '<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 1px;">';
    
    if (f.s.includes("全年")) html += `<span class="tag tag-all">全年</span>`;
    else {
        if (f.s.includes("春")) html += `<span class="tag tag-spring">春</span>`;
        if (f.s.includes("夏")) html += `<span class="tag tag-summer">夏</span>`;
        if (f.s.includes("秋")) html += `<span class="tag tag-autumn">秋</span>`;
        if (f.s.includes("冬")) html += `<span class="tag tag-winter">冬</span>`;
    }

    const ecoMethods = ["一支釣", "定置", "養殖", "手釣", "棒受網", "籠具", "釣具", "標槍"];
    f.m.forEach(method => {
        const isEco = ecoMethods.some(eco => method.includes(eco));
        html += `<span class="tag ${isEco ? 'tag-eco' : 'tag-warn'}">${method}</span>`;
    });

    const hClass = f.h.includes("洄游") ? "tag-migratory" : "tag-sedentary";
    html += `<span class="tag ${hClass}">${f.h}</span>`;

    let dClass = "tag-coastal";
    if (f.d.includes("遠洋")) dClass = "tag-ocean";
    if (f.d.includes("養殖")) dClass = "tag-farm";
    html += `<span class="tag ${dClass}">${f.d}</span>`;

    html += '</div>';
    return html;
}

// 手牌反面標籤：輸出純 span 串，由 .card-back-tags 容器排版
// 與 getFishTags() 邏輯相同，差別是只回傳 <span> 標籤本身（不含外層 div 容器），
// 給手牌「反面」版面（.card-back-tags）直接排版用。
function getHandBackTags(f) {
    let html = "";
    const ecoMethods = ["一支釣", "定置", "養殖", "手釣", "棒受網", "籠具", "釣具", "標槍"];

    if (f.s.includes("全年")) html += `<span class="tag tag-all">全年</span>`;
    else {
        if (f.s.includes("春")) html += `<span class="tag tag-spring">春</span>`;
        if (f.s.includes("夏")) html += `<span class="tag tag-summer">夏</span>`;
        if (f.s.includes("秋")) html += `<span class="tag tag-autumn">秋</span>`;
        if (f.s.includes("冬")) html += `<span class="tag tag-winter">冬</span>`;
    }

    f.m.forEach(method => {
        const isEco = ecoMethods.some(eco => method.includes(eco));
        html += `<span class="tag ${isEco ? 'tag-eco' : 'tag-warn'}">${method}</span>`;
    });

    const hClass = f.h.includes("洄游") ? "tag-migratory" : "tag-sedentary";
    html += `<span class="tag ${hClass}">${f.h}</span>`;

    let dClass = "tag-coastal";
    if (f.d.includes("遠洋")) dClass = "tag-ocean";
    if (f.d.includes("養殖")) dClass = "tag-farm";
    html += `<span class="tag ${dClass}">${f.d}</span>`;

    return html;
}

// 卡牌預覽功能 (2X放大)
let previewTimeout = null;

/**
 * @param {number|null} idx - 手牌索引，如果是海洋區卡片則傳 null
 * @param {Object} fish - fishDB 的魚卡資料物件（不是 DOM 元素），用來取得
 *                 燈號 l、名稱 n、介紹 i 等欄位渲染放大預覽卡
 * @param {boolean} isHand - 是否為手牌 (決定是否顯示操作按鈕)
 *
 * ⚠️ 此函式會被 tutorial.js 的 patchShowCardPreview() 整個攔截包裝
 *    （monkey-patch，見 tutorial.js 對應區塊的警語）。若修改此函式的
 *    名稱或參數簽名，務必同步檢查 tutorial.js。
 */
function showCardPreview(idx, fish, isHand = true) {
    const overlay = document.getElementById("card-preview-overlay");
    const container = document.getElementById("card-preview-container");

    container.innerHTML = "";
    if (previewTimeout) clearTimeout(previewTimeout);

    // 燈號對應淡色背景
    const lightBg = fish.l === 1 ? "#d4f5e2" : fish.l === 2 ? "#fef3cd" : "#ffd6da";
    const lightBorder = fish.l === 1 ? "#77D9A8" : fish.l === 2 ? "#f9e1a9" : "#ffb3ba";

    // 詳情卡片
    const card = document.createElement("div");
    card.className = "preview-detail-card";
    card.style.borderColor = lightBorder;

    card.innerHTML = `
        <div class="preview-fish-img-wrap">
            <img src="fishdb/${fish.n}.png"
                 onerror="this.style.display='none'; this.parentNode.classList.add('no-img')"
                 alt="${fish.n}" class="preview-fish-img">
        </div>
        <div class="preview-fish-name" style="background:${lightBg};">${fish.n}</div>
        <div class="preview-fish-tags">${getFishTags(fish)}</div>
        <div class="preview-fish-desc">${fish.i || ""}</div>
    `;

    container.appendChild(card);

    // 出牌模式：手牌 + 玩家回合 → 綠勾紅叉；閱覽模式 → 只有紅叉
    if (isHand && phase.includes("PLAYER")) {
        const controls = document.createElement("div");
        controls.className = "preview-controls";

        const btnCancel = document.createElement("button");
        btnCancel.className = "preview-btn btn-cancel";
        btnCancel.innerHTML = "✕";
        btnCancel.onclick = (e) => { e.stopPropagation(); closePreview(); };

        const btnConfirm = document.createElement("button");
        btnConfirm.className = "preview-btn btn-confirm";
        btnConfirm.innerHTML = "✔️";
        btnConfirm.onclick = (e) => { e.stopPropagation(); closePreview(); playerAction(idx); };

        controls.appendChild(btnConfirm);
        controls.appendChild(btnCancel);
        container.appendChild(controls);
    } else {
        // 閱覽模式：紅叉提早關閉（計時器仍會自動關閉）
        const controls = document.createElement("div");
        controls.className = "preview-controls";

        const btnClose = document.createElement("button");
        btnClose.className = "preview-btn btn-cancel";
        btnClose.innerHTML = "✕";
        btnClose.onclick = (e) => { e.stopPropagation(); closePreview(); };

        controls.appendChild(btnClose);
        container.appendChild(controls);
    }

    overlay.style.display = "flex";

    // 手牌時自動關閉延長到 6 秒，桌面牌 4 秒
    previewTimeout = setTimeout(closePreview, isHand ? 6000 : 4000);
}

// 關閉卡片放大預覽層，並清空內容、還原 z-index。
function closePreview() {
    if (previewTimeout) clearTimeout(previewTimeout);
    const ov = document.getElementById("card-preview-overlay");
    ov.style.display = "none";
    ov.style.zIndex = ""; // 還原 z-index，不影響遊戲中的正常顯示
    document.getElementById("card-preview-container").innerHTML = "";
}

// --- 遊戲運行邏輯與 UI 渲染 ---
/**
 * 重新渲染整個遊戲畫面：
 *   - AI 頭像區（含手牌剩餘張數圖示，最後一張時會有警示閃爍動畫）
 *   - 牌堆剩餘次數（剩 5 次以下會閃爍提示）
 *   - 玩家手牌（含正反面翻轉動畫、是否符合本回合召喚的綠點提示）
 *   - 是否輪到玩家操作（套用 .my-turn 樣式高亮手牌區）
 * 幾乎每個遊戲狀態改變後都會呼叫這個函式來同步畫面。
 */
// 目前正在出牌的 AI 玩家索引（players 陣列的 index），-1 代表沒有 AI 正在行動中。
// 由 setActiveAI()／clearActiveAI() 統一設定/清除，renderAIStatus() 依此決定要顯示 jpg 還是 webp 頭像。
// 從「輪到該 AI」的那一刻開始顯示 webp，直到牠出牌動畫真正完成才切回 jpg，
// 涵蓋整個該 AI 的回合，而不是出牌那瞬間才短暫顯示。
let activeAIIdx = -1;

function setActiveAI(idx) {
    activeAIIdx = idx;
    renderAIStatus();
}
function clearActiveAI() {
    activeAIIdx = -1;
    renderAIStatus();
}

function renderAIStatus() {
    players.forEach((p, i) => {
        if(i > 0) {
			const isLastCard = p.hand.length === 1;
            const dangerClass = isLastCard ? "ai-last-card-danger" : "";

            const cardsIcon = `
                <span class="${dangerClass}" style="letter-spacing: -5px; display: inline-block; white-space: nowrap;">
                    ${"🎴".repeat(p.hand.length)}
                </span>`;

            // 預設用靜態 jpg，只有正在出牌的那位 AI（activeAIIdx 對到的 index）才切換成動態 webp。
            // 省電模式時一律維持靜態 jpg：動態 WebP 走的是 CPU 軟體解碼（沒有硬體加速），
            // 600x600 的圖持續解碼相當耗電，而畫面上實際只顯示成小圓形頭像。
            const avatarHtml = (i === activeAIIdx && !powerSaveMode) ? p.avatarWebp : p.avatarJpg;

            document.getElementById(p.id).innerHTML = `
                <div class="avatar-img">${avatarHtml}</div>
                <div class="ai-name">${p.n}</div>
                <div class="ai-cards">${cardsIcon}</div>
            `;
        }
    });

    const deckInfo = document.getElementById("deck-info");
    // 已移到頂端固定列，空間有限，文字精簡成「🎴數字」（原本是「剩餘N次召喚」）
    deckInfo.innerText = `🎴${deckS.length}`;
    deckInfo.title = `剩餘 ${deckS.length} 次召喚`;
    if (deckS.length <= 5) {
        deckInfo.classList.add("deck-danger");
    } else {
        deckInfo.classList.remove("deck-danger");
    }
}

// ── 手牌翻面狀態 ──
// 玩家回合結束後，資訊頁要多停留多久才翻回魚圖頁（毫秒）。設 0 就是立刻翻回去。
const FLIP_BACK_DELAY = 3500;
let _cardsShowingInfo = false;      // 目前畫面上手牌是不是停在資訊頁
let _prevCardsShowingInfo = false;  // 上一次 renderUI 時的狀態，用來判斷要不要播翻轉動畫
let _flipBackTimer = null;          // 「稍後翻回魚圖頁」的計時器

function renderUI() {
    renderAIStatus();

	const handEl = document.getElementById("player-hand");
    handEl.innerHTML = "";

    const isNormalTask = currentS && !currentS.isMazu && phase === "PLAYER_TURN" && callerIdx === 0;
    // 需要玩家出牌時翻到資訊頁（看特性標籤方便決定出哪張），其餘時間停在魚圖頁。
    // 省電模式不受這裡影響：CSS 會固定讓它停在資訊頁、不播翻轉（見 style.css）。
    const showInfoSide = phase === "PLAYER_TURN" || phase === "PLAYER_MAZU";

    players[0].hand.forEach((f, idx) => {
        const c = document.createElement("div");
        c.className = `card light-${f.l} card-auto-flip`;
        const isValid = isNormalTask && currentS.c(f);

        // 正面：魚名 + 魚圖
        const front = document.createElement("div");
        front.className = "card-front";
        front.innerHTML = `<div class="card-n">${f.n}</div><div class="card-img"><img src="fishdb/${f.n}.png" alt="${f.n}" onerror="this.style.display='none'"></div>`;

        // 反面：魚名 + 特性標籤
        const back = document.createElement("div");
        back.className = "card-back";
        back.innerHTML = `<div class="card-n">${f.n}</div><div class="card-back-tags">${getHandBackTags(f)}</div>`;

        c.appendChild(front);
        c.appendChild(back);

        if (isValid) {
            const dot = document.createElement("span");
            dot.className = "valid-dot";
            c.appendChild(dot);
        }

        // 手牌點擊：放大預覽，並帶有出牌功能
        c.onclick = () => showCardPreview(idx, f, true);

        handEl.appendChild(c);
    });

    // ── 翻面控制 ──
    // 玩家回合結束後不立刻翻回魚圖頁，而是讓資訊頁多停留 FLIP_BACK_DELAY 毫秒——
    // 出完牌馬上翻回去太快，玩家還來不及看清楚剛剛那張牌的特性標籤。
    if (showInfoSide) {
        clearTimeout(_flipBackTimer);   // 回到玩家回合，取消還沒執行的「翻回去」
        _flipBackTimer = null;
        _cardsShowingInfo = true;
    } else if (_cardsShowingInfo && !_flipBackTimer) {
        // 剛離開玩家回合：先維持資訊頁，等一段時間後才翻回魚圖頁
        _flipBackTimer = setTimeout(() => {
            _flipBackTimer = null;
            _cardsShowingInfo = false;
            _prevCardsShowingInfo = false;
            document.querySelectorAll("#player-hand .card-auto-flip")
                .forEach(el => el.classList.remove("card-show-info"));
        }, FLIP_BACK_DELAY);
    }

    if (_cardsShowingInfo) {
        if (_prevCardsShowingInfo) {
            // 上一次渲染就已經是資訊頁了 → 這次只是普通重繪（例如出完牌後更新手牌），
            // 直接以資訊頁的樣子呈現，不要再播一次翻轉動畫。class 在元素還沒進到畫面前
            // 就加上，瀏覽器會當成初始狀態，不會觸發 transition。
            handEl.querySelectorAll(".card-auto-flip").forEach(el => el.classList.add("card-show-info"));
        } else {
            // 狀態從魚圖頁 → 資訊頁：等進到 DOM 後的下一幀才加 class，才播得出翻轉過場。
            requestAnimationFrame(() => {
                handEl.querySelectorAll(".card-auto-flip").forEach(el => el.classList.add("card-show-info"));
            });
        }
    }
    _prevCardsShowingInfo = _cardsShowingInfo;
    // 玩家回合時強高亮手牌區
    const isMyTurn = phase === "PLAYER_TURN" || phase === "PLAYER_MAZU";
    document.getElementById("player-zone").classList.toggle("my-turn", isMyTurn);
    setTimeout(updateHandArrows, 50);

    // 抽屜：玩家回合顯示上滑提示，非玩家回合隱藏
    updateDrawerArrow(isMyTurn);
}

// 手牌可能超出可視寬度需要左右滑動瀏覽，這裡依目前捲動位置
// 顯示／隱藏左右兩側的「還能繼續滑」箭頭提示。
function updateHandArrows() {
    const hand = document.getElementById('player-hand');
    const leftArrow  = document.getElementById('arrow-left');
    const rightArrow = document.getElementById('arrow-right');
    if (!hand || !leftArrow || !rightArrow) return;

    const isOverflowing = hand.scrollWidth > hand.clientWidth + 2;
    if (isOverflowing) {
        leftArrow.style.display  = hand.scrollLeft > 5 ? 'flex' : 'none';
        const maxScroll = hand.scrollWidth - hand.clientWidth;
        rightArrow.style.display = hand.scrollLeft < maxScroll - 5 ? 'flex' : 'none';
    } else {
        leftArrow.style.display  = 'none';
        rightArrow.style.display = 'none';
    }
}

// 確保點擊遮罩背景也能關閉預覽
document.getElementById("card-preview-overlay").onclick = (e) => {
    if(e.target.id === "card-preview-overlay") {
        closePreview();
    }
};

// 重新渲染「海洋桌面」上目前已出的牌（table 陣列），最新一張會套用出牌動畫樣式。
// 注意：這裡改成「只補上還沒渲染的新卡片」，不清空重建整個桌面——
// 因為 table 陣列在一輪內只會被 push（新增），不會中途移除單張卡，
// 整個桌面只有在 autoStep() 開新回合時才會被真正清空（table=[] 同時 innerHTML=""）。
// 如果每次都 innerHTML="" 再整個重建，桌面卡片越多，重建成本就越高，
// 到回合後段（例如第 3、4 位玩家出牌）會明顯造成主執行緒卡頓。
function renderTable() {
    const zone = document.getElementById("table");
    const existingCount = zone.children.length;
    for (let index = existingCount; index < table.length; index++) {
        const t = table[index];
        const c = document.createElement("div");
        c.className = `card light-${t.card.l}`;
        c.innerHTML = `<div class="card-n">${t.card.n}</div><div class="card-i">${getFishTags(t.card)}</div>`;

        // 海洋區卡片點擊：放大預覽，但不帶功能
        c.onclick = () => showCardPreview(null, t.card, false);

        zone.appendChild(c);
        if (index === table.length - 1) {
            void c.offsetWidth;
            c.classList.add("card-played");
        }
    }
}



let logPlainText = ""; // 純文字版完整報告，供複製分析用（由 renderLog() 重新計算）
let roundLog = [];      // 結構化回合紀錄：[{round, callerName, isMazu, summonText, plays:[], shares:[], notes:[]}, ...]
let preGameMessage = ""; // 開場集結訊息（回合0，永遠顯示在報告最下方）
let gameEndSummary = null; // 遊戲結束時寫入：{location, diffText, winnerName, totalRounds, initialHands}

/**
 * 取得（或建立）指定回合的結構化紀錄物件。
 * 同一回合內多次呼叫會回傳同一個物件，方便逐步補上召喚／出牌／贈牌等資訊。
 */
function getRoundBucket(r) {
    let b = roundLog.find(x => x.round === r);
    if (!b) {
        b = { round: r, callerName: null, isMazu: false, summonText: null, plays: [], shares: [], notes: [] };
        roundLog.push(b);
    }
    return b;
}

// 燈號 → emoji
function lightEmoji(l) {
    return l === 1 ? "🟢" : (l === 2 ? "🟡" : "🔴");
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 將單一文字段落（block，內部可能含多行、含空白行分段）依行內容套上樣式 class
function logBlockToHtml(block) {
    return block.split("\n").map(line => {
        if (line === "") return `<div class="log-gap"></div>`;
        let cls = "log-line";
        if (/^═+$/.test(line)) cls += " log-divider-heavy";
        else if (/^─+$/.test(line)) cls += " log-divider-light";
        else if (line.startsWith("🏆") || line.startsWith("🎴")) cls += " log-title";
        else if (/^R\d+$/.test(line)) cls += " log-round-num";
        else if (line.startsWith("✅")) cls += " log-pass";
        else if (line.startsWith("❌")) cls += " log-fail";
        else if (line.startsWith("⚠")) cls += " log-warn";
        else if (line.startsWith("📜")) cls += " log-summon-caller";
        else if (line.startsWith("🔄") || line.startsWith("🐟")) cls += " log-share";
        else if (line.startsWith("任務地點") || line.startsWith("難度：") || line.startsWith("總回合") || line.startsWith("勝者")) cls += " log-meta";
        return `<div class="${cls}">${escapeHtml(line)}</div>`;
    }).join("");
}

// 組出「🏆本局結果 + 🎴初始手牌」總結段落（遊戲結束時才會有資料）
function buildSummaryBlock(s) {
    const EQ = "═".repeat(30), DASH = "─".repeat(30);
    const handsText = s.initialHands.map(p => {
        const cards = p.hand.map(f => `${lightEmoji(f.l)} ${f.n}`);
        const lines = [];
        for (let i = 0; i < cards.length; i += 3) lines.push(cards.slice(i, i + 3).join("　"));
        return `${p.name}\n${lines.join("\n")}`;
    }).join("\n\n");

    return `${EQ}\n🏆 本局結果\n${EQ}\n\n任務地點：${s.location}\n難度：${s.diffText}\n總回合：${s.totalRounds}\n\n勝者：${s.winnerName}\n\n${DASH}\n🎴 初始手牌\n${DASH}\n\n${handsText}`;
}

// 組出單一回合段落（召喚揭曉／出牌結果／贈牌／備註）
function buildRoundBlock(rd) {
    const EQ = "═".repeat(30);
    const mid = [];
    if (rd.callerName) mid.push(`📜 ${rd.callerName}抽到神秘召喚`);
    if (rd.summonText) mid.push(rd.summonText);
    if (rd.isMazu) {
        if (rd.shares.length) mid.push(rd.shares.map(sh => `🔄 ${sh.from} → ${sh.to}\n🐟 ${sh.card}`).join("\n\n"));
    } else if (rd.plays.length) {
        mid.push(rd.plays.map(p => `${p.success ? "✅" : "❌"} ${p.name}　${lightEmoji(p.light)}${p.card}`).join("\n"));
    }
    if (rd.notes.length) mid.push(rd.notes.join("\n"));

    const parts = [`${EQ}\nR${rd.round}\n${EQ}`];
    if (mid.length) parts.push(mid.join("\n\n"));
    return parts.join("\n\n");
}

/**
 * 依目前的 gameEndSummary / roundLog / preGameMessage 重新組出整份「出牌紀錄」，
 * 同時更新畫面上的 #log-messages 面板與供複製用的純文字 logPlainText。
 * 顯示順序：本局結果（若已結束）→ 回合 R{最大}…R1（新到舊）→ 開場集結訊息。
 */
function renderLog() {
    const segments = [];
    if (gameEndSummary) segments.push(buildSummaryBlock(gameEndSummary));
    [...roundLog].sort((a, b) => b.round - a.round).forEach(rd => segments.push(buildRoundBlock(rd)));
    if (preGameMessage) segments.push(preGameMessage);

    logPlainText = segments.join("\n\n");

    const l = document.getElementById("log-messages");
    if (l) l.innerHTML = segments.map(seg => `<div class="log-block">${logBlockToHtml(seg)}</div>`).join("");
}

// 將純文字版出牌紀錄複製到剪貼簿；若瀏覽器不支援 clipboard API（常見於部分手機瀏覽器），
// fallback 成跳出一個可手動長按選取全文的 textarea。
function copyLog() {
    const text = logPlainText;
    const btn = document.getElementById("log-copy-btn");
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = "✓ 已複製";
        btn.style.background = "#b9f6ca";
        btn.style.color = "#1b5e20";
        setTimeout(() => {
            btn.textContent = "📋 複製";
            btn.style.background = "";
            btn.style.color = "";
        }, 2000);
    }).catch(() => {
        // fallback：建立 textarea 手動選取
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:50vh;z-index:9999;font-size:12px;";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        btn.textContent = "👆 長按選取";
        setTimeout(() => {
            ta.remove();
            btn.textContent = "📋 複製";
        }, 8000);
    });
}

// 切換背景音樂播放／暫停，同時更新 sfxEnabled 旗標與音樂按鈕的圖示樣式。
function toggleMusic() {
    const music = document.getElementById("bgm");
    const btn = document.getElementById("music-control");
    if (music.paused) {
        music.play();
        sfxEnabled = true;
        btn.innerText = "🔊";
        btn.style.filter = "";
        btn.style.opacity = "1";
    } else {
        music.pause();
        sfxEnabled = false;
        btn.innerText = "🔇";
        btn.style.filter = "";
        btn.style.opacity = "0.4";
    }
}

// 建立一個固定定位的圖層，專門用來放置 AI 角色頭頂彈出的對話泡泡（showChat 會用到）。
function initChatLayer() {
    if (document.getElementById("chat-layer")) return;
    const layer = document.createElement("div");
    layer.id = "chat-layer";
    document.body.appendChild(layer);
}

/**
 * 玩家點擊「開始遊戲」後的進場流程：
 *   啟動背景特效（光束／魚群／氣泡）、淡出歡迎畫面、顯示遊戲內 UI 按鈕（音樂/紀錄/收集等）、
 *   嘗試播放背景音樂，並在 3.5 秒淡出轉場結束後呼叫 startGame() 正式開局。
 */
// locationId 為 db.js／HARBORS 裡的純英文代碼（例如 "badouzi"），
// 用來組出影片檔名 image/{id}.mp4。改用 id 而不是中文全名，
// 是為了避免中文檔名在「程式碼字串」與「伺服器實際檔名」之間，
// 因全形/半形標點、輸入法選字等因素造成打不出來的隱性不一致。
function getOceanVideoEl() {
    let vid = document.getElementById("ocean-bg-video");
    if (!vid) {
        vid = document.createElement("video");
        vid.id = "ocean-bg-video";
        // 不設 autoplay：影片可能在歡迎畫面選漁港時就先建立、先下載，
        // 那時候還不該播放；真正開始播放一律由 initOceanVideo() 明確呼叫。
        vid.loop = true; vid.muted = true; vid.playsInline = true;
        vid.preload = "auto";
        document.body.appendChild(vid);
    }
    return vid;
}

// 設定影片來源並開始下載（不播放）。同一個網址重複呼叫不會重新 load()，
// 避免把已經緩衝的進度打掉重來（選漁港時先下載 → initGame → startGame 都會呼叫到）。
function setOceanVideoSrc(locationId) {
    const vid = getOceanVideoEl();
    const targetSrc = `image/${locationId}.mp4`;
    if (vid.dataset.loadedSrc === targetSrc) return vid;
    vid.dataset.loadedSrc = targetSrc;

    // 診斷用：影片載入失敗時（例如檔名對不上、404）瀏覽器預設會停格在
    // 上一支成功播放過的影片，畫面上看起來會像是「抓錯地點」，但其實只是
    // 沒有真的切換過去。這裡明確攔截失敗事件，印出實際請求的檔名方便比對。
    vid.onerror = () => {
        console.error(
            `[背景影片載入失敗] 目標檔名：${targetSrc}，` +
            `請確認 image/ 資料夾內的檔名是否完全一致（含全形/半形標點、副檔名大小寫）。` +
            `畫面目前可能仍停留在上一支成功播放的影片，看起來像「選錯地點」。`
        );
    };
    vid.src = targetSrc;
    vid.load();
    return vid;
}

// 歡迎畫面選好漁港時由 welcome-screen.js 呼叫：只先下載、不播放，
// 讓影片趁玩家看漁港資訊、按「守護漁港」、轉場動畫這段時間緩衝。
// 玩家改選別的漁港時會換成新漁港的影片重新下載。
window.preloadOceanVideo = function (locationId) {
    if (!locationId) return;
    setOceanVideoSrc(locationId);
};

// 播放背景影片；被瀏覽器擋下時（最常見：iPhone 開了低耗電模式，Safari 會擋掉
// 所有自動播放的影片，即使是靜音的；Android 省數據模式也可能如此），
// 改成等玩家下一次觸碰畫面再自動重試——瀏覽器允許「使用者操作後」播放。
// 原本失敗就直接忽略、不再重試，背景會一直是黑的，玩家以為是影片載入失敗。
var oceanRetryArmed = false; // 用 var：省電切換等較早執行的程式碼呼叫到時也不會碰到宣告前存取錯誤
function playOceanVideoWithRetry(vid) {
    vid.play().catch(() => {
        if (oceanRetryArmed) return; // 已經在等下一次觸碰了，不重複掛監聽
        oceanRetryArmed = true;
        const retry = () => {
            document.removeEventListener("touchstart", retry, true);
            document.removeEventListener("click", retry, true);
            oceanRetryArmed = false;
            if (powerSaveMode || !document.body.contains(vid)) return;
            if (vid.paused) playOceanVideoWithRetry(vid); // 還是被擋就再等下一次觸碰
        };
        document.addEventListener("touchstart", retry, { capture: true, passive: true });
        document.addEventListener("click", retry, true);
    });
}

function initOceanVideo(locationId) {
    const vid = setOceanVideoSrc(locationId);
    // 省電模式：只顯示第一幀當靜態背景，不播放
    if (powerSaveMode) {
        if (vid.readyState >= 2) vid.pause();
        else vid.addEventListener("loadeddata", () => vid.pause(), { once: true });
        return;
    }
    playOceanVideoWithRetry(vid);
}

// 由 wsStartGame() 在按下「守護漁港」的當下鎖住並傳入，
// 全程用這個值，不再於 initGame()／startGame() 執行當下重新讀取
// window.selectedLocationId／sessionStorage，避免 3 秒轉場動畫期間
// 這兩個共用可變狀態被清空所造成的「選錯地點」問題。
let lockedGameLocationId = null;

function initGame(lockedLocationId) {
	initChatLayer();
	document.body.classList.add('game-started');

    // ✅ 改用加入 class 的方式觸發淡出
    const welcomeScreen = document.getElementById("welcome-screen");
    welcomeScreen.classList.add("fade-out");

    // 優先使用呼叫端直接傳入的值；沒有傳入時（例如舊版呼叫方式）才 fallback
    // 回原本讀 window.selectedLocationId／sessionStorage 的邏輯，維持相容。
    lockedGameLocationId = lockedLocationId
        || window.selectedLocationId
        || sessionStorage.getItem("selectedLocationId")
        || "longfeng";

    // 提早開始緩衝背景海洋影片：不用等 3.5 秒淡出轉場結束才開始下載，
    // 讓影片有更多時間（淡出轉場 3.5 秒 + startGame 後渲染 2 秒 ≈ 5.5 秒）
    // 在畫面真正需要它之前完成緩衝，降低弱網環境下開局卡頓的機率。
    // 進入主遊戲才預載全部魚卡圖片（原本在頁面一開啟就下載，跟開場畫面搶網路）。
    // 這時轉場動畫還有約 5 秒，第一次發牌前有時間先下載好。
    // 魚卡全部下載完成後，接著預載說明頁音樂。
    preloadFishImages().then(preloadInfoBGM);

    {
        const earlyLocation = (typeof locationDB !== "undefined" && locationDB.find)
            ? locationDB.find(loc => loc.id === lockedGameLocationId) || locationDB[0]
            : null;
        initOceanVideo(earlyLocation ? earlyLocation.id : "longfeng");
    }
	
    // 啟動音樂與日誌
    // 頂端控制列（返回／收藏進度／召喚數／出牌記錄／省電／音樂／結算）整條一起顯示，
    // 裡面各按鈕的外觀與排列都由 CSS 的 #top-bar 規則負責。
    document.getElementById("top-bar").style.display = "flex";
    applyPowerSaveMode();
    const music = document.getElementById("bgm");
    const btn = document.getElementById("music-control");
    if (sfxEnabled) {
        music.play().then(() => {
            music.volume = 0.1;
            btn.style.filter = "";
            btn.innerText = "🔊";
            btn.style.opacity = "1";
        }).catch(() => {
            btn.innerText = "🔇";
            btn.style.opacity = "0.4";
        });
    } else {
        music.pause();
        btn.innerText = "🔇";
        btn.style.filter = "";
        btn.style.opacity = "0.4";
    }

    // 直接切換畫面並開始遊戲
    document.getElementById('player-hand').addEventListener('scroll', updateHandArrows);
    initDrawerGesture();
    setTimeout(() => {
        startGame();
    }, 3500); // 保留 3.5 秒的淡出過渡效果
}

/**
 * 建立一局新遊戲的初始狀態：
 *   1. 從 characterDB 隨機抽 3 位 AI 角色組隊（並解鎖對應同伴章）
 *   2. 依選擇的漁港（locationDB）篩選該海域的魚池，洗牌後發牌
 *      - 新手難度：玩家優先拿到「容易」等級（e:1）的魚，AI 則從剩餘牌池隨機抽
 *      - 標準/專業難度：完全隨機發牌，不分難易度
 *   3. 混合一般召喚卡與媽祖卡洗牌成 deckS 牌堆
 *   4. 新手保護機制：確保玩家前兩次抽到召喚卡時，手牌裡一定至少有一張能用的牌
 *      （透過交換 deckS 末端兩個位置的卡，避免新手一開局就卡關）
 *   5. 記錄初始手牌快照（供結束時寫入 LOG 分析）、重置行為勳章追蹤器
 *   6. 渲染畫面並在 2 秒後呼叫 autoStep() 開始第一回合
 */
function startGame() {
    // 保險：清掉上一局可能殘留的手牌翻面狀態，確保開局一定是魚圖頁
    clearTimeout(_flipBackTimer);
    _flipBackTimer = null;
    _cardsShowingInfo = false;
    _prevCardsShowingInfo = false;

// 1. 從資料庫中隨機挑選 3 個角色
    let aiPool = shuffle([...characterDB]).slice(0, 3);
    
    // 2. 初始化玩家與隨機選出的 AI
    players = [
        { n: (window.playerName && window.playerName.trim()) ? window.playerName.trim() : "你", hand: [], isAI: false }
    ];

    // 3. 將選出的 AI 加入 players 陣列，同時解鎖同伴章
    aiPool.forEach((char, index) => {
        // 頭像：預設用 jpg（靜態），只有輪到該 AI 出牌那一刻才切換成 webp（動態）。
        // jpg 路徑用同檔名、副檔名換成 .jpg 推導出來，請確保 image/ 資料夾內
        // 每個角色都同時有 xxx.jpg（靜態版）跟 xxx.webp（動態版）兩個檔案。
        const jpgSrc = char.img.replace(/\.webp$/i, ".jpg");
        players.push({
            n: char.n,
            hand: [],
            isAI: true,
            id: `ai-${index + 1}`,
            personality: char.personality,
            avatarJpg: `<img src="${jpgSrc}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`,
            avatarWebp: `<img src="${char.img}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`
        });
    });	
	
    const selectedLocationId = lockedGameLocationId || window.selectedLocationId || sessionStorage.getItem("selectedLocationId") || "longfeng";
    const matchedLocation = (typeof locationDB !== "undefined" && locationDB.find)
        ? locationDB.find(loc => loc.id === selectedLocationId)
        : null;
    if (!matchedLocation && typeof locationDB !== "undefined") {
        console.warn(
            `[地點比對失敗] selectedLocationId = ${JSON.stringify(selectedLocationId)}，` +
            `在 locationDB 裡找不到對應的 id，已 fallback 使用 locationDB[0]（${locationDB[0] && locationDB[0].name}）。` +
            `請檢查選場景畫面（例如 welcome-screen.js）寫入 selectedLocationId 時，是否跟 db.js 裡的 id 完全一致（含大小寫、空白）。`
        );
    }
    const currentLocation = matchedLocation || (typeof locationDB !== "undefined" ? locationDB[0] : null);
    initOceanVideo(currentLocation ? currentLocation.id : "longfeng");
    const locationFishNames = currentLocation ? new Set(currentLocation.fishPool) : null;

    // ── 解鎖漁港章（進入漁港即解鎖）──
    if (currentLocation && currentLocation.badge) {
        progress.unlockBadge(window.playerName, currentLocation.badge);
    }
    // 難度章：玩家勝利時才解鎖（見 showWinScreen）
    let fishD = shuffle(locationFishNames
        ? fishDB.filter(f => locationFishNames.has(f.n))
        : [...fishDB]
    );
    
    // 新手難度：玩家優先從 e:1（容易）牌池抽牌，AI 從剩餘隨機抽
    // 專業難度：完全隨機，不分等級
    if (gameDifficulty <= difficultyDB[0].value) {
        const easyPool   = fishD.filter(f => f.e === 1);
        const otherPool  = fishD.filter(f => f.e !== 1);
        const playerHand = [];
        // 玩家盡量拿 e:1 的牌（最多 6 張，不夠就從 otherPool 補）
        while (playerHand.length < 6) {
            if (easyPool.length > 0) playerHand.push(easyPool.splice(0, 1)[0]);
            else playerHand.push(otherPool.splice(0, 1)[0]);
        }
        players[0].hand = playerHand;
        // ── 解鎖初始手牌魚紋章 ──
        playerHand.forEach(f => progress.unlockFish(window.playerName, f.n));
        // AI 從剩餘（easyPool 剩餘 + otherPool）隨機抽
        const remaining = shuffle([...easyPool, ...otherPool]);
        players.slice(1).forEach(p => p.hand = remaining.splice(0, 6));
    } else {
        // 普通/專業：完全隨機
        players.forEach(p => p.hand = fishD.splice(0, 6));
        // ── 解鎖初始手牌魚紋章 ──
        players[0].hand.forEach(f => progress.unlockFish(window.playerName, f.n));
    }

    deckS = shuffle([...summonDB, ...mazuCards]);

    // 新手保護：確保玩家前2次召喚不會抽到沒牌可出的召喚卡
    // 4人輪流，玩家(callerIdx=0)的召喚在 deckS 末端：
    //   第1次玩家召喚 → deckS[length-1]（第1回合）
    //   第2次玩家召喚 → deckS[length-5]（第5回合）
    if (gameDifficulty <= difficultyDB[0].value) {
        const playerHand = players[0].hand;
        const isSafe = s => !s.isMazu && playerHand.some(f => { try { return s.c(f); } catch(e) { return false; } });

        const len = deckS.length;
        const slots = [len - 1, len - 5];
        const usedSwapSlots = new Set(slots); // 保護位置本身不能作為來源

        slots.forEach(slot => {
            if (slot < 0 || slot >= len) return;
            if (isSafe(deckS[slot])) return; // 已經安全，不換
            // 找一個不在保護位置、且是安全牌的位置來交換
            let swapFrom = -1;
            for (let i = 0; i < len; i++) {
                if (!usedSwapSlots.has(i) && isSafe(deckS[i])) { swapFrom = i; break; }
            }
            if (swapFrom === -1) return; // 找不到就放棄
            [deckS[slot], deckS[swapFrom]] = [deckS[swapFrom], deckS[slot]];
            usedSwapSlots.add(swapFrom); // 這個來源已被用，下次不能再用
        });
    }

    // 記錄初始手牌快照（遊戲結束時寫入 LOG 供分析）
    initialHands = players.map(p => ({
        name: p.n,
        hand: p.hand.map(f => ({ n: f.n, l: f.l, d: f.d, m: [...f.m], h: f.h, s: f.s }))
    }));
    // 清空上局紀錄
    roundLog = [];
    preGameMessage = "";
    gameEndSummary = null;
    // 重置行為型勳章追蹤
    badgeTracker = { playerCards: [], returnCount: 0, mazuCompleted: false, mazuGiftCard: null };
    
    // 難度標籤/數值改查 db.js 的 difficultyDB（見 getDifficultyInfo()），
    // 不在這裡重複寫 gameDifficulty <= 0.4 這類門檻判斷。
    const diffInfo = getDifficultyInfo(gameDifficulty);
    const diffLabel = `${diffInfo.label}(難度${diffInfo.value})`;
    const diffShort = diffInfo.label;
    const locationLabel = currentLocation ? currentLocation.name : "未指定海線";
    window.gameMeta = { locationLabel, diffLabel, diffShort };
    preGameMessage = `守護團集結！任務地點：${locationLabel}。難度：${diffLabel}。注意觀察大家的出牌...`;
    renderLog();

    // 顯示等待藍框（HTML 已預先填好文字）
    const overlay = document.getElementById("summon-focus-overlay");
    overlay.style.transition = "opacity 0.4s ease";
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "none";

    renderUI();
    setTimeout(autoStep, 2000);
}

// 在畫面上高亮目前的「召喚者」（玩家或某位 AI），
// 並只在輪到玩家操作（PLAYER_TURN／PLAYER_MAZU）時讓海底光束全開，增加聚焦感。
function updateCallerHighlight() {
    players.forEach((p, idx) => {
        let el = (idx === 0) ? document.getElementById("player-zone") : document.getElementById(p.id);
        if (el) {
            if (idx === callerIdx) el.classList.add("is-caller");
            else el.classList.remove("is-caller");
        }
    });
}

let summonFocusTimer = null;

/**
 * 顯示「召喚聚焦」遮罩：把本回合召喚文字放大置中顯示幾秒鐘，
 * 讓玩家／畫面有時間消化召喚內容，duration 毫秒後自動淡出並執行 callback。
 * 媽祖召喚會套用特殊樣式（mazu-style）。
 */
function showSummonFocus(duration, callback) {
    const overlay = document.getElementById("summon-focus-overlay");
    const box     = document.getElementById("summon-focus-box");

    // 清除上一輪殘留的 timer
    if (summonFocusTimer) {
        clearTimeout(summonFocusTimer);
        summonFocusTimer = null;
    }

    // 把召喚文字複製進遮罩框
    box.innerText = document.getElementById("summon-display").innerText;

    // 媽祖特殊樣式
    if (currentS && currentS.isMazu) {
        box.classList.add("mazu-style");
    } else {
        box.classList.remove("mazu-style");
    }

    // 重新觸發彈入動畫
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.animation = "summonPop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";

    // 顯示遮罩
    overlay.style.transition = "opacity 0.4s ease";
    overlay.style.opacity = "1";
    overlay.style.pointerEvents = "all";

    // duration 後自動淡出，再執行 callback
    summonFocusTimer = setTimeout(() => {
        overlay.style.transition = "opacity 0.8s ease";
        overlay.style.opacity = "0";
        overlay.style.pointerEvents = "none";
        summonFocusTimer = setTimeout(() => {
            summonFocusTimer = null;
            if (callback) callback();
        }, 800);
    }, duration);
}

/**
 * 每回合開始時呼叫：抽一張召喚卡，並依抽牌者是玩家或 AI 分流處理。
 *   - 牌堆已抽完（deckS.length===0）→ 比較所有人剩餘手牌數，最少的人獲勝，直接結束遊戲。
 *   - 召喚者是玩家 → 直接公開召喚內容，切換 phase 為 PLAYER_TURN／PLAYER_MAZU。
 *   - 召喚者是 AI → 召喚內容對玩家保密（"WAIT"），需等大家出牌後才會揭曉（見 showResult）。
 * 教學模式（tutorialMode）會跳過聚焦動畫直接往下執行；
 * 一般模式則會先顯示 1.5 秒的「召喚聚焦」遮罩，結束後才解鎖讓玩家／AI 行動。
 */
function autoStep() {
    lockUI(); // 每回合開始立刻鎖定
    // 保險：清掉上一輪可能殘留的「AI 出牌中」頭像動圖狀態
    activeAIIdx = -1; // 保險：清掉上一輪可能殘留的「AI 出牌中」頭像動圖狀態
    if (deckS.length === 0) { 
        if (roundCount > 0) {
            getRoundBucket(roundCount).notes.push("⚠ 召喚卡已用盡，開始結算剩餘手牌...");
        } else {
            preGameMessage += "\n⚠ 召喚卡已用盡，開始結算剩餘手牌...";
        }
        renderLog();
                // 找出手中剩餘卡牌最少的玩家
        let winner = players[0];
        for (let i = 1; i < players.length; i++) {
            // 若牌數相同，目前邏輯會保留順位較前（例如玩家本人）的優先權
            if (players[i].hand.length < winner.hand.length) {
                winner = players[i];
            }
        }
        // 延遲一秒後顯示勝利畫面
        const isPlayerWin = winner === players[0];
        showCountdownBubble(4, () => {
            isPlayerWin ? SFX.win() : SFX.lose();
            showWinScreen(winner);
        });
        return;
    }
	
    table = [];
    roundCount++;
    chatQueue.clear(); // 新回合開始，清空對話佇列
    roundChatCount = 0; // 重置對話計數器
	document.getElementById("table").innerHTML = "";
    document.getElementById("summon-display").classList.remove("mazu-glow");
    
    currentS = deckS.pop();
    renderUI();
    const caller = players[callerIdx];
    updateCallerHighlight();

    // 頭像 webp／jpg 現在只跟「這回合誰是召喚者」綁在一起：
    // 召喚者是 AI → 整回合（從這裡開始，到下一輪 autoStep 重新判定為止）都顯示 webp；
    // 召喚者是玩家 → 沒有 AI 需要顯示 webp，全部維持 jpg。
    // 跟牌動作本身（aiMove）不再單獨觸發 webp 切換。
    if (callerIdx !== 0) {
        setActiveAI(callerIdx);
    } else {
        clearActiveAI();
    }

    if (callerIdx === 0) {
        SFX.draw(); // 玩家抽到召喚牌
        {
            const b = getRoundBucket(roundCount);
            b.callerName = players[0].n;
            b.isMazu = !!currentS.isMazu;
            b.summonText = currentS.t;
        }
        renderLog();
        const sdEl = document.getElementById("summon-display");
        sdEl.style.display = "flex";
        sdEl.innerText = (currentS.isMazu ? "【神明指示】\n" : "【你的召喚】\n") + currentS.t;
        phase = currentS.isMazu ? "PLAYER_MAZU" : "PLAYER_TURN";
        renderUI();
    } else {
        getRoundBucket(roundCount).callerName = caller.n;
        renderLog();
        const sdEl2 = document.getElementById("summon-display");
        sdEl2.style.display = "flex";
        sdEl2.innerText = `【${caller.n}】抽到了神祕召喚！\n觀察對手出的魚，推敲召喚是什麼...`;
        phase = "WAIT";
    }

    // 教學模式不顯示遮罩，直接執行後續動作
    if (typeof tutorialMode !== "undefined" && tutorialMode) {
        if (currentS && currentS.isMazu) {
            document.getElementById("summon-display").classList.add("mazu-glow");
            if (callerIdx !== 0) { handleMazuAI(caller); }
        } else {
            if (callerIdx !== 0) {
                let idx = aiChooseCard(players[callerIdx]);
                aiMove(callerIdx, idx);
                phase = "PLAYER_TURN";
                renderUI();
            }
        }
        return;
    }

    // 聚焦遮罩：1.5秒後自動關閉才開放行動
    showSummonFocus(1500, () => {
        if (currentS.isMazu) {
            document.getElementById("summon-display").classList.add("mazu-glow");
            SFX.mazu();
            if (callerIdx === 0) unlockUI(); // 玩家是媽祖召喚者，解鎖讓選牌
            else handleMazuAI(caller);
        } else {
            if (callerIdx !== 0) {
                let idx = aiChooseCard(players[callerIdx]);
                aiMove(callerIdx, idx);
                phase = "PLAYER_TURN";
                renderUI();
                unlockUI(); // AI 召喚完畢，玩家要跟牌，解鎖
            } else {
                unlockUI(); // 玩家自己是召喚者，解鎖讓出牌
            }
        }
    });
}

/**
 * 處理「AI 抽到媽祖卡」的贈牌流程：
 *   AI 會從自己手牌隨機挑一張卡，並選擇一位贈送對象——
 *   70% 機率送給「目前手牌最少的人」（多人並列時隨機選一位，鼓勵幫助快獲勝的人），
 *   30% 機率完全隨機選一位。新手難度下 AI 不會把牌送給真人玩家（避免變相洩漏優勢）。
 *   接著播放贈牌飛行動畫與雙方對話泡泡，最後才把牌真正加入對方手牌並進入下一回合。
 */
function handleMazuAI(caller) {
    document.getElementById("summon-display").innerText = "【神明庇佑揭曉】\n" + currentS.t;
    {
        const b = getRoundBucket(roundCount);
        b.isMazu = true;
        b.summonText = currentS.t;
    }
    renderLog();

    setTimeout(() => {
        if (caller.hand.length === 0) { finishRound(); return; }

        let card = caller.hand.pop();

        // 目標選擇：70% 送給手牌最少的人（多人並列時隨機選一位），30% 隨機送給任一人
        // 新手模式：AI 只能送給其他 AI，不能送給玩家
        const isNovice = gameDifficulty <= difficultyDB[0].value;
        const others = players.filter(p => p !== caller && (isNovice ? p.isAI : true));

        // 若新手模式下其他 AI 全空，fallback 到所有人（避免死鎖）
        const pool = others.length > 0 ? others : players.filter(p => p !== caller);

        let target;
        if (Math.random() < 0.70) {
            const minCount = Math.min(...pool.map(p => p.hand.length));
            const fewest = pool.filter(p => p.hand.length === minCount);
            target = fewest[Math.floor(Math.random() * fewest.length)];
        } else {
            target = pool[Math.floor(Math.random() * pool.length)];
        }
        const callerEl = document.getElementById(caller.id); // 送牌者的實際 AI 格子
        const targetEl = target.isAI
            ? document.getElementById(target.id)
            : document.getElementById("player-zone");
        showMazuGiftEffect(caller.n, target.n, card, targetEl, callerEl);

        // 1. 送牌者先說話
        aiTalkMazuGive(caller, target, card);

        // 2. 停頓 2 秒後，執行送牌動作與接收者說話
        setTimeout(() => {
            target.hand.push(card);
            // ── 若送給玩家，解鎖魚紋章 ──
            if (!target.isAI) progress.unlockFish(window.playerName, card.n);
            SFX.gift();
            getRoundBucket(roundCount).shares.push({ from: caller.n, to: target.n, card: card.n });
            renderLog();
            
            // 3. 如果接收者是 AI，接著說話
            if (target.isAI) {
                aiTalkMazuReceive(target, caller, card);
            }
            
            renderUI();

            // 不顯示倒數氣泡，等 banner 自然消失後才進入下一回合
            setTimeout(finishRound, 5500);
            
        }, 2000); // 這裡是兩次說話之間的 2 秒停頓

    }, 3000);
}

// 媽祖贈牌：選擇對象
// 玩家抽到媽祖卡時，彈出「要把這張卡送給誰」的選擇清單（排除玩家自己）。
function showMazuTargetSelect(cardIdx) {
    const existing = document.getElementById("mazu-target-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "mazu-target-overlay";

    const card = players[0].hand[cardIdx];
    const targets = players.slice(1); // 排除玩家自己

    overlay.innerHTML = `
        <div class="mazu-overlay-title">🙏 神明指示：分享資源</div>
        <div class="mazu-overlay-sub">
            送出【${card.n}】給誰？
        </div>
    `;

    targets.forEach((p, i) => {
        const btn = document.createElement("button");
        btn.className = "mazu-target-btn";
        btn.innerHTML = `
            <span>${p.n}</span>
            <span class="btn-cards">🎴×${p.hand.length}</span>
        `;
        btn.onclick = () => {
            overlay.remove();
            confirmMazuGift(cardIdx, p);
        };
        overlay.appendChild(btn);
    });

    document.body.appendChild(overlay);
}

// 媽祖贈牌：確認送出
// 玩家確認媽祖贈牌對象後：把卡從玩家手牌移除、播放贈牌動畫、
// 加入對方手牌、記錄行為勳章（mazuCompleted），最後進入結算流程。
// ⚠️ 教學模式進行中時，tutorial.js 的 patchPlayerAction() 內部會暫時
//    整個覆蓋這個 window.confirmMazuGift（monkey-patch），教學結束/
//    離開媽祖籤流程後才會還原。修改此函式簽名時請同步檢查 tutorial.js。
function confirmMazuGift(cardIdx, target) {
    const card = players[0].hand.splice(cardIdx, 1)[0];

    const targetEl = document.getElementById(target.id);
    const playerEl = document.getElementById("player-zone");
    showMazuGiftEffect("你", target.n, card, targetEl, playerEl);

    target.hand.push(card);
    SFX.gift();
    getRoundBucket(roundCount).shares.push({ from: players[0].n, to: target.n, card: card.n });
    renderLog();

    // 記錄媽祖贈牌
    badgeTracker.mazuCompleted = true;
    badgeTracker.mazuGiftCard = card;

    if (target.isAI) {
        aiTalkMazuReceive(target, players[0], card);
    }

    phase = "RESULT";
    renderUI();
    lockUI(); // 等 banner 顯示完畢
    setTimeout(finishRound, 5500);
}

// =============================================
// 🎴 出牌飛行動畫
// =============================================
/**
 * 出牌飛行動畫：建立一張卡片的 DOM 分身，從 fromEl（出牌者位置）飛到桌面區，
 * 動畫結束（1.55 秒）後自動移除分身並執行 callback（通常是 renderTable()）。
 */
function playCardFlyAnimation(card, fromEl, callback) {
    const tableEl = document.getElementById("table");
    const oceanEl = document.getElementById("ocean");
    if (!fromEl || !oceanEl) { if (callback) callback(); return; }

    const fromRect = fromEl.getBoundingClientRect();
    const toRect   = (tableEl || oceanEl).getBoundingClientRect();

    const startX = fromRect.left + fromRect.width  / 2 - 45;
    const startY = fromRect.top  + fromRect.height / 2 - 65;
    const endX   = toRect.left   + toRect.width    / 2 - 45;
    const endY   = toRect.top    + 20;

    const fly = document.createElement("div");
    fly.style.cssText = `
        position: fixed;
        left: ${startX}px;
        top:  ${startY}px;
        width: 90px;
        border-radius: 10px;
        overflow: hidden;
        pointer-events: none;
        z-index: 5000;
        background: linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(200,230,255,0.08) 100%);
        border: 1.5px solid rgba(160,200,255,0.3);
        box-shadow: 0 0 0 3px rgba(80,120,180,0.2), 0 8px 24px rgba(0,10,40,0.6), 0 0 16px rgba(100,160,255,0.25);
        transition: none;
        transform: translateZ(0);
        will-change: transform, opacity;
        backface-visibility: hidden;
    `;

    const lightBg = card.l === 1 ? "#d4f5e2" : card.l === 2 ? "#fef3cd" : "#ffd6da";
    fly.innerHTML = `
        <div style="background:${lightBg}; font-size:0.85rem; font-weight:900; text-align:center; padding:5px 2px; color:#444; border-bottom:1px solid rgba(0,0,0,0.1);">${card.n}</div>
        <div style="height:38px; overflow:hidden;">
            <img src="fishdb/${card.n}.png" onerror="this.style.display='none'" style="width:100%; height:100%; object-fit:cover;">
        </div>
    `;
    document.body.appendChild(fly);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const dx = endX - startX;
            const dy = endY - startY;
            fly.style.transition = "transform 1.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 1.5s ease";
            fly.style.transform  = `translate(${dx}px, ${dy}px) scale(0.75)`;
            fly.style.opacity    = "0";
        });
    });

    setTimeout(() => {
        fly.remove();
        if (callback) callback();
    }, 1550);
}

/**
 * 玩家點擊／確認出某一張手牌時的主要處理函式。
 * @param {number} idx 該張牌在 players[0].hand 中的索引
 *
 * - phase 為 PLAYER_MAZU：代表這是媽祖贈牌流程，改呼叫 showMazuTargetSelect() 選對象。
 * - phase 為 PLAYER_TURN：正常出牌流程——
 *     1. 把牌從手牌移到桌面，鎖定 UI 防止重複操作
 *     2. 播放出牌飛行動畫
 *     3. 隨機讓 1~2 位 AI 對這張牌做出反應（受每回合對話上限 roundChatCount 限制）
 *     4. 依序讓其餘所有 AI（非召喚者）跟牌出牌（aiMove），中間穿插延遲製造節奏感
 *     5. 全部出完後解鎖 UI 並呼叫 showResult() 進入結算判定
 *
 * ⚠️ 此函式會被 tutorial.js 的 patchPlayerAction() 整個攔截包裝
 *    （monkey-patch，見 tutorial.js 對應區塊的警語）。若修改此函式的
 *    名稱或參數簽名，務必同步檢查 tutorial.js。
 */
async function playerAction(idx) {
    if (navigator.vibrate) navigator.vibrate(30);

    if (phase === "PLAYER_MAZU") {
        // 先選目標，再確認送牌
        showMazuTargetSelect(idx);
        return;
    } else if (phase === "PLAYER_TURN") {
        const fish = players[0].hand[idx];
        players[0].hand.splice(idx, 1);
        SFX.card();
        table.push({ pIdx: 0, card: fish });
        phase = "AI_FOLLOWING";
        lockUI(); // 出牌後鎖定，防止亂點

        renderUI();

        const fromEl = document.getElementById("player-zone");
        playCardFlyAnimation(fish, fromEl, () => renderTable());

        // 玩家出牌後：隨機抽 1～2 個 AI 說話，受回合上限控制
        const aiPlayers = players.filter(p => p.isAI);
        const shuffled = aiPlayers.sort(() => Math.random() - 0.5);
        const count = Math.random() < 0.5 ? 1 : 2;
        shuffled.slice(0, count).forEach(p => {
            if (roundChatCount >= 2) return;
            const isCorrect = currentS && currentS.c ? currentS.c(fish) : null;
            queueAITalk(p, fish, isCorrect);
            roundChatCount++;
        });

        await new Promise(resolve => setTimeout(resolve, 1550));
        for (let pi = 0; pi < players.length; pi++) {
            const p = players[pi];
            if (p.isAI && pi !== callerIdx) {
                let matchIdx = aiChooseCard(p);
                await new Promise(resolve => setTimeout(resolve, 600));
                aiMove(pi, matchIdx); 
            }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
        unlockUI(); // AI 全部出完才解鎖
        showResult();
		
    }
}

/**
 * 執行某位 AI（players[pI]）出第 cI 張手牌的動作：
 * 從手牌移除該卡、播放飛行動畫、更新畫面，並依機率安排該 AI／其他旁觀 AI 講話。
 */
function aiMove(pI, cI) {
    const p = players[pI];
	if (!p.hand[cI]) return;

    const f = p.hand.splice(cI, 1)[0];

    SFX.cardAI();
    table.push({ pIdx: pI, card: f });

    const fromEl = document.getElementById(p.id);
    playCardFlyAnimation(f, fromEl, () => renderTable());

    renderAIStatus();

    const isCorrect = currentS && currentS.c ? currentS.c(f) : null;

    // 出牌的 AI：50% 機率說話，受回合上限控制
    if (roundChatCount < 2 && Math.random() < 0.5) {
        queueAITalk(p, f, isCorrect);
        roundChatCount++;
    }

    // 其他 AI：隨機抽 1 個說話，受回合上限控制
    if (roundChatCount < 2) {
        const others = players.filter(other => other.isAI && other !== p);
        if (others.length) {
            const speaker = others[Math.floor(Math.random() * others.length)];
            queueAITalk(speaker, f, null);
            roundChatCount++;
        }
    }
}

// =============================================
// 🔙 退牌飛行動畫（ocean → 手牌區）
// =============================================
/**
 * 退牌飛行動畫：與 playCardFlyAnimation() 方向相反，
 * 把卡片從桌面區飛回原本出牌者的位置（toEl），用於「不符合召喚條件」的牌被退回手牌時。
 */
function playCardReturnAnimation(card, toEl, callback) {
    const tableEl = document.getElementById("table");
    const oceanEl = document.getElementById("ocean");
    if (!toEl || !oceanEl) { if (callback) callback(); return; }

    const fromRect = (tableEl || oceanEl).getBoundingClientRect();
    const toRect   = toEl.getBoundingClientRect();

    const startX = fromRect.left + fromRect.width  / 2 - 45;
    const startY = fromRect.top  + 20;
    const endX   = toRect.left   + toRect.width    / 2 - 45;
    const endY   = toRect.top    + toRect.height   / 2 - 65;

    const fly = document.createElement("div");
    const lightBg = card.l === 1 ? "#d4f5e2" : card.l === 2 ? "#fef3cd" : "#ffd6da";
    fly.style.cssText = `
        position: fixed;
        left: ${startX}px;
        top:  ${startY}px;
        width: 90px;
        border-radius: 10px;
        overflow: hidden;
        pointer-events: none;
        z-index: 5000;
        opacity: 0;
        background: linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(200,230,255,0.08) 100%);
        border: 1.5px solid rgba(255,100,100,0.5);
        box-shadow: 0 0 0 3px rgba(180,60,60,0.2), 0 8px 24px rgba(40,0,0,0.5), 0 0 16px rgba(255,80,80,0.2);
        transition: none;
        transform: translateZ(0);
        will-change: transform, opacity;
        backface-visibility: hidden;
    `;
    fly.innerHTML = `
        <div style="background:${lightBg}; font-size:0.85rem; font-weight:900; text-align:center; padding:5px 2px; color:#444; border-bottom:1px solid rgba(0,0,0,0.1);">${card.n}</div>
        <div style="height:38px; overflow:hidden;">
            <img src="fishdb/${card.n}.png" onerror="this.style.display='none'" style="width:100%; height:100%; object-fit:cover;">
        </div>
    `;
    document.body.appendChild(fly);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const dx = endX - startX;
            const dy = endY - startY;
            fly.style.transition = "transform 1.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 1.5s ease";
            fly.style.transform  = `translate(${dx}px, ${dy}px) scale(1.1)`;
            fly.style.opacity    = "1";
        });
    });

    setTimeout(() => {
        fly.style.transition = "opacity 0.3s ease";
        fly.style.opacity = "0";
        setTimeout(() => {
            fly.remove();
            if (callback) callback();
        }, 300);
    }, 1500);
}

// 全域暫存：本回合需要退回的牌
let pendingReturns = [];
let roundCount = 0;

/**
 * 本回合所有人都出牌完畢後呼叫：逐一比對桌面上每張牌是否符合本回合召喚條件（currentS.c），
 *   - AI 是召喚者時，揭曉原本保密的召喚文字
 *   - 符合條件 → 記錄成功；不符合 → 暫存進 pendingReturns，結算畫面關閉後才播放退牌動畫
 *   - 同時依召喚條件文字關鍵字（燈號／漁法／產地／季節／棲地…）推斷要顯示哪些特徵標籤
 *   - 判斷此回合是否已經有人手牌出完（exclude 仍在退牌動畫中的人）→ 是則直接結束遊戲
 *   - 否則等待倒數氣泡後，依 showSummaryMode 開關決定要不要顯示完整結算彈窗
 */
function showResult() {
    phase = "RESULT";
    roundReport = [];
    pendingReturns = [];

    // AI 是召喚者時，全員出牌後才揭曉召喚條件
        if (callerIdx !== 0 && currentS && !currentS.isMazu) {
            const callerName = players[callerIdx].n;
            {
                const b = getRoundBucket(roundCount);
                b.callerName = callerName;
                b.isMazu = false;
                b.summonText = currentS.t;
            }
            renderLog();
            document.getElementById("summon-display").innerText = `【${callerName}的召喚】\n${currentS.t}`;
        }
        table.forEach(t => {
            const isSuccess = currentS.c(t.card);
            const player = players[t.pIdx];
            const condText = currentS.t; 
            
            // 使用陣列來收集所有相關的特性
            let featuresFound = [];

            // 1. 檢查是否包含「燈號/永續等級」相關關鍵字
            if (["燈", "綠", "黃", "紅"].some(k => condText.includes(k))) {
                featuresFound.push(t.card.l === 1 ? "綠燈" : (t.card.l === 2 ? "黃燈" : "紅燈"));
            }

            // 2. 檢查是否包含「捕撈方式」相關關鍵字
            if (["網", "釣", "一支", "延繩", "圍網", "刺網", "籠具", "禁止捕撈", "標槍"].some(k => condText.includes(k))) {
                featuresFound.push(t.card.m.join("、"));
            }

            // 3. 檢查是否包含「來源/產地」相關關鍵字
            if (["養殖", "近海", "遠洋"].some(k => condText.includes(k))) {
                featuresFound.push(t.card.d);
            }

            // 4. 檢查是否包含「季節」相關關鍵字
            if (["春", "夏", "秋", "冬", "全年"].some(k => condText.includes(k))) {
                featuresFound.push(t.card.s);
            }

            // 5. 檢查是否包含「棲息地」相關關鍵字
            if (["洄游", "定棲", "底棲"].some(k => condText.includes(k))) {
                featuresFound.push(t.card.h);
            }

            // 最終呈現字串：如果以上都沒對應到，預設顯示燈號；若有多項則用 " | " 隔開
            let finalFeatureStr = featuresFound.length > 0 
                ? featuresFound.join(" | ") 
                : (t.card.l === 1 ? "綠燈" : (t.card.l === 2 ? "黃燈" : "紅燈"));

            roundReport.push({
                name: player.n,
                fishName: t.card.n,
                isSuccess: isSuccess,
                feature: finalFeatureStr
            });

            getRoundBucket(roundCount).plays.unshift({ name: player.n, card: t.card.n, light: t.card.l, success: isSuccess });

            if (isSuccess) {
                // 記錄玩家出牌（成功）
                if (!player.isAI) badgeTracker.playerCards.push({ card: t.card, isSuccess: true });
            } else {
                // 先暫存，等結算頁關閉後再動畫退回
                pendingReturns.push({ card: t.card, player });
                // 記錄玩家出牌（退回）並累計退牌數
                if (!player.isAI) {
                    badgeTracker.playerCards.push({ card: t.card, isSuccess: false });
                    badgeTracker.returnCount++;
                }
            }
        });
        renderLog();

        renderUI();

        // ⚠️ 勝負判定：排除仍在 pendingReturns 等待退牌的玩家
        // hand.length===0 但牌還在退回途中，不算真正出完
        const realWin = players.find(p =>
            p.hand.length === 0 &&
            !pendingReturns.some(r => r.player === p)
        );
        if (realWin) {
            const isPlayerWin = realWin === players[0];
            showCountdownBubble(4, () => {
                isPlayerWin ? SFX.win() : SFX.lose();
                showWinScreen(realWin);
            });
            return;
        }

        // 顯示倒數氣泡，2秒後進入結算
        showCountdownBubble(2, () => {
            if (showSummaryMode) {
                showRoundSummary();
            } else {
                playPendingReturns(() => finishRound());
            }
        });
}

// 顯示一個會自動倒數的提示泡泡（例如「N 秒後進入結算」），倒數結束後執行 callback。
function showCountdownBubble(seconds, callback) {
    const layer = document.getElementById("chat-layer");
    const ocean = document.getElementById("ocean");
    if (!layer || !ocean) { callback(); return; }

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble countdown-bubble";
    bubble.style.cssText = `
        position: fixed;
        left: 50%;
        transform: translateX(-50%) translateZ(0);
        bottom: 130px;
        z-index: 1500;
        font-size: 1.2rem;
        text-align: center;
        pointer-events: none;
    `;
    layer.appendChild(bubble);
    bubble.innerHTML = `<span class="countdown-bubble-icon">📋</span> <span class="countdown-bubble-count"></span> 秒後進入結算，可先點牌放大查看`;
    const countEl = bubble.querySelector(".countdown-bubble-count");

    let remaining = seconds;
    function tick() {
        if (countEl) countEl.textContent = remaining;
        if (remaining <= 0) {
            bubble.remove();
            callback();
            return;
        }
        remaining--;
        setTimeout(tick, 1000);
    }
    tick();
}

// 檢查是否已經有玩家手牌清空（獲勝），若有則顯示勝利畫面；否則進入下一回合。
function finishRound() {
    let win = players.find(p => p.hand.length === 0);
    if (win) {
        const isPlayerWin = win === players[0];
        isPlayerWin ? SFX.win() : SFX.lose();
        showWinScreen(win);
        return;
    }
    proceedToNextRound();
}

// 新增：處理下一回合的邏輯轉換
// 切換到下一回合：重新洗牌每位 AI 的手牌順序（避免 AI 因陣列順序固定而每次都選同一張牌），
// 召喚者輪替到下一位玩家／AI，重置狀態為 WAIT 並呼叫 autoStep() 開始新回合。
function proceedToNextRound() {
    // 每回合結束後重排所有玩家手牌，避免 AI 因陣列順序固定而每次選同一張
    players.forEach(p => { if (p.isAI) shuffle(p.hand); });
    callerIdx = (callerIdx + 1) % players.length;
    phase = "WAIT";
    autoStep();
}

// 結算頁關閉後，同時播所有退牌動畫，全部結束後才加入手牌
// 結算彈窗關閉後，把本回合所有「不符合條件而需退回」的牌同時播放退牌動畫，
// 等全部動畫播完才真正把牌加回各自手牌並執行 callback（通常是 proceedToNextRound）。
function playPendingReturns(callback) {
    if (pendingReturns.length === 0) { if (callback) callback(); return; }

    const playerZone = document.getElementById("player-zone");
    let done = 0;
    const total = pendingReturns.length;

    pendingReturns.forEach(({ card, player }) => {
        const toEl = player.isAI ? document.getElementById(player.id) : playerZone;
        playCardReturnAnimation(card, toEl, () => {
            player.hand.push(card);
            done++;
            if (done === total) {
                pendingReturns = [];
                renderUI();
                if (callback) callback();
            }
        });
    });
}

// 新增：彈出視窗函式
/**
 * 顯示本回合結算彈窗：列出每張出牌的玩家／魚名／是否成功，並用屬性條（buildAttrBars）
 * 視覺化呈現該張牌符合或違反的具體特徵；同時顯示本次召喚條件原文與生態小知識。
 * 玩家按下「整理魚獲，繼續冒險」後才會關閉彈窗並播放退牌動畫、進入下一回合。
 */
function showRoundSummary() {

    if (!showSummaryMode) {
        proceedToNextRound();
        return;
    }

    if (roundReport.some(r => r.isSuccess)) SFX.success();

    // ── 屬性條產生器 ──
    function buildAttrBars(feature, isSuccess) {
        const attrs = feature.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
        if (!attrs.length) return '';
        const barW  = isSuccess ? '100%' : '22%';
        const barC  = isSuccess ? '#3ecf6e' : '#e05555';
        const textC = isSuccess ? '#7eeaa8' : '#f08080';
        const mark  = isSuccess ? '✓' : '✗';
        return attrs.map(attr => `
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;min-width:0;">
                <span style="flex:1;min-width:0;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;flex-shrink:0;">
                    <span style="display:block;width:${barW};height:100%;background:${barC};border-radius:2px;"></span>
                </span>
                <span style="font-size:10px;color:${textC};word-break:break-all;flex-shrink:1;text-align:right;">${attr} ${mark}</span>
            </div>`).join('');
    }

    // ── 玩家卡（2欄 grid）──
    // 偶數：正常 1 欄，奇數最後一張跨欄
    const total = roundReport.length;
    const cardsHtml = roundReport.map((r, i) => {
        const delay   = 0.10 + i * 0.08;
        const isLast  = i === total - 1;
        const isOdd   = total % 2 === 1;
        const span    = (isLast && isOdd) ? 'grid-column:1/-1;' : '';
        const bg      = r.isSuccess
            ? 'background:linear-gradient(135deg,#0a2e1a,#0d3d22);border:1.5px solid #3a9e5f;'
            : 'background:linear-gradient(135deg,#2a0f0f,#361212);border:1.5px solid #8b3030;';
        const nameC   = r.isSuccess ? '#90f0b8' : '#f4a0a0';
        const badge   = r.isSuccess
            ? `<span style="font-size:14px;animation:rsPulse 1.4s infinite;display:inline-block;">⭐</span>`
            : `<span style="font-size:10px;color:#f07070;background:rgba(200,50,50,0.2);border:1px solid rgba(200,50,50,0.4);padding:1px 7px;border-radius:8px;">退牌</span>`;

        // 跨欄時橫向排列
        if (isLast && isOdd) {
            return `
            <div style="${bg}${span}border-radius:13px;padding:8px 10px;min-width:0;overflow:hidden;
                        animation:rsSlideUp .26s ${delay}s ease both;">
                <div style="display:flex;align-items:center;gap:14px;">
                    <div style="flex:0 0 auto;">
                        <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
                            <span style="font-size:11px;color:rgba(255,255,255,0.42);">${r.name}</span>
                            ${badge}
                        </div>
                        <div style="font-size:16px;font-weight:bold;color:${nameC};">${r.fishName}</div>
                    </div>
                    <div style="flex:1;min-width:0;">
                        ${buildAttrBars(r.feature, r.isSuccess)}
                    </div>
                </div>
            </div>`;
        }

        return `
        <div style="${bg}border-radius:13px;padding:8px 9px;min-width:0;overflow:hidden;
                    animation:rsSlideUp .26s ${delay}s ease both;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:18px;color:rgba(255,255,255,0.42);">${r.name}</span>
                ${badge}
            </div>
            <div style="font-size:20px;font-weight:bold;color:${nameC};margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.fishName}</div>
            ${buildAttrBars(r.feature, r.isSuccess)}
        </div>`;
    }).join('');

    // ── 共用卡片樣式（召喚條件 & 生態知識）──
    const sharedCard = `background:linear-gradient(135deg,rgba(0,70,110,0.7),rgba(0,40,80,0.7));
                        border:1.5px solid rgba(60,170,255,0.28);border-radius:13px;`;

    // ── 生態知識 ──
    const ecoDelay = 0.10 + total * 0.08 + 0.06;
    const ecoHtml  = currentS.why ? `
        <div style="${sharedCard}padding:7px 11px;margin-bottom:10px;
                    animation:rsSlideUp .26s ${ecoDelay}s ease both;">
            <div style="font-size:12px;color:#60c8f0;font-weight:bold;margin-bottom:3px;">🌊 生態小知識</div>
            <div style="font-size:16px;color:rgba(190,235,255,0.88);line-height:1.6;">${currentS.why}</div>
        </div>` : '';

    // ── overlay ──
    const overlay = document.createElement("div");
    overlay.id = "round-summary-overlay";
    overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(4,12,22,0.92);display:flex;justify-content:center;
        align-items:center;box-sizing:border-box;
        z-index:4000;
    `;

    // ── modal ──
    const modal = document.createElement("div");
    modal.style.cssText = `
        background:linear-gradient(170deg,#0d2137 0%,#081626 100%);
        border-radius:20px;border:1px solid rgba(255,255,255,0.07);
        width:92%;max-width:400px;
        max-height:82vh;overflow-y:auto;
        padding:12px 11px 14px;box-sizing:border-box;
        animation:rsSlideDown .36s ease-out both;
    `;

    modal.innerHTML = `
        <style>
            @keyframes rsSlideDown {
                from { transform:translateY(-30px); opacity:0; }
                to   { transform:translateY(0);     opacity:1; }
            }
            @keyframes rsSlideUp {
                from { transform:translateY(13px); opacity:0; }
                to   { transform:translateY(0);    opacity:1; }
            }
            @keyframes rsPulse {
                0%,100% { opacity:1; } 50% { opacity:.4; }
            }
            #round-summary-overlay ::-webkit-scrollbar { width:3px; }
            #round-summary-overlay ::-webkit-scrollbar-track { background:transparent; }
            #round-summary-overlay ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.15);border-radius:2px; }
        </style>

        <div style="${sharedCard}padding:7px 11px;margin-bottom:8px;
                    animation:rsSlideUp .26s .04s ease both;">
            <div style="font-size:12px;color:#60c8f0;letter-spacing:1.5px;margin-bottom:2px;">📜 本回召喚條件 📜</div>
            <div style="font-size:16px;color:#fff;font-weight:bold;line-height:1.4;">${currentS.t}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;min-width:0;">
            ${cardsHtml}
        </div>

        ${ecoHtml}

        <button id="close-summary-btn" style="
            width:100%;padding:11px;border:none;border-radius:50px;
            font-size:22px;font-weight:900;cursor:pointer;letter-spacing:0.5px;
            background:linear-gradient(135deg,#f5c842,#e07828);
            color:#1a0800;
            box-shadow:0 4px 0 #8a4200, 0 6px 14px rgba(200,100,0,0.3);
            text-shadow:none;
        ">整理魚獲，繼續冒險</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("close-summary-btn").onclick = () => {
        overlay.remove();
        lockUI();
        playPendingReturns(() => proceedToNextRound());
    };
}

/**
 * AI 出牌策略核心：依玩家當下難度設定（gameDifficulty）與該 AI 的個性
 * （smart 提高難度／chaotic、tricky 降低難度）算出最終 difficulty 值，
 * 再分兩種情境決定要出哪張牌：
 *
 *   情境 A：AI 是「召喚者」（自己先出牌，桌面是空的）
 *     依 correctChance 機率決定要不要刻意出符合召喚條件的牌，
 *     若手上根本沒有符合的牌則直接記錄到 log 並隨機出牌。
 *
 *   情境 B：AI 是「跟牌者」（桌面已有其他人出的牌，需推測召喚條件）
 *     比對手牌與桌面已出牌的共同特徵（燈號／棲地／產地／季節／漁法）算出吻合分數，
 *     再依 difficulty 換算出的機率，從「最佳匹配」「部分匹配」「完全不匹配」三組牌池中
 *     抽一張出牌——difficulty 越高，越常抽到「最佳匹配」（代表 AI 推測得越準）。
 *
 * @param {object} p 該位 AI 的 players[] 物件
 * @returns {number} 要出的牌在 p.hand 中的索引
 */
function aiChooseCard(p) {
    let difficulty = gameDifficulty;

    if (p.personality === "smart")   difficulty += 0.15;
    if (p.personality === "chaotic") difficulty -= 0.25;
    if (p.personality === "tricky")  difficulty -= 0.1;

    difficulty = Math.max(0.05, Math.min(0.97, difficulty));

    // ── 情境 A：AI 是召喚者（自己先出，table 為空）──
    if (table.length === 0) {
        const validCards = p.hand
            .map((f, idx) => ({ f, idx }))
            .filter(c => currentS && currentS.c && currentS.c(c.f));

        const invalidCards = p.hand
            .map((f, idx) => ({ f, idx }))
            .filter(c => !(currentS && currentS.c && currentS.c(c.f)));

        // 召喚者出正確牌的機率：
        // 公式：min(0.95, max(0.50, 1.030 - 0.537 * difficulty))
        // 新手+chaotic(eff=0.15) → 95%、專業+smart(eff=0.97) → 51%
        // 永遠不低於 50%（避免反指標）、不高於 95%（保留少量不確定性）
        const correctChance = Math.min(0.95, Math.max(0.50, 1.030 - 0.537 * difficulty));
        const playCorrect = Math.random() < correctChance;

        // 問題3：手上沒有符合牌時，記錄到 log 讓玩家知道
        if (validCards.length === 0) {
            // 先靜默記錄，不立刻 renderLog()：避免玩家在結算揭曉前就從畫面/紀錄面板
            // 搶先看到「召喚者沒有符合牌」這個提示，提早推測出召喚條件的嚴苛程度。
            // 真正顯示的時機交給 showResult() 揭曉召喚內容時統一 renderLog()。
            getRoundBucket(roundCount).notes.push(`⚠ ${p.n}沒有符合牌，隨機出牌`);
            return Math.floor(Math.random() * p.hand.length);
        }

        const pool = playCorrect ? validCards : (invalidCards.length > 0 ? invalidCards : validCards);
        return pool[Math.floor(Math.random() * pool.length)].idx;
    }

    // ── 情境 B：AI 是跟牌者（看桌面推測召喚條件）──
    const played = table.map(t => t.card);

    // 預先計算桌面牌的共同特徵，避免在 forEach 內重複運算（修 Bug2）
    const allSameL = played.every(f => f.l === played[0].l);
    const allSameH = played.every(f => f.h === played[0].h);
    const allSameD = played.every(f => f.d === played[0].d);

    // 季節：找出桌面牌都共有的季節（全年視為包含所有季節）
    const seasons = ["春", "夏", "秋", "冬"];
    const commonSeasons = seasons.filter(s =>
        played.every(f => f.s.includes("全年") || f.s.includes(s))
    );
    // 桌面所有牌都有的共同漁法
    const commonMethods = played[0].m.filter(method =>
        played.every(f => f.m.includes(method))
    );

    // 評分：比對手牌與桌面共同特徵的吻合度
    let candidates = p.hand.map((f, idx) => {
        let score = 0;
        if (allSameL && f.l === played[0].l) score++;
        if (allSameH && f.h === played[0].h) score++;
        if (allSameD && f.d === played[0].d) score++;
        // 季節：手牌含全年、或含任一共同季節，給分
        if (commonSeasons.length > 0 &&
            (f.s.includes("全年") || commonSeasons.some(s => f.s.includes(s))))
            score++;
        // 漁法：手牌含任一共同漁法，給分
        if (commonMethods.length > 0 && commonMethods.some(m => f.m.includes(m)))
            score++;
        return { f, idx, score };
    });

    candidates.sort((a, b) => b.score - a.score);
    const topScore = candidates[0].score;

    // 三組：最佳匹配、部分匹配、完全不匹配
    const bestPool    = candidates.filter(c => c.score === topScore && topScore > 0);
    const partialPool = candidates.filter(c => c.score > 0 && c.score < topScore);
    const wrongPool   = candidates.filter(c => c.score === 0);

    // 手牌沒有任何特徵吻合（topScore === 0）：只能隨機，難度無法幫助
    if (topScore === 0) {
        return candidates[Math.floor(Math.random() * candidates.length)].idx;
    }

    // 跟牌邏輯：目標永遠是盡量跟對牌（清手牌）
    // 難度影響的是「推測能力」：高難度估得準（best 機率高），低難度估得不準（偶爾落到 partial）
    // 任何情況都不主動選 wrong pool（跟錯牌退回來對自己沒好處）
    //
    // 機率分配：
    //   difficulty 0.97（smart 專業）→ best 97%、partial 3%、wrong 0%
    //   difficulty 0.55（smart 新手）→ best 80%、partial 18%、wrong 2%
    //   difficulty 0.15（chaotic 新手）→ best 60%、partial 33%、wrong 7%
    //
    // 公式：
    //   P(best)    = 0.45 + difficulty * 0.535   → clamp [0.60, 0.97]
    //   P(partial) = (1 - P(best)) * 0.80
    //   P(wrong)   = (1 - P(best)) * 0.20

    const pBest    = Math.min(0.97, Math.max(0.60, 0.45 + difficulty * 0.535));
    const pPartial = (1 - pBest) * 0.80;
    // pWrong = (1 - pBest) * 0.20（剩餘）

    const roll = Math.random();
    if (roll < pBest) {
        return bestPool[Math.floor(Math.random() * bestPool.length)].idx;
    } else if (roll < pBest + pPartial) {
        if (partialPool.length > 0)
            return partialPool[Math.floor(Math.random() * partialPool.length)].idx;
        return bestPool[Math.floor(Math.random() * bestPool.length)].idx;
    } else {
        // 極低機率的 wrong（估錯），若 wrongPool 空則退回 partial 或 best
        if (wrongPool.length > 0)
            return wrongPool[Math.floor(Math.random() * wrongPool.length)].idx;
        if (partialPool.length > 0)
            return partialPool[Math.floor(Math.random() * partialPool.length)].idx;
        return bestPool[Math.floor(Math.random() * bestPool.length)].idx;
    }
}

// 在某位角色（p）頭頂上方彈出一個對話泡泡，顯示 msg 文字，
// 會自動依角色位置置中並限制在畫面寬度內，3 秒後自動移除。
function showChat(p, msg) {
    const layer = document.getElementById("chat-layer");
    const el = document.getElementById(p.id);
    if (!layer || !el) return;

    const rect = el.getBoundingClientRect();

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.innerText = msg;

    layer.appendChild(bubble);

    // 👉 先讓它出現在畫面（才能拿寬度）
    const bubbleWidth = bubble.offsetWidth;

    // 🎯 計算中心位置
    let left = rect.left + rect.width / 2 - bubbleWidth / 2;

    // 🚧 邊界限制（重點）
    const padding = 10;
    const maxLeft = window.innerWidth - bubbleWidth - padding;

    if (left < padding) left = padding;
    if (left > maxLeft) left = maxLeft;

    bubble.style.left = left + "px";
    bubble.style.top = rect.top - 10 + "px";

    setTimeout(() => bubble.remove(), 3000);
}

// 組合台詞並加入 queue
/**
 * 依角色個性（dialogueDB[persona]）與出牌情境挑選一句合適的台詞並排進對話佇列。
 * @param {object} p 講話的 AI
 * @param {object} card 該次出的牌（用來判斷紅燈/綠燈/養殖等特殊台詞池）
 * @param {boolean|null} isCorrectGuess 若已知這張牌出錯（false）會優先使用「出錯」專屬台詞
 */
function queueAITalk(p, card, isCorrectGuess) {
    const persona = p.personality;
    const db = dialogueDB[persona];
    let pool = [];

    if (isCorrectGuess === false && db.playWrong) pool.push(...db.playWrong);

    if (card) {
        if (card.l === 3 && db.playRed)          pool.push(...db.playRed);
        else if (card.l === 1 && db.playGreen)   pool.push(...db.playGreen);
        if (card.d === "養殖" && db.playFarm)    pool.push(...db.playFarm);
    }

    if (!pool.length) pool = [...db.play];

    const msg = pool[Math.floor(Math.random() * pool.length)];
    chatQueue.push(p, msg);
}

// 保留 aiTalk 作為向後相容（目前已無直接呼叫，備用）
// 舊版函式名稱，目前程式內已無直接呼叫，保留作為對外相容介面（內部直接轉呼叫 queueAITalk）。
function aiTalk(p, card, isCorrectGuess = null) {
    queueAITalk(p, card, isCorrectGuess);
}

// 媽祖贈牌時，「贈送者」AI 說一句對應的台詞（dialogueDB[persona].mazuGive）。
function aiTalkMazuGive(p, target, card) {
    const lines = dialogueDB[p.personality].mazuGive;
    const msg = lines[Math.floor(Math.random() * lines.length)];
    chatQueue.push(p, msg);
}

// 媽祖贈牌時，「接收者」AI 說一句對應的台詞（dialogueDB[persona].mazuReceive）。
function aiTalkMazuReceive(p, from, card) {
    const lines = dialogueDB[p.personality].mazuReceive;
    const msg = lines[Math.floor(Math.random() * lines.length)];
    chatQueue.push(p, msg);
}




/**
 * 播放媽祖贈牌的完整視覺效果：卡片從贈送者飛向接收者（CSS 動畫，經由 --fly-x/--fly-y
 * 等自訂屬性控制弧線路徑），動畫播完 2 秒後再彈出「OO 分享了【魚名】給 OO」橫幅，
 * 橫幅停留 3 秒後淡出移除。
 */
function showMazuGiftEffect(fromName, toName, card, targetEl, fromEl) {
    const flyLayer = document.createElement("div");
    flyLayer.id = "mazu-gift-effect";
    document.body.appendChild(flyLayer);

    // 起點：直接用傳入的 fromEl，fallback 到 player-zone 或 char-area
    const resolvedFromEl = fromEl
        || (fromName === "你"
            ? document.getElementById("player-zone")
            : document.querySelector(".char-area"));
    const toEl = targetEl || document.querySelector(".char-area");

    const fromRect = (resolvedFromEl || document.body).getBoundingClientRect();
    const toRect   = (toEl          || document.body).getBoundingClientRect();

    const startX = fromRect.left + fromRect.width  / 2 - 40;
    const startY = fromRect.top  + fromRect.height / 2 - 55;
    const endX   = toRect.left   + toRect.width    / 2 - 40;
    const endY   = toRect.top    + toRect.height   / 2 - 55;

    const flyCard = document.createElement("div");
    flyCard.className = `mazu-gift-card-fly`;
    const mazuLightBg = card.l === 1 ? "#d4f5e2" : card.l === 2 ? "#fef3cd" : "#ffd6da";
    flyCard.style.cssText = `
        position: fixed;
        left: ${startX}px;
        top:  ${startY}px;
        width: 90px;
        border-radius: 10px;
        overflow: hidden;
        pointer-events: none;
        background: linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(200,230,255,0.08) 100%);
        border: 1.5px solid rgba(160,200,255,0.3);
        box-shadow: 0 0 0 3px rgba(80,120,180,0.2), 0 8px 24px rgba(0,10,40,0.6), 0 0 16px rgba(100,160,255,0.25);
        --fly-x: ${endX - startX}px;
        --fly-y: ${endY - startY}px;
        --fly-x2: ${endX - startX + 20}px;
        --fly-y2: ${endY - startY - 20}px;
        transform: translateZ(0);
        will-change: transform, opacity;
        backface-visibility: hidden;
    `;
    flyCard.innerHTML = `
        <div style="background:${mazuLightBg}; font-size:0.85rem; font-weight:900; text-align:center; padding:5px 2px; color:#444; border-bottom:1px solid rgba(0,0,0,0.1);">${card.n}</div>
        <div style="height:38px; overflow:hidden;">
            <img src="fishdb/${card.n}.png" onerror="this.style.display='none'" style="width:100%; height:100%; object-fit:cover;">
        </div>
    `;
    flyLayer.appendChild(flyCard);

    // 橫幅說明（飛行結束後才彈出，2秒後）
    setTimeout(() => {
        const banner = document.createElement("div");
        banner.className = "mazu-gift-banner";
        banner.innerHTML = `
            <div class="banner-icon">🙏</div>
            <div class="banner-img-wrap">
                <img src="fishdb/${card.n}.png"
                     onerror="this.parentNode.style.display='none'"
                     alt="${card.n}">
            </div>
            <div class="banner-from">${fromName} 分享</div>
            <div class="banner-fish">【${card.n}】</div>
            <div class="banner-to">➜ ${toName}</div>
        `;
        document.body.appendChild(banner);

        // 6 秒後淡出移除
        setTimeout(() => {
            banner.style.transition = "opacity 0.6s";
            banner.style.opacity = "0";
            flyLayer.style.transition = "opacity 0.6s";
            flyLayer.style.opacity = "0";
            setTimeout(() => { banner.remove(); flyLayer.remove(); }, 600);
        }, 3000);
    }, 2000);
}

// =============================================
// 🗂️ 手牌抽屜（Drawer）系統
// =============================================

let drawerOpen = false;

// 顯示／隱藏「上滑開啟抽屜」的提示箭頭；若提示被隱藏但抽屜還開著，順便關閉抽屜。
function updateDrawerArrow(show) {
    const arrow = document.getElementById("drawer-up-arrow");
    if (arrow) arrow.style.display = show ? "block" : "none";
    if (!show && drawerOpen) closeDrawer();
}

/**
 * 開啟手機版「手牌抽屜」（從畫面底部滑出的手牌格狀檢視，方便小螢幕快速選牌出牌）。
 * 第一次開啟時會動態建立 DOM 並綁定下滑關閉的觸控事件，之後重複呼叫只需重新渲染內容。
 */
function openDrawer() {
    if (drawerOpen) return;
    drawerOpen = true;

    let drawer = document.getElementById("hand-drawer");
    if (!drawer) {
        drawer = document.createElement("div");
        drawer.id = "hand-drawer";
        document.body.appendChild(drawer); // fixed 定位，掛在 body

        let dy0 = 0;
        drawer.addEventListener("touchstart", (e) => {
            dy0 = e.touches[0].clientY;
        }, { passive: true });
        drawer.addEventListener("touchend", (e) => {
            if (e.changedTouches[0].clientY - dy0 > 50) closeDrawer();
        }, { passive: true });
    }

    renderDrawer(drawer);
    drawer.style.display = "block";
    requestAnimationFrame(() => {
        drawer.style.transform = "translateY(0)";
    });
}

// 關閉手牌抽屜（先位移出畫面，280ms 動畫結束後才真正隱藏，避免動畫被切斷）。
function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    const drawer = document.getElementById("hand-drawer");
    if (!drawer) return;
    drawer.style.transform = "translateY(100%)";
    setTimeout(() => { if (!drawerOpen) drawer.style.display = "none"; }, 280);
}

// 重新渲染抽屜內的卡牌格狀清單；若現在輪到玩家的一般出牌回合，
// 符合本回合召喚條件的卡片會加上 .drawer-valid 樣式與綠點提示。
// 點擊卡片會先關閉抽屜，再呼叫 playerAction() 出牌。
function renderDrawer(drawer) {
    const isNormalTask = currentS && !currentS.isMazu && phase === "PLAYER_TURN" && callerIdx === 0;

    drawer.innerHTML = `
        <div class="drawer-handle-bar"></div>
        <div class="drawer-hint">點卡直接出牌 ／ 下滑收起</div>
        <div class="drawer-grid" id="drawer-grid"></div>
    `;

    const grid = drawer.querySelector("#drawer-grid");

    players[0].hand.forEach((f, idx) => {
        const isValid = isNormalTask && currentS.c(f);

        const wrap = document.createElement("div");
        wrap.className = "drawer-card-wrap";

        const card = document.createElement("div");
        card.className = `drawer-card light-${f.l}${isValid ? " drawer-valid" : ""}`;

        card.innerHTML = `
            <div class="drawer-card-name">${f.n}</div>
            <div class="drawer-card-img">
                <img src="fishdb/${f.n}.png" alt="${f.n}" onerror="this.style.display='none'">
            </div>
            <div class="drawer-card-tags">${getFishTags(f)}</div>
        `;

        if (isValid) {
            const dot = document.createElement("span");
            dot.className = "drawer-valid-dot";
            wrap.appendChild(dot);
        }

        card.onclick = (e) => {
            e.stopPropagation();
            closeDrawer();
            setTimeout(() => playerAction(idx), 50);
        };

        wrap.appendChild(card);
        grid.appendChild(wrap);
    });
}

// 初始化手牌區的上滑手勢偵測
let drawerGestureInited = false;
/**
 * 在手牌區（#player-zone）綁定「往上滑動」手勢偵測，用來開啟手牌抽屜。
 * 透過比較垂直/水平位移量判斷使用者是否為「刻意垂直上滑」（而非左右瀏覽手牌），
 * 一旦判定為上滑且輪到玩家操作，才會呼叫 openDrawer()。只會初始化一次。
 */
function initDrawerGesture() {
    if (drawerGestureInited) return;
    drawerGestureInited = true;
    const zone = document.getElementById("player-zone");
    if (!zone) return;

    let startY = 0, startX = 0;
    let intentDecided = false, isVerticalSwipe = false;

    zone.addEventListener("touchstart", (e) => {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        intentDecided = false;
        isVerticalSwipe = false;
    }, { passive: true });

    zone.addEventListener("touchmove", (e) => {
        if (drawerOpen) return;
        // win-screen 顯示中不干擾
        if (document.getElementById("win-overlay")) return;
        const dy = e.touches[0].clientY - startY;
        const dx = Math.abs(e.touches[0].clientX - startX);

        if (!intentDecided) {
            if (Math.abs(dy) < 8 && dx < 8) return;
            isVerticalSwipe = Math.abs(dy) > dx;
            intentDecided = true;
        }
        // 確認往上垂直滑 → 阻止頁面捲動
        if (isVerticalSwipe && dy < 0) {
            e.preventDefault();
        }
    }, { passive: false });

    zone.addEventListener("touchend", (e) => {
        if (!intentDecided || !isVerticalSwipe || drawerOpen) return;
        if (document.getElementById("win-overlay")) return;
        const dy = e.changedTouches[0].clientY - startY;
        const dx = Math.abs(e.changedTouches[0].clientX - startX);
        if (dy < -40 && dx < 60) {
            const isMyTurn = phase === "PLAYER_TURN" || phase === "PLAYER_MAZU";
            if (isMyTurn) openDrawer();
        }
    }, { passive: true });
}

// 點抽屜外背景關閉
// 點擊抽屜以外的區域（背景）時自動關閉抽屜；若勝利畫面已開啟則直接關閉抽屜不做其他判斷。
document.addEventListener("touchstart", (e) => {
    if (!drawerOpen) return;
    if (document.getElementById("win-overlay")) { closeDrawer(); return; }
    const drawer = document.getElementById("hand-drawer");
    if (drawer && !drawer.contains(e.target)) closeDrawer();
}, { passive: true });

// 切換「是否顯示回合結算彈窗」(showSummaryMode) 開關，按鈕圖示會疊加一個紅色 ✕ 表示已關閉。
// 關閉當下若剛好有結算彈窗開著，會直接移除並接著播放退牌動畫、進入下一回合。
function toggleReportMode() {
    showSummaryMode = !showSummaryMode;
    const btn = document.getElementById("report-control");
    if (showSummaryMode) {
        btn.style.opacity = "1";
        btn.innerHTML = "🧮";
    } else {
        btn.style.opacity = "0.85";
        btn.innerHTML = `<span style="filter:grayscale(1);display:inline-block;">🧮</span><span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.2em;font-weight:900;color:#ff2222;pointer-events:none;">✕</span>`;
        // 關掉時清除可能殘留的結算 overlay
        const existing = document.getElementById("round-summary-overlay");
        if (existing) {
            existing.remove();
            playPendingReturns(() => proceedToNextRound());
        }
    }
}

// ── 行為型勳章追蹤（每局重置）────────────────
// 行為型勳章（例如「百發百中」「浴火重生」）需要追蹤整局的出牌歷程，
// 因此用這個物件記錄「玩家本局出過的每張牌與成功與否」「被退牌次數」「是否完成媽祖贈牌」等，
// 每次 startGame() 開新局時都會被重新初始化（見 startGame 內的重置邏輯）。
let badgeTracker = {
    playerCards: [],      // 本局玩家出過的每張牌 {card, isSuccess}
    returnCount: 0,       // 被退牌次數
    mazuCompleted: false, // 是否完成過媽祖贈牌
    mazuGiftCard: null,   // 媽祖贈出的牌
};

// ── 聯絡我們 ──
/**
 * 開啟「聯絡我們」表單彈窗：重置表單欄位與送出按鈕狀態，
 * 並監聽隱藏 iframe 的 onload 事件來判斷表單是否已成功送出
 *（用隱藏 iframe 接收表單 submit 結果，可避免頁面整個重新整理）。
 */
function openContact() {
    var overlay = document.getElementById("contact-overlay");
    overlay.style.display = "flex";
    // 重置表單
    var form = document.getElementById("contact-form");
    if (form) form.reset();
    var msgEl = document.getElementById("contact-msg");
    if (msgEl) msgEl.textContent = "";
    var btn = document.getElementById("contact-submit-btn");
    if (btn) { btn.disabled = false; btn.textContent = "送出留言"; }
    // 偵測 iframe 載入（表示送出完成）
    var iframe = document.querySelector('iframe[name="contact-iframe"]');
    if (iframe) {
        iframe.onload = function() {
            // 第一次載入是空白頁，忽略；之後的載入才是送出結果
            if (iframe._submitted) {
                var msgEl = document.getElementById("contact-msg");
                var btn = document.getElementById("contact-submit-btn");
                if (msgEl) { msgEl.style.color = "rgba(120,220,160,.9)"; msgEl.textContent = "✓ 留言已送出，謝謝您！"; }
                if (btn) { btn.textContent = "已送出"; }
                setTimeout(closeContact, 1800);
            }
        };
    }
    // 監聽送出事件，標記已送出
    var form2 = document.getElementById("contact-form");
    if (form2) {
        form2.onsubmit = function() {
            var iframe2 = document.querySelector('iframe[name="contact-iframe"]');
            if (iframe2) iframe2._submitted = true;
            var btn2 = document.getElementById("contact-submit-btn");
            var msgEl2 = document.getElementById("contact-msg");
            if (btn2) { btn2.disabled = true; btn2.textContent = "送出中…"; }
            if (msgEl2) msgEl2.textContent = "";
        };
    }
}
// 關閉「聯絡我們」表單彈窗，並重置 iframe 的送出旗標，避免下次誤判為已送出。
function closeContact() {
    document.getElementById("contact-overlay").style.display = "none";
    var iframe = document.querySelector('iframe[name="contact-iframe"]');
    if (iframe) iframe._submitted = false;
}

/* ═════════════════════════════════════════════════════════════
   效能／耗電優化：App 切到背景時暫停音樂、音效與動畫
   ─────────────────────────────────────────────────────────────
   手機瀏覽器切到背景（鎖螢幕、切別的 App、切分頁）時，若沒有主動
   暫停，BGM／Web Audio／所有 CSS infinite 動畫都會繼續在背景跑，
   是很典型的隱形耗電來源。

   這裡刻意不去「點名」個別的 bgm 變數，因為專案裡實際上散落著好幾組
   各自獨立的音樂：主畫面 #bgm、intro.js 的 bgmEl、圖鑑/新手教學共用
   的 main.js infoBGM、win-screen.js 內部作用域的 winBgm……未來很可能
   還會再加。只認 id="bgm" 的舊寫法，就是為什麼新手教學切背景時音樂
   沒被暫停到（教學用的是 infoBGM，不是 #bgm）。

   改成攔截 HTMLMediaElement.prototype.play，凡是被呼叫過 play() 的
   <audio>／<video>（不論是 DOM 裡的元素還是 `new Audio()` 產生、沒
   掛在 DOM 上的物件）都會自動被追蹤，背景暫停時全部一起暫停、回到
   前景時只恢復「當初真的是我們暫停的那些」，不會動到使用者自己按過
   靜音、原本就沒在播的音樂。之後不管哪個檔案再新增一組 BGM，都不用
   回來改這支腳本。
   ═════════════════════════════════════════════════════════════ */
(function () {

    // ── 自動追蹤所有播放過的 <audio>/<video> ──
    var _knownMedia = new Set();
    var _origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
        _knownMedia.add(this);
        return _origPlay.apply(this, arguments);
    };

    var _pausedByUs = new Set();

    function pauseForBackground() {
        // 1. 暫停所有「目前正在播放」的音樂／音效（只記錄是我們暫停的，
        //    使用者自己本來就暫停/靜音的不會被誤記到）
        _pausedByUs.clear();
        _knownMedia.forEach(function (media) {
            if (!media.paused) {
                _pausedByUs.add(media);
                media.pause();
            }
        });

        // 2. 暫停 SFX 用的 Web Audio（合成音效的 AudioContext）
        try {
            if (window.SFX && typeof SFX.getCtx === 'function') {
                var ctx = SFX.getCtx();
                if (ctx && ctx.state === 'running') ctx.suspend();
            }
        } catch (e) { /* AudioContext 尚未建立或不支援，略過 */ }

        // 3. 暫停所有 CSS infinite 動畫（呼吸光暈、箭頭閃爍、翻牌等，
        //    不論目前在主畫面、教學、圖鑑還是勝負畫面都會套用到）
        document.body.classList.add('app-bg-paused');

        // 4. 停止 welcome-screen 漣漪 canvas 的 requestAnimationFrame 迴圈
        if (typeof window._wsStopWaves === 'function') {
            window._wsStopWaves();
        }
    }

    function resumeFromBackground() {
        // 1. 只恢復剛剛真的是被我們暫停掉的那些音樂
        _pausedByUs.forEach(function (media) {
            media.play().catch(function () { /* 需要使用者互動才能播放時忽略 */ });
        });
        _pausedByUs.clear();

        // 2. 恢復 Web Audio
        // 註：這裡呼叫 resume() 沒有 iOS 手勢限制的問題，因為 AudioContext
        // 早在使用者一開始點擊進入遊戲時就已經被解鎖過一次了，這裡只是
        // 從背景返回時恢復被系統自動 suspend 掉的狀態（詳見 sfx.js 檔頭）。
        try {
            if (window.SFX && typeof SFX.getCtx === 'function') {
                var ctx = SFX.getCtx();
                if (ctx && ctx.state === 'suspended') ctx.resume();
            }
        } catch (e) { /* 略過 */ }

        // 3. 恢復 CSS 動畫
        document.body.classList.remove('app-bg-paused');

        // 4. 若 welcome-screen 目前可見，重新啟動漣漪動畫
        var ws = document.getElementById('welcome-screen');
        if (ws && ws.style.display !== 'none' && ws.style.display !== '' &&
            typeof window._wsStartWaves === 'function') {
            window._wsStartWaves();
        }
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            pauseForBackground();
        } else {
            resumeFromBackground();
        }
    });

    // iOS Safari 部分情境（滑掉 App、直接關螢幕）只會觸發 pagehide，
    // 不一定會先觸發 visibilitychange，額外補一層保險。
    window.addEventListener('pagehide', pauseForBackground);

})();
