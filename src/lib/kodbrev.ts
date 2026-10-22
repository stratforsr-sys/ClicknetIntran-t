/**
 * Mejlet med engångskoden: ämnesraden, texten och HTML-versionen.
 *
 * Samma formspråk som inloggningskortet: det mörka bandet med "nav", koden
 * stort i mono och en rad om vad den är till för. Tabeller och inline-stil,
 * för det är vad Outlook och Gmail läser; inga bilder och inga typsnitt som
 * måste hämtas. Koden står först i ämnesraden, så att den syns i aviseringen
 * och telefonen kan föreslå den i kodfältet.
 *
 * Ren logik utan import, så att provet kan köra den rakt av
 * (tests/inloggning.mjs). Tiden kommer färdigformaterad ("10:02").
 */

/** Vad koden är till för. Står i mejlet och i Händelseloggen (`auth.code_sent`). */
export type Kodsyfte = "logga-in" | "glomt" | "byte" | "steg2";

const RAD: Record<Kodsyfte, string> = {
  "logga-in": "Skriv in den på inloggningssidan.",
  glomt: "Med den loggar du in och väljer ett nytt lösenord.",
  byte: "Med den byter du lösenord utan det gamla.",
  steg2: "Med den bekräftar du den nya enheten.",
};

const SLUT = "Har du inte bett om en kod kan du strunta i mejlet. Ingen kommer in utan koden.";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const TYPSNITT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

export function kodbrev(
  kod: string,
  fornamn: string | null,
  syfte: Kodsyfte,
  gallerTill: string,
): { amne: string; text: string; html: string } {
  const hej = fornamn ? `Hej ${fornamn},` : "Hej,";
  const text = [
    hej,
    "",
    `Din kod till Clicknet Nav: ${kod}`,
    "",
    `${RAD[syfte]} Koden gäller till ${gallerTill}.`,
    "",
    SLUT,
    "",
    "Clicknet Nav",
  ].join("\n");

  const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Din kod till Clicknet Nav</title></head>
<body style="margin:0;padding:0;background:#EEF1EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1EC;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FBFCFA;border:1px solid #DCE3DA;border-radius:16px;">
<tr><td style="background:#0F2A22;border-radius:15px 15px 0 0;padding:14px 22px;font:700 18px/1 ${TYPSNITT};color:#EAF4EE;letter-spacing:-0.02em;">nav <span style="font-weight:400;font-size:12px;letter-spacing:0;color:#A8C2B6;">Clicknet</span></td></tr>
<tr><td style="padding:24px 24px 6px;font:400 15px/1.5 ${TYPSNITT};color:#13201C;">${esc(hej)}<br>Här är din kod till Clicknet Nav. ${esc(RAD[syfte])}</td></tr>
<tr><td style="padding:10px 24px 6px;font:600 32px/1.2 ${MONO};letter-spacing:0.18em;color:#13201C;">${esc(kod)}</td></tr>
<tr><td style="padding:6px 24px 24px;font:400 13px/1.5 ${TYPSNITT};color:#5B6862;">Koden gäller till ${esc(gallerTill)}. ${esc(SLUT)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { amne: `${kod} är din kod till Clicknet Nav`, text, html };
}
