"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { notifiera } from "@/lib/notishandelse-server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { sattKvitto } from "@/lib/toast-server";
import { arLeadstatus, leadTitel, maskeraPersonnummer, STATUS_ETIKETT } from "@/lib/leads";
import { tilldelaVillkorat } from "@/lib/nav2/leadsforma";

/**
 * Den som fördelar leads: säljchef, VD, teamledare och superadmin (`admin`,
 * beställaren 2026-10-20). Samma krets som `lead_read` släpper in till ALLA
 * leads (0076, superadmin sedan 0135) — den som ser ett otilldelat lead ska
 * också kunna ge det till någon.
 */
function farFordela(user: Awaited<ReturnType<typeof getCurrentUser>>): boolean {
  return hasRole(user, "sales_manager", "ceo", "team_lead", "admin");
}

type Leadrad = {
  id: string;
  status: string;
  assigned_to: string | null;
  note: string | null;
  company: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
};

async function hamtaLead(id: string): Promise<Leadrad | null> {
  const { data } = await supabaseAdmin()
    .from("lead")
    .select("id, status, assigned_to, note, company, name, email, phone")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Leadrad | null) ?? null;
}

/**
 * Att ge ett lead till någon. Villkorad (granskningen F2-2): uppdateringen
 * gäller bara om leadet fortfarande har den säljare man såg, och notisen och
 * mejlet går bara när en rad ändrats. Två fördelare som trycker samtidigt får
 * alltså inte båda igenom, och en tilldelning som automatiken nyss gjorde
 * skrivs inte tyst över.
 *
 * `fore` i formuläret är den säljare sidan visade (tom = ingen). Gamla Nav
 * skickar inget, och då gäller det som läses i samma anrop. Ett nej kastas
 * som ett fel med beskedet, som de andra felen här.
 */
export async function tilldelaLead(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farFordela(user)) throw new Error("Du saknar behörighet.");
  const aktor = user.employee.id;

  const id = String(form.get("lead_id") ?? "");
  const till = String(form.get("assigned_to") ?? "").trim() || null;
  const fore = form.has("fore") ? String(form.get("fore") ?? "").trim() || null : undefined;

  const db = supabaseAdmin();

  if (till) {
    const { data: person } = await db.from("employee").select("id, status").eq("id", till).maybeSingle();
    if (!person || person.status === "offboarded") throw new Error("Personen finns inte i registret.");
  }

  const r = await tilldelaVillkorat<Leadrad>(
    {
      las: hamtaLead,
      uppdatera: async (leadId, nyTill, vantad) => {
        const q = db
          .from("lead")
          .update({ assigned_to: nyTill, assigned_at: nyTill ? new Date().toISOString() : null })
          .eq("id", leadId);
        const { data, error } = await (vantad === null ? q.is("assigned_to", null) : q.eq("assigned_to", vantad)).select("id");
        if (error) throw new Error(`Tilldelningen kunde inte sparas: ${error.message}`);
        return (data ?? []).length;
      },
      namn: async (vem) => {
        const { data } = await db.from("employee").select("first_name, last_name").eq("id", vem).maybeSingle();
        const p = data as { first_name: string | null; last_name: string | null } | null;
        return p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || null : null;
      },
      efter: async (lead, fran) => {
        await skrivHandelse({
          actorId: aktor,
          action: till ? "lead.assigned" : "lead.unassigned",
          objectType: "lead",
          objectId: id,
          meta: { till, fran },
        });

        // Den som tar ett lead själv får ingen notis — `notifiera()` hoppar över
        // aktören, och det är rätt: hen vet redan.
        if (till) {
          await notifiera({
            till,
            av: aktor,
            kalla: "lead-tilldelad",
            typ: "lead",
            rubrik: `Lead till dig: ${leadTitel(lead)}`,
            detalj: [lead.company ? lead.name : null, lead.phone ?? lead.email].filter(Boolean).join(" · "),
            href: `/leads/${id}`,
            objekt: { typ: "lead", id },
          });
        }
      },
    },
    id,
    till,
    fore,
  );
  if (r.fel) throw new Error(r.fel);
  if (!r.andrad) return;

  await sattKvitto({ text: till ? "Leadet är tilldelat." : "Tilldelningen är borttagen." });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

export async function uppdateraLead(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");

  const id = String(form.get("lead_id") ?? "");
  const lead = await hamtaLead(id);
  if (!lead) throw new Error("Leadet finns inte.");

  // Säljaren som har leadet sköter det. Fördelarna kan rätta vilket som helst.
  if (!farFordela(user) && lead.assigned_to !== user.employee.id) {
    throw new Error("Leadet är inte ditt.");
  }

  const status = String(form.get("status") ?? "");
  if (!arLeadstatus(status)) throw new Error("Okänd status.");

  // K27: maskeras i stället för att nekas. En säljare som skriver kundens
  // orgnummer i anteckningen ska inte förlora resten av texten — 0076:s
  // villkor hade annars fällt hela sparningen.
  const anteckning = maskeraPersonnummer(String(form.get("anteckning") ?? "").trim()).slice(0, 5000) || null;

  const statusAndrad = status !== lead.status;
  const anteckningAndrad = anteckning !== (lead.note ?? null);
  if (!statusAndrad && !anteckningAndrad) return;

  const { error } = await supabaseAdmin()
    .from("lead")
    .update({
      status,
      note: anteckning,
      ...(statusAndrad ? { status_changed_at: new Date().toISOString() } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(`Leadet kunde inte sparas: ${error.message}`);

  // Anteckningens text loggas inte. Loggen säger att något ändrades, leadet
  // säger vad.
  await skrivHandelse({
    actorId: user.employee.id,
    action: statusAndrad ? "lead.status_changed" : "lead.note_changed",
    objectType: "lead",
    objectId: id,
    meta: statusAndrad ? { fran: lead.status, till: status } : null,
  });

  await sattKvitto({ text: statusAndrad ? `Status: ${STATUS_ETIKETT[status]}.` : "Anteckningen är sparad." });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}
