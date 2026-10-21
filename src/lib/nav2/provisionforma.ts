/**
 * Nav 2.0: provisionen i den form utkastet ritar — ren logik ovanpå repots motor.
 *
 * Allt som räknar här är repots: `raknaUnderlag`, `underlagForAlla`,
 * `gallandeNivaer`, `takta`, `kvManad`, `varningslage`, `summera` och
 * `slagetFor`. Filen tar emot det `provision.ts` hämtat (samma hämtningar som
 * /provision) och lämnar ut talen. Den är ren så att samma kod körs i Next och
 * i provet lokalt mot riktig data.
 */

import { manadFore, slagetFor, summera, SLAGSETIKETT, type Provisionspost } from "../provision.ts";
import type { Order } from "../order.ts";
import { ATGARD_ETIKETT, konsekvenslageFor, lagenPerPerson, varningslage, type Handelse, type Konsekvensregel } from "../konsekvens.ts";
import {
  gallandeNivaer,
  kvarTillNasta,
  kvBas,
  raknaUnderlag,
  underlagForAlla,
  type Bonusniva,
  type Chefspost,
  type KvIndata,
  type Underlag,
} from "../provision-motor.ts";
import { arbetsdagarIManad, takta, type Saljmal } from "../saljtakt.ts";
import { gallandePolicy, kvManad, maxpoangPerVecka, veckansTorsdag, veckonummer, veckostart, type KvKriterium, type KvPolicy, type KvSamtal } from "../kv.ts";

export type Niva = { t: number; a: number; enhet: string };
export type NdPvRad = { slag: string; text: string; belopp: number; orderId: string | null; bokford: boolean; note: string | null; dag: string | null };
export type NdPvUnderlag = {
  rader: NdPvRad[];
  antal: { signerade: number; makulerade: number; netto: number; bonusgrundande: number };
  grund: number;
  volym: number;
  niva: Niva | null;
  nasta: (Niva & { kvar: number }) | null;
  kv: { godkanda: number; bedomda: number; procent: number; belopp: number; perVecka: number; tak: number } | null;
  ovrig: number;
  chefs: { antal: number; makulerade: number; belopp: number; per: Record<string, number> } | null;
  varde: number;
  utanVarde: number;
  utkop: number;
  finans: number;
  summa: number;
  bokfort: number;
  /** Raknaren borjar om fran det har datumet (bonusforlust), annars null. */
  forlust: string | null;
};
export type NdPvTakt = {
  gangna: number;
  totalt: number;
  kvar: number;
  andel: number;
  prognos: { antal: number; grund: number; niva: Niva | null; bonus: number; totalt: number; nasta: (Niva & { kvar: number }) | null } | null;
};

export type NdProvision = {
  /** 0087: lönesystemets summor före motorn, per manad ("YYYY-MM") och person. */
  historik?: Record<string, Record<string, number>>;
  /** Sparar vyn (SKRIVLAGE.provision)? Annars svarar /nav2/provision med läsläge. */
  skriv?: boolean;
  idag: string;
  manad: string;
  /** Tolv manader, nyast forst, "YYYY-MM". */
  manader: string[];
  chefsvy: boolean;
  malchef: boolean;
  bokforare: boolean;
  jagId: string;
  personer: { id: string; namn: string; anst: string | null; saljare: boolean }[];
  perioder: Record<string, { status: string; stangd: string; utbetald: string | null }>;
  trappor: Record<string, Niva[]>;
  /** Alla versioner av trappan, for reglerna. */
  versioner: { fran: string; till: string | null; nivaer: Niva[] }[];
  underlag: Record<string, Record<string, NdPvUnderlag>>;
  takt: Record<string, NdPvTakt>;
  mal: Record<string, Record<string, { o: number | null; k: number | null }>>;
  arbetsdagar: Record<string, string[]>;
  /** K&V-veckorna per manad: veckonumren, och per person ett lage per vecka. */
  kvVeckor: Record<string, { nummer: number[]; per: Record<string, [string, number?][]> }>;
  kvPolicy: { procent: number; tak: number; troskel: number; max: number | null; samtal: number } | null;
  varning: { antal: number; sist: string; nollstalls: string; nasta: string | null } | null;
  /** Ovriga bonusar i huvudboken (`ovrig_bonus`), for listan i Perioder. */
  ovriga: { id: string; vemId: string; m: string; belopp: number; skal: string; bokford: boolean }[];
  /** Chefens sats (0050), bara for superadmin. Annars null. */
  chefssats?: NdChefssats | null;
  /** Konsekvenstrappan for ogiltig franvaro (0037), i ordning. Alla ser den; saljchef och VD andrar (`malchef`). */
  konsekvens?: { ordning: number; antal: number; manader: number; atgard: string; notifiera: boolean }[];
};

