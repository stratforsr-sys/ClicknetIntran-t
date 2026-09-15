"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { LOPTIDER, ordervardeFor, periodFor, type Paket } from "@/lib/order";
import { kronor, manadsnamn } from "@/lib/provision";
import { nettoEfterUtkop } from "@/lib/utkop";
import { skapaOrder, type Orderstate } from "./actions";

type Person = { id: string; namn: string };

/**
 * Hela formularets tillstand, som en egen typ.
 *
 * Den star har och inte som ett `typeof`-uttryck pa startvardet, eftersom
 * `satt()` nedan ar generisk over dess nycklar — och en harledd typ hade gjort
 * felmeddelandet vid en felstavad nyckel obegripligt.
 */
type Formular = {
  bolag: string;
  orgnr: string;
  kontakt: string;
  telefon: string;
  mejl: string;
  paketId: number;
  loptid: number;
  signerat: string;
  saljare: string;
  tillagg: boolean;
  harUtkop: boolean;
  utkopstext: string;
  manuell: boolean;
  friVarde: string;
  friProvision: string;
  anteckning: string;
  godkann: boolean;
};

/**
 * Inmatningen av en order.
 *
 * Rakt <input> och inte <Input>: sidan har flera formular och hade annars delat
 * id — samma skal som i satsformularet i E15 och i provisionens inmatning.
 *
 * PAKET OCH LOPTID AR SELECT, INTE FRITEXT. De tva avgor tillsammans vilken
 * provision ordern ger, och en felskrivning dar syns forst nar nagon undrar
 * over sin lon.
 *
 * ===========================================================================
 * VARENDA FALT AR KONTROLLERAT, OCH DET AR EN BUGGFIX — INTE EN STILFRAGA.
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
 * Ingenting i granssnittet sa att manaden bytts. Kontrollen som skulle skydda
 * sparbarheten at alltsa upp en uppgift som faktiskt betyder pengar — vilken
 * manad affaren hor till. Anteckningskravet ar borttaget i 0060; det har
 * formularet ar den andra halvan av samma rattelse.
 *
 * Med kontrollerade falt overlever inmatningen ett felmeddelande. Formularet
 * toms av `nollstall()` nedan, och BARA nar ordern faktiskt sparats.
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
 * knappen trycktes. Rakningen ar densamma — `ordervardeFor` och
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
}: {
  paket: Paket[];
  personer: Person[];
  hanterare: boolean;
  idag: string;
  chef: { employee_id: string; override_percent: number; own_sale_percent: number } | null;
  utkopsprocent: number | null;
  stangdaManader: string[];
}) {
  const [state, action, vantar] = useActionState<Orderstate, FormData>(skapaOrder, {});

  // ---------------------------------------------------------------------------
  // Formularets tillstand. ALLT ligger har, inte i DOM:en — se rubriken ovan.
  // ---------------------------------------------------------------------------
  const tomt: Formular = {
    bolag: "",
    orgnr: "",
    kontakt: "",
    telefon: "",
    mejl: "",
    paketId: paket[0]?.id ?? 1,
    loptid: LOPTIDER[0] as number,
    signerat: idag,
    saljare: personer[0]?.id ?? "",
    tillagg: false,
    harUtkop: false,
    utkopstext: "",
    manuell: false,
    friVarde: "",
    friProvision: "",
    anteckning: "",
    godkann: true,
  };

  const [f, setF] = useState<Formular>(tomt);

  // Casten behovs: med en GENERISK nyckel harleder TypeScript den berakna
  // egenskapen som `string` och far da ett indexsignaturobjekt i stallet for
  // `Formular`. Nyckeln ar anda begransad till `keyof Formular` av signaturen,
  // sa castet bekraftar bara det anropet redan garanterar.
  const satt = <K extends keyof Formular>(nyckel: K, varde: Formular[K]) =>
    setF((gammalt) => ({ ...gammalt, [nyckel]: varde }) as Formular);

  // ===========================================================================
  // FORMULARET TOMS BARA NAR ORDERN FAKTISKT SPARATS.
  //
  // `state.ok` satts av actionen och bara av den. Ett fel lamnar allt orort,
  // vilket ar hela poangen med ovningen — se rubriken overst.
  //
  // DATUMET GAR TILLBAKA TILL I DAG vid en lyckad inmatning, och det ar ett val.
  // Alternativet — att lata det sta kvar pa det man senast anvande — sparar
  // klick nar man matar in en bunt efterhandsordrar, men gor ocksa att nasta
  // order tyst hamnar i fel manad om man glommer det. Manadsstampeln nedan
  // sager visserligen vilken manad som galler, men "sager" ar inte samma sak
  // som "hindrar". I dag ar det ratta svaret i de allra flesta fall.
  // ===========================================================================
  // `tomt` byggs om vid varje rendering men innehallet ar konstant, sa den hor
  // inte hemma i beroendelistan — den hade bara gjort effekten till en loop.
  // Effekten lyssnar pa `state` och ingenting annat.
  useEffect(() => {
    if (state.ok) setF({ ...tomt, signerat: idag });
     
  }, [state]);

  const valtPaket = paket.find((p) => p.id === f.paketId);

  // Ett fritt tal tolkas tillatande: mellanslag som tusentalsavgransare och
  // komma som decimaltecken ar hur folk faktiskt skriver kronor. Serverns
  // `tolkaBelopp` gor samma sak.
  const tolka = (text: string): number | null => {
    const rensat = text.replace(/[\s ]/g, "").replace(",", ".");
    if (!rensat) return null;
    const n = Number(rensat);
    return Number.isFinite(n) ? n : null;
  };

  // ---------------------------------------------------------------------------
  // Affaren, raknad pa samma satt som servern kommer att rakna den.
  // ---------------------------------------------------------------------------
  const brutto = f.manuell
    ? tolka(f.friVarde)
    : valtPaket
      ? ordervardeFor(valtPaket.list_price, f.loptid)
      : null;

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

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

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

        <label htmlFor="package_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Paket</span>
          <select
            id="package_id"
            name="package_id"
            required
            className={KONTROLL}
            value={f.paketId}
            onChange={(e) => satt("paketId", Number(e.target.value))}
          >
            {paket.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {kronor(p.list_price)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="term_months" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Avtalstid</span>
          <select
            id="term_months"
            name="term_months"
            required
            className={KONTROLL}
            value={f.loptid}
            onChange={(e) => satt("loptid", Number(e.target.value))}
          >
            {LOPTIDER.map((m) => (
              <option key={m} value={m}>
                {m} månader
              </option>
            ))}
          </select>
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

        {hanterare && personer.length > 0 && (
          <label htmlFor="salesperson_id" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Säljare</span>
            <select
              id="salesperson_id"
              name="salesperson_id"
              className={KONTROLL}
              value={f.saljare}
              onChange={(e) => satt("saljare", e.target.value)}
            >
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

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
          <label className="flex items-center gap-2 text-small text-ink-700">
            <input
              type="checkbox"
              checked={f.manuell}
              onChange={(e) => satt("manuell", e.target.checked)}
              className="size-4"
            />
            Ordern följer inte paketreglerna — jag sätter ordervärde och provision själv
          </label>

          {f.manuell && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="order_value" className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Ordervärde i kronor</span>
                <input
                  id="order_value"
                  name="order_value"
                  inputMode="decimal"
                  placeholder="18 000"
                  className={KONTROLL}
                  value={f.friVarde}
                  onChange={(e) => satt("friVarde", e.target.value)}
                />
                <span className="text-small text-ink-500">
                  Vad affären är värd för bolaget över hela avtalstiden, före ett eventuellt utköp.
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
 * Manaden ordern hamnar i, skriven ut under datumfaltet.
 *
 * ===========================================================================
 * RADEN FINNS FOR ATT ETT DATUM INTE AR EN MANAD FOR DEN SOM LASER DET.
 *
 * `2026-08-29` och `2026-09-01` ser ut som grannar och ar det inte: de hor till
 * olika loneperioder, och den ena kan vara stangd. Den som backdaterar en order
 * en vecka tanker "forra veckan", inte "augusti" — och det ar manaden som avgor
 * vad affaren ar vard och nar den betalas ut.
 *
 * VARNINGEN AR DEN VIKTIGARE HALVAN. Hor datumet till en FASTSTALLD manad
 * hamnar provisionen i den oppna perioden i stallet (avsnitt 5.6, O11). Det ar
 * ratt beteende — en stangd period oppnas aldrig — men det sades tidigare forst
 * i kvittensen, EFTER att knappen tryckts. Nu star det fore, dar det gar att
 * gora nagot at.
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
}) {
  if (brutto === null || netto === null) return null;

  const harUtkop = utkop !== null && utkop > 0;

  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-sm bg-surface-alt p-4 sm:grid-cols-2">
      <Tal
        etikett="Ordervärde"
        varde={kronor(brutto)}
        under={manuell ? "Inskrivet för hand" : "Månadspriset gånger avtalstiden"}
      />

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
