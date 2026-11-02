import React, { createContext, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Animated, Easing, findNodeHandle, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { localDate } from '../core/dates';
import { CURRENCY_NAMES, currencyChoices, formatAmountInput, formatMoney, isCurrencyCode } from '../core/money';
import { useApp } from '../state/AppProvider';
import { useTheme } from './theme';
export { useTheme } from './theme';

function LinearGradient({colors,start={x:0,y:0},end={x:1,y:1},style}:{colors:string[];start?:{x:number;y:number};end?:{x:number;y:number};style?:StyleProp<ViewStyle>;pointerEvents?:'none'}){
  const id='gradient'+useId().replace(/[^a-z0-9]/gi,'');
  return <View pointerEvents="none" style={style}><Svg width="100%" height="100%" preserveAspectRatio="none"><Defs><SvgGradient id={id} x1={`${start.x*100}%`} y1={`${start.y*100}%`} x2={`${end.x*100}%`} y2={`${end.y*100}%`}>{colors.map((color,index)=>{const rgba=color.replaceAll(' ','').match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);return <Stop key={index} offset={index/Math.max(1,colors.length-1)} stopColor={rgba?`rgb(${rgba[1]},${rgba[2]},${rgba[3]})`:color} stopOpacity={rgba?Number(rgba[4]):1}/>;})}</SvgGradient></Defs><Rect width="100%" height="100%" fill={`url(#${id})`}/></Svg></View>;
}
type InputInstance=React.ComponentRef<typeof TextInput>;
const FocusedFieldContext=createContext<(field:InputInstance|null)=>void>(()=>{});
let reducedMotion = true, motionRevision = 0;
let motionSubscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;
const motionListeners = new Set<() => void>();
function updateReducedMotion(value: boolean) { if (value !== reducedMotion) { reducedMotion = value; motionListeners.forEach(listener => listener()); } }
function subscribeReducedMotion(listener: () => void) {
  motionListeners.add(listener);
  if (!motionSubscription) {
    const revision = ++motionRevision;
    motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { motionRevision++; updateReducedMotion(value); });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (revision === motionRevision) updateReducedMotion(value); }).catch(() => {});
  }
  return () => { motionListeners.delete(listener); if (!motionListeners.size) { motionSubscription?.remove(); motionSubscription = undefined; motionRevision++; } };
}
/** One native accessibility subscription, shared by all animated surfaces. */
export function useReducedMotion() { return useSyncExternalStore(subscribeReducedMotion, () => reducedMotion, () => true); }
function useSelectionHaptic() {
  const {snapshot}=useApp();
  const enabled=snapshot.profile?.hapticsEnabled!==false;
  return useCallback(()=>{if(enabled)void Haptics.selectionAsync().catch(()=>{});},[enabled]);
}

