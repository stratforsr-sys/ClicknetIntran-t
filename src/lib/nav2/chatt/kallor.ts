import "server-only";

import type { CurrentUser } from "@/lib/auth";
import { fullName } from "@/lib/auth";
import { intervallForVy } from "@/lib/leveranskalender";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { lasSidvis } from "@/lib/sidvis";
import { byggForslag, lasKrets } from "../forslag";
import { lasOrder, lasStatMoten } from "../hem-team";
import { hamtaKalposter } from "../kalender";
import { byggMoten } from "../moten";
import { svaraPaletten } from "../palettsvar";
import { byggProvision } from "../provision";
import { SOKMISSAR_PER_MINUT, senasteMinuten, underTak } from "../tak";
import { byggUppgifter } from "../uppgifter";
import { DOKUMENT_MAX, affarUr, dagUr, type Dokument, type Kallor } from "./verktyg";

/**
 * Chatten: de riktiga källorna bakom verktygen.
 *
 * Varje källa är ett tunt anrop till en byggfunktion som redan finns och som
 * redan avgör vad den inloggade får se. Talen för en krets (möten och order)
 * läses med service role, som Teamet i månaden gör, EFTER att `verktyg.ts` har
 * prövat kretsen: en säljare får bara läsa sina egna order med sin egen token.
 * Allt annat läses med personens egen klient, så att RLS gäller.
 *
 * En källa läses högst en gång per fråga.
 */
