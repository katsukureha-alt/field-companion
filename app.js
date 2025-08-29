/* ===== 現地フィールド相棒 v3.1 - app.js (AC対応) =====
 * A: 訪問日時の自動記録 & 一覧表示/並び替え/検索
 * C: ローカルバックアップ（JSONエクスポート/インポート）
 * B: 逆ジオコーディングは設定画面のAPIキーを使用（実装済）
 * 依存: index.html のID構成（v3.1想定）
 */

// ---------- ユーティリティ ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const fmtDateTime = (d=new Date())=>{
  const pad = (n)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 画像をリサイズ（長辺1600px、JPEG品質0.8）
async function resizeImages(files) {
  const maxLen = 1600;
  const out = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const img = await new Promise((res)=>{
      const i = new Image();
      i.onload = ()=>res(i);
      i.src = URL.createObjectURL(file);
    });
    const scale = Math.min(1, maxLen / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = cvs.toDataURL('image/jpeg', 0.8);
    out.push(dataUrl);
    URL.revokeObjectURL(img.src);
  }
  return out.slice(0,5);
}

// ---------- IndexedDB ----------
const DB_NAME = 'field-companion-db';
const DB_VER = 3;
const STORE = 'entries';

let db;
function openDB() {
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
        os.createIndex('createdAt','createdAt');
        os.createIndex('visited','visited');
      } else {
        const os = e.target.transaction.objectStore(STORE);
        if (!os.indexNames.contains('createdAt')) os.createIndex('createdAt','createdAt');
        if (!os.indexNames.contains('visited')) os.createIndex('visited','visited');
      }
    };
    req.onsuccess = ()=>{ db=req.result; resolve(); };
    req.onerror = ()=>reject(req.error);
  });
}

function addEntry(entry){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}

function getAll(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = ()=>resolve(req.result||[]);
    req.onerror = ()=>reject(req.error);
  });
}

function clearAll(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}

// ---------- 設定（APIキー） ----------
const SETTINGS_KEY = 'fc_settings';
function loadSettings(){
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'); }
  catch { return {}; }
}
function saveSettings(obj){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj||{}));
}

// ---------- 位置情報 & 逆ジオ ----------
let currentPos = null; // {lat,lng,accuracy}

async function getLocation(){
  return new Promise((resolve,reject)=>{
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      (p)=>{
        const lat = +p.coords.latitude.toFixed(6);
        const lng = +p.coords.longitude.toFixed(6);
        resolve({lat,lng,accuracy: Math.round(p.coords.accuracy||0)});
      },
      (err)=>reject(err),
      { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
    );
  });
}

async function reverseGeocode(lat,lng){
  const { apiKey } = loadSettings();
  if (!apiKey) throw new Error('設定にGoogle Maps Geocoding APIキーが未保存です。');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK') {
    const m = json.error_message || json.status;
    throw new Error(`住所取得エラー: ${m}`);
  }
  return json.results[0]?.formatted_address || '';
}

// ---------- 外部リンク（路線価 / 用途地域） ----------
function openRosenka(lat,lng){
  // 国税庁 路線価図（地図モード&座標フォーカスはブラウザ標準の検索）簡易遷移
  const q = `${lat},${lng}`;
  window.open(`https://www.rosenka.nta.go.jp/`, '_blank');
  // ユーザーが地図内検索で座標貼付→移動（スマホ運用で実用的）
}

function openYoto(lat,lng){
  // 国土数値情報ダウンローダや自治体GISが多様なため、用途地域ポータル（Plat-E）へ誘導
  window.open(`https://www.mlit.go.jp/plateau/`, '_blank');
}

