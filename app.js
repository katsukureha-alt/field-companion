const DB_NAME = 'field-companion-db-v3';
const STORE = 'entries';
let db;

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      const store = db.createObjectStore(STORE, {keyPath:'id', autoIncrement:true});
      store.createIndex('createdAt', 'createdAt', {unique:false});
      store.createIndex('memo', 'memo', {unique:false});
      store.createIndex('tags', 'tags', {unique:false});
      store.createIndex('visited', 'visited', {unique:false});
      store.createIndex('addr', 'addr', {unique:false});
    };
    req.onsuccess = ()=>{ db = req.result; resolve(db); };
    req.onerror = ()=>reject(req.error);
  });
}

function addEntry(entry){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(entry).onsuccess = (e)=> resolve(e.target.result);
    tx.onerror = ()=> reject(tx.error);
  });
}

function getAllEntries(){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

function deleteEntry(id){
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id).onsuccess = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

const tabs = {
  capture: document.getElementById('screen-capture'),
  list: document.getElementById('screen-list'),
  settings: document.getElementById('screen-settings')
};
document.getElementById('tab-capture').addEventListener('click', ()=>switchTab('capture'));
document.getElementById('tab-list').addEventListener('click', ()=>switchTab('list'));
document.getElementById('tab-settings').addEventListener('click', ()=>switchTab('settings'));
function switchTab(name){
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  Object.values(tabs).forEach(sec=>sec.classList.remove('active'));
  tabs[name].classList.add('active');
  if(name==='list'){ renderList(); }
}

const photoInput = document.getElementById('photoInput');
const preview = document.getElementById('photoPreview');
const memoEl = document.getElementById('memo');
const tagsEl = document.getElementById('tags');
const visitedEl = document.getElementById('visited');
const geoBtn = document.getElementById('getLocation');
const geoStatus = document.getElementById('geoStatus');
const addrStatus = document.getElementById('addrStatus');
const reverseBtn = document.getElementById('reverseGeocode');
const landLinks = document.getElementById('landLinks');
const saveBtn = document.getElementById('saveEntry');
const resetBtn = document.getElementById('resetForm');
const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const filterVisitedEl = document.getElementById('filterVisited');
const sortOrderEl = document.getElementById('sortOrder');

let latestCoords = null;
let latestAddress = '';

photoInput.addEventListener('change', async ()=>{
  preview.innerHTML='';
  const files = Array.from(photoInput.files || []).slice(0,5);
  for(const f of files){
    const url = URL.createObjectURL(f);
    const img = document.createElement('img');
    img.src = url;
    preview.appendChild(img);
  }
});

geoBtn.addEventListener('click', ()=>{
  geoStatus.textContent = '取得中…';
  if(!navigator.geolocation){
    geoStatus.textContent = 'この端末では位置情報が利用できません';
    return;
  }
  navigator.geolocation.getCurrentPosition((pos)=>{
    latestCoords = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      acc: pos.coords.accuracy
    };
    geoStatus.textContent = `緯度:${latestCoords.lat.toFixed(6)} 経度:${latestCoords.lng.toFixed(6)}  精度±${Math.round(latestCoords.acc)}m`;
    landLinks.style.display = 'flex';
  }, (err)=>{
    geoStatus.textContent = '取得失敗：位置情報の許可をご確認ください';
    console.error(err);
  }, {enableHighAccuracy:true, timeout:10000});
});

