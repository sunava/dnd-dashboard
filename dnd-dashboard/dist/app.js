/* ====== D&D Dashboard – Frontend-Logik ====== */
'use strict';

let state = {};
let role = 'player'; // wird beim Start aus der Supabase-Session bestimmt
const channels = [];
let editing = false;
let pendingPayloads = [];
const saveTimers = {};

/* ---------- kleine Helfer ---------- */
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const $ = (id) => document.getElementById(id);
const genId = () => '_' + Math.random().toString(36).slice(2, 9);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const PLAYER_WRITABLE = new Set(['players', 'initiative', 'quickNotes', 'tracker', 'npcs', 'history']);
function canEdit(section) {
  if (role === 'dm') return true;
  return PLAYER_WRITABLE.has(section);
}

function openLightbox(url, caption) {
  const bg = el('div', { class: 'lightbox' });
  bg.append(
    el('div', { class: 'lb-hint' }, 'Klick oder Esc zum Schließen'),
    el('img', { src: url, alt: caption || '' }),
    caption ? el('div', { class: 'lb-cap' }, caption) : null,
  );
  const onkey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { bg.remove(); document.removeEventListener('keydown', onkey); };
  bg.addEventListener('click', close);
  document.addEventListener('keydown', onkey);
  document.body.append(bg);
}
function openMapLightbox(m) {
  if (!m || !m.image) return;
  const bg = el('div', { class: 'lightbox' });
  const onkey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { bg.remove(); document.removeEventListener('keydown', onkey); };
  const stage = el('div', { class: 'map-stage' });
  stage.append(el('img', { src: m.image, alt: 'Karte' }));
  (m.markers || []).forEach((mk) => {
    const pin = el('div', { class: 'marker', style: `left:${mk.x}%;top:${mk.y}%`, title: mk.label }, '📍',
      el('div', { class: 'lbl' }, mk.label + (mk.note ? ' — ' + mk.note : '')));
    pin.addEventListener('click', (e) => { e.stopPropagation(); toast(mk.label + (mk.note ? ': ' + mk.note : '')); });
    stage.append(pin);
  });
  stage.addEventListener('click', (e) => e.stopPropagation());
  bg.append(el('div', { class: 'lb-hint' }, 'Klick außerhalb oder Esc zum Schließen'), stage);
  bg.addEventListener('click', close);
  document.addEventListener('keydown', onkey);
  document.body.append(bg);
}
// Globaler Klick: jedes Bild mit data-full öffnet sich groß
document.addEventListener('click', (e) => {
  const im = e.target.closest && e.target.closest('img[data-full]');
  if (im) { e.stopPropagation(); openLightbox(im.getAttribute('data-full'), im.getAttribute('data-cap') || ''); }
});

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- API (Supabase) ---------- */
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

function scheduleSave(section) {
  clearTimeout(saveTimers[section]);
  saveTimers[section] = setTimeout(() => put(section), 350);
}
const DM_ONLY = new Set(['secrets', 'library']); // nur in der Geheim-Tabelle kv_dm
async function up(table, key, data) {
  const { error } = await sb.from(table).upsert({ key, data: data ?? null, updated_at: new Date().toISOString() });
  if (error) { toast('Speichern fehlgeschlagen'); console.error(table, key, error); }
}
async function put(section) {
  if (!canEdit(section)) { toast('Keine Berechtigung'); return; }
  try {
    if (DM_ONLY.has(section)) {
      await up('kv_dm', section, state[section]);
    } else if (section === 'boss') {
      const { dmNotes, ...pub } = state.boss || {};
      await up('kv', 'boss', pub);
      await up('kv_dm', 'bossDm', { dmNotes: dmNotes || '' });
    } else {
      await up('kv', section, state[section]);
    }
  } catch (e) { toast('Speichern fehlgeschlagen'); console.error(e); }
}
async function uploadFile(file) {
  try {
    const name = Date.now() + '_' + (file.name || 'bild.png').replace(/[^\w.\-]/g, '_');
    const { error } = await sb.storage.from('uploads').upload(name, file, { contentType: file.type || undefined });
    if (error) { toast('Upload fehlgeschlagen'); console.error(error); return null; }
    return sb.storage.from('uploads').getPublicUrl(name).data.publicUrl;
  } catch (e) { toast('Upload fehlgeschlagen'); console.error(e); return null; }
}

/* ---------- Eingabe-Bausteine ---------- */
function txt(value, editable, oncommit, ph) {
  if (!editable) return el('span', {}, value || '');
  const i = el('input', { type: 'text', value: value || '', placeholder: ph || '' });
  i.addEventListener('change', () => oncommit(i.value));
  return i;
}
function area(value, editable, oncommit, ph) {
  const t = el('textarea', { placeholder: ph || '' });
  t.value = value || '';
  t.disabled = !editable;
  if (editable) t.addEventListener('input', () => oncommit(t.value));
  return t;
}
function stepper(value, editable, oncommit, step = 1) {
  if (!editable) return el('span', { class: 'val' }, value);
  return el('span', { class: 'row' },
    el('button', { class: 'btn-sm', onclick: () => oncommit(value - step) }, '−'),
    el('span', { class: 'val', style: 'min-width:2.2em;text-align:center' }, value),
    el('button', { class: 'btn-sm', onclick: () => oncommit(value + step) }, '+'),
  );
}

/* ---------- Render-Dispatcher ---------- */
function renderAll() {
  // Header
  const ti = $('camp-title'), su = $('camp-subtitle');
  ti.value = state.campaign?.title || '';
  su.value = state.campaign?.subtitle || '';
  ti.disabled = su.disabled = role !== 'dm';
  $('role-label').textContent = role === 'dm' ? 'DM' : 'Mitspieler';
  $('dm-btn').textContent = role === 'dm' ? 'DM abmelden' : 'DM-Modus';
  $('panel-secrets').hidden = role !== 'dm';
  $('panel-library').hidden = role !== 'dm';

  renderRecap();
  renderQuests();
  renderResources();
  renderFactions();
  renderNpcs();
  renderTracker();
  renderMap();
  renderSessions();
  renderBoss();
  renderSecrets();
  renderLibrary();
}

