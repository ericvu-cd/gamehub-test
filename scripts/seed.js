// =====================================================================
// 一次性資料初始化腳本
//
// 使用方式：
//   1. Firebase 主控台 > 專案設定 > 服務帳戶 > 產生新的私密金鑰，
//      下載 json 檔案，存成本機的 serviceAccountKey.json（不要提交到 GitHub！）
//   2. npm install
//   3. node scripts/seed.js
//
// 這支腳本用 firebase-admin（不是 Cloud Functions），只在你自己的電腦
// 執行一次，完全免費、不需要 Blaze 方案。
// =====================================================================
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
    console.error('❌ 找不到 serviceAccountKey.json，請先依照本檔案開頭的說明下載金鑰檔');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();

async function seed() {
    console.log('🌱 開始寫入初始資料...');

    await db.collection('avatarPresets').doc('cat').set({ name: '貓', emoji: '🐱', glowColor: '#F0997B' });
    await db.collection('avatarPresets').doc('dog').set({ name: '狗', emoji: '🐶', glowColor: '#EF9F27' });
    await db.collection('avatarPresets').doc('rabbit').set({ name: '兔子', emoji: '🐰', glowColor: '#B980F0' });
    await db.collection('avatarPresets').doc('fox').set({ name: '狐狸', emoji: '🦊', glowColor: '#F4735A' });
    await db.collection('avatarPresets').doc('owl').set({ name: '貓頭鷹', emoji: '🦉', glowColor: '#5DCAA5' });
    await db.collection('avatarPresets').doc('panda').set({ name: '熊貓', emoji: '🐼', glowColor: '#6E93D9' });

    await db.collection('badges').doc('b1').set({
        name: '職人認證', description: '完成手作工藝體驗坊授予', iconUrl: null, sourceTaskId: 'g3'
    });
    await db.collection('badges').doc('b2').set({
        name: '老街達人', description: '完成老街早市尋寶授予', iconUrl: null, sourceTaskId: 'g1'
    });

    await db.collection('certificates').doc('c1').set({
        name: '2026 老街導覽初階證明', description: '完成廟埕故事所授予', iconUrl: null, sourceTaskId: 'g2'
    });

    const tasks = [
        { id: 'g1', title: '老街早市尋寶', description: '走訪早市攤商，認識在地小吃與人情味',
          colorTheme: 'mint', link: 'tasks/sample-task.html', entryCost: 0, dailyRewardCap: 40,
          unlockConditions: [], sortOrder: 1 },
        { id: 'g2', title: '廟埕故事所', description: '聆聽耆老口述，解鎖廟埕傳說',
          colorTheme: 'peach', link: 'tasks/sample-task.html', entryCost: 0, dailyRewardCap: 40,
          unlockConditions: [{ type: 'LEVEL', value: 1 }], sortOrder: 2 },
        { id: 'g3', title: '手作工藝體驗坊', description: '集滿通行金幣，兌換職人手作課程',
          colorTheme: 'gold', link: 'tasks/sample-task.html', entryCost: 50, dailyRewardCap: 60,
          unlockConditions: [{ type: 'COIN', value: 100 }], sortOrder: 3 },
        { id: 'g4', title: '職人挑戰賽', description: '需持有【職人認證】徽章方可報名',
          colorTheme: 'sky', link: 'tasks/sample-task.html', entryCost: 0, dailyRewardCap: 80,
          unlockConditions: [{ type: 'BADGE', value: ['b1'] }], sortOrder: 4 },
        { id: 'g5', title: '冬至湯圓祭', description: '限定節氣開放，錯過等一年',
          colorTheme: 'lilac', link: 'tasks/sample-task.html', entryCost: 0, dailyRewardCap: 100,
          unlockConditions: [{ type: 'DATE', startDate: Date.UTC(2026, 11, 15), endDate: Date.UTC(2026, 11, 25) }],
          sortOrder: 5 }
    ];
    for (const t of tasks) {
        const { id, ...data } = t;
        await db.collection('tasks').doc(id).set({ ...data, imageUrl: null, isActive: true });
    }

    await db.collection('banners').add({
        title: '巷弄尋寶季開跑', subtitle: '累積通行金幣，兌換限量職人手作課程！',
        imageUrl: null, sortOrder: 1, startAt: null, endAt: null, isActive: true
    });

    const newsItems = [
        { title: '平台正式上線', content: '歡迎加入探索隊，完成任務即可累積通行金幣。' },
        { title: '手作工藝體驗坊即將開放', content: '請提前存滿 100 通行金幣，準備好報名！' },
        { title: '職人挑戰賽開放報名倒數', content: '尚未取得【職人認證】的隊員請把握機會。' }
    ];
    for (const n of newsItems) {
        await db.collection('news').add({ ...n, publishedAt: Date.now(), startAt: null, endAt: null });
    }

    console.log('✅ 初始資料寫入完成！');
    console.log('');
    console.log('接下來別忘了：把你自己的 Google 帳號 uid 加進 Firestore 的 admins 集合，');
    console.log('才能登入管理後台。可以先登入一次管理後台（會顯示「不在白名單」的畫面），');
    console.log('從 Firebase 主控台 Authentication 分頁找到你的 uid，手動到 Firestore');
    console.log('建立 admins/{你的uid} 這份文件（內容可以是空物件 {}）。');

    process.exit(0);
}

seed().catch(err => {
    console.error('❌ 寫入失敗：', err);
    process.exit(1);
});
