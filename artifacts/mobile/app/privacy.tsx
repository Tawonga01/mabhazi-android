import React from "react";
import { LegalDocument } from "@/components/LegalDocument";

export default function PrivacyScreen() {
  return (
    <LegalDocument
      title="Privacy"
      intro="This notice describes the data used by Mabhazi, the community bus-route service."
      sections={[
        {
          title: "Operator",
          body: "Mabhazi is operated by Tawonga Tsokodayi. Country: not specified. Your separate Replit account is not the same as your Mabhazi account.",
        },
        {
          title: "What Mabhazi uses",
          body: "Mabhazi uses account and session data from sign-in, including your account ID, email, name, profile image, display-name changes, session token, and expiry. It also stores routes, stops, ratings, confirmations, corrections, reports, comments, prices, and delays that you submit.",
        },
        {
          title: "Search analytics",
          body: "A search can record its departure city, destination city, day filter, result count, and timestamp. Signed-in search events can be linked to your Mabhazi user ID. Anonymous searches have no user ID.",
        },
        {
          title: "Public community data",
          body: "Route details and a contributor display name can be shown to other users. After account deletion, account-linked searches, ratings, reports, corrections, contributions, and Mabhazi sessions are deleted. A shared route may remain only after its contributor link and name are removed and shown as Anonymous.",
        },
        {
          title: "Moderation",
          body: "Community submissions may be inaccurate or inappropriate. Mabhazi provides reporting and blocking tools and may review or remove content, but moderation is not guaranteed. Do not submit sensitive personal information in public content.",
        },
        {
          title: "Deletion",
          body: "Use Delete account from your signed-in profile to permanently delete Mabhazi account-linked data. This action does not delete your separate Replit account. If you cannot sign in, contact support without sending a password or session token.",
        },
      ]}
    />
  );
}