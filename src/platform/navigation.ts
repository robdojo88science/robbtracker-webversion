import { router } from 'expo-router';

/** Dismiss entry screens and show the write that just succeeded, including past-dated entries. */
export function goToTransactions(id?:string):void {
  router.dismissTo({pathname:'/(tabs)/transactions',params:{period:'allTime',sort:'newest',recent:id??'',highlight:id??'',refresh:String(Date.now())}});
}
