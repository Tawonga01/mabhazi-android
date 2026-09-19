import React from "react";
import { LegalDocument } from "@/components/LegalDocument";

export default function TermsScreen() {
  return (
    <LegalDocument
      title="Terms"
      intro="By using Mabhazi, you agree to use this community bus-route information service responsibly. The current version is shown when you accept these Terms."
      sections={[
        {
          title: "Use the service responsibly",
          body: "Use Mabhazi lawfully. Do not impersonate another person, interfere with the service, or submit abusive, unlawful, deceptive, or harmful content. Route information is community supplied and may be out of date or incorrect, so verify important travel details with the operator.",
        },
        {
          title: "Community contributions",
          body: "Before submitting a route, rating, report, correction, confirmation, or comment, provide information you reasonably believe is accurate and do not include sensitive personal information. Contributions may be public and may be reviewed, hidden, edited, or removed.",
        },
        {
          title: "Report and block",
          body: "Use Report content for a submission, Report user for an account, and Block user where those controls are available. Abuse and safety reports remain available to authenticated users even before accepting the current community-contribution terms, so a safety concern is never blocked by the acceptance gate. Reports help moderation but do not guarantee a particular outcome or response.",
        },
        {
          title: "Moderation limits",
          body: "Mabhazi does not promise that every contribution or report will be reviewed, that every inaccurate statement will be caught, or that the service will always be available.",
        },
        {
          title: "Account deletion",
          body: "You can permanently delete your Mabhazi account from your profile. Shared route records may remain only without your account attribution. Deleting Mabhazi does not delete your separate Google account.",
        },
      ]}
    />
  );
}