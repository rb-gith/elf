'use strict';

/* =========================================================
   ELF — a gift tracker for every occasion (PWA)
   People, gift ideas and photos live in this device's IndexedDB,
   settings in its localStorage. Nothing is sent anywhere.
   ========================================================= */

const DB_NAME = 'elf', DB_VERSION = 1;
const STORES = ['people', 'gifts', 'photos', 'thumbs'];
const SETTINGS_KEY = 'elf-settings';
const STAGES = ['idea', 'bought', 'wrapped', 'given'];
const POOL_STAGES = ['idea', 'bought', 'wrapped'];
const MAX_PHOTOS = 3;
const FULL_SIDE = 1280, FULL_QUALITY = 0.82;
const THUMB_SIDE = 240, THUMB_QUALITY = 0.75;
const DATA_FILE = 'elf-data.json';
const COFFEE_URL = 'https://buymeacoffee.com/gionzana';
const GITHUB_URL = 'https://github.com/rb-gith?tab=repositories';
const POOL = 'pool';
/* Occasions: two built in (stored by key, shown translated), plus the user's own (stored by name) */
const BUILT_IN = ['christmas', 'birthday'];
const DEFAULT_OCCASION = 'christmas';
const ALL = 'all';
const MAX_OCCASIONS = 12, OCCASION_LEN = 30;

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isDate = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

/* ---------- Settings and language ---------- */
function cleanOccasions(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(o => {
    const name = typeof o === 'string' ? o.trim().slice(0, OCCASION_LEN) : '';
    if (name && !BUILT_IN.includes(name) && name !== ALL && !out.includes(name) && out.length < MAX_OCCASIONS) out.push(name);
  });
  return out;
}
function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  const occasions = cleanOccasions(s.occasions);
  const filter = s.filter === ALL || BUILT_IN.includes(s.filter) || occasions.includes(s.filter) ? s.filter : ALL;
  return {
    lang: s.lang === 'en' || s.lang === 'it' ? s.lang : null,
    lastBackup: isDate(s.lastBackup) ? s.lastBackup : null,
    occasions,
    filter,
  };
}
let settings = cleanSettings(null);
try { settings = cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY))); } catch (e) { /* use the defaults */ }
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
}
const phoneLang = navigator.language || '';
let lang = settings.lang || (/^it\b/i.test(phoneLang) ? 'it' : 'en');
const tr = (key, ...args) => args.reduce((s, a) => s.replace('{}', () => a), TEXT[lang][key]);
const locale = () => phoneLang.toLowerCase().startsWith(lang) ? phoneLang : lang === 'it' ? 'it-IT' : 'en-GB';
function setLang(next) {
  lang = next;
  settings.lang = next;
  saveSettings();
  document.documentElement.lang = lang;
  render();
}
document.documentElement.lang = lang;

/* ---------- Occasions ---------- */
const occasionLabel = o => BUILT_IN.includes(o) ? tr('occ_' + o) : o;
/* Built-in ones, the user's own, and any found in the gifts (from an older backup, say) */
function allOccasions() {
  const found = gifts.map(g => g.occasion).filter(o => !BUILT_IN.includes(o) && !settings.occasions.includes(o));
  return BUILT_IN.concat(settings.occasions, [...new Set(found)]);
}
const shown = g => settings.filter === ALL || g.occasion === settings.filter;
/* A typed name that matches a built-in occasion in either language becomes that occasion */
function occasionFromName(name) {
  const low = name.toLowerCase();
  return BUILT_IN.find(o => Object.keys(TEXT).some(l => TEXT[l]['occ_' + o].toLowerCase() === low)) || name;
}