/**
 * Chefens sats: alla versioner av `manager_commission_rate`, nyast forst, och
 * vilka som kan fa overtacket. `till` ar dagen raden slutade galla (som
 * trappans `valid_to`), null for den oppna. `av` ar den som satte raden.
 */
export type NdChefssats = {
  rader: { id: string; vemId: string; vem: string; overtack: number; egen: number; fran: string; till: string | null; av: string | null }[];
  mottagare: { id: string; namn: string }[];
};


export type Post = Provisionspost & {
  id: string;
  employee_id: string;
  source: string;
  external_ref: string | null;
  kind: string | null;
  sales_order_id: string | null;
  note: string | null;
  entered_at: string;
};

export type ProvisionIndata = {
  mig: string;
  provisionschef: boolean;
  malchef: boolean;
  bokforare: boolean;
  /** Innevarande månad, "YYYY-MM-01". */
  idag: string;
  idagsDatum: string;
  poster: Post[];
  material: (Order & { company_name: string; cancelled_on: string | null })[];
  nivaer: Bonusniva[];
  perioder: { period_month: string; status: string; closed_at: string; paid_at: string | null }[];
  minaHandelser: Handelse[];
  regler: Konsekvensregel[];
  godkanda: Handelse[];
  kvPerManad: Map<string, Map<string, KvIndata>>;
  mal: Saljmal[];
  chefsposter: Chefspost[];
  kvSamtal: KvSamtal[];
  policyer: KvPolicy[];
  kriterier: KvKriterium[];
  personrader: { id: string; first_name: string; last_name: string; status: string; employee_number: string | null; roller: string[] }[];
};

const nivaAv = (n: Bonusniva | null | undefined): Niva | null => (n ? { t: n.threshold, a: n.amount, enhet: n.unit } : null);
const m7 = (m: string) => m.slice(0, 7);
const fullName = (e: { first_name: string; last_name: string }) => `${e.first_name} ${e.last_name}`.trim();

