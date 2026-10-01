// =============================================
// 🏆 結束畫面 showWinScreen(winner)
// =============================================

function showWinScreen(winner) {
    const isPlayer = !winner.isAI;

    // ── 勝利獎勵：直接發金幣（不再用「難度章/勝場數」這種需要另外找地方持久保存的
    // 收集項目——金幣本來就是平台 Firestore 錢包裡的東西，天生就是永久累加、不會
    // 因為關掉分頁或平台沒有對應欄位而消失，勝場數要「找地方放」最自然的位置就是這裡）。
    // 金額沿用 db.js difficultyDB 的 winBonus（新手+0／標準+1／專業+2）。
    // 先記下來，不在這裡單獨送出——稍後會跟徽章、破紀錄金幣合併成同一則 complete 訊息
    // 一次送出（見下面「這局結算」區塊），避免同一局結束時连續送好幾則訊息互相搶著
    // 處理同一份使用者文件。
    let winCoins = 0;
    if (isPlayer) {
        winCoins = getDifficultyInfo(gameDifficulty).winBonus || 0;
    }

    // ── 行為型勳章判斷，追蹤本局新解鎖 ──
    const newlyUnlockedBadges = [];

    if (typeof badgeTracker !== "undefined") {
        const cards = badgeTracker.playerCards;
        const total = cards.length;
        const playerName = window.playerName;

        const checkAndUnlock = (key) => {
            const data = progress.load(playerName);
            const already = data && data.behaviorBadges && data.behaviorBadges.includes(key);
            progress.unlockBehaviorBadge(playerName, key);
            if (!already) newlyUnlockedBadges.push(key);
        };

        if (total > 0) {
            const allCards   = cards.map(c => c.card);
            const allSuccess = cards.every(c => c.isSuccess);

            if (total >= 3 && allCards.every(f => f.l === 1)) checkAndUnlock("綠燈先鋒");
            if (allCards.filter(f => f.m.includes("一支釣")).length >= 4) checkAndUnlock("一支釣達人");
            if (isPlayer && allCards.every(f => f.l === 1) && allSuccess && total >= 3) checkAndUnlock("完美永續局");
            if (allCards.filter(f => f.l === 3).length >= 3) checkAndUnlock("紅燈護送員");
            if (allCards.filter(f => f.d === "養殖").length >= 3) checkAndUnlock("養殖支持者");
            if (allCards.some(f => f.n === "鯨鯊")) checkAndUnlock("深海傳說");
            if (isPlayer && badgeTracker.returnCount >= 3) checkAndUnlock("浴火重生");
            if (isPlayer && allSuccess && total >= 4) checkAndUnlock("百發百中");
            const uniqueGreenSed = [...new Set(allCards.filter(f => f.l === 1 && f.h === "定棲性").map(f => f.n))];
            if (uniqueGreenSed.length >= 3) checkAndUnlock("珊瑚守護者");
            if (new Set(allCards.flatMap(f => f.m)).size >= 5) checkAndUnlock("漁法通");
            if (isPlayer && total >= 4 && allCards.every(f => f.d === "近海") && allSuccess) checkAndUnlock("近海英雄");
            const isPerfect  = allCards.every(f => f.l === 1) && allSuccess && total >= 3;
            const isBullseye = allSuccess && total >= 4;
            if (isPlayer && isPerfect && isBullseye && badgeTracker.returnCount >= 3) checkAndUnlock("海紋守護王");
        }
    }

    // ── 這局結算：把本局新解鎖的漁港章／魚紋章／行為勳章，跟「破紀錄+1金幣」
    // 合併成同一則 complete 訊息一次送給平台（理由見 platform.js 的 reportNewBadges
    // 註解——合併成一則，後台才會依序處理、不會併發搶同一份使用者文件）。
    // 送出去之後才把 progress._pending 併進 progress._confirmed——從這一刻起，
    // 「我的海紋收集」「我的收藏進度」畫面才會顯示這些新項目，之前都只是暫存、不顯示。
    // 這裡不看 isPlayer（不限定玩家要贏）：漁港章／魚紋章只要玩過這局就會有，
    // 輸贏都該正常送出、正常顯示；行為勳章本來就只有玩家獲勝時才會進到 _pending
    // （見上方 checkAndUnlock 只在 isPlayer 時執行），輸的話這裡自然是空陣列。
    if (typeof reportNewBadges === "function") {
        const pendingSnapshot = progress._pending;
        progress.commitPending();

        let extraCoins = winCoins;
        let newTotalScore = null;
        if (typeof computeCollectionStats === "function") {
            const _stats = computeCollectionStats(window.playerName);
            newTotalScore = _stats.totalScore;
            if (typeof PLATFORM !== "undefined") {
                const isFirstTime = PLATFORM.myScore === null;
                if (!isFirstTime && newTotalScore > PLATFORM.myScore) extraCoins += 1;
            }
        }

        reportNewBadges(pendingSnapshot, extraCoins);

        if (newTotalScore !== null && typeof reportScoreIfHigher === "function") {
            reportScoreIfHigher(newTotalScore); // 內部只送 score 訊息本身，不再重複送破紀錄金幣
        }
    }

    // 解除 ui-lock
    const uiLock = document.getElementById("ui-lock");
    if (uiLock) uiLock.style.display = "none";

    // 寫入初始手牌快照 → 組成「🏆本局結果」總結段落
    if (typeof initialHands !== "undefined" && initialHands.length > 0) {
        const meta = (typeof window !== "undefined" && window.gameMeta) ? window.gameMeta : {};
        const diffShort = meta.diffShort || getDifficultyInfo(gameDifficulty).label;
        gameEndSummary = {
            location: meta.locationLabel || "未指定海線",
            diffText: `${diffShort}（${gameDifficulty}）`,
            winnerName: winner.n,
            totalRounds: typeof roundCount !== "undefined" ? roundCount : "?",
            initialHands: initialHands
        };
        if (typeof renderLog === "function") renderLog();
    }

    // ── BGM 切換 ──
    const gameBgm = document.getElementById("bgm");
    const musicWasOn = gameBgm && !gameBgm.paused;
    if (musicWasOn) gameBgm.pause();
    const winBgm = new Audio("MZ.mp3");
    winBgm.loop = true; winBgm.volume = 0;
    if (musicWasOn) {
        winBgm.play().catch(() => {});
        let vol = 0;
        const fadeInBgm = setInterval(() => { vol = Math.min(1, vol + 0.04); winBgm.volume = vol; if (vol >= 1) clearInterval(fadeInBgm); }, 80);
    }

    const hasNewBadge = isPlayer && newlyUnlockedBadges.length > 0;
    let currentBadgeIdx = 0;

    // ── CSS Keyframes（注入一次）──
    if (!document.getElementById("win-screen-keyframes")) {
        const style = document.createElement("style");
        style.id = "win-screen-keyframes";
        style.textContent = `
            @keyframes winRayFade    {0%,100%{opacity:.2}50%{opacity:.9}}
            @keyframes winGoldPulse  {0%,100%{transform:translateX(-50%) scale(1);opacity:.55}50%{transform:translateX(-50%) scale(1.28);opacity:1}}
            @keyframes winDeepPulse  {0%,100%{transform:translateX(-50%) scale(1);opacity:.45}50%{transform:translateX(-50%) scale(1.34);opacity:1}}
            @keyframes winSpinRing   {to{transform:rotate(360deg)}}
            @keyframes winDropIn     {from{opacity:0;transform:scale(.4) translateY(-30px)}to{opacity:1;transform:scale(1) translateY(0)}}
            @keyframes winFadeUp     {from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
            @keyframes winParticle   {0%{transform:translateY(0) translateX(0);opacity:0}8%{opacity:1}92%{opacity:.7}100%{transform:translateY(-600px) translateX(var(--dx,8px));opacity:0}}
            @keyframes winCFall      {0%{transform:translateY(-8px) rotate(0deg);opacity:1}100%{transform:translateY(660px) rotate(730deg);opacity:0}}
            @keyframes winBadgePop   {0%{opacity:0;transform:scale(.3) rotate(-12deg)}65%{transform:scale(1.12) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0deg)}}
            @keyframes winBadgeSlide {from{opacity:0;transform:translateX(40px) scale(.85)}to{opacity:1;transform:translateX(0) scale(1)}}
            @keyframes winAuraBreath {0%,100%{box-shadow:0 0 28px 8px rgba(255,210,40,.45),0 0 60px 20px rgba(255,180,20,.2)}50%{box-shadow:0 0 52px 18px rgba(255,220,60,.85),0 0 100px 40px rgba(255,190,30,.4)}}
            @keyframes winAuraBlue   {0%,100%{box-shadow:0 0 28px 8px rgba(60,140,255,.45),0 0 60px 20px rgba(40,100,255,.2)}50%{box-shadow:0 0 52px 18px rgba(80,160,255,.85),0 0 100px 40px rgba(60,130,255,.4)}}
            @keyframes winIconFloat  {0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-10px) scale(1.06)}}
            @keyframes winIconFloatSm{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
            @keyframes winSharePulse {0%,100%{transform:scale(1);box-shadow:0 4px 20px rgba(255,160,40,.5)}50%{transform:scale(1.03);box-shadow:0 6px 32px rgba(255,160,40,.85)}}
            @keyframes winSharePulseB{0%,100%{transform:scale(1);box-shadow:0 4px 20px rgba(60,130,255,.5)}50%{transform:scale(1.03);box-shadow:0 6px 32px rgba(60,130,255,.85)}}
            @keyframes winDotPulse   {0%,100%{transform:scale(1)}50%{transform:scale(1.5)}}
        `;
        document.head.appendChild(style);
    }

    // ── 全螢幕遮罩 ──
    const overlay = document.createElement("div");
    overlay.id = "win-overlay";
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:5000;overflow:hidden;
        font-family:"Microsoft JhengHei","PingFang TC",sans-serif;
        background:#000;opacity:0;transition:opacity 1s ease;
    `;

    // 背景圖
    const bgDiv = document.createElement("div");
    bgDiv.style.cssText = `
        position:absolute;inset:0;
        background:url('image/bge.png') center center/cover no-repeat;
        opacity:${isPlayer ? 1 : 0.9};
        ${isPlayer ? '' : 'filter:hue-rotate(190deg) saturate(.85) brightness(.65);'}
    `;
    overlay.appendChild(bgDiv);

    // 漸層遮罩
    const mask = document.createElement("div");
    mask.style.cssText = `
        position:absolute;inset:0;pointer-events:none;
        background:${isPlayer
            ? 'linear-gradient(180deg,rgba(2,10,6,.22) 0%,rgba(1,6,3,.05) 35%,rgba(0,8,3,.72) 100%)'
            : 'linear-gradient(180deg,rgba(1,5,15,.32) 0%,rgba(2,8,20,.08) 35%,rgba(0,4,16,.78) 100%)'};
    `;
    overlay.appendChild(mask);

    // ── 特效層 ──
    const fxLayer = document.createElement("div");
    fxLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    overlay.appendChild(fxLayer);

    // 光柱
    if (isPlayer) {
        [{l:"8%",w:"3px",d:"-10",t:"0s"},{l:"22%",w:"6px",d:"-5",t:".5s"},
         {l:"38%",w:"10px",d:"-1",t:"1.1s"},{l:"56%",w:"7px",d:"3",t:".25s"},
         {l:"72%",w:"5px",d:"6",t:".9s"},{l:"87%",w:"3px",d:"10",t:"1.6s"}
        ].forEach(r => {
            const ray = document.createElement("div");
            ray.style.cssText = `position:absolute;top:0;left:${r.l};width:${r.w};height:68%;border-radius:4px;transform-origin:top center;transform:rotate(${r.d}deg);background:linear-gradient(180deg,rgba(120,255,170,.32) 0%,transparent 100%);animation:winRayFade 4s ${r.t} ease-in-out infinite;`;
            fxLayer.appendChild(ray);
        });
        const glow = document.createElement("div");
        glow.style.cssText = `position:absolute;bottom:-80px;left:50%;transform:translateX(-50%);width:380px;height:380px;border-radius:50%;background:radial-gradient(circle,rgba(255,200,50,.2) 0%,transparent 60%);animation:winGoldPulse 3.2s ease-in-out infinite;`;
        fxLayer.appendChild(glow);
    } else {
        const deepGlow = document.createElement("div");
        deepGlow.style.cssText = `position:absolute;bottom:-80px;left:50%;transform:translateX(-50%);width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(40,100,255,.16) 0%,transparent 58%);animation:winDeepPulse 4s ease-in-out infinite;`;
        fxLayer.appendChild(deepGlow);
    }

    // 粒子
    function spawnParticle() {
        const p = document.createElement("div");
        const sz = 2 + Math.random() * 5;
        const dur = 8 + Math.random() * 10;
        const colors = isPlayer
            ? ["rgba(120,255,170,.8)","rgba(255,220,80,.75)","rgba(255,200,60,.7)","rgba(200,255,210,.6)"]
            : ["rgba(100,185,255,.8)","rgba(80,160,255,.7)","rgba(150,210,255,.6)","rgba(60,145,255,.65)"];
        p.style.cssText = `position:absolute;border-radius:50%;pointer-events:none;width:${sz}px;height:${sz}px;left:${Math.random()*96}%;bottom:-${sz}px;background:${colors[Math.floor(Math.random()*colors.length)]};animation:winParticle ${dur}s ${Math.random()*4}s linear forwards;--dx:${(Math.random()*28-14).toFixed(1)}px;`;
        fxLayer.appendChild(p);
        setTimeout(() => p.remove(), (dur + 5) * 1000);
    }
    for (let i = 0; i < 20; i++) spawnParticle();
    const particleTimer = setInterval(spawnParticle, 900);

    // 彩帶
    const confColors = ["#ffd060","#ff7eb3","#7ee8fa","#22d48a","#b8a4ff","#ff9068","#ffe580","#a8f0c8"];
    function burstConfetti() {
        for (let i = 0; i < 32; i++) {
            const c = document.createElement("div");
            const dur = 2.2 + Math.random() * 2.6;
            c.style.cssText = `position:absolute;border-radius:2px;pointer-events:none;left:${5+Math.random()*90}%;top:-8px;width:${5+Math.random()*8}px;height:${5+Math.random()*8}px;background:${confColors[Math.floor(Math.random()*confColors.length)]};transform:rotate(${Math.random()*360}deg);animation:winCFall ${dur}s ${Math.random()*.8}s linear forwards;`;
            fxLayer.appendChild(c);
            setTimeout(() => c.remove(), (dur + 1.2) * 1000);
        }
    }
    if (isPlayer) {
        setTimeout(burstConfetti, 200);
        setTimeout(burstConfetti, 1600);
        setTimeout(burstConfetti, 3200);
    }

    // ── 中央內容（flex column, 垂直居中）──
    const content = document.createElement("div");
    content.style.cssText = `
        position:absolute;inset:0;z-index:20;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:32px 20px 28px;gap:0;
        overflow-y:auto;-webkit-overflow-scrolling:touch;
    `;

    // ── 小標題（玩家名 + 狀態）──
    const titleRow = document.createElement("div");
    titleRow.style.cssText = `
        text-align:center;margin-bottom:${hasNewBadge ? '20px' : '26px'};
        animation:winFadeUp .6s .2s both;
    `;

    if (isPlayer) {
        const winIcon = document.createElement("div");
        winIcon.style.cssText = `font-size:38px;margin-bottom:8px;animation:winIconFloatSm 2.4s ease-in-out infinite;filter:drop-shadow(0 0 12px rgba(255,200,40,.9));`;
        winIcon.textContent = "🏆";
        titleRow.appendChild(winIcon);

        const titleText = document.createElement("div");
        titleText.style.cssText = `font-size:1.9rem;font-weight:900;color:#fff;letter-spacing:2px;line-height:1.15;text-shadow:0 0 24px rgba(100,255,160,.7),0 2px 12px rgba(0,0,0,.95);`;
        titleText.innerHTML = `✦ ${winner.n} 任務達成 ✦`;
        titleRow.appendChild(titleText);

        const subText = document.createElement("div");
        subText.style.cssText = `font-size:.95rem;color:rgba(170,255,200,.85);margin-top:6px;text-shadow:0 1px 8px rgba(0,0,0,.8);`;
        subText.innerHTML = "感謝您守護海洋資源，實踐永續食魚精神！";
        titleRow.appendChild(subText);
    } else {
        const loseIcon = document.createElement("div");
        loseIcon.style.cssText = `font-size:36px;margin-bottom:8px;animation:winIconFloatSm 2.6s ease-in-out infinite;filter:drop-shadow(0 0 10px rgba(60,140,255,.8));`;
        loseIcon.textContent = "🌊";
        titleRow.appendChild(loseIcon);

        const titleText = document.createElement("div");
        titleText.style.cssText = `font-size:1.85rem;font-weight:900;color:rgba(215,235,255,.97);letter-spacing:2px;line-height:1.15;text-shadow:0 0 22px rgba(50,130,255,.65),0 2px 12px rgba(0,0,0,.95);`;
        titleText.textContent = "海域重歸寧靜";
        titleRow.appendChild(titleText);

        const subText = document.createElement("div");
        subText.style.cssText = `font-size:.95rem;color:rgba(140,190,255,.85);margin-top:6px;text-shadow:0 1px 8px rgba(0,0,0,.8);`;
        subText.innerHTML = `由 <strong style="color:#c8e0ff;">${winner.n}</strong> 率先與大海達成和解，這次還差一點點…`;
        titleRow.appendChild(subText);
    }
    content.appendChild(titleRow);

    // ── 勳章輪播區（有新勳章才出現，是畫面主角）──
    if (hasNewBadge) {
        const carouselWrap = document.createElement("div");
        carouselWrap.style.cssText = `
            width:100%;max-width:340px;
            display:flex;flex-direction:column;align-items:center;
            margin-bottom:22px;
            animation:winFadeUp .65s .35s both;
        `;

        // 勳章卡片
        const card = document.createElement("div");
        card.style.cssText = `
            width:100%;
            background:rgba(10,8,4,.55);
            border:2px solid rgba(255,215,60,.5);
            border-radius:28px;
            padding:28px 20px 22px;
            display:flex;flex-direction:column;align-items:center;gap:10px;
            position:relative;overflow:hidden;
            backdrop-filter:blur(12px);
        `;

        // 卡片內光暈背景
        const cardGlow = document.createElement("div");
        cardGlow.style.cssText = `position:absolute;inset:0;border-radius:28px;background:radial-gradient(ellipse at 50% 40%,rgba(255,200,40,.18) 0%,transparent 68%);pointer-events:none;`;
        card.appendChild(cardGlow);

        // 新成就標籤
        const newLabel = document.createElement("div");
        newLabel.style.cssText = `font-size:11px;font-weight:700;letter-spacing:3px;color:rgba(255,230,100,.75);`;
        newLabel.textContent = newlyUnlockedBadges.length > 1 ? `✨ 解鎖了 ${newlyUnlockedBadges.length} 枚新成就` : "✨ 新成就解鎖";
        card.appendChild(newLabel);

        // 大圖示
        const iconEl = document.createElement("div");
        iconEl.style.cssText = `
            font-size:96px;line-height:1;
            filter:drop-shadow(0 0 20px rgba(255,210,40,.9));
            animation:winBadgePop .7s cubic-bezier(.34,1.56,.64,1) both, winIconFloat 2.6s .7s ease-in-out infinite;
        `;

        // 勳章名稱
        const nameEl = document.createElement("div");
        nameEl.style.cssText = `font-size:1.5rem;font-weight:900;color:rgba(255,248,185,.97);letter-spacing:1px;text-align:center;text-shadow:0 0 18px rgba(255,210,40,.7);`;

        // 分享提示小字
        const hintEl = document.createElement("div");
        hintEl.style.cssText = `font-size:12px;color:rgba(255,230,120,.6);letter-spacing:.5px;margin-top:-2px;`;
        hintEl.textContent = "這個成就可以分享給朋友 👇";

        card.appendChild(iconEl);
        card.appendChild(nameEl);
        card.appendChild(hintEl);

        // 點點指示器（多枚才顯示）
        let dotsEl = null;
        if (newlyUnlockedBadges.length > 1) {
            dotsEl = document.createElement("div");
            dotsEl.style.cssText = `display:flex;gap:7px;margin-top:4px;`;
            for (let i = 0; i < newlyUnlockedBadges.length; i++) {
                const d = document.createElement("div");
                d.style.cssText = `width:7px;height:7px;border-radius:50%;background:rgba(255,215,60,${i===0?'.95':'.3'});transition:background .3s,transform .3s;`;
                dotsEl.appendChild(d);
            }
            card.appendChild(dotsEl);
        }

        carouselWrap.appendChild(card);
        content.appendChild(carouselWrap);

        // ── 切換邏輯 ──
        const BADGE_META = {
            "綠燈先鋒":"🟢","一支釣達人":"🎣","完美永續局":"🏆",
            "紅燈護送員":"🔴","養殖支持者":"🌾","深海傳說":"🐋",
            "浴火重生":"🔄","百發百中":"💯","海紋守護王":"👑",
            "珊瑚守護者":"🪸","漁法通":"🎯","近海英雄":"🌏"
        };

        function showBadge(idx, animate) {
            const key = newlyUnlockedBadges[idx];
            const icon = BADGE_META[key] || "⭐";
            if (animate) {
                iconEl.style.animation = "none";
                nameEl.style.animation = "none";
                void iconEl.offsetWidth;
                iconEl.style.animation = "winBadgeSlide .4s cubic-bezier(.34,1.56,.64,1) both, winIconFloat 2.6s .4s ease-in-out infinite";
                nameEl.style.animation = "winBadgeSlide .4s .05s ease both";
            }
            iconEl.textContent = icon;
            nameEl.textContent = key;
            if (dotsEl) {
                [...dotsEl.children].forEach((d, i) => {
                    d.style.background = `rgba(255,215,60,${i===idx?'.95':'.28'})`;
                    d.style.transform = i===idx ? 'scale(1.4)' : 'scale(1)';
                });
            }
            currentBadgeIdx = idx;
            // 更新分享按鈕文字（稍後建立，用 ref）
            if (window._winShareBtn) {
                window._winShareBtn.textContent = `📤 分享「${key}」成就`;
            }
        }

        showBadge(0, false);

        // 自動輪播
        let autoTimer = null;
        if (newlyUnlockedBadges.length > 1) {
            autoTimer = setInterval(() => {
                showBadge((currentBadgeIdx + 1) % newlyUnlockedBadges.length, true);
            }, 3200);
        }

        // 手勢滑動
        let touchStartX = 0;
        card.addEventListener("touchstart", e => { touchStartX = e.touches[0].clientX; }, { passive: true });
        card.addEventListener("touchend", e => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(dx) < 40) return;
            if (autoTimer) clearInterval(autoTimer);
            const next = dx < 0
                ? (currentBadgeIdx + 1) % newlyUnlockedBadges.length
                : (currentBadgeIdx - 1 + newlyUnlockedBadges.length) % newlyUnlockedBadges.length;
            showBadge(next, true);
            autoTimer = setInterval(() => {
                showBadge((currentBadgeIdx + 1) % newlyUnlockedBadges.length, true);
            }, 3200);
        }, { passive: true });
    }

    // ── 按鈕區 ──
    const btnZone = document.createElement("div");
    btnZone.style.cssText = `
        display:flex;flex-direction:column;align-items:center;gap:9px;
        width:100%;max-width:340px;
        animation:winFadeUp .65s ${hasNewBadge ? '.55s' : '.4s'} both;
    `;

    // ── 主角按鈕：分享（有新勳章時）or 重新啟航（無新勳章時）──
    if (hasNewBadge) {
        // 分享是主角
        const btnShare = document.createElement("button");
        btnShare.style.cssText = `
            width:100%;padding:13px;border-radius:50px;border:none;cursor:pointer;
            font-size:.98rem;font-weight:900;letter-spacing:.3px;
            font-family:"Microsoft JhengHei","PingFang TC",sans-serif;
            background:linear-gradient(135deg,#ffd060,#ff8c42);
            color:#3a1800;
            animation:winSharePulse 2.4s ease-in-out infinite;
        `;
        btnShare.textContent = `📤 分享「${newlyUnlockedBadges[0]}」成就`;
        window._winShareBtn = btnShare;
        btnShare.onclick = () => shareAchievementCard(isPlayer, winner, newlyUnlockedBadges[currentBadgeIdx]);
        btnZone.appendChild(btnShare);

        btnZone.appendChild(_makeCloseButton(isPlayer));

    } else {
        // 無新勳章：分享是主角
        const btnShare = document.createElement("button");
        btnShare.style.cssText = `
            width:100%;padding:13px;border-radius:50px;border:none;cursor:pointer;
            font-size:.98rem;font-weight:900;letter-spacing:.3px;
            font-family:"Microsoft JhengHei","PingFang TC",sans-serif;
            ${isPlayer
                ? 'background:linear-gradient(135deg,#ffd060,#ff8c42);color:#3a1800;animation:winSharePulse 2.4s ease-in-out infinite;'
                : 'background:linear-gradient(135deg,#3a7bff,#1a4fcc);color:#fff;animation:winSharePulseB 2.4s ease-in-out infinite;'}
        `;
        btnShare.textContent = "📤 分享這場冒險";
        btnShare.onclick = () => shareGameCard(isPlayer, winner);
        btnZone.appendChild(btnShare);

        btnZone.appendChild(_makeCloseButton(isPlayer));
    }

    // 底部文字連結列
    const linkRow = document.createElement("div");
    linkRow.style.cssText = `display:flex;gap:24px;margin-top:4px;`;

    [["📋 出牌紀錄", () => {
        overlay.style.opacity = "0"; overlay.style.pointerEvents = "none";
        openLog();
        const orig = window.closeLog;
        window.closeLog = () => { orig(); overlay.style.transition="opacity .4s ease"; overlay.style.opacity="1"; overlay.style.pointerEvents=""; window.closeLog=orig; };
    }], ["🐠 我的收集", () => { if (typeof openCollection==='function') openCollection(); }]
    ].forEach(([label, fn]) => {
        const link = document.createElement("button");
        link.style.cssText = `
            background:none;border:none;cursor:pointer;padding:4px 0;
            font-size:.88rem;font-weight:600;
            font-family:"Microsoft JhengHei","PingFang TC",sans-serif;
            color:${isPlayer?'rgba(200,255,220,.55)':'rgba(150,200,255,.55)'};
            text-decoration:underline;text-underline-offset:3px;
            text-decoration-color:rgba(255,255,255,.2);
        `;
        link.textContent = label;
        link.onclick = fn;
        linkRow.appendChild(link);
    });
    btnZone.appendChild(linkRow);
    content.appendChild(btnZone);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = "1"; }));
}

