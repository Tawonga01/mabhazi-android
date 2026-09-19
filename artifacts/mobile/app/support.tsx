import React from "react";
import { LegalDocument } from "@/components/LegalDocument";

export default function SupportScreen() {
  return (
    <LegalDocument
      title="Support"
      intro="Mabhazi support is available by email for account, privacy, and community safety questions."
      sections={[
        {
          title: "Contact",
          body: "Email tawongatsokodayi@gmail.com. Do not include your password, session token, or unnecessary personal information.",
        },
        {
          title: "Safety reports",
          body: "Use Report content for a comment, route detail, or other submission; Report user for an account; and Block user to stop seeing a person's community activity where that control is available.",
        },
        {
          title: "Account deletion",
          body: "Delete your Mabhazi account from Profile. The deletion permanently removes Mabhazi sessions, signed-in searches, ratings, reports, corrections, and contributions. Shared route records may remain only anonymized. Your separate Google account is unaffected.",
        },
        {
          title: "Moderation limitations",
          body: "Community information is user submitted. Reports are handled with the moderation tools available to the service, but review is not guaranteed and not every report will receive a response.",
        },
      ]}
    />
  );
}