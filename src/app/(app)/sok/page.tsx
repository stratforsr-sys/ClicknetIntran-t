import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { prefixfraga } from "@/lib/dokument";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { KALLOR, KALLA_ETIKETT, PER_KALLA, ilikeMonster, orVillkor, utdrag, type Traff } from "@/lib/sokning";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sök — Clicknet Nav" };

/**
 * ===========================================================================
 * E2.13: en sokning over hela navet.
 *
 * VARJE FRAGA GAR MED ANVANDARENS EGEN TOKEN. Det ar hela behorighetsmodellen
 * pa den har sidan: ett utkast, en nyhet till ekonomi, ett konfidentiellt
 * arende och en kollega man inte far se i registret ger noll rader ur
 * databasen — inte "filtreras bort" har.
 *
 * Foljden ar att sidan inte behover veta nagonting om malgrupper, och att den
 * inte kan glomma bort en regel som laggs till i en modul senare. Det ar
 * samma val som `hamtaNotiser()` gjorde for klockan.
 *
 * Sokningen kombinerar tva satt att fraga, och skalet star i `prefixfraga`:
 * den svenska ordstamsanalysen tar inte bort alla bestamda andelser, sa den
 * som skriver "lakarintyget" hittar inte ett dokument som sager
 * "lakarintyg". Forst provas den vanliga fragan, sedan prefixfragan.
 * ===========================================================================
 */
