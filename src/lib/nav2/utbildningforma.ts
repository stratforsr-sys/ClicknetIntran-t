/**
 * Nav 2.0: repots kursmoduler som utkastets lektionssteg.
 *
 * En modul i repot är en text (`body_md`) av sorten läsning, övning, prov eller
 * rollspel. Utkastets spelare visar steg: en regel med förklaring, en övning
 * med bockar, en fråga, och till sist "ditt mål". Omvandlingen ändrar inget
 * innehåll: texten delas vid sina rubriker, regeln är avsnittets första citat
 * eller fetstilta rad, och resten visas som den är.
 *
 * Provfrågor har facit bara när det får visas (`ratt` är annars null): repot
 * visar facit först när provet är klarat, och spelaren rättar då inte på
 * vägen, utan lämnar in provet i sista steget.
 */

export type NdSteg =
  | { typ: "text"; rubrik: string; regel: string; md: string }
  | { typ: "ovning"; text: string; check: string[]; md: string }
  | { typ: "fraga"; prov: boolean; q: string; alt: string[]; oids: string[]; qid: string; ratt: number | null; forkl: string }
  | { typ: "rollspel"; modul: string }
  | { typ: "mal" };

export type NdFraga = { id: string; prompt: string; alternativ: { id: string; label: string; ratt: boolean | null }[] };

// Markeringar bort, men en platshållare som "___" står kvar.
const ren = (s: string) => s.replace(/_{2,}/g, "\u0000").replace(/[*_`>]/g, "").replace(/\u0000/g, "___").replace(/\s+/g, " ").trim();

function avsnitt(md: string): { rubrik: string; text: string }[] {
  const text = (md ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  return text
    .split(/\n(?=##\s)/)
    .map((b) => {
      const m = b.match(/^##\s+(.*)\n?([\s\S]*)$/);
      return m ? { rubrik: m[1].trim(), text: m[2].trim() } : { rubrik: "", text: b.trim() };
    })
    .filter((a) => a.rubrik || a.text);
}

/** Avsnittets regel: första citatet, annars första fetstilta stycket, annars första meningen. */
function regelUr(text: string, reserv: string): string {
  const citat = text.split("\n").filter((r) => r.trim().startsWith(">"));
  if (citat.length) return ren(citat.join(" ")).slice(0, 300);
  const fet = text.match(/^\*\*(.+?)\*\*/m);
  if (fet) return ren(fet[1]).slice(0, 300);
  const forsta = ren(text.split(/\n\s*\n/)[0] ?? "").split(/(?<=[.!?])\s/)[0];
  return forsta ? forsta.slice(0, 300) : reserv;
}

export function minuterFor(kind: string, body: string, fragor: number): number {
  if (kind === "roleplay") return 10;
  if (kind === "quiz") return Math.max(2, Math.round(fragor * 0.5) + 1);
  return Math.max(2, Math.round((body ?? "").split(/\s+/).length / 180));
}

export function modulTillSteg(m: { id: string; title: string; kind: string; body_md: string }, fragor: NdFraga[]): NdSteg[] {
  const steg: NdSteg[] = [];
  const delar = avsnitt(m.body_md);
  if (m.kind === "quiz") {
    if (delar.length) steg.push({ typ: "text", rubrik: "Om provet", regel: regelUr(delar[0].text, m.title), md: m.body_md.trim() });
    for (const f of fragor) {
      const ratt = f.alternativ.findIndex((a) => a.ratt === true);
      const kand = f.alternativ.some((a) => a.ratt !== null);
      steg.push({ typ: "fraga", prov: true, q: f.prompt, alt: f.alternativ.map((a) => a.label), oids: f.alternativ.map((a) => a.id), qid: f.id, ratt: kand && ratt >= 0 ? ratt : null, forkl: "" });
    }
  } else {
    for (const d of delar.slice(0, 10)) steg.push({ typ: "text", rubrik: d.rubrik || m.title, regel: regelUr(d.text, d.rubrik || m.title), md: d.text });
    if (m.kind === "ovning") {
      const lista = m.body_md.split("\n").map((r) => r.trim()).filter((r) => /^\d+\.\s/.test(r)).map((r) => ren(r.replace(/^\d+\.\s*/, ""))).filter((r) => r.length <= 120).slice(0, 6);
      const fet = m.body_md.match(/\*\*(.+?)\*\*/);
      steg.push({ typ: "ovning", text: fet ? ren(fet[1]) : m.title, check: lista.length ? lista : ["Gjort"], md: "" });
    }
    if (m.kind === "roleplay") steg.push({ typ: "rollspel", modul: m.id });
  }
  if (!steg.length) steg.push({ typ: "text", rubrik: m.title, regel: m.title, md: "" });
  steg.push({ typ: "mal" });
  return steg;
}

/**
 * Repetition i rad, med frysdagar (beställaren 2026-10-20, U3).
 *
 *   - Sviten räknar dagar med minst ett svar. Dagar då man inte förväntas
 *     repetera (`ledig`: helg, röd dag, godkänd ledighet hela dagen, sjuk)
 *     varken räknas eller bryter.
 *   - Fem dagar med repetition, en hel arbetsvecka, ger en frysdag. Högst två
 *     är sparade.
 *   - En missad dag tar en frysdag automatiskt, och sviten står kvar. Utan
 *     frysdag börjar den om.
 *   - I dag bryter aldrig sviten: dagen är inte slut än.
 *
 * Ren, så att den går att prova utan databas.
 */
export function svit(dagar: Set<string>, idag: string, ledig: (dag: string) => boolean): { streak: number; bast: number; frys: number } {
  const forsta = [...dagar].filter((d) => d <= idag).sort()[0];
  let streak = 0, bast = 0, frys = 0, iRad = 0;
  if (!forsta) return { streak, bast, frys };
  for (let d = forsta, n = 0; d <= idag && n < 800; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10), n++) {
    if (ledig(d)) continue;
    if (dagar.has(d)) {
      streak++;
      bast = Math.max(bast, streak);
      if (++iRad === 5) { iRad = 0; frys = Math.min(2, frys + 1); }
    } else if (d === idag) continue;
    else if (frys > 0) frys--;
    else { streak = 0; iRad = 0; }
  }
  return { streak, bast, frys };
}