// ── 結算畫面「關閉」按鈕：送 exit 訊息 + window.close()，回到平台 ──
function _makeCloseButton(isPlayer) {
    const btnClose = document.createElement("button");
    btnClose.style.cssText = `
        width:100%;padding:10px;border-radius:50px;cursor:pointer;
        font-size:.85rem;font-weight:700;letter-spacing:.2px;
        font-family:"Microsoft JhengHei","PingFang TC",sans-serif;
        border:1.5px solid rgba(255,255,255,.18);
        background:rgba(255,255,255,.06);
        color:rgba(255,255,255,.65);
    `;
    btnClose.innerHTML = '<span style="filter: brightness(1.9) saturate(1.8) drop-shadow(0 0 4px rgba(255,255,255,0.9));">🔚</span> 關閉，返回平台';
    btnClose.onclick = () => { if (typeof closeTaskToPlatform === "function") closeTaskToPlatform(); };
    return btnClose;
}

// ── 重新啟動遊戲 ──
// 用 location.reload() 而非手動重設一堆全域狀態：同一個分頁重新整理不會失去
// window.opener（跟平台的 postMessage 連結還在），且 index.html 開頭已經有
// sessionStorage.skipIntro 的判斷會跳過開場動畫直接進歡迎頁，重整後 platform.js
// 會重新送一次 ready、拿到平台最新的 player_info（含剛剛這局才拿到的徽章/分數），
// 資料反而更準，不用自己在 JS 裡維護一份「重開後要保留什麼」的清單。
function _restartGame(winBgm, gameBgm, particleTimer) {
    winBgm.pause();
    if (gameBgm) gameBgm.play().catch(() => {});
    clearInterval(particleTimer);
    window._winShareBtn = null;
    sessionStorage.setItem("sfxEnabled", sfxEnabled ? "true" : "false");
    sessionStorage.setItem("skipIntro", "1");
    location.reload();
}


