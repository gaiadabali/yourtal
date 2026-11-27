import { redirect } from "next/navigation";

/** `/staff/spambank` has no page of its own: the leads list is the front door. */
export default function StaffSpambankIndexPage() {
  redirect("/staff/spambank/leads");
}
