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

  // Banner / Stamp 設定（Owner 在網站貼網址）
  bannerImg: qs("bannerImg"),
  bannerEmpty: qs("bannerEmpty"),
  bannerUrl: qs("bannerUrl"),
  btnSaveBanner: qs("btnSaveBanner"),

  stampUrl: qs("stampUrl"),
  btnSaveStamp: qs("btnSaveStamp"),
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

function renderStamps(points, stampImgUrl) {
  const maxStamps = 50;

  // 如果你還沒設定章圖片，就先用測試章圖（保證看得到）
  const fallback = "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Red_stamp.svg/512px-Red_stamp.svg.png";
  const finalUrl = (stampImgUrl || "").trim() || fallback;

  ui.stampGrid.innerHTML = "";
  for (let i = 1; i <= maxStamps; i++) {
    const div = document.createElement("div");
    const done = i <= points;
    div.className = "stamp" + (done ? " done" : "");
    div.title = done ? `已集到第 ${i} 點` : `第 ${i} 點`;

    if (done) {
      div.style.setProperty("--stamp-img", `url("${finalUrl}")`);
    }

    ui.stampGrid.appendChild(div);
  }
}

function renderBanner(bannerUrl) {
  const url = (bannerUrl || "").trim();
  if (url) {
    ui.bannerImg.src = url;
    ui.bannerImg.style.display = "";
    ui.bannerEmpty.style.display = "none";
  } else {
    ui.bannerImg.style.display = "none";
    ui.bannerEmpty.style.display = "";
  }
}

function setReadonly(readonly) {
  const lockBtn = (el) => { if (el) el.disabled = readonly; };
  const lockInput = (el) => { if (el) el.disabled = readonly; };

  lockBtn(ui.btnAddPoint);
  lockBtn(ui.btnMinusPoint);
  lockBtn(ui.btnReset);
  lockBtn(ui.btnAddReward);

  lockInput(ui.rewardName);
  lockInput(ui.rewardCost);
  lockInput(ui.rewardNote);

  // Owner 才能改 banner / stamp
  lockInput(ui.bannerUrl);
  lockBtn(ui.btnSaveBanner);
  lockInput(ui.stampUrl);
  lockBtn(ui.btnSaveStamp);
  // Viewer（只讀）看不到設定區
  const ownerOnly = document.getElementById("ownerOnly");
  if (ownerOnly) ownerOnly.style.display = readonly ? "none" : "block";
}

function setModeBadge(isOwner) {
  ui.modeBadge.className = "badge " + (isOwner ? "text-bg-success" : "text-bg-secondary");
  ui.modeBadge.textContent = isOwner ? "可編輯（Owner）" : "只讀（Viewer）";
}

async function main() {
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

  let cardId = getCardIdFromUrl();
  if (!cardId) {
    cardId = randomId();
    setCardIdToUrl(cardId);
  }
  ui.cardInfo.textContent = `Card ID：${cardId}`;

  const cardRef = doc(db, "cards", cardId);

  // 第一次建立卡片（Owner）
  const snap = await getDoc(cardRef);
  if (!snap.exists()) {
    await setDoc(cardRef, {
      ownerUid: myUid,
      points: 0,
      rewards: [],
      bannerUrl: "",
      stampImgUrl: "",
      updatedAt: serverTimestamp(),
    });
  }

  // 監聽同步
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

    // Banner / Stamp
    renderBanner(data.bannerUrl || "");
    if (ui.bannerUrl) ui.bannerUrl.value = (data.bannerUrl || "");
    if (ui.stampUrl) ui.stampUrl.value = (data.stampImgUrl || "");

    renderStamps(points, data.stampImgUrl || "");
    renderRewards(data.rewards || [], isOwner, points);
  });

  // 複製分享（Viewer 只讀：靠 Rules 擋寫入）
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

  // 點數
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

  // 設定 Banner
  ui.btnSaveBanner.addEventListener("click", async () => {
    const url = ui.bannerUrl.value.trim();
    if (url && !/^https?:\/\//i.test(url)) return alert("請貼上完整圖片網址（https:// 開頭）");
    await updateDoc(cardRef, { bannerUrl: url, updatedAt: serverTimestamp() });
  });

  // 設定 章圖片
  ui.btnSaveStamp.addEventListener("click", async () => {
    const url = ui.stampUrl.value.trim();
    if (url && !/^https?:\/\//i.test(url)) return alert("請貼上完整圖片網址（https:// 開頭）");
    await updateDoc(cardRef, { stampImgUrl: url, updatedAt: serverTimestamp() });
  });

  // 新增獎項
  ui.btnAddReward.addEventListener("click", async () => {
    const name = ui.rewardName.value.trim();
    const cost = Number(ui.rewardCost.value.trim());
    const note = ui.rewardNote.value.trim();

    if (!name) return alert("請輸入獎項名稱。");
    if (!Number.isFinite(cost) || cost <= 0) return alert("需要點數請輸入正整數。");

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

  // 兌換/刪除
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
