-- 0292: rollen Mötesbokare (meeting_booker).
--
-- Beställaren 2026-11-13: "Lägg till rollen mötesbokare". Rollen sätter personen
-- bland mötesbokarna på säljtavlan också innan hen bokat något, och ger samma
-- behörighet som Säljare i Nav 2.0 (BRHFRAN, nivaFor). Den är ingen säljande
-- roll: den som bara bokar möten står inte i topplistan för order.
--
-- Bara villkoret vidgas. Ingen rad ändras, och main-koden som inte känner rollen
-- påverkas inte: den läser rollerna som text.
--
-- 0291 är Mötens bekräftelse och 0293 provisionen på tjänster, båda körda före
-- den här 2026-11-13. Grenen uppgift-kollegas egen 0291 måste byta till 0294.
-- Omkörbar: villkoret tas bort och läggs tillbaka.

alter table public.employee_role drop constraint if exists employee_role_role_check;

alter table public.employee_role
  add constraint employee_role_role_check check (
    role = any (array[
      'salesperson',
      'meeting_booker',
      'team_lead',
      'sales_manager',
      'finance',
      'ceo',
      'project_manager',
      'admin',
      'delivery'
    ]::text[])
  );
