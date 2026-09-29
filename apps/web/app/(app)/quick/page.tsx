import { redirect } from "next/navigation";

// Quick campaigns earn inside the Home feed now (11.4.b).
export default function QuickPage(): never {
  redirect("/home");
}