export function Page({ children, title, subtitle, action, header, footer, background, compact = false, maxWidth = 1600, safeTop = true }: { children: ReactNode; title?: string; subtitle?: string; action?: ReactNode; header?:ReactNode; footer?:ReactNode; background?:ReactNode; compact?:boolean; maxWidth?: number; safeTop?: boolean }) {
  const { colors, dark } = useTheme();
  const scroll=useRef<React.ComponentRef<typeof ScrollView>>(null),focused=useRef<InputInstance|null>(null),focusTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const revealFocused=useCallback(()=>{if(Platform.OS==='web'||!focused.current)return;const handle=findNodeHandle(focused.current);if(handle!=null)scroll.current?.getScrollResponder().scrollResponderScrollNativeHandleToKeyboard(handle,100,true);},[]);
  const focusField=useCallback((field:InputInstance|null)=>{focused.current=field;if(focusTimer.current)clearTimeout(focusTimer.current);if(field)focusTimer.current=setTimeout(revealFocused,180);},[revealFocused]);
  useFocusEffect(useCallback(()=>{const listener=Keyboard.addListener('keyboardDidShow',revealFocused);return()=>{listener.remove();if(focusTimer.current)clearTimeout(focusTimer.current);};},[revealFocused]));
  // The native navigator owns transitions. Resetting every mounted page on a
  // global pathname change causes a blank flash during back gestures.
  return <SafeAreaView edges={safeTop ? ['top', 'left', 'right'] : ['left', 'right']} style={{ flex: 1, backgroundColor: colors.background }}>
    {background&&<View pointerEvents="none" style={StyleSheet.absoluteFill}>{background}</View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'android' ? 'height' : footer ? 'padding' : undefined} keyboardVerticalOffset={safeTop ? 0 : 88}>
      {header&&<View style={{alignItems:'center',paddingHorizontal:8,paddingTop:compact?4:8}}><View style={{width:'100%',maxWidth}}>{header}</View></View>}
      <ScrollView ref={scroll} automaticallyAdjustKeyboardInsets={!footer} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={{ paddingHorizontal: 8, paddingTop: compact ? 4 : 8, paddingBottom: footer ? 10 : 20, alignItems: 'center' }}>
        <FocusedFieldContext.Provider value={focusField}>
        <View style={{ width: '100%', maxWidth, gap: compact ? 8 : 12 }}>
          {(title || subtitle || action) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>{title && <Text accessibilityRole="header" style={{ color: colors.text, fontSize: compact ? 24 : 28, lineHeight:compact ? 29 : 33, fontWeight: '700', letterSpacing: -0.8 }}>{title}</Text>}
              {subtitle && <Text style={{ color: colors.muted, lineHeight: 18, marginTop: 4, fontSize: 13 }}>{subtitle}</Text>}</View>{action}
          </View>}{children}
        </View>
        </FocusedFieldContext.Provider>
      </ScrollView>
      {footer && <SafeAreaView edges={['bottom']} style={{ backgroundColor: Platform.OS==='ios'?colors.glassTint:colors.glass, borderTopWidth:1,borderTopColor:colors.glassEdge,paddingHorizontal:8,paddingTop:6,alignItems:'center' }}>{Platform.OS==='ios'&&<BlurView pointerEvents="none" intensity={34} tint={dark?'dark':'light'} style={StyleSheet.absoluteFill}/>}<View style={{width:'100%',maxWidth,paddingBottom:4}}>{footer}</View></SafeAreaView>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <GlassSurface style={style}>{children}</GlassSurface>;
}

export function GlassSurface({children,style,blur=false}:{children:ReactNode;style?:StyleProp<ViewStyle>;blur?:boolean}) {
  const {colors,dark}=useTheme();
  // Repeated cards use a translucent fill and reflected edge. Native backdrop
  // sampling is reserved for fixed action surfaces and explicitly raised glass.
  return <View style={[{backgroundColor:blur&&Platform.OS==='ios'?colors.glassTint:colors.glass,borderRadius:3,overflow:'hidden',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border},style]}>{blur&&Platform.OS==='ios'&&<BlurView pointerEvents="none" intensity={34} tint={dark?'dark':'light'} style={StyleSheet.absoluteFill}/>}<View pointerEvents="none" style={{position:'absolute',top:0,left:0,right:0,height:1,backgroundColor:colors.glassEdge}}/><View style={{padding:10,gap:8}}>{children}</View></View>;
}
export function AnimatedGradient({children,style,subtle=false}:{children:ReactNode;style?:StyleProp<ViewStyle>;subtle?:boolean}) {
  const {dark}=useTheme();
  const motion=useRef(new Animated.Value(0)).current;
  const reduce=useReducedMotion();
  useFocusEffect(useCallback(()=>{if(reduce)return;const animation=Animated.loop(Animated.sequence([Animated.timing(motion,{toValue:1,duration:7000,easing:Easing.inOut(Easing.sin),useNativeDriver:true}),Animated.timing(motion,{toValue:0,duration:7000,easing:Easing.inOut(Easing.sin),useNativeDriver:true})]));animation.start();return()=>animation.stop();},[motion,reduce]));
  return <View style={[{backgroundColor:'#007DFE',borderRadius:3,overflow:'hidden'},style]}><LinearGradient pointerEvents="none" colors={subtle?(dark?['#112E50','#24284D','#163A42']:['#E4F1FF','#EDE8FF','#DEF7F5']):['#087DFA','#4257D9','#0064C8']} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill}/><Animated.View pointerEvents="none" style={{position:'absolute',top:'-30%',left:'-50%',width:'180%',height:'180%',transform:[{translateX:motion.interpolate({inputRange:[0,1],outputRange:[-60,110]})},{translateY:motion.interpolate({inputRange:[0,1],outputRange:[0,35]})},{rotate:'-20deg'}]}}><LinearGradient colors={['rgba(126,222,247,0)','rgba(126,222,247,0.24)','rgba(190,158,255,0.18)','rgba(255,255,255,0)']} start={{x:0,y:0}} end={{x:1,y:0}} style={{flex:1}}/></Animated.View>{children}</View>;
}
type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Button({ title, onPress, variant = 'primary', disabled, loading, icon, haptic=true }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; loading?: boolean; icon?: IconName; haptic?:boolean }) {
  const { colors } = useTheme();
  const selectionHaptic=useSelectionHaptic();
  const backgroundColor = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.surfaceAlt : 'transparent';
  const color = variant === 'primary' || variant === 'danger' ? '#FFFFFF' : colors.primary;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled || !!loading,busy:!!loading }} disabled={disabled || loading} onPress={()=>{if(haptic)selectionHaptic();onPress();}}
    style={({ pressed }) => ({ backgroundColor, overflow:'hidden',opacity: disabled || loading ? 0.45 : pressed ? 0.75 : 1, borderRadius:3, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 })}>
    {variant === 'primary' && <LinearGradient pointerEvents="none" colors={['#007DFE',colors.deepBlue]} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFill} />}
    {loading ? <ActivityIndicator color={color} /> : icon && <Ionicons name={icon} size={19} color={color} />}<Text style={{ color, fontSize: 15, fontWeight: '600', textAlign: 'center', flexShrink: 1 }}>{title}</Text>
  </Pressable>;
}
export function Field({ label, labelAction, style, revealOnFocus=true, money, ...props }: TextInputProps & { label: string;labelAction?:ReactNode;revealOnFocus?:boolean;money?:boolean }) {
  const { colors } = useTheme();
  const input=useRef<InputInstance>(null),focusField=useContext(FocusedFieldContext);
  return <View style={{ gap: 4 }}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{ color: colors.text, fontSize: 12, fontWeight: '600',flex:1 }}>{label}</Text>{labelAction}</View>
    <TextInput {...props} value={(money??props.keyboardType==='decimal-pad')&&typeof props.value==='string'?formatAmountInput(props.value):props.value} onChangeText={value=>props.onChangeText?.((money??props.keyboardType==='decimal-pad')?formatAmountInput(value):value)} ref={input} onFocus={event=>{if(revealOnFocus)focusField(input.current);props.onFocus?.(event);}} onBlur={event=>{if(revealOnFocus)focusField(null);props.onBlur?.(event);}} onContentSizeChange={event=>{if(revealOnFocus&&props.multiline&&input.current?.isFocused())focusField(input.current);props.onContentSizeChange?.(event);}} accessibilityLabel={props.accessibilityLabel ?? label} placeholderTextColor={colors.muted} selectionColor={colors.primary}
      style={[{ minHeight: 44, backgroundColor: colors.glass, borderColor: colors.border, borderBottomWidth: 1, color: colors.text, borderRadius:3, paddingHorizontal: 10, paddingVertical: 9, fontSize: 16,lineHeight:20 }, props.multiline && { minHeight: 70, textAlignVertical: 'top' }, style]} />
  </View>;
}
export function DateField({ label = 'Date', value, onChange, hideLabel = false }: { label?: string; value: string; onChange: (value: string) => void; hideLabel?: boolean }) {
  const { colors } = useTheme();
  const selectionHaptic=useSelectionHaptic();
  const [open,setOpen] = useState(false);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date();
  const selected=Number.isFinite(parsed.getTime())?parsed:new Date();
  const [month,setMonth] = useState(selected.getMonth()), [year,setYear] = useState(selected.getFullYear()), [chooseYear,setChooseYear] = useState(false);
  const days = new Date(year,month+1,0).getDate(), offset = new Date(year,month,1).getDay();
  const pick = (date:string) => { selectionHaptic();onChange(date);setOpen(false); };
  const move = (delta:number) => { const date = new Date(year,month+delta,1);if(date.getFullYear()<1900||date.getFullYear()>2200)return;selectionHaptic();setYear(date.getFullYear());setMonth(date.getMonth()); };
  const changeYear=(delta:number)=>setYear(current=>Math.max(1900,Math.min(2200,current+delta)));
  return <View style={{gap:4}}>{!hideLabel&&<Text style={{color:colors.text,fontSize:12,fontWeight:'600'}}>{label}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Open calendar`} onPress={() => {selectionHaptic();Keyboard.dismiss();setMonth(selected.getMonth());setYear(selected.getFullYear());setChooseYear(false);setOpen(true);}} style={{backgroundColor:colors.glass,borderBottomWidth:1,borderColor:colors.border,borderRadius:3,padding:10,minHeight:44,flexDirection:'row',alignItems:'center',gap:8}}><Ionicons name="calendar-outline" color={colors.primary} size={18}/><Text numberOfLines={1} adjustsFontSizeToFit style={{color:colors.text,fontSize:15,flex:1}}>{selected.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</Text><Ionicons name="chevron-down" color={colors.muted} size={14}/></Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}><View style={{flex:1,backgroundColor:'rgba(7,25,55,0.35)',justifyContent:'flex-end'}}><Pressable style={{flex:1}} accessibilityLabel="Close calendar" onPress={() => setOpen(false)}/><SafeAreaView edges={['bottom']} style={{backgroundColor:colors.surface,borderTopLeftRadius:3,borderTopRightRadius:3,padding:14,gap:12,maxHeight:'85%'}}>
      <ScrollView contentContainerStyle={{gap:12}} showsVerticalScrollIndicator={false}><Row style={{justifyContent:'space-between'}}><Text style={{color:colors.text,fontSize:21,fontWeight:'700'}}>{label}</Text><Button title="Done" variant="ghost" onPress={() => setOpen(false)}/></Row>
      <Row style={{justifyContent:'space-between',gap:6}}><Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={()=>move(-1)} style={{width:44,height:44,borderRadius:3,backgroundColor:colors.surfaceAlt,alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-back" size={21} color={colors.primary}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Choose month and year" onPress={() => setChooseYear(!chooseYear)} style={{padding:10,flex:1}}><Text numberOfLines={1} adjustsFontSizeToFit style={{color:colors.primary,fontWeight:'700',fontSize:17,textAlign:'center'}}>{new Date(year,month,1).toLocaleDateString(undefined,{month:'long',year:'numeric'})} ▾</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={()=>move(1)} style={{width:44,height:44,borderRadius:3,backgroundColor:colors.surfaceAlt,alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-forward" size={21} color={colors.primary}/></Pressable></Row>
      {chooseYear ? <View style={{gap:14}}><Row><Button title="−10 years" variant="ghost" onPress={() => changeYear(-10)}/><Button title="+10 years" variant="ghost" onPress={() => changeYear(10)}/></Row><View style={shared.wrap}>{Array.from({length:12},(_,m)=><Chip key={m} label={new Date(year,m,1).toLocaleDateString(undefined,{month:'short'})} selected={month===m} onPress={() => {setMonth(m);setChooseYear(false);}}/>)}</View><Row style={{justifyContent:'center'}}><Button title="Previous year" variant="secondary" onPress={() => changeYear(-1)}/><Text style={{color:colors.text,fontWeight:'700'}}>{year}</Text><Button title="Next year" variant="secondary" onPress={() => changeYear(1)}/></Row></View> : <View><View style={{flexDirection:'row'}}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><Text key={d} style={{width:'14.285%',textAlign:'center',color:colors.muted,fontSize:12,paddingVertical:8}}>{d}</Text>)}</View><View style={{flexDirection:'row',flexWrap:'wrap'}}>{Array.from({length:offset+days},(_,i)=>{const day=i-offset+1,date=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return day<1?<View key={i} style={{width:'14.285%',height:46}}/>:<Pressable key={i} accessibilityRole="button" accessibilityLabel={date} accessibilityState={{selected:date===value}} onPress={() => pick(date)} style={{width:'14.285%',height:46,alignItems:'center',justifyContent:'center'}}><View style={{width:40,height:40,borderRadius:3,alignItems:'center',justifyContent:'center',backgroundColor:date===value?colors.primary:'transparent',borderWidth:date===localDate()?1:0,borderColor:colors.primary}}><Text style={{color:date===value?colors.onPrimary:colors.text,fontSize:16,fontWeight:date===value?'700':'400'}}>{day}</Text></View></Pressable>;})}</View></View>}
      <Button title="Select today" variant="secondary" icon="today-outline" haptic={false} onPress={() => pick(localDate())}/>
    </ScrollView></SafeAreaView></View></Modal>
  </View>;
}
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ gap: 10 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 }}>{title}</Text>{action}</View>{children}</View>;
}
export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ paddingVertical: 22, gap: 12, alignItems: 'center' }}><View style={{ width: 52, height: 52, borderRadius:3, backgroundColor: colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="leaf-outline" color={colors.primary} size={26} /></View>
    <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>{title}</Text><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 19, textAlign: 'center', maxWidth: 350 }}>{body}</Text>{action}</View>;
}
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const selectionHaptic=useSelectionHaptic();
  return <Pressable onPress={()=>{selectionHaptic();onPress();}} accessibilityRole="button" accessibilityState={{ selected: !!selected }} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', borderRadius:3, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: selected ? colors.primaryLight : 'transparent', borderBottomWidth: 2, borderColor: selected ? colors.primary : 'transparent', opacity: pressed ? 0.7 : 1 })}>
    <Text style={{ color: selected ? colors.primary : colors.muted, fontWeight: selected ? '700' : '500', fontSize: 13,lineHeight:17 }}>{label}</Text></Pressable>;
}
export function Progress({ value, color }: { value: number; color?: string }) {
  const { colors } = useTheme();
  const percentage = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(percentage) }} style={{ height: 8, borderRadius:3, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}><View style={{ width: `${percentage}%`, height: 8, backgroundColor: color ?? colors.primary, borderRadius:3 }} /></View>;
}
export function Money({ value, style, hide, currency }: { value: number; style?: StyleProp<TextStyle>; hide?: boolean; currency?:string }) {
  const { colors } = useTheme();
  const {snapshot} = useApp();
  const amount = formatMoney(value,currency ?? snapshot.profile?.baseCurrency ?? 'PHP');
  return <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} accessibilityLabel={hide ? 'Amount hidden' : amount} style={[{ fontVariant: ['tabular-nums'], fontSize: 24, fontWeight: '700', letterSpacing: -0.6, color: colors.text, flexShrink: 1 }, style]}>{hide ? '••••••' : amount}</Text>;
}
export function InfoButton({title,message,compact=false}:{title:string;message:string;compact?:boolean}) {
  const {colors} = useTheme();
  const selectionHaptic=useSelectionHaptic();
  return <Pressable accessibilityRole="button" accessibilityLabel={`About ${title}`} hitSlop={compact?10:0} onPress={() => {selectionHaptic();Alert.alert(title,message);}} style={{minWidth:compact?24:44,minHeight:compact?24:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="information-circle-outline" size={20} color={colors.primary}/></Pressable>;
}
export function Toast({message}:{message:string|null|undefined}) {
  const {colors} = useTheme();
  const [visible,setVisible]=useState(!!message),opacity=useRef(new Animated.Value(1)).current;
  useEffect(()=>{setVisible(!!message);opacity.setValue(1);if(!message)return;AccessibilityInfo.announceForAccessibility(message);const timer=setTimeout(()=>Animated.timing(opacity,{toValue:0,duration:200,useNativeDriver:true}).start(()=>setVisible(false)),2800);return()=>clearTimeout(timer);},[message,opacity]);
  return visible&&message ? <Animated.View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{opacity,backgroundColor:colors.primaryLight,borderRadius:3,padding:14,flexDirection:'row',alignItems:'center',gap:9}}><Ionicons name="checkmark-circle" size={20} color={colors.success}/><Text style={{color:colors.text,fontSize:14,flex:1}}>{message}</Text></Animated.View> : null;
}
export function Dropdown({label,value,options,onChange,placeholder='Choose an option',hideLabel=false}:{label:string;value:string;options:{label:string;value:string;color?:string;subtitle?:string}[];onChange:(value:string)=>void;placeholder?:string;hideLabel?:boolean}) {
  const {colors} = useTheme();
  const selectionHaptic=useSelectionHaptic();
  const [open,setOpen] = useState(false), [search,setSearch] = useState('');
  const selected = options.find(o => o.value===value);
  const matching=options.filter(o=>(o.label+' '+(o.subtitle??'')).toLowerCase().includes(search.toLowerCase()));
  const close=()=>{Keyboard.dismiss();setOpen(false);};
  return <View style={{gap:4}}>
    {!hideLabel&&<Text style={{color:colors.text,fontWeight:'600',fontSize:12}}>{label}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`} accessibilityState={{expanded:open}} onPress={() => {selectionHaptic();Keyboard.dismiss();setSearch('');setOpen(true);}} style={{backgroundColor:colors.glass,borderColor:colors.border,borderBottomWidth:1,borderRadius:3,padding:10,minHeight:44,flexDirection:'row',alignItems:'center',gap:8}}>
      {selected?.color && <View style={{width:10,height:10,borderRadius:3,backgroundColor:selected.color}}/>}
      <Text numberOfLines={1} style={{color:selected?colors.text:colors.muted,fontSize:15,flex:1}}>{selected?.label??placeholder}</Text><Ionicons name="chevron-down" color={colors.primary} size={15}/>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{flex:1,backgroundColor:'rgba(7,25,55,0.35)',justifyContent:'flex-end'}}>
        <Pressable accessibilityLabel="Close choices" onPress={close} style={{flex:1}}/>
        <SafeAreaView edges={['bottom']} style={{backgroundColor:colors.surface,borderTopLeftRadius:3,borderTopRightRadius:3,padding:14,maxHeight:'78%',gap:14}}>
          <Row style={{justifyContent:'space-between'}}><Text style={{color:colors.text,fontSize:21,fontWeight:'700',flex:1}}>{label}</Text><Button title="Close" variant="ghost" onPress={close}/></Row>
          {options.length>7 && <Field revealOnFocus={false} label="Find an option" placeholder="Search…" value={search} onChangeText={setSearch}/>}
          <ScrollView keyboardShouldPersistTaps="handled" style={{flexShrink:1}}>
            {matching.map(o=><Pressable key={o.value} accessibilityRole="button" accessibilityState={{selected:o.value===value}} onPress={() => {selectionHaptic();onChange(o.value);close();}} style={{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:16,paddingHorizontal:10,borderRadius:3,backgroundColor:o.value===value?colors.primaryLight:'transparent',minHeight:54}}>
              {o.color && <View style={{width:12,height:12,borderRadius:3,backgroundColor:o.color}}/>}
              <View style={{flex:1,gap:4}}><Text style={{color:colors.text,fontWeight:o.value===value?'700':'400',fontSize:16}}>{o.label}</Text>{o.subtitle && <Text style={{color:colors.muted,fontSize:12}}>{o.subtitle}</Text>}</View>
              {o.value===value && <Ionicons name="checkmark-circle" size={22} color={colors.primary}/>}
            </Pressable>)}
            {!matching.length&&<Text style={{color:colors.muted,padding:18,textAlign:'center'}}>No matching options. Try another name.</Text>}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) { return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>{children}</View>; }
