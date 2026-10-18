// 船員證只使用平台已載入的玩家資料，不另外讀寫資料庫。

export function getCrewTitle(level) {
    if (level >= 5) return '友魚守護者';
    if (level >= 3) return '資深船員';
    if (level >= 2) return '海線探索員';
    return '新進船員';
}

let activeClose = null;
export function closeCrewCard() { activeClose?.(); }

function fitText(ctx, text, maxWidth, size, minimum = 18) {
    while (size > minimum) {
        ctx.font = `700 ${size}px "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
        if (ctx.measureText(text).width <= maxWidth) break;
        size--;
    }
    ctx.font = `700 ${size}px "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
}

function makeCard(data) {
    const canvas=document.createElement('canvas');canvas.width=638;canvas.height=900;
    const c=canvas.getContext('2d'),navy='#163F51',teal='#286D68',gold='#BE9B59',muted='#67776F';
    const rect=(x,y,w,h,r,fill,stroke,width=1)=>{c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.lineWidth=width;c.strokeStyle=stroke;c.stroke()}};
    const text=(value,x,y,size,color=navy,weight=600)=>{c.font=weight+' '+size+'px "Microsoft JhengHei", "Noto Sans TC", sans-serif';c.fillStyle=color;c.fillText(value,x,y)};
    c.save();c.beginPath();c.roundRect(2,2,634,896,30);c.clip();
    const paper=c.createLinearGradient(0,0,638,900);paper.addColorStop(0,'#FFFCF0');paper.addColorStop(.55,'#F5F0DF');paper.addColorStop(1,'#E8DEC4');
    c.fillStyle=paper;c.fillRect(0,0,638,900);
    rect(4,4,630,892,28,null,'#FFF9E7',8);rect(16,16,606,868,22,null,gold,2);rect(24,24,590,852,17,null,'#DCCDAA',1);
    // A continuous ivory perimeter keeps the navy heading inside the physical card.
    rect(33,33,572,124,13,navy);rect(39,39,560,112,10,null,'#77948D',1);
    c.textAlign='center';text('船員證',319,101,49,'#FFF7E4',800);text('苗栗海線・文化探索',319,134,20,'#D7C492',500);
    c.save();c.globalAlpha=.2;c.strokeStyle=gold;c.lineWidth=1;
    for(let i=0;i<4;i++){c.beginPath();for(let x=45;x<=593;x+=4){const y=365+i*10+Math.sin(x/52+i*.6)*15;if(x===45)c.moveTo(x,y);else c.lineTo(x,y)}c.stroke()}c.restore();
    // Raised portrait medallion, without introducing any additional account data.
    c.save();c.shadowColor='#294E4933';c.shadowBlur=14;c.shadowOffsetY=6;c.beginPath();c.arc(319,298,124,0,Math.PI*2);c.fillStyle='#FFFBED';c.fill();c.restore();
    c.beginPath();c.arc(319,298,123,0,Math.PI*2);c.lineWidth=4;c.strokeStyle=gold;c.stroke();
    c.beginPath();c.arc(319,298,113,0,Math.PI*2);c.fillStyle='#DEE9DF';c.fill();
    c.save();c.beginPath();c.arc(319,298,111,0,Math.PI*2);c.clip();if(data.avatarImage)c.drawImage(data.avatarImage,207,186,224,224);else text(data.avatar,319,332,90);c.restore();
    text('船員名稱',319,463,21,muted,500);fitText(c,data.name,510,52,22);c.fillStyle=navy;c.fillText(data.name,319,523);
    rect(134,552,370,56,28,navy);text('Lv.'+data.level+'  ·  '+data.title,319,589,27,'#FFF3D3',700);
    rect(72,641,494,112,13,'#FFFCF0','#D0BD91',2);text('徽章收藏',319,680,22,muted,500);text(data.badgeCount+' 枚',319,728,40,teal,800);
    text('苗栗縣在地文化推廣協會',319,802,27,navy,700);text('在地文化知識型互動平台',319,834,20,muted,500);
    rect(72,851,494,22,6,navy);text('帶著好奇心，探索海線',319,867,15,'#EEE3C6',500);
    c.restore();return canvas;
}

