// ======================
// 🐟 新手教學模組 tutorial.js
// ======================

let tutorialMode  = false;
let tutorialPhase = "idle";
let tutorialLockedCardIdx = -1;

// ======================
// 🎨 注入樣式
// ======================
(function injectTutorialStyles() {
    const s = document.createElement("style");
    s.textContent = `

    /* ══ 頂部老師面板：固定在最頂，不遮手牌 ══ */
    #tutor-panel {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 9900;  /* 高過遮罩 9800 */
        display: none;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        padding: 6px 10px 6px;
        background: linear-gradient(180deg,
            rgba(4,18,46,0.98) 0%,
            rgba(4,18,46,0.93) 80%,
            rgba(4,18,46,0.0) 100%);
        box-sizing: border-box;
        pointer-events: none;
    }

    #tutor-avatar {
        font-size: 1.9rem;
        flex-shrink: 0;
        filter: drop-shadow(0 2px 8px rgba(100,200,255,0.7));
        animation: tutorBob 2s ease-in-out infinite;
    }
    @keyframes tutorBob {
        0%,100%{ transform:translateY(0); }
        50%     { transform:translateY(-5px); }
    }

    #tutor-bubble {
        flex: 1;
        background: linear-gradient(135deg,rgba(227,229,232,0.90),rgba(250,250,250,0.8));
        border: 1.5px solid rgba(100,200,255,0.5);
        border-radius: 12px;
        padding: 6px 12px;
        font-size: 0.8rem;
        line-height: 1.3;
		color: rgb(9,11,66);
        white-space: pre-line;
        box-shadow: 0 0 14px rgba(60,160,255,0.18);
    }

    #tutor-next-btn {
        flex-shrink: 0;
        background: linear-gradient(135deg,#1a6fcc,#0d4a9e);
        border: 1.5px solid rgba(140,210,255,0.5);
        border-radius: 20px;
        color: #fff;
        font-size: 0.78rem;
        font-weight: 700;
        padding: 7px 12px;
        cursor: pointer;
        display: none;
        box-shadow: 0 3px 10px rgba(20,80,200,0.5);
        pointer-events: all;   /* 面板 pointer-events:none，這裡打開 */
        -webkit-tap-highlight-color: transparent;
        white-space: nowrap;
    }
    #tutor-next-btn:active { transform:scale(0.93); }

    /* ══ 導覽遮罩：clip-path 挖洞 spotlight ══
       z-index 9800，高過遊戲所有元素（max 9000）
       clip-path 由 JS 動態設定，挖出高亮區                ══ */
    #tutor-overlay {
        position: fixed;
        inset: 0;
        z-index: 9800;
        /* 預設滿版暗色；JS 會用 clip-path 挖洞 */
        background: rgba(0,4,18,0.86);
        display: none;
        pointer-events: none;  /* 視覺暗化用，點擊穿透 */
        transition: clip-path 0.35s ease;
    }

    /* 高亮區：純粹用來做亮邊動畫的偽元素覆蓋層
       它本身在遮罩之上 (z-index 9850)，pointer-events off */
    #tutor-hl-ring {
        position: fixed;
        z-index: 9850;
        display: none;
        border: 2.5px solid rgba(80,210,255,0.95);
        border-radius: 12px;
        pointer-events: none;
        box-shadow:
            0 0 0 4px rgba(60,180,255,0.12),
            0 0 28px rgba(60,180,255,0.55),
            inset 0 0 16px rgba(60,180,255,0.08);
        animation: tutorRingPulse 1.5s ease-in-out infinite;
    }
    @keyframes tutorRingPulse {
        0%,100%{
            box-shadow: 0 0 0 4px rgba(60,180,255,0.12),
                        0 0 28px rgba(60,180,255,0.5),
                        inset 0 0 14px rgba(60,180,255,0.08);
        }
        50%{
            box-shadow: 0 0 0 8px rgba(60,180,255,0.06),
                        0 0 52px rgba(60,180,255,0.75),
                        inset 0 0 22px rgba(60,180,255,0.14);
        }
    }

    /* ══ 指定手牌（金色閃爍）══ */
    .tutor-target-card {
        outline: 3px solid rgba(255,215,50,0.95) !important;
        outline-offset: 5px !important;
        border-radius: 10px !important;
        position: relative !important;
        z-index: 400 !important;
        cursor: pointer !important;
        animation: tutorGold 1.1s ease-in-out infinite !important;
    }
    @keyframes tutorGold {
        0%,100%{ box-shadow:0 0 0 5px rgba(255,200,40,0.18),0 0 20px rgba(255,180,0,0.32); }
        50%     { box-shadow:0 0 0 9px rgba(255,200,40,0.08),0 0 38px rgba(255,180,0,0.58); }
    }

    /* ══ 鎖定手牌 ══ */
    .tutor-locked {
        opacity: 0.22 !important;
        pointer-events: none !important;
        filter: grayscale(0.85) !important;
    }

    /* ══ 結算老師氣泡（醒目）══ */
    .tutor-sum-bubble {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: linear-gradient(135deg,rgba(8,28,68,0.99),rgba(4,16,48,0.99));
        border: 2px solid rgba(100,210,255,0.75);
        border-radius: 14px;
        padding: 11px 13px;
        margin: 8px 0 10px;
        box-shadow: 0 0 0 3px rgba(60,160,255,0.1), 0 0 22px rgba(60,160,255,0.28);
        animation: tSumIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    @keyframes tSumIn {
        from{ transform:scale(0.82) translateY(12px); opacity:0; }
        to  { transform:scale(1)    translateY(0);    opacity:1; }
    }
    .tutor-sum-bubble .tsb-icon { font-size:1.5rem; flex-shrink:0; line-height:1.2; }
    .tutor-sum-bubble .tsb-text {
        font-size:0.88rem; line-height:1.58;
        color:rgb(255,215,0); white-space:pre-line; font-weight:600;
    }

    /* ══ 教學結束彈窗 ══ */
    #tutor-end-modal {
        position: fixed;
        inset: 0;
        z-index: 9500;
        background: rgba(4,12,22,0.88);
        display: none;
        justify-content: center;
        align-items: center;
        padding: 16px;
        box-sizing: border-box;
    }
    #tutor-end-box {
        background: linear-gradient(170deg,#0d2137,#081626);
        border: 1.5px solid rgba(100,200,255,0.28);
        border-radius: 20px;
        padding: 28px 22px;
        width: 100%;
        max-width: 310px;
        box-sizing: border-box;
        text-align: center;
        animation: tSumIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    .t-end-emoji { font-size:2.8rem; margin-bottom:10px; }
    .t-end-title { font-size:1.3rem; font-weight:900; color:#dff0ff; letter-spacing:.06em; margin-bottom:8px; }
    .t-end-desc  { font-size:0.85rem; color:rgba(180,220,255,0.78); line-height:1.65; margin-bottom:20px; white-space:pre-line; }
    .t-end-btn   {
        width:100%; padding:13px; border:none; border-radius:50px;
        font-size:1rem; font-weight:900; color:#1a0800; cursor:pointer;
        background:linear-gradient(135deg,#f5c842,#e07828);
        box-shadow:0 4px 0 #8a4200,0 6px 14px rgba(200,100,0,0.28);
        -webkit-tap-highlight-color:transparent;
    }
    .t-end-btn:active{ transform:scale(0.97); }

    `;
    document.head.appendChild(s);
})();

