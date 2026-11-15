// Kör artboardens egen logik i node och ritar mallen till statiska sidor för skärmbilder.
//   node test3.mjs <Main.dc.html> [utmapp]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8'), ut = process.argv[3];
const src = html.slice(html.indexOf('>', html.indexOf('<script type="text/x-dc"')) + 1, html.lastIndexOf('</script>'));
const xdc = html.slice(html.indexOf('<x-dc>') + 6, html.indexOf('</x-dc>'));
const helmet = xdc.slice(xdc.indexOf('<helmet>') + 8, xdc.indexOf('</helmet>'));
const mall = xdc.slice(xdc.indexOf('</helmet>') + 9);
class DCLogic { constructor(p) { this.props = p || {}; } setState(s) { this.state = Object.assign({}, this.state, s); } forceUpdate() {} }
const Component = new Function('DCLogic', src + '; return Component;')(DCLogic);
let fel = 0; const F = (...a) => { fel++; console.log('FEL', ...a); };

/* ---------- En liten uttolkare av mallen: sc-for, sc-if och {{hål}} ---------- */
const slaUpp = (o, vag) => vag.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
const saknade = new Set();
function rita(t, sc) {
  let ut = '', i = 0;
  for (;;) {
    const a = t.slice(i).search(/<sc-(for|if)\b/);
    if (a < 0) { ut += t.slice(i); break; }
    const start = i + a, namn = t.slice(start + 1).match(/^sc-(for|if)/)[0];
    ut += t.slice(i, start);
    const oppSlut = t.indexOf('>', start) + 1, tagg = t.slice(start, oppSlut);
    let djup = 1, j = oppSlut;
    const re = new RegExp('<' + namn + '\\b|</' + namn + '>', 'g'); re.lastIndex = j;
    let m; while ((m = re.exec(t))) { if (m[0][1] === '/') { djup--; if (!djup) break; } else djup++; }
    if (!m) throw new Error('ostängd ' + namn);
    const kropp = t.slice(oppSlut, m.index); i = m.index + m[0].length;
    if (namn === 'sc-if') {
      const v = tagg.match(/value="\{\{\s*([\w.$]+)\s*\}\}"/)[1], val = slaUpp(sc, v);
      if (val === undefined) saknade.add(v);
      if (val) ut += rita(kropp, sc);
    } else {
      const l = tagg.match(/list="\{\{\s*([\w.$]+)\s*\}\}"/)[1], som = tagg.match(/as="(\w+)"/)[1], lista = slaUpp(sc, l);
      if (!Array.isArray(lista)) { saknade.add(l); continue; }
      lista.forEach((e, n) => { ut += rita(kropp, Object.assign({}, sc, { [som]: e, $index: n })); });
    }
  }
  return ut.replace(/\son[A-Z]\w+="\{\{\s*[\w.$]+\s*\}\}"/g, (x) => { const v = x.match(/\{\{\s*([\w.$]+)/)[1]; if (typeof slaUpp(sc, v) !== 'function') saknade.add('handler ' + v); return ''; })
    .replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_, v) => { const x = slaUpp(sc, v); if (x === undefined) { saknade.add(v); return ''; } return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); });
}
const sida = (v, extra = '') => `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${helmet}<style>*{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}${extra}</style></head><body>${rita(mall, v)}</body></html>`;