/* ---------- Storage ---------- */
let db;
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('people', { keyPath: 'id' });
      d.createObjectStore('gifts', { keyPath: 'id' });
      d.createObjectStore('photos');
      d.createObjectStore('thumbs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function write(fill) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    fill(tx);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function request(store, method, ...args) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store)[method](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function allEntries(store) {
  return new Promise((resolve, reject) => {
    const found = new Map();
    const req = db.transaction(store).objectStore(store).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(found); return; }
      found.set(cur.key, cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
let askedPersist = false;
function keepData() {
  /* Ask the browser not to clear the list when the phone runs low on space */
  if (askedPersist) return;
  askedPersist = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

/* ---------- Data in memory ---------- */
let people = [];
let gifts = [];
const thumbUrls = new Map();
function setThumb(id, blob) {
  if (thumbUrls.has(id)) URL.revokeObjectURL(thumbUrls.get(id));
  thumbUrls.set(id, URL.createObjectURL(blob));
}
function dropThumb(id) {
  if (thumbUrls.has(id)) URL.revokeObjectURL(thumbUrls.get(id));
  thumbUrls.delete(id);
}
const personById = id => people.find(p => p.id === id);
const giftById = id => gifts.find(g => g.id === id);
const giftsOf = personId => gifts.filter(g => g.personId === personId && shown(g)).sort((a, b) => a.created - b.created);
const allGiftsOf = personId => gifts.filter(g => g.personId === personId);
const byCreated = (a, b) => a.created - b.created;

/* Everything read from a backup file is reduced to known fields and types */
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function cleanPerson(p) {
  return { id: String(p.id || uid()).slice(0, 40), name: text(p.name, 80), created: Number(p.created) || Date.now() };
}
function cleanGift(g, personIds) {
  const personId = typeof g.personId === 'string' && personIds.has(g.personId) ? g.personId : null;
  let stage = STAGES.includes(g.stage) ? g.stage : 'idea';
  if (!personId && stage === 'given') stage = 'wrapped';
  return {
    id: String(g.id || uid()).slice(0, 40),
    personId,
    text: text(g.text, 200),
    note: typeof g.note === 'string' ? g.note.slice(0, 2000) : '',
    stage,
    occasion: cleanOccasion(g.occasion),
    photos: Array.isArray(g.photos) ? g.photos.filter(x => typeof x === 'string').slice(0, MAX_PHOTOS) : [],
    created: Number(g.created) || Date.now(),
  };
}
/* Ideas saved before occasions existed were all for Christmas */
function cleanOccasion(o) {
  const name = typeof o === 'string' ? o.trim().slice(0, OCCASION_LEN) : '';
  return name && name !== ALL ? name : DEFAULT_OCCASION;
}

/* ---------- Photos: shrunk once, when they are added ---------- */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
function resizeTo(img, side, quality) {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => {
    c.toBlob(b => b ? resolve(b) : reject(new Error('resize failed')), 'image/jpeg', quality);
  });
}
async function processPhoto(file) {
  const { img, url } = await loadImage(file);
  try {
    return { full: await resizeTo(img, FULL_SIDE, FULL_QUALITY), thumb: await resizeTo(img, THUMB_SIDE, THUMB_QUALITY) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function thumbFrom(blob) {
  const { img, url } = await loadImage(blob);
  try { return await resizeTo(img, THUMB_SIDE, THUMB_QUALITY); }
  finally { URL.revokeObjectURL(url); }
}

/* ---------- Navigation: each page is a history entry, so the phone's back button works ---------- */
const ui = { route: null, y: 0, form: null };
history.scrollRestoration = 'manual';
const depth = () => (history.state && history.state.d) || 0;
function go(hash) {
  history.pushState({ d: depth() + 1 }, '', '#' + hash);
  render();
}
function back() {
  if (depth() > 0) { history.back(); return; }
  history.replaceState({ d: 0 }, '', location.pathname + location.search);
  render();
}
addEventListener('popstate', render);
function currentRoute() {
  const [name, arg] = location.hash.slice(1).split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : null };
}

/* ---------- Rendering ---------- */
const app = $('#app');
function render() {
  if (!db) return;
  const key = location.hash;
  const sameRoute = key === ui.route;
  const y = scrollY;
  if (ui.route === '') ui.y = y;
  if (!sameRoute) closeDialogs();

  const { name, arg } = currentRoute();
  if (name === 'home') app.innerHTML = homeHtml();
  else if (name === 'person' && personById(arg)) app.innerHTML = listHtml(arg);
  else if (name === POOL) app.innerHTML = listHtml(POOL);
  else if (name === 'add' && (arg === POOL || personById(arg))) { startForm(key, null, arg); app.innerHTML = formHtml(); }
  else if (name === 'edit' && giftById(arg)) { startForm(key, giftById(arg)); app.innerHTML = formHtml(); }
  else if (name === 'menu') app.innerHTML = menuHtml();
  else { back(); return; }
  ui.route = key;

  if (name !== 'add' && name !== 'edit') endForm();
  scrollTo(0, sameRoute ? y : name === 'home' ? ui.y : 0);
  if (name === 'menu') showStorageUse();
}

const svg = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/></svg>',
  photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

const creditHtml = () => `<footer class="credit">
  <p>${tr('madeBy')} · <a href="${COFFEE_URL}" target="_blank" rel="noopener">${tr('coffee')}</a></p>
  <p>${tr('moreApps', `<a href="${GITHUB_URL}" target="_blank" rel="noopener">github</a>`)}</p>
</footer>`;

/* A thin bar showing how many gifts are at each stage */
function barHtml(list, thin) {
  if (!list.length) return thin ? '' : `<div class="bar"></div>`;
  const parts = ['given', 'wrapped', 'bought', 'idea']
    .map(s => [s, list.filter(g => g.stage === s).length])
    .filter(([, n]) => n)
    .map(([s, n]) => `<span class="${s}" style="width:${(n / list.length) * 100}%"></span>`).join('');
  return `<div class="bar${thin ? ' thin' : ''}">${parts}</div>`;
}
const initials = name => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
  return letters.toUpperCase();
};
const hashOf = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

/* ---------- Occasion chips: filter every list ---------- */
function chipsHtml() {
  const chip = (value, label) => `<button class="occ" data-act="filter" data-occ="${esc(value)}" aria-pressed="${settings.filter === value}">${esc(label)}</button>`;
  return `<div class="occs" role="group" aria-label="${tr('occasions')}">
    ${chip(ALL, tr('occ_all'))}${allOccasions().map(o => chip(o, occasionLabel(o))).join('')}
    <button class="occ add" data-act="add-occasion" aria-label="${tr('addOccasion')}">+</button>
  </div>`;
}
function setFilter(value) {
  settings.filter = value;
  saveSettings();
  render();
}

/* ---------- Home: the people list ---------- */
function homeHtml() {
  const assigned = gifts.filter(g => g.personId && shown(g));
  const given = assigned.filter(g => g.stage === 'given').length;
  const pool = giftsOf(null);
  const poolSub = pool.length === 0 ? tr('poolNone') : pool.length === 1 ? tr('poolOne') : tr('poolMany', pool.length);
  const rows = people.slice().sort(byCreated).map(p => {
    const list = giftsOf(p.id);
    const done = list.filter(g => g.stage === 'given').length;
    const complete = list.length && done === list.length;
    return `<button class="row" data-act="open-person" data-id="${esc(p.id)}">
      <span class="avatar a${hashOf(p.id) % 4}">${esc(initials(p.name))}</span>
      <span class="who"><span class="name">${esc(p.name)}</span>${list.length ? barHtml(list, true) : `<span class="sub">${settings.filter !== ALL && allGiftsOf(p.id).length ? tr('noneHere') : tr('noGifts')}</span>`}</span>
      ${list.length ? `<span class="tally${complete ? ' done' : ''}">${complete ? '✓ ' : ''}${done}/${list.length}</span>` : ''}
    </button>`;
  }).join('');
  return `<div class="view">
    <header class="topbar">
      <h1>${tr('title')}</h1>
      <button class="icon-btn" data-act="menu" aria-label="${tr('menu')}">${svg.menu}</button>
    </header>
    ${chipsHtml()}
    ${assigned.length ? `<p class="summary"><span>${tr('givenOf', given, assigned.length)}</span></p>${barHtml(assigned)}` : ''}
    <button class="row pool" data-act="open-pool">
      <span class="avatar pool-av">${svg.bulb}</span>
      <span class="who"><span class="name">${tr('pool')}</span><span class="sub">${poolSub}</span></span>
      <span class="chev">›</span>
    </button>
    ${people.length ? `<div class="people">${rows}</div>` : `<div class="empty"><h2>${tr('emptyTitle')}</h2><p>${tr('emptyText')}</p></div>`}
    <button class="btn primary wide" style="margin-top:16px" data-act="add-person">+ ${tr('addPerson')}</button>
    ${creditHtml()}
  </div>`;
}

/* ---------- A person's page, or the ideas for anyone ---------- */
function listHtml(owner) {
  const isPool = owner === POOL;
  const person = !isPool && personById(owner);
  const list = giftsOf(isPool ? null : owner);
  const done = list.filter(g => g.stage === 'given').length;
  return `<div class="view">
    <header class="topbar">
      <button class="icon-btn" data-act="back" aria-label="${tr('back')}">‹</button>
      <h2>${isPool ? tr('pool') : esc(person.name)}</h2>
      ${!isPool && list.length ? `<span class="count">${done}/${list.length}</span>` : ''}
      ${isPool ? '' : `<button class="link-btn" data-act="edit-person">${tr('rename')}</button>`}
    </header>
    ${chipsHtml()}
    ${list.map(g => giftHtml(g, isPool)).join('')}
    ${list.length ? '' : `<p class="hint">${settings.filter !== ALL && allGiftsOf(isPool ? null : owner).length ? tr('noneForOccasion', occasionLabel(settings.filter)) : isPool ? tr('poolEmpty') : tr('gifts0')}</p>`}
    <button class="btn dashed" data-act="add-gift">+ ${tr('addGift')}</button>
  </div>`;
}
function giftHtml(g, isPool) {
  const first = g.photos[0] && thumbUrls.get(g.photos[0]);
  const stages = isPool ? POOL_STAGES : STAGES;
  const reached = STAGES.indexOf(g.stage);
  const steps = stages.map((s, i) => `<button class="step${i <= reached ? ' on ' + g.stage : ''}" data-act="stage" data-id="${esc(g.id)}" data-stage="${s}" aria-pressed="${s === g.stage}">${tr('stage_' + s)}</button>`).join('');
  return `<article class="gift${g.stage === 'given' ? ' is-given' : ''}">
    <button class="gift-main" data-act="edit-gift" data-id="${esc(g.id)}">
      ${first ? `<img class="thumb" src="${first}" alt="">` : `<span class="thumb none">${svg.photo}</span>`}
      <span class="gift-text">
        <span class="gift-title">${esc(g.text)}${settings.filter === ALL ? ` <span class="occ-tag">${esc(occasionLabel(g.occasion))}</span>` : ''}</span>
        ${g.note ? `<span class="gift-note">${esc(g.note)}</span>` : ''}
        ${g.photos.length > 1 ? `<span class="gift-more">${tr('photoCount', g.photos.length)}</span>` : ''}
      </span>
    </button>
    <div class="steps${isPool ? ' three' : ''}" role="group" aria-label="${esc(tr('stages', g.text))}">${steps}</div>
    ${isPool ? `<button class="give-btn" data-act="give" data-id="${esc(g.id)}">${tr('giveTo')}</button>` : ''}
  </article>`;
}

async function setStage(g, stage) {
  if (g.stage === stage) return;
  const updated = Object.assign({}, g, { stage });
  try { await write(tx => tx.objectStore('gifts').put(updated)); }
  catch (e) { toast(tr('saveFailed')); return; }
  gifts[gifts.indexOf(g)] = updated;
  render();
}

/* ---------- Add or edit a gift ---------- */
/* The form keeps its photos in memory until Save, so leaving without saving changes nothing */
function startForm(key, gift, owner) {
  if (ui.form && ui.form.key === key) return;
  endForm();
  ui.form = {
    key,
    gift,
    personId: gift ? gift.personId : owner === POOL ? null : owner,
    occasion: gift ? gift.occasion : settings.filter !== ALL ? settings.filter : DEFAULT_OCCASION,
    photos: gift ? gift.photos.map(id => ({ id, saved: true, url: thumbUrls.get(id) })) : [],
    removed: [],
  };
}
function endForm() {
  if (!ui.form) return;
  ui.form.photos.filter(p => !p.saved).forEach(p => URL.revokeObjectURL(p.url));
  ui.form = null;
}
function formHtml() {
  const f = ui.form;
  const g = f.gift;
  const owner = f.personId && personById(f.personId);
  const heading = g ? tr('editGift') : owner ? tr('newGiftFor', esc(owner.name)) : tr('newGiftPool');
  const options = [`<option value="">${tr('notDecided')}</option>`]
    .concat(people.slice().sort(byCreated).map(p => `<option value="${esc(p.id)}" ${p.id === f.personId ? 'selected' : ''}>${esc(p.name)}</option>`)).join('');
  return `<div class="view"><form id="gift-form" novalidate>
    <header class="topbar">
      <button type="button" class="icon-btn" data-act="back" aria-label="${tr('back')}">‹</button>
      <h2>${heading}</h2>
    </header>
    <label class="field"><span>${tr('idea')}</span>
      <input type="text" name="text" value="${g ? esc(g.text) : ''}" maxlength="200" placeholder="${tr('ideaPlaceholder')}" autocomplete="off" ${g ? '' : 'autofocus'}></label>
    <p class="small-note" id="text-error" style="color:var(--danger)" hidden>${tr('ideaError')}</p>
    <label class="field"><span>${tr('note')}</span>
      <textarea name="note" rows="2" maxlength="2000" placeholder="${tr('notePlaceholder')}">${g ? esc(g.note) : ''}</textarea></label>
    <label class="field"><span>${tr('forWho')}</span><select name="personId">${options}</select></label>
    <label class="field"><span>${tr('occasion')}</span><select name="occasion" id="occasion-select">${occasionOptions(f.occasion)}</select></label>
    <div class="field"><span class="field-label">${tr('photos')}</span>
      <div class="photos" id="photos">${photosHtml()}</div>
      <p class="small-note">${tr('photoHint', MAX_PHOTOS)}</p>
    </div>
    <div class="btns">
      ${g ? `<button type="button" class="btn danger" data-act="delete-gift">${tr('delete')}</button>` : ''}
      <button class="btn primary grow">${tr('save')}</button>
    </div>
  </form></div>`;
}
const NEW_OCCASION = '__new__';
function occasionOptions(selected) {
  const list = allOccasions();
  if (!list.includes(selected)) list.push(selected);
  return list.map(o => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(occasionLabel(o))}</option>`).join('')
    + `<option value="${NEW_OCCASION}">+ ${tr('newOccasion')}</option>`;
}
function photosHtml() {
  const list = ui.form.photos.map((p, i) => `<div class="ph">
      <img src="${p.url || ''}" alt="">
      <button type="button" class="open" data-act="view-photo" data-i="${i}" aria-label="${tr('openPhoto')}"></button>
      <button type="button" class="x" data-act="remove-photo" data-i="${i}" aria-label="${tr('removePhoto')}">×</button>
    </div>`).join('');
  const add = ui.form.photos.length < MAX_PHOTOS
    ? `<button type="button" class="ph-add" data-act="add-photo">${svg.camera}${tr('addPhoto')}</button>` : '';
  return list + add;
}
function refreshPhotos() {
  const box = $('#photos');
  if (box) box.innerHTML = photosHtml();
}
async function addPhoto(file) {
  if (!file || !ui.form) return;
  if (ui.form.photos.length >= MAX_PHOTOS) { toast(tr('photoLimit', MAX_PHOTOS)); return; }
  const form = ui.form;
  toast(tr('preparingPhoto'));
  try {
    const { full, thumb } = await processPhoto(file);
    if (ui.form !== form) return;
    form.photos.push({ id: uid(), saved: false, full, thumb, url: URL.createObjectURL(thumb) });
    hideToast();
    refreshPhotos();
  } catch (e) {
    toast(tr('photoFailed'));
  }
}
function removePhoto(i) {
  const p = ui.form.photos[i];
  if (!p) return;
  ui.form.photos.splice(i, 1);
  if (p.saved) ui.form.removed.push(p.id); else URL.revokeObjectURL(p.url);
  refreshPhotos();
}

async function submitGift(form) {
  const f = ui.form;
  const d = new FormData(form);
  const giftText = String(d.get('text') || '').trim();
  if (!giftText) {
    $('#text-error').hidden = false;
    form.elements.text.focus();
    return;
  }
  const old = f.gift;
  const personId = d.get('personId') || null;
  let stage = old ? old.stage : 'idea';
  if (!personId && stage === 'given') stage = 'wrapped';
  const gift = {
    id: old ? old.id : uid(),
    personId: personId && personById(personId) ? personId : null,
    text: giftText.slice(0, 200),
    note: String(d.get('note') || '').trim().slice(0, 2000),
    stage,
    occasion: cleanOccasion(d.get('occasion') === NEW_OCCASION ? f.occasion : d.get('occasion')),
    photos: f.photos.map(p => p.id),
    created: old ? old.created : Date.now(),
  };
  const fresh = f.photos.filter(p => !p.saved);
  try {
    await write(tx => {
      tx.objectStore('gifts').put(gift);
      fresh.forEach(p => { tx.objectStore('photos').put(p.full, p.id); tx.objectStore('thumbs').put(p.thumb, p.id); });
      f.removed.forEach(id => { tx.objectStore('photos').delete(id); tx.objectStore('thumbs').delete(id); });
    });
  } catch (e) {
    toast(tr('saveFailed'));
    return;
  }
  if (old) gifts[gifts.indexOf(old)] = gift; else gifts.push(gift);
  fresh.forEach(p => setThumb(p.id, p.thumb));
  f.removed.forEach(dropThumb);
  keepData();
  toast(tr('saved'));
  back();
}

async function deleteGift(g) {
  if (!confirm(tr('confirmDeleteGift', g.text))) return;
  try {
    await write(tx => {
      tx.objectStore('gifts').delete(g.id);
      g.photos.forEach(id => { tx.objectStore('photos').delete(id); tx.objectStore('thumbs').delete(id); });
    });
  } catch (e) {
    toast(tr('saveFailed'));
    return;
  }
  gifts = gifts.filter(x => x !== g);
  g.photos.forEach(dropThumb);
  toast(tr('deleted'));
  back();
}

/* ---------- People: add, rename, delete (in a bottom sheet) ---------- */
const sheet = $('#sheet');
function openPersonSheet(person) {
  sheet.innerHTML = `<form id="person-form" method="dialog" novalidate data-id="${person ? esc(person.id) : ''}">
    <h3>${tr(person ? 'editPerson' : 'newPerson')}</h3>
    <label class="field"><span>${tr('personName')}</span>
      <input type="text" name="name" value="${person ? esc(person.name) : ''}" maxlength="80" placeholder="${tr('namePlaceholder')}" autocomplete="off"></label>
    <p class="small-note" id="name-error" style="color:var(--danger)" hidden>${tr('nameError')}</p>
    <div class="btns">
      ${person ? `<button type="button" class="btn danger" data-act="delete-person">${tr('delete')}</button>` : `<button type="button" class="btn" data-act="sheet-close">${tr('cancel')}</button>`}
      <button class="btn primary grow">${tr('save')}</button>
    </div>
  </form>`;
  sheet.showModal();
  sheet.querySelector('input').focus();
}
async function submitPerson(form) {
  const name = form.elements.name.value.trim().slice(0, 80);
  if (!name) { $('#name-error').hidden = false; return; }
  const old = form.dataset.id && personById(form.dataset.id);
  const person = old ? Object.assign({}, old, { name }) : { id: uid(), name, created: Date.now() };
  try { await write(tx => tx.objectStore('people').put(person)); }
  catch (e) { toast(tr('saveFailed')); return; }
  if (old) people[people.indexOf(old)] = person; else people.push(person);
  keepData();
  sheet.close();
  render();
}
async function deletePerson(p) {
  const theirs = allGiftsOf(p.id);
  if (!confirm(theirs.length ? tr('confirmDeletePerson', p.name) : tr('confirmDeletePersonEmpty', p.name))) return;
  try {
    await write(tx => {
      tx.objectStore('people').delete(p.id);
      theirs.forEach(g => {
        tx.objectStore('gifts').delete(g.id);
        g.photos.forEach(id => { tx.objectStore('photos').delete(id); tx.objectStore('thumbs').delete(id); });
      });
    });
  } catch (e) {
    toast(tr('saveFailed'));
    return;
  }
  people = people.filter(x => x !== p);
  gifts = gifts.filter(g => !theirs.includes(g));
  theirs.forEach(g => g.photos.forEach(dropThumb));
  sheet.close();
  toast(tr('deleted'));
  back();
}

/* ---------- Give an idea for anyone to a person ---------- */
function openGiveSheet(g) {
  if (!people.length) { toast(tr('noPeopleYet')); return; }
  const chips = people.slice().sort(byCreated).map(p => `<button type="button" class="chip" data-act="give-to" data-gift="${esc(g.id)}" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  sheet.innerHTML = `<h3>${esc(tr('giveToTitle', g.text))}</h3><div class="chips">${chips}</div>
    <div class="btns"><button type="button" class="btn grow" data-act="sheet-close">${tr('cancel')}</button></div>`;
  sheet.showModal();
}
async function giveTo(g, person) {
  const updated = Object.assign({}, g, { personId: person.id });
  try { await write(tx => tx.objectStore('gifts').put(updated)); }
  catch (e) { toast(tr('saveFailed')); return; }
  gifts[gifts.indexOf(g)] = updated;
  sheet.close();
  toast(tr('movedTo', person.name));
  render();
}

/* ---------- The user's own occasions ---------- */
function openOccasionSheet() {
  sheet.innerHTML = `<form id="occasion-form" method="dialog" novalidate>
    <h3>${tr('newOccasion')}</h3>
    <label class="field"><span>${tr('occasionName')}</span>
      <input type="text" name="name" maxlength="${OCCASION_LEN}" placeholder="${tr('occasionPlaceholder')}" autocomplete="off"></label>
    <p class="small-note" id="occasion-error" style="color:var(--danger)" hidden></p>
    <div class="btns">
      <button type="button" class="btn" data-act="sheet-close">${tr('cancel')}</button>
      <button class="btn primary grow">${tr('save')}</button>
    </div>
  </form>`;
  sheet.showModal();
  sheet.querySelector('input').focus();
}
function submitOccasion(form) {
  const error = msg => { const el = $('#occasion-error'); el.textContent = msg; el.hidden = false; };
  const typed = form.elements.name.value.trim().slice(0, OCCASION_LEN);
  if (!typed) { error(tr('occasionError')); return; }
  const occ = occasionFromName(typed);
  if (occ === ALL || occ === NEW_OCCASION) { error(tr('occasionError')); return; }
  const known = allOccasions().includes(occ);
  if (!known && settings.occasions.length >= MAX_OCCASIONS) { error(tr('occasionLimit', MAX_OCCASIONS)); return; }
  if (!known) settings.occasions.push(occ);
  sheet.close();
  if (ui.form) {
    /* Stay on the form, keeping what was typed: pick the new occasion in its list */
    ui.form.occasion = occ;
    saveSettings();
    const sel = $('#occasion-select');
    if (sel) sel.innerHTML = occasionOptions(occ);
    return;
  }
  setFilter(occ);
}
function removeOccasion(o) {
  if (gifts.some(g => g.occasion === o)) { toast(tr('occasionInUse', o)); return; }
  settings.occasions = settings.occasions.filter(x => x !== o);
  if (settings.filter === o) settings.filter = ALL;
  saveSettings();
  render();
}

/* ---------- Full-screen photo ---------- */
const viewer = $('#viewer');
let viewerUrl = null;
function openViewer(url, own) {
  viewerUrl = own ? url : null;
  viewer.innerHTML = `<img src="${url}" alt=""><button class="icon-btn" data-act="viewer-close" aria-label="${tr('close')}">×</button>`;
  viewer.showModal();
}
viewer.addEventListener('click', () => viewer.close());
viewer.addEventListener('close', () => {
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null;
  viewer.innerHTML = '';
});
async function viewPhoto(i) {
  const p = ui.form && ui.form.photos[i];
  if (!p) return;
  if (!p.saved) { openViewer(URL.createObjectURL(p.full), true); return; }
  try {
    const blob = await request('photos', 'get', p.id);
    openViewer(blob ? URL.createObjectURL(blob) : p.url, !!blob);
  } catch (e) {
    openViewer(p.url, false);
  }
}
function closeDialogs() {
  if (sheet.open) sheet.close();
  if (viewer.open) viewer.close();
}

/* ---------- Menu: language and backup ---------- */
function menuHtml() {
  const last = settings.lastBackup
    ? ' ' + tr('backupLast', new Date(settings.lastBackup + 'T12:00').toLocaleDateString(locale(), { dateStyle: 'medium' })) : '';
  return `<div class="view menu">
    <header class="topbar">
      <button class="icon-btn" data-act="back" aria-label="${tr('back')}">‹</button>
      <h2>${tr('menu')}</h2>
    </header>
    <h3>${tr('language')}</h3>
    <div class="seg">
      <button data-act="lang" data-lang="en" aria-pressed="${lang === 'en'}">English</button>
      <button data-act="lang" data-lang="it" aria-pressed="${lang === 'it'}">Italiano</button>
    </div>
    <h3>${tr('occasions')}</h3>
    <p class="note">${tr('occasionsNote')}</p>
    <div class="chips">
      ${BUILT_IN.map(o => `<span class="chip fixed">${esc(occasionLabel(o))}</span>`).join('')}
      ${settings.occasions.map(o => `<button class="chip" data-act="remove-occasion" data-occ="${esc(o)}" aria-label="${esc(tr('removeOccasion', o))}">${esc(o)} ×</button>`).join('')}
      <button class="chip" data-act="add-occasion">+ ${tr('newOccasion')}</button>
    </div>
    <h3>${tr('backup')}</h3>
    <p class="note">${tr('backupNote')}${last}</p>
    <p class="note" id="storage-use" hidden></p>
    <div class="btns">
      <button class="btn primary" data-act="export">${tr('exportBackup')}</button>
      <label class="btn">${tr('importBackup')}<input type="file" accept=".zip,application/zip,application/x-zip-compressed" id="import-file" hidden></label>
    </div>
    ${creditHtml()}
  </div>`;
}
async function showStorageUse() {
  if (!navigator.storage || !navigator.storage.estimate || !gifts.length) return;
  try {
    const { usage } = await navigator.storage.estimate();
    const el = $('#storage-use');
    if (el && usage) { el.textContent = tr('storageUsed', Math.max(1, Math.round(usage / 1e6))); el.hidden = false; }
  } catch (e) { /* the number is only a nicety */ }
}
function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function exportBackup() {
  toast(tr('exporting'));
  try {
    const files = [];
    for (const g of gifts) {
      for (const id of g.photos) {
        const blob = await request('photos', 'get', id);
        if (blob) files.push({ name: `photos/${id}.jpg`, blob });
      }
    }
    const data = { app: 'elf', version: 2, people, gifts, occasions: settings.occasions };
    files.push({ name: DATA_FILE, blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }) });
    const zip = await ZIP.write(files);
    const stamp = todayKey();
    saveFile(zip, `elf-${stamp}.zip`);
    settings.lastBackup = stamp;
    saveSettings();
    toast(tr('backupSaved'));
    render();
  } catch (e) {
    toast(tr('backupFailed'));
  }
}
async function importBackup(file) {
  let data, entries;
  try {
    entries = await ZIP.read(file);
    if (!entries.has(DATA_FILE)) throw new Error('no data');
    data = JSON.parse(await (await entries.get(DATA_FILE)()).text());
    if (!data || data.app !== 'elf' || !Array.isArray(data.people) || !Array.isArray(data.gifts)) throw new Error('bad data');
  } catch (e) {
    toast(tr('notBackup'));
    return;
  }
  if (!confirm(tr('confirmImport'))) return;

  const newPeople = data.people.filter(p => p && typeof p.name === 'string' && p.name.trim()).map(cleanPerson);
  const ids = new Set(newPeople.map(p => p.id));
  const newGifts = data.gifts.filter(g => g && typeof g.text === 'string' && g.text.trim()).map(g => cleanGift(g, ids));
  const photos = [];
  try {
    const wanted = newGifts.flatMap(g => g.photos);
    for (let i = 0; i < wanted.length; i++) {
      toast(tr('importing', i + 1, wanted.length));
      const id = wanted[i];
      const get = entries.get(`photos/${id}.jpg`);
      if (!get) continue;
      try {
        const full = new Blob([await get()], { type: 'image/jpeg' });
        photos.push({ id, full, thumb: await thumbFrom(full) });
      } catch (e) { /* a broken photo is skipped */ }
    }
    const kept = new Set(photos.map(p => p.id));
    newGifts.forEach(g => { g.photos = g.photos.filter(id => kept.has(id)); });
    await write(tx => {
      STORES.forEach(s => tx.objectStore(s).clear());
      newPeople.forEach(p => tx.objectStore('people').put(p));
      newGifts.forEach(g => tx.objectStore('gifts').put(g));
      photos.forEach(p => { tx.objectStore('photos').put(p.full, p.id); tx.objectStore('thumbs').put(p.thumb, p.id); });
    });
  } catch (e) {
    toast(tr('saveFailed'));
    return;
  }
  thumbUrls.forEach(u => URL.revokeObjectURL(u));
  thumbUrls.clear();
  people = newPeople;
  gifts = newGifts;
  photos.forEach(p => setThumb(p.id, p.thumb));
  /* Older backups have no occasion list: keep the user's own, add any found in the backup */
  settings.occasions = cleanOccasions(settings.occasions.concat(cleanOccasions(data.occasions)));
  if (settings.filter !== ALL && !allOccasions().includes(settings.filter)) settings.filter = ALL;
  settings.lastBackup = todayKey();
  saveSettings();
  keepData();
  toast(tr('backupRestored'));
  render();
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2600);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

/* ---------- Events ---------- */
const photoInput = $('#photo-input');
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  addPhoto(file);
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const route = currentRoute();
  const gift = b.dataset.id && giftById(b.dataset.id);
  switch (b.dataset.act) {
    case 'back': back(); break;
    case 'menu': go('menu'); break;
    case 'open-person': go('person/' + encodeURIComponent(b.dataset.id)); break;
    case 'open-pool': go(POOL); break;
    case 'add-person': openPersonSheet(null); break;
    case 'edit-person': openPersonSheet(personById(route.arg)); break;
    case 'delete-person': {
      const p = personById(sheet.querySelector('form').dataset.id);
      if (p) deletePerson(p);
      break;
    }
    case 'sheet-close': sheet.close(); break;
    case 'add-gift': go('add/' + encodeURIComponent(route.name === POOL ? POOL : route.arg)); break;
    case 'edit-gift': go('edit/' + encodeURIComponent(b.dataset.id)); break;
    case 'stage': if (gift) setStage(gift, b.dataset.stage); break;
    case 'give': if (gift) openGiveSheet(gift); break;
    case 'give-to': {
      const g = giftById(b.dataset.gift), p = personById(b.dataset.id);
      if (g && p) giveTo(g, p);
      break;
    }
    case 'add-photo': photoInput.click(); break;
    case 'remove-photo': removePhoto(Number(b.dataset.i)); break;
    case 'view-photo': viewPhoto(Number(b.dataset.i)); break;
    case 'viewer-close': viewer.close(); break;
    case 'delete-gift': if (ui.form && ui.form.gift) deleteGift(ui.form.gift); break;
    case 'lang': setLang(b.dataset.lang); break;
    case 'export': exportBackup(); break;
    case 'filter': setFilter(b.dataset.occ); break;
    case 'add-occasion': openOccasionSheet(); break;
    case 'remove-occasion': removeOccasion(b.dataset.occ); break;
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'gift-form') submitGift(e.target);
  else if (e.target.id === 'person-form') submitPerson(e.target);
  else if (e.target.id === 'occasion-form') submitOccasion(e.target);
});