// ======================
// 🏗️ 建立 DOM
// ======================
function buildTutorialDOM() {
    if (!document.getElementById("tutor-panel")) {
        const panel = document.createElement("div");
        panel.id = "tutor-panel";
        panel.innerHTML = `
            <div id="tutor-avatar">🐟</div>
            <div id="tutor-bubble"></div>
            <button id="tutor-next-btn" onclick="tutorNextStep()">下一步 ▶</button>
        `;
        document.body.appendChild(panel);
    }

    if (!document.getElementById("tutor-overlay")) {
        const ov = document.createElement("div");
        ov.id = "tutor-overlay";
        document.body.appendChild(ov);
    }

    if (!document.getElementById("tutor-hl-ring")) {
        const ring = document.createElement("div");
        ring.id = "tutor-hl-ring";
        document.body.appendChild(ring);
    }

    if (!document.getElementById("tutor-end-modal")) {
        const m = document.createElement("div");
        m.id = "tutor-end-modal";
        m.innerHTML = `
            <div id="tutor-end-box">
                <div class="t-end-emoji">🎉</div>
                <div class="t-end-title">全部學會了！</div>
                <div class="t-end-desc">觀察桌面的牌推測條件\n選對的魚出牌，最快出完就贏！\n\n去挑戰真實對手吧 🌊</div>
                <button class="t-end-btn" onclick="tutorFinish()">回主畫面，開始冒險！</button>
            </div>
        `;
        document.body.appendChild(m);
    }
}

// ======================
// 🗣️ 老師說話
// ======================
function tutorSay(text, showNext) {
    const panel  = document.getElementById("tutor-panel");
    const bubble = document.getElementById("tutor-bubble");
    const btn    = document.getElementById("tutor-next-btn");
    if (!panel || !bubble) return;
    panel.style.display = "flex";
    bubble.textContent  = text;
    if (btn) btn.style.display = showNext ? "block" : "none";
}

function tutorHide() {
    const panel = document.getElementById("tutor-panel");
    if (panel) panel.style.display = "none";
}

// ======================
// ✨ 高亮：clip-path 挖洞 + 亮邊框
// ======================
const _PADDING = 10; // 高亮框比元素多出的 px

