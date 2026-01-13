import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function qs(id) { return document.getElementById(id); }
function escapeHtml(str) {
  return (str ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

const ui = {
  modeBadge: qs("modeBadge"),
  btnCopyShare: qs("btnCopyShare"),
  cardInfo: qs("cardInfo"),
  pointText: qs("pointText"),
  stampGrid: qs("stampGrid"),

  btnAddPoint: qs("btnAddPoint"),
  btnMinusPoint: qs("btnMinusPoint"),
  btnReset: qs("btnReset"),

  rewardName: qs("rewardName"),
  rewardCost: qs("rewardCost"),
  rewardNote: qs("rewardNote"),
  btnAddReward: qs("btnAddReward"),
  rewardList: qs("rewardList"),
};

function getCardIdFromUrl() {
  const p = new URLSearchParams(location.search);
  return p.get("card");
}

function setCardIdToUrl(cardId) {
  const url = new URL(location.href);
  url.searchParams.set("card", cardId);
  history.replaceState({}, "", url.toString());
}

function randomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now();
}

function renderStamps(points) {
  const maxStamps = 50;

  // ✅ 先用預設章圖（下一步會改成可由 Owner 在網站設定並同步）
  const defaultStampImgUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Red_stamp.svg/512px-Red_stamp.svg.png";

  ui.stampGrid.innerHTML = "";
  for (let i = 1; i <= maxStamps; i++) {
    const div = document.createElement("div");
    const done = i <= points;
    div.className = "stamp" + (done ? " done" : "");
    div.title = done ? `已集到第 ${i} 點` : `第 ${i} 點`;

    // 把章圖網址塞進 CSS 變數
    if (done) {
      div.style.setProperty("--stamp-img", `url("${defaultStampImgUrl}")`);
    }

    ui.stampGrid.appendChild(div);
  }
}

function setReadonly(readonly) {
  const lock = (el, ro) => {
    if (!el) return;
    if (el.tagName === "BUTTON") el.disabled = ro;
    else el.disabled = ro;
  };

  lock(ui.btnAddPoint, readonly);
  lock(ui.btnMinusPoint, readonly);
  lock(ui.btnReset, readonly);
  lock(ui.btnAddReward, readonly);

  ui.rewardName.disabled = readonly;
  ui.rewardCost.disabled = readonly;
  ui.rewardNote.disabled = readonly;

  // 兌換/刪除按鈕：渲染時再處理（下面 renderRewards 會控制）
}

function setModeBadge(isOwner) {
  ui.modeBadge.className = "badge " + (isOwner ? "text-bg-success" : "text-bg-secondary");
  ui.modeBadge.textContent = isOwner ? "可編輯（Owner）" : "只讀（Viewer）";
}

// ---------- 主流程 ----------
async function main() {
  // 等待 firebase init 完成（index.html 會把 db/auth 放在 window.firebaseApp）
  const waitFirebase = async () => {
    for (let i = 0; i < 80; i++) {
      if (window.firebaseApp?.db && window.firebaseApp?.auth?.currentUser) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error("Firebase 尚未初始化完成");
  };
  await waitFirebase();

  const { db, auth } = window.firebaseApp;
  const myUid = auth.currentUser.uid;

  // 取得 / 建立 cardId
  let cardId = getCardIdFromUrl();
  if (!cardId) {
    cardId = randomId();
    setCardIdToUrl(cardId);
  }

  ui.cardInfo.textContent = `Card ID：${cardId}`;

  const cardRef = doc(db, "cards", cardId);

  // 如果不存在：只有「第一次開的人」會建立（owner）
  const snap = await getDoc(cardRef);
  if (!snap.exists()) {
    await setDoc(cardRef, {
      ownerUid: myUid,
      points: 0,
      rewards: [],
      updatedAt: serverTimestamp(),
    });
  }

  // 即時監聽（同步）
  onSnapshot(cardRef, (s) => {
    if (!s.exists()) {
      ui.modeBadge.className = "badge text-bg-danger";
      ui.modeBadge.textContent = "找不到此卡片";
      setReadonly(true);
      ui.rewardList.innerHTML = `<div class="text-danger">此 cardId 不存在或已被刪除。</div>`;
      return;
    }

    const data = s.data();
    const isOwner = data.ownerUid === myUid;

    setModeBadge(isOwner);
    setReadonly(!isOwner);

    const points = Math.max(0, Number(data.points || 0));
    ui.pointText.textContent = points;
    renderStamps(points);

    renderRewards(data.rewards || [], isOwner, points);
  });

  // 分享只讀連結（就是 ?card=xxx）
  ui.btnCopyShare.addEventListener("click", async () => {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set("card", cardId);
    const shareLink = url.toString();

    try {
      await navigator.clipboard.writeText(shareLink);
      ui.btnCopyShare.textContent = "已複製！";
      setTimeout(() => (ui.btnCopyShare.textContent = "複製只讀分享連結"), 1200);
    } catch {
      prompt("複製這個連結分享（只讀）", shareLink);
    }
  });

  // 只有 owner 能按（Rules 也會擋）
  ui.btnAddPoint.addEventListener("click", async () => {
    await safeUpdate(cardRef, { pointsDelta: +1 });
  });

  ui.btnMinusPoint.addEventListener("click", async () => {
    await safeUpdate(cardRef, { pointsDelta: -1 });
  });

  ui.btnReset.addEventListener("click", async () => {
    if (!confirm("確定要重置點數與兌獎清單嗎？")) return;
    await updateDoc(cardRef, { points: 0, rewards: [], updatedAt: serverTimestamp() });
  });

  ui.btnAddReward.addEventListener("click", async () => {
    const name = ui.rewardName.value.trim();
    const cost = Number(ui.rewardCost.value.trim());
    const note = ui.rewardNote.value.trim();

    if (!name) return alert("請輸入獎項名稱。");
    if (!Number.isFinite(cost) || cost <= 0) return alert("需要點數請輸入正整數。");

    // 先讀目前資料再更新（簡單做法：用 getDoc）
    const cur = await getDoc(cardRef);
    const data = cur.data();
    const rewards = Array.isArray(data.rewards) ? data.rewards : [];

    rewards.unshift({
      id: randomId(),
      name,
      cost: Math.floor(cost),
      note,
      createdAt: Date.now()
    });

    await updateDoc(cardRef, { rewards, updatedAt: serverTimestamp() });

    ui.rewardName.value = "";
    ui.rewardCost.value = "";
    ui.rewardNote.value = "";
  });

  // 清單按鈕（兌換/刪除）
  ui.rewardList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const action = btn.dataset.action;
    const rid = btn.dataset.id;
    if (!action || !rid) return;

    const cur = await getDoc(cardRef);
    const data = cur.data();
    const rewards = Array.isArray(data.rewards) ? data.rewards : [];
    const points = Math.max(0, Number(data.points || 0));
    const item = rewards.find(r => r.id === rid);
    if (!item) return;

    if (action === "delete") {
      if (!confirm(`確定刪除「${item.name}」？`)) return;
      const next = rewards.filter(r => r.id !== rid);
      await updateDoc(cardRef, { rewards: next, updatedAt: serverTimestamp() });
      return;
    }

    if (action === "redeem") {
      if (points < item.cost) return alert(`點數不足（目前 ${points} 點，需 ${item.cost} 點）。`);
      if (!confirm(`確定兌換「${item.name}」並扣 ${item.cost} 點？`)) return;

      const nextPoints = points - item.cost;
      await updateDoc(cardRef, { points: nextPoints, updatedAt: serverTimestamp() });
      return;
    }
  });

  async function safeUpdate(ref, { pointsDelta }) {
    const cur = await getDoc(ref);
    const data = cur.data();
    const points = Math.max(0, Number(data.points || 0));
    const next = Math.max(0, points + pointsDelta);
    await updateDoc(ref, { points: next, updatedAt: serverTimestamp() });
  }

  function renderRewards(rewards, isOwner, points) {
    ui.rewardList.innerHTML = "";

    if (!rewards.length) {
      ui.rewardList.innerHTML = `<div class="text-secondary tiny">目前沒有兌獎項目，請按「新增項目」。</div>`;
      return;
    }

    rewards.forEach(r => {
      const wrap = document.createElement("div");
      wrap.className = "reward-row p-3";

      const noteBadge = r.note ? `<span class="badge text-bg-light text-dark border">${escapeHtml(r.note)}</span>` : "";
      const disabledAttr = isOwner ? "" : "disabled";

      wrap.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="d-flex flex-wrap align-items-center gap-2">
              <div class="fw-bold">${escapeHtml(r.name)}</div>
              <span class="badge text-bg-secondary">需 ${Number(r.cost)} 點</span>
              ${noteBadge}
            </div>
            <div class="tiny mt-1">目前點數：${points}</div>
          </div>
          <div class="d-flex flex-column gap-2">
            <button class="btn btn-sm btn-primary" data-action="redeem" data-id="${r.id}" ${disabledAttr}>兌換</button>
            <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${r.id}" ${disabledAttr}>刪除</button>
          </div>
        </div>
      `;
      ui.rewardList.appendChild(wrap);
    });
  }
}

main().catch((e) => {
  console.error(e);
  const badge = document.getElementById("modeBadge");
  badge.className = "badge text-bg-danger";
  badge.textContent = "啟動失敗";
  alert("啟動失敗：請打開 F12 Console 看錯誤訊息（常見是 firebaseConfig 沒貼對或 Rules 沒 Publish）。");
});

