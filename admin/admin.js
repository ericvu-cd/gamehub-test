// =====================================================
// 管理後台程式邏輯
// =====================================================
import { auth, db } from '../js/firebase-config.js';
import {
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isAdmin = false;

window.handleGoogleLogin = async function () {
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
        document.getElementById('login-error').innerText = err.message;
    }
};

window.handleLogout = async function () {
    await signOut(auth);
};

function dateToMs(dateStr) {
    return dateStr ? new Date(dateStr + 'T00:00:00').getTime() : null;
}

function showMsg(panelKey, text, isError = false) {
    const el = document.getElementById(`${panelKey}-msg`);
    el.innerHTML = `<div class="msg ${isError ? 'err' : 'ok'}">${text}</div>`;
    setTimeout(() => { el.innerHTML = ''; }, 4000);
}

/* ---------------- 分頁切換 ---------------- */
window.switchAdminTab = function (tabName) {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('section.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));
};

/* ---------------- Banner ---------------- */
async function loadBannersTable() {
    const snap = await getDocs(collection(db, 'banners'));
    const tbody = document.querySelector('#banners-table tbody');
    tbody.innerHTML = snap.docs.map(d => {
        const b = d.data();
        const range = [b.startAt ? new Date(b.startAt).toLocaleDateString() : '—',
                        b.endAt ? new Date(b.endAt).toLocaleDateString() : '—'].join(' ~ ');
        return `<tr>
            <td>${b.title}</td><td>${range}</td>
            <td>${b.isActive === false ? '下架' : '上架中'}</td>
            <td>
                <button class="danger-btn" onclick="window.toggleBannerActive('${d.id}', ${b.isActive === false})">${b.isActive === false ? '上架' : '下架'}</button>
                <button class="danger-btn" onclick="window.deleteItem('banners','${d.id}','banners')">刪除</button>
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="4">尚無資料</td></tr>`;
}

window.toggleBannerActive = async function (id, setActive) {
    await updateDoc(doc(db, 'banners', id), { isActive: setActive });
    loadBannersTable();
};

window.onBannerActionTypeChange = function (selectEl) {
    const type = selectEl.value;
    const form = selectEl.closest('form');
    form.querySelector('[data-action-field="URL"]').classList.toggle('hidden', type !== 'URL');
    form.querySelector('[data-action-field="TASK"]').classList.toggle('hidden', type !== 'TASK');
};

window.submitBanner = async function (e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const actionType = f.get('actionType') || 'NONE';
    const actionValue = actionType === 'URL' ? f.get('actionValueUrl')
        : actionType === 'TASK' ? f.get('actionValueTask') : null;
    try {
        await addDoc(collection(db, 'banners'), {
            title: f.get('title'), subtitle: f.get('subtitle') || '',
            imageUrl: f.get('imageUrl') || null,
            sortOrder: Number(f.get('sortOrder')) || 0,
            startAt: dateToMs(f.get('startAt')), endAt: dateToMs(f.get('endAt')),
            actionType, actionValue,
            isActive: true
        });
        e.target.reset();
        showMsg('banners', '新增成功');
        loadBannersTable();
    } catch (err) { showMsg('banners', err.message, true); }
    return false;
};

/* ---------------- 任務 ---------------- */
async function loadTasksTable() {
    const snap = await getDocs(collection(db, 'tasks'));
    const tbody = document.querySelector('#tasks-table tbody');
    tbody.innerHTML = snap.docs.map(d => {
        const t = d.data();
        return `<tr>
            <td>${d.id}</td><td>${t.title}</td>
            <td>扣 ${t.entryCost || 0} / 上限 ${t.dailyRewardCap || 0}</td>
            <td>${t.isActive === false ? '下架' : '上架中'}</td>
            <td>
                <button class="danger-btn" onclick="window.toggleTaskActive('${d.id}', ${t.isActive === false})">${t.isActive === false ? '上架' : '下架'}</button>
                <button class="danger-btn" onclick="window.deleteItem('tasks','${d.id}','tasks')">刪除</button>
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="5">尚無資料</td></tr>`;
}

window.toggleTaskActive = async function (id, setActive) {
    await updateDoc(doc(db, 'tasks', id), { isActive: setActive });
    loadTasksTable();
};

window.submitTask = async function (e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const conditions = [];
    if (f.get('unlockLevel')) conditions.push({ type: 'LEVEL', value: Number(f.get('unlockLevel')) });
    if (f.get('unlockCoin')) conditions.push({ type: 'COIN', value: Number(f.get('unlockCoin')) });
    if (f.get('unlockBadges')) conditions.push({ type: 'BADGE', value: f.get('unlockBadges').split(',').map(s => s.trim()).filter(Boolean) });
    if (f.get('unlockCerts')) conditions.push({ type: 'CERTIFICATE', value: f.get('unlockCerts').split(',').map(s => s.trim()).filter(Boolean) });
    if (f.get('unlockStart') || f.get('unlockEnd')) {
        conditions.push({ type: 'DATE', startDate: dateToMs(f.get('unlockStart')) || 0, endDate: dateToMs(f.get('unlockEnd')) || 9999999999999 });
    }

    try {
        await setDoc(doc(db, 'tasks', f.get('id')), {
            title: f.get('title'), description: f.get('description') || '',
            colorTheme: f.get('colorTheme'),
            link: f.get('link'),
            entryCost: Number(f.get('entryCost')) || 0,
            dailyRewardCap: Number(f.get('dailyRewardCap')) || 0,
            unlockConditions: conditions,
            sortOrder: Number(f.get('sortOrder')) || 0,
            isActive: true
        });
        e.target.reset();
        showMsg('tasks', '新增成功');
        loadTasksTable();
    } catch (err) { showMsg('tasks', err.message, true); }
    return false;
};

/* ---------------- 公告 ---------------- */
async function loadNewsTable() {
    const snap = await getDocs(collection(db, 'news'));
    const tbody = document.querySelector('#news-table tbody');
    tbody.innerHTML = snap.docs.map(d => {
        const n = d.data();
        const range = [n.startAt ? new Date(n.startAt).toLocaleDateString() : '—',
                        n.endAt ? new Date(n.endAt).toLocaleDateString() : '—'].join(' ~ ');
        return `<tr><td>${n.title}</td><td>${range}</td>
            <td><button class="danger-btn" onclick="window.deleteItem('news','${d.id}','news')">刪除</button></td></tr>`;
    }).join('') || `<tr><td colspan="3">尚無資料</td></tr>`;
}

window.submitNews = async function (e) {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
        await addDoc(collection(db, 'news'), {
            title: f.get('title'), content: f.get('content') || '',
            startAt: dateToMs(f.get('startAt')), endAt: dateToMs(f.get('endAt')),
            publishedAt: Date.now()
        });
        e.target.reset();
        showMsg('news', '新增成功');
        loadNewsTable();
    } catch (err) { showMsg('news', err.message, true); }
    return false;
};

/* ---------------- 徽章 / 證書 ---------------- */
async function loadDictTable(coll, tableSel) {
    const snap = await getDocs(collection(db, coll));
    const tbody = document.querySelector(`${tableSel} tbody`);
    tbody.innerHTML = snap.docs.map(d => {
        const b = d.data();
        return `<tr><td>${d.id}</td><td>${b.name}</td><td>${b.sourceTaskId}</td>
            <td><button class="danger-btn" onclick="window.deleteItem('${coll}','${d.id}','${coll}')">刪除</button></td></tr>`;
    }).join('') || `<tr><td colspan="4">尚無資料</td></tr>`;
}

window.submitBadge = async function (e) {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
        await setDoc(doc(db, 'badges', f.get('id')), {
            name: f.get('name'), description: f.get('description') || '',
            iconUrl: f.get('iconUrl') || null, sourceTaskId: f.get('sourceTaskId')
        });
        e.target.reset();
        showMsg('badges', '新增成功');
        loadDictTable('badges', '#badges-table');
    } catch (err) { showMsg('badges', err.message, true); }
    return false;
};

window.submitCertificate = async function (e) {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
        await setDoc(doc(db, 'certificates', f.get('id')), {
            name: f.get('name'), description: f.get('description') || '',
            iconUrl: f.get('iconUrl') || null, sourceTaskId: f.get('sourceTaskId')
        });
        e.target.reset();
        showMsg('certificates', '新增成功');
        loadDictTable('certificates', '#certificates-table');
    } catch (err) { showMsg('certificates', err.message, true); }
    return false;
};

/* ---------------- 通用刪除 ---------------- */
window.deleteItem = async function (coll, id, panelKey) {
    if (!confirm('確定要刪除嗎？')) return;
    await deleteDoc(doc(db, coll, id));
    if (panelKey === 'banners') loadBannersTable();
    if (panelKey === 'tasks') loadTasksTable();
    if (panelKey === 'news') loadNewsTable();
    if (panelKey === 'badges') loadDictTable('badges', '#badges-table');
    if (panelKey === 'certificates') loadDictTable('certificates', '#certificates-table');
};

/* ---------------- 使用者資料編修 ---------------- */
window.searchUser = async function (e) {
    e.preventDefault();
    const username = document.getElementById('user-search-input').value.trim().toLowerCase();
    const area = document.getElementById('user-edit-area');
    area.innerHTML = '查詢中...';

    const unameSnap = await getDoc(doc(db, 'usernames', username));
    if (!unameSnap.exists()) { area.innerHTML = '<p>查無此使用者</p>'; return false; }
    const uid = unameSnap.data().uid;
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) { area.innerHTML = '<p>查無使用者資料</p>'; return false; }
    const u = userSnap.data();

    area.innerHTML = `
        <form class="inline-form" onsubmit="return window.submitUserEdit(event, '${uid}')">
            <div class="field"><label>暱稱</label><input name="nickname" value="${u.nickname || ''}"></div>
            <div class="field"><label>等級</label><input name="level" type="number" value="${u.level ?? 1}"></div>
            <div class="field"><label>通行金幣</label><input name="coins" type="number" value="${u.coins ?? 0}"></div>
            <div class="field"><label>徽章（逗號分隔ID）</label><input name="badges" value="${(u.badges || []).join(',')}"></div>
            <div class="field"><label>證書（逗號分隔ID）</label><input name="certificates" value="${(u.certificates || []).join(',')}"></div>
            <button class="submit-btn" type="submit">儲存變更</button>
        </form>`;
    return false;
};

window.submitUserEdit = async function (e, uid) {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
        await updateDoc(doc(db, 'users', uid), {
            nickname: f.get('nickname'),
            level: Number(f.get('level')),
            coins: Number(f.get('coins')),
            badges: f.get('badges').split(',').map(s => s.trim()).filter(Boolean),
            certificates: f.get('certificates').split(',').map(s => s.trim()).filter(Boolean)
        });
        showMsg('users', '已儲存');
    } catch (err) { showMsg('users', err.message, true); }
    return false;
};

/* ---------------- 初始化 ---------------- */
onAuthStateChanged(auth, async (user) => {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('not-admin-screen').style.display = 'none';
    document.getElementById('app-header').style.display = 'none';
    document.getElementById('app-main').style.display = 'none';

    if (!user) {
        document.getElementById('login-screen').style.display = 'flex';
        return;
    }

    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    isAdmin = adminSnap.exists();

    if (!isAdmin) {
        document.getElementById('not-admin-screen').style.display = 'block';
        return;
    }

    document.getElementById('app-header').style.display = 'flex';
    document.getElementById('app-main').style.display = 'block';
    loadBannersTable();
    loadTasksTable();
    loadNewsTable();
    loadDictTable('badges', '#badges-table');
    loadDictTable('certificates', '#certificates-table');
});