function tutorHighlight(selector) {
    tutorClearHighlight();
    const el = document.querySelector(selector);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x1 = Math.max(0, rect.left   - _PADDING);
    const y1 = Math.max(0, rect.top    - _PADDING);
    const x2 = Math.min(W, rect.right  + _PADDING);
    const y2 = Math.min(H, rect.bottom + _PADDING);

    // clip-path polygon：滿版矩形中挖出目標區（evenodd 規則）
    const overlay = document.getElementById("tutor-overlay");
    if (overlay) {
        overlay.style.clipPath = [
            `polygon(evenodd,`,
            `0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0,`,          // 外框
            `${x1}px ${y1}px, ${x1}px ${y2}px,`,                      // 洞（逆時針）
            `${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`
        ].join(" ");
    }

    // 亮邊框定位
    const ring = document.getElementById("tutor-hl-ring");
    if (ring) {
        ring.style.left   = x1 + "px";
        ring.style.top    = y1 + "px";
        ring.style.width  = (x2 - x1) + "px";
        ring.style.height = (y2 - y1) + "px";
        ring.style.display = "block";
    }
}

function tutorClearHighlight() {
    const overlay = document.getElementById("tutor-overlay");
    if (overlay) overlay.style.clipPath = "none";

    const ring = document.getElementById("tutor-hl-ring");
    if (ring) ring.style.display = "none";
}

// ======================
// 🔒 手牌鎖定
// ======================
function tutorLockHand(allowedIdx) {
    tutorialLockedCardIdx = allowedIdx;
    requestAnimationFrame(() => {
        const cards = document.querySelectorAll("#player-hand .card");
        cards.forEach((c, i) => {
            c.classList.remove("tutor-target-card", "tutor-locked");
            if (i === allowedIdx) c.classList.add("tutor-target-card");
            else                  c.classList.add("tutor-locked");
        });
    });
}

function tutorUnlockHand() {
    tutorialLockedCardIdx = -1;
    document.querySelectorAll("#player-hand .card").forEach(c => {
        c.classList.remove("tutor-target-card", "tutor-locked");
    });
}

// ======================
// 🚫 導覽遮罩
// ======================
function tutorShowOverlay() {
    const o = document.getElementById("tutor-overlay");
    if (o) {
        o.style.clipPath = "none";  // 預設無洞（全暗）
        o.style.display  = "block";
    }
}
function tutorHideOverlay() {
    const o = document.getElementById("tutor-overlay");
    if (o) o.style.display = "none";
    tutorClearHighlight();
}

// ======================
// 📋 導覽步驟
// ======================
let tourStep = 0;

const TOUR_STEPS = [
    {
        highlight: null,
        text: "嗨！我是導航魚🐟 歡迎來到友魚守護團！\n帶你快速認識畫面～",
        next: true
    },
    {
        highlight: ".char-area",
        // 對手區在頂部面板下方，不說上方
        text: "🐙 畫面上端亮起的是對手區\n大家輪流抽召喚牌、出魚牌～最快出完手牌的人獲勝！",
        next: true
    },
    {
        highlight: "#ocean",
        text: "🌊 中間亮起的是出牌區\n所有人出的牌都會出現在這裡\n觀察對手的牌，是推測條件的關鍵！",
        next: true
    },
    {
        highlight: "#summon-display",
        // 這一步需要先把召喚框顯示出來才能高亮，用 onEnter 鉤子處理
        text: "📜 亮起的是召喚條件框\n你的回合會顯示出牌條件、 對手回合則需要觀察牌來推測！",
        next: true,
        onEnter: () => {
            // 暫時顯示召喚框讓玩家看到，離開此步後由 startPractice1 正式設定
            const el = document.getElementById("summon-display");
            if (el) {
                el.style.display = "flex";
                el.innerText     = "（例）出一張【養殖】來源的魚";
            }
        }
    },
    {
        highlight: "#player-zone",
        text: "👇 亮起的是你的手牌區，點牌放大查看屬性\n對照條件，選對的魚出！\n準備好了嗎？來練習！",
        next: true,
        onEnter: () => {
            // 離開召喚框步驟後把示例隱藏掉，等練習時再正式顯示
            const el = document.getElementById("summon-display");
            if (el) el.style.display = "none";
        }
    }
];

function tutorNextStep() {
    tourStep++;
    runTourStep();
}

function runTourStep() {
    if (tourStep >= TOUR_STEPS.length) {
        tutorClearHighlight();
        tutorHideOverlay();
        startPractice1();
        return;
    }
    const step = TOUR_STEPS[tourStep];
    tutorClearHighlight();
    if (step.onEnter) step.onEnter();
    if (step.highlight) tutorHighlight(step.highlight);
    tutorSay(step.text, step.next);
}

