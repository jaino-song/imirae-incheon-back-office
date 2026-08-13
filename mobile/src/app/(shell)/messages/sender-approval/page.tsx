import { redirect } from "next/navigation";

export default function MessageSenderApprovalRedirectPage() {
  redirect("/messages/settings");
}
