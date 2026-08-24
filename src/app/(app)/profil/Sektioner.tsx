import { cookies } from "next/headers";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { Ikon } from "@/components/shell/Ikon";
import {
  getCurrentUser,
  fullName,
  hasRole,
  canManageEmployees,
  type CurrentUser,
} from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { kraverMfa, kvittoGiltigt, STEG2_KAKA } from "@/lib/mfa";
import { farSeLonekostnad } from "@/lib/lonekostnad-server";
import {
  ROLE_LABEL,
  PERMISSION_LABEL,
  EMPLOYMENT_TYPE_LABEL,
  STATUS_LABEL,
} from "@/lib/roles";
import { Steg2 } from "./Steg2";
import { Losenord } from "./Losenord";

/**
 * Installningarnas innehall, en sektion per export.
 *
 * Sektionerna ritas pa TVA stallen: i dialogen som oppnas fran profilbilden i
 * sidopanelen, och pa /profil som ar samma installningar som egen sida. Att de
 * ar samma komponenter och inte tva uppsattningar ar hela poangen med filen —
 * ett fält som laggs till pa ena stallet och glomms pa det andra ar precis den
 * glidning som anstallningsflodet flyttade tva funktioner till lib for att
 * slippa.
 *
 * Filen ligger kvar i routekatalogen for /profil. Next behandlar bara
 * reserverade filnamn som rutter, och actionerna som `Losenord` och `Steg2`
 * anropar bor har — att flytta halva innehallet till src/components och lamna
 * andra halvan kvar hade gjort tva kataloger av en.
 */

/** Rutinen for "finns det nagot att visa i Administration alls?". */
export function harAdministration(user: CurrentUser | null): boolean {
  return (
    canManageEmployees(user) ||
    hasRole(user, "sales_manager", "ceo", "admin") ||
    farSeLonekostnad(user)
  );
}

export async function KontoSektion() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const supabase = await supabaseServer();
  const { data: team } = user.employee.team_id
    ? await supabase.from("team").select("name").eq("id", user.employee.team_id).maybeSingle()
    : { data: null };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          titel="Mina uppgifter"
          beskrivning="Behöver något i listan ändras, säg till din chef."
        />
        <dl className="grid gap-4 sm:grid-cols-2">
          <Rad etikett="Namn" varde={fullName(user.employee)} />
          <Rad etikett="E-post" varde={user.email} />
          <Rad etikett="Team" varde={team?.name ?? "Inget team"} />
          <Rad
            etikett="Anställning"
            varde={
              EMPLOYMENT_TYPE_LABEL[user.employee.employment_type] ??
              user.employee.employment_type
            }
          />
          <Rad etikett="Startdatum" varde={user.employee.start_date ?? "Inte satt"} />
          <div>
            <dt className="text-micro uppercase text-ink-500">Status</dt>
            <dd className="mt-1.5">
              <Badge ton={user.employee.status === "active" ? "ok" : "warn"}>
                {STATUS_LABEL[user.employee.status] ?? user.employee.status}
              </Badge>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-micro uppercase text-ink-500">Roller</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {user.roles.length ? (
                user.roles.map((r) => (
                  <Badge key={r} ton="brand">
                    {ROLE_LABEL[r]}
                  </Badge>
                ))
              ) : (
                <Badge ton="warn">Väntar på roll</Badge>
              )}
              {user.permissions.map((p) => (
                <Badge key={p} ton="accent">
                  {PERMISSION_LABEL[p]}
                </Badge>
              ))}
            </dd>
          </div>
        </dl>
      </Card>

      {/*
        AC-12.4, K25. Rattigheten star i K14, och en rattighet man maste be
        nagon om ar en rattighet man later bli att anvanda — darfor en lank och
        inte ett formular till chefen.

        Vanlig <a> och inte <Link>: svaret ar en fil att ladda ner, och
        klientnavigering hade forsokt rendera JSON som en sida.
      */}
      <Card>
        <CardHeader
          titel="Dina uppgifter i navet"
          beskrivning="Allt navet har registrerat om dig, tabell för tabell. Filen är din — hämtningen loggas, men innehållet läser ingen annan."
        />
        <a
          href={`/personal/${user.employee.id}/registerutdrag`}
          download
          className="inline-flex min-h-11 items-center rounded-full bg-canvas px-4 text-small font-semibold text-ink-900 transition-colors duration-fast hover:bg-ink-300/30"
        >
          Hämta registerutdrag
        </a>
      </Card>
    </div>
  );
}

