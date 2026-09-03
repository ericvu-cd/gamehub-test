// =====================================================
// 會員系統：自訂名稱＋密碼（不收集 Email／個人資料）
// 對應功能規格書 6.1 節
// =====================================================
import { auth, db, INTERNAL_EMAIL_DOMAIN } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc, getDoc, setDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEFAULT_PROFILE = { level: 1, coins: 0, badges: [], certificates: [] };

const USERNAME_RULE = /^[A-Za-z0-9\u4e00-\u9fa5]{1,20}$/; // 中英文數字，最長20字

function usernameToEmail(username) {
    return `${username.toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function validateUsername(username) {
    if (!username) return '請輸入使用者名稱';
    if (!USERNAME_RULE.test(username)) return '名稱僅接受中文、英文、數字，最長 20 個字元';
    return null;
}

export function validatePassword(password) {
    if (!password) return '請輸入密碼';
    if (password.length < 6) return '密碼至少需要 6 個字元';
    if (password.length > 64) return '密碼最長 64 個字元';
    return null;
}

// 檢查名稱是否已被使用（即時檢查用，最終仍以註冊時的 Firestore 規則為準）
export async function isUsernameTaken(username) {
    const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
    return snap.exists();
}

// 隨機挑一個動物頭像 id（實際清單由 content.js 的 avatarPresets 決定，這裡先給預設值）
function pickDefaultAvatar(avatarPresetIds) {
    if (!avatarPresetIds || avatarPresetIds.length === 0) return null;
    return avatarPresetIds[Math.floor(Math.random() * avatarPresetIds.length)];
}

export async function registerUser(username, password, avatarPresetIds = []) {
    const usernameErr = validateUsername(username);
    if (usernameErr) throw new Error(usernameErr);

    const usernameLower = username.toLowerCase();
    if (await isUsernameTaken(usernameLower)) {
        throw new Error('此名稱已被使用，請換一個');
    }

    const email = usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // 建立 usernames 保留紀錄 + users 個人資料。
    // usernames/{username} 的安全規則只允許「create」、不允許覆寫，
    // 天然達成唯一性（兩人同時搶註冊，Firestore 只會讓一個 create 成功）。
    try {
        await setDoc(doc(db, 'usernames', usernameLower), { uid });
        await setDoc(doc(db, 'users', uid), {
            nickname: username,
            avatarId: pickDefaultAvatar(avatarPresetIds),
            ...DEFAULT_PROFILE
        });
    } catch (err) {
        // 名稱保留失敗（例如race condition下被搶先註冊），盡量清理，但 Auth 帳號無法在用戶端自行刪除，
        // 提示使用者這組帳密已建立但名稱重複，請聯繫管理者或改用別的名稱重新嘗試。
        throw new Error('註冊過程發生問題（可能名稱剛好被搶註），請換一個名稱再試一次');
    }

    return uid;
}

export async function loginUser(username, password) {
    const email = usernameToEmail(username);
    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        return cred.user;
    } catch (err) {
        throw new Error('帳號或密碼錯誤');
    }
}

export async function logoutUser() {
    await signOut(auth);
}

// 修改密碼：需先用目前密碼重新驗證身分，才能改成新密碼（Firebase 安全機制要求）
export async function changePassword(username, currentPassword, newPassword) {
    const user = auth.currentUser;
    if (!user) throw new Error('請先登入');
    const email = usernameToEmail(username);
    const credential = EmailAuthProvider.credential(email, currentPassword);
    try {
        await reauthenticateWithCredential(user, credential);
    } catch (err) {
        throw new Error('原密碼不正確');
    }
    const passwordErr = validatePassword(newPassword);
    if (passwordErr) throw new Error(passwordErr);
    await updatePassword(user, newPassword);
}

async function ensureUserProfile(fbUser) {
    const ref = doc(db, 'users', fbUser.uid);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
}

export function watchAuthState(callback) {
    return onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) return callback(null);
        const profile = await ensureUserProfile(fbUser);
        if (!profile) return callback(null); // 理論上不會發生，防呆
        callback({ uid: fbUser.uid, ...profile });
    });
}
