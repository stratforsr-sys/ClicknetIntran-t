"use client";

/**
 * Säljtavlan: källan, kön, spelaren, landningen och ljudet runt vyn i vila.
 *
 * ===========================================================================
 * TAVLAN BYTER NÄR KOMPOSITIONEN VILAT KLART, OCH LANDAR MEDAN DEN KRYMPER.
 *
 * En ny ögonblicksbild körs genom `planera` (regler.ts). Det som ska firas samlas
 * i en sekund, och kön samlas om och spelar en komposition i taget. Vad som spelas
 * och vad tavlan visar vid varje bildruta bestämmer ko.ts: tavlan visar den förra
 * bilden tills kompositionens vila är slut, byter då och landar: raderna byter
 * plats, talen rullar och grafen växer, räknat i bildrutor från bytet (`lr`).
 *
 * Kompositionens klocka är ljudklockan när ljudet går (`AudioContext.currentTime`),
 * annars `performance.now()`. Spåret läggs mot `ljud.nu() + 0,08` när den startar.
 * ===========================================================================
 *
 * Reglerna ligger i regler.ts (vad som firas), ko.ts (kön och vad som syns),
 * vy.ts (texter, former och landningens tider), motion/tider.ts (tider och
 * ljudspår) och hamtning.ts (hämtningarna), och provas där med node. Här finns
 * bara tillstånd, tid och webbläsare.
 *
 * Den här filen får aldrig importera parning.ts, tavlan.ts eller atkomst.ts:
 * de är serverkod.
 */

import { Component, useCallback, useEffect, useReducer, useRef, useState, type ReactElement, type ReactNode } from "react";
import { hornTillatet, inomArbetsdag, ljudTillatet, nastaStart, planera, type Minne } from "@/lib/salesboard/regler";
import { MELLANSPEL_MS, mellanspelDags, vinnareDags } from "@/lib/salesboard/tavling";
import type { Ogonblick, Ordning } from "@/lib/salesboard/typer";
import { natkalla, type Kalla, type Kallstatus } from "./kalla";
import { aktuell, forlopp, mottagning, nycklarFor, samlaKo, tavlansRorelse, visning as visningFor, type Forlopp, type Kopost, type Visning } from "./ko.ts";
import { Ljudmotor } from "./ljud.ts";
import { rektUtanTransform, type Rekt } from "./motion/delar";
import { FPS } from "./motion/matte.ts";
import { Knuffen, type KnuffenProps } from "./motion/Knuffen";
import { Malet, type MaletProps } from "./motion/Malet";
import { Spelare } from "./motion/motor";
import { Ordern, type OrderProps } from "./motion/Ordern";
import { Serie, type SerieProps } from "./motion/Serie";
import { Tavlingen, type TavlingenProps } from "./motion/Tavlingen";
import { Vila, malLage, type Landning, type Ljudlage } from "./Vila";
import { BLINK, LANDNING, OFFLINE_MS, UPP, byggomladdning, klockslag, nattomladdning, pixelskift } from "./vy.ts";

/** Händelser som kommer inom så lång tid samlas till ett firande (spec §5.1). */
const SAMLA_MS = 1_000;
/** Ljudspåret läggs så här långt fram, så att det första ljudet aldrig redan har passerat. */
const FORSPRANG = 0.08;
/** Fyra misslyckade hämtningar i rad laddar om tavlan, men inte under ett firande. */
const FEL_FOR_OMLADDNING = 4;
/** På en parad skärm fälls "Starta tavlan" ihop efter så lång tid, och tavlan syns igen. */
const START_FALLS_MS = 30_000;
/** Styrningen gömmer sig efter så lång tid utan mus. */
const STYR_MS = 3_000;
const MINNESNYCKEL = "salesboard.minne";
const ORDNINGSNYCKEL = "salesboard.ordning";
/** Personens senaste ljudval, så att en omladdning inte frågar igen. */
const LJUDVAL = "salesboard.ljudval";

// -----------------------------------------------------------------------------
// Typer
// -----------------------------------------------------------------------------

type Gemensamt = {
  id: number;
  forlopp: Forlopp;
  klocka: () => number;
  /** Ljudklockans tid för bildruta 0, eller null när spåret inte spelas. */
  ljudBas: number | null;
  /** Tavlan har bytt till det nya läget och landar. */
  bytt: boolean;
};

/** Ett förlopp som spelas: kompositionen och dess props hör ihop i typen. */
type Spelning = Gemensamt &
  (
    | { typ: "order"; props: OrderProps }
    | { typ: "serie"; props: SerieProps }
    | { typ: "malet"; props: MaletProps }
    | { typ: "halvvags"; props: null }
    | { typ: "tavling"; props: TavlingenProps }
    | { typ: "vinnare"; props: TavlingenProps }
    | { typ: "knuff"; props: KnuffenProps }
    | { typ: "grans"; props: KnuffenProps }
  );

/** Fönstret: pixlar per u (1 u = 1 px på 1920×1080) och storleken. */
type Fonster = { u: number; vw: number; vh: number };