function addRow(section, placeholder, onAdd) {
  if (!canEdit(section)) return null;
  const inp = el('input', { type: 'text', placeholder });
  const go = () => { const v = inp.value.trim(); if (v) { onAdd(v); inp.value = ''; } };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return el('div', { class: 'add-row' }, inp, el('button', { class: 'btn-sm btn-gold', onclick: go }, '+ Hinzufügen'));
}
function delBtn(section, onDel) {
  if (!canEdit(section)) return null;
  return el('button', { class: 'btn-sm btn-danger right', title: 'Entfernen', onclick: onDel }, '✕');
}

/* ---------- Ressourcen ---------- */
function renderResources() {
  const ed = canEdit('resources');
  const box = $('p-resources'); box.innerHTML = '';
  const grid = el('div', { class: 'res-grid' });
  (state.resources || []).forEach((r) => {
    grid.append(el('div', { class: 'res' },
      ed ? txt(r.icon, true, (v) => { r.icon = v; scheduleSave('resources'); }, '🌙')
         : el('div', { class: 'ico' }, r.icon || '◆'),
      ed ? txt(r.name, true, (v) => { r.name = v; scheduleSave('resources'); })
         : el('div', { class: 'nm' }, r.name),
      el('div', { class: 'ctl' }, stepper(r.current, ed, (v) => { r.current = clamp(v, 0, 999); scheduleSave('resources'); renderResources(); })),
      el('div', { class: 'nm' }, '/ ',
        ed ? (() => { const i = el('input', { type: 'number', value: r.max, style: 'width:3.2em;display:inline-block' });
                      i.addEventListener('change', () => { r.max = +i.value || 0; scheduleSave('resources'); }); return i; })()
           : String(r.max)),
      ed ? delBtn('resources', () => { state.resources = state.resources.filter((x) => x !== r); scheduleSave('resources'); renderResources(); }) : null,
    ));
  });
  box.append(grid);
  const ar = addRow('resources', 'Neue Ressource…', (v) => { state.resources.push({ id: genId(), name: v, icon: '◆', current: 0, max: 5 }); scheduleSave('resources'); renderResources(); });
  if (ar) box.append(ar);
}

/* ---------- Fraktionen ---------- */
function renderFactions() {
  const ed = canEdit('factions');
  const box = $('p-factions'); box.innerHTML = '';
  (state.factions || []).forEach((f) => {
    const pct = (Math.abs(f.rep) / 3) * 50;
    box.append(el('div', { class: 'faction' },
      el('div', { class: 'top' },
        ed ? txt(f.name, true, (v) => { f.name = v; scheduleSave('factions'); }) : el('span', {}, f.name),
        el('span', { class: 'row' },
          el('span', { class: 'muted' }, (f.rep > 0 ? '+' : '') + f.rep),
          ed ? el('span', { class: 'rep-ctl' },
            el('button', { class: 'btn-sm', onclick: () => { f.rep = clamp(f.rep - 1, -3, 3); scheduleSave('factions'); renderFactions(); } }, '−'),
            el('button', { class: 'btn-sm', onclick: () => { f.rep = clamp(f.rep + 1, -3, 3); scheduleSave('factions'); renderFactions(); } }, '+'),
          ) : null,
          ed ? delBtn('factions', () => { state.factions = state.factions.filter((x) => x !== f); scheduleSave('factions'); renderFactions(); }) : null,
        ),
      ),
      el('div', { class: 'repbar' },
        el('div', { class: 'mid' }),
        el('div', { class: 'fill ' + (f.rep >= 0 ? 'pos' : 'neg'), style: `width:${pct}%` }),
      ),
    ));
  });
  const ar = addRow('factions', 'Neue Fraktion…', (v) => { state.factions.push({ id: genId(), name: v, rep: 0 }); scheduleSave('factions'); renderFactions(); });
  if (ar) box.append(ar);
}

/* ---------- NPCs ---------- */
function npcQuickAdd() {
  const name = el('input', { type: 'text', placeholder: 'Name', id: 'npc-quick-name' });
  const roleI = el('input', { type: 'text', placeholder: 'Rolle (optional)', style: 'max-width:45%' });
  const add = () => {
    const v = name.value.trim();
    if (!v) { name.focus(); return; }
    state.npcs.push({ id: genId(), name: v, role: roleI.value.trim(), desc: '', secretNote: '', hidden: false, img: '' });
    scheduleSave('npcs');
    name.value = ''; roleI.value = '';
    renderNpcs();
    const f = document.getElementById('npc-quick-name'); if (f) f.focus();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  roleI.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return el('div', { class: 'add-row', style: 'margin:0 0 10px' },
    name, roleI, el('button', { class: 'btn-sm btn-gold', onclick: add }, '+ NPC'));
}

function renderNpcs() {
  const ed = canEdit('npcs');
  const box = $('p-npcs'); box.innerHTML = '';
  if (ed) box.append(npcQuickAdd());
  (state.npcs || []).forEach((n) => {
    const card = el('div', { class: 'npc' });
    card.append(el('div', { class: 'row' },
      ed ? txt(n.name, true, (v) => { n.name = v; scheduleSave('npcs'); }, 'Name') : el('span', { class: 'nm' }, n.name),
      delBtn('npcs', () => { state.npcs = state.npcs.filter((x) => x !== n); scheduleSave('npcs'); renderNpcs(); }),
    ));
    card.append(ed ? txt(n.role, true, (v) => { n.role = v; scheduleSave('npcs'); }, 'Rolle') : el('div', { class: 'role' }, n.role));
    if (n.img) card.append(el('img', { src: n.img, alt: n.name || 'NPC', class: 'npc-img', 'data-full': n.img, 'data-cap': n.name || '' }));
    if (ed) {
      const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      file.addEventListener('change', async () => { if (file.files[0]) { const u = await uploadFile(file.files[0]); if (u) { n.img = u; scheduleSave('npcs'); renderNpcs(); } } });
      card.append(file, el('div', { class: 'list-actions', style: 'justify-content:flex-start' },
        el('button', { class: 'btn-sm', onclick: () => file.click() }, n.img ? 'Bild ersetzen' : '🖼 Profilbild'),
        n.img ? el('button', { class: 'btn-sm btn-danger', onclick: () => { n.img = ''; scheduleSave('npcs'); renderNpcs(); } }, 'entfernen') : null,
      ));
    }
    card.append(ed ? area(n.desc, true, (v) => { n.desc = v; scheduleSave('npcs'); }, 'Beschreibung') : el('div', {}, n.desc));
    box.append(card);
  });
}

/* ---------- Tracker ---------- */
function renderTracker() {
  const ed = canEdit('tracker');
  const box = $('p-tracker'); box.innerHTML = '';
  (state.tracker || []).forEach((t) => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = !!t.done; cb.disabled = !ed;
    cb.addEventListener('change', () => { t.done = cb.checked; scheduleSave('tracker'); renderTracker(); });
    box.append(el('div', { class: 'track-item' + (t.done ? ' done' : '') },
      cb,
      ed ? (() => { const i = el('input', { type: 'text', value: t.text, class: 'track-text' });
                    i.addEventListener('change', () => { t.text = i.value; scheduleSave('tracker'); }); return i; })()
         : el('span', { class: 'track-text' }, t.text),
      ed ? delBtn('tracker', () => { state.tracker = state.tracker.filter((x) => x !== t); scheduleSave('tracker'); renderTracker(); }) : null,
    ));
  });
  const ar = addRow('tracker', 'Neues Ziel…', (v) => { state.tracker.push({ id: genId(), text: v, done: false }); scheduleSave('tracker'); renderTracker(); });
  if (ar) box.append(ar);
}

/* ---------- Karte ---------- */
function renderMap() {
  const ed = canEdit('map');
  const m = state.map || (state.map = { image: '', markers: [] });
  const box = $('p-map'); box.innerHTML = '';
  const wrap = el('div', { class: 'map-wrap' });
  if (m.image) {
    const img = el('img', { src: m.image, alt: 'Karte' });
    wrap.append(img);
    if (ed) {
      wrap.style.cursor = 'crosshair';
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('.marker')) return;
        const rect = wrap.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        const label = prompt('Markierung – Bezeichnung:');
        if (!label) return;
        const note = prompt('Notiz (optional):') || '';
        m.markers.push({ id: genId(), x, y, label, note });
        scheduleSave('map'); renderMap();
      });
    }
    (m.markers || []).forEach((mk) => {
      const pin = el('div', { class: 'marker', style: `left:${mk.x}%;top:${mk.y}%` }, '📍',
        el('div', { class: 'lbl' }, mk.label + (mk.note ? ' — ' + mk.note : '')));
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ed) {
          const nl = prompt('Bezeichnung (leer = löschen):', mk.label);
          if (nl === null) return;
          if (nl === '') { m.markers = m.markers.filter((x) => x !== mk); }
          else { mk.label = nl; mk.note = prompt('Notiz:', mk.note) || ''; }
          scheduleSave('map'); renderMap();
        } else {
          toast(mk.label + (mk.note ? ': ' + mk.note : ''));
        }
      });
      wrap.append(pin);
    });
    if (!ed) {
      wrap.style.cursor = 'zoom-in';
      wrap.addEventListener('click', (e) => { if (!(e.target.closest && e.target.closest('.marker'))) openMapLightbox(m); });
    }
  } else {
    wrap.append(el('div', { class: 'map-empty' }, ed ? 'Noch keine Karte. Lade ein Bild hoch.' : 'Keine Karte vorhanden.'));
  }
  box.append(wrap);
  if (m.image) box.append(el('div', { class: 'list-actions' },
    el('button', { class: 'btn-sm', onclick: () => openMapLightbox(m) }, '🔍 Karte vergrößern')));
  if (ed) {
    const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      const url = await uploadFile(file.files[0]);
      if (url) { m.image = url; scheduleSave('map'); renderMap(); }
    });
    const acts = el('div', { class: 'list-actions' },
      el('button', { class: 'btn-sm', onclick: () => file.click() }, m.image ? 'Karte ersetzen' : 'Karte hochladen'),
      m.image ? el('button', { class: 'btn-sm btn-danger', onclick: () => { m.image = ''; m.markers = []; scheduleSave('map'); renderMap(); } }, 'Entfernen') : null,
    );
    box.append(file, acts);
    if (m.image) {
      box.append(el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, 'Klicke auf die Karte, um eine Markierung zu setzen.'));
      if ((m.markers || []).length) {
        box.append(el('label', { class: 'fld' }, 'Markierungen'));
        m.markers.forEach((mk) => {
          box.append(el('div', { class: 'row', style: 'margin:2px 0' },
            el('span', { style: 'flex:1' }, '📍 ' + mk.label + (mk.note ? ' — ' + mk.note : '')),
            el('button', { class: 'btn-sm', title: 'umbenennen', onclick: () => {
              const nl = prompt('Bezeichnung:', mk.label); if (nl == null) return;
              mk.label = nl; mk.note = prompt('Notiz:', mk.note || '') || ''; scheduleSave('map'); renderMap();
            } }, '✎'),
            el('button', { class: 'btn-sm btn-danger', title: 'löschen', onclick: () => {
              m.markers = m.markers.filter((x) => x !== mk); scheduleSave('map'); renderMap();
            } }, '✕'),
          ));
        });
      }
    }
  }
}

/* ---------- Sitzungen ---------- */
const openSessions = new Set();
function renderSessions() {
  const ed = canEdit('sessions');
  const box = $('p-sessions'); if (!box) return; box.innerHTML = '';
  (state.sessions || []).slice().reverse().forEach((s) => {
    const open = openSessions.has(s.id);
    const card = el('div', { class: 'sess' });
    const header = el('div', { class: 'sess-head row', onclick: (e) => {
        if (e.target.closest('button,input')) return;
        if (open) openSessions.delete(s.id); else openSessions.add(s.id);
        renderSessions();
      } },
      el('span', { class: 'tw' }, open ? '▾' : '▸'),
      ed ? (() => { const i = el('input', { type: 'text', value: s.date, style: 'width:7em' });
                    i.addEventListener('change', () => { s.date = i.value; scheduleSave('sessions'); }); return i; })()
         : el('span', { class: 'muted' }, s.date),
      ed ? txt(s.title, true, (v) => { s.title = v; scheduleSave('sessions'); }, 'Titel') : el('span', { class: 'nm' }, s.title),
      ed ? delBtn('sessions', () => { state.sessions = state.sessions.filter((x) => x !== s); openSessions.delete(s.id); scheduleSave('sessions'); renderSessions(); }) : null,
    );
    card.append(header);
    if (open) card.append(ed ? area(s.text, true, (v) => { s.text = v; scheduleSave('sessions'); }) : el('div', { class: 'md-preview', html: mdToHtml(s.text) }));
    box.append(card);
  });
  const ar = addRow('sessions', 'Neue Sitzung – Titel…', (v) => {
    const d = new Date();
    const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const id = genId();
    state.sessions.push({ id, date, title: v, text: '' });
    openSessions.add(id);
    scheduleSave('sessions'); renderSessions();
  });
  if (ar) box.append(ar);
}

/* ---------- Boss ---------- */
function renderBoss() {
  const ed = canEdit('boss');
  const b = state.boss || (state.boss = {});
  const box = $('p-boss'); box.innerHTML = '';
  // Bild (für alle sichtbar)
  if (b.img) box.append(el('img', { src: b.img, alt: 'Boss', 'data-full': b.img, 'data-cap': '', style: 'width:100%;border-radius:5px;border:1px solid var(--line);margin-bottom:8px' }));
  if (ed) {
    const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    file.addEventListener('change', async () => { if (!file.files[0]) return; const url = await uploadFile(file.files[0]); if (url) { b.img = url; scheduleSave('boss'); renderBoss(); } });
    box.append(file, el('div', { class: 'list-actions' },
      el('button', { class: 'btn-sm', onclick: () => file.click() }, b.img ? 'Bild ersetzen' : 'Bild hinzufügen'),
      b.img ? el('button', { class: 'btn-sm btn-danger', onclick: () => { b.img = ''; scheduleSave('boss'); renderBoss(); } }, 'Bild entfernen') : null,
    ));
  }
  // Spielernotiz (für alle sichtbar)
  box.append(el('label', { class: 'fld' }, 'Notiz (für alle sichtbar)'));
  if (ed) box.append(area(b.playerNote, true, (v) => { b.playerNote = v; scheduleSave('boss'); }, 'Für alle sichtbar…'));
  else box.append(el('div', { class: 'md-preview', html: mdToHtml(b.playerNote || '—') }));
  // DM-Notiz (nur DM)
  if (role === 'dm') {
    box.append(el('label', { class: 'fld' }, 'DM-Notiz (geheim)'));
    box.append(area(b.dmNotes, true, (v) => { b.dmNotes = v; scheduleSave('boss'); }, 'nur für DM'));
  }
}

/* ---------- Initiative ---------- */
function renderInitiative() {
  const ed = canEdit('initiative');
  const ini = state.initiative || (state.initiative = { round: 1, active: 0, combatants: [] });
  const box = $('p-initiative'); if (!box) return; box.innerHTML = '';
  const order = ini.combatants.slice().sort((a, b) => b.init - a.init);

  const head = el('div', { class: 'init-head' }, el('span', { class: 'round' }, 'Runde ' + (ini.round || 1)));
  if (ed) {
    head.append(
      el('button', { class: 'btn-sm', onclick: () => { ini.active = Math.max(0, (ini.active || 0) - 1); scheduleSave('initiative'); renderInitiative(); } }, '◀'),
      el('button', { class: 'btn-sm btn-gold', onclick: () => {
        ini.active = (ini.active || 0) + 1;
        if (ini.active >= order.length) { ini.active = 0; ini.round = (ini.round || 1) + 1; }
        scheduleSave('initiative'); renderInitiative();
      } }, 'Nächster ▶'),
      el('button', { class: 'btn-sm', onclick: () => { ini.round = 1; ini.active = 0; scheduleSave('initiative'); renderInitiative(); } }, '⟲'),
    );
  }
  box.append(head);

  order.forEach((c, i) => {
    const hp = clamp(c.hp ?? 0, 0, c.maxhp || 1);
    box.append(el('div', { class: 'init-row' + (i === (ini.active || 0) ? ' active' : '') + (c.enemy ? ' enemy' : '') },
      el('span', { class: 'init-init' }, c.init),
      ed ? (() => { const n = el('input', { type: 'text', value: c.name, class: 'init-name' });
                    n.addEventListener('change', () => { c.name = n.value; scheduleSave('initiative'); }); return n; })()
         : el('span', { class: 'init-name' }, c.name),
      el('span', { class: 'init-hp row' },
        ed ? el('button', { class: 'btn-sm', onclick: () => { c.hp = clamp((c.hp || 0) - 1, 0, c.maxhp || 999); scheduleSave('initiative'); renderInitiative(); } }, '−') : null,
        el('span', { class: 'muted' }, `${hp}/${c.maxhp || '?'}`),
        ed ? el('button', { class: 'btn-sm', onclick: () => { c.hp = clamp((c.hp || 0) + 1, 0, c.maxhp || 999); scheduleSave('initiative'); renderInitiative(); } }, '+') : null,
      ),
      ed ? delBtn('initiative', () => { ini.combatants = ini.combatants.filter((x) => x !== c); scheduleSave('initiative'); renderInitiative(); }) : null,
    ));
  });

  if (ed) {
    const name = el('input', { type: 'text', placeholder: 'Name' });
    const init = el('input', { type: 'number', placeholder: 'Init', style: 'width:4.5em' });
    const hpv = el('input', { type: 'number', placeholder: 'TP', style: 'width:4.5em' });
    const enemy = el('input', { type: 'checkbox' });
    const go = () => {
      if (!name.value.trim()) return;
      ini.combatants.push({ id: genId(), name: name.value.trim(), init: +init.value || 0, hp: +hpv.value || 0, maxhp: +hpv.value || 0, enemy: enemy.checked });
      scheduleSave('initiative'); renderInitiative();
    };
    box.append(el('div', { class: 'add-row' }, name, init, hpv,
      el('label', { class: 'row', style: 'font-size:12px' }, enemy, 'Gegner'),
      el('button', { class: 'btn-sm btn-gold', onclick: go }, '+')));
  }
}

/* ---------- Was bisher geschah (Erzählertext) ---------- */
function renderRecap() {
  const ed = canEdit('recap');
  if (state.recap == null) state.recap = '';
  const box = $('p-recap'); box.innerHTML = '';
  const collapsed = localStorage.getItem('recapCollapsed') === '1';

  box.append(el('button', { class: 'btn-sm', onclick: () => {
    localStorage.setItem('recapCollapsed', collapsed ? '0' : '1'); renderRecap();
  } }, collapsed ? '▸ aufklappen' : '▾ einklappen'));

  if (collapsed) return;
  if (ed) {
    box.append(area(state.recap, true, (v) => { state.recap = v; scheduleSave('recap'); }, 'Erzählertext / Was bisher geschah…'));
  } else {
    box.append(el('div', { class: 'recap-text' }, state.recap || '—'));
  }
}

/* ---------- Quests ---------- */
function addToQuest(field, text) {
  const q = (state.quests = state.quests || { main: '', side: '' });
  const bullet = '- ' + (text || '').replace(/\s+/g, ' ').trim();
  const cur = (q[field] || '').replace(/\s+$/, '');
  q[field] = cur ? cur + '\n' + bullet : bullet;
  put('quests'); renderQuests();
}
function renderQuests() {
  const ed = canEdit('quests');
  const q = state.quests || (state.quests = { main: '', side: '' });
  const box = $('p-quests'); box.innerHTML = '';
  box.append(el('label', { class: 'fld' }, '⚔ Hauptquest'));
  if (ed) box.append(area(q.main, true, (v) => { q.main = v; scheduleSave('quests'); }, 'Hauptquest…'));
  else box.append(el('div', { class: 'md-preview', html: mdToHtml(q.main || '—') }));
  box.append(el('label', { class: 'fld' }, '✦ Nebenquest'));
  if (ed) box.append(area(q.side, true, (v) => { q.side = v; scheduleSave('quests'); }, 'Nebenquest…'));
  else box.append(el('div', { class: 'md-preview', html: mdToHtml(q.side || '—') }));
}

/* ---------- Schnellnotizen ---------- */
function renderQuickNotes() {
  const ed = canEdit('quickNotes');
  const box = $('p-quickNotes'); if (!box) return; box.innerHTML = '';
  box.append(area(state.quickNotes, ed, (v) => { state.quickNotes = v; scheduleSave('quickNotes'); }, 'Schnelle Notizen…'));
}

/* ---------- Geheimnisse (DM) ---------- */
function renderSecrets() {
  if (role !== 'dm') return;
  const box = $('p-secrets'); box.innerHTML = '';
  (state.secrets || []).forEach((s) => {
    box.append(el('div', { class: 'secret row' },
      (() => { const i = el('input', { type: 'text', value: s.text });
               i.addEventListener('change', () => { s.text = i.value; scheduleSave('secrets'); }); return i; })(),
      delBtn('secrets', () => { state.secrets = state.secrets.filter((x) => x !== s); scheduleSave('secrets'); renderSecrets(); }),
    ));
  });
  const ar = addRow('secrets', 'Neues Geheimnis…', (v) => { (state.secrets = state.secrets || []).push({ id: genId(), text: v }); scheduleSave('secrets'); renderSecrets(); });
  if (ar) box.append(ar);
}

/* ---------- Markdown (mini) ---------- */
function mdToHtml(src) {
  let s = (src || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, a, u) => `<img src="${u}" alt="${a}" data-full="${u}" data-cap="${a}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/^###\s+(.*)$/gm, '<h4>$1</h4>');
  s = s.replace(/^##\s+(.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^#\s+(.*)$/gm, '<h2>$1</h2>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/(?:^|\n)(- .*(?:\n- .*)*)/g, (m, blk) =>
    '\n<ul>' + blk.split('\n').map((l) => '<li>' + l.replace(/^- /, '') + '</li>').join('') + '</ul>');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/(<\/(?:h2|h3|h4|ul|li)>)<br>/g, '$1');
  return s;
}

/* ---------- Bibliothek (DM-Notizbuch mit Ordnern & Seiten) ---------- */
let selectedPageId = localStorage.getItem('libSel') || null;
let libRefocus = false;

function mkPage(title) { return { id: genId(), type: 'page', title: title || 'Seite', body: '', images: [] }; }
function mkFolder(title) { return { id: genId(), type: 'folder', title: title || 'Ordner', open: true, children: [] }; }
function libWalk(nodes, fn, parent) {
  (nodes || []).forEach((n) => { fn(n, parent, nodes); if (n.children) libWalk(n.children, fn, n); });
}
function libFind(id) { let r = null; libWalk(state.library, (n) => { if (n.id === id) r = n; }); return r; }
function libSiblings(id) { let r = state.library; libWalk(state.library, (n, p, list) => { if (n.id === id) r = list; }); return r; }
function libMove(n, dir) {
  const list = libSiblings(n.id); const i = list.indexOf(n); const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  list.splice(i, 1); list.splice(j, 0, n); scheduleSave('library'); renderLibrary();
}
function libDelete(n) {
  const list = libSiblings(n.id); const i = list.indexOf(n); if (i >= 0) list.splice(i, 1);
  if (selectedPageId === n.id) selectedPageId = null;
  scheduleSave('library'); renderLibrary();
}
function iconBtn(label, title, onclick) {
  return el('button', { class: 'btn-sm icon-btn', title, onclick: (e) => { e.stopPropagation(); onclick(); } }, label);
}

function renderLibrary() {
  if (role !== 'dm') return;
  const box = $('p-library'); if (!box) return;
  box.innerHTML = '';
  state.library = state.library || [];

  box.append(el('div', { class: 'list-actions', style: 'justify-content:flex-start' },
    el('button', { class: 'btn-sm', onclick: () => { const t = prompt('Ordnername:'); if (t) { state.library.push(mkFolder(t)); scheduleSave('library'); renderLibrary(); } } }, '＋📁 Ordner'),
    el('button', { class: 'btn-sm', onclick: () => { const t = prompt('Seitenname:'); if (t) { const p = mkPage(t); state.library.push(p); selectedPageId = p.id; localStorage.setItem('libSel', p.id); scheduleSave('library'); renderLibrary(); } } }, '＋📄 Seite'),
  ));

  const tree = el('div', { class: 'tree' });
  if (!state.library.length) tree.append(el('div', { class: 'muted' }, 'Noch leer. Lege oben einen Ordner oder eine Seite an.'));
  else renderTreeNodes(state.library, tree, 0);
  box.append(tree);

  box.append(renderPageEditor());

  if (libRefocus) {
    libRefocus = false;
    const f = document.getElementById('lib-body-ta');
    if (f) { f.focus(); f.selectionStart = f.selectionEnd = f.value.length; }
  }
}

function renderTreeNodes(nodes, container, depth) {
  nodes.forEach((n) => {
    const row = el('div', { class: 'tree-row' + (n.type === 'page' && n.id === selectedPageId ? ' sel' : ''), style: `padding-left:${6 + depth * 16}px` });
    if (n.type === 'folder') {
      const toggle = () => { n.open = !n.open; scheduleSave('library'); renderLibrary(); };
      row.append(el('span', { class: 'tw', onclick: toggle }, n.open ? '▾' : '▸'));
      row.append(el('span', { class: 'tname tfolder', onclick: toggle }, '📁 ' + n.title));
    } else {
      row.append(el('span', { class: 'tw' }, '·'));
      row.append(el('span', { class: 'tname', onclick: () => { selectedPageId = n.id; localStorage.setItem('libSel', n.id); renderLibrary(); } }, '📄 ' + n.title));
    }
    const acts = el('span', { class: 'tree-acts' });
    if (n.type === 'folder') {
      acts.append(iconBtn('＋📄', 'Seite hinein', () => { const t = prompt('Seitenname:'); if (t) { (n.children = n.children || []).push(mkPage(t)); n.open = true; scheduleSave('library'); renderLibrary(); } }));
      acts.append(iconBtn('＋📁', 'Unterordner', () => { const t = prompt('Ordnername:'); if (t) { (n.children = n.children || []).push(mkFolder(t)); n.open = true; scheduleSave('library'); renderLibrary(); } }));
    }
    acts.append(iconBtn('✎', 'Umbenennen', () => { const t = prompt('Name:', n.title); if (t != null && t !== '') { n.title = t; scheduleSave('library'); renderLibrary(); } }));
    acts.append(iconBtn('↑', 'nach oben', () => libMove(n, -1)));
    acts.append(iconBtn('↓', 'nach unten', () => libMove(n, 1)));
    acts.append(iconBtn('🗑', 'Löschen', () => { if (confirm('„' + n.title + '" löschen?')) libDelete(n); }));
    row.append(acts);
    container.append(row);
    if (n.type === 'folder' && n.open && n.children) renderTreeNodes(n.children, container, depth + 1);
  });
}

function renderPageEditor() {
  const wrap = el('div', { class: 'page-editor' });
  const p = selectedPageId ? libFind(selectedPageId) : null;
  if (!p || p.type !== 'page') {
    wrap.append(el('div', { class: 'muted', style: 'margin-top:10px' }, 'Wähle links eine Seite zum Bearbeiten.'));
    return wrap;
  }
  p.images = p.images || [];

  const title = el('input', { type: 'text', value: p.title, placeholder: 'Seitentitel', style: 'font-family:Cinzel;color:var(--gold-bright);margin-top:10px' });
  title.addEventListener('change', () => { p.title = title.value; scheduleSave('library'); renderLibrary(); });
  wrap.append(title);

  const insertImage = (url) => {
    p.images.push({ id: genId(), url, caption: '' });
    p.body = (p.body || '') + `\n![](${url})\n`;
    libRefocus = true; scheduleSave('library'); renderLibrary();
  };
  const file = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  file.addEventListener('change', async () => { if (file.files[0]) { const u = await uploadFile(file.files[0]); if (u) insertImage(u); } });

  wrap.append(el('div', { class: 'list-actions', style: 'justify-content:flex-start;flex-wrap:wrap' },
    el('button', { class: 'btn-sm btn-gold', onclick: () => { p.body = ta.value; put('library'); toast('Gespeichert'); } }, '💾 Speichern'),
    el('button', { class: 'btn-sm', onclick: () => file.click() }, '🖼 Bild'),
    el('button', { class: 'btn-sm', onclick: () => publishPage(p) }, '📜 Als Sitzungsnotiz'),
    el('button', { class: 'btn-sm', onclick: () => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const part = ((s != null && e > s) ? ta.value.slice(s, e) : ta.value).trim();
      if (!part) { toast('Nichts markiert'); return; }
      p.body = ta.value; addToQuest('main', part); toast('+ Hauptquest');
    } }, '⚔ + Hauptquest'),
    el('button', { class: 'btn-sm', onclick: () => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const part = ((s != null && e > s) ? ta.value.slice(s, e) : ta.value).trim();
      if (!part) { toast('Nichts markiert'); return; }
      p.body = ta.value; addToQuest('side', part); toast('+ Nebenquest');
    } }, '✦ + Nebenquest'),
    el('span', { class: 'muted', style: 'font-size:12px' }, 'Quest-Teil markieren, dann Knopf (wird als Bullet angehängt) · Strg+V fügt Bild ein'),
  ), file);

  const prev = el('div', { class: 'md-preview' });
  const upd = () => { prev.innerHTML = mdToHtml(p.body); };
  const ta = el('textarea', { id: 'lib-body-ta', style: 'min-height:170px', placeholder: '# Überschrift\n\nText…' });
  ta.value = p.body || '';
  ta.addEventListener('input', () => { p.body = ta.value; scheduleSave('library'); upd(); });
  ta.addEventListener('change', () => { p.body = ta.value; put('library'); }); // beim Rausklicken sofort speichern
  ta.addEventListener('paste', async (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) { e.preventDefault(); const u = await uploadFile(it.getAsFile()); if (u) { p.body = ta.value; insertImage(u); } return; }
    }
  });
  wrap.append(ta, el('label', { class: 'fld' }, 'Vorschau'), prev);
  upd();

  if (p.images.length) {
    wrap.append(el('label', { class: 'fld' }, 'Bilder dieser Seite'));
    const gal = el('div', { class: 'gallery' });
    p.images.forEach((im) => {
      const cap = el('input', { type: 'text', value: im.caption || '', placeholder: 'Bildunterschrift' });
      cap.addEventListener('change', () => { im.caption = cap.value; scheduleSave('library'); });
      gal.append(el('div', { class: 'gal-item' },
        el('img', { src: im.url, alt: '', 'data-full': im.url, 'data-cap': im.caption || '' }),
        cap,
        el('button', { class: 'btn-sm btn-danger', onclick: () => { p.images = p.images.filter((x) => x !== im); scheduleSave('library'); renderLibrary(); } }, '✕'),
      ));
    });
    wrap.append(gal);
  }
  return wrap;
}

/* ---------- Spieler-Journal (veröffentlichte Einträge) ---------- */
function nowStr() {
  try { return new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
}
function publishPage(p) {
  // Veröffentlicht die Seite als Sitzungsnotiz (für alle Spieler sichtbar).
  state.sessions = state.sessions || [];
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  state.sessions.push({ id: genId(), date, title: p.title, text: p.body || '' });
  scheduleSave('sessions'); renderSessions(); toast('Als Sitzungsnotiz erstellt');
}
function publishImage(im, title) {
  state.history = state.history || [];
  const order = state.history.reduce((m, e) => Math.max(m, e.order || 0), 0) + 1;
  state.history.push({ id: genId(), order, ts: nowStr(), title: im.caption || title || 'Bild', body: '', images: [{ id: genId(), url: im.url, caption: im.caption || '' }] });
  scheduleSave('history'); renderHistory(); toast('Bild ins Spieler-Journal gesendet');
}
function renderHistory() {
  const box = $('p-history'); if (!box) return;
  box.innerHTML = '';
  const list = (state.history || []).slice().sort((a, b) => (b.order || 0) - (a.order || 0));
  if (!list.length) {
    box.append(el('div', { class: 'muted' }, role === 'dm'
      ? 'Noch nichts veröffentlicht. Sende eine Seite oder ein Bild aus der Bibliothek hierher.'
      : 'Noch keine Einträge.'));
    return;
  }
  list.forEach((e) => {
    const entry = el('div', { class: 'journal-entry' });
    entry.append(el('div', { class: 'je-head' },
      el('span', { class: 'je-title' }, e.title || 'Eintrag'),
      e.ts ? el('span', { class: 'muted', style: 'font-size:12px' }, e.ts) : null,
      canEdit('history') ? el('button', { class: 'btn-sm btn-danger right', title: 'aus Journal entfernen', onclick: () => { state.history = state.history.filter((x) => x !== e); scheduleSave('history'); renderHistory(); } }, '✕') : null,
    ));
    if (e.body) entry.append(el('div', { class: 'md-preview', html: mdToHtml(e.body) }));
    (e.images || []).forEach((im) => {
      entry.append(el('img', { src: im.url, alt: im.caption || '', 'data-full': im.url, 'data-cap': im.caption || '', style: 'max-width:100%;border-radius:5px;border:1px solid var(--line);margin-top:6px' }));
      if (im.caption) entry.append(el('div', { class: 'cap' }, im.caption));
    });
    box.append(entry);
  });
}

/* ---------- Spielercharaktere ---------- */
function renderPlayers() {
  const ed = canEdit('players');
  const box = $('p-players'); if (!box) return; box.innerHTML = '';
  const grid = el('div', { class: 'pc-grid' });
  (state.players || []).forEach((p) => {
    const hp = clamp(p.hp ?? 0, 0, p.maxhp || 1), max = p.maxhp || 1;
    const card = el('div', { class: 'pc' });
    card.append(el('div', { class: 'row' },
      ed ? txt(p.name, true, (v) => { p.name = v; scheduleSave('players'); }, 'Name') : el('span', { class: 'nm' }, p.name),
      delBtn('players', () => { state.players = state.players.filter((x) => x !== p); scheduleSave('players'); renderPlayers(); }),
    ));
    card.append(ed ? txt(p.cls, true, (v) => { p.cls = v; scheduleSave('players'); }, 'Klasse') : el('div', { class: 'cls' }, p.cls));
    card.append(el('div', { class: 'hpbar' },
      el('div', { class: 'fill', style: `width:${(hp / max) * 100}%` }),
      el('div', { class: 'txt' }, `${hp} / ${max}`)));
    if (ed) {
      card.append(el('div', { class: 'row' },
        el('button', { class: 'btn-sm', onclick: () => { p.hp = clamp((p.hp || 0) - 1, 0, p.maxhp); scheduleSave('players'); renderPlayers(); } }, '−'),
        el('button', { class: 'btn-sm', onclick: () => { p.hp = clamp((p.hp || 0) + 1, 0, p.maxhp); scheduleSave('players'); renderPlayers(); } }, '+'),
        (() => { const i = el('input', { type: 'number', value: max, style: 'width:4.5em' }); i.title = 'Max-TP';
                 i.addEventListener('change', () => { p.maxhp = +i.value || 1; p.hp = clamp(p.hp, 0, p.maxhp); scheduleSave('players'); renderPlayers(); }); return i; })(),
        el('span', { class: 'ac' }, '🛡',
          (() => { const i = el('input', { type: 'number', value: p.ac, style: 'width:3.5em' });
                   i.addEventListener('change', () => { p.ac = +i.value || 0; scheduleSave('players'); }); return i; })()),
      ));
    } else {
      card.append(el('div', { class: 'ac' }, '🛡 RK ' + (p.ac ?? '–')));
    }
    grid.append(card);
  });
  box.append(grid);
  const ar = addRow('players', 'Neuer Charakter…', (v) => { state.players.push({ id: genId(), name: v, cls: '', hp: 10, maxhp: 10, ac: 10 }); scheduleSave('players'); renderPlayers(); });
  if (ar) box.append(ar);
}

/* ---------- Header-Eingaben ---------- */
$('camp-title').addEventListener('change', (e) => { (state.campaign = state.campaign || {}).title = e.target.value; scheduleSave('campaign'); });
$('camp-subtitle').addEventListener('change', (e) => { (state.campaign = state.campaign || {}).subtitle = e.target.value; scheduleSave('campaign'); });

/* ---------- DM-Login ---------- */
$('dm-btn').addEventListener('click', async () => {
  if (role === 'dm') {
    await sb.auth.signOut();
    role = 'player';
    await refresh();
    toast('DM abgemeldet');
    return;
  }
  const bg = el('div', { class: 'modal-bg' });
  const email = el('input', { type: 'email', placeholder: 'DM-E-Mail', autocomplete: 'username' });
  const pw = el('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'current-password' });
  const submit = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
    if (error) { toast('Login fehlgeschlagen'); console.error(error); return; }
    role = 'dm'; bg.remove(); await refresh(); toast('DM-Modus aktiv');
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') pw.focus(); });
  const modal = el('div', { class: 'modal' },
    el('h3', {}, 'DM-Login'),
    el('label', { class: 'fld' }, 'E-Mail'), email,
    el('label', { class: 'fld' }, 'Passwort'), pw,
    el('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' },
      el('button', { onclick: () => bg.remove() }, 'Abbrechen'),
      el('button', { class: 'btn-gold', onclick: submit }, 'Anmelden')));
  bg.append(modal);
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.append(bg);
  email.focus();
});

/* ---------- Verbindung, Auth & Live-Sync (Supabase) ---------- */
function setConn(ok) {
  $('conn-dot').classList.toggle('ok', ok);
  $('conn-text').textContent = ok ? 'live' : 'offline';
}

async function loadState() {
  try {
    const { data: pub, error } = await sb.from('kv').select('key,data');
    if (error) throw error;
    const st = {};
    (pub || []).forEach((r) => { st[r.key] = r.data; });
    if (role === 'dm') {
      const { data: dm, error: e2 } = await sb.from('kv_dm').select('key,data');
      if (e2) throw e2;
      const d = {};
      (dm || []).forEach((r) => { d[r.key] = r.data; });
      st.secrets = d.secrets || [];
      st.library = d.library || [];
      st.boss = { ...(st.boss || {}), dmNotes: (d.bossDm && d.bossDm.dmNotes) || '' };
    }
    state = st;
    setConn(true);
    renderAll();
  } catch (e) { setConn(false); toast('Verbindung fehlgeschlagen'); console.error(e); }
}

// Eingehende Änderungen auf den State anwenden (ohne Render)
function applyKv(payload) {
  const row = payload.new && payload.new.key ? payload.new : payload.old;
  if (!row || !row.key) return;
  const key = row.key;
  if (payload.eventType === 'DELETE') { delete state[key]; return; }
  if (role === 'dm' && key === 'boss') {
    state.boss = { ...(row.data || {}), dmNotes: (state.boss && state.boss.dmNotes) || '' };
    return;
  }
  state[key] = row.data;
}
function applyDm(payload) {
  const row = payload.new && payload.new.key ? payload.new : payload.old;
  if (!row || !row.key) return;
  if (row.key === 'bossDm') state.boss = { ...(state.boss || {}), dmNotes: (row.data && row.data.dmNotes) || '' };
  else state[row.key] = row.data;                                     // secrets, library
}
// Während du tippst (editing) werden Remote-Änderungen NICHT angewendet,
// sondern gepuffert – damit dein Editor-Text nicht ausgetauscht wird.
function onRealtime(which, payload) {
  if (editing) { pendingPayloads.push([which, payload]); return; }
  (which === 'kv' ? applyKv : applyDm)(payload);
  renderAll();
}
function flushPending() {
  if (!pendingPayloads.length) return;
  const q = pendingPayloads; pendingPayloads = [];
  q.forEach(([w, p]) => (w === 'kv' ? applyKv : applyDm)(p));
  renderAll();
}
function subscribeRealtime() {
  const ch = sb.channel('kv-pub')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, (p) => onRealtime('kv', p))
    .subscribe((s) => { if (s === 'SUBSCRIBED') setConn(true); });
  channels.push(ch);
  if (role === 'dm') {
    const ch2 = sb.channel('kv-dm')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kv_dm' }, (p) => onRealtime('dm', p))
      .subscribe();
    channels.push(ch2);
  }
}
function removeChannels() { channels.forEach((c) => sb.removeChannel(c)); channels.length = 0; }
async function refresh() { removeChannels(); await loadState(); subscribeRealtime(); }

document.addEventListener('focusin', (e) => { if (e.target.matches('input,textarea,select')) editing = true; });
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const a = document.activeElement;
    editing = !!(a && a.matches && a.matches('input,textarea,select'));
    if (!editing) flushPending();
  }, 50);
});

// Start: Rolle aus bestehender Session bestimmen, dann laden + Live-Sync
(async () => {
  const { data } = await sb.auth.getSession();
  role = data.session ? 'dm' : 'player';
  await refresh();
})();
sb.auth.onAuthStateChange((event, session) => {
  const newRole = session ? 'dm' : 'player';
  if (newRole !== role) { role = newRole; refresh(); }
});
