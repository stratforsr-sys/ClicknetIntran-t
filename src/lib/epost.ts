/**
 * Utgaende e-post via Resend.
 *
 * Engangskoden vid inloggning gar inte harifran — den skickar Supabase Auth
 * genom sin egen SMTP-installning. Det har ar navets egna utskick:
 * granskningspaminnelser (E2.5), certifikat som gar ut (E8.8) och notiser
 * fran nattjobben (E4.20).
 *
 * Modulen kastar aldrig. Ett nattjobb som mejlar trettio personer far inte
 * avbrytas for att den fjortonde adressen studsar — den ska skriva klart och
 * radovisa vad som inte gick fram.
 */

const RESEND_URL = "https://api.resend.com/emails";

/** Resend slapper igenom tva anrop per sekund. Kon andas mellan breven i
 *  stallet for att branna forsok pa 429. */
const PAUS_MS = 550;

const FORSOK = 3;

export type Brev = {
  till: string | string[];
  amne: string;
  text: string;
  html?: string;
  svaraTill?: string;
};

export type Utfall =
  | { skickat: true; id: string }
  | { skickat: false; orsak: string };

function avsandare(): string {
  return process.env.EMAIL_FROM?.trim() ?? "";
}

/** Sant nar navet kan mejla. Anropas av jobben sa att de kan hoppa over
 *  utskicket med en begriplig rad i svaret i stallet for att fallera. */
export function epostArKonfigurerad(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && avsandare());
}

const vila = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 och 5xx ar overgaende. 4xx i ovrigt ar fel i brevet och blir inte
 *  battre av att skickas igen. */
const gerNyttForsok = (status: number) => status === 429 || status >= 500;

export async function skickaEpost(brev: Brev): Promise<Utfall> {
  const nyckel = process.env.RESEND_API_KEY?.trim();
  const fran = avsandare();

  if (!nyckel || !fran) {
    return { skickat: false, orsak: "RESEND_API_KEY eller EMAIL_FROM saknas" };
  }

  const kropp = JSON.stringify({
    from: fran,
    to: Array.isArray(brev.till) ? brev.till : [brev.till],
    subject: brev.amne,
    text: brev.text,
    ...(brev.html ? { html: brev.html } : {}),
    ...(brev.svaraTill ? { reply_to: brev.svaraTill } : {}),
  });

  let sista = "okant fel";

  for (let forsok = 1; forsok <= FORSOK; forsok++) {
    try {
      const svar = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nyckel}`,
          "Content-Type": "application/json",
        },
        body: kropp,
        signal: AbortSignal.timeout(10_000),
      });

      if (svar.ok) {
        // Resend svarar med { id }. Id:t ar det enda spar som gar att folja
        // upp i deras logg nar nagon fragar om ett mejl kom fram.
        const data = (await svar.json()) as { id?: string };
        return { skickat: true, id: data.id ?? "" };
      }

      // Resend svarar oftast JSON aven pa fel, men inte alltid — en 502 fran
      // deras kant kommer som HTML. Las som text sa att felet inte doljs av
      // ett kraschat JSON-anrop.
      const text = (await svar.text()).slice(0, 300);
      sista = `Resend ${svar.status}: ${text}`;

      if (!gerNyttForsok(svar.status)) return { skickat: false, orsak: sista };
    } catch (fel) {
      sista = fel instanceof Error ? fel.message : String(fel);
    }

    if (forsok < FORSOK) await vila(PAUS_MS * forsok);
  }

  return { skickat: false, orsak: sista };
}

export type KoUtfall = { brev: Brev; utfall: Utfall };

/**
 * Skickar en hel omgang och lamnar tillbaka utfallet per brev.
 *
 * Sekventiellt med paus, inte parallellt: trettio samtidiga anrop ger tjugoatta
 * 429:or och en handfull mejl. Ett nattjobb har gott om tid, det har ingen
 * som vantar.
 */
export async function skickaKo(brevlada: Brev[]): Promise<KoUtfall[]> {
  const utfall: KoUtfall[] = [];

  for (const [i, brev] of brevlada.entries()) {
    if (i > 0) await vila(PAUS_MS);
    utfall.push({ brev, utfall: await skickaEpost(brev) });
  }

  return utfall;
}