// ======================
// 🚀 啟動教學
// ======================
function startTutorial() {
    tutorialMode  = true;
    tutorialPhase = "tour";
    tourStep      = 0;

    const welcome = document.getElementById("welcome-screen");
    if (welcome) welcome.style.display = "none";

    document.getElementById("summon-display").style.display = "none";
    // 剩餘召喚數與出牌記錄已移進頂端中央群組，整組一起隱藏即可
    // 用 visibility 而非 display 隱藏：中央群組在 flex 列裡佔一個位置，
    // 用 display:none 會讓左右兩組的位置跟著跑掉。
    document.getElementById("top-center-group").style.visibility = "hidden";

    document.body.classList.add("game-started");
    if (typeof initOceanVideo === "function") initOceanVideo("longfeng");
    if (typeof closePreview === "function") closePreview();

    const focusOverlay = document.getElementById("summon-focus-overlay");
    if (focusOverlay) {
        focusOverlay.style.transition   = "none";
        focusOverlay.style.opacity      = "0";
        focusOverlay.style.pointerEvents = "none";
    }

    buildTutorialDOM();
    setupTutorialPlayers();
    setupTutorialCards();

    callerIdx = 0;
    phase     = "WAIT";

    // 播放背景音樂（依音效設定決定）
    // 說明頁音樂改成用到才建立（見 main.js 的 getInfoBGM），這裡透過同一個函式取用
    if (typeof getInfoBGM === "function" && typeof sfxEnabled !== "undefined" && sfxEnabled) {
        const tutorialMusic = getInfoBGM();
        tutorialMusic.currentTime = 0;
        tutorialMusic.play().catch(e => console.log("教學BGM播放受阻:", e));
    }

    setTimeout(() => {
        renderUI();
        renderTable();
        tutorShowOverlay();
        runTourStep();
    }, 300);
}

// ======================
// 🃏 玩家與牌組
// ======================
function setupTutorialPlayers() {
    // renderAIStatus()（main.js）讀的是 p.avatarWebp / p.avatarJpg，
    // 不是 p.avatar，先前這裡只給了 avatar 屬性，導致教學模式進到
    // renderAIStatus() 時 avatarHtml 變成 undefined，畫面就顯示出
    // 文字 "undefined"。教學用的表情符號不需要分靜態/動態兩種圖，
    // 兩個屬性給同一份內容即可。
    const octopusAvatar = '<div style="font-size:2rem;">🐙</div>';
    const turtleAvatar  = '<div style="font-size:2rem;">🐢</div>';
    const crabAvatar    = '<div style="font-size:2rem;">🦀</div>';

    players = [
        { n:"你",       hand:[], isAI:false },
        { n:"章魚船長", hand:[], isAI:true, id:"ai-1", avatarWebp:octopusAvatar, avatarJpg:octopusAvatar },
        { n:"海龜智者", hand:[], isAI:true, id:"ai-2", avatarWebp:turtleAvatar,  avatarJpg:turtleAvatar  },
        { n:"螃蟹俠客", hand:[], isAI:true, id:"ai-3", avatarWebp:crabAvatar,    avatarJpg:crabAvatar    }
    ];
}

// 手牌固定順序（教學全程不變動 template，每次重置都用此）：
//   index 0 → 虱目魚（養殖、洄游性）→ 練習1出對
//   index 1 → 吳郭魚（養殖、定棲性）→ 練習2出錯（練習1出掉虱目魚後變 index 0）
//   index 2 → 竹筴魚（近海、洄游性）
const TUTOR_HAND_TPL = [
    { n:"虱目魚", d:"養殖", l:1, m:["養殖"],   h:"洄游性", s:"全年", i:"台灣養殖代表魚種" },
    { n:"吳郭魚", d:"養殖", l:1, m:["養殖"],   h:"定棲性", s:"全年", i:"淡水養殖常見魚種" },
    { n:"竹筴魚", d:"近海", l:2, m:["定置網"], h:"洄游性", s:"全年", i:"近海常見的中型魚"  },
];

const SUMMON_P1 = {
    t:"出一張【養殖】來源的魚",
    c:(f) => f.d === "養殖",
    why:"養殖漁業對環境壓力較小，是永續選擇之一。"
};
const SUMMON_P2 = {
    t:"出一張【洄游性】的魚",
    c:(f) => f.h && f.h.includes("洄游"),
    why:"洄游性魚類在特定季節才大量出現，需注意永續捕撈時機。"
};
const SUMMON_MAZU = {
    t:"神明指示：將一張手牌贈予他人",
    c:() => true,
    isMazu:true,
    why:null
};