// -----------------------------------------------------------------------------
// Små hjälpare
// -----------------------------------------------------------------------------

function las<T>(nyckel: string): T | null {
  try {
    const text = window.localStorage.getItem(nyckel);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function spara(nyckel: string, varde: unknown): void {
  try {
    window.localStorage.setItem(nyckel, JSON.stringify(varde));
  } catch {
    // Privat läge eller full lagring: tavlan minns bara till nästa omladdning.
  }
}

/** Samma formel som --u i CSS: under 900 px är skärmen 1 000 u bred. */
function fonstret(): Fonster {
  if (typeof window === "undefined") return { u: 1, vw: 1920, vh: 1080 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return { u: vw < 900 ? vw / 1000 : Math.min(vw / 1920, vh / 1080), vw, vh };
}

/**
 * Klockan för ett förlopp. Ljudklockan när ljudet går, annars väggklockan.
 * Tidbaserna skiljer sig, så valet görs vid start och byts inte; tystnar ljudet
 * mitt i fortsätter klockan på väggklockan därifrån, så att bildrutan varken
 * hoppar eller backar.
 */
function nyKlocka(ljud: Ljudmotor | null): { klocka: () => number; ljudBas: number | null } {
  const vagg = () => performance.now() / 1000;
  if (ljud && ljud.tillstand === "igang") {
    const bas = ljud.nu() + FORSPRANG;
    let sist = { k: -FORSPRANG, v: vagg() };
    return {
      ljudBas: bas,
      klocka: () => {
        if (ljud.tillstand === "igang") {
          const k = ljud.nu() - bas;
          sist = { k, v: vagg() };
          return k;
        }
        return sist.k + (vagg() - sist.v);
      },
    };
  }
  const bas = vagg() + FORSPRANG;
  return { ljudBas: null, klocka: () => vagg() - bas };
}

// -----------------------------------------------------------------------------
// Skydden
// -----------------------------------------------------------------------------

/**
 * Ett fel i en komposition får aldrig tömma tavlan: ingen står vid TV:n och
 * laddar om. Skyddet ritar ingenting i stället för kompositionen och säger till
 * kön att förloppet är slut.
 */
class Skydd extends Component<{ onFel: () => void; children: ReactNode }, { fel: boolean }> {
  state = { fel: false };
  static getDerivedStateFromError(): { fel: boolean } {
    return { fel: true };
  }
  componentDidCatch(): void {
    this.props.onFel();
  }
  render(): ReactNode {
    return this.state.fel ? null : this.props.children;
  }
}

/**
 * Ett fel i vyn i vila (en bild i en form tavlan inte väntat sig) ritar den senaste
 * vyn som gick att rita, tills nästa bild kommer. Kastar också den går felet vidare
 * till sidans error.tsx, som laddar om.
 */
class VilaSkydd extends Component<
  { nyckel: string; reserv: () => ReactNode; ok: (lyckad: boolean) => void; children: ReactNode },
  { felVid: string | null; fangat: boolean }
> {
  state = { felVid: null as string | null, fangat: false };
  static getDerivedStateFromError(): { fangat: boolean } {
    return { fangat: true };
  }
  static getDerivedStateFromProps(
    p: { nyckel: string },
    s: { felVid: string | null; fangat: boolean },
  ): { felVid: string | null; fangat: boolean } | null {
    if (!s.fangat && s.felVid !== null && s.felVid !== p.nyckel) return { felVid: null, fangat: false };
    return null;
  }
  componentDidCatch(): void {
    this.setState({ felVid: this.props.nyckel, fangat: false });
    this.props.ok(false);
  }
  componentDidMount(): void {
    this.props.ok(true);
  }
  componentDidUpdate(): void {
    this.props.ok(this.state.felVid === null && !this.state.fangat);
  }
  render(): ReactNode {
    return this.state.fangat || this.state.felVid !== null ? this.props.reserv() : this.props.children;
  }
}

// -----------------------------------------------------------------------------
// Tavlan
// -----------------------------------------------------------------------------

export default function Tavla({
  start,
  kalla,
  fryst,
  installningar = false,
  mellanspelEfterMs,
}: {
  start: Ogonblick;
  /** "nat" är navets källa. Förhandsvisningen skickar en egen. */
  kalla: Kalla | "nat";
  /** Knappen till Nav 2.0:s Inställningar → Säljtavlan. Bara för en inloggad superadmin, aldrig på en skärm. */
  installningar?: boolean;
  /** Bara förhandsvisningen: varje komposition står still på den här sekunden. */
  fryst?: number;
  /** Bara förhandsvisningen: det första mellanspelet kommer så här långt efter starten, inte efter tio minuter. */
  mellanspelEfterMs?: number;
}): ReactElement {
  // Tillståndet som kön och tiden ändrar. Allt läses vid ritningen; `rita()` ritar om.
  const t = useRef({
    visad: start,
    senaste: start,
    forra: null as Ogonblick | null,
    minne: null as Minne | null,
    ko: [] as Kopost[],
    insamlat: [] as Kopost[],
    samlar: null as ReturnType<typeof setTimeout> | null,
    spel: null as Spelning | null,
    nastaId: 1,
    senastHorn: null as number | null,
    startMs: 0,
    startBygge: start.bygge,
    nyttBygge: false,
    landning: null as Landning | null,
    landT0: 0,
    /** Order som kom in i flödet utan firande: de lyser till en gång. */
    tysta: new Set<string>(),
    /** Den senaste vyn som gick att rita (VilaSkydd). */
    sistaBra: null as Visning | null,
    vilaOk: true,
    /** Tävlingen: när mellanspelet senast hade sin tur, och när en knuff eller gränsscen senast spelades (servertid). */
    senastMellanspel: Date.parse(start.nu) - (mellanspelEfterMs !== undefined ? MELLANSPEL_MS - mellanspelEfterMs : 0),
    senastKnuff: null as number | null,
    /** Prisbilderna: adress → laddas, klar (avkodad) eller fel. En bild som felar visas inte. */
    bilder: new Map<string, "laddar" | "klar" | "fel">(),
  });
  const [, rita] = useReducer((x: number) => x + 1, 0);
  const [ruta, settRuta] = useState(0);
  const [lr, settLr] = useState<number | null>(null);
  const [status, settStatus] = useState<Kallstatus>({ live: false, senast: null, offset: 0, fel: 0 });
  const [klientMs, settKlientMs] = useState(() => Date.parse(start.nu));
  const [offset, settOffset] = useState(0);
  const [fonster, settFonster] = useState<Fonster>(fonstret);
  const [lugnMedia, settLugnMedia] = useState(false);
  const [mus, settMus] = useState(true);
  const [ordningVal, settOrdningVal] = useState<Ordning | null>(null);

  const ljud = useRef<Ljudmotor | null>(null);
  const [ljudTillstand, settLjudTillstand] = useState<"igang" | "blockerat" | "saknas">("saknas");
  const arSkarm = start.skarm !== null;
  /** Personens val (en inloggad måste klicka) och skärmens: "pa" försöker låta, "av" är tyst. */
  const [ljudval, settLjudval] = useState<"vantar" | "pa" | "av">(arSkarm ? "pa" : "vantar");
  const ljudUtanKlick = useRef(false);
  const ljudForsokt = useRef(false);
  const [startFalld, settStartFalld] = useState(false);

  const flodeRef = useRef<HTMLDivElement>(null);
  const kortRef = useRef<HTMLElement>(null);
  const helskarm = useRef<() => void>(() => undefined);

  const nuMs = klientMs + offset;
  const bildNu = t.current.senaste;
  const inst = bildNu.installningar;
  const lugn = lugnMedia || inst.rorelse === "lugn";
  const ordning: Ordning = ordningVal ?? inst.ordning;

  // Kön drivs av källans prenumeration och av timers, som startas en gång. Det de
  // läser av sidans tillstånd läses därför härifrån och aldrig ur en gammal closure.
  const levande = useRef({ lugnMedia, ljudval, offset, fonster, ordning });
  levande.current = { lugnMedia, ljudval, offset, fonster, ordning };

  // --- Lugn rörelse, fönstret och tavlans ordning -----------------------------
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const byt = () => settLugnMedia(Boolean(mq?.matches));
    byt();
    mq?.addEventListener?.("change", byt);
    const storlek = () => settFonster(fonstret());
    window.addEventListener("resize", storlek);
    // Ordningen som valts med V på den här skärmen står kvar över en omladdning.
    const sparad = las<Ordning>(ORDNINGSNYCKEL);
    if (sparad === "varde" || sparad === "antal") settOrdningVal(sparad);
    return () => {
      mq?.removeEventListener?.("change", byt);
      window.removeEventListener("resize", storlek);
    };
  }, []);

  // --- Klockan: en gång per sekund, på sekundskiftet -------------------------
  useEffect(() => {
    t.current.startMs = Date.now();
    settOffset(Date.parse(start.nu) - Date.now());
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      settKlientMs(Date.now());
      id = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(id);
  }, [start.nu]);

  useEffect(() => {
    if (status.senast !== null) settOffset(status.offset);
  }, [status.offset, status.senast]);

  // --- Mätpunkterna -------------------------------------------------------------
  /** Flödets översta `n` rader, där en order landar, i fönstrets pixlar. */
  const flodesRader = useCallback((n: number): Rekt => {
    const { u } = levande.current.fonster;
    const lista = rektUtanTransform(flodeRef.current);
    const rad = 50 * u;
    if (!lista) return { x: 1180 * u, y: 900 * u, w: 690 * u, h: rad * n };
    return { x: lista.x, y: lista.y, w: lista.w, h: rad * Math.max(1, Math.min(4, n)) };
  }, []);
  const malkortet = useCallback((): Rekt => {
    const { u } = levande.current.fonster;
    return rektUtanTransform(kortRef.current) ?? { x: 1180 * u, y: 120 * u, w: 690 * u, h: 300 * u };
  }, []);

  // --- Ljudet -------------------------------------------------------------------
  /** Får tavlan låta nu: inställningarna, ljudtiden, skärmens val och personens klick. */
  const farLata = useCallback((bild: Ogonblick, nu: number): boolean => {
    if (levande.current.ljudval !== "pa") return false;
    if (bild.skarm && bild.skarm.ljud === false) return false;
    return ljudTillatet(new Date(nu).toISOString(), bild.installningar.ljud);
  }, []);

  const lasUpp = useCallback(async (): Promise<boolean> => {
    const motor = (ljud.current ??= new Ljudmotor());
    const ok = await motor.lasUpp();
    // Ett sent resume() kan slå om tillståndet efter svaret: läs det igen.
    settLjudTillstand(motor.tillstand);
    return ok;
  }, []);

  // En parad skärm försöker låta så snart den ska: vid start, och när ljudet slås på
  // senare (skärmens val eller inställningen), utan omladdning (spec §6). En person klickar.
  const skaLata = arSkarm && bildNu.skarm?.ljud !== false && inst.ljud.pa;
  useEffect(() => {
    if (!skaLata || fryst !== undefined) return;
    let aktiv = true;
    void (async () => {
      const ok = await lasUpp();
      if (!aktiv || ljudForsokt.current) return;
      ljudForsokt.current = true;
      ljudUtanKlick.current = ok || ljud.current?.tillstand === "igang";
    })();
    return () => {
      aktiv = false;
    };
  }, [skaLata, fryst, lasUpp]);

  // En person som valt förut slipper rutan efter en omladdning: "av" gäller direkt,
  // och "pa" försöker tyst. Släpper webbläsaren inte fram ljudet utan klick står
  // rutan kvar som vanligt.
  useEffect(() => {
    if (arSkarm || fryst !== undefined) return;
    const val = las<"pa" | "av">(LJUDVAL);
    if (val === "av") settLjudval("av");
    else if (val === "pa") void lasUpp().then((ok) => ok && settLjudval((v) => (v === "vantar" ? "pa" : v)));
  }, [arSkarm, fryst, lasUpp]);

  // Tillståndet läses varje sekund, också när ljudet går: en kontext kan lämna
  // "running" (en ny ljudenhet, Safaris avbrott). Blockerat: försök igen när fliken syns.
  useEffect(() => {
    const id = setInterval(() => {
      const motor = ljud.current;
      if (motor) settLjudTillstand(motor.tillstand);
    }, 1000);
    const synlig = () => {
      if (document.visibilityState === "visible" && levande.current.ljudval === "pa" && ljud.current?.tillstand === "blockerat") {
        void lasUpp();
      }
    };
    document.addEventListener("visibilitychange", synlig);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", synlig);
    };
  }, [lasUpp]);

  // Volymen och tystnaden gäller direkt, vid varje bild och varje sekund.
  useEffect(() => {
    const motor = ljud.current;
    if (!motor) return;
    motor.satt({ volym: inst.ljud.volym, tyst: !farLata(t.current.senaste, nuMs) });
  });

  // --- Kön ----------------------------------------------------------------------

  const vantande = (): Kopost[] => [...t.current.ko, ...t.current.insamlat];

  /** Visar en bild direkt (inget firande). Nya rader i flödet lyser till en gång. */
  const visa = useCallback((bild: Ogonblick) => {
    const tt = t.current;
    const fore = new Set(tt.visad.order.map((o) => o.nyckel));
    for (const o of bild.order) if (!fore.has(o.nyckel)) tt.tysta.add(o.nyckel);
    const finns = new Set(bild.order.map((o) => o.nyckel));
    for (const k of tt.tysta) if (!finns.has(k)) tt.tysta.delete(k);
    tt.visad = bild;
  }, []);

  /** Bygger förloppet för en post: kompositionen, dess props, mått, klocka och spår. */
  const bygg = useCallback(
    (post: Kopost): Spelning => {
      const tt = t.current;
      const f = forlopp(post, {
        fore: tt.visad,
        senaste: tt.senaste,
        vantande: vantande(),
        nuIso: new Date(Date.now() + levande.current.offset).toISOString(),
        ordning: levande.current.ordning,
      });
      const id = tt.nastaId++;
      const lugnNu = levande.current.lugnMedia || f.efter.installningar.rorelse === "lugn";
      const klocka = fryst !== undefined ? { klocka: () => fryst, ljudBas: null } : nyKlocka(ljud.current);
      const gem: Gemensamt = { id, forlopp: f, ...klocka, bytt: false };
      const { u, vw, vh } = levande.current.fonster;
      const d = f.data;
      // Prisbilden bara när den är avkodad. Annars spelas scenen utan bildytan, aldrig med en halv bild.
      const bildFor = (url: string | null) => (url && tt.bilder.get(url) === "klar" ? url : null);
      switch (d.typ) {
        case "tavling":
          return { ...gem, typ: "tavling", props: { data: d, test: f.test, lugn: lugnNu, bild: bildFor(d.tavling.bild), u } };
        case "vinnare":
          return { ...gem, typ: "vinnare", props: { data: d, test: f.test, lugn: lugnNu, bild: bildFor(d.vinnare.bild), u } };
        case "knuff":
        case "grans": {
          tt.senastKnuff = Date.now() + levande.current.offset;
          const props: KnuffenProps = { data: d, test: f.test, lugn: lugnNu, bild: bildFor(d.tavling.bild), u, vw };
          return d.typ === "knuff" ? { ...gem, typ: "knuff", props } : { ...gem, typ: "grans", props };
        }
        case "halvvags":
          return { ...gem, typ: "halvvags", props: null };
        case "order":
          return { ...gem, typ: "order", props: { data: d, test: f.test, lugn: lugnNu, till: flodesRader(1), u, vw, vh } };
        case "serie": {
          const rader = Math.min(4, d.order.length);
          return { ...gem, typ: "serie", props: { data: d, test: f.test, lugn: lugnNu, till: flodesRader(rader), rader, u, vw, vh } };
        }
        case "malet":
          return { ...gem, typ: "malet", props: { data: d, test: f.test, lugn: lugnNu, kort: malkortet(), u, vw, vh } };
      }
    },
    [fryst, flodesRader, malkortet],
  );

  /** Lägger förloppets spår mot ljudklockan. Hornet har sin spärrtid; resten spelas alltid. */
  const schemalagg = useCallback(
    (spel: Spelning) => {
      const motor = ljud.current;
      if (!motor || spel.ljudBas === null || motor.tillstand !== "igang") return;
      if (!farLata(spel.forlopp.efter, Date.now() + levande.current.offset)) return;
      const nu = Date.now();
      const hornOk = hornTillatet(t.current.senastHorn, nu);
      if (hornOk && spel.forlopp.spar.some((p) => p.sparr)) t.current.senastHorn = nu;
      for (const p of spel.forlopp.spar) {
        if (p.sparr && !hornOk) continue;
        motor.spela(p.ljud, spel.ljudBas + p.f / FPS, p.p);
      }
    },
    [farLata],
  );

  const startaNasta = useCallback(() => {
    const tt = t.current;
    if (tt.spel) return;
    // En post som inte längre är sann (en order som makulerats medan den väntade) spelas inte.
    let post: Kopost | null = null;
    while (!post && tt.ko.length > 0) post = aktuell(tt.ko.shift() as Kopost, tt.senaste);
    if (!post) {
      // Kön är tom och inget samlas: visa det senaste, med det som ändrats i tysthet.
      if (!tt.samlar && tt.insamlat.length === 0) visa(tt.senaste);
      rita();
      return;
    }
    const spel = bygg(post);
    tt.spel = spel;
    settRuta(Math.max(0, Math.floor(spel.klocka() * FPS)));
    schemalagg(spel);
    rita();
  }, [bygg, schemalagg, visa]);

  const avsluta = useCallback(
    (id: number) => {
      const tt = t.current;
      if (!tt.spel || tt.spel.id !== id) return;
      const spel = tt.spel;
      tt.spel = null;
      const f = spel.forlopp;
      if (!f.test && (f.data.typ === "order" || f.data.typ === "serie")) {
        // Det som kom in tyst under förloppet (för gammalt, efterregistrerat) lyser till.
        const fore = new Set(f.fore.order.map((o) => o.nyckel));
        const vantar = new Set(vantande().flatMap((p) => nycklarFor(p.firande)));
        for (const o of f.efter.order) if (!fore.has(o.nyckel) && !vantar.has(o.nyckel) && !f.nycklar.includes(o.nyckel)) tt.tysta.add(o.nyckel);
        tt.visad = f.efter;
      }
      startaNasta();
    },
    [startaNasta],
  );

  /** Samlingsfönstret är slut: samla om kön och starta den. */
  const samlaIn = useCallback(() => {
    const tt = t.current;
    tt.samlar = null;
    const poster = [...tt.ko, ...tt.insamlat];
    tt.insamlat = [];
    tt.ko = samlaKo(poster, tt.senaste);
    if (!tt.spel) startaNasta();
    else rita();
  }, [startaNasta]);

  /** En ny bild från källan. */
  const taEmot = useCallback(
    (ny: Ogonblick) => {
      const tt = t.current;
      const beslut = mottagning(tt.senaste, ny);
      if (beslut === "slapp") return;
      if (ny.bygge && tt.startBygge && ny.bygge !== tt.startBygge) tt.nyttBygge = true;
      const { firanden, minne } = planera(beslut === "omstart" ? null : tt.forra, ny, tt.minne);
      tt.forra = ny;
      tt.minne = minne;
      spara(MINNESNYCKEL, minne);
      tt.senaste = ny;
      if (firanden.length > 0) {
        tt.insamlat.push(...firanden.map((firande) => ({ firande, efter: ny })));
        if (!tt.samlar) tt.samlar = setTimeout(samlaIn, SAMLA_MS);
      } else if (!tt.spel && tt.ko.length === 0 && !tt.samlar) {
        visa(ny);
      }
      rita();
    },
    [samlaIn, visa],
  );

  // Starten: allt som finns är sett (planera med ingen förra bild), och källan börjar.
  useEffect(() => {
    const tt = t.current;
    const { minne } = planera(null, start, las<Minne>(MINNESNYCKEL));
    tt.forra = start;
    tt.minne = minne;
    spara(MINNESNYCKEL, minne);
    // Ett 401: en inloggad går till inloggningen och kommer tillbaka hit, bara en
    // skärm laddar om sidan och får parningen.
    const kallan =
      kalla === "nat"
        ? natkalla({
            vid401: () => (start.skarm ? window.location.reload() : window.location.assign("/logga-in?nasta=%2Fsalesboard")),
          })
        : kalla;
    const stopp = kallan({ bild: taEmot, status: settStatus });
    return () => {
      stopp();
      if (tt.samlar) clearTimeout(tt.samlar);
      tt.samlar = null;
    };
    // Källan startas en gång; `start` byts aldrig under sidans liv.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Förloppets bildruta, för tavlans del av det ----------------------------
  const spel = t.current.spel;
  useEffect(() => {
    if (!spel) return;
    let id = 0;
    const steg = () => {
      const r = Math.floor(spel.klocka() * FPS);
      const { byt } = spel.forlopp.tider;
      // Tavlan rör sig bara under svepet (motrörelsen) och halvvägs; under resten står den still.
      const behov = spel.typ === "halvvags" || r <= 30 ? r : r >= byt ? byt : 31;
      settRuta((fore) => (fore === behov ? fore : behov));
      if (!spel.bytt && r >= byt && (spel.typ === "order" || spel.typ === "serie") && !spel.forlopp.test) {
        // Bytet: det tavlan visade blir landningens början, och landningen räknas härifrån.
        spel.bytt = true;
        const fore = visningFor({ visad: t.current.visad, vantande: vantande(), spel: spel.forlopp, r: byt - 1 });
        t.current.landning = {
          fran: fore.tal,
          franMal: malLage(fore),
          franFlode: fore.bild.order.filter((o) => !fore.utesluten.has(o.nyckel)).map((o) => o.nyckel),
        };
        t.current.landT0 = performance.now();
        settLr(0);
      }
      if (spel.typ === "halvvags" && r >= spel.forlopp.tider.slut) {
        avsluta(spel.id);
        return;
      }
      // Skyddsnät: en komposition som inte säger klar avslutas en halv sekund efter sin längd.
      if (spel.typ !== "halvvags" && r >= spel.forlopp.varaktighet + 30) {
        avsluta(spel.id);
        return;
      }
      id = requestAnimationFrame(steg);
    };
    id = requestAnimationFrame(steg);
    return () => cancelAnimationFrame(id);
    // `vantande` läser tt; den byts aldrig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spel, avsluta]);

  // --- Landningen: bildrutor sedan bytet, tills allt står still igen ------------
  useEffect(() => {
    if (lr === null) return;
    let id = 0;
    const steg = () => {
      const r = Math.floor(((performance.now() - t.current.landT0) / 1000) * FPS);
      if (r > LANDNING) {
        t.current.landning = null;
        settLr(null);
        return;
      }
      // Efter blinken rör sig bara "↑N", som tonar bort vid sex sekunder: rita då bara när den gör det.
      if (r <= BLINK || r >= UPP) settLr((fore) => (fore === r ? fore : r));
      id = requestAnimationFrame(steg);
    };
    id = requestAnimationFrame(steg);
    return () => cancelAnimationFrame(id);
    // Slingan startas om vid varje ny landning (landT0), inte vid varje bildruta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lr === null ? null : t.current.landT0]);

  // --- Skärmen: wake lock, helskärm, tangenterna, omladdning -------------------
  useEffect(() => {
    type Las = { release: () => Promise<void> };
    let lasning: Las | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (typ: "screen") => Promise<Las> } };
    const begar = async () => {
      try {
        if (document.visibilityState === "visible" && nav.wakeLock) lasning = await nav.wakeLock.request("screen");
      } catch {
        // Ingen wake lock (äldre webbläsare, eller sparläge): TV:n får lita på sina egna inställningar.
      }
    };
    void begar();
    const synlig = () => {
      if (document.visibilityState === "visible") void begar();
    };
    document.addEventListener("visibilitychange", synlig);
    return () => {
      document.removeEventListener("visibilitychange", synlig);
      void lasning?.release().catch(() => undefined);
    };
  }, []);

  const vaxlaOrdning = useCallback(() => {
    settOrdningVal((fore) => {
      const nasta: Ordning = (fore ?? levande.current.ordning) === "varde" ? "antal" : "varde";
      spara(ORDNINGSNYCKEL, nasta);
      return nasta;
    });
  }, []);

  useEffect(() => {
    helskarm.current = () => {
      try {
        const lofte = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
        void Promise.resolve(lofte).catch(() => undefined);
      } catch {
        // Helskärm går inte här (en ram, eller en TV-webbläsare utan stöd).
      }
    };
    let gom: ReturnType<typeof setTimeout> | null = null;
    const rorelse = () => {
      settMus(true);
      if (gom) clearTimeout(gom);
      gom = setTimeout(() => settMus(false), STYR_MS);
    };
    const tangent = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f") helskarm.current();
      else if (k === "v") vaxlaOrdning();
      else return;
      e.preventDefault();
      rorelse();
    };
    rorelse();
    window.addEventListener("keydown", tangent);
    window.addEventListener("pointermove", rorelse);
    window.addEventListener("pointerdown", rorelse);
    return () => {
      window.removeEventListener("keydown", tangent);
      window.removeEventListener("pointermove", rorelse);
      window.removeEventListener("pointerdown", rorelse);
      if (gom) clearTimeout(gom);
    };
  }, [vaxlaOrdning]);

  const lugnt = !spel && t.current.ko.length === 0 && !t.current.samlar;
  const arbetsdag = inomArbetsdag(new Date(nuMs).toISOString(), inst.arbetsdag);

  // --- Tävlingen: prisbilderna förladdas, och mellanspelet och vinnaren läggs in när tavlan är lugn ---
  const prisbilder = [bildNu.tavling?.bild, bildNu.vinnare?.bild].filter((x): x is string => Boolean(x));
  const prisnyckel = prisbilder.join(" ");
  useEffect(() => {
    const tt = t.current;
    for (const url of prisbilder) {
      if (tt.bilder.has(url)) continue;
      tt.bilder.set(url, "laddar");
      const img = new Image();
      img.src = url;
      img.decode().then(
        () => {
          tt.bilder.set(url, "klar");
          rita();
        },
        () => {
          tt.bilder.set(url, "fel");
          rita();
        },
      );
    }
    // Bilderna byts sällan; nyckeln säger när.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prisnyckel]);
  const bildKlar = (url: string | null | undefined) => !url || t.current.bilder.get(url) !== "laddar";

  useEffect(() => {
    if (fryst !== undefined) return;
    const tt = t.current;
    const bild = tt.senaste;
    if (tt.minne && vinnareDags({ bild, visad: tt.minne.vinnare, lugnt, arbetsdag, bildKlar: bildKlar(bild.vinnare?.bild) })) {
      tt.minne = { ...tt.minne, vinnare: true };
      spara(MINNESNYCKEL, tt.minne);
      tt.ko.push({ firande: { typ: "vinnare" }, efter: bild });
      startaNasta();
      return;
    }
    const dags = mellanspelDags({ bild, nuMs, senastMs: tt.senastMellanspel, knuffMs: tt.senastKnuff, lugnt, arbetsdag, bildKlar: bildKlar(bild.tavling?.bild) });
    if (dags === "vanta") return;
    tt.senastMellanspel = nuMs;
    if (dags === "nu") {
      tt.ko.push({ firande: { typ: "tavling" }, efter: bild });
      startaNasta();
    }
    // Klockan driver det här, en gång per sekund.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klientMs, lugnt, arbetsdag, fryst]);
  useEffect(() => {
    if (fryst !== undefined || !lugnt) return;
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    if (status.fel >= FEL_FOR_OMLADDNING && online) window.location.reload();
    else if (byggomladdning({ nyttBygge: t.current.nyttBygge, lugnt, ljudUtanKlick: ljudUtanKlick.current, arbetsdag })) window.location.reload();
    else if (t.current.startMs > 0 && nattomladdning(nuMs, t.current.startMs + offset)) window.location.reload();
  }, [klientMs, lugnt, status.fel, arbetsdag, nuMs, offset, fryst]);

  // --- Vad som syns (ko.ts) -------------------------------------------------------
  const tt = t.current;
  const v = visningFor({ visad: tt.visad, vantande: vantande(), spel: spel?.forlopp ?? null, r: ruta });
  const rorelse = lugn ? { dy: 0, skala: 1 } : tavlansRorelse(spel?.forlopp ?? null, ruta);
  const landning = lr !== null ? tt.landning : null;

  useEffect(() => {
    if (tt.vilaOk) tt.sistaBra = v;
  });

  // --- Statusraden --------------------------------------------------------------
  const sedanFel = status.senast ?? (tt.startMs || null);
  const offline = sedanFel !== null && klientMs - sedanFel > OFFLINE_MS && fryst === undefined ? klockslag(sedanFel + offset) : null;
  const ljudlage: Ljudlage =
    !inst.ljud.pa || inst.ljud.volym <= 0 || bildNu.skarm?.ljud === false || ljudval === "av"
      ? "av"
      : ljudval === "pa" && ljudTillstand === "blockerat"
        ? "blockerat"
        : ljudval === "vantar" || ljudTillstand !== "igang"
          ? "av"
          : !ljudTillatet(new Date(nuMs).toISOString(), inst.ljud)
            ? "tyst"
            : "pa";
  const visaStart =
    fryst === undefined && inst.ljud.pa && bildNu.skarm?.ljud !== false && (ljudval === "vantar" || (ljudval === "pa" && ljudTillstand === "blockerat"));

  // På en parad skärm fälls rutan ihop efter en halv minut: tavlan syns, rubriken
  // säger "Ljud blockerat" och har en knapp. En person har kvar rutan tills hen valt.
  useEffect(() => {
    if (!visaStart || !arSkarm || startFalld) return;
    const id = setTimeout(() => settStartFalld(true), START_FALLS_MS);
    return () => clearTimeout(id);
  }, [visaStart, arSkarm, startFalld]);
  const startRuta = visaStart && !(arSkarm && startFalld);
  const startaLjud = () => {
    settLjudval("pa");
    spara(LJUDVAL, "pa");
    void lasUpp();
  };

  const skift = pixelskift(nuMs);
  const dampad = !arbetsdag && !spel;
  const vilaProps = {
    landning,
    lr,
    ordning,
    nuMs,
    u: fonster.u,
    offline,
    ljud: ljudlage,
    startaLjud: visaStart && !startRuta ? startaLjud : undefined,
    tystTill: ljudlage === "tyst" ? nastaStart(new Date(nuMs).toISOString(), inst.ljud.fran, inst.ljud.helgTyst) : null,
    oppnar: dampad ? nastaStart(new Date(nuMs).toISOString(), inst.arbetsdag.fran, true) : null,
    dampad,
    flodeRef,
    kortRef,
    tysta: tt.tysta,
  };

  return (
    <div className={`sb-rot tv-rot${mus ? "" : " tv-mus-dold"}`}>
      <div className="tv-skift" style={{ transform: `translate(${skift.x}px, ${skift.y}px)` }}>
        <VilaSkydd
          nyckel={`${v.bild.nu}|${tt.visad.nu}`}
          ok={(lyckad) => {
            tt.vilaOk = lyckad;
          }}
          reserv={() => (tt.sistaBra ? <Vila v={tt.sistaBra} {...vilaProps} landning={null} lr={null} rorelse={{ dy: 0, skala: 1 }} /> : null)}
        >
          <Vila v={v} {...vilaProps} rorelse={rorelse} />
        </VilaSkydd>
      </div>
      {spel && spel.typ !== "halvvags" ? (
        <Skydd key={spel.id} onFel={() => avsluta(spel.id)}>
          {spel.typ === "order" ? (
            <Spelare key={spel.id} komposition={Ordern} props={spel.props} varaktighet={spel.forlopp.varaktighet} klocka={spel.klocka} onKlar={() => avsluta(spel.id)} />
          ) : spel.typ === "serie" ? (
            <Spelare key={spel.id} komposition={Serie} props={spel.props} varaktighet={spel.forlopp.varaktighet} klocka={spel.klocka} onKlar={() => avsluta(spel.id)} />
          ) : spel.typ === "tavling" || spel.typ === "vinnare" ? (
            <Spelare key={spel.id} komposition={Tavlingen} props={spel.props} varaktighet={spel.forlopp.varaktighet} klocka={spel.klocka} onKlar={() => avsluta(spel.id)} />
          ) : spel.typ === "knuff" || spel.typ === "grans" ? (
            <Spelare key={spel.id} komposition={Knuffen} props={spel.props} varaktighet={spel.forlopp.varaktighet} klocka={spel.klocka} onKlar={() => avsluta(spel.id)} />
          ) : (
            <Spelare key={spel.id} komposition={Malet} props={spel.props} varaktighet={spel.forlopp.varaktighet} klocka={spel.klocka} onKlar={() => avsluta(spel.id)} />
          )}
        </Skydd>
      ) : null}
      {startRuta ? (
        <div className="sb-start" role="dialog" aria-label="Starta tavlan">
          <span className="sb-start-etikett">LJUDET VÄNTAR</span>
          <button type="button" className="sb-start-knapp" autoFocus onClick={startaLjud}>
            Starta tavlan
          </button>
          <p>Webbläsaren väntar på ett klick innan tavlan får låta.</p>
          <button
            type="button"
            className="sb-start-utan"
            onClick={() => {
              settLjudval("av");
              spara(LJUDVAL, "av");
            }}
          >
            Fortsätt utan ljud
          </button>
        </div>
      ) : null}
      <div className={`tv-styr${mus && !spel && !startRuta ? "" : " tv-gomd"}`} aria-label="Tavlans styrning">
        {ljudlage === "av" && ljudval !== "pa" && inst.ljud.pa && bildNu.skarm?.ljud !== false ? (
          <button type="button" className="tv-styr-ljud" onClick={startaLjud}>
            Slå på ljud
          </button>
        ) : null}
        <button type="button" onClick={vaxlaOrdning}>
          Rangordna efter {ordning === "varde" ? "antal order" : "ordervärde"} <kbd>V</kbd>
        </button>
        <button type="button" onClick={() => helskarm.current()}>
          Helskärm <kbd>F</kbd>
        </button>
        {installningar && !arSkarm ? <a href="/nav2?till=%2Finstallningar%2Fsalesboard">Inställningar</a> : null}
      </div>
    </div>
  );
}

export type { Kalla, Kallstatus };
