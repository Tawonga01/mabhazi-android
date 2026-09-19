import { Redirect } from "expo-router";

// The mounted AuthProvider exchanges the PKCE code from openAuthSessionAsync.
// This route handles Expo Router receiving the same deep link without showing
// an unmatched-route page or exchanging the single-use code a second time.
export default function AuthCallback() {
  return <Redirect href="/(tabs)/profile" />;
}