export function formaProvision(x: ProvisionIndata): NdProvision {
  const { mig, provisionschef, malchef, bokforare, idag, idagsDatum, poster, material, nivaer, perioder, minaHandelser, regler, godkanda, kvPerManad, mal, chefsposter, kvSamtal, policyer, kriterier, personrader } = x;
  const manader = Array.from({ length: 12 }, (_, i) => manadFore(idag, i));
  const namnFor = new Map((personrader ?? []).map((p) => [p.id as string, fullName(p)]));
    const saljarIds = new Set(
    (personrader ?? []).filter((p) => p.roller.includes("salesperson") && ["active", "onboarding"].includes(p.status as string)).map((p) => p.id as string),
  );
  const orderFor = new Map(material.map((o) => [o.id, o]));

  const underlag: NdProvision["underlag"] = {};
  const takt: NdProvision["takt"] = {};
  const trappor: NdProvision["trappor"] = {};
  const arbetsdagar: NdProvision["arbetsdagar"] = {};
  const kvVeckor: NdProvision["kvVeckor"] = {};
  const synliga = new Set<string>([mig]);

  for (const m of manader) {
    const nyckel = m7(m);
    const trappa = gallandeNivaer(nivaer, m);
    trappor[nyckel] = trappa.map((n) => nivaAv(n)!);
    arbetsdagar[nyckel] = arbetsdagarIManad(m);
    const stangd = perioder.some((p) => String(p.period_month).slice(0, 10) === m);
    const kvM = kvPerManad.get(m) ?? new Map<string, KvIndata>();
    const lagenM = lagenPerPerson(godkanda, m);

    const lista: Underlag[] = provisionschef
      ? underlagForAlla(material, m, nivaer, kvM, lagenM, chefsposter)
      : [raknaUnderlag(mig, material, m, nivaer, kvM.get(mig) ?? null, lagenM.get(mig) ?? null, chefsposter.filter((p) => p.manager_id === mig))];
    // Saljarna och jag sjalv ska alltid ha en rad, aven en tom manad.
    const har = new Set(lista.map((u) => u.employee_id));
    const extra = provisionschef ? [...saljarIds, mig] : [];
    for (const id of extra) {
      if (!har.has(id)) lista.push(raknaUnderlag(id, material, m, nivaer, kvM.get(id) ?? null, lagenM.get(id) ?? null, chefsposter));
    }

    underlag[nyckel] = {};
    for (const u of lista) {
      synliga.add(u.employee_id);
      const egna = poster.filter((p) => p.employee_id === u.employee_id);
      const bokfort = summera(egna, m).belopp;
      const iManaden = egna.filter((p) => p.period_month === m);
      const ledger: NdPvRad[] = iManaden.map((p) => {
        const slag = slagetFor(p) ?? "hand";
        return { slag, text: SLAGSETIKETT[slag] ?? "Bokfört för hand", belopp: p.amount, orderId: p.sales_order_id, bokford: true, note: p.note, dag: p.entered_at.slice(0, 10) };
      });
      const live: NdPvRad[] = u.rader.map((r) => {
        const o = r.order_id ? orderFor.get(r.order_id) : undefined;
        const dag = o ? (r.slag === "makulering" || r.slag === "chefsprovision_makulering" ? o.cancelled_on ?? o.signed_on : o.signed_on) : null;
        return { slag: r.slag, text: r.text, belopp: r.belopp, orderId: r.order_id ?? null, bokford: false, note: null, dag };
      });

      // Overtacket per saljare, ur de frysta posterna (0050).
      let chefs: NdPvUnderlag["chefs"] = null;
      if (u.chefsprovision) {
        const per: Record<string, number> = {};
        for (const p of chefsposter.filter((x) => x.manager_id === u.employee_id)) {
          const o = orderFor.get(p.order_id);
          const vem = o ? namnFor.get(o.salesperson_id) ?? "Okänd" : "Okänd";
          if (p.period_month.slice(0, 10) === m) per[vem] = (per[vem] ?? 0) + p.amount;
          if (p.makulerad && p.cancel_period_month?.slice(0, 10) === m) per[vem] = (per[vem] ?? 0) - p.amount;
        }
        chefs = { ...u.chefsprovision, per };
      }

      const kv = u.kv
        ? {
            godkanda: u.kv.godkanda,
            bedomda: kvM.get(u.employee_id)?.bedomda ?? u.kv.godkanda,
            procent: u.kv.procent,
            belopp: u.kv.belopp,
            perVecka: Math.round((kvBas(u.grundprovision, u.volymbonus?.belopp ?? 0) * (gallandePolicy(policyer, m)?.percent_per_week ?? 0)) / 100),
            tak: Math.round((kvBas(u.grundprovision, u.volymbonus?.belopp ?? 0) * (gallandePolicy(policyer, m)?.cap_percent ?? 0)) / 100),
          }
        : null;

      underlag[nyckel][u.employee_id] = {
        // STANGD: huvudboken. OPPEN: motorns rader och det som bokforts for hand.
        rader: stangd ? ledger : [...live, ...ledger],
        antal: u.antal,
        grund: u.grundprovision,
        volym: u.volymbonus?.belopp ?? 0,
        niva: nivaAv(u.volymbonus?.niva),
        nasta: u.nasta ? { ...nivaAv(u.nasta.niva)!, kvar: u.nasta.kvar } : null,
        kv,
        ovrig: iManaden.filter((p) => slagetFor(p) === "ovrig_bonus").reduce((s, p) => s + p.amount, 0),
        chefs,
        varde: u.ordervarde.netto,
        utanVarde: u.ordervarde.utanVarde,
        utkop: u.ordervarde.utkop,
        finans: u.ordervarde.finans,
        summa: bokfort + (stangd ? 0 : u.summa),
        bokfort,
        forlust: u.konsekvens?.bonusforlust ? u.konsekvens.raknareFran : null,
      };

      if (m === idag) {
        const t = takta(u, trappa, m, idagsDatum);
        takt[u.employee_id] = {
          gangna: t.gangna,
          totalt: t.totalt,
          kvar: t.kvar,
          andel: t.andel,
          prognos: t.prognos
            ? {
                antal: t.prognos.antal,
                grund: t.prognos.grundprovision,
                niva: nivaAv(t.prognos.niva),
                bonus: t.prognos.bonus,
                totalt: t.prognos.totalt,
                nasta: (() => { const k = kvarTillNasta(trappa, t.prognos!.antal); return k ? { ...nivaAv(k.niva)!, kvar: k.kvar } : null; })(),
              }
            : null,
        };
      }
    }

    // K&V-veckorna: veckor vars torsdag ligger i manaden, och varje persons lage per vecka.
    const policy = gallandePolicy(policyer, m);
    const nummer: number[] = [];
    const starter: string[] = [];
    for (let d = new Date(`${m}T12:00:00Z`); d.toISOString().slice(0, 7) === nyckel; d.setUTCDate(d.getUTCDate() + 1)) {
      const dag = d.toISOString().slice(0, 10);
      const s = veckostart(dag);
      if (!starter.includes(s) && veckansTorsdag(dag).slice(0, 7) === nyckel) { starter.push(s); nummer.push(veckonummer(s)); }
    }
    const per: Record<string, [string, number?][]> = {};
    if (policy) {
      for (const id of Object.keys(underlag[nyckel])) {
        const veckor = kvManad(kvSamtal.filter((s) => s.employee_id === id), m, policy).veckor;
        per[id] = starter.map((s): [string, number?] => {
          const v = veckor.find((x) => x.start === s);
          if (s > veckostart(idagsDatum) || s === veckostart(idagsDatum)) return ["-"];
          if (!v || v.bedomda === 0) return ["e"];
          if (!v.fullstandig) return ["h"];
          return [v.godkand ? "g" : "u", v.poang];
        });
      }
    }
    kvVeckor[nyckel] = { nummer, per };
  }

  // Malen: perioden och tre manader framat, som /provision/mal.
  const malUt: NdProvision["mal"] = {};
  for (const x of mal) {
    const k = m7(x.period_month);
    (malUt[k] ??= {})[x.employee_id] = { o: x.mal_order, k: x.mal_kronor };
  }

  const policyNu = gallandePolicy(policyer, idag);
  const vl = varningslage(minaHandelser, regler, idagsDatum);
  const lageNu = konsekvenslageFor(minaHandelser, idag);
  const sist = minaHandelser.filter((h) => h.status === "godkand").map((h) => h.occurred_on).sort().pop() ?? null;

  const versioner = [...new Set(nivaer.map((n) => n.valid_from))].sort().map((fran) => {
    const v = nivaer.filter((n) => n.valid_from === fran).sort((a, b) => a.threshold - b.threshold);
    return { fran, till: v[0]?.valid_to ?? null, nivaer: v.map((n) => nivaAv(n)!) };
  });

  return {
    idag: idagsDatum,
    manad: m7(idag),
    manader: manader.map(m7),
    chefsvy: provisionschef,
    malchef,
    bokforare,
    jagId: mig,
    personer: (personrader ?? [])
      .filter((p) => synliga.has(p.id as string) || saljarIds.has(p.id as string))
      .map((p) => ({ id: p.id as string, namn: fullName(p), anst: (p.employee_number as string | null) ?? null, saljare: saljarIds.has(p.id as string) }))
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    perioder: Object.fromEntries(
      perioder.map((p) => [m7(String(p.period_month)), { status: p.status, stangd: String(p.closed_at).slice(0, 10), utbetald: p.paid_at ? String(p.paid_at).slice(0, 10) : null }]),
    ),
    trappor,
    versioner,
    underlag,
    takt,
    mal: malUt,
    arbetsdagar,
    kvVeckor,
    kvPolicy: policyNu
      ? { procent: policyNu.percent_per_week, tak: policyNu.cap_percent, troskel: policyNu.threshold_points, max: maxpoangPerVecka(kriterier, policyNu), samtal: policyNu.calls_per_week }
      : null,
    varning:
      vl && sist
        ? { antal: vl.antal, sist, nollstalls: vl.nollstallsDen, nasta: vl.nasta ? ATGARD_ETIKETT[vl.nasta.atgard] : lageNu?.bonusforlust ? "bonusforlust" : null }
        : null,
    ovriga: poster
      .filter((p) => slagetFor(p) === "ovrig_bonus")
      .map((p) => ({ id: p.id, vemId: p.employee_id, m: m7(p.period_month), belopp: p.amount, skal: p.note ?? "", bokford: perioder.some((x) => String(x.period_month).slice(0, 10) === p.period_month) })),
  };
}
