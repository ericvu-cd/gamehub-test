// =====================================================
// Firebase 初始化
// 請至 Firebase 主控台 > 專案設定 > 一般 > 你的應用程式
// 複製你自己的設定值貼到下面。這組設定屬於「公開用戶端設定」，
// 本來就會出現在瀏覽器原始碼／GitHub 上，這是 Firebase 的正常設計，
// 不算洩漏機密。真正的資料保護來自 firestore.rules，不是靠隱藏這組設定值。
// =====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyCkVoePkK_0_yJsDcA_slQVlvZ9KjwxIgU",
    authDomain: "gamehub-test-cf42d.firebaseapp.com",
    projectId: "gamehub-test-cf42d",
    storageBucket: "gamehub-test-cf42d.firebasestorage.app",
    messagingSenderId: "544673054706",
    appId: "1:544673054706:web:2500b09a6b4298d981f56b",
    measurementId: "G-402NNKFPZ8"
  };

// 使用者以「自訂名稱＋密碼」註冊登入時，Firebase Authentication 內部需要一組
// Email 格式的帳號，這裡用固定的虛擬網域組合出一個內部專用 Email，
// 使用者完全看不到、也不是真實信箱，純粹是技術上讓 Firebase 運作所需。
export const INTERNAL_EMAIL_DOMAIN = "users.local-culture-platform.internal";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
