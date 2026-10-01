// Flödesprov för prototypen. Varje ok('…') är ett flöde som ska fungera likadant i Nav.
// Kör mot prototypen: node prototyp-flodesprov.cjs prototyp.html r   (kräver Playwright)
// Läs det som en exakt beskrivning av klicken, inte som ett test som körs mot Nav.
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const FILE=process.argv[2]||'prototyp.html', PRE=process.argv[3]||'r';
(async()=>{
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1320,height:1000}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+process.cwd()+'/'+FILE);await p.waitForTimeout(400);
const out=[];const ok=async(name,fn)=>{try{await fn();out.push(['OK',name,(await p.textContent('#toast')).trim().slice(0,90)])}catch(e){out.push(['FAIL',name,e.message.split('\n')[0].slice(0,120)])}if(errs.length){out.push(['ERR',name,errs.join(' // ')]);errs.length=0}};
const clickNote=async txt=>{await p.click('#bBell');for(const x of await p.$$('.nitem')){if((await x.textContent()).includes(txt)){await x.click();return}}throw new Error('note '+txt)};
const clickEv=async txt=>{for(const e of await p.$$('.ev')){if(((await e.getAttribute('aria-label'))||'').includes(txt)){await e.click();return}}throw new Error('ev '+txt)};
const esc=async()=>{await p.keyboard.press('Escape');await p.keyboard.press('Escape')};
const newBtn=async()=>{await p.click('#bNew');await p.waitForTimeout(120)};
await ok('1:1 som Zen',async()=>{await newBtn();await p.click('[data-ftype="enskilt"]');await p.selectOption('#fWith','s3');await p.click('#fPick');await p.click('#fForm button[type=submit]')});
await ok('möte med deltagare',async()=>{await esc();await newBtn();await p.click('[data-ftype="mote"]');await p.fill('#fTitle','Reg-möte');await p.click('[data-att="s1"]');await p.click('[data-dur="15"]');await p.click('#fForm button[type=submit]')});
await ok('flytta möte',async()=>{await p.click('[data-act="flytta"]')});
await ok('ställ in möte',async()=>{await p.click('[data-act="stall"]')});
await ok('datumväljare tangentbord',async()=>{await newBtn();await p.click('#fDayBtn');await p.keyboard.press('ArrowRight');await p.keyboard.press('Enter');if(!(await p.textContent('#fDayBtn')).includes('v.'))throw new Error('no week')});
await ok('uppgift',async()=>{await p.click('[data-ftype="uppgift"]');await p.fill('#fTitle','Reg-uppgift');await p.click('#fForm button[type=submit]')});
await ok('Elin svarar ja',async()=>{await esc();await p.selectOption('#viewas','s1');await clickNote('Överlämning');await p.click('[data-rsvp="ja"]')});
await ok('Elin föreslår ny tid',async()=>{await p.click('[data-rsvp="ny"]');await p.click('[data-dur="30"]');await p.fill('#fNote','reg');await p.click('#fForm button[type=submit]')});
await ok('Zen godkänner',async()=>{await esc();await p.selectOption('#viewas','z');await clickNote('föreslår');await p.click('[data-prop-ok]')});
await ok('Zen föreslår i serie',async()=>{await esc();await clickEv('Leveransavst');await p.click('[data-rsvp="ny"]');await p.click('#fForm button[type=submit]')});
await ok('1:1 agenda + uppgift',async()=>{await esc();await clickNote('Elin lade till');await p.fill('#agInput','Reg-punkt');await p.click('#agForm button');const t=await p.$('[data-totask]');if(t)await t.click()});
await ok('Sara bokar från kön',async()=>{await esc();await p.selectOption('#viewas','d1');await p.click('.qitem');await p.click('#qBook')});
await ok('nådd + kickoff',async()=>{await p.click('[data-act="nadd"]');await p.click('[data-act="kickoff"]')});
await ok('leveranspost med påminnelse',async()=>{await esc();await newBtn();await p.click('[data-preset="avst30"]');await p.check('#fRemCust');await p.click('#fForm button[type=submit]')});
await ok('ej svar',async()=>{await esc();await p.selectOption('#viewas','d2');await clickEv('Välkomstsamtal 2');await p.click('[data-act="ejsvar"]')});
await ok('vyer',async()=>{await esc();for(const k of ['1','3','4','5','2']){await p.keyboard.press('Control+Alt+'+k);await p.waitForTimeout(60)}});

