import React from "react";
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@/components/VectorIcon";
import { useColors } from "@/hooks/useColors";

export interface LegalSection {
  title: string;
  body: string;
}

interface LegalDocumentProps {
  title: string;
  intro: string;
  sections: LegalSection[];
}

const SUPPORT_EMAIL = "tawongatsokodayi@gmail.com";

/*
 * Keep the in-app copy aligned with the public legal pages. The route pages
 * still pass sections so this component remains reusable for non-legal
 * documents, but the canonical Mabhazi documents live here rather than
 * silently diverging between the app and API.
 */
const canonicalDocuments: Record<
  string,
  { intro: string; sections: LegalSection[] }
> = {
  Privacy: {
    intro:
      "This notice explains how Mabhazi uses information in its app and API. Mabhazi is separate from the Replit account that you may use to sign in.",
    sections: [
      {
        title: "Operator and contact",
        body: `Mabhazi is operated by Tawonga Tsokodayi. For privacy, account, or safety questions, email ${SUPPORT_EMAIL}.`,
      },
      {
        title: "Identity, hosting, and sign-in",
        body:
          "Mabhazi is hosted on Replit and uses Replit Auth through OpenID Connect (OIDC) for sign-in. Replit supplies sign-in claims such as an account identifier, email address, name, and profile-image URL when available. Mabhazi creates and maintains a separate Mabhazi account record from those claims; deleting a Mabhazi account does not delete the separate Replit account.",
      },
      {
        title: "Information Mabhazi uses",
        body:
          "Account and profile data includes the Mabhazi account identifier, email, first and last name, profile-image URL supplied by sign-in, chosen display-name changes, and account timestamps. Sign-in is needed for contributions, ratings, and reports; searching can be used without signing in. Session and authentication data includes generated session identifiers, sign-in state, OAuth access or refresh tokens, and token or session expiry. Community submissions include routes, stops, ratings, confirmations, corrections or claims, trip observations, comments, prices, delays, and other information you submit. A search may record its departure city, destination city, day filter, result count, and timestamp; signed-in searches can be linked to your Mabhazi user ID, while anonymous searches have no user ID.",
      },
      {
        title: "Abuse reports",
        body:
          "A report records the signed-in reporter, target type (route, comment, or user), target identifier, a reason such as sexual content, violent content, harassment, hate speech, spam, personal information, misleading content, or other, optional details, and moderation status. Moderators may add notes, reviewer information, and review timestamps so reports can be acted on.",
      },
      {
        title: "Public and private information",
        body:
          "Route details, stops, ratings and route observations, comments, and the contributor display name can be shown to other Mabhazi users. A public comment is shown with its author display name or available sign-in name, so do not treat a comment as private. The route API can expose a contributor identifier to support attribution, reporting, and blocking; it is not an email address or credential. Email, profile-image URL, session credentials, signed-in search links, and abuse-report details are not intended to be public community content. Abuse reports are shared with the operator and moderators who need them for safety review.",
      },
      {
        title: "Service providers and security",
        body:
          "Replit hosts Mabhazi and provides Replit Auth/OIDC sign-in; the PostgreSQL application database is part of the deployed service. The current application has no advertising SDK or third-party analytics integration, and Mabhazi does not sell personal information. API traffic uses HTTPS/TLS. Browser sessions use Secure, HttpOnly, SameSite cookies; native mobile session tokens use the operating system-backed expo-secure-store, while the web version uses browser local storage.",
      },
      {
        title: "Local block settings",
        body:
          "When you block a contributor, the mobile app stores that contributor's identifier, displayed name, and block time in local app storage. This device preference is not uploaded to the Mabhazi API and remains until you unblock the contributor or clear the app's local data.",
      },
      {
        title: "Retention",
        body:
          "Active account and community records are retained while needed to provide the service and safety features. Mabhazi sessions are configured to expire after seven days and expired sessions are removed when encountered. There is no fixed public deletion interval currently configured for search events, moderation records, or operational logs; they may be retained as needed for operation, security, abuse review, and legal obligations. If the hosting environment creates backups, limited copies may persist until its ordinary backup lifecycle expires. No fixed backup or log-retention period is promised.",
      },
      {
        title: "Account deletion",
        body:
          "Use the public Delete account page while signed in, or email support if you cannot sign in. Deletion removes your Mabhazi user record, sessions, signed-in search events, ratings, route reports and comments, claims or corrections, contributions, and abuse reports that you filed. A shared route may remain when useful to the community, but its contributor link and name are removed and shown as Anonymous. Moderation references can remain only in de-identified audit form. Deletion does not delete the separate Replit account, this device's block list, or copies that may already exist in operational logs or backups.",
      },
      {
        title: "Privacy requests and safety",
        body:
          `Depending on where you live, you may have rights to request access to, correction of, deletion of, restriction of, or a copy of your personal information, or to object to a use. Email ${SUPPORT_EMAIL} with enough information for account verification, without sending a password or session token. Mabhazi provides reporting for routes, comments, and users and a device-level block control. Reports are reviewed through the available moderation tools and content may be removed or hidden; review can take time and cannot guarantee that every inaccurate or objectionable submission is identified.`,
      },
    ],
  },
  Terms: {
    intro:
      "By using Mabhazi, you agree to use this community bus-route information service lawfully, honestly, and respectfully.",
    sections: [
      {
        title: "Use of the service",
        body:
          "Do not interfere with Mabhazi, evade safety controls, impersonate another person, or use another person's account. Route information is community supplied and may be out of date or incorrect, so verify important travel details with the operator.",
      },
      {
        title: "Community contributions",
        body:
          "Before submitting a route, rating, report, correction, confirmation, or comment, agree to these terms and provide information you reasonably believe is accurate. Contributions can be visible to the public, including the contributor display name and comment author name. Do not include passwords, session tokens, or unnecessary personal information.",
      },
      {
        title: "Prohibited content and conduct",
        body:
          "You must not submit, request, promote, or use Mabhazi for harassment or bullying, hate speech, threats or violence, sexual exploitation or child sexual abuse, illegal content or activity, spam or repetitive abuse, fraud or deception, impersonation, or another person's personal data. Do not use public content or reports to dox, intimidate, exploit, or target someone. Misleading, sexually explicit, dangerous, or otherwise objectionable content may also be removed.",
      },
      {
        title: "Reporting, blocking, and ongoing moderation",
        body:
          "Use Report content for a route or comment, Report user for an account, and Block user to hide a contributor's community activity on your device where those controls are available. Mabhazi maintains ongoing moderation: reports are reviewed with the tools available to the operator, and content may be removed or hidden and accounts may lose access. Reports do not guarantee a particular outcome or response, and no moderation system is instant or perfect.",
      },
      {
        title: "Availability and route accuracy",
        body:
          "Mabhazi is a community information tool. Service availability, route accuracy, and the completeness of moderation cannot be guaranteed. Nothing in these terms changes your rights under applicable law.",
      },
      {
        title: "Account deletion",
        body:
          "You can delete your Mabhazi account from Profile or through the public Delete account page. Account deletion removes account-linked Mabhazi records as described in the Privacy notice; shared routes may remain only without your account attribution. Deleting Mabhazi does not delete your separate Replit account.",
      },
    ],
  },
  Support: {
    intro:
      "Mabhazi support is available by email for account, privacy, and community safety questions.",
    sections: [
      {
        title: "Contact",
        body: `Email ${SUPPORT_EMAIL}. Do not include your password, session token, or unnecessary personal information.`,
      },
      {
        title: "Safety reports",
        body:
          "Use Report content for a comment, route detail, or other submission; Report user for an account; and Block user to stop seeing a person's community activity on this device where that control is available. Reports can identify a route, comment, or user and include reasons such as harassment, hate speech, violence, sexual content, spam, personal information, misleading content, or other.",
      },
      {
        title: "Account deletion",
        body:
          "Delete your Mabhazi account from Profile or at https://mabhaziv-2.replit.app/api/delete-account after signing in. This removes Mabhazi sessions, searches linked to your account, ratings, route reports and comments, corrections, contributions, and abuse reports that you filed. Shared route records may remain only anonymized. Your separate Replit account and this device's local block list are unaffected.",
      },
      {
        title: "Moderation",
        body:
          "Mabhazi reviews safety reports through its available moderation tools and may remove or hide objectionable routes, comments, or contributor activity. Reports are not guaranteed to receive an individual response, and no moderation system catches every inaccurate or objectionable submission immediately.",
      },
    ],
  },
};