// ---------- 一覧描画 ----------
function renderList(items, {q='', sort='new'}={}){
  const list = $('#list');
  if (!list) return; // 一覧タブでのみ存在
  q = (q||'').trim();
  let data = [...items];
  if (q) {
    const kw = q.toLowerCase();
    data = data.filter(e=>{
      return (e.addr||'').toLowerCase().includes(kw)
          || (e.memo||'').toLowerCase().includes(kw)
          || (e.tags||'').toLowerCase().includes(kw);
    });
  }
  data.sort((a,b)=>{
    if (sort==='old') return (a.createdAt||0) - (b.createdAt||0);
    if (sort==='visited') return (b.visited|0) - (a.visited|0);
    return (b.createdAt||0) - (a.createdAt||0);
  });

  list.innerHTML = data.map(e=>{
    const dt = fmtDateTime(new Date(e.createdAt||Date.now()));
    const badge = e.visited ? '<span class="badge visited">訪問済</span>' : '';
    const imgs = (e.photos||[]).slice(0,1).map(u=>`<img src="${u}" alt="" class="thumb">`).join('');
    return `
      <li class="entry">
        <div class="row">
          <div class="left">${imgs || '<div class="thumb placeholder"></div>'}</div>
          <div class="right">
            <div class="line"><strong>${e.addr||'(住所未取得)'}</strong> ${badge}</div>
            <div class="line">${dt} ・ ${e.lat?.toFixed?.(6)||''}, ${e.lng?.toFixed?.(6)||''}</div>
            <div class="line memo">${(e.memo||'').replace(/</g,'&lt;')}</div>
            <div class="line tags">${e.tags?`#${e.tags.replace(/\s+/g,' #')}`:''}</div>
          </div>
        </div>
      </li>`;
  }).join('') || `<li class="empty">データがありません</li>`;
}

// ---------- バックアップ（エクスポート/インポート） ----------
async function exportJSON(){
  const data = await getAll();
  const blob = new Blob([JSON.stringify({version:1,data}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `field-companion-backup-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJSON(file){
  const text = await file.text();
  const json = JSON.parse(text);
  if (!json || !Array.isArray(json.data)) throw new Error('不正なバックアップ形式です。');
  // 既存は温存、インポート分を追記
  for (const e of json.data) {
    // id を消して新規採番
    const {id, ...rest} = e;
    await addEntry(rest);
  }
}

// ---------- 画面イベント ----------
async function init(){
  await openDB();

  // タブ/存在チェック（同一app.jsを全画面で使う前提）
  const elMemo = $('#memo');
  const elTags = $('#tags');
  const elVisited = $('#visited');
  const elLatLng = $('#latlng');
  const elAddr = $('#addr');

  // --- 記録タブ ---
  if (elMemo && $('#btn-save')) {
    // 位置情報
    $('#btn-geo')?.addEventListener('click', async ()=>{
      try {
        const pos = await getLocation();
        currentPos = pos;
        elLatLng.textContent = `緯度:${pos.lat} 経度:${pos.lng} 精度±${pos.accuracy}m`;
      } catch (e) {
        alert('位置情報を取得できませんでした: ' + e.message);
      }
    });

    // 住所に変換
    $('#btn-revgeo')?.addEventListener('click', async ()=>{
      try {
        if (!currentPos) {
          // 直近の表示テキストから拾える場合あり
          const m = elLatLng.textContent.match(/緯度:([0-9\.\-]+)\s+経度:([0-9\.\-]+)/);
          if (m) currentPos = {lat:+m[1], lng:+m[2], accuracy:0};
        }
        if (!currentPos) throw new Error('先に「位置情報を取得」を実行してください。');
        const addr = await reverseGeocode(currentPos.lat, currentPos.lng);
        elAddr.textContent = `住所: ${addr}`;
      } catch (e) {
        alert(e.message);
      }
    });

    // 路線価 / 用途地域
    $('#btn-rosenka')?.addEventListener('click', ()=>{
      if (!currentPos) return alert('先に位置情報を取得してください。');
      openRosenka(currentPos.lat, currentPos.lng);
    });
    $('#btn-yoto')?.addEventListener('click', ()=>{
      if (!currentPos) return alert('先に位置情報を取得してください。');
      openYoto(currentPos.lat, currentPos.lng);
    });

    // 保存
    $('#btn-save')?.addEventListener('click', async ()=>{
      try {
        // 画像
        const files = $('#file-input')?.files || [];
        const photos = await resizeImages(files);

        // 緯度経度（テキストからも拾う保険）
        let lat, lng, accuracy;
        if (currentPos) ({lat,lng,accuracy} = currentPos);
        if (lat==null || lng==null) {
          const m = elLatLng.textContent.match(/緯度:([0-9\.\-]+)\s+経度:([0-9\.\-]+)/);
          if (m) { lat = +m[1]; lng = +m[2]; }
        }

        const addrTxt = elAddr.textContent.replace(/^住所:\s*/,'').trim() || '';
        const entry = {
          createdAt: Date.now(),              // ★ 訪問日時（自動）
          memo: elMemo.value.trim(),
          tags: elTags.value.trim(),
          visited: !!elVisited.checked,
          lat, lng, accuracy,
          addr: addrTxt,
          photos
        };
        await addEntry(entry);

        // フォームリセット
        elMemo.value = '';
        elTags.value = '';
        elVisited.checked = false;
        if ($('#file-input')) $('#file-input').value = '';
        currentPos = null;
        elLatLng.textContent = '未取得';
        elAddr.textContent = '';
        alert('保存しました。');
      } catch (e) {
        alert('保存に失敗しました: ' + e.message);
      }
    });
  }

  // --- 一覧タブ ---
  if ($('#list')) {
    const refresh = async ()=>{
      const all = await getAll();
      renderList(all, {
        q: $('#q')?.value || '',
        sort: $('#sort')?.value || 'new'
      });
    };
    $('#q')?.addEventListener('input', refresh);
    $('#sort')?.addEventListener('change', refresh);
    await refresh();

    // バックアップ（エクスポート/インポート）
    $('#btn-export')?.addEventListener('click', exportJSON);
    $('#btn-import')?.addEventListener('change', async (e)=>{
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importJSON(file);
        alert('インポート完了');
        await refresh();
      } catch (err) {
        alert('インポート失敗: ' + err.message);
      } finally {
        e.target.value = '';
      }
    });
    $('#btn-clear')?.addEventListener('click', async ()=>{
      if (!confirm('ローカルの全データを削除します。よろしいですか？')) return;
      await clearAll();
      await refresh();
    });
  }

  // --- 設定タブ ---
  if ($('#settings-api-key')) {
    const st = loadSettings();
    $('#settings-api-key').value = st.apiKey || '';
    $('#btn-save-key')?.addEventListener('click', ()=>{
      const apiKey = $('#settings-api-key').value.trim();
      saveSettings({apiKey});
      alert('APIキーを保存しました。');
    });
    $('#btn-wipe-local')?.addEventListener('click', async ()=>{
      if (!confirm('ローカル保存データ（一覧）をすべて削除します。よろしいですか？')) return;
      await clearAll();
      alert('削除しました。');
    });
  }
}