/* ---------- Logiken: alla underlag, perioder och personer ---------- */
const NYCKLAR = ['show', 'uteblev', 'bekr', 'kval', 'offert', 'nytt', 'vantar', 'dog', 'closing', 'svarnu', 'attbekr', 'utantid', 'uppfnu', 'utan', 'kommer'];
const ny = (props, state) => { const c = new Component(props); c.state = state; c.init(); c.t = 1; return c; };
for (const underlag of ['Era siffror', 'Exempel: ett halvår']) {
  for (const period of ['d90', 'vecka', 'manad', 'allt']) {
    for (const pers of [null, 'Mick', 'Carl', 'Fredrik']) {
      const c = ny({ underlag }, { period, pers }), v = c.renderVals(), S = c.stat(c.perioder()[period].fran, c.perioder()[period].till, pers);
      saknade.clear(); rita(mall, v); c.setState({ open: 'show' }); rita(mall, c.renderVals()); c.setState({ open: null });
      if (saknade.size) F('hål saknas', underlag, period, pers, [...saknade]);
      // Delarna ska summera till helheten.
      if (S.off.length + S.nytt.length + S.vantar.length + S.dog.length !== S.K1.length) F('efter mötet summerar inte', underlag, period, pers);
      if (S.hallna.length + S.uteblev.length !== S.avgj.length) F('show summerar inte');
      if (S.affar.length + S.nej.length + S.tyst.length + S.svar.length !== S.off.length) F('offerten summerar inte', underlag, period, pers);
      for (const x of [v.show, v.noshow, v.bekr, v.kval, v.clo]) if (!/^[A-ZÅÄÖ].*: .*\. Visa listan$/.test(x.aria)) F('namn för skärmläsare saknas', x.aria);
      if (S.svarade.length + S.ejsvar.length + S.aldrig.length !== S.avgj.length) F('bekräftelsen summerar inte');
      if (S.hallna.length !== S.K1.length) F('hållna och kort med hållet första möte skiljer sig', underlag, period, pers, S.hallna.length, S.K1.length);
      if (v.eft.map(x => x.n).join() !== [S.off, S.nytt, S.vantar, S.dog].map(a => a.length).join()) F('efter mötet visar fel tal', underlag, period, pers);
      { const sum = v.eft.reduce((a, x) => a + parseFloat(x.w), 0); if (sum > 108) F('delningen för bred', sum); }
      // Remsan: ett streck per avgjort möte, högst 40, och lika många "kom" som de hållna bland dem.
      { const sist = S.avgj.slice().sort((a, b) => a.tid < b.tid ? -1 : 1).slice(-40);
        if (v.remsa.length !== sist.length || v.remsa.filter(x => x.cls === 'k').length !== sist.filter(m => m.utfall === 'h').length) F('remsan stämmer inte', underlag, period, pers); }
      // Varje klickbart tal öppnar en lista: inga döda klick.
      for (const [namn, pick] of [['show', v.show.pick], ['noshow', v.noshow.pick], ['bekr', v.bekr.pick], ['kval', v.kval.pick], ['clo', v.clo.pick]].concat(v.eft.map(x => ['eft ' + x.l, x.pick]), v.todo.map(a => ['todo ' + a.text, a.pick]))) {
        pick(); const b = c.renderVals(); if (!b.bladOppet || !b.blad.titel) F('dött klick', namn); c.setState({ open: null });
      }
      for (const key of NYCKLAR) { c.setState({ open: key }); const b = c.renderVals(); if (!b.bladOppet || !b.blad.titel || !b.blad.fork) F('lista saknas', key); } c.setState({ open: null });
      if (v.todo.length > 5) F('för många åtgärder', v.todo.length);
      if (!pers) {
        const t = (x) => x.v + x.pz + ' (' + x.s + (x.not ? '; ' + x.not : '') + ')';
        console.log(`\n== ${underlag} / ${period}: ${v.ins1} ${v.ins2}`);
        console.log(`  show ${t(v.show)} ${v.show.jf ? '[' + v.show.jf + ']' : ''} | remsa ${v.remsa.map(x => x.cls).join('')}`);
        console.log(`  no-show ${t(v.noshow)} | svarade ${t(v.bekr)} | kval ${t(v.kval)} | closing ${t(v.clo)}`);
        console.log(`  efter: ${v.eft.map(x => x.l + ' ' + x.n).join(' · ')} (${v.eft[0].sub})`);
        console.log(`  att göra: ${v.todo.map(a => a.n + ' ' + a.text + ' (' + a.sub + ')').join(' ; ') || 'lugnt'}`);
      }
    }
  }
}
// Kontrollräkning mot databasens tal 2026-11-14 (32 möten, PROV-kortet borträknat).
{ const v = ny({}, {}).renderVals(); const fakta = [[v.show.v, '55'], [v.show.s, '6 av 11 kom'], [v.noshow.v, '45'], [v.noshow.s, '5 av 11 uteblev'], [v.bekr.v, '73'], [v.bekr.s, '8 av 11 svarade'], [v.bekr.not, '0 svarade inte · 3 ringdes aldrig'], [v.kval.v, '33'], [v.kval.s, '2 av 6 hållna möten'], [v.kval.not, '4 hållna saknar bedömning'], [v.eft.map(x => x.n).join(), '2,2,2,0'], [v.eft[0].sub, '33\u00a0% av 6 hållna'], [v.clo.v, '–'], [v.clo.s, 'Ingen av 2 offerter avgjord än'], [v.clo.not, ''], [v.kval.w, '33.33%'], [v.show.aria, 'Show rate: 55 procent, 6 av 11 kom. Visa listan'], [v.kval.aria, 'Kvalificerade: 33 procent, 2 av 6 hållna möten. Visa listan'], [v.todo[0].sub, 'Närmast mån 16 nov 10:30'], [v.todo.map(a => a.n).join(), '7,5,1,2'], [v.remsa.map(x => x.cls).join(''), 'uukuuukkkkk'], [v.ins1, 'Inget av de 3 obekräftade mötena blev av.']];
  for (const [a, b] of fakta) if (a !== b) F('stämmer inte med databasen', a, b); }