function setupTutorialCards() {
    players[0].hand = TUTOR_HAND_TPL.map(f => ({ ...f, m:[...f.m] }));
    players[1].hand = [
        { n:"秋刀魚", d:"遠洋", l:2, m:["延繩釣"], h:"洄游性", s:"秋冬" },
        { n:"台灣鯖魚", d:"近海", l:2, m:["圍網"],   h:"洄游性", s:"夏秋" }
    ];
    players[2].hand = [
        { n:"野生石斑", d:"養殖", l:1, m:["養殖"],  h:"定棲性", s:"全年" }
    ];
    players[3].hand = [
        { n:"旗魚", d:"遠洋", l:3, m:["一支釣"], h:"洄游性", s:"春夏" },
        { n:"養殖鱸魚", d:"養殖", l:1, m:["養殖"],   h:"定棲性", s:"全年" }
    ];
    table      = [];
    document.getElementById("table").innerHTML = ""; // 同步清空桌面 DOM，避免舊卡片殘留畫面（見 main.js renderTable() 註解的清空契約）
    roundCount = 0;
}

// ======================
// 🟢 練習1：出對（虱目魚，index 0）
// ======================
function startPractice1() {
    tutorialPhase = "practice1";
    tutorClearHighlight();

    currentS  = SUMMON_P1;
    callerIdx = 0;
    phase     = "PLAYER_TURN";
    table     = [];
    document.getElementById("table").innerHTML = ""; // 同步清空桌面 DOM，避免舊卡片殘留畫面（見 main.js renderTable() 註解的清空契約）

    const sumEl = document.getElementById("summon-display");
    sumEl.style.display = "block";
    sumEl.innerText     = "【你的召喚】\n" + SUMMON_P1.t;

    renderUI();
    renderTable();

    setTimeout(() => {
        tutorSay(
            "📜 第一次練習！\n條件：「出養殖來源的魚」  =>  【虱目魚】是養殖來源 ✅\n點亮起（金色閃爍）的牌出去吧！",
            false
        );
        // 虱目魚固定在 index 0
        setTimeout(() => tutorLockHand(0), 400);
    }, 600);
}

// 出一張牌並「等到飛行動畫真正完成」才 resolve，取代原本用固定 sleep(ms) 賭飛行
// 動畫時間（1550ms）一定夠的寫法——當多張牌連續出牌時，若中間等待時間比 1550ms
// 短，renderTable() 的「只補上還沒渲染的新卡片」機制會把好幾張牌一次補齊，
// 導致後出的那張牌在自己的飛行動畫「還沒飛到」海洋區時就先憑空出現在桌上。
function tutorPlayToTable(pIdx, card, fromEl) {
    table.push({ pIdx, card });
    renderUI();
    return new Promise(resolve => {
        if (typeof playCardFlyAnimation === "function") {
            playCardFlyAnimation(card, fromEl, () => { renderTable(); resolve(); });
        } else {
            renderTable();
            resolve();
        }
    });
}

async function tutorAfterPlay1(fishPlayed) {
    tutorClearHighlight();
    tutorHide();
    tutorUnlockHand();

    await sleep(800);

    // 海龜出野生石斑（養殖，成功）— 等飛行動畫真正完成再繼續
    const c1 = { n:"野生石斑", d:"養殖", l:1, m:["養殖"], h:"定棲性", s:"全年" };
    await tutorPlayToTable(2, c1, document.getElementById("ai-2"));
    await sleep(400); // 停留給玩家看清楚，再出下一張

    // 螃蟹出旗魚（遠洋，退牌）
    const c2 = players[3].hand.splice(0,1)[0];
    if (c2) {
        await tutorPlayToTable(3, c2, document.getElementById("ai-3"));
    }
    await sleep(700); // 全部出完後停留一下再開結算

    tutorShowSummary(SUMMON_P1, fishPlayed, table, () => {
        table = [];
        document.getElementById("table").innerHTML = ""; // 同步清空桌面 DOM，避免舊卡片殘留畫面（見 main.js renderTable() 註解的清空契約）
        renderTable();
        renderUI();
        setTimeout(startPractice2, 600);
    });
}

// ======================
// 🔴 練習2：出錯（吳郭魚，練習1出掉虱目魚後變 index 0）
// ======================
function startPractice2() {
    tutorialPhase = "practice2";
    tutorClearHighlight();

    // 此時玩家手牌：[吳郭魚(idx0), 竹筴魚(idx1)]
    currentS  = SUMMON_P2;
    callerIdx = 1;           // 章魚船長召喚，玩家不知條件
    phase     = "PLAYER_TURN";
    table     = [];
    document.getElementById("table").innerHTML = ""; // 同步清空桌面 DOM，避免舊卡片殘留畫面（見 main.js renderTable() 註解的清空契約）

    const sumEl = document.getElementById("summon-display");
    sumEl.innerText = "【章魚船長的召喚】\n觀察對手出的牌，推敲條件...";

    renderUI();
    renderTable();

    setTimeout(async () => {
        tutorSay(
            "🕵️ 這次是對手抽召喚！\n你不知道條件是什麼…? 觀察對手出的牌來推測！",
            false
        );

        await sleep(2000);

        // 章魚船長出秋刀魚（洄游性）— 等飛行動畫真正完成再繼續
        const aiCard = players[1].hand.splice(0,1)[0];
        if (aiCard) {
            await tutorPlayToTable(1, aiCard, document.getElementById("ai-1"));
        }

        await sleep(1800);

        tutorSay(
            "👀 對手出了「洄游性」的秋刀魚 => 條件可能和洄游性有關？\n這次故意讓你出【吳郭魚】，看看出錯了會發生什麼事!\n點亮起（金色）的牌！",
            false
        );

        await sleep(1000);

        // 練習1出掉虱目魚後，吳郭魚已是 index 0
        tutorLockHand(0);

    }, 500);
}

