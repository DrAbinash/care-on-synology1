import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useMobileConfig } from "@/hooks/useMobileConfig";

// Tab visibility is admin-controlled from ERP Settings → Mobile App
// (showReportsTab / showDoctorsTab / showStaffPortal). Hidden tabs keep their
// routes registered — they just disappear from the tab bar.

function NativeTabLayout() {
  const { config } = useMobileConfig();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bookings">
        <Icon sf={{ default: "calendar", selected: "calendar.badge.clock" }} />
        <Label>Bookings</Label>
      </NativeTabs.Trigger>
      {config.showReportsTab && (
        <NativeTabs.Trigger name="reports">
          <Icon sf={{ default: "doc.text", selected: "doc.text.fill" }} />
          <Label>Reports</Label>
        </NativeTabs.Trigger>
      )}
      {config.showDoctorsTab && (
        <NativeTabs.Trigger name="doctors">
          <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
          <Label>Doctors</Label>
        </NativeTabs.Trigger>
      )}
      {config.showStaffPortal && (
        <NativeTabs.Trigger name="radiologist">
          <Icon sf={{ default: "cross.case", selected: "cross.case.fill" }} />
          <Label>Staff</Label>
        </NativeTabs.Trigger>
      )}
      <NativeTabs.Trigger name="about">
        <Icon sf={{ default: "info.circle", selected: "info.circle.fill" }} />
        <Label>About</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { config } = useMobileConfig();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }: { color: string }) => (
            <Feather name="home" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color }: { color: string }) => (
            <Feather name="calendar" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          href: config.showReportsTab ? undefined : null,
          tabBarIcon: ({ color }: { color: string }) => (
            <Feather name="file-text" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="doctors"
        options={{
          title: "Doctors",
          href: config.showDoctorsTab ? undefined : null,
          tabBarIcon: ({ color }: { color: string }) => (
            <Feather name="users" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="radiologist"
        options={{
          title: "Staff",
          href: config.showStaffPortal ? undefined : null,
          tabBarIcon: ({ color }: { color: string }) => (
            <Feather name="activity" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="about"
        options={{
          title: "About",
          tabBarIcon: ({ color }: { color: string }) => (
            <Feather name="info" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}
