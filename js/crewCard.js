// 船員證只使用平台已載入的玩家資料，不另外讀寫資料庫。
const HARBORS = [
    { id: 'mlhbtrip_longfeng', name: '龍鳳漁港' },
    { id: 'mlhbtrip_waipu', name: '外埔漁港' },
    { id: 'mlhbtrip_yuangang', name: '苑港漁港' }
];

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
    const canvas = document.createElement('canvas');
    canvas.width = 1012; canvas.height = 638;
    const c = canvas.getContext('2d');
    const navy = '#143B50', teal = '#267E7E', gold = '#C4A56A', muted = '#62787D';
    const rounded = (x,y,w,h,r,fill,stroke) => {
        c.beginPath(); c.roundRect(x,y,w,h,r);
        if (fill) { c.fillStyle=fill; c.fill(); }
        if (stroke) { c.strokeStyle=stroke; c.lineWidth=2; c.stroke(); }
    };
    const text = (value,x,y,size,color=navy,weight=600) => {
        c.fillStyle=color; c.font=weight+' '+size+'px "Microsoft JhengHei", "Noto Sans TC", sans-serif'; c.fillText(value,x,y);
    };
    // 橫式證件比例與圓角，分享與下載使用相同畫布。
    c.save(); c.beginPath(); c.roundRect(0,0,1012,638,28); c.clip();
    c.fillStyle='#F7F5ED'; c.fillRect(0,0,1012,638);
    // 淡色海浪底紋，保留姓名與資料可讀性。
    c.strokeStyle='#E7ECE3'; c.lineWidth=2;
    for(let i=0;i<9;i++){
        c.beginPath(); c.moveTo(420,145+i*37);
        c.bezierCurveTo(620,80+i*37,790,250+i*37,1040,150+i*37); c.stroke();
    }
    c.fillStyle=navy; c.fillRect(0,0,1012,126);
    c.fillStyle=gold; c.fillRect(0,126,1012,5);
    // 航海徽記。
    c.save(); c.translate(71,65); c.strokeStyle='#D9C99D'; c.lineWidth=2;
    c.beginPath(); c.arc(0,0,32,0,Math.PI*2); c.stroke();
    c.beginPath(); c.moveTo(0,-25); c.lineTo(8,-7); c.lineTo(25,0); c.lineTo(8,7); c.lineTo(0,25); c.lineTo(-8,7); c.lineTo(-25,0); c.lineTo(-8,-7); c.closePath(); c.stroke();
    c.restore();
    text('船員證',125,75,48,'#FFFFFF',800);
    text('CULTURE CREW PASS',127,104,19,'#D5E4E4',500);
    c.textAlign='right'; text('苗栗縣在地文化推廣協會',958,63,27,'#F7F5ED',600);
    text('在地文化知識型互動平台',958,99,21,'#BDCFD2',500); c.textAlign='left';
    rounded(48,162,232,244,15,'#E5ECE7','#CDD8D3');
    if(data.avatarImage) c.drawImage(data.avatarImage,67,177,194,194);
    else { c.textAlign='center'; text(data.avatar,164,291,82); c.textAlign='left'; }
    c.textAlign='center'; text('海線探索船員',164,390,20,muted,500); c.textAlign='left';
    text('船員名稱 / NAME',320,188,22,muted,500);
    fitText(c,data.name,625,66,24); c.fillStyle=navy; c.fillText(data.name,318,263);
    c.strokeStyle='#CDD8D3'; c.lineWidth=2;c.beginPath();c.moveTo(320,286);c.lineTo(960,286);c.stroke();
    text('船員等級',320,324,22,muted,500);
    text('Lv.'+data.level,320,377,40,teal,800);
    text('身分',481,324,22,muted,500);
    text(data.title,481,377,31,navy,700);
    text('徽章收藏',790,324,22,muted,500);
    text(data.badgeCount+' 枚',790,377,38,teal,800);
    text('漁港探索紀錄',52,449,24,navy,700);
    c.textAlign='right';text('已到訪 '+data.visited+' / 3',958,449,23,muted,500);c.textAlign='left';
    data.harbors.forEach((harbor,index)=>{
        const x=48+index*309;
        rounded(x,468,298,91,13,harbor.owned?'#DFEDE7':'#EEEEE6',harbor.owned?'#B5D0C5':'#DDDED4');
        c.beginPath();c.arc(x+35,513,17,0,Math.PI*2);c.fillStyle=harbor.owned?teal:'#C4CCC5';c.fill();
        if(harbor.owned){c.beginPath();c.moveTo(x+27,513);c.lineTo(x+33,519);c.lineTo(x+43,506);c.strokeStyle='white';c.lineWidth=3;c.lineCap='round';c.stroke();}
        text(harbor.name,x+66,506,29,navy,700);
        text(harbor.owned?'已到訪':'待探索',x+66,539,21,muted,500);
    });
    c.fillStyle=navy;c.fillRect(0,586,1012,52);
    text('帶著好奇心出航，探索苗栗海線',49,620,22,'#D7E5E6',500);
    c.textAlign='right';text('GAMEHUB',960,620,21,'#D5C29A',700);c.textAlign='left';
    c.restore();
    return canvas;
}

function injectStyles() {
    if (document.getElementById('crew-card-style')) return;
    const style = document.createElement('style');
    style.id = 'crew-card-style';
    style.textContent = `
      .crew-overlay{position:fixed;inset:0;z-index:180;background:rgba(4,12,25,.88);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
      .crew-dialog{width:100%;max-width:620px;max-height:calc(100dvh - 32px);overflow:auto;background:#102d42;border:1px solid #607D86;border-radius:20px;padding:16px;color:#fff;box-sizing:border-box;box-shadow:0 18px 60px #0006}
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
    const certs = new Set(user.certificates || []);
    const harbors = HARBORS.map(h => ({ ...h, owned: certs.has(h.id) }));
    const visited = harbors.filter(h => h.owned).length;
    const data = {
        name: user.nickname || '船員', avatar: avatar || '🙂', level,
        title: getCrewTitle(level), harbors, visited,
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
    picture.alt = `${data.name}的船員證，Lv.${data.level}，${data.title}，三港已到訪${visited}處，已收藏${data.badgeCount}枚徽章。`;

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
            status.textContent = '分享圖片包含船員名稱與探索成果。可分享給朋友，或下載留念。';
        } catch {
            if (!closed) status.textContent = '船員證圖片製作失敗，請關閉後重新開啟。';
        }
    })();
}