async function tutorAfterPlay2(fishPlayed) {
    tutorClearHighlight();
    tutorHide();
    tutorUnlockHand();

    await sleep(800);

    // 海龜跟牌（洄游性，成功）— 等飛行動畫真正完成再繼續
    const c3 = { n:"台灣鯖魚", d:"近海", l:2, m:["圍網"], h:"洄游性", s:"夏秋" };
    await tutorPlayToTable(2, c3, document.getElementById("ai-2"));
    await sleep(400);

    // 揭曉條件
    document.getElementById("summon-display").innerText =
        "【揭曉章魚船長的召喚】\n" + SUMMON_P2.t;

    await sleep(700);

    tutorShowSummary(SUMMON_P2, fishPlayed, table, () => {
        table = [];
        document.getElementById("table").innerHTML = ""; // 同步清空桌面 DOM，避免舊卡片殘留畫面（見 main.js renderTable() 註解的清空契約）
        // 確保吳郭魚退回（練習2必定出錯）
        if (!players[0].hand.find(f => f.n === "吳郭魚")) {
            players[0].hand.unshift(
                { n:"吳郭魚", d:"養殖", l:1, m:["養殖"], h:"定棲性", s:"全年", i:"淡水養殖常見魚種" }
            );
        }
        renderTable();
        renderUI();
        setTimeout(startPracticeMazu, 600);
    });
}

// ======================
// 🙏 贈卡練習
// ======================
function startPracticeMazu() {
    tutorialPhase = "mazu";

    currentS  = SUMMON_MAZU;
    callerIdx = 0;
    phase     = "PLAYER_MAZU";
    table     = [];
    document.getElementById("table").innerHTML = ""; // 同步清空桌面 DOM，避免舊卡片殘留畫面（見 main.js renderTable() 註解的清空契約）

    const sumEl = document.getElementById("summon-display");
    sumEl.innerText = "【神明指示】\n" + SUMMON_MAZU.t;
    sumEl.classList.add("mazu-glow");

    players[1].hand = [{ n:"台灣鯖魚",   d:"近海", l:2, m:["圍網"],   h:"洄游性", s:"夏秋" }];
    players[2].hand = [
        { n:"野生石斑", d:"養殖", l:1, m:["養殖"], h:"定棲性", s:"全年" },
        { n:"養殖烏魚",   d:"近海", l:2, m:["刺網"], h:"洄游性", s:"冬"  }
    ];
    players[3].hand = [{ n:"養殖鱸魚",   d:"養殖", l:1, m:["養殖"],   h:"定棲性", s:"全年" }];

    renderUI();

    setTimeout(() => {
        tutorSay(
            "🙏 特殊召喚：分享贈卡！\n選一張手牌贈給別的玩家\n策略：送最難出的牌, 給手牌最少的對手最有效！\n選其中一張牌試試看",
            false
        );
    }, 500);
}

function tutorAfterMazu() {
    tutorClearHighlight();
    tutorHide();
    setTimeout(() => {
        tutorSay(
            "🎊 送牌成功！\n\n你已經學會全部基本操作了！",
            false
        );
        setTimeout(showTutorEndModal, 2000);
    }, 600);
}