export function LegalDocument({ title, intro, sections }: LegalDocumentProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const canonical = canonicalDocuments[title];
  const displayedIntro = canonical?.intro ?? intro;
  const displayedSections = canonical?.sections ?? sections;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.primary, paddingTop: insets.top + 12 },
        ]}
      >
        <TouchableOpacity
          accessibilityLabel="Go back"
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={[
            styles.intro,
            { color: colors.foreground, fontFamily: "Inter_500Medium" },
          ]}
        >
          {displayedIntro}
        </Text>

        {displayedSections.map((section) => (
          <View
            key={section.title}
            style={[
              styles.section,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.primary, fontFamily: "Inter_700Bold" },
              ]}
            >
              {section.title}
            </Text>
            <Text
              style={[
                styles.sectionBody,
                { color: colors.foreground, fontFamily: "Inter_400Regular" },
              ]}
            >
              {section.body}
            </Text>
          </View>
        ))}

        <View
          style={[
            styles.contactCard,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          <Feather name="mail" size={18} color={colors.primary} />
          <View style={styles.contactCopy}>
            <Text
              style={[
                styles.contactTitle,
                { color: colors.primary, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              Questions or account help?
            </Text>
            <Text
              style={[
                styles.contactBody,
                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
              ]}
            >
              Contact the Mabhazi operator.
            </Text>
            <Text
              accessibilityRole="link"
              style={[
                styles.email,
                { color: colors.primary, fontFamily: "Inter_600SemiBold" },
              ]}
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            >
              {SUPPORT_EMAIL}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  content: { padding: 16, gap: 12 },
  intro: { fontSize: 15, lineHeight: 22, paddingHorizontal: 4 },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  sectionTitle: { fontSize: 15 },
  sectionBody: { fontSize: 14, lineHeight: 21 },
  contactCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginTop: 4,
  },
  contactCopy: { flex: 1, gap: 4 },
  contactTitle: { fontSize: 14 },
  contactBody: { fontSize: 13, lineHeight: 18 },
  email: { fontSize: 13, marginTop: 2 },
});