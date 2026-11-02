import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../src/state/AppProvider';
import { OnboardingScreen } from '../src/screens/Onboarding';
import { useTheme } from '../src/ui/theme';
import * as Notifications from 'expo-notifications';
import { assertDate } from '../src/core/dates';
import { shouldOfferWelcomeTour } from '../src/core/firstUse';

// Keep the configured R visible until the first app layout and local icon font are ready.
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 0, fade: false });

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

function Navigation({ assetsReady }: { assetsReady: boolean }) {
  const { snapshot, repo, mutate } = useApp();
  const [laidOut, setLaidOut] = useState(false);
  const segments = useSegments();
  const offeredTour = useRef(false);
  const currentProfile = useRef(snapshot.profile); currentProfile.current = snapshot.profile;
  const currentSegments = useRef(segments); currentSegments.current = segments;
  const handledNotification=useRef('');
  useEffect(()=>{
    if(!snapshot.profile)return;
    const open=(response:Notifications.NotificationResponse|null)=>{
      if(!response)return;const request=response.notification.request;
      if(handledNotification.current===request.identifier)return;
      const data=request.content.data??{};
      if(typeof data.summaryDay==='string'){
        try{assertDate(data.summaryDay);}catch{return;}
        handledNotification.current=request.identifier;
        router.push({pathname:'/(tabs)/transactions',params:{period:'custom',start:data.summaryDay,end:data.summaryDay,sort:'newest',recent:'',highlight:'',refresh:String(Date.now())}});
      }else if(typeof data.reminderId==='string'){handledNotification.current=request.identifier;router.push('/reminders');}
      else return;
      void Notifications.clearLastNotificationResponseAsync().catch(()=>{});
    };
    const listener=Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(open).catch(()=>{});
    return()=>listener.remove();
  },[snapshot.profile?.id]);
  useEffect(() => {
    if (!snapshot.profile) { offeredTour.current = false; return; }
    if (shouldOfferWelcomeTour(snapshot.profile) && !offeredTour.current && segments[0] === '(tabs)') {
      offeredTour.current = true;
      const profileId = snapshot.profile.id;
      // Mark the first offer before showing it, so closing/restarting cannot repeat the tour.
      void mutate(() => repo.updateProfile({ tutorialCompleted: true })).then(() => {
        if (currentProfile.current?.id === profileId && currentSegments.current[0] === '(tabs)') router.push('/tutorial');
      }).catch(() => { /* A welcome tip must not block the tracker. */ });
    }
  }, [snapshot.profile, segments, mutate, repo]);
  useEffect(() => {
    if (!laidOut || !assetsReady) return;
    const frame = requestAnimationFrame(() => { void SplashScreen.hideAsync().catch(() => {}); });
    return () => cancelAnimationFrame(frame);
  }, [laidOut, assetsReady]);
  const { colors, dark } = useTheme();
  return <View style={{ flex: 1 }} onLayout={() => setLaidOut(true)}>
    <StatusBar style={dark ? 'light' : 'dark'} />
    {!snapshot.profile ? <OnboardingScreen /> : <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text,
      headerShadowVisible: false, headerBackButtonDisplayMode:'minimal', contentStyle: { backgroundColor: colors.background }, animation: 'slide_from_right',
    }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="transaction/new" options={{ title: 'Record transaction' }} />
      <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction details' }} />
      <Stack.Screen name="goal/new" options={{ title: 'Savings goal' }} />
      <Stack.Screen name="goal/[id]/contribute" options={{ title: 'Add to savings' }} />
      <Stack.Screen name="reminders" options={{ title: 'Reminders' }} />
      <Stack.Screen name="reminder/new" options={{ title: 'Reminder' }} />
      <Stack.Screen name="audit" options={{ title: 'Audit trail' }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="preferences/[section]" options={{ headerShown: false }} />
      <Stack.Screen name="data" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ title: 'My profile' }} />
      <Stack.Screen name="accounts" options={{ title: 'My wallets' }} />
      <Stack.Screen name="monthly" options={{ title: 'Monthly overview' }} />
      <Stack.Screen name="categories" options={{ title: 'Expense categories' }} />
      <Stack.Screen name="tags" options={{ title: 'My tags' }} />
      <Stack.Screen name="import" options={{ title: 'Import transactions' }} />
      <Stack.Screen name="assistant" options={{ title: 'Quick entry chat' }} />
      <Stack.Screen name="tutorial" options={{ title: 'Your quick tour', presentation: 'modal' }} />
      <Stack.Screen name="help" options={{title:'Help & guide'}} />
      <Stack.Screen name="notifications" options={{title:'Notifications'}} />
      <Stack.Screen name="security" options={{title:'Action PIN'}} />
      <Stack.Screen name="ai-settings" options={{title:'Offline chat'}} />
    </Stack>}
  </View>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  return <SafeAreaProvider><AppProvider><Navigation assetsReady={fontsLoaded || !!fontError} /></AppProvider></SafeAreaProvider>;
}