reverseBtn.addEventListener('click', async ()=>{
  if(!latestCoords){ addrStatus.textContent = '先に位置情報を取得してください'; return; }
  const key = (localStorage.getItem('gc_api_key')||'').trim();
  if(!key){ addrStatus.textContent = '設定でGoogle APIキーを保存してください'; return; }
  addrStatus.textContent = '住所取得中…';
  try{
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latestCoords.lat},${latestCoords.lng}&key=${encodeURIComponent(key)}&language=ja`;
    const res = await fetch(url);
    const data = await res.json();
    if(data.status==='OK' && data.results && data.results.length>0){
      latestAddress = data.results[0].formatted_address;
      addrStatus.textContent = '住所：' + latestAddress;
    }else{
      addrStatus.textContent = '住所を取得できませんでした';
    }
  }catch(e){
    console.error(e);
    addrStatus.textContent = '取得エラー：ネットワーク/キーをご確認ください';
  }
});

document.getElementById('openNTA')?.addEventListener('click', ()=>{
  if(!latestCoords) return alert('先に位置情報を取得してください');
  const url = `https://www.rosenka.nta.go.jp/?lat=${latestCoords.lat}&lon=${latestCoords.lng}`;
  window.open(url,'_blank');
});
document.getElementById('openZoning')?.addEventListener('click', ()=>{
  if(!latestCoords) return alert('先に位置情報を取得してください');
  const url = `https://maps.gsi.go.jp/?ll=${latestCoords.lat},${latestCoords.lng}&z=17&base=std&ls=Mlitchiiki_youto&disp=1`;
  window.open(url,'_blank');
});

saveBtn.addEventListener('click', async ()=>{
  const files = Array.from(photoInput.files || []).slice(0,5);
  if(files.length===0){
    alert('写真を1枚以上選択（撮影）してください');
    return;
  }
  const compressed = [];
  for(const f of files){
    const dataUrl = await compressImageToDataURL(f, 1600, 0.85);
    compressed.push(dataUrl);
  }
  const entry = {
    photos: compressed,
    memo: (memoEl.value||'').trim(),
    tags: (tagsEl.value||'').trim(),
    visited: !!visitedEl.checked,
    addr: latestAddress,
    coords: latestCoords,
    createdAt: Date.now()
  };
  await addEntry(entry);
  alert('保存しました');
  // reset
  photoInput.value = ''; preview.innerHTML='';
  memoEl.value = ''; tagsEl.value = ''; visitedEl.checked = false;
  latestCoords = null; latestAddress = '';
  geoStatus.textContent='未取得'; addrStatus.textContent=''; landLinks.style.display='none';
});

resetBtn.addEventListener('click', ()=>{
  photoInput.value=''; preview.innerHTML=''; memoEl.value=''; tagsEl.value=''; visitedEl.checked=false; latestCoords=null; latestAddress=''; geoStatus.textContent='未取得'; addrStatus.textContent=''; landLinks.style.display='none';
});

