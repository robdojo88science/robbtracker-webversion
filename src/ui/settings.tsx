import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedGradient, Button } from './components';
import { useTheme } from './theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
export function SettingsBackground() {
  return <AnimatedGradient subtle style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 440, opacity: 0.52 }}>{null}</AnimatedGradient>;
}
export function SettingsHeading({ title, onBack }: { title: string; onBack?: () => void }) {
  const { colors } = useTheme();
  return onBack ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}><Button title="Back" icon="chevron-back" variant="ghost" onPress={onBack} /><Text accessibilityRole="header" style={{ flex: 1, color: colors.text, fontSize: 23, fontWeight: '700', letterSpacing: -0.6 }}>{title}</Text></View> : <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 34, lineHeight: 39, fontWeight: '700', letterSpacing: -1.1, paddingHorizontal: 5, paddingTop: 4 }}>Settings</Text>;
}
export function SettingsSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useTheme();
  return <View style={{ minHeight: 44, borderRadius: 3, backgroundColor: colors.glassTint, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.glassEdge, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 8 }}><Ionicons name="search" size={19} color={colors.muted} /><TextInput accessibilityLabel="Search settings" placeholder="Search settings" placeholderTextColor={colors.muted} value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" style={{ flex: 1, minWidth: 0, minHeight: 44, color: colors.text, fontSize: 16, paddingVertical: 8 }} /></View>;
}
export function SettingsGroup({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { colors, dark } = useTheme();
  const items = React.Children.toArray(children);
  return <View style={{ gap: 6 }}>{title && <Text accessibilityRole="header" style={{ color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.6, paddingHorizontal: 11, paddingTop: 7 }}>{title.toUpperCase()}</Text>}<View style={{ backgroundColor: colors.glass, borderRadius: 3, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassEdge, shadowColor: dark ? '#000000' : '#53688B', shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}><View pointerEvents="none" style={{ height: 1, position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.glassEdge }} />{items.map((child, index) => <View key={index}>{child}{index < items.length - 1 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 }} />}</View>)}</View>{footer && <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16, paddingHorizontal: 11 }}>{footer}</Text>}</View>;
}
export function SettingsRow({ title, value, icon, tint = '#007AFF', onPress, control, destructive, disabled, chevron = true, checked }: { title: string; value?: string; icon?: Icon; tint?: string; onPress?: () => void; control?: ReactNode; destructive?: boolean; disabled?: boolean; chevron?: boolean; checked?: boolean }) {
  const { colors } = useTheme();
  const body = <>{icon && <View style={{ width: 29, height: 29, borderRadius: 3, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={18} color="#FFFFFF" /></View>}<Text style={{ flex: 1, color: destructive ? colors.danger : colors.text, fontSize: 15, lineHeight: 19, fontWeight: '500' }}>{title}</Text>{value && <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13, maxWidth: '42%', textAlign: 'right' }}>{value}</Text>}{control}{onPress && chevron && <Ionicons name="chevron-forward" size={15} color={colors.muted} />}</>;
  const style = { minHeight: 52, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingHorizontal: 11, paddingVertical: 8, opacity: disabled ? 0.45 : 1 };
  return onPress ? <Pressable accessibilityRole={checked === undefined ? 'button' : 'checkbox'} accessibilityLabel={[title, value].filter(Boolean).join(', ')} accessibilityState={{ disabled: !!disabled, checked }} disabled={disabled} onPress={onPress} style={({ pressed }) => [style, { backgroundColor: pressed ? colors.primaryLight : 'transparent' }]}>{body}</Pressable> : <View style={style}>{body}</View>;
}
export function SettingsForm({ children }: { children: ReactNode }) {
  return <View style={{ padding: 12, gap: 11 }}>{children}</View>;
}