export function skapaKallor(user: CurrentUser): Kallor {
  const minne = new Map<string, Promise<unknown>>();
  const en = <T>(nyckel: string, las: () => Promise<T>): Promise<T> => {
    if (!minne.has(nyckel)) minne.set(nyckel, las());
    return minne.get(nyckel) as Promise<T>;
  };

  return {
    krets: () => en("krets", async () => lasKrets(await supabaseServer(), user)),
    personer: () =>
      en("personer", async () => {
        const db = supabaseAdmin();
        const rader = await lasSidvis<{ id: string; first_name: string; last_name: string }>((a, b) =>
          db.from("employee").select("id, first_name, last_name").neq("status", "offboarded").order("id").range(a, b) as unknown as PromiseLike<{ data: { id: string; first_name: string; last_name: string }[] | null; error: { message: string } | null }>,
        );
        return rader.map((p) => ({ id: p.id, namn: fullName(p) }));
      }),
    // Två dygn före periodens första dag, så att ett möte nära midnatt inte faller bort på tidszonen.
    moten: (franDag) => en(`moten:${franDag}`, () => lasStatMoten(supabaseAdmin(), new Date(Date.parse(`${franDag}T00:00:00Z`) - 2 * 864e5).toISOString())),
    // Kretsen sorteras i nyckeln: samma personer i en annan ordning är samma läsning.
    order: (krets, franManad) => en(`order:${franManad}:${krets ? [...krets].sort().join(",") : "alla"}`, () => lasOrder(supabaseAdmin(), krets, franManad)),
    forslag: () =>
      en("forslag", async () => {
        const f = await byggForslag(await supabaseServer(), user);
        return { pa: f.pa, oppna: f.oppna.map((o) => ({ rubrik: o.rubrik, rader: o.rader })), andrat: f.andrat.map((a) => ({ text: a.text, dom: a.dom, tal: a.tal })), trendrad: f.trendrad };
      }),
    vantar: () =>
      en("vantar", async () => {
        const supabase = await supabaseServer();
        // Palettens tre svar om det som behöver personen: beslut, kvitteringar och det som är försenat.
        const svar = await Promise.all(["besluta", "kvittera", "forsenat"].map((f) => svaraPaletten(supabase, user, f)));
        const med = svar.filter((s): s is NonNullable<typeof s> => !!s);
        return { sammanfattning: med.map((s) => s.lead).join(" "), rader: med.flatMap((s) => s.rows.map((r) => r[1])) };
      }),
    // Kalendern läses en gång per vecka och uppgifterna en gång per fråga (N1). Kalendern för vyn "dag" hämtar alltid
    // hela veckan, måndag till söndag (`intervallForVy`), så "Hur ser veckan ut?" med fem `las_dag` läste förut samma
    // vecka fem gånger, och uppgifterna lika många. Veckans första dag är nyckeln; varje dag plockas ur den (`dagUr`).
    dag: async (dag) => {
      const vecka = intervallForVy("dag", dag).fran;
      const [kal, upp] = await Promise.all([
        en(`kal:${vecka}`, () => hamtaKalposter(user, "dag", vecka, [])),
        en("uppgifter", async () => byggUppgifter(await supabaseServer(), user)),
      ]);
      if (!kal) throw new Error("kalendern gick inte att läsa");
      return dagUr(kal.poster, upp.uppgifter, dag);
    },
    provision: (manad) =>
      en(`provision:${manad}`, async () => {
        const p = await byggProvision(await supabaseServer(), user);
        const u = p.underlag[manad]?.[p.jagId];
        if (!u) return null;
        return { summa: u.summa, bokfort: u.bokfort, signerade: u.antal.signerade, makulerade: u.antal.makulerade, netto: u.antal.netto, rader: u.rader.map((r) => ({ text: r.text, belopp: r.belopp })) };
      }),
    // Samma kort som tavlan i Möten, lästa som den inloggade: RLS avgör vilka affärer personen ser.
    affarer: () =>
      en("affarer", async () => {
        const m = await byggMoten(await supabaseServer(), user);
        if (m.fel) throw new Error("mötena gick inte att läsa");
        return m.kort.map((k) => affarUr(k, m.inst.kolumnnamn));
      }),
    // Kunskapsbasen (0312, Inställningar → Kunskapsbas) först, publicerade rutiner därefter. Båda läses som den
    // inloggade, så RLS avgör. Först alla sökorden, sedan något av dem, så att "sökord transport" hittar dokumentet
    // om transport fast ordet sökord inte står där.
    kunskap: (sokord) =>
      en(`kunskap:${sokord}`, async () => {
        const db = await supabaseServer();
        const stycken = async (q: string): Promise<Dokument[]> => {
          const { data, error } = await db.rpc("kunskap_sok", { p_sokord: q, p_max: DOKUMENT_MAX });
          if (error) throw new Error(error.message);
          return ((data ?? []) as { titel: string; omrade: string; rubrik: string; text: string; andrad: string }[]).map((d) => ({ rubrik: d.rubrik && d.rubrik !== d.titel ? `${d.titel}: ${d.rubrik}` : d.titel, omrade: d.omrade, text: d.text, andrad: d.andrad, kalla: "kunskapsbasen" }));
        };
        const rutiner = async (q: string): Promise<Dokument[]> => {
          const { data, error } = await db.from("document").select("title, category_path, body_md, updated_at").eq("status", "published").textSearch("search", q, { type: "websearch", config: "swedish" }).order("updated_at", { ascending: false }).limit(DOKUMENT_MAX);
          if (error) throw new Error(error.message);
          return ((data ?? []) as { title: string; category_path: string | null; body_md: string | null; updated_at: string }[]).map((d) => ({ rubrik: d.title, omrade: d.category_path ?? "", text: d.body_md ?? "", andrad: d.updated_at, kalla: "rutiner" }));
        };
        const sok = async (q: string): Promise<Dokument[]> => {
          const k = await stycken(q);
          return k.length >= DOKUMENT_MAX ? k : [...k, ...(await rutiner(q))].slice(0, DOKUMENT_MAX);
        };
        const alla = await sok(sokord);
        if (alla.length) return { dokument: alla, allaOrden: true };
        const ord = sokord.split(/\s+/).filter((o) => o.length > 2 && o.toLowerCase() !== "or");
        return { dokument: ord.length > 1 ? await sok(ord.join(" or ")) : [], allaOrden: false };
      }),
    // Listan över det kunskapsbasen saknar (`kunskap_miss`, visas i Inställningar → Kunskapsbas). Raden har ingen person.
    kunskapMiss: async (sokord) => {
      const db = supabaseAdmin();
      if (!(await underTak(db, { tabell: "kunskap_miss", kolumn: "nar", fran: senasteMinuten() }, SOKMISSAR_PER_MINUT))) return false;
      const { error } = await db.from("kunskap_miss").insert({ sokord: sokord.slice(0, 200) });
      return !error;
    },
  };
}