// =============================================
// 📤 分享勳章成就卡片
// =============================================

// 依勳章 key 查 db.js BEHAVIOR_BADGE_DB 的 icon（原本這裡另外寫死一份 BADGE_META_SHARE，
// 跟 main.js openCollection() 用的圖示是同一份資料，現在統一從 db.js 查，不用維護兩份）
function _badgeIcon(badgeKey) {
    if (typeof BEHAVIOR_BADGE_DB === "undefined") return "⭐";
    const b = BEHAVIOR_BADGE_DB.find(function (x) { return x.key === badgeKey; });
    return (b && b.icon) ? b.icon : "⭐";
}

async function shareAchievementCard(isPlayer, winner, badgeKey) {
    const icon = _badgeIcon(badgeKey);
    const diffLabel = getDifficultyInfo(gameDifficulty).label;

    const W = 390, H = 693;
    const canvas = document.createElement("canvas");
    canvas.width = W * 2; canvas.height = H * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    let bgImg = null;
    try { bgImg = await loadImageAsBlob("image/bge.png"); } catch(_) {}
    ctx.fillStyle = "#020a04";
    ctx.fillRect(0, 0, W, H);

    if (bgImg) {
        const sc = Math.max(W/bgImg.width, H/bgImg.height);
        ctx.save();
        ctx.globalAlpha = .88;
        ctx.drawImage(bgImg, (W-bgImg.width*sc)/2, (H-bgImg.height*sc)/2, bgImg.width*sc, bgImg.height*sc);
        ctx.restore();
    }

    // 深色遮罩
    const grd = ctx.createLinearGradient(0,0,0,H);
    grd.addColorStop(0,   "rgba(3,12,6,.58)");
    grd.addColorStop(.4,  "rgba(1,6,3,.18)");
    grd.addColorStop(1,   "rgba(0,6,2,.9)");
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,W,H);

    // 卡片圓角框
    const cx = W/2, cy = H/2;
    const cw = 320, ch = 320, cr = 28;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx-cw/2+cr, cy-ch/2);
    ctx.lineTo(cx+cw/2-cr, cy-ch/2);
    ctx.arcTo(cx+cw/2, cy-ch/2, cx+cw/2, cy-ch/2+cr, cr);
    ctx.lineTo(cx+cw/2, cy+ch/2-cr);
    ctx.arcTo(cx+cw/2, cy+ch/2, cx+cw/2-cr, cy+ch/2, cr);
    ctx.lineTo(cx-cw/2+cr, cy+ch/2);
    ctx.arcTo(cx-cw/2, cy+ch/2, cx-cw/2, cy+ch/2-cr, cr);
    ctx.lineTo(cx-cw/2, cy-ch/2+cr);
    ctx.arcTo(cx-cw/2, cy-ch/2, cx-cw/2+cr, cy-ch/2, cr);
    ctx.closePath();
    ctx.fillStyle = "rgba(10,8,4,.62)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,215,60,.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 遊戲名
    ctx.font = "600 15px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.fillStyle = "rgba(155,240,185,.6)";
    ctx.letterSpacing = "4px";
    ctx.fillText("友魚守護團", cx, cy - 128);
    ctx.letterSpacing = "0px";

    // 「成就解鎖」
    ctx.font = "500 12px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.fillStyle = "rgba(255,225,100,.72)";
    ctx.letterSpacing = "3px";
    ctx.fillText("✨  新成就解鎖  ✨", cx, cy - 100);
    ctx.letterSpacing = "0px";

    // 大圖示
    ctx.font = "88px serif";
    ctx.fillText(icon, cx, cy - 18);

    // 勳章名
    ctx.font = "900 32px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.shadowColor = "rgba(255,215,60,.65)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "rgba(255,248,185,.98)";
    ctx.fillText(badgeKey, cx, cy + 88);
    ctx.shadowBlur = 0;

    // 玩家 & 難度
    ctx.font = "500 15px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.fillStyle = "rgba(175,255,210,.7)";
    ctx.fillText(`${winner.n}・${diffLabel}難度`, cx, cy + 128);

    // 版權小字
    ctx.font = "400 14px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.letterSpacing = "1px";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(200,230,255,.5)";
    ctx.fillText("© 2026 友魚守護團", cx, H - 28);
    ctx.letterSpacing = "0px";

    canvas.toBlob(async (blob) => {
        if (!blob) { alert("卡片產生失敗"); return; }
        const file = new File([blob], `友魚守護團_${badgeKey}.png`, { type:"image/png" });
        const text = `我在《友魚守護團》解鎖了「${badgeKey}」成就！${icon} 你也來挑戰看看 🌊`;
        if (navigator.canShare && navigator.canShare({ files:[file] })) {
            try { await navigator.share({ files:[file], text }); }
            catch(e) { if (e.name !== "AbortError") fallbackDownload(canvas, `友魚守護團_${badgeKey}`); }
        } else {
            fallbackDownload(canvas, `友魚守護團_${badgeKey}`);
        }
    }, "image/png");
}


// =============================================
// 📤 分享遊戲卡片（無新勳章時）
// =============================================

async function shareGameCard(isPlayer, winner) {
    const diffLabel = getDifficultyInfo(gameDifficulty).label;
    const rounds = typeof roundCount !== "undefined" ? roundCount : 0;

    const W = 390, H = 693;
    const canvas = document.createElement("canvas");
    canvas.width = W*2; canvas.height = H*2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    let bgImg = null;
    try { bgImg = await loadImageAsBlob("image/bge.png"); } catch(_) {}
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (bgImg) {
        const sc = Math.max(W/bgImg.width, H/bgImg.height);
        ctx.save();
        ctx.globalAlpha = isPlayer ? .9 : .6;
        if (!isPlayer) ctx.filter = "hue-rotate(190deg) saturate(.85) brightness(.65)";
        ctx.drawImage(bgImg, (W-bgImg.width*sc)/2, (H-bgImg.height*sc)/2, bgImg.width*sc, bgImg.height*sc);
        ctx.filter = "none";
        ctx.restore();
    }

    const grd = ctx.createLinearGradient(0,0,0,H);
    if (isPlayer) { grd.addColorStop(0,"rgba(2,14,6,.4)"); grd.addColorStop(.45,"rgba(1,8,4,.16)"); grd.addColorStop(1,"rgba(0,10,4,.82)"); }
    else          { grd.addColorStop(0,"rgba(2,6,20,.5)"); grd.addColorStop(.45,"rgba(1,4,14,.22)"); grd.addColorStop(1,"rgba(0,4,18,.86)"); }
    ctx.fillStyle = grd; ctx.fillRect(0,0,W,H);

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const CX = W/2; let Y = 210;

    ctx.font = "900 40px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.letterSpacing = "4px";
    ctx.shadowColor = isPlayer?"rgba(100,255,160,.5)":"rgba(50,130,255,.45)";
    ctx.shadowBlur = 26;
    ctx.fillStyle = isPlayer?"#fff":"rgba(215,235,255,.96)";
    ctx.fillText("友魚守護團", CX, Y); Y += 38;
    ctx.shadowBlur = 0;
    ctx.font = "500 15px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = isPlayer?"rgba(155,240,185,.65)":"rgba(125,175,255,.6)";
    ctx.fillText("台灣海線任務", CX, Y); Y += 52;
    ctx.letterSpacing = "0px"; ctx.shadowBlur = 0;

    if (isPlayer) {
        ctx.font = "700 21px 'PingFang TC','Microsoft JhengHei',sans-serif";
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(80,255,140,.32)"; ctx.shadowBlur = 14;
        [`${winner.n} 在【${diffLabel}】難度的考驗下`, `與大海交手了 ${rounds} 個回合`, `守護了海洋的平衡`].forEach(l => { ctx.fillText(l, CX, Y); Y += 38; });
        ctx.shadowBlur = 0; Y += 20;
        ctx.font = "500 19px 'PingFang TC','Microsoft JhengHei',sans-serif";
        ctx.fillStyle = "rgba(155,240,185,.8)";
        ctx.fillText("🐟 每一張牌，都是一個選擇", CX, Y);
    } else {
        ctx.font = "900 27px 'PingFang TC','Microsoft JhengHei',sans-serif";
        ctx.fillStyle = "rgba(210,230,255,.95)";
        ctx.shadowColor = "rgba(50,120,255,.35)"; ctx.shadowBlur = 16;
        ctx.fillText("大海這次贏了。", CX, Y); ctx.shadowBlur = 0; Y += 50;
        ctx.font = "500 19px 'PingFang TC','Microsoft JhengHei',sans-serif";
        ctx.fillStyle = "rgba(125,180,255,.65)";
        ctx.fillText("守護員折返，海域等你再來", CX, Y);
    }

    // 版權小字
    ctx.font = "400 14px 'PingFang TC','Microsoft JhengHei',sans-serif";
    ctx.letterSpacing = "1px";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(200,230,255,.5)";
    ctx.fillText("© 2026 友魚守護團", CX, H - 28);
    ctx.letterSpacing = "0px";

    canvas.toBlob(async (blob) => {
        if (!blob) { alert("卡片產生失敗"); return; }
        const file = new File([blob], "image/友魚守護團.png", {type:"image/png"});
        const text = isPlayer
            ? `${winner.n} 在《友魚守護團》守護了海洋！難度【${diffLabel}】，共 ${rounds} 回合 🎉🌊`
            : `${winner.n} 在《友魚守護團》這次沒守住…下次再來 🌊`;
        if (navigator.canShare && navigator.canShare({ files:[file] })) {
            try { await navigator.share({ files:[file], text }); }
            catch(e) { if (e.name !== "AbortError") fallbackDownload(canvas, "友魚守護團"); }
        } else { fallbackDownload(canvas, "友魚守護團"); }
    }, "image/png");
}

