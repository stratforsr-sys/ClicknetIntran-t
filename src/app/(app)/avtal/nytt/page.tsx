import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { Formular } from "./Formular";

export const dynamic = "force-dynamic";

export default async function NyttAvtal({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const { person } = await searchParams;
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "admin")) notFound();

  const supabase = await supabaseServer();
  const [{ data: mallar }, { data: personer }] = await Promise.all([
    supabase
      .from("contract_template")
      .select("id, title, body_md, employment_type")
      .eq("status", "published")
      .order("title"),
    supabase
      .from("employee")
      .select("id, first_name, last_name, employment_type, status")
      .neq("status", "offboarded")
      .order("first_name"),
  ]);

  // Utan en publicerad mall finns ingenting att skapa ett avtal ur, och ett
  // tomt formular med en tom rullista forklarar inte varfor.
  if ((mallar ?? []).length === 0) {
    return (
      <div className="pt-2">
        <Card>
          <EmptyState
            rubrik="Ingen publicerad mall"
            text="Ett avtal skapas ur en mall. Skriv en och publicera den först — en mall som är utkast går inte att skapa avtal ur. Har du redan ett påskrivet avtal kan du bifoga det som fil i stället."
            handling={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink
                  href={person ? `/avtal/bifoga?person=${encodeURIComponent(person)}` : "/avtal/bifoga"}
                  variant="primar"
                >
                  Bifoga påskrivet avtal
                </ButtonLink>
                <ButtonLink href="/avtal/mallar/ny">Skriv en mall</ButtonLink>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <Formular
      mallar={mallar ?? []}
      personer={(personer ?? []).map((p) => ({
        id: p.id,
        namn: fullName(p),
        employment_type: p.employment_type,
      }))}
    />
  );
}
