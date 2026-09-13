import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SecureStore from "expo-secure-store";
import React, { useEffect } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/lib/auth";
import { resolveApiBaseUrl } from "@/lib/api-base";

const AUTH_TOKEN_KEY = "auth_session_token";

setBaseUrl(resolveApiBaseUrl());

// expo-secure-store doesn't work on web — use localStorage there instead.
setAuthTokenGetter(() => {
  if (Platform.OS === "web") {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(AUTH_TOKEN_KEY)
      : null;
  }
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
});

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

function StartupScreen() {
  return (
    <View style={styles.startup}>
      <View style={styles.startupMark}>
        <Text style={styles.startupMarkText}>M</Text>
      </View>
      <Text style={styles.startupTitle}>Mabhazi</Text>
      <Text style={styles.startupSubtitle}>Finding your next connection</Text>
      <ActivityIndicator size="small" color="#F97316" style={styles.startupSpinner} />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return Platform.OS === "web" ? <StartupScreen /> : null;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  startup: {
    flex: 1,
    minHeight: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E3A5F",
    padding: 24,
  },
  startupMark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F97316",
    marginBottom: 18,
  },
  startupMarkText: {
    color: "#FFFFFF",
    fontSize: 36,
    fontWeight: "800",
  },
  startupTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "700",
  },
  startupSubtitle: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    marginTop: 6,
  },
  startupSpinner: {
    marginTop: 24,
  },
});