// ======================
// 📊 結算頁（老師氣泡醒目版）
// ======================
function tutorShowSummary(summon, playerFish, tableCards, onClose) {
    phase = "RESULT";

    const isOk = summon.c(playerFish);

    // ── 老師氣泡文字（只說玩家的牌）──
    let icon, text;
    if (isOk) {
        icon = "✅";
        text = `【${playerFish.n}】符合條件！\n來源「${playerFish.d}」正確出牌 🎉\n牌留在桌上，繼續前進！`;
    } else {
        let reason = "";
        if      (summon.t.includes("養殖")) reason = `來源是「${playerFish.d}」，不是養殖`;
        else if (summon.t.includes("洄游")) reason = `棲地是「${playerFish.h}」，不符合洄游條件`;
        else                                reason = "不符合本回條件";
        icon = "❌";
        text = `【${playerFish.n}】退牌了！\n${reason}\n退牌的魚會回到手牌\n沒關係，繼續推測就好！`;
    }

    // ── 結算卡片列表 ──
    const report = tableCards.map(t => ({
        name:      players[t.pIdx].n,
        fishName:  t.card.n,
        isSuccess: summon.c(t.card)
    }));

    // 退牌（非玩家）
    tableCards.forEach(t => {
        if (!summon.c(t.card) && t.pIdx !== 0) players[t.pIdx].hand.push(t.card);
    });

    const cardsHtml = report.map((r, i) => {
        const d = 0.06 + i * 0.07;
        const bg = r.isSuccess
            ? "background:linear-gradient(135deg,#0a2e1a,#0d3d22);border:1.5px solid #3a9e5f;"
            : "background:linear-gradient(135deg,#2a0f0f,#361212);border:1.5px solid #8b3030;";
        const nc = r.isSuccess ? "#90f0b8" : "#f4a0a0";
        const badge = r.isSuccess
            ? `<span style="font-size:.72rem;color:#7eeaa8;">⭐ 成功</span>`
            : `<span style="font-size:.7rem;color:#f07070;background:rgba(200,50,50,0.2);border:1px solid rgba(200,50,50,0.4);padding:1px 6px;border-radius:8px;">退牌</span>`;
        return `
        <div style="${bg}border-radius:11px;padding:7px 9px;animation:rsUp .22s ${d}s ease both;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <span style="font-size:.72rem;color:rgba(255,255,255,0.42);">${r.name}</span>${badge}
            </div>
            <div style="font-size:.92rem;font-weight:bold;color:${nc};
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.fishName}</div>
        </div>`;
    }).join("");

    const ecoHtml = summon.why ? `
        <div style="background:linear-gradient(135deg,rgba(0,55,95,0.72),rgba(0,32,72,0.72));
                    border:1.5px solid rgba(60,170,255,0.22);border-radius:11px;
                    padding:8px 11px;margin-bottom:10px;">
            <div style="font-size:.7rem;color:#60c8f0;font-weight:bold;margin-bottom:2px;">🌊 生態小知識</div>
            <div style="font-size:.83rem;color:rgba(190,235,255,0.85);line-height:1.55;">${summon.why}</div>
        </div>` : "";

    // ── 移除舊的（如有）──
    document.getElementById("tutor-sum-ov")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "tutor-sum-ov";
    overlay.style.cssText = `
        position:fixed;inset:0;
        background:rgba(4,12,22,0.92);
        display:flex;justify-content:center;align-items:center;
        z-index:5500;padding:14px;box-sizing:border-box;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
        background:linear-gradient(170deg,#0d2137,#081626);
        border-radius:18px;border:1px solid rgba(255,255,255,0.07);
        width:100%;max-width:370px;
        max-height:88vh;overflow-y:auto;
        padding:13px 12px 15px;box-sizing:border-box;
        animation:rsDown .3s ease-out both;
    `;

    modal.innerHTML = `
        <style>
            @keyframes rsDown{ from{transform:translateY(-18px);opacity:0} to{transform:translateY(0);opacity:1} }
            @keyframes rsUp  { from{transform:translateY(10px) ;opacity:0} to{transform:translateY(0);opacity:1} }
        </style>
        <div style="background:linear-gradient(135deg,rgba(0,55,95,0.72),rgba(0,32,72,0.72));
                    border:1.5px solid rgba(60,170,255,0.22);border-radius:11px;
                    padding:7px 11px;margin-bottom:8px;">
            <div style="font-size:.7rem;color:#60c8f0;letter-spacing:1px;margin-bottom:2px;">📜 本回召喚條件</div>
            <div style="font-size:.9rem;color:#fff;font-weight:bold;line-height:1.4;">${summon.t}</div>
        </div>

        <div class="tutor-sum-bubble">
            <div class="tsb-icon">${icon}</div>
            <div class="tsb-text">${text}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;">
            ${cardsHtml}
        </div>

        ${ecoHtml}

        <button id="tutor-sum-close" style="
            width:100%;padding:12px;border:none;border-radius:50px;
            font-size:.95rem;font-weight:900;cursor:pointer;
            background:linear-gradient(135deg,#f5c842,#e07828);
            color:#1a0800;
            box-shadow:0 4px 0 #8a4200,0 5px 12px rgba(200,100,0,0.28);
            -webkit-tap-highlight-color:transparent;">
            整理魚獲，繼續！
        </button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector("#tutor-sum-close").onclick = () => {
        overlay.remove();
        if (onClose) onClose();
    };
}

// ======================
// 🏁 結束彈窗
// ======================
function showTutorEndModal() {
    tutorHide();
    tutorClearHighlight();
    const m = document.getElementById("tutor-end-modal");
    if (m) m.style.display = "flex";
}

function tutorFinish() {
    tutorialMode  = false;
    tutorialPhase = "idle";

    document.getElementById("tutor-end-modal").style.display = "none";

    tutorHide();
    tutorClearHighlight();
    tutorUnlockHand();
    tutorHideOverlay();

    // 停止教學 BGM
    if (typeof infoBGM !== "undefined" && infoBGM) infoBGM.pause(); // 沒建立過就不用暫停

    document.body.classList.remove("game-started");

    const sumEl = document.getElementById("summon-display");
    if (sumEl) { sumEl.style.display = "none"; sumEl.classList.remove("mazu-glow"); }
    // 還原頂端中央群組（必須是 flex，用 block 會破壞裡面三個元素的橫向排列）
    document.getElementById("top-center-group").style.visibility = "";

    table    = [];
    document.getElementById("table").innerHTML = ""; // 同步清空桌面 DOM，避免舊卡片殘留畫面（見 main.js renderTable() 註解的清空契約）
    players  = [{ n:"你", hand:[], isAI:false }];
    currentS = null;
    phase    = "WAIT";

    if (typeof renderUI    === "function") renderUI();
    if (typeof renderTable === "function") renderTable();

    const welcome = document.getElementById("welcome-screen");
    if (welcome) {
        welcome.style.display    = "flex";
        welcome.style.opacity    = "0";
        welcome.style.transition = "opacity 0.8s ease";
        setTimeout(() => { welcome.style.opacity = "1"; }, 50);
        welcome.classList.remove("fade-out", "hidden");
    }
}

// ======================
// 🎮 攔截 playerAction
// ⚠️ Monkey-patch 警語：本函式整個覆蓋 main.js 定義的 window.playerAction，
//    把原函式存成 _orig 再包一層教學邏輯。這代表：
//    1) main.js 必須在本檔案「之前」載入（見 index.html 的 <script> 順序）。
//    2) 若之後在 main.js 修改 playerAction 的函式名稱或呼叫方式，這裡會
//       悄悄失效（不會報錯，但新手教學會表現異常），請同步檢查此處。
// ======================
(function patchPlayerAction() {
    const _orig = window.playerAction;
    window.playerAction = async function(idx) {
        if (!tutorialMode) return _orig ? _orig.call(this, idx) : undefined;

        // 導覽階段直接擋住所有出牌互動
        if (tutorialPhase === "tour") return;

        // ── 媽祖籤 ──
        if (phase === "PLAYER_MAZU") {
            tutorClearHighlight();
            tutorHide();
            // ⚠️ 這裡又對 window.confirmMazuGift 做了一次 monkey-patch
            //    （同樣的耦合風險，見上方 patchPlayerAction 的警語）
            const _origConfirm = window.confirmMazuGift;
            window.confirmMazuGift = function(cardIdx, target) {
                const card = players[0].hand.splice(cardIdx, 1)[0];
                const tEl  = target.id ? document.getElementById(target.id) : null;
                const pEl  = document.getElementById("player-zone");
                if (typeof showMazuGiftEffect === "function")
                    showMazuGiftEffect("你", target.n, card, tEl, pEl);
                target.hand.push(card);
                if (typeof SFX !== "undefined" && SFX.gift) SFX.gift();
                renderUI();
                phase = "RESULT";
                window.confirmMazuGift = _origConfirm;
                setTimeout(tutorAfterMazu, 3000);
            };
            showMazuTargetSelect(idx);
            return;
        }

        if (phase !== "PLAYER_TURN") return;

        // ── 鎖定檢查 ──
        if (tutorialLockedCardIdx !== -1 && idx !== tutorialLockedCardIdx) {
            tutorSay("👆 請點金色閃爍的那張牌！", false);
            return;
        }

        const fish = players[0].hand[idx];
        if (!fish) return;

        // ── 出牌 ──
        players[0].hand.splice(idx, 1);
        if (typeof SFX !== "undefined" && SFX.card) SFX.card();
        table.push({ pIdx:0, card:fish });
        phase = "AI_FOLLOWING";

        if (typeof closePreview === "function") closePreview();
        renderUI();

        const fromEl = document.getElementById("player-zone");
        if (typeof playCardFlyAnimation === "function")
            playCardFlyAnimation(fish, fromEl, () => renderTable());
        else
            renderTable();

        await sleep(1600);

        if      (tutorialPhase === "practice1") await tutorAfterPlay1(fish);
        else if (tutorialPhase === "practice2") await tutorAfterPlay2(fish);
    };
})();

// ======================
// 🛡️ 攔截 showCardPreview
// ⚠️ Monkey-patch 警語：同樣覆蓋 main.js 的 window.showCardPreview，
//    載入順序與失效風險同上方 patchPlayerAction 的說明。
// ======================
(function patchShowCardPreview() {
    const _orig = window.showCardPreview;
    window.showCardPreview = function(idx, fish, isHand) {
        if (!tutorialMode || !isHand)
            return _orig ? _orig.call(this, idx, fish, isHand) : undefined;
        if (tutorialLockedCardIdx !== -1 && idx !== tutorialLockedCardIdx)
            return; // 鎖定期間只允許指定牌
        return _orig ? _orig.call(this, idx, fish, isHand) : undefined;
    };
})();