document.addEventListener('input', e => {
  if (e.target.name === 'text' && $('#text-error')) $('#text-error').hidden = true;
  if (e.target.name === 'name' && $('#name-error')) $('#name-error').hidden = true;
  if (e.target.name === 'name' && $('#occasion-error')) $('#occasion-error').hidden = true;
});

document.addEventListener('change', e => {
  if (e.target.id === 'occasion-select' && ui.form) {
    if (e.target.value === NEW_OCCASION) {
      e.target.value = ui.form.occasion;
      openOccasionSheet();
    } else {
      ui.form.occasion = e.target.value;
    }
    return;
  }
  if (e.target.id === 'import-file') {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  }
});

/* ---------- Start ---------- */
(async () => {
  app.innerHTML = `<p class="hint">${tr('loading')}</p>`;
  try {
    db = await openDb();
    const [savedPeople, savedGifts, thumbs] = await Promise.all([request('people', 'getAll'), request('gifts', 'getAll'), allEntries('thumbs')]);
    people = savedPeople;
    gifts = savedGifts.map(g => Object.assign({}, g, { occasion: cleanOccasion(g.occasion) }));
    thumbs.forEach((blob, id) => setThumb(id, blob));
  } catch (e) {
    db = null;
    app.innerHTML = `<p class="hint">${tr('storageError')}</p>`;
    return;
  }
  render();
})();

/* ---------- Offline support ---------- */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