// Jämförelsen syns när båda perioderna bär: exemplets 90 dagar har en period före.
{ const c = ny({ underlag: 'Exempel: ett halvår' }, {}), v = c.renderVals(); if (!/^(Upp från|Ned från|Samma som) /.test(v.show.jf)) F('jämförelsen saknas i exemplet', v.show.jf);
  c.setState({ open: 'bekr' }); if (!/ Svarade perioden före: \d+ %\.$/.test(c.renderVals().blad.fork)) F('jämförelsen saknas i listan', c.renderVals().blad.fork);
  const m = ny({ underlag: 'Exempel: ett halvår' }, { period: 'manad' }).renderVals(); if (!/ i oktober$/.test(m.show.jf)) F('månaden saknar i', m.show.jf); }

// Lyft 3: handlingslistor börjar med det som brådskar, bladet säger fördelningen, tom period visar nästa möte, vyn minns valen.
{ const c = ny({}, {}); const v = c.renderVals();
  c.setState({ open: 'attbekr' }); let b = c.renderVals().blad; const t = b.rader.map(r => r.t);
  if (t.join() !== t.slice().sort().join()) F('ska bekräftas står inte närmast först', t);
  if (!v.todo[0].sub.endsWith(b.rader[0].nar)) F('närmast i raden och först i listan skiljer sig', v.todo[0].sub, b.rader[0].nar);
  c.setState({ open: 'show' }); b = c.renderVals().blad; if (b.antal !== 'Hållet 6 · Uteblev 5') F('bladets fördelning', b.antal);
  c.setState({ open: 'show' }); const tid = c.renderVals().blad.rader.map(r => r.t); if (tid.join() !== tid.slice().sort().reverse().join()) F('historiken står inte senast först');
  c.setState({ open: 'offert' }); b = c.renderVals().blad; if (b.antal !== '2 kort') F('en grupp ska säga antal kort', b.antal);
  c.setState({ open: 'svarnu' }); b = c.renderVals().blad; const u = b.rader.map(r => r.u); if (u.join() !== u.slice().sort().join()) F('offerterna står inte äldst uppföljning först', u);
  const tom = ny({}, { period: 'vecka', pers: 'Carl' }), tv = tom.renderVals();
  if (tv.show.s !== 'Nästa möte tis 17 nov 10:00' || tv.show.jf !== '2 möten bokade framåt') F('tom period visar inte nästa möte', tv.show.s, tv.show.jf);
  tv.show.pick(); b = tom.renderVals().blad; if (b.titel !== 'Bokade framåt' || b.rader.length !== 2) F('navet i tom period öppnar fel lista', b.titel, b.rader.length);
  console.log('  tom period:', tv.show.s, '|', tv.show.jf, '| blad:', b.titel, b.antal);
  console.log('  ska bekräftas:', ny({}, { open: 'attbekr' }).renderVals().blad.rader.slice(0, 3).map(r => r.nar).join(' ; '));
}
{ const lager = {}; globalThis.window = { localStorage: { getItem: k => lager[k] ?? null, setItem: (k, v) => { lager[k] = String(v); } } };
  const a = ny({}, {}); a.renderVals().perioder.find(p => p.l === 'Månad').pick(); a.renderVals().personer.find(p => p.l === 'Mick').pick();
  const b = ny({}, {}); b.minns(); const st = b.st; if (st.period !== 'manad' || st.pers !== 'Mick') F('vyn minns inte valen', JSON.stringify(st));
  lager['moten-statistik'] = '{"period":"ar","pers":"Okänd"}'; const c = ny({}, {}); c.minns(); if (c.st.period !== 'd90' || c.st.pers !== null) F('okända val ska ge förvalet', JSON.stringify(c.st));
  lager['moten-statistik'] = '{trasig'; const d = ny({}, {}); d.minns(); if (d.st.period !== 'd90') F('trasig lagring ska ge förvalet');
  globalThis.window = { get localStorage() { throw new Error('blockerad'); } }; const e = ny({}, {}); e.minns(); e.byt({ period: 'vecka' }); if (e.st.period !== 'vecka') F('blockerad lagring stoppar bytet');
  delete globalThis.window; }
