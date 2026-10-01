/* World explorer: views over existing campaign data; public additions live in map. */
'use strict';
(() => {
  const root = $('world-app');
  const kinds = { place: ['◇', 'Orte'], npc: ['♙', 'Charaktere'], quest: ['⚑', 'Quests'], faction: ['⚜', 'Fraktionen'], session: ['◷', 'Chronik'], lore: ['✧', 'Wissen'], dm: ['▣', 'DM-Bibliothek'] };
  let view = 'map', filter = 'all', query = '', selected = null, adding = false;
  let entries = [], zoom = 1, pan = { x: 0, y: 0 }, mapURL = '', selectedFocus;
  let initialRef = null;
  let viewport, plane, detail, results, counter, stageObserver, resizeMap;
  const btn = (label, action, cls = '', attrs = {}) => el('button', { type: 'button', class: cls, onclick: action, ...attrs }, label);
  const norm = value => String(value || '').toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const safeURL = value => { try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const map = () => state.map || { markers: [] };
  const publicEntries = () => entries.filter(e => e.kind !== 'dm');
  const tag = text => el('span', { class: 'world-tag' }, text);
  function index() {
    const list = [];
    const add = (kind, ref, title, body, source, extra = {}) => list.push({ kind, ref, title: title || 'Ohne Titel', body: body || '', source, ...extra });
    (map().markers || []).forEach(m => add('place', `place:${m.id}`, m.label, m.note, m));
    (state.npcs || []).filter(n => !n.hidden || role === 'dm').forEach(n => add('npc', `npc:${n.id}`, n.name, n.desc, n, { sub: n.role, img: n.img }));
    (state.factions || []).forEach(f => add('faction', `faction:${f.id}`, f.name, f.desc || '', f, { sub: `Ansehen ${f.rep > 0 ? '+' : ''}${f.rep || 0}` }));
    ['main', 'side'].forEach(key => { if (state.quests?.[key]) add('quest', `quest:${key}`, key === 'main' ? 'Hauptquest' : 'Nebenquests', state.quests[key], null); });
    (state.tracker || []).forEach(t => add('quest', `tracker:${t.id}`, t.text, '', t, { sub: t.done ? 'Abgeschlossen' : 'Offen' }));
    (state.sessions || []).forEach(s => add('session', `session:${s.id}`, s.title || `Sitzung ${s.date}`, s.text, s, { sub: s.date }));
    if (state.recap) add('lore', 'recap', 'Was bisher geschah', state.recap, null);
    (map().entries || []).forEach(e => add('lore', `lore:${e.id}`, e.title, e.body, e, { sub: e.category || 'Wissen' }));
    if (role === 'dm') {
      const walk = (nodes, path = '') => (nodes || []).forEach(n => n.type === 'folder' ? walk(n.children, n.title) : add('dm', `dm:${n.id}`, n.title, n.body, n, { sub: path }));
      walk(state.library);
    }
    entries = list;
  }
  const find = ref => entries.find(e => e.ref === ref);
  function relations(entry) {
    return (map().links || []).filter(l => l.from === entry.ref || l.to === entry.ref)
      .map(l => ({ link: l, entry: find(l.from === entry.ref ? l.to : l.from) })).filter(r => r.entry);
  }
  function mentions(entry) {
    const linked = new Set(relations(entry).map(r => r.entry.ref));
    return entries.filter(e => e.ref !== entry.ref && !linked.has(e.ref) &&
      ((entry.title.length > 3 && norm(e.body).includes(norm(entry.title))) || (e.title.length > 3 && norm(entry.body).includes(norm(e.title))))).slice(0, 12);
  }
  function choose(ref, focusMap = true) {
    selectedFocus = document.activeElement;
    selected = ref;
    const entry = find(ref);
    if (focusMap && entry?.kind === 'place' && plane && viewport) {
      zoom = Math.max(zoom, 1.5);
      pan.x = viewport.clientWidth / 2 - plane.offsetWidth * entry.source.x / 100 * zoom;
      pan.y = viewport.clientHeight / 2 - plane.offsetHeight * entry.source.y / 100 * zoom;
      transform();
    }
    renderDetails();
    root.querySelectorAll('[data-ref]').forEach(node => node.classList.toggle('is-selected', node.dataset.ref === ref));
    const url = new URL(location.href); url.hash = `entry=${encodeURIComponent(ref)}`; history.replaceState(null, '', url);
    detail.querySelector('.world-close')?.focus({ preventScroll: true });
  }
  function closeDetail() {
    selected = null; renderDetails();
    history.replaceState(null, '', location.pathname + location.search);
    if (selectedFocus?.isConnected) selectedFocus.focus({ preventScroll: true });
  }
  function show(next) {
    view = next; adding = false; render();
  }
  function render() {
    index();
    if (initialRef && find(initialRef)) { selected = initialRef; initialRef = null; }
    if (selected && !find(selected) && Object.keys(state).length) selected = null;
    stageObserver?.disconnect();
    viewport = plane = null;
    root.replaceChildren();
    $('dashboard').hidden = view !== 'dashboard';
    const nav = el('nav', { class: 'world-nav', 'aria-label': 'Kampagnenansichten' },
      el('div', { class: 'world-wordmark' }, el('span', {}, '✧'), ' ATLAS', el('small', {}, 'DEINE KAMPAGNENWELT')),
      ...[['map', '◇ Weltkarte'], ['wiki', '▤ Wiki'], ['connections', '⌘ Beziehungen'], ['dashboard', '⚔ Spieltisch']].map(([id, label]) => btn(label, () => show(id), view === id ? 'active' : '', { 'aria-current': view === id ? 'page' : null })),
      el('div', { class: 'world-nav-end' }, role === 'dm' ? 'SPIELLEITUNG' : 'GEMEINSAM ENTDECKEN'));
    root.append(nav);
    if (view === 'dashboard') return;
    const search = el('input', { type: 'search', placeholder: 'Orte, Namen, Geschichten …', value: query, 'aria-label': 'Welt durchsuchen' });
    search.addEventListener('input', () => { query = search.value; renderResults(); });
    const library = el('aside', { class: 'world-library', 'aria-label': 'Weltverzeichnis' });
    library.append(el('div', { class: 'world-library-heading' }, el('span', { class: 'eyebrow' }, 'DEINE WELT'), el('h2', {}, 'Entdecken'), search));
    const filters = el('div', { class: 'world-filters', 'aria-label': 'Eintragstyp' });
    [['all', ['◎', 'Alles']], ...Object.entries(kinds).filter(([key]) => key !== 'dm' || role === 'dm')].forEach(([key, [icon, name]]) => {
      const count = key === 'all' ? entries.length : entries.filter(e => e.kind === key).length;
      filters.append(btn(el('span', {}, icon, ' ', name, el('small', {}, count)), () => {
        filter = key; filters.querySelectorAll('button').forEach(b => { b.classList.toggle('active', b.dataset.kind === key); b.setAttribute('aria-pressed', String(b.dataset.kind === key)); }); renderResults();
      }, key === filter ? 'active' : '', { 'data-kind': key, 'aria-pressed': key === filter }));
    });
    counter = el('div', { class: 'world-result-count', 'aria-live': 'polite' });
    results = el('div', { class: 'world-results' });
    library.append(filters, counter, results);
    if (role === 'dm') library.append(btn('+ Wiki-Eintrag', () => editLore(), 'world-add'));
    const content = el('main', { class: 'world-main' });
    const title = view === 'map' ? 'Die Welt liegt vor euch.' : view === 'wiki' ? 'Jede Geschichte ist verbunden.' : 'Nichts steht für sich allein.';
    content.append(el('div', { class: 'world-heading' }, el('div', {}, el('span', { class: 'eyebrow' }, view === 'map' ? 'KAMPAGNENATLAS' : view === 'wiki' ? 'WISSEN & ERINNERUNGEN' : 'PERSONEN · ORTE · GESCHICHTEN'), el('h1', {}, title)), el('span', { class: 'world-total' }, `${entries.filter(e => e.kind === 'place').length} Orte · ${entries.filter(e => e.kind === 'npc').length} Charaktere`)));
    const canvas = el('div', { class: 'world-canvas' });
    detail = el('aside', { class: 'world-detail', 'aria-label': 'Eintragsdetails' });
    if (view === 'map') renderMapCanvas(canvas);
    else if (view === 'wiki') renderWiki(canvas);
    else renderConnections(canvas);
    content.append(canvas, detail);
    root.append(el('div', { class: 'world-layout' }, library, content));
    renderResults(); renderDetails();
    if (viewport) {
      stageObserver = new ResizeObserver(() => { resizeMap?.(); if (zoom === 1) center(); else transform(); });
      stageObserver.observe(viewport);
    }
  }
  function renderResults() {
    if (!results) return;
    const matched = entries.filter(e => (filter === 'all' || e.kind === filter) && norm(`${e.title} ${e.body} ${e.sub || ''}`).includes(norm(query)));
    counter.textContent = `${matched.length} EINTRÄGE`;
    results.replaceChildren(...matched.map(e => btn(el('span', {}, el('i', {}, kinds[e.kind][0]), el('span', {}, el('strong', {}, e.title), el('small', {}, e.sub || kinds[e.kind][1]))), () => choose(e.ref), 'world-result' + (selected === e.ref ? ' is-selected' : ''), { 'data-ref': e.ref })));
    if (!matched.length) results.append(el('p', { class: 'world-empty' }, 'Keine passenden Einträge. Versuche einen anderen Suchbegriff oder Filter.'));
    // The same search and filters apply to map pins and wiki cards.
    const refs = new Set(matched.map(e => e.ref));
    root.querySelectorAll('.world-pin, .world-card').forEach(n => n.hidden = !refs.has(n.dataset.ref));
  }
  function transform() {
    if (!plane || !viewport) return;
    const w = plane.offsetWidth * zoom, h = plane.offsetHeight * zoom;
    pan.x = zoom === 1 || w < viewport.clientWidth ? (viewport.clientWidth - w) / 2 : clamp(pan.x, viewport.clientWidth - w - 60, 60);
    pan.y = zoom === 1 || h < viewport.clientHeight ? (viewport.clientHeight - h) / 2 : clamp(pan.y, viewport.clientHeight - h - 60, 60);
    plane.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
    plane.style.setProperty('--pin-scale', 1 / zoom);
    root.querySelector('.world-zoom-level')?.replaceChildren(`${Math.round(zoom * 100)}%`);
  }
  function center() { zoom = 1; pan = { x: 0, y: 0 }; transform(); }
  function zoomAt(factor, x, y) {
    if (!viewport) return;
    x ??= viewport.clientWidth / 2; y ??= viewport.clientHeight / 2;
    const next = clamp(zoom * factor, 1, 6), ratio = next / zoom;
    pan = { x: x - (x - pan.x) * ratio, y: y - (y - pan.y) * ratio }; zoom = next; transform();
  }
  function renderMapCanvas(canvas) {
    canvas.classList.add('is-map');
    viewport = el('div', { class: 'world-viewport', tabindex: '0', role: 'region', 'aria-label': 'Weltkarte. Pfeiltasten verschieben; Plus und Minus zoomen; Null setzt zurück.' });
    const imageURL = safeURL(map().image);
    if (!imageURL) {
      canvas.append(el('div', { class: 'world-empty-state' }, el('span', {}, '◇'), el('h2', {}, 'Hier beginnt eure Welt.'), el('p', {}, 'Die Spielleitung kann am Spieltisch eine Karte hochladen.'), btn('Zum Spieltisch', () => show('dashboard')))); return;
    }
    if (mapURL !== imageURL) { zoom = 1; pan = { x: 0, y: 0 }; mapURL = imageURL; }
    plane = el('div', { class: 'world-map-plane' });
    const img = el('img', { src: imageURL, alt: 'Karte der Kampagnenwelt', draggable: 'false' });
    const size = () => {
      if (!viewport?.isConnected || !img.naturalWidth) return;
      const fit = Math.min(viewport.clientWidth / img.naturalWidth, viewport.clientHeight / img.naturalHeight);
      plane.style.width = `${img.naturalWidth * fit}px`; plane.style.height = `${img.naturalHeight * fit}px`; transform();
    };
    img.addEventListener('load', size);
    img.addEventListener('error', () => canvas.append(el('p', { class: 'world-map-error', role: 'alert' }, 'Das Kartenbild konnte nicht geladen werden. Bitte Verbindung oder Bildadresse prüfen.')));
    plane.append(img);
    (map().markers || []).forEach(m => plane.append(btn(el('span', {}, el('i', {}, '◇'), el('strong', {}, m.label)), e => { e.stopPropagation(); choose(`place:${m.id}`, false); }, 'world-pin', { style: `left:${clamp(Number(m.x) || 0, 0, 100)}%;top:${clamp(Number(m.y) || 0, 0, 100)}%`, 'data-ref': `place:${m.id}`, 'aria-label': `Ort öffnen: ${m.label}` })));
    viewport.append(plane);
    const activePointers = new Map(); let start, moved = false, pinchDistance = 0;
    viewport.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || e.button > 0) return;
      viewport.setPointerCapture(e.pointerId); activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; moved = false;
      if (activePointers.size === 2) { const [a,b] = [...activePointers.values()]; pinchDistance = Math.hypot(a.x-b.x, a.y-b.y); }
    });
    viewport.addEventListener('pointermove', e => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        const [a,b] = [...activePointers.values()], distance = Math.hypot(a.x-b.x, a.y-b.y), rect = viewport.getBoundingClientRect();
        if (pinchDistance) zoomAt(distance / pinchDistance, (a.x+b.x)/2-rect.left, (a.y+b.y)/2-rect.top);
        pinchDistance = distance; moved = true; return;
      }
      if (!start) return;
      const dx = e.clientX-start.x, dy = e.clientY-start.y;
      if (Math.hypot(dx,dy) > 4) moved = true;
      pan = { x: start.px+dx, y: start.py+dy }; transform();
    });
    const end = e => {
      activePointers.delete(e.pointerId);
      if (adding && !moved && e.type !== 'pointercancel' && role === 'dm') {
        const rect = plane.getBoundingClientRect(), x = (e.clientX-rect.left)/rect.width*100, y = (e.clientY-rect.top)/rect.height*100;
        if (x >= 0 && x <= 100 && y >= 0 && y <= 100) editPlace(null, { x, y });
      }
      start = null; pinchDistance = 0;
    };
    viewport.addEventListener('pointerup', end); viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('wheel', e => { e.preventDefault(); const r = viewport.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX-r.left, e.clientY-r.top); }, { passive: false });
    viewport.addEventListener('keydown', e => {
      if (e.target !== viewport) return;
      if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
      if (e.key === '+' || e.key === '=') zoomAt(1.3);
      else if (e.key === '-') zoomAt(1/1.3);
      else if (e.key === '0') center();
      else { const delta = { ArrowLeft: [50,0], ArrowRight: [-50,0], ArrowUp: [0,50], ArrowDown: [0,-50] }[e.key]; if (delta) { pan.x += delta[0]; pan.y += delta[1]; transform(); } }
    });
    const tools = el('div', { class: 'world-map-tools' }, btn('+', () => zoomAt(1.3), '', { 'aria-label': 'Vergrößern' }), el('span', { class: 'world-zoom-level' }, `${Math.round(zoom*100)}%`), btn('−', () => zoomAt(1/1.3), '', { 'aria-label': 'Verkleinern' }), btn('↺', center, '', { 'aria-label': 'Karte einpassen' }));
    if (role === 'dm') tools.append(btn('+ Ort', e => { adding = !adding; e.currentTarget.classList.toggle('active', adding); viewport.classList.toggle('adding', adding); toast(adding ? 'Klicke auf die Karte, um einen Ort anzulegen.' : 'Orte setzen beendet'); }));
    canvas.append(viewport, el('div', { class: 'world-compass', 'aria-hidden': 'true' }, 'N', el('span', {}, '✧')), tools, el('div', { class: 'world-map-caption' }, 'Ziehen zum Erkunden · Scrollen zum Zoomen · Orte anklicken'));
    requestAnimationFrame(size);
    resizeMap = size;
  }
  function renderWiki(canvas) {
    canvas.classList.add('world-wiki');
    entries.forEach(e => canvas.append(btn(el('span', {}, el('span', { class: 'world-card-icon' }, kinds[e.kind][0]), tag(e.sub || kinds[e.kind][1]), el('h2', {}, e.title), el('p', {}, e.body.replace(/[#*_>]/g, '').slice(0, 150) || 'Entdecke die Verbindungen dieses Eintrags.'), el('span', { class: 'world-card-link' }, 'Eintrag öffnen ↗')), () => choose(e.ref), 'world-card', { 'data-ref': e.ref })));
    if (!entries.length) canvas.append(el('p', { class: 'world-empty' }, 'Hier erscheinen eure Orte, Charaktere und Geschichten, sobald die Kampagne geladen ist.'));
  }
  function renderConnections(canvas) {
    canvas.classList.add('world-connections');
    const edges = (map().links || []).filter(l => find(l.from) && find(l.to));
    canvas.append(el('p', { class: 'world-connection-intro' }, 'Wer gehört wohin? Öffne einen Eintrag, um seine Verbindungen zu erkunden.' ));
    if (!edges.length) canvas.append(el('div', { class: 'world-empty-state' }, el('span', {}, '⌘'), el('h2', {}, 'Aus Einträgen werden Geschichten.'), el('p', {}, 'Die Spielleitung kann in einem Eintrag eine Beziehung anlegen. Erwähnungen werden dort bereits automatisch gefunden.'), btn('Wiki erkunden', () => show('wiki'))));
    edges.forEach(l => canvas.append(el('div', { class: 'world-edge' }, btn(find(l.from).title, () => choose(l.from)), el('span', {}, l.label || 'verbunden mit', el('i', {}, '⟷')), btn(find(l.to).title, () => choose(l.to)))));
  }
  function prose(text) {
    // Text nodes only: campaign content cannot inject markup or script into the explorer.
    const body = el('div', { class: 'world-prose' });
    const names = entries.filter(e => e.kind !== 'dm' && e.title.length > 3).sort((a,b) => b.title.length-a.title.length);
    const appendText = (node, line) => {
      let cursor = 0;
      while (cursor < line.length) {
        let match = null, offset = line.length;
        for (const entry of names) { const at = line.toLocaleLowerCase().indexOf(entry.title.toLocaleLowerCase(), cursor); if (at >= 0 && at < offset) { offset = at; match = entry; } }
        if (!match) { node.append(document.createTextNode(line.slice(cursor))); break; }
        node.append(document.createTextNode(line.slice(cursor, offset)), btn(line.slice(offset, offset+match.title.length), () => choose(match.ref), 'world-inline-link'));
        cursor = offset+match.title.length;
      }
    };
    String(text).split('\n').forEach(line => {
      const heading = /^(#{1,3})\s+/.exec(line), quote = /^>\s?/.test(line);
      const node = el(heading ? 'h3' : quote ? 'blockquote' : 'p');
      appendText(node, line.replace(/^(#{1,3}\s+|>\s?)/, '').replace(/\*\*([^*]+)\*\*/g, '$1'));
      body.append(node);
    });
    return body;
  }
  function renderDetails() {
    if (!detail) return;
    const entry = find(selected);
    detail.hidden = !entry; root.classList.toggle('has-detail', !!entry);
    detail.replaceChildren(); if (!entry) return;
    detail.append(el('div', { class: 'world-detail-top' }, tag(entry.kind === 'dm' ? 'NUR SPIELLEITUNG' : kinds[entry.kind][1]), btn('✕', closeDetail, 'world-close', { 'aria-label': 'Details schließen' })), el('div', { class: 'world-detail-symbol' }, kinds[entry.kind][0]), el('h2', {}, entry.title));
    if (entry.sub) detail.append(el('p', { class: 'world-detail-sub' }, entry.sub));
    if (entry.img && safeURL(entry.img)) detail.append(el('img', { class: 'world-portrait', src: safeURL(entry.img), alt: entry.title }));
    detail.append(prose(entry.body || 'Hier ist noch keine Beschreibung hinterlegt.'));
    const linked = relations(entry), mentioned = mentions(entry);
    detail.append(el('h3', {}, 'Verbindungen'));
    linked.forEach(({ link, entry: other }) => detail.append(el('div', { class: 'world-relation' }, btn(el('span', {}, el('small', {}, link.label || 'Verbunden mit'), el('strong', {}, other.title), ' ↗'), () => choose(other.ref)), role === 'dm' ? btn('×', () => { if (confirm('Diese Verbindung entfernen?')) saveMapChange(m => { m.links = (m.links || []).filter(l => l.id !== link.id); }); }, '', { 'aria-label': 'Verbindung entfernen' }) : null)));
    if (!linked.length) detail.append(el('p', { class: 'world-hint' }, 'Noch keine Beziehungen verknüpft.'));
    if (role === 'dm' && entry.kind !== 'dm' && !entry.source?.hidden) detail.append(btn('+ Beziehung anlegen', () => editLink(entry), 'world-add'));
    if (mentioned.length) {
      detail.append(el('h3', {}, 'Erwähnt & verwandt'), el('p', { class: 'world-hint' }, 'Aus Namen im Text erkannt.'));
      mentioned.forEach(e => detail.append(btn(`${kinds[e.kind][0]} ${e.title} ↗`, () => choose(e.ref), 'world-mention')));
    }
    if (role === 'dm') detail.append(btn('Eintrag bearbeiten', () => {
      if (entry.kind === 'place') editPlace(entry.source);
      else if (entry.ref.startsWith('lore:')) editLore(entry.source);
      else {
        if (entry.kind === 'dm') selectedPageId = entry.source.id;
        show('dashboard');
        const section = { npc: 'npcs', faction: 'factions', session: 'sessions', dm: 'library', lore: 'recap', quest: entry.ref.startsWith('tracker:') ? 'tracker' : 'quests' }[entry.kind];
        if (entry.kind === 'dm') renderLibrary();
        document.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ behavior: 'smooth' });
      }
    }, 'world-edit'));
  }
  async function saveMapChange(change) {
    if (role !== 'dm') return false;
    // Do not replace state until a confirmed save; a failed write keeps the editor open.
    const next = structuredClone(map()); change(next);
    const { error } = await sb.from('kv').upsert({ key: 'map', data: next, updated_at: new Date().toISOString() });
    if (error) { toast('Speichern fehlgeschlagen. Bitte erneut versuchen.'); return false; }
    state.map = next; renderAll(); toast('Gespeichert'); return true;
  }
  function formDialog(title, fields, commit) {
    const dialog = el('dialog', { class: 'world-dialog' }), form = el('form');
    const focus = document.activeElement;
    form.append(el('h2', {}, title), el('p', { class: 'world-hint' }, 'Diese Inhalte sind für alle Mitspieler sichtbar.'));
    fields.forEach(([label, input]) => { input.setAttribute('aria-label', label); form.append(el('label', {}, el('span', {}, label), input)); });
    const submit = el('button', { type: 'submit' }, 'Speichern');
    const close = () => { dialog.close(); dialog.remove(); focus?.isConnected && focus.focus(); };
    form.append(el('div', { class: 'world-form-actions' }, btn('Abbrechen', close), submit));
    form.addEventListener('submit', async e => { e.preventDefault(); submit.disabled = true; try { if (await commit()) close(); } catch { toast('Speichern fehlgeschlagen. Bitte erneut versuchen.'); } finally { submit.disabled = false; } });
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.append(form); document.body.append(dialog); dialog.showModal();
  }
  function editPlace(source, coords) {
    const name = el('input', { value: source?.label || '', required: true, maxlength: '160' });
    const note = el('textarea', { rows: '7' }, source?.note || '');
    formDialog(source ? 'Ort bearbeiten' : 'Neuen Ort entdecken', [['Name', name], ['Beschreibung', note]], async () => {
      if (!name.value.trim()) return false;
      const id = source?.id || genId();
      const saved = await saveMapChange(m => {
        m.markers ||= [];
        const target = m.markers.find(x => x.id === id);
        if (target) Object.assign(target, { label: name.value.trim(), note: note.value });
        else if (!source) m.markers.push({ id, ...coords, label: name.value.trim(), note: note.value });
        else throw new Error('Ort wurde entfernt');
      });
      if (saved) { adding = false; choose(`place:${id}`); } return saved;
    });
  }
  function editLore(source) {
    const name = el('input', { value: source?.title || '', required: true, maxlength: '160' });
    const category = el('input', { value: source?.category || '', placeholder: 'z. B. Gegenstand, Legende, Gottheit' });
    const body = el('textarea', { rows: '9' }, source?.body || '');
    formDialog(source ? 'Wiki-Eintrag bearbeiten' : 'Wiki-Eintrag anlegen', [['Titel', name], ['Kategorie', category], ['Inhalt', body]], async () => {
      if (!name.value.trim()) return false;
      const id = source?.id || genId();
      const saved = await saveMapChange(m => { m.entries ||= []; const data = { id, title: name.value.trim(), category: category.value, body: body.value }; const at = m.entries.findIndex(e => e.id === id); if (at >= 0) m.entries[at] = data; else m.entries.push(data); });
      if (saved) choose(`lore:${id}`, false); return saved;
    });
  }
  function editLink(entry) {
    const target = el('select', { required: true }, el('option', { value: '' }, 'Eintrag wählen …'), ...publicEntries().filter(e => e.ref !== entry.ref && !e.source?.hidden).map(e => el('option', { value: e.ref }, `${kinds[e.kind][1]} · ${e.title}`)));
    const label = el('input', { required: true, placeholder: 'z. B. lebt in, trägt, gehört zu', maxlength: '100' });
    formDialog('Beziehung anlegen', [['Von', el('p', {}, entry.title)], ['Beziehung', label], ['Zu', target]], () => {
      if (!label.value.trim() || !target.value) return false;
      return saveMapChange(m => { m.links ||= []; if (!m.links.some(l => l.from === entry.ref && l.to === target.value && l.label === label.value.trim())) m.links.push({ id: genId(), from: entry.ref, to: target.value, label: label.value.trim() }); });
    });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closeDetail(); });
  const hash = location.hash.match(/^#entry=(.+)$/); if (hash) { try { initialRef = decodeURIComponent(hash[1]); } catch {} }
  window.worldExplorer = { render };
  render();
})();
