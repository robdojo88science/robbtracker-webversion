import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/ui/theme';
import { useApp } from '../../src/state/AppProvider';
import { useReducedMotion } from '../../src/ui/components';

function GlassTabs({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors, dark } = useTheme(), { snapshot } = useApp();
  const [width, setWidth] = useState(0), reduceMotion = useReducedMotion();
  const translation = useRef(new Animated.Value(0)).current, scale = useRef(new Animated.Value(1)).current;
  const routes = state.routes.filter(route => route.name !== 'expenses');
  const active = Math.max(0, routes.findIndex(route => route.key === state.routes[state.index].key));
  const slot = width / Math.max(1, routes.length), lensWidth = Math.max(48, slot - 6), lensHeight = 50;
  useEffect(() => {
    if (!width) return;
    const target = active * slot + (slot - lensWidth) / 2;
    if (reduceMotion) { translation.setValue(target); scale.setValue(1); return; }
    const animation = Animated.parallel([
      Animated.spring(translation, { toValue: target, damping: 20, stiffness: 190, mass: 0.8, useNativeDriver: true }),
      Animated.sequence([Animated.timing(scale, { toValue: 0.96, duration: 90, useNativeDriver: true }), Animated.spring(scale, { toValue: 1, damping: 16, stiffness: 220, useNativeDriver: true })]),
    ]);
    animation.start(); return () => animation.stop();
  }, [active, slot, lensWidth, width, reduceMotion, translation, scale]);
  return <View style={{ paddingTop: 2, paddingBottom: Math.max(4, insets.bottom), paddingLeft: insets.left + 4, paddingRight: insets.right + 4, backgroundColor: colors.background }}>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: 58, flexDirection: 'row', borderRadius: 3, overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderColor: dark ? 'rgba(168,210,255,0.26)' : 'rgba(255,255,255,0.95)', backgroundColor: dark ? 'rgba(32,54,87,0.38)' : 'rgba(255,255,255,0.36)' }}>
      {Platform.OS === 'ios' && <BlurView pointerEvents="none" intensity={55} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />}
      {width > 0 && <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 4, left: 0, width: lensWidth, height: lensHeight, borderRadius: 3, overflow: 'hidden', borderBottomWidth: 2, borderColor: colors.primary, backgroundColor: dark ? 'rgba(113,181,255,0.14)' : 'rgba(0,125,254,0.08)', transform: [{ translateX: translation }, { scale }] }}>
        {Platform.OS === 'ios' && <BlurView intensity={22} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />}<View style={{ position: 'absolute', top: 1, left: 12, right: 12, height: 1, backgroundColor: 'rgba(255,255,255,0.65)' }} />
      </Animated.View>}
      {routes.map(route => {
        const options = descriptors[route.key].options, focused = state.routes[state.index].key === route.key, color = focused ? colors.primary : colors.muted;
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
        return <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={options.tabBarAccessibilityLabel ?? label} testID={options.tabBarButtonTestID} onPress={() => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!event.defaultPrevented) { if (snapshot.profile?.hapticsEnabled !== false) void Haptics.selectionAsync().catch(() => {}); if (!focused) navigateToTab(route.key); }
        }} onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })} style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
          {options.tabBarIcon?.({ focused, color, size: 24 })}<Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ fontSize: 10, fontWeight: focused ? '700' : '500', color, maxWidth: '98%' }}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

export default function TabLayout() {
  return <Tabs tabBar={props => <GlassTabs {...props} />} screenOptions={{ headerShown: false, animation: 'none' }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={typeof color === 'string' ? color : undefined} /> }} />
    <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal-outline" size={size} color={typeof color === 'string' ? color : undefined} /> }} />
    <Tabs.Screen name="expenses" options={{ href: null }} />
    <Tabs.Screen name="performance" options={{ title: 'Performance', tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" size={size} color={typeof color === 'string' ? color : undefined} /> }} />
    <Tabs.Screen name="goals" options={{ title: 'Goals', tabBarIcon: ({ color, size }) => <Ionicons name="flag-outline" size={size} color={typeof color === 'string' ? color : undefined} /> }} />
    <Tabs.Screen name="more" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={typeof color === 'string' ? color : undefined} /> }} />
  </Tabs>;
}
