import { redirect } from "next/navigation";

// Shorts have their own tab now (13.14.a).
export default function QuickPage(): never {
  redirect("/shorts");
}
