import type Ionicons from '@expo/vector-icons/Ionicons';
import type React from 'react';

export const homeShortcuts: { key: string; title: string; icon: React.ComponentProps<typeof Ionicons>['name']; path: string }[] = [
  { key: 'chat', title: 'Quick chat', icon: 'chatbubbles-outline', path: '/assistant' },
  { key: 'month', title: 'This month', icon: 'calendar-outline', path: '/monthly' },
  { key: 'last7', title: 'Last 7 days', icon: 'calendar-number-outline', path: '/(tabs)/performance?period=last7' },
  { key: 'last30', title: 'Last 30 days', icon: 'analytics-outline', path: '/(tabs)/performance?period=last30' },
  { key: 'wallets', title: 'Wallets', icon: 'wallet-outline', path: '/accounts' },
  { key: 'transactions', title: 'Transactions', icon: 'swap-horizontal-outline', path: '/(tabs)/transactions' },
  { key: 'notifications', title: 'Notifications', icon: 'notifications-outline', path: '/notifications' },
  { key: 'help', title: 'App guide & FAQ', icon: 'help-circle-outline', path: '/help' },
  { key: 'performance', title: 'Performance', icon: 'bar-chart-outline', path: '/(tabs)/performance' },
  { key: 'goals', title: 'Goals', icon: 'flag-outline', path: '/(tabs)/goals' },
  { key: 'audit', title: 'Activity history', icon: 'time-outline', path: '/audit' },
  { key: 'import', title: 'Import records', icon: 'document-text-outline', path: '/import' },
];
