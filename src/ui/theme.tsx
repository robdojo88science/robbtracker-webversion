import { useColorScheme } from 'react-native';
import { useApp } from '../state/AppProvider';

const light = {
  background: '#F4F8FF', surface: '#FFFFFF', surfaceAlt: '#EDF4FF', text: '#142B50',
  muted: '#61738F', border: '#DFE9F8', primary: '#007DFE', primaryLight: '#E5F1FF',
  onPrimary: '#FFFFFF', danger: '#D63B51', warning: '#9C6500', success: '#158151',
  deepBlue: '#0057E7', transfer: '#A86B00', glass: 'rgba(255,255,255,0.82)',
  glassTint: 'rgba(255,255,255,0.48)', glassEdge: 'rgba(255,255,255,0.92)',
};
const dark = {
  background: '#0B1528', surface: '#14223B', surfaceAlt: '#1A2D4C', text: '#F2F7FF',
  muted: '#A8BAD5', border: '#2A3F60', primary: '#71B5FF', primaryLight: '#1A375D',
  onPrimary: '#0A2347', danger: '#FF8796', warning: '#F5C866', success: '#69D5A4',
  deepBlue: '#0057E7', transfer: '#F5C866', glass: 'rgba(20,34,59,0.84)',
  glassTint: 'rgba(20,34,59,0.56)', glassEdge: 'rgba(168,210,255,0.28)',
};
export type Colors = typeof light;
export function useTheme() {
  const system = useColorScheme();
  const { snapshot } = useApp();
  const mode = snapshot.profile?.appearance ?? 'system';
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  return { colors: isDark ? dark : light, dark: isDark };
}