export default async function Soksida({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim();
  const user = await getCurrentUser();
  const supabase = await supabaseServer();

  if (!q) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <h1 className="text-display text-ink-900">Sök</h1>
        <Card>
          <EmptyState
            rubrik="Skriv något att söka på"
            text="Sökrutan ligger i toppraden. Tryck snedstreck var som helst i navet för att hoppa dit. Sökningen går igenom rutiner, bilagor, nyheter, kurser, personal och dina ärenden."
          />
        </Card>
      </div>
    );
  }

  const monster = ilikeMonster(q);
  const pf = prefixfraga(q);

  const [dokument, nyheter, kurser, personer, arenden] = await Promise.all([
    // Rutinerna. `search` bar sedan 0023 aven texten ur bifogade PDF:er, sa en
    // prislista som bilaga hittas pa vad som star i den.
    (async () => {
      const falt = "id, title, slug, category_path, body_md";
      const { data } = await supabase
        .from("document")
        .select(falt)
        .neq("status", "archived")
        .textSearch("search", q, { type: "websearch", config: "swedish" })
        .limit(PER_KALLA);
      if ((data?.length ?? 0) > 0 || !pf) return data ?? [];
      const { data: brett } = await supabase
        .from("document")
        .select(falt)
        .neq("status", "archived")
        .textSearch("search", pf, { config: "swedish" })
        .limit(PER_KALLA);
      return brett ?? [];
    })(),

    (async () => {
      const falt = "id, title, slug, body_md";
      const { data } = await supabase
        .from("news_post")
        .select(falt)
        .textSearch("search", q, { type: "websearch", config: "swedish" })
        .limit(PER_KALLA);
      if ((data?.length ?? 0) > 0 || !pf) return data ?? [];
      const { data: brett } = await supabase
        .from("news_post")
        .select(falt)
        .textSearch("search", pf, { config: "swedish" })
        .limit(PER_KALLA);
      return brett ?? [];
    })(),

    // Kurser har ingen sokkolumn. De ar fa och korta, sa ilike racker —
    // en genererad tsvector pa tio rader loser ett problem som inte finns.
    supabase
      .from("course")
      .select("id, title, slug, description_md")
      .eq("status", "published")
      .or(orVillkor(["title", "description_md"], q))
      .limit(PER_KALLA)
      .then((r) => r.data ?? []),

    // Personal. Den vanligaste sokningen i ett intranat ar ett namn, och RLS
    // avgor vilka man far se — en saljare ser inte hela registret.
    supabase
      .from("employee")
      .select("id, first_name, last_name, email, status")
      .neq("status", "offboarded")
      .or(orVillkor(["first_name", "last_name", "email"], q))
      .limit(PER_KALLA)
      .then((r) => r.data ?? []),

    // Arenden: egna alltid, andras bara for den som handlagger. Ett
    // konfidentiellt arende ger noll rader for alla utom saljchef och VD, och
    // det avgors av policyn i 0013 — inte har.
    supabase
      .from("hr_case")
      .select("id, subject, category, status")
      .ilike("subject", monster)
      .limit(PER_KALLA)
      .then((r) => r.data ?? []),
  ]);

  const rollnamn = new Map<string, string>();
  if (personer.length > 0) {
    const { data: roller } = await supabase
      .from("employee_role")
      .select("employee_id, role")
      .in("employee_id", personer.map((p) => p.id));
    for (const r of roller ?? []) {
      rollnamn.set(r.employee_id, ROLE_LABEL[r.role as Role] ?? r.role);
    }
  }

  const traffar: Record<string, Traff[]> = {
    rutin: dokument.map((d) => ({
      typ: "rutin" as const,
      titel: d.title,
      under: utdrag(d.body_md, q) ?? d.category_path,
      href: `/rutiner/${d.slug}`,
    })),
    nyhet: nyheter.map((n) => ({
      typ: "nyhet" as const,
      titel: n.title,
      under: utdrag(n.body_md, q),
      href: `/nyheter/${n.slug}`,
    })),
    kurs: kurser.map((k) => ({
      typ: "kurs" as const,
      titel: k.title,
      under: utdrag(k.description_md, q),
      href: `/utbildning/${k.slug}`,
    })),
    person: personer.map((p) => ({
      typ: "person" as const,
      titel: fullName(p),
      under: rollnamn.get(p.id) ? `${rollnamn.get(p.id)} · ${p.email}` : p.email,
      href: `/personal/${p.id}`,
    })),
    arende: arenden.map((a) => ({
      typ: "arende" as const,
      titel: a.subject,
      under: a.status === "resolved" ? "Avslutat ärende" : "Öppet ärende",
      href: `/arenden/${a.id}`,
    })),
  };

  const antal = Object.values(traffar).reduce((s, t) => s + t.length, 0);

  /**
   * E6.5 / AC-12.5: en sokning utan traff ar det narmaste navet kommer ett
   * onskemal. Den som letade forgaves letade efter nagot som borde finnas.
   *
   * Bokfors HAR och inte i sokrutan, eftersom det ar forst nu antalet traffar
   * ar kant — och det ar noll traffar som ar uppgiften, inte sokningen.
   *
   * Ingen person foljer med. `registrera_sokmiss` tar bara strangen, och
   * `search_miss` har ingen kolumn att lagga ett anvandar-id i (0029).
   *
   * Ett fel far aldrig falla traffsidan. Statistik ar inte ett krav pa att
   * sokningen fungerar, och den som sokte ska se sitt svar oavsett.
   */
  if (antal === 0) {
    await supabase.rpc("registrera_sokmiss", { p_q: q });
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Sökning</h1>
        <p className="mt-1 text-body text-ink-500">
          {antal === 0
            ? `Inga träffar på "${q}".`
            : `${antal} ${antal === 1 ? "träff" : "träffar"} på "${q}".`}
        </p>
      </div>

      {antal === 0 ? (
        <Card>
          <EmptyState
            rubrik="Ingenting hittades"
            text={
              // Att saga vad sokningen TACKER ar viktigare an att be nagon
              // prova igen: den vanligaste orsaken till noll traffar ar att
              // det man letar efter inte finns i navet an.
              "Sökningen går igenom rutiner och deras bilagor, nyheter, kurser, personal och de ärenden du får se. Hittar du inte något som borde finnas är det troligen inte skrivet än."
            }
          />
        </Card>
      ) : (
        KALLOR.filter((k) => traffar[k].length > 0).map((kalla) => (
          <Card key={kalla}>
            <CardHeader titel={KALLA_ETIKETT[kalla]} />
            <ul className="flex flex-col">
              {traffar[kalla].map((t) => (
                <li key={t.href} className="border-b border-canvas last:border-0">
                  <Link
                    href={t.href}
                    className="flex min-h-14 items-center gap-3 py-3 hover:text-brand-700"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink-900">{t.titel}</span>
                      {t.under && (
                        <span className="mt-0.5 block truncate text-small text-ink-500">{t.under}</span>
                      )}
                    </span>
                    <Ikon namn="tillbaka" className="size-4 shrink-0 rotate-180 text-ink-300" />
                  </Link>
                </li>
              ))}
            </ul>

            {traffar[kalla].length === PER_KALLA && kalla === "rutin" && (
              <Link
                href={`/rutiner?q=${encodeURIComponent(q)}`}
                className="mt-2 inline-block text-small font-semibold text-brand-700 hover:text-brand-900"
              >
                Se alla träffar i rutinbiblioteket
              </Link>
            )}
          </Card>
        ))
      )}

      {!user?.employee && (
        <p className="text-small text-ink-500">
          Du är inte aktiverad än, så sökningen når bara det som är öppet för alla.
        </p>
      )}
    </div>
  );
}