function injectStyles() {
    if (document.getElementById('crew-card-style')) return;
    const style = document.createElement('style');
    style.id = 'crew-card-style';
    style.textContent = `
      .crew-overlay{position:fixed;inset:0;z-index:180;background:rgba(6,11,15,.88);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
      .crew-dialog{width:100%;max-width:400px;max-height:calc(100dvh - 32px);overflow:auto;background:#292F34;border:1px solid #58616A;border-radius:22px;padding:18px;color:#F8F1DF;box-sizing:border-box;box-shadow:0 22px 70px #0009}
      .crew-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
      .crew-header h2{margin:0;font-size:20px}
      .crew-close{border:0;background:transparent;color:#fff;font:inherit;font-size:25px;cursor:pointer;width:40px;height:40px}
      .crew-picture{display:block;width:100%;height:auto;box-sizing:border-box;border:4px solid #FFF7E3;border-radius:17px;background:#FFF7E3;box-shadow:0 3px 0 #A99163,0 12px 25px #0008,0 0 0 1px #D3BB84;margin-bottom:20px}
      .crew-actions{display:flex;gap:10px;margin-top:12px}
      .crew-actions button{flex:1;border:0;border-radius:12px;padding:13px 8px;font-family:inherit;font-size:16px;font-weight:700;cursor:pointer;min-height:44px}
      .crew-share{background:#E8D6AC;color:#243E49}.crew-download{background:#475861;color:#fff;border:1px solid #829198!important}
      .crew-actions button:disabled{opacity:.45;cursor:wait}
      .crew-status{font-size:14px;line-height:1.6;color:#D3D9D9;margin:12px 0 0}
    `;
    document.head.appendChild(style);
}

export function openCrewCard({ user, avatar, level }) {
    closeCrewCard();
    injectStyles();
    const data = {
        name: user.nickname || '船員', avatar: avatar || '🙂', level,
        title: getCrewTitle(level),
        badgeCount: new Set(user.badges || []).size
    };
    const overlay = document.createElement('div');
    overlay.className = 'crew-overlay';
    overlay.innerHTML = `
      <section class="crew-dialog" role="dialog" aria-modal="true" aria-labelledby="crew-card-title" tabindex="-1">
        <div class="crew-header"><h2 id="crew-card-title">我的船員證</h2><button class="crew-close" aria-label="關閉船員證">×</button></div>
        <img class="crew-picture" alt="">
        <div class="crew-actions"><button class="crew-share" disabled>分享船員證</button><button class="crew-download" disabled>下載圖片</button></div>
        <p class="crew-status" role="status" aria-live="polite">正在製作船員證…</p>
      </section>`;
    const previousFocus = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const picture = overlay.querySelector('.crew-picture');
    const shareButton = overlay.querySelector('.crew-share');
    const downloadButton = overlay.querySelector('.crew-download');
    const status = overlay.querySelector('.crew-status');
    let file = null, objectUrl = null, closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        overlay.remove();
        document.body.style.overflow = oldOverflow;
        document.removeEventListener('keydown', onKey);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (activeClose === close) activeClose = null;
        if (previousFocus?.isConnected) previousFocus.focus();
    };
    const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key !== 'Tab') return;
        const items = [...overlay.querySelectorAll('button:not(:disabled)')];
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === overlay.querySelector('.crew-dialog'))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    activeClose = close;
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.crew-close').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    document.body.appendChild(overlay);
    overlay.querySelector('.crew-close').focus();
    picture.alt = `${data.name}的船員證，Lv.${data.level}，${data.title}，已收藏${data.badgeCount}枚徽章。`;

    downloadButton.onclick = () => {
        if (!objectUrl) return;
        const a = document.createElement('a');
        a.href = objectUrl; a.download = '船員證.png';
        document.body.appendChild(a); a.click(); a.remove();
        status.textContent = '已送出圖片下載；若瀏覽器未下載，可長按船員證圖片儲存後分享。';
    };
    shareButton.onclick = async () => {
        if (!file) return;
        try {
            // 在點擊當下呼叫分享，圖片已事先產生，保留手機要求的使用者操作資格。
            if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
                status.textContent = '此瀏覽器不支援圖片分享，請下載圖片後分享，或長按圖片儲存。';
                return;
            }
            await navigator.share({ files: [file], title: '我的船員證', text: '帶著好奇心出航，探索苗栗海線！' });
            if (!closed) status.textContent = '船員證已交給分享工具。';
        } catch (err) {
            if (closed) return;
            status.textContent = err.name === 'AbortError'
                ? '已取消分享，可隨時再試。'
                : '目前無法開啟分享，請下載圖片後分享，或長按圖片儲存。';
        }
    };
    (async () => {
        try {
            if (document.fonts) {
                await Promise.race([
                    document.fonts.load('700 48px "Noto Sans TC"'),
                    new Promise(resolve => setTimeout(resolve, 1500))
                ]);
            }
            if (closed) return;
            if (data.avatar.startsWith('data:image/svg+xml')) {
                const image = new Image(); image.src = data.avatar;
                await image.decode(); data.avatarImage = image;
            }
            if (closed) return;
            const canvas = makeCard(data);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('圖片製作失敗');
            if (closed) return;
            objectUrl = URL.createObjectURL(blob);
            picture.src = objectUrl;
            file = new File([blob], '船員證.png', { type: 'image/png' });
            shareButton.disabled = downloadButton.disabled = false;
            status.textContent = '分享圖片包含船員名稱、等級與徽章數。可分享給朋友，或下載留念。';
        } catch {
            if (!closed) status.textContent = '船員證圖片製作失敗，請關閉後重新開啟。';
        }
    })();
}