function loadImageAsBlob(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src + "?_=" + Date.now();
    });
}

function fallbackDownload(canvas, name = "友魚守護團") {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = name + ".png";
    a.click();
}

/* ═════════════════════════════════════════════════════════════
   排行榜：收集分數（本機版，暫不連 Firebase）
   ─────────────────────────────────────────────────────────────
   資料完全來自 localStorage（progress_暱稱），不用另外存、不用上傳，
   打開排行榜時直接掃描同一台裝置上玩過的所有暱稱、即時算分排序。
   之後想接雲端同步，只要把 computeCollectionStats() 算出來的東西
   寫進 Firestore 就行，這支檔案的算分邏輯不用重寫。

   每一項收集到的東西分數「不是」在這裡算出來的，全部改成直接讀取
   db.js 裡寫死的分數欄位／常數。想調整任何一項的分數，去改 db.js
   即可，這支檔案不用動：

   ┌─────────┬──────────────────────────────────────────────┐
   │ 魚圖鑑   │ db.js fishDB 每筆的 score 欄位                  │
   │ 同伴角色 │ db.js characterDB 每筆的 score 欄位             │
   │ 難度章   │ db.js difficultyDB 每筆的 scoreBadge 欄位       │
   │          │ （DIFFICULTY_SCORES 是從它自動產生的相容查表）  │
   │ 行為勳章 │ db.js BEHAVIOR_BADGE_DB 每筆的 score 欄位       │
   │          │ （BEHAVIOR_BADGE_SCORES 是從它自動產生的相容查表）│
   │ 漁港徽章 │ db.js locationDB 每筆的 badgeScore 欄位         │
   │ 勝場加成 │ db.js difficultyDB 每筆的 winBonus 欄位（次數 × │
   │          │ 每勝分數，會累加；WIN_BONUS_SCORE 是相容查表）  │
   └─────────┴──────────────────────────────────────────────┘

   總分沒有上限，就是把玩家實際擁有的所有項目分數加總。
   ═════════════════════════════════════════════════════════════ */