export function CurrencyField({value,onChange,existingCodes=[],label='Currency'}:{value:string;onChange:(value:string)=>void;existingCodes?:string[];label?:string}) {
  const [custom,setCustom]=useState(()=>Boolean(value)&&!currencyChoices(existingCodes).includes(value));
  const options=[{value:'__custom',label:'+ Custom currency',subtitle:'Your own code · 3–8 letters or numbers'},...currencyChoices([...existingCodes,value]).map(code=>({value:code,label:code,subtitle:CURRENCY_NAMES[code]??'Custom currency'}))];
  return <View style={{gap:8}}><Dropdown label={label} value={custom?'__custom':value} options={options} onChange={code=>{setCustom(code==='__custom');onChange(code==='__custom'?'':code);}}/>{custom&&<Field label="Custom currency code" labelAction={<InfoButton compact title="Custom currency" message="Use 3–8 letters or numbers, starting with a letter, such as XAF or USDT. All amounts in this tracker use two decimal places. Set your own conversion rate when adding a wallet."/>} value={value} onChangeText={code=>onChange(code.toUpperCase().replace(/[^A-Z0-9]/g,''))} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="XAF, USDT…"/>}{custom&&value.length>0&&!isCurrencyCode(value)&&<ErrorMessage message="Use 3–8 letters or numbers, starting with a letter."/>}</View>;
}
export function ErrorMessage({ message }: { message?: string | null }) {
  const { colors } = useTheme();
  return message ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14, lineHeight: 19 }}>{message}</Text> : null;
}
export const shared = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, stack: { gap: 10 }, flex: { flex: 1 } });
