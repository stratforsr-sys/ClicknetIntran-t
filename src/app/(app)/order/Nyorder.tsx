"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Filuppladdning } from "@/components/Filuppladdning";
import {
  BINDNINGSTID_MAX,
  BINDNINGSTID_MIN,
  FAKTURERING_ETIKETT,
  LOPTIDER,
  affarensVarde,
  avtalsslut,
  giltigBindningstid,
  periodFor,
  tjanstensSlut,
  tjanstensVarde,
  type Fakturering,
  type Paket,
  type Tjanst,
} from "@/lib/order";
import { kronor, manadsnamn } from "@/lib/provision";
import { nettoEfterUtkop } from "@/lib/utkop";
import { forberedOrderbilaga, registreraOrderbilaga, skapaOrder, type Orderstate } from "./actions";

type Person = { id: string; namn: string };

/**
 * En tillaggstjanst medan den skrivs.
 *
 * ALLA TAL AR STRANGAR HAR, och det ar samma val som `friVarde` gjort sedan
 * 0060: ett halvskrivet belopp ar inte ett tal, och ett falt som tolkas om till
 * en siffra vid varje tangenttryck gar inte att skriva "1 500" i.
 *
 * `nyckel` ar klientens egen och nar aldrig servern. React behover en stabil
 * identitet for raden — utan den flyttar sig markoren till fel falt nar en rad
 * mitt i listan tas bort.
 */
type Tjansterad = {
  nyckel: string;
  namn: string;
  fakturering: Fakturering;
  belopp: string;
  egenBindning: boolean;
  bindningstid: string;
  startdatum: string;
};

type Formular = {
  bolag: string;
  orgnr: string;
  kontakt: string;
  telefon: string;
  mejl: string;
  /** TOM STRANG = inget valt. Se rubriken om forvalen nedan. */
  paketId: string;
  loptid: string;
  signerat: string;
  startdatum: string;
  saljare: string;
  tillagg: boolean;
  harUtkop: boolean;
  utkopstext: string;
  manuell: boolean;
  manadsbelopp: string;
  friProvision: string;
  anteckning: string;
  godkann: boolean;
  tjanster: Tjansterad[];
};

let nastaNyckel = 0;

function tomTjanst(): Tjansterad {
  nastaNyckel += 1;
  return {
    nyckel: `t${nastaNyckel}`,
    namn: "",
    // FAKTURERINGEN AR OCKSA OVALD. En rad som ligger pa "manadsavgift" tills
    // nagon byter ar exakt det forval bestallaren bad om att slippa — och
    // skillnaden mellan de tva ar 4 000 kr och 96 000 kr i ordervarde.
    fakturering: "" as Fakturering,
    belopp: "",
    egenBindning: false,
    bindningstid: "",
    startdatum: "",
  };
}

/**
 * Inmatningen av en order.
 *
 * Rakt <input> och inte <Input>: sidan har flera formular och hade annars delat
 * id — samma skal som i satsformularet i E15 och i provisionens inmatning.
 *
 * ===========================================================================
 * INGET FALT AR FORVALT, OCH DET AR EN BUGGFIX — INTE EN STILFRAGA.
 *
 * Bestallaren 2026-09-24: *"nar jag lagger in order kan jag ibland glomma att
 * valja ratt person eftersom att personen alltid ar forvald"*.
 *
 * Felet ar inte att forvalet var fel person. Det ar att ett forvalt falt ser
 * likadant ut som ett ifyllt — den som skummar formularet ser ett namn i rutan
 * och gar vidare. Saljaren avgor vems provision affaren blir, paketet och
 * avtalstiden avgor beloppet, och signeringsdatumet avgor vilken MANAD pengarna
 * betalas ut i. Fyra falt dar ett obemarkt forval kostar riktiga pengar.
 *
 * Alla fyra star darfor tomma, med `required`, och det galler ocksa "Godkann
 * direkt" och varje ny tjansterad. Priset ar tre klick till per order. Vinsten
 * ar att ingen order langre kan bli fel av att nagon INTE gjorde nagot.
 *
 * Kvar som enda hjalp ar knappen vid startdatumet, som fyller i
 * signeringsdatumet — men den ar ett TRYCK och inte ett forval, och det ar hela
 * skillnaden.
 * ===========================================================================
 *
 * ===========================================================================
 * VARENDA FALT AR KONTROLLERAT, OCH DET AR OCKSA EN BUGGFIX.
 *
 * Rattat 2026-09-15, och felet kostade en riktig uppgift.
 *
 * React ATERSTALLER ett `<form action={...}>` efter varje serveranrop. Det ar
 * ratt beteende for ett formular som lyckats — nasta order ska borja tomt — men
 * det galler ocksa det som MISSLYCKADES. Ett okontrollerat falt gar da tillbaka
 * till sitt `defaultValue`, och `signed_on` hade `defaultValue={idag}`.
 *
 * Foljden, i ordning:
 *
 *   1. Nagon lade en order signerad i AUGUSTI och satte provisionen for hand.
 *   2. Servern nekade: en handsatt provision krävde en anteckning.
 *   3. Formularet aterstalldes. Alla falt tomma — och datumet tillbaka pa I DAG.
 *   4. Hen fyllde i pa nytt, tryckte igen, och ordern hamnade i SEPTEMBER.
 *
 * Ingenting i granssnittet sa att manaden bytts. Anteckningskravet ar borttaget
 * i 0060; det har formularet ar den andra halvan av samma rattelse. Med
 * kontrollerade falt overlever inmatningen ett felmeddelande. Formularet toms
 * av effekten nedan, och BARA nar ordern faktiskt sparats.
 *
 * Sedan 0068 finns inget `defaultValue` kvar att falla tillbaka pa — men
 * kontrollen behovs anda, annars toms allt den som skrev ar mitt i.
 * ===========================================================================
 *
 * ===========================================================================
 * ORDERVARDET RAKNAS FRAM MEDAN MAN SKRIVER, OCH DET AR HELA POANGEN.
 *
 * Bestallarens beskrivning 2026-09-09: *"ifall det ar ett paket som redan ar
 * inlagt sa ska man bara valja paketet och da ska det raknas provision och
 * ordervarde automatiskt"*. Talet under paketvalet ar den meningen, gjord
 * synlig — och den som ser 11 940 kr innan hen trycker vet direkt om hen valt
 * ratt rad.
 *
 * SIFFRAN HAR AR EN FORHANDSVISNING, INTE BESLUTET. Servern raknar om alltihop
 * i `raknaFramProvision` och sparar sitt eget svar. Det ar avsiktligt: en klient
 * gar att lura, och en sats kan hinna andras mellan att sidan laddades och
 * knappen trycktes. Rakningen ar densamma — `affarensVarde` och
 * `nettoEfterUtkop` ar samma funktioner pa bada sidor — men det ar serverns tal
 * som blir pengar.
 * ===========================================================================
 */