export async function SakerhetSektion() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const obligatorisk = kraverMfa(user);
  const kvitto = (await cookies()).get(STEG2_KAKA)?.value;
  const enhetenIhagkommen = await kvittoGiltigt(kvitto, user.authUserId);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader titel="Lösenord" beskrivning="Byter du själv, när som helst." />
        <Losenord />
      </Card>

      <Card>
        <CardHeader
          titel="Kod vid inloggning"
          beskrivning={
            obligatorisk
              ? "Din roll når känsliga uppgifter. Därför bekräftas nya enheter med en kod."
              : "Ett extra steg vid inloggning på nya enheter. Avstängt tills vidare."
          }
        />
        <Steg2 obligatorisk={obligatorisk} enhetenIhagkommen={enhetenIhagkommen} />
      </Card>
    </div>
  );
}

/**
 * Genvagar till de vyer som staller in navet i stallet for att anvanda det.
 *
 * Varje post har SAMMA villkor som sidan den pekar pa. En lank som leder till
 * en omdirigering ar en meny som ljuger, och det ar samma regel som avgor
 * vilka poster som far finnas i sidopanelen (se nav-items.ts).
 *
 * Sidorna ligger kvar dar de ligger. Det har ar en vag in, inte en flytt:
 * fransvaroreglerna hor hemma bredvid franvaron for den som redan star dar.
 */
export async function AdministrationSektion() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const poster: { href: string; titel: string; text: string; ikon: string }[] = [];

  if (canManageEmployees(user)) {
    poster.push({
      href: "/tid/schema",
      titel: "Scheman",
      text: "Arbetstider och rastscheman. Ett schema ändras aldrig — en ny tid är en ny rad.",
      ikon: "tid",
    });
  }

  if (hasRole(user, "sales_manager", "ceo")) {
    poster.push({
      href: "/tid/sparrar",
      titel: "Spärrar",
      text: "Slår på och av moduler. Villkoren kontrolleras i databasen, inte i koden.",
      ikon: "las",
    });
  }

  if (hasRole(user, "sales_manager", "ceo", "admin")) {
    poster.push({
      href: "/franvaro/regler",
      titel: "Frånvaroregler",
      text: "Enda platsen reglerna kan ändras. Ändringen gäller i samma stund.",
      ikon: "klocka",
    });
  }

  if (farSeLonekostnad(user)) {
    poster.push({
      href: "/lonekostnad/satser",
      titel: "Satser och löner",
      text: "Arbetsgivaravgifter, månadslöner och täckningsgrad.",
      ikon: "kontroll",
    });
  }

  if (hasRole(user, "admin")) {
    poster.push({
      href: "/design",
      titel: "Designsystem",
      text: "Levande stilguide över varje primitiv i navet.",
      ikon: "design",
    });
  }

  if (!poster.length) return null;

  /* Egen yta i stallet for <Card>: kortet har sin egen inre marginal, och
     raderna ska ga kant i kant sa att skiljelinjerna nar hela vagen ut.
     `cn` ar en ren hopslagning utan tailwind-merge, sa en overskriven p-4
     hade avgjorts av ordningen i stilmallen och inte av ordningen har. */
  return (
    <div className="overflow-hidden rounded-md bg-surface shadow-elev-1">
      <ul>
        {poster.map((p, i) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className={cn(
                "flex items-start gap-3 p-4 transition-colors duration-fast",
                "hover:bg-canvas/70",
                i > 0 && "border-t border-canvas",
              )}
            >
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-canvas text-ink-700">
                <Ikon namn={p.ikon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-ink-900">{p.titel}</span>
                <span className="mt-0.5 block text-small text-ink-500">{p.text}</span>
              </span>
              <Ikon namn="fram" className="mt-2 size-5 shrink-0 text-ink-300" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rad({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className="mt-0.5 text-body text-ink-900">{varde}</dd>
    </div>
  );
}