// ---- varv 1 ----
await ok('dra för att skapa',async()=>{await esc();await p.selectOption('#viewas','z');await p.keyboard.press('Control+Alt+3');await p.waitForTimeout(100);
  const col=(await p.$$('.col.weekend'))[0];await (await col.$$('.hit'))[18].scrollIntoViewIfNeeded();const hits=await col.$$('.hit');const a=await hits[18].boundingBox(),b=await hits[21].boundingBox();
  await p.mouse.move(a.x+20,a.y+5);await p.mouse.down();await p.mouse.move(b.x+20,b.y+8,{steps:6});await p.mouse.up();await p.waitForTimeout(150);
  const st=await p.$eval('#fStart',x=>x.options[x.selectedIndex].text),en=await p.$eval('#fEnd',x=>x.options[x.selectedIndex].text);if(!en.includes('2 h'))throw new Error(st+' '+en)});
await ok('krockvarning',async()=>{await p.click('[data-ftype="mote"]');await p.fill('#fTitle','Krocktest');await p.selectOption('#fStart',String(8*60+15));await p.click('[data-dur="15"]');await p.click('#fForm button[type=submit]');await p.waitForSelector('#fClash');await p.click('#fForce')});
await ok('ångra',async()=>{await p.click('#tUndo');const t=(await p.textContent('#toast'));if(!t.includes('Ångrat'))throw new Error(t)});
await ok('ändra längd',async()=>{await esc();const ev=await p.$('.ev[aria-label*="Provisionsunderlag"] .rz');await ev.scrollIntoViewIfNeeded();const bb=await ev.boundingBox();await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await p.mouse.down();await p.mouse.move(bb.x+bb.width/2,bb.y+60,{steps:5});await p.mouse.up();await p.waitForTimeout(100);if(!(await p.textContent('#toast')).startsWith('Nu '))throw new Error('no resize toast')});
await ok('serie: hela serien',async()=>{await p.locator('.ev[aria-label*="1:1 Elin"]').first().dragTo(p.locator('.col.today .hit').nth(20));await p.waitForSelector('#smAll');await p.click('#smAll')});
await ok('bakom kulisserna',async()=>{await p.click('#bLog');const n=await p.$$eval('#xlist li',l=>l.length);if(n<5)throw new Error('log '+n);await p.click('#bLog')});
await ok('jämn fördelning + komplettera',async()=>{await p.selectOption('#viewas','d1');await p.waitForTimeout(100);let it=null;for(const q of await p.$$('.qitem')){if((await q.textContent()).includes('Villa Vy')){it=q;break}}await it.click();await p.click('[data-ask]');await p.selectOption('#qp','jamn');await p.click('#qBook')});

// ---- varv 2 ----
await ok('agendavy',async()=>{await esc();await p.selectOption('#viewas','z');await p.keyboard.press('Control+Alt+6');await p.waitForTimeout(100);const n=await p.$$eval('.agitem',l=>l.length);if(n<5)throw new Error('agenda '+n);await (await p.$('button.agitem')).click();await p.waitForSelector('#drawer.open')});
await ok('sök',async()=>{await esc();await p.fill('#q','nora');await p.waitForTimeout(100);const n=await p.$$eval('#qhits [data-jump]',l=>l.length);if(!n)throw new Error('inga träffar');await p.click('#qhits [data-jump]');await p.waitForSelector('#drawer.open');await p.fill('#q','')});
await ok('svara från klockan',async()=>{await esc();await p.click('#bBell');await p.click('[data-nq="kanske"]');if(!(await p.textContent('#toast')).includes('kanske'))throw new Error('no rsvp');await p.keyboard.press('Escape')});
await ok('+N fler',async()=>{for(const n of ['A','B']){await p.click('#bNew');await p.click('[data-ftype="uppgift"]');await p.fill('#fTitle','Krock '+n);await p.selectOption('#fStart',String(8*60+15));await p.click('#fForm button[type=submit]');await p.waitForTimeout(80);await esc()}
  await p.keyboard.press('Control+Alt+2');await p.waitForTimeout(100);const b=await p.$('.evmore');if(!b)throw new Error('ingen +N');await b.click();if(!(await p.$eval('[data-v="dag"]',x=>x.getAttribute('aria-pressed')))==='true')throw new Error('ej dagvy')});