export function Nyorder({
  paket,
  personer,
  hanterare,
  idag,
  /** Mottagaren av overtacket, nar en sats ar satt. Se `manager_commission_rate` i 0050. */
  chef,
  /**
   * Saljarens sats pa en affar med utkop, i procent. `null` nar ingen sats ar
   * satt — da sager rutan det i stallet for att visa en nolla, som hade last som
   * "utkopsaffarer ger ingenting". Se `buyout_commission_rate` i 0060.
   */
  utkopsprocent,
  /**
   * Manaderna som redan ar faststallda, som `2026-08-01`.
   *
   * Behovs for VARNINGEN under datumfaltet. Listan bar inga personuppgifter och
   * inga belopp — bara vilka manader som ar rakade — sa den ar fri att skicka
   * till klienten.
   */
  stangdaManader,
  /**
   * Avtalet som forlangs, nar formularet oppnats med knappen "Forlang".
   *
   * ===========================================================================
   * KUNDUPPGIFTERNA FORIFYLLS, AFFAREN GOR DET INTE — och det ar inte en
   * motsagelse mot att alla forval togs bort samma dag.
   *
   * Skillnaden ar vem som sagt nagot. Ett FORVAL ar navets gissning om vad du
   * vill: ingen har tryckt pa nagot, rutan ar bara ifylld. Det har ar tvartom
   * foljden av ett tryck — du klickade "Forlang" pa Nordbygg AB, och da ar det
   * Nordbygg AB som star i rutan.
   *
   * Och gransen gar mitt i formularet med flit: bolagsnamn, orgnummer och
   * kontaktuppgifter ar samma kund som forut, men PAKET, BINDNINGSTID,
   * MANADSBELOPP, SALJARE och DATUM ar en ny forhandling. Just de falten star
   * tomma — de ar precis de dar ett forval hade kostat pengar.
   * ===========================================================================
   */
  forlanger,
}: {
  paket: Paket[];
  personer: Person[];
  hanterare: boolean;
  idag: string;
  chef: { employee_id: string; override_percent: number; own_sale_percent: number } | null;
  utkopsprocent: number | null;
  stangdaManader: string[];
  forlanger: {
    id: string;
    company_name: string;
    org_number: string;
    contact_name: string;
    contact_phone: string;
    contact_email: string | null;
    ends_on: string;
  } | null;
}) {
  const [state, action, vantar] = useActionState<Orderstate, FormData>(skapaOrder, {});

  // ---------------------------------------------------------------------------
  // Formularets tillstand. ALLT ligger har, inte i DOM:en — se rubriken ovan.
  // ---------------------------------------------------------------------------
  const tomt: Formular = {
    bolag: forlanger?.company_name ?? "",
    orgnr: forlanger?.org_number ?? "",
    kontakt: forlanger?.contact_name ?? "",
    telefon: forlanger?.contact_phone ?? "",
    mejl: forlanger?.contact_email ?? "",
    paketId: "",
    loptid: "",
    signerat: "",
    startdatum: "",
    saljare: "",
    tillagg: false,
    harUtkop: false,
    utkopstext: "",
    manuell: false,
    manadsbelopp: "",
    friProvision: "",
    anteckning: "",
    godkann: false,
    tjanster: [],
  };

  const [f, setF] = useState<Formular>(tomt);

  // Casten behovs: med en GENERISK nyckel harleder TypeScript den berakna
  // egenskapen som `string` och far da ett indexsignaturobjekt i stallet for
  // `Formular`. Nyckeln ar anda begransad till `keyof Formular` av signaturen,
  // sa castet bekraftar bara det anropet redan garanterar.
  const satt = <K extends keyof Formular>(nyckel: K, varde: Formular[K]) =>
    setF((gammalt) => ({ ...gammalt, [nyckel]: varde }) as Formular);

  const sattTjanst = <K extends keyof Tjansterad>(
    nyckel: string,
    falt: K,
    varde: Tjansterad[K],
  ) =>
    setF((gammalt) => ({
      ...gammalt,
      tjanster: gammalt.tjanster.map((t) => (t.nyckel === nyckel ? { ...t, [falt]: varde } : t)),
    }));

  // ===========================================================================
  // FORMULARET TOMS BARA NAR ORDERN FAKTISKT SPARATS.
  //
  // `state.ok` satts av actionen och bara av den. Ett fel lamnar allt orort,
  // vilket ar hela poangen med ovningen — se rubriken overst.
  //
  // DATUMET GAR INTE LANGRE TILLBAKA TILL I DAG. Fore 0068 gjorde det det, och
  // resonemanget dar var att "i dag ar det ratta svaret i de allra flesta fall".
  // Det stammer fortfarande — men bestallaren bad uttryckligen om att inget falt
  // ska vara ifyllt at en, och ett datum som fyller i sig sjalvt mellan tva
  // order ar precis det.
  // ===========================================================================
  // `tomt` byggs om vid varje rendering men innehallet ar konstant, sa den hor
  // inte hemma i beroendelistan — den hade bara gjort effekten till en loop.
  // Effekten lyssnar pa `state` och ingenting annat.
  useEffect(() => {
    if (state.ok) setF(tomt);

  }, [state]);

  const valtPaket = paket.find((p) => String(p.id) === f.paketId);

  // Ett fritt tal tolkas tillatande: mellanslag som tusentalsavgransare och
  // komma som decimaltecken ar hur folk faktiskt skriver kronor. Serverns
  // `tolkaBelopp` gor samma sak.
  const tolka = (text: string): number | null => {
    const rensat = text.replace(/[\s ]/g, "").replace(",", ".");
    if (!rensat) return null;
    const n = Number(rensat);
    return Number.isFinite(n) ? n : null;
  };

  const loptid = f.loptid ? Number(f.loptid) : null;

  // ---------------------------------------------------------------------------
  // Tjansterna, som `lib/order.ts` vill ha dem.
  //
  // BARA DE FARDIGSKRIVNA RADERNA RAKNAS MED i forhandsvisningen. En rad dar
  // beloppet annu ar halvskrivet ska inte fa ordervardet att hoppa — och en rad
  // utan fakturering gar inte att vardera alls.
  // ---------------------------------------------------------------------------
  const tjanster: Tjanst[] = f.tjanster.flatMap((t) => {
    const belopp = tolka(t.belopp);
    if (!t.namn.trim() || !t.fakturering || belopp === null || belopp <= 0) return [];
    return [
      {
        name: t.namn.trim(),
        billing: t.fakturering,
        amount: belopp,
        follows_order: t.fakturering === "manad" ? !t.egenBindning : false,
        term_months: t.egenBindning && t.bindningstid ? Number(t.bindningstid) : null,
        starts_on: t.egenBindning && t.startdatum ? t.startdatum : null,
      },
    ];
  });

  // ---------------------------------------------------------------------------
  // Affaren, raknad pa samma satt som servern kommer att rakna den.
  // ---------------------------------------------------------------------------
  // MANADSBELOPPET KOMMER FRAN TVA HALL och ar ett och samma tal: ur paketets
  // prislista for en paketorder, ur faltet for en fri. `affarensVarde` bryr sig
  // inte om vilket — och det ar med flit, for det gor inte databasen heller.
  const manadsbelopp = f.manuell ? tolka(f.manadsbelopp) : (valtPaket?.list_price ?? null);

  const brutto =
    manadsbelopp !== null && loptid !== null ? affarensVarde(manadsbelopp, loptid, tjanster) : null;

  const utkop = f.harUtkop ? tolka(f.utkopstext) : null;
  const utkopForStort = brutto !== null && utkop !== null && utkop > brutto;

  const netto = brutto === null ? null : nettoEfterUtkop(brutto, utkop);

  // CHEFSREGELN GALLER DEN VALDA SALJAREN, inte den inloggade. En saljchef som
  // lagger in en order at Vlado ska se Vlados villkor, inte sina egna.
  const forChefen = chef !== null && f.saljare === chef.employee_id;

  // ORDNINGEN AR DENSAMMA SOM I `raknaFramProvision`, och det ar med flit: ett
  // handsatt belopp gar fore utkopssatsen, som gar fore matrisen. Sager de tva
  // sidorna olika saker om vilken regel som vann ar forhandsvisningen varre an
  // ingen forhandsvisning alls.
  const provision =
    netto === null
      ? null
      : forChefen
        ? Math.round((netto * chef!.own_sale_percent) / 100)
        : f.manuell && tolka(f.friProvision) !== null
          ? tolka(f.friProvision)
          : f.harUtkop && utkop !== null && utkopsprocent !== null
            ? Math.round((netto * utkopsprocent) / 100)
            : null; // Matrisens belopp finns inte i klienten — servern slar upp det.

  const restpost =
    netto !== null && provision !== null && !forChefen ? Math.max(0, netto - provision) : null;

  const overtack =
    chef !== null && restpost !== null
      ? Math.round((restpost * chef.override_percent) / 100)
      : null;

  // ---------------------------------------------------------------------------
  // Manaden ordern hamnar i, och om den ar stangd.
  // ---------------------------------------------------------------------------
  const manad = /^\d{4}-\d{2}-\d{2}$/.test(f.signerat) ? periodFor(f.signerat) : null;
  const manadStangd = manad !== null && stangdaManader.includes(manad);
  const oppenManad = periodFor(idag);

  // NAR AVTALET TAR SLUT. Raknas medan man skriver, av exakt samma skal som
  // ordervardet gor det: talet ar hela avsikten med de tva falten, och det som
  // avgor nar navet ringer i klockan. Se `avtalsslut()` i lib/order.ts.
  const slutdatum =
    /^\d{4}-\d{2}-\d{2}$/.test(f.startdatum) && loptid !== null && giltigBindningstid(loptid)
      ? avtalsslut(f.startdatum, loptid)
      : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      {/* FORLANGNINGEN SAGER SIG SJALV I KLARTEXT. Den som kommer hit fran en
          knapp pa ett annat kort ska se VILKET avtal den nya ordern ersatter —
          annars ar det enda tecknet att nagra falt rakar vara ifyllda. */}
      {forlanger && !state.ok && (
        <>
          <input type="hidden" name="forlanger_id" value={forlanger.id} />
          <Notis ton="info">
            Förlängning av <strong>{forlanger.company_name}</strong>, vars avtal löper till{" "}
            {forlanger.ends_on}. Kunduppgifterna är hämtade från det gamla avtalet — paket,
            bindningstid, säljare och datum är en ny förhandling och står tomma. När ordern är lagd
            markeras det gamla avtalet som förlängt och slutar påminna.
          </Notis>
        </>
      )}

      {/*
        AVTALET LADDAS UPP HAR, DIREKT EFTER ATT ORDERN SPARATS.

        Bestallaren bad om uppladdningen i sjalva inmatningen. Den kan inte ske
        FORE sparandet: bade den signerade adressen och registreringen haenger pa
        orderns id (0039), och ett id finns forst nar raden gjorts. Ett eget
        uppladdningsspar som lade filen nagonstans och kopplade den efterat hade
        varit en andra vag in i bucketen vid sidan av den som ar provad.

        Rutan star darfor kvar under kvittensen tills nasta order borjar skrivas,
        och det ar samma komponent och samma tva server actions som orderkortet
        anvander. Den som just lagt ordern behover inte leta upp den i listan.
      */}
      {state.ok && state.orderId && (
        <div className="rounded-sm border border-canvas bg-surface-alt p-4">
          <Filuppladdning
            andamal="sales_order"
            etikett="Bifoga avtalet"
            hjalp="PDF. Ordern är redan sparad — avtalet läggs på den. Texten går att läsa ut och förifylla fälten med från orderkortet."
            knapp="Ladda upp"
            forbered={(namn, mime, byte) => forberedOrderbilaga(state.orderId!, namn, mime, byte)}
            registrera={(fileId, namn, store) =>
              registreraOrderbilaga(state.orderId!, fileId, namn, store)
            }
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="company_name" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Bolagsnamn</span>
          <input
            id="company_name"
            name="company_name"
            required
            className={KONTROLL}
            value={f.bolag}
            onChange={(e) => satt("bolag", e.target.value)}
          />
        </label>

        <label htmlFor="org_number" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Organisationsnummer</span>
          <input
            id="org_number"
            name="org_number"
            required
            inputMode="numeric"
            placeholder="556677-8899"
            className={KONTROLL}
            value={f.orgnr}
            onChange={(e) => satt("orgnr", e.target.value)}
          />
        </label>

        <label htmlFor="contact_name" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Kontaktperson</span>
          <input
            id="contact_name"
            name="contact_name"
            required
            className={KONTROLL}
            value={f.kontakt}
            onChange={(e) => satt("kontakt", e.target.value)}
          />
        </label>

        <label htmlFor="contact_phone" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Telefon</span>
          <input
            id="contact_phone"
            name="contact_phone"
            required
            inputMode="tel"
            placeholder="070-123 45 67"
            className={KONTROLL}
            value={f.telefon}
            onChange={(e) => satt("telefon", e.target.value)}
          />
        </label>

        {/*
          MEJLEN AR FRIVILLIG, och faltet sager det med ord i stallet for att
          bara sakna `required`. Skalet ar att de fyra falten ovanfor ar
          obligatoriska: en rad som ser likadan ut men beter sig tvartom ar
          precis den sortens falla man gar i en gang och sedan misstror resten
          av formularet.

          `type="email"` med flit och inte `type="text"`: mobiltangentbordet
          byter till @-layout, och webblasaren fangar det grovsta skrivfelet
          fore serveranropet. Den riktiga kontrollen star i `giltigMejl` och i
          `sales_order_mejlform` (0060).
        */}
        <label htmlFor="contact_email" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Mejl (valfritt)</span>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            placeholder="kontakt@bolaget.se"
            className={KONTROLL}
            value={f.mejl}
            onChange={(e) => satt("mejl", e.target.value)}
          />
        </label>

        {/* TOMT FORSTA VAL, INTE FORSTA PAKETET. Se rubriken om forvalen. */}
        <label htmlFor="package_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Paket</span>
          <select
            id="package_id"
            name="package_id"
            required
            className={KONTROLL}
            value={f.paketId}
            onChange={(e) => satt("paketId", e.target.value)}
          >
            <option value="">Välj paket …</option>
            {paket.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {kronor(p.list_price)}/mån
              </option>
            ))}
          </select>
        </label>

        {/*
          BINDNINGSTIDEN HAR TVA FORMER, och de svarar pa olika fragor.

          En PAKETORDER far valja bland matrisens tre: provisionen slas upp pa
          kombinationen paket + lopstid i `commission_rate`, och en lopstid
          utanfor matrisen har ingen sats att sla upp. En FRI order skriver ett
          eget tal, for dess belopp satts anda for hand.

          Bestallarens val 2026-09-24. Spannet 1-60 ar databasens ram
          (`sales_order_bindningstid` i 0068), inte en asikt om vad som ar rimligt.
        */}
        <label htmlFor="term_months" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Bindningstid</span>
          {f.manuell ? (
            <>
              <input
                id="term_months"
                name="term_months"
                type="number"
                required
                min={BINDNINGSTID_MIN}
                max={BINDNINGSTID_MAX}
                step={1}
                placeholder="18"
                className={KONTROLL}
                value={f.loptid}
                onChange={(e) => satt("loptid", e.target.value)}
              />
              <span className="text-small text-ink-500">
                Antal månader kunden är bunden, {BINDNINGSTID_MIN}–{BINDNINGSTID_MAX}.
              </span>
            </>
          ) : (
            <select
              id="term_months"
              name="term_months"
              required
              className={KONTROLL}
              value={f.loptid}
              onChange={(e) => satt("loptid", e.target.value)}
            >
              <option value="">Välj bindningstid …</option>
              {LOPTIDER.map((m) => (
                <option key={m} value={m}>
                  {m} månader
                </option>
              ))}
            </select>
          )}
        </label>

        <label htmlFor="signed_on" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Signeringsdatum</span>
          {/* max=idag: en framtida signering nekas ocksa av actionen, men ett
              val som inte gar att gora ar battre an ett felmeddelande efterat. */}
          <input
            id="signed_on"
            name="signed_on"
            type="date"
            required
            max={idag}
            className={KONTROLL}
            value={f.signerat}
            onChange={(e) => satt("signerat", e.target.value)}
          />
          <Manadsstampel manad={manad} stangd={manadStangd} oppen={oppenManad} />
        </label>

        {/*
          STARTDATUMET, OCH VARFOR DET INTE AR SIGNERINGSDATUMET.

          Bestallarens val 2026-09-24. Ett avtal signeras ofta innan det borjar
          galla — driftstarten ligger nagra veckor fram, eller forlangningen
          tecknas medan det gamla avtalet fortfarande loper. Raknades slutet fran
          signeringen hade paminnelsen kommit for tidigt pa precis de avtal dar
          den spelar storst roll.

          Knappen fyller i signeringsdatumet med ETT TRYCK. Den ar inte ett
          forval: den gor ingenting forran nagon klickar, och det ar skillnaden
          som hela det har passet handlar om.
        */}
        <label htmlFor="starts_on" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Avtalet börjar gälla</span>
          <input
            id="starts_on"
            name="starts_on"
            type="date"
            required
            min={f.signerat || undefined}
            className={KONTROLL}
            value={f.startdatum}
            onChange={(e) => satt("startdatum", e.target.value)}
          />
          {f.signerat && f.startdatum !== f.signerat ? (
            <button
              type="button"
              className="self-start text-small text-accent-ink underline"
              onClick={() => satt("startdatum", f.signerat)}
            >
              Samma som signeringsdatumet
            </button>
          ) : (
            <span className="text-small text-ink-500">
              Slutdatumet räknas härifrån — det är det som avgör när vi ringer om förlängning.
            </span>
          )}
        </label>

        {hanterare && personer.length > 0 && (
          <label htmlFor="salesperson_id" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Säljare</span>
            {/* `required` OCH ett tomt forstaval. Det har faltet ar det
                bestallaren namngav: en forvald person blir nagon annans
                provision om ingen ser efter. */}
            <select
              id="salesperson_id"
              name="salesperson_id"
              required
              className={KONTROLL}
              value={f.saljare}
              onChange={(e) => satt("saljare", e.target.value)}
            >
              <option value="">Välj säljare …</option>
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* MANADSBELOPPET STAR UTANFOR RUTNATET, precis under bindningstiden, for
          att de tva laeses ihop: tillsammans ar de hela affaren och hela
          slutdatumet. Se rubriken vid kryssrutan langre ned. */}
      {f.manuell && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="monthly_amount" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Kunden betalar per månad</span>
            <input
              id="monthly_amount"
              name="monthly_amount"
              required
              inputMode="decimal"
              placeholder="1 495"
              className={KONTROLL}
              value={f.manadsbelopp}
              onChange={(e) => satt("manadsbelopp", e.target.value)}
            />
            <span className="text-small text-ink-500">
              Ordervärdet räknas som månadsbeloppet gånger bindningstiden, plus tjänsterna nedan.
            </span>
          </label>

          {/* CHEFENS EGNA ORDER BEHOVER INGEN PROVISION SKRIVEN. Den raknas
              ur ordervardet, och ett falt som ignoreras ar varre an inget
              falt: den som fyller i det tror att talet betyder nagot. */}
          {!forChefen && (
            <label htmlFor="commission_amount" className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">Provision i kronor</span>
              <input
                id="commission_amount"
                name="commission_amount"
                inputMode="decimal"
                placeholder="3 200"
                className={KONTROLL}
                value={f.friProvision}
                onChange={(e) => satt("friProvision", e.target.value)}
              />
              <span className="text-small text-ink-500">
                {f.harUtkop && utkopsprocent !== null
                  ? `Lämna tomt så räknas ${utkopsprocent} % på det som är kvar efter utköpet.`
                  : "Skriv gärna en anteckning om varför beloppet avviker. Den följer med i loggen."}
              </span>
            </label>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-small text-ink-700">
        <input
          type="checkbox"
          name="is_addon"
          className="size-4"
          checked={f.tillagg}
          onChange={(e) => satt("tillagg", e.target.checked)}
        />
        Tilläggsavtal på befintlig kund
      </label>

      <Tjanster
        rader={f.tjanster}
        loptid={loptid}
        signerat={f.signerat}
        satt={sattTjanst}
        laggTill={() => setF((g) => ({ ...g, tjanster: [...g.tjanster, tomTjanst()] }))}
        taBort={(nyckel) =>
          setF((g) => ({ ...g, tjanster: g.tjanster.filter((t) => t.nyckel !== nyckel) }))
        }
      />

      {/*
        TJANSTERNA GAR SOM JSON I ETT FALT, inte som `tjanst_namn_0`, `tjanst_namn_1`.

        Antalet ar obestamt — det ar hela poangen med raderna — och indexerade
        faltnamn tvingar servern att gissa var listan tar slut. Ett falt som bar
        hela listan har i stallet en enda form, och serverns `tjansterUrFormular`
        ar det enda stallet den tolkas.
      */}
      <input type="hidden" name="tjanster" value={JSON.stringify(tjanster)} />

      {/*
        UTKOPET STAR UTANFOR `hanterare`-blocket, och det ar ett val.

        Saljaren ar den som VET om affaren bar ett utkop — hen forhandlade det.
        Godkannaren far reda pa det forst nar ordern dyker upp i kon, och da bara
        om nagon skrivit det nagonstans. Lades faltet bakom chefsbehorigheten
        hade uppgiften blivit ett muntligt meddelande, och beloppet hade fatts
        fram i efterhand av nagon som inte var med i samtalet.

        `sales_order_utkop_ryms` i 0060 slapper darfor igenom ett utkop pa en
        INSKICKAD order, som annu inte har nagot ordervarde.
      */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-small text-ink-700">
          <input
            type="checkbox"
            name="har_utkop"
            className="size-4"
            checked={f.harUtkop}
            onChange={(e) => satt("harUtkop", e.target.checked)}
          />
          Affären har ett utköp — vi löser kunden ur ett gammalt avtal
        </label>

        {f.harUtkop && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="buyout_amount" className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">Utköp i kronor</span>
              <input
                id="buyout_amount"
                name="buyout_amount"
                required
                inputMode="decimal"
                placeholder="5 000"
                className={KONTROLL}
                value={f.utkopstext}
                onChange={(e) => satt("utkopstext", e.target.value)}
              />
              <span className="text-small text-ink-500">
                Dras från ordervärdet.{" "}
                {utkopsprocent === null
                  ? "Ingen utköpssats är satt ännu, så provisionen måste skrivas in för hand."
                  : `Säljaren får ${utkopsprocent} % av det som blir kvar, i stället för matrisens belopp.`}
              </span>
            </label>
          </div>
        )}

        {utkopForStort && (
          <Notis ton="danger">
            Utköpet {kronor(utkop!)} är större än ordervärdet {kronor(brutto!)}. Kontrollera talen —
            ordern går inte att spara så.
          </Notis>
        )}
      </div>

      {hanterare && (
        <>
          {/*
            "FOLJER INTE PAKETREGLERNA" OPPNAR NUMERA MANADSBELOPP OCH
            BINDNINGSTID — INTE ETT FARDIGRAKNAT ORDERVARDE.

            Bestallarens beskrivning 2026-09-24: *"da maste jag kunna valja hur
            mycket kunden betalar i manaden, hur manga manader bindningstid"*.

            Skillnaden ar inte kosmetisk. Ett inskrivet ordervarde ar ETT tal som
            inte gar att ta isar: det sager varken vad kunden betalar eller hur
            lange, och alltsa inte heller NAR AVTALET TAR SLUT. Med de tva talen
            i stallet raknas bade ordervardet och slutdatumet fram — och det
            andra ar hela skalet till att beslutet togs.
          */}
          <label className="flex items-center gap-2 text-small text-ink-700">
            <input
              type="checkbox"
              name="fri_order"
              checked={f.manuell}
              onChange={(e) => satt("manuell", e.target.checked)}
              className="size-4"
            />
            Ordern följer inte paketreglerna — jag sätter månadsbelopp, bindningstid och provision
            själv
          </label>

          <label className="flex items-center gap-2 text-small text-ink-700">
            <input
              type="checkbox"
              name="godkann"
              className="size-4"
              checked={f.godkann}
              onChange={(e) => satt("godkann", e.target.checked)}
            />
            Godkänn direkt
          </label>
        </>
      )}

      <Affaren
        brutto={brutto}
        utkop={utkop}
        netto={netto}
        provision={provision}
        restpost={restpost}
        overtack={overtack}
        chef={chef}
        forChefen={forChefen}
        manuell={f.manuell}
        hanterare={hanterare}
        utkopsprocent={utkopsprocent}
        slutdatum={slutdatum}
        loptid={loptid}
        tjanster={tjanster}
      />

      <label htmlFor="note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Anteckning (valfritt)</span>
        <input
          id="note"
          name="note"
          placeholder="Något att veta om affären"
          className={KONTROLL}
          value={f.anteckning}
          onChange={(e) => satt("anteckning", e.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" laddar={vantar}>
          {hanterare ? "Lägg ordern" : "Skicka in ordern"}
        </Button>
        <p className="text-small text-ink-500">
          {hanterare
            ? "Ordervärdet och provisionen fryses på ordern när den godkänns."
            : "Ordern räknas först när den godkänts."}
        </p>
      </div>
    </form>
  );
}

/**
 * Tillaggstjansterna pa ordern.
 *
 * ===========================================================================
 * TRE FALT AVGOR VAD RADEN ÄR VARD, OCH ETT AV DEM ÄR INTE ETT BELOPP.
 *
 * `fakturering` ar skillnaden mellan 4 000 kr och 96 000 kr pa exakt samma
 * inskrivna tal: en engangsavgift ar hela summan, en manadsavgift ganges med
 * bindningstiden. Det ar darfor faltet star OVALT fran borjan och ar `required`
 * — ett forval hade gjort den dyraste av alla forvaxlingar till standardlaget.
 *
 * Rakningen sjalv star inte har utan i `tjanstensVarde()` i lib/order.ts, som
 * ocksa ar den servern anvander. Se rubriken dar.
 * ===========================================================================
 *
 * ===========================================================================
 * EN TJANST MED EGEN BINDNINGSTID FAR EN EGEN BEVAKNING.
 *
 * Bestallarens val 2026-09-24. Skalet star i fragan sjalv: en vaxel pa 36
 * manader pa ett avtal som loper 24 tar slut ett ar senare an huvudavtalet, och
 * bevakades bara ordern hade den tjansten loepe ut tyst — vilket ar precis det
 * hela passet finns for att sluta med.
 * ===========================================================================
 */
function Tjanster({
  rader,
  loptid,
  signerat,
  satt,
  laggTill,
  taBort,
}: {
  rader: Tjansterad[];
  loptid: number | null;
  signerat: string;
  satt: <K extends keyof Tjansterad>(nyckel: string, falt: K, varde: Tjansterad[K]) => void;
  laggTill: () => void;
  taBort: (nyckel: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-small font-medium text-ink-900">Tjänster på ordern</h3>
        <span className="text-small text-ink-500">
          Värdet räknas in i ordervärdet och därmed i provisionen.
        </span>
      </div>

      {rader.map((t, i) => {
        const egetSlut =
          t.egenBindning && t.startdatum && t.bindningstid && giltigBindningstid(Number(t.bindningstid))
            ? avtalsslut(t.startdatum, Number(t.bindningstid))
            : null;

        return (
          <div key={t.nyckel} className="flex flex-col gap-3 rounded-sm border border-canvas p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label htmlFor={`tjanst_namn_${i}`} className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Tjänst</span>
                <input
                  id={`tjanst_namn_${i}`}
                  required
                  placeholder="Växel"
                  className={KONTROLL}
                  value={t.namn}
                  onChange={(e) => satt(t.nyckel, "namn", e.target.value)}
                />
              </label>

              <label htmlFor={`tjanst_avgift_${i}`} className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Avgift</span>
                <select
                  id={`tjanst_avgift_${i}`}
                  required
                  className={KONTROLL}
                  value={t.fakturering}
                  onChange={(e) => satt(t.nyckel, "fakturering", e.target.value as Fakturering)}
                >
                  <option value="">Välj …</option>
                  <option value="manad">Månadsavgift</option>
                  <option value="engang">Engångsavgift</option>
                </select>
              </label>

              <label htmlFor={`tjanst_belopp_${i}`} className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">
                  {t.fakturering === "engang" ? "Belopp" : "Per månad"}
                </span>
                <input
                  id={`tjanst_belopp_${i}`}
                  required
                  inputMode="decimal"
                  placeholder="499"
                  className={KONTROLL}
                  value={t.belopp}
                  onChange={(e) => satt(t.nyckel, "belopp", e.target.value)}
                />
              </label>
            </div>

            {/* EN ENGANGSAVGIFT FAR INGEN BINDNINGSTIDSFRAGA. Den kan inte loepa
                ut, sa kryssrutan hade varit ett val utan foljd — och villkoret
                `tjanst_engang_utan_bindning` i 0068 nekar den anda. */}
            {t.fakturering === "manad" && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-small text-ink-700">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={t.egenBindning}
                    onChange={(e) => satt(t.nyckel, "egenBindning", e.target.checked)}
                  />
                  Egen bindningstid — tjänsten följer inte huvudavtalet
                </label>

                {t.egenBindning ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label htmlFor={`tjanst_manader_${i}`} className="flex flex-col gap-1">
                      <span className="text-micro text-ink-500">Bindningstid</span>
                      <input
                        id={`tjanst_manader_${i}`}
                        type="number"
                        required
                        min={BINDNINGSTID_MIN}
                        max={BINDNINGSTID_MAX}
                        step={1}
                        placeholder="36"
                        className={KONTROLL}
                        value={t.bindningstid}
                        onChange={(e) => satt(t.nyckel, "bindningstid", e.target.value)}
                      />
                    </label>

                    <label htmlFor={`tjanst_start_${i}`} className="flex flex-col gap-1">
                      <span className="text-micro text-ink-500">Tjänsten börjar</span>
                      <input
                        id={`tjanst_start_${i}`}
                        type="date"
                        required
                        min={signerat || undefined}
                        className={KONTROLL}
                        value={t.startdatum}
                        onChange={(e) => satt(t.nyckel, "startdatum", e.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <span className="text-small text-ink-500">
                    {loptid
                      ? `Löper ${loptid} månader som huvudavtalet, och bevakas tillsammans med det.`
                      : "Löper som huvudavtalet, och bevakas tillsammans med det."}
                  </span>
                )}

                {egetSlut && (
                  <span className="text-small text-ink-500">
                    Tjänsten löper till <strong>{egetSlut}</strong> och får en egen påminnelse.
                  </span>
                )}
              </div>
            )}

            <button
              type="button"
              className="self-start text-small text-danger-ink underline"
              onClick={() => taBort(t.nyckel)}
            >
              Ta bort tjänsten
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className="self-start text-small text-accent-ink underline"
        onClick={laggTill}
      >
        + Lägg till en tjänst
      </button>
    </div>
  );
}

/**
 * Manaden ordern hamnar i, skriven ut under datumfaltet.
 *
 * ===========================================================================
 * RADEN FINNS FOR ATT ETT DATUM INTE AR EN MANAD FOR DEN SOM LASER DET.
 *
 * `2026-08-29` och `2026-09-01` ser ut som grannar och ar det inte: de hor till
 * olika loneperioder, och den ena kan vara stangd. Den som backdaterar en order
 * en vecka tanker "forra veckan", inte "augusti" — och det ar manaden som avgor
 * vad affaren ar vard och nar den betalas ut.
 * ===========================================================================
 */
function Manadsstampel({
  manad,
  stangd,
  oppen,
}: {
  manad: string | null;
  stangd: boolean;
  oppen: string;
}) {
  if (manad === null) return <span className="text-small text-ink-500">Styr vilken månad ordern räknas i.</span>;

  if (stangd) {
    return (
      <span className="text-small text-danger-ink">
        Räknas på <strong>{manadsnamn(manad)}</strong> — den månaden är fastställd. Ordern hör dit,
        men provisionen bokförs på {manadsnamn(oppen)} med en anteckning om varför. En stängd period
        skrivs aldrig om.
      </span>
    );
  }

  return (
    <span className="text-small text-ink-500">
      Räknas på <strong>{manadsnamn(manad)}</strong>.
    </span>
  );
}

/**
 * Affaren, uppdelad sa som den faktiskt raknas.
 *
 * ===========================================================================
 * TVA TAL SOM ALDRIG FAR LASAS IHOP.
 *
 * ORDERVARDET ar bolagets omsattning pa affaren. PROVISIONEN ar pengar till en
 * person. De star bredvid varandra har for att bada hor till samma order, men
 * de summeras aldrig — och rutan sager det med ord, eftersom 11 940 och 1 500
 * bredvid varandra annars inbjuder till att laggas ihop.
 * ===========================================================================
 *
 * ===========================================================================
 * UTKOPET FAR EN EGEN RAD MED MINUSTECKEN, inte ett lagre ordervarde.
 *
 * Tre tal i stallet for ett: bruttot, avdraget och det som blev kvar. Skalet ar
 * att den som godkanner ska kunna stamma av MOT AVTALET, och avtalet sager
 * bruttot. Ett enda hopslaget tal hade tvingat fram en huvudrakning varje gang
 * nagon undrade om ordern stamde.
 * ===========================================================================
 *
 * RUTAN SYNS BARA NAR DET FINNS NAGOT ATT VISA. En rad som alltid star dar och
 * alltid sager noll lar ogat att ingenting hander pa den platsen — samma
 * resonemang som K&V-raden i provisionsvyn foljer.
 *
 * MATRISENS BELOPP STAR INTE HAR. Provisionen for en vanlig paketorder slas upp
 * pa servern ur `commission_rate`, versionerad pa signeringsdatumet, och att
 * spegla de nio beloppen i klienten hade varit en andra kopia av matrisen — den
 * sortens kopia som glider isar tyst. Rutan sager i stallet varifran talet
 * kommer.
 */
function Affaren({
  brutto,
  utkop,
  netto,
  provision,
  restpost,
  overtack,
  chef,
  forChefen,
  manuell,
  hanterare,
  utkopsprocent,
  slutdatum,
  loptid,
  tjanster,
}: {
  brutto: number | null;
  utkop: number | null;
  netto: number | null;
  provision: number | null;
  restpost: number | null;
  overtack: number | null;
  chef: { override_percent: number; own_sale_percent: number } | null;
  forChefen: boolean;
  manuell: boolean;
  hanterare: boolean;
  utkopsprocent: number | null;
  slutdatum: string | null;
  loptid: number | null;
  tjanster: Tjanst[];
}) {
  if (brutto === null || netto === null) return null;

  const harUtkop = utkop !== null && utkop > 0;
  const tjansternasVarde = tjanster.reduce((s, t) => s + tjanstensVarde(t, loptid ?? 0), 0);

  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-sm bg-surface-alt p-4 sm:grid-cols-2">
      <Tal
        etikett="Ordervärde"
        varde={kronor(brutto)}
        under={
          tjansternasVarde > 0
            ? `Månadsbeloppet gånger bindningstiden, plus ${kronor(tjansternasVarde)} i tjänster`
            : manuell
              ? "Månadsbeloppet gånger bindningstiden"
              : "Månadspriset gånger bindningstiden"
        }
      />

      {/* SLUTDATUMET STAR I SAMMA RUTA SOM PENGARNA, och det ar avsiktligt: det
          ar ett av de tal affaren bestar av, inte en upplysning vid sidan om. */}
      {slutdatum && (
        <Tal
          etikett="Avtalet löper till"
          varde={slutdatum}
          under="Påminnelsen tänds 90 dagar innan"
        />
      )}

      {harUtkop && (
        <>
          <Tal
            etikett="Utköp"
            varde={`− ${kronor(utkop!)}`}
            under="Går till att lösa kunden ur det gamla avtalet"
          />
          <Tal
            etikett="Kvar av affären"
            varde={kronor(netto)}
            under="Basen för både provision och övertäck"
          />
        </>
      )}

      {provision !== null ? (
        <Tal
          etikett="Provision till säljaren"
          varde={kronor(provision)}
          under={
            forChefen
              ? `${chef!.own_sale_percent} % av ${harUtkop ? "det som är kvar" : "ordervärdet"} — säljchefens egen försäljning`
              : harUtkop && utkopsprocent !== null && !manuell
                ? `${utkopsprocent} % av det som är kvar efter utköpet`
                : "Inskriven för hand"
          }
        />
      ) : (
        <Tal
          etikett="Provision till säljaren"
          varde="Räknas vid godkännandet"
          under={
            harUtkop && utkopsprocent === null
              ? "Ingen utköpssats är satt — beloppet måste skrivas in"
              : "Ur paketmatrisen, efter signeringsdatum"
          }
        />
      )}

      {/* Restposten visas bara nar den betyder nagot — alltsa nar bada talen ar
          kanda. For en vanlig paketorder gor godkannandet den rakningen. */}
      {restpost !== null && chef !== null && (
        <>
          <Tal
            etikett="Kvar efter provisionen"
            varde={kronor(restpost)}
            under={
              restpost === 0 && netto < (provision ?? 0)
                ? "Provisionen överstiger det som blev kvar — övertäcket blir noll"
                : harUtkop
                  ? "Det som är kvar efter utköpet, minus säljarens provision"
                  : "Ordervärdet minus säljarens provision"
            }
          />
          <Tal
            etikett="Övertäck till säljchefen"
            varde={kronor(overtack ?? 0)}
            under={`${chef.override_percent} % av det som blir över`}
          />
        </>
      )}

      {/* TJANSTER MED EGET SLUT RAKNAS UPP MED DATUM. Den som lagt in en vaxel
          pa 36 manader under ett tvaarsavtal ska se att den lever langre — det
          ar just den skillnaden som gor att den far en egen paminnelse. */}
      {tjanster.some((t) => tjanstensSlut(t)) && (
        <div className="sm:col-span-2">
          <dt className="text-micro uppercase text-ink-500">Tjänster med eget slut</dt>
          <dd className="mt-1 flex flex-col gap-0.5">
            {tjanster.map((t) => {
              const slut = tjanstensSlut(t);
              if (!slut) return null;
              return (
                <span key={`${t.name}-${slut}`} className="text-small text-ink-700">
                  {t.name} · {FAKTURERING_ETIKETT[t.billing]} {kronor(t.amount)} · löper till{" "}
                  <strong>{slut}</strong>
                </span>
              );
            })}
          </dd>
        </div>
      )}

      {forChefen && (
        <p className="text-small text-ink-500 sm:col-span-2">
          Ordern står på säljchefen själv. Då gäller satsen för egen försäljning i stället för
          paketmatrisen, och inget övertäck bokförs — det finns ingen annans affär att ersätta.
        </p>
      )}

      {harUtkop && !forChefen && (
        <p className="text-small text-ink-500 sm:col-span-2">
          Utköpet ersätter paketmatrisen för den här affären — de två läggs aldrig ihop. Matrisens
          belopp är redan bolagets andel av ett fullt ordervärde, och den marginalen finns inte när
          en del av värdet gått till att köpa ut kunden.
        </p>
      )}

      {!manuell && !forChefen && !harUtkop && hanterare && (
        <p className="text-small text-ink-500 sm:col-span-2">
          Ordervärdet är inte pengar till någon — det är vad affären är värd för bolaget. Provision
          och övertäck räknas ur det när ordern godkänns.
        </p>
      )}
    </dl>
  );
}

function Tal({ etikett, varde, under }: { etikett: string; varde: string; under: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className="tnum mt-1 text-h2 text-ink-900">{varde}</dd>
      <p className="mt-0.5 text-micro text-ink-500">{under}</p>
    </div>
  );
}