// 依魚名查 db.js fishDB 裡寫死的 score 欄位
function _fishScore(fishName) {
    if (typeof fishDB === "undefined") return 0;
    const fish = fishDB.find(function (f) { return f.n === fishName; });
    return (fish && fish.score != null) ? fish.score : 0;
}

// 依漁港徽章名稱查 db.js locationDB 裡寫死的 badgeScore 欄位
function _harborScore(badgeName) {
    if (typeof locationDB === "undefined") return 0;
    const loc = locationDB.find(function (l) { return l.badge === badgeName; });
    return (loc && loc.badgeScore != null) ? loc.badgeScore : 0;
}

/* ── 計算某玩家目前的收集分數與完整度 ── */
function computeCollectionStats(name) {
    const data = (typeof progress !== "undefined") ? progress.load(name) : null;

    const behaviorScores = (typeof BEHAVIOR_BADGE_SCORES !== "undefined") ? BEHAVIOR_BADGE_SCORES : {};

    const fishList       = (data && data.fish) ? data.fish : [];
    const behaviorList    = (data && data.behaviorBadges) ? data.behaviorBadges : [];
    const harborList      = (data && data.badges) ? data.badges : [];

    const fishScore       = fishList.reduce(function (s, n) { return s + _fishScore(n); }, 0);
    const behaviorScore   = behaviorList.reduce(function (s, n) { return s + (behaviorScores[n] || 0); }, 0);
    const harborScore     = harborList.reduce(function (s, n) { return s + _harborScore(n); }, 0);

    const totalScore = fishScore + behaviorScore + harborScore;

    const fishMax     = (typeof fishDB !== "undefined") ? fishDB.length : 48;
    const harborMax    = (typeof locationDB !== "undefined") ? locationDB.length : 6;
    const behaviorMax  = (typeof BEHAVIOR_BADGE_DB !== "undefined") ? BEHAVIOR_BADGE_DB.length : Object.keys(behaviorScores).length;

    const totalCount    = fishList.length + behaviorList.length + harborList.length;
    const totalCountMax = fishMax + behaviorMax + harborMax;

    return {
        fishScore, behaviorScore, harborScore, totalScore,
        totalCount, totalCountMax
    };
}

