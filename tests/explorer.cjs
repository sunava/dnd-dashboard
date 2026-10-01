const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const server = require('../dev-server.cjs');
const fixture = {
  campaign: { title: 'Dragonlance', subtitle: 'Eine Geschichte aus den Northern Wastes' },
  map: { image: '/test-map.svg', markers: [ { id: 'cave', x: 26, y: 56, label: 'Bluemaw Cave', note: 'Dalamar kennt den Weg durch die Öde.' }, { id: 'fort', x: 64, y: 44, label: 'Sunward Fortress', note: 'Unsere letzte Station.' }, { id: 'shrine', x: 57, y: 57, label: 'Blue Phoenix Shrine', note: '' } ] },
  npcs: [{ id: 'dalamar', name: 'Dalamar', role: 'Magier', desc: 'Erforscht Wakenreth.' }],
  factions: [], resources: [], sessions: [{ id: 's1', date: '01.10.2026', title: 'Die Öde', text: 'Dalamar weist uns den Weg.' }],
  tracker: [], quests: { main: 'Die Vermissten finden.', side: '' }, recap: 'Unsere Reise führt nach Bluemaw Cave.'
};
const mapSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#c4b894"/><path d="M0 600 Q200 250 600 470 T1200 200" fill="none" stroke="#929e9c" stroke-width="85"/><path d="M400 0L300 170 480 220 350 340 590 400M900 0L780 200 920 300" fill="none" stroke="#776f59" stroke-width="40"/></svg>';
(async () => {
  await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER_CHANNEL ? { channel: process.env.TEST_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/test-map.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: mapSVG }));
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ body: '' }));
    await page.addInitScript(data => {
      window.writes = []; window.failSave = false;
      const db = structuredClone(data);
      let loggedIn = false, authCallback;
      const client = {
        from: table => ({
          select: async () => ({ data: table === 'kv' ? Object.entries(db).map(([key,data]) => ({key,data})) : [{key:'library',data:[{ id:'private',type:'page',title:'Geheime Falle',body:'DM-ONLY-SENTINEL' }]}] }),
          upsert: async value => { if (window.failSave) return {error:{message:'offline'}}; window.writes.push({table,...value}); db[value.key]=structuredClone(value.data); return {}; }
        }),
        channel: () => { const c = { on: () => c, subscribe: callback => { callback?.('SUBSCRIBED'); return c; } }; return c; },
        removeChannel: () => {},
        auth: {
          getSession: async () => ({data:{session:loggedIn ? {} : null}}),
          onAuthStateChange: cb => {authCallback=cb;},
          signInWithPassword: async () => {loggedIn=true; return {};},
          signOut: async () => {loggedIn=false; return {};}
        }
      };
      window.supabase = {createClient:()=>client};
    }, fixture);
    await page.goto('http://127.0.0.1:4174');
    await page.getByRole('button', {name:'Ort öffnen: Bluemaw Cave',exact:true}).waitFor();
    assert.equal(await page.locator('.world-pin').count(), 3);
    await page.getByRole('button', {name:'Ort öffnen: Bluemaw Cave',exact:true}).click();
    assert.match(await page.locator('.world-detail').innerText(), /Dalamar/);
    await page.locator('.world-detail .world-inline-link').filter({hasText:'Dalamar'}).click();
    assert.equal(await page.locator('.world-detail h2').innerText(), 'Dalamar');
    await page.getByRole('button', {name:'Details schließen'}).click();
    await page.getByRole('button', {name:'Vergrößern',exact:true}).click();
    assert.equal(await page.locator('.world-zoom-level').innerText(), '130%');
    await page.getByRole('button', {name:'Karte einpassen'}).click();
    await page.getByRole('searchbox', {name:'Welt durchsuchen'}).fill('Bluemaw');
    assert.equal(await page.locator('.world-pin:visible').count(), 1);
    await page.getByRole('searchbox', {name:'Welt durchsuchen'}).fill('');
    assert.equal(await page.locator('.world-results').getByText('Geheime Falle').count(), 0);
    await page.getByRole('button', {name:'DM-Modus',exact:true}).click();
    await page.getByPlaceholder('DM-E-Mail').fill('test@example.com');
    await page.getByPlaceholder('Passwort').fill('test-password');
    await page.getByRole('button', {name:'Anmelden',exact:true}).click();
    await page.locator('.world-results').getByText('Geheime Falle').waitFor();
    await page.getByRole('button', {name:'Ort öffnen: Bluemaw Cave',exact:true}).click();
    await page.getByRole('button', {name:'+ Beziehung anlegen'}).click();
    await page.getByLabel('Beziehung', {exact:true}).fill('wird erforscht von');
    await page.getByLabel('Zu', {exact:true}).selectOption('npc:dalamar');
    await page.getByRole('button', {name:'Speichern',exact:true}).click();
    await page.waitForFunction(() => writes.length === 1);
    assert.equal(await page.evaluate(() => writes[0].data.links[0].to), 'npc:dalamar');
    assert.equal(await page.evaluate(() => writes[0].data.markers.length), 3);
    await page.getByRole('button', {name:'Details schließen'}).click();
    await page.getByRole('button', {name:'+ Wiki-Eintrag',exact:true}).click();
    await page.getByLabel('Titel', {exact:true}).fill('Korraks Handschuh');
    await page.getByLabel('Inhalt', {exact:true}).fill('Dalamar übergibt das Vermächtnis. <img src=x onerror=alert(1)>');
    await page.evaluate(() => window.failSave = true);
    await page.getByRole('button', {name:'Speichern',exact:true}).click();
    await page.getByText('Speichern fehlgeschlagen. Bitte erneut versuchen.', {exact:true}).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.evaluate(() => window.failSave = false);
    await page.getByRole('button', {name:'Speichern',exact:true}).click();
    await page.waitForFunction(() => writes.length === 2);
    assert.equal(await page.locator('.world-prose img').count(), 0);
    await page.getByRole('button', {name:'Details schließen'}).click();
    await page.getByRole('button', {name:'+ Ort',exact:true}).click();
    const rect = await page.locator('.world-map-plane').boundingBox();
    await page.mouse.click(rect.x + rect.width * .15, rect.y + rect.height * .25);
    await page.getByLabel('Name', {exact:true}).fill('Elfenlager');
    await page.getByLabel('Beschreibung', {exact:true}).fill('Ein vertrauter Ort.');
    await page.getByRole('button', {name:'Speichern',exact:true}).click();
    await page.waitForFunction(() => writes.length === 3);
    const added = await page.evaluate(() => writes[2].data.markers.at(-1));
    assert.ok(Math.abs(added.x - 15) < .5 && Math.abs(added.y - 25) < .5);
    assert.equal(await page.evaluate(() => writes[2].data.links.length), 1);
    await page.getByRole('button', {name:'Details schließen'}).click();
    await page.getByRole('button', {name:'⌘ Beziehungen',exact:true}).click();
    assert.match(await page.locator('.world-edge').innerText(), /wird erforscht von/);
    await page.getByRole('button', {name:'▤ Wiki',exact:true}).click();
    assert.ok(await page.locator('.world-card').count() > 5);
    await page.getByRole('button', {name:'DM abmelden',exact:true}).click();
    await page.waitForFunction(() => document.getElementById('dm-btn').textContent === 'DM-Modus');
    assert.ok(!(await page.locator('body').innerText()).includes('DM-ONLY-SENTINEL'));
    assert.equal(await page.getByRole('button', {name:'+ Wiki-Eintrag',exact:true}).count(), 0);
    await page.getByRole('button', {name:'◇ Weltkarte',exact:true}).click();
    await page.getByRole('button', {name:'Karte einpassen'}).click();
    const bounds = await page.locator('.world-viewport').boundingBox();
    const fitted = await page.locator('.world-map-plane').boundingBox();
    assert.ok(Math.abs(fitted.y - (bounds.y + (bounds.height - fitted.height) / 2)) < 2);
    fs.mkdirSync('test-results', {recursive:true});
    await page.screenshot({path:'test-results/atlas-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', {name:'Ort öffnen: Bluemaw Cave',exact:true}).click();
    await page.screenshot({path:'test-results/atlas-mobile.png',fullPage:true});
    assert.deepEqual(errors, []);
    console.log('PASS: map, zoom, search, wiki, links, DM login/logout, save failure/retry, content safety, mobile layout. No production writes.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; server.close(); });