// Räknaren går från 0 till målet.
{ const c = ny({}, {}); c.from = {}; c.t = 0; const a = c.renderVals().show.v; c.t = 1; const b = c.renderVals().show.v; if (a !== '0' || b !== '55') F('räknaren', a, b); }
// Taggarna i mallen går jämnt ut.
for (const t of ['div', 'section', 'button', 'span', 'p', 'sc-for', 'sc-if', 'b', 'i', 'h1', 'h2', 'svg', 'aside', 'small', 'header']) {
  const o = (mall.match(new RegExp('<' + t + '[\\s>]', 'g')) || []).length, s = (mall.match(new RegExp('</' + t + '>', 'g')) || []).length;
  if (o !== s) F('obalans', t, o, s);
}
console.log(fel ? `\n${fel} FEL` : '\nALLT GRÖNT');

/* ---------- Statiska sidor för skärmbilder ---------- */
if (ut) {
  mkdirSync(ut, { recursive: true });
  const spara = (namn, props, state) => writeFileSync(`${ut}/${namn}.html`, sida(ny(props, state).renderVals()));
  spara('ljus', {}, {});
  spara('mork', { morkt: true }, {});
  spara('exempel', { underlag: 'Exempel: ett halvår' }, {});
  spara('exempel-mork', { underlag: 'Exempel: ett halvår', morkt: true }, {});
  spara('blad', {}, { open: 'offert' });
  spara('blad-show', {}, { open: 'show' });
  spara('blad-attbekr', {}, { open: 'attbekr' });
  spara('blad-tom', {}, { period: 'vecka', pers: 'Carl', open: 'kommer' });
  spara('tomt', {}, { period: 'vecka', pers: 'Carl' });
  spara('mick-vecka', {}, { period: 'vecka', pers: 'Mick' });
  spara('exempel-vecka', { underlag: 'Exempel: ett halvår' }, { period: 'vecka' });
}