function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

/* ── 排行榜彈窗 ── */
// 改接平台後，「跨裝置比較」交給平台首頁自己的排行榜（各任務前10名），
// 這裡只顯示「我的收藏進度」——本裝置本人這個任務目前的收集分數與各類別明細。
function openLeaderboard() {
    let overlay = document.getElementById("leaderboard-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "leaderboard-overlay";
        overlay.style.cssText = "display:flex; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.82); z-index:3000; align-items:center; justify-content:center; font-family:'Microsoft JhengHei','PingFang TC',sans-serif;";
        overlay.innerHTML =
            '<div style="width:88%;max-width:380px;max-height:78vh;overflow-y:auto;background:rgba(8,20,14,.96);border:1px solid rgba(100,200,150,.28);border-radius:20px;padding:26px 22px 22px;position:relative;">' +
                '<button onclick="closeLeaderboard()" style="position:absolute;top:14px;right:16px;background:none;border:none;cursor:pointer;font-size:20px;color:rgba(200,240,220,.55);">✕</button>' +
                '<div style="font-size:1.1rem;font-weight:900;color:rgba(200,245,220,.9);letter-spacing:1px;margin-bottom:2px;">🏆 我的收藏進度</div>' +
                '<div style="font-size:11px;color:rgba(160,210,180,.55);margin-bottom:16px;">完整跨玩家排行榜請到平台首頁的排行榜查看</div>' +
                '<div id="leaderboard-list" style="font-size:14px;color:rgba(220,245,230,.9);">載入中…</div>' +
            "</div>";
        document.body.appendChild(overlay);
    }
    overlay.style.display = "flex";

    const list = document.getElementById("leaderboard-list");
    const s = computeCollectionStats(window.playerName);
    const rowsHtml = [
        ["🐟 魚類圖鑑", s.fishScore], ["✨ 行為勳章", s.behaviorScore],
        ["⚓ 漁港章", s.harborScore]
    ].map(function (row) {
        return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08);">' +
               '<span>' + row[0] + '</span><span>' + row[1] + ' 分</span></div>';
    }).join("");
    list.innerHTML =
        '<div style="text-align:center;margin-bottom:14px;">' +
            '<div style="font-size:12px;color:rgba(200,230,215,.6);">' + _escapeHtml(window.playerName || "") + ' 目前總分</div>' +
            '<div style="font-size:2rem;font-weight:900;color:#ffd54a;">' + s.totalScore + '</div>' +
            '<div style="font-size:11px;color:rgba(200,230,215,.55);">收集 ' + s.totalCount + ' / ' + s.totalCountMax + '</div>' +
        '</div>' + rowsHtml;
}

function closeLeaderboard() {
    const overlay = document.getElementById("leaderboard-overlay");
    if (overlay) overlay.style.display = "none";
}

window.computeCollectionStats = computeCollectionStats;
window.openLeaderboard        = openLeaderboard;
window.closeLeaderboard       = closeLeaderboard;
