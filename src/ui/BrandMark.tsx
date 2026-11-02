import React from 'react';
import { Image } from 'react-native';

/** Use the same R mark as the installed app icon throughout the app. */
export function BrandMark({ size = 40, onBlue = false }: { size?: number; onBlue?: boolean }) {
  return <Image accessible accessibilityLabel="Robb Tracker R logo" source={onBlue ? require('../../assets/adaptive-icon.png') : require('../../assets/icon.png')} resizeMode="contain" style={{ width: size, height: size, borderRadius: 3 }} />;
}