await ok('plus i dagrubrik',async()=>{await p.keyboard.press('Control+Alt+2');await p.waitForTimeout(80);await p.click('.dhadd');await p.waitForSelector('#fForm');await esc()});
await ok('visa avböjda',async()=>{await p.check('#showDec');await p.waitForTimeout(80);if(!(await p.$('.ev.declined')))throw new Error('inget avböjt');await p.uncheck('#showDec')});
await ok('kopiera till nästa vecka',async()=>{await p.locator('.ev[aria-label*="Veckoavslut"]').first().click();await p.click('[data-act="kopiera"]')});
await ok('1:1 förbered',async()=>{await esc();await p.click('[data-demo="3"]');await p.waitForTimeout(150);await p.click('[data-act="prep"]')});
await ok('manuell CRM',async()=>{await esc();await p.selectOption('#viewas','d2');await p.waitForTimeout(80);await p.keyboard.press('Control+Alt+6');await p.waitForTimeout(80);await p.locator('.agitem[data-e]',{hasText:'Villa Vy'}).first().click();await p.fill('#crmId','LC-10490');await p.click('[data-crmform] button')});
await ok('visa mig 1-7',async()=>{for(const n of ['1','2','5','7']){await p.click(`[data-demo="${n}"]`);await p.waitForTimeout(120)}});

// ---- v7: ny tid = svara igen ----
await ok('flytt nollställer svar',async()=>{await esc();await p.selectOption('#viewas','z');await p.keyboard.press('Control+Alt+2');await p.waitForTimeout(80);
  await p.locator('.ev[aria-label*="Överlämning"]').first().click();await p.click('[data-act="flytta"]');const t=await p.textContent('#toast');if(!t.includes('behöver bekräfta'))throw new Error(t);
  await esc();await p.selectOption('#viewas','d1');await p.click('#bBell');const q=await p.$('[data-nq="ja"]');if(!q)throw new Error('Sara saknar svarsknappar');await q.click();if(!(await p.textContent('#toast')).includes('ja'))throw new Error('inget svar')});
await ok('serie: en gång nollställer bara den',async()=>{await p.keyboard.press('Escape');await p.selectOption('#viewas','z');await p.keyboard.press('Control+Alt+2');await p.waitForTimeout(80);
  const src=p.locator('.ev[aria-label*="1:1 Adam"]').first(),dst=p.locator('.col.today .hit').nth(22);await dst.scrollIntoViewIfNeeded();await src.scrollIntoViewIfNeeded();const a=await src.boundingBox(),z=await dst.boundingBox();await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(z.x+z.width/2,z.y+z.height/2,{steps:12});await p.mouse.up();await p.click('#smOne',{timeout:4000});const t=await p.textContent('#toast');if(!t.includes('Adam behöver bekräfta'))throw new Error(t);
  await p.selectOption('#viewas','s2');await p.click('#bBell',{timeout:4000});await p.click('[data-nq="ja"]',{timeout:4000});const t2=await p.textContent('#toast');if(!t2.includes('Svar skickat för'))throw new Error(t2)});
const H=await p.evaluate(()=>document.documentElement.scrollHeight);
await p.selectOption('#viewas','z');await p.waitForTimeout(100);
await (await p.$('#proto')).screenshot({path:PRE+'-light.png'});
const d=await b.newPage({viewport:{width:1320,height:1000},colorScheme:'dark'});d.on('pageerror',e=>errs.push('D:'+e.message));
await d.goto('file://'+process.cwd()+'/'+FILE);await d.waitForTimeout(300);await (await d.$('#proto')).screenshot({path:PRE+'-dark.png'});
const m=await b.newPage({viewport:{width:400,height:860}});m.on('pageerror',e=>errs.push('M:'+e.message));
await m.goto('file://'+process.cwd()+'/'+FILE);await m.waitForTimeout(300);await m.screenshot({path:PRE+'-mobile.png'});
const sw=await m.evaluate(()=>document.documentElement.scrollWidth);
for(const r of out)console.log(r.join(' | '));
console.log('sidhöjd',H,'px | mobil scrollWidth',sw,'| fel',JSON.stringify(errs));
await b.close();})();