function compressImageToDataURL(file, maxSize=1600, quality=0.85){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      let {width, height} = img;
      const scale = Math.min(1, maxSize/Math.max(width,height));
      width = Math.round(width*scale);
      height = Math.round(height*scale);
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    const reader = new FileReader();
    reader.onload = ()=> img.src = reader.result;
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function renderList(){
  const q = (searchEl.value||'').trim().toLowerCase();
  const vfilter = filterVisitedEl.value;
  const order = sortOrderEl ? sortOrderEl.value : 'newest';
  const entries = (await getAllEntries())
    .filter(e => {
      let ok = true;
      if(vfilter==='visited') ok = e.visited;
      if(vfilter==='unvisited') ok = !e.visited;
      if(q){
        const hay = (e.memo||'') + ' ' + (e.tags||'') + ' ' + (e.addr||'');
        ok = ok && hay.toLowerCase().includes(q);
      }
      return ok;
    })
    .sort((a,b)=> order==='newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);

  listEl.innerHTML = '';
  const tpl = document.getElementById('entryTemplate');
  for(const e of entries){
    const node = tpl.content.cloneNode(true);
    const root = node.querySelector('.entry');
    if(e.visited) root.classList.add('visited');
    node.querySelector('.thumb').src = (e.photos && e.photos[0]) || '';
    const d = new Date(e.createdAt);
    const formatted = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ` +
                      `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    node.querySelector('.date').textContent = formatted;
    node.querySelector('.tags').textContent = e.tags || '';
    node.querySelector('.memo').textContent = e.memo || '';
    node.querySelector('.addr').textContent = e.addr || '';
    const coordsEl = node.querySelector('.coords');
    const linksEl = node.querySelector('.links');
    if(e.coords){
      coordsEl.textContent = `(${e.coords.lat.toFixed(6)}, ${e.coords.lng.toFixed(6)}) ±${Math.round(e.coords.acc)}m`;
      const gmap = document.createElement('a');
      gmap.href = `https://maps.google.com/?q=${e.coords.lat},${e.coords.lng}`;
      gmap.target = '_blank'; gmap.textContent='Google地図';
      const amap = document.createElement('a');
      amap.href = `http://maps.apple.com/?ll=${e.coords.lat},${e.coords.lng}`; amap.textContent='Apple地図';
      linksEl.appendChild(gmap); linksEl.appendChild(amap);
    }else{
      coordsEl.textContent = '座標なし';
    }
    const gal = node.querySelector('.gallery');
    (e.photos||[]).forEach(src=>{ const im=document.createElement('img'); im.src=src; gal.appendChild(im); });
    node.querySelector('.openMap').addEventListener('click', ()=>{
      if(e.coords) window.open(`http://maps.apple.com/?ll=${e.coords.lat},${e.coords.lng}`,'_blank');
      else alert('座標がありません');
    });
    node.querySelector('.openNTA').addEventListener('click', ()=>{
      if(!e.coords){ alert('座標がありません'); return; }
      window.open(`https://www.rosenka.nta.go.jp/?lat=${e.coords.lat}&lon=${e.coords.lng}`,'_blank');
    });
    node.querySelector('.openZoning').addEventListener('click', ()=>{
      if(!e.coords){ alert('座標がありません'); return; }
      window.open(`https://maps.gsi.go.jp/?ll=${e.coords.lat},${e.coords.lng}&z=17&base=std&ls=Mlitchiiki_youto&disp=1`,'_blank');
    });
    node.querySelector('.copyAddr').addEventListener('click', async ()=>{
      if(!e.coords){ alert('座標がありません'); return; }
      try{ await navigator.clipboard.writeText(`${e.coords.lat},${e.coords.lng}`); alert('座標をコピーしました'); }
      catch(_){ alert('コピーに失敗しました'); }
    });
    node.querySelector('.delete').addEventListener('click', async ()=>{
      if(confirm('この記録を削除しますか？')){ await deleteEntry(e.id); renderList(); }
    });
    listEl.appendChild(node);
  }
}

searchEl && searchEl.addEventListener('input', ()=>renderList());
filterVisitedEl && filterVisitedEl.addEventListener('change', ()=>renderList());
sortOrderEl && sortOrderEl.addEventListener('change', ()=>renderList());

document.getElementById('exportJSON').addEventListener('click', async ()=>{
  const data = await getAllEntries();
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'field_entries.json'; a.click(); URL.revokeObjectURL(url);
});

document.getElementById('importJSON').addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const arr = JSON.parse(await file.text());
  for(const ent of arr){ delete ent.id; await addEntry(ent); }
  alert('インポートしました'); renderList();
});

document.getElementById('clearAll')?.addEventListener('click', async ()=>{
  if(!confirm('全データを削除します。よろしいですか？')) return;
  const req = indexedDB.deleteDatabase(DB_NAME);
  req.onsuccess = ()=>{ alert('削除しました'); location.reload(); };
  req.onerror = ()=> alert('削除に失敗しました');
});

const apiKeyEl = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKey');
const keySaved = document.getElementById('keySaved');
if(apiKeyEl){
  apiKeyEl.value = localStorage.getItem('gc_api_key')||'';
  saveKeyBtn.addEventListener('click', ()=>{
    localStorage.setItem('gc_api_key', apiKeyEl.value.trim());
    keySaved.textContent = '保存しました'; setTimeout(()=> keySaved.textContent='', 2000);
  });
}

openDB().then(()=>console.log('DB ready'));
