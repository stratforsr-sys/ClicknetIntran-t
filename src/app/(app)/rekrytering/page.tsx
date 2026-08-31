import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseServer } from "@/lib/supabase/server";
import {
  STEG_ETIKETT,
  TRATTSTEG,
  arOppen,
  liggetid,
  tratt,
  type Kandidat,
  type Steg,
} from "@/lib/rekrytering";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rekrytering — Clicknet Nav" };

/** Efter sa har manga dagar pa samma steg ar kandidaten inte i en process. */
const GLOMD_EFTER = 14;

type Rad = Kandidat & {
  first_name: string;
  last_name: string;
  role_title: string;
  stage_at: string;
  no_show_count: number;
};

/**
 * E10 M7. Kön och tratten.
 *
 * Sidan har inget eget rollfilter: `candidate_read` i 0030 slapper in den som
 * far rekrytera och ingen annan. Ser du noll rader ar det RLS som svarat, och
 * da ska sidan saga det i klartext i stallet for att se tom ut.
 */
export default async function Rekrytering() {
  const supabase = await supabaseServer();

  const [{ data: kandidater }, { data: kallor }] = await Promise.all([
    supabase
      .from("candidate")
      .select("id, first_name, last_name, role_title, stage, stage_at, applied_at, closed_at, source_slug, no_show_count")
      .order("stage_at", { ascending: true }),
    supabase.from("recruitment_source").select("slug, label"),
  ]);

  const rader = (kandidater ?? []) as Rad[];
  const namnPaKalla = new Map((kallor ?? []).map((k) => [k.slug, k.label]));
  const oppna = rader.filter((r) => arOppen(r.stage));
  const trattrader = tratt(rader);

  if ((kallor ?? []).length === 0) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <h1 className="text-display text-ink-900">Rekrytering</h1>
        <Card>
          <EmptyState
            rubrik="Du har inte behörighet till rekrytering"
            text="Modulen är öppen för säljchef, VD och administratör, samt för den som fått behörigheten Rekryterare tilldelad under Personal."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="rekrytering" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div data-guide="rekrytering.rubrik">
          <h1 className="text-display text-ink-900">Rekrytering</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {oppna.length === 0
              ? "Ingen pågående process."
              : `${oppna.length} pågående ${oppna.length === 1 ? "process" : "processer"}, sorterade efter hur länge de stått stilla.`}
          </p>
        </div>
        <ButtonLink href="/rekrytering/ny">Ny kandidat</ButtonLink>
      </div>

      <Card className="p-0 md:p-0" guide="rekrytering.lista">
        {oppna.length === 0 ? (
          <div className="p-6">
            <EmptyState
              rubrik="Ingen kandidat i processen"
              text="Lägg upp den första så syns hen här tills hen är anställd eller fått avslag."
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {oppna.map((k) => {
              const dagar = liggetid(k.stage_at);
              const glomd = dagar !== null && dagar >= GLOMD_EFTER;
              return (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-canvas px-6 py-4 last:border-0"
                >
                  <Link
                    href={`/rekrytering/${k.id}`}
                    className="min-w-48 flex-1 text-body text-ink-900 underline-offset-2 hover:underline"
                  >
                    {k.first_name} {k.last_name}
                  </Link>
                  <span className="text-small text-ink-500">{k.role_title}</span>
                  <span className="text-small text-ink-500">
                    {namnPaKalla.get(k.source_slug) ?? k.source_slug}
                  </span>
                  {k.no_show_count > 0 && (
                    <Badge ton="danger">
                      Uteblev {k.no_show_count} {k.no_show_count === 1 ? "gång" : "gånger"}
                    </Badge>
                  )}
                  <Badge ton="info">{STEG_ETIKETT[k.stage]}</Badge>
                  {/* Den enda siffran pa sidan som pekar pa nagot att GORA i dag. */}
                  <span
                    className={`tnum w-28 shrink-0 text-right text-small ${glomd ? "text-danger-ink" : "text-ink-500"}`}
                  >
                    {dagar === null ? "" : `${dagar} ${dagar === 1 ? "dag" : "dagar"}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="text-h2 text-ink-900">Tratten per källa</h2>
        <p className="mt-1 max-w-[70ch] text-small text-ink-500">
          Varje steg räknar dem som <strong>kommit så långt</strong>, inte dem som står där just nu
          — en anställd har passerat erbjudandet. Avslag räknas för sig och aldrig som ett steg.
        </p>

        {trattrader.length === 0 ? (
          <div className="mt-4">
            <EmptyState rubrik="Ingen data än" text="Tratten fylls i takt med att kandidater läggs upp." />
          </div>
        ) : (
          <table className="mt-4 w-full text-small">
            <thead>
              <tr className="text-left text-ink-500">
                <th scope="col" className="py-2 pr-4 font-normal">Källa</th>
                {TRATTSTEG.map((s) => (
                  <th key={s} scope="col" className="py-2 pr-4 text-right font-normal">
                    {STEG_ETIKETT[s as Steg]}
                  </th>
                ))}
                <th scope="col" className="py-2 pr-4 text-right font-normal">Avslag</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Kvar 90 d</th>
                <th scope="col" className="py-2 text-right font-normal">Kvar 180 d</th>
              </tr>
            </thead>
            <tbody>
              {trattrader.map((r) => (
                <tr key={r.kalla} className="border-t border-canvas">
                  <td className="py-2 pr-4 text-ink-900">{namnPaKalla.get(r.kalla) ?? r.kalla}</td>
                  {TRATTSTEG.map((s) => (
                    <td key={s} className="tnum py-2 pr-4 text-right text-ink-700">
                      {r.per_steg[s as Steg]}
                    </td>
                  ))}
                  <td className="tnum py-2 pr-4 text-right text-ink-500">{r.avslag}</td>
                  <td className="tnum py-2 pr-4 text-right text-ink-700">{r.kvar_90}</td>
                  <td className="tnum py-2 text-right text-ink-700">{r.kvar_180}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
