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
        ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
        if (ctx.measureText(text).width <= maxWidth) break;
        size--;
    }
    ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
}

function makeCard(data) {
    const canvas = document.createElement('canvas'); canvas.width=638; canvas.height=900;
    const c=canvas.getContext('2d'), navy='#173D50', teal='#387D78', muted='#72837E';
    const text=(value,x,y,size,color=navy,weight=600)=>{c.font=weight+' '+size+'px "Microsoft JhengHei", "Noto Sans TC", sans-serif';c.fillStyle=color;c.fillText(value,x,y);};
    const rect=(x,y,w,h,r,fill)=>{c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();};
    c.save(); c.beginPath();c.roundRect(0,0,638,900,30);c.clip();
    c.fillStyle='#F8F6ED';c.fillRect(0,0,638,900);
    c.fillStyle=navy;c.fillRect(0,0,638,142);c.fillStyle='#C7AF78';c.fillRect(0,140,638,4);
    c.textAlign='center';text('船員證',319,81,52,'#FFFFFF',800);text('CULTURE CREW PASS',319,117,19,'#C4D7D8',500);
    // 圓形頭像窗與細緻證件飾紋。
    c.strokeStyle='#E0E7DD';c.lineWidth=1.5;
    for(let i=0;i<3;i++){c.beginPath();c.ellipse(319,294,128+i*5,128+i*5,0,0,Math.PI*2);c.stroke();}
    c.beginPath();c.arc(319,294,124,0,Math.PI*2);c.fillStyle='#E2ECE3';c.fill();
    if(data.avatarImage)c.drawImage(data.avatarImage,204,179,230,230);else text(data.avatar,319,329,90);
    text('船員名稱',319,454,21,muted,500);
    fitText(c,data.name,538,55,22);c.fillStyle=navy;c.fillText(data.name,319,519);
    rect(174,549,290,53,26,'#E0EBE3');text('Lv.'+data.level+'  ·  '+data.title,319,584,25,teal,700);
    c.beginPath();c.moveTo(70,638);c.lineTo(568,638);c.strokeStyle='#D2D9CC';c.stroke();
    text('徽章收藏',319,681,22,muted,500);text(data.badgeCount+' 枚',319,733,43,teal,800);
    text('苗栗縣在地文化推廣協會',319,805,27,navy,700);text('在地文化知識型互動平台',319,840,20,muted,500);
    c.fillStyle=navy;c.fillRect(0,870,638,30);
    c.restore();return canvas;
}

function injectStyles() {
    if (document.getElementById('crew-card-style')) return;
    const style = document.createElement('style');
    style.id = 'crew-card-style';
    style.textContent = `
      .crew-overlay{position:fixed;inset:0;z-index:180;background:rgba(4,12,25,.88);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
      .crew-dialog{width:100%;max-width:390px;max-height:calc(100dvh - 32px);overflow:auto;background:#102d42;border:1px solid #607D86;border-radius:20px;padding:16px;color:#fff;box-sizing:border-box;box-shadow:0 18px 60px #0006}
      .crew-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
      .crew-header h2{margin:0;font-size:20px}
      .crew-close{border:0;background:transparent;color:#fff;font:inherit;font-size:25px;cursor:pointer;width:40px;height:40px}
      .crew-picture{display:block;width:100%;height:auto;border-radius:10px}
      .crew-actions{display:flex;gap:10px;margin-top:12px}
      .crew-actions button{flex:1;border:0;border-radius:12px;padding:13px 8px;font-family:inherit;font-size:16px;font-weight:700;cursor:pointer;min-height:44px}
      .crew-share{background:#C9DFD4;color:#102d42}.crew-download{background:#28536b;color:#fff}
      .crew-actions button:disabled{opacity:.45;cursor:wait}
      .crew-status{font-size:14px;line-height:1.6;color:#bfd5df;margin:10px 0 0}
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

