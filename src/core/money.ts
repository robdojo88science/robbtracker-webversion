import type { Transaction } from './types';

/** PHP centavos. Limit individual entries to keep SQLite/JS aggregates exact. */
export const MAX_MONEY_MINOR = 99_999_999_999;
/** Group an editable amount without rounding, dropping decimals or hiding invalid input. */
export function formatAmountInput(input: string): string {
  const raw = input.replace(/,/g, '');
  if (!/^\d*(?:\.\d*)?$/.test(raw)) return input;
  const point = raw.indexOf('.');
  const whole = point < 0 ? raw : raw.slice(0, point);
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (point < 0 ? '' : raw.slice(point));
}
export function assertMoney(value: number, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_MONEY_MINOR) {
    throw new Error(allowZero ? 'Enter an amount from ₱0 to ₱999,999,999.99.' : 'Enter an amount greater than zero, up to ₱999,999,999.99.');
  }
}
export function parseMoney(input: string, allowZero = false): number {
  const value = input.trim().replace(/^₱\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with at most two decimal places.');
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assertMoney(amount, allowZero);
  return amount;
}
export function formatMoney(amountMinor: number, currency = 'PHP'): string {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Invalid money value.');
  // Split the integer's digits before formatting; dividing large aggregate
  // balances by 100 can round away a centavo even within MAX_SAFE_INTEGER.
  const digits = String(Math.abs(amountMinor)).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol:Record<string,string>={PHP:'₱',USD:'$',EUR:'€',GBP:'£',SGD:'S$',AUD:'A$',CAD:'C$',HKD:'HK$'};
  return `${amountMinor < 0 ? '-' : ''}${symbol[currency]??`${currency} `}${whole}.${digits.slice(-2)}`;
}
export function signedAmount(tx: Pick<Transaction, 'kind' | 'amountMinor' | 'voidedAt' | 'deletedAt'> & {baseAmountMinor?:number}): number {
  if (tx.voidedAt || tx.deletedAt) return 0;
  if(tx.kind==='transfer')return 0;
  const amount=tx.baseAmountMinor??tx.amountMinor;
  return tx.kind === 'income' || tx.kind === 'adjustment_credit' ? amount : -amount;
}
export const SUPPORTED_CURRENCIES = ['PHP','USD','EUR','GBP','SGD','AUD','CAD','HKD'] as const;
/** Custom currency codes keep the existing two-decimal ledger representation. */
export function isCurrencyCode(value:unknown):value is string { return typeof value==='string' && /^[A-Z][A-Z0-9]{2,7}$/.test(value); }
export const CURRENCY_NAMES:Record<string,string>={PHP:'Philippine peso',USD:'US dollar',EUR:'Euro',GBP:'British pound',SGD:'Singapore dollar',AUD:'Australian dollar',CAD:'Canadian dollar',HKD:'Hong Kong dollar',JPY:'Japanese yen',KRW:'South Korean won',AED:'UAE dirham',SAR:'Saudi riyal',MYR:'Malaysian ringgit',THB:'Thai baht',INR:'Indian rupee',CNY:'Chinese yuan',NZD:'New Zealand dollar',IDR:'Indonesian rupiah',TWD:'Taiwan dollar',CHF:'Swiss franc',VND:'Vietnamese dong',QAR:'Qatari riyal',KWD:'Kuwaiti dinar',BHD:'Bahraini dinar',OMR:'Omani rial',ZAR:'South African rand',BRL:'Brazilian real',MXN:'Mexican peso',SEK:'Swedish krona',NOK:'Norwegian krone',DKK:'Danish krone',PLN:'Polish zloty',TRY:'Turkish lira',ILS:'Israeli shekel',EGP:'Egyptian pound',PKR:'Pakistani rupee',BDT:'Bangladeshi taka',LKR:'Sri Lankan rupee',NPR:'Nepalese rupee',KES:'Kenyan shilling',NGN:'Nigerian naira',ARS:'Argentine peso',CLP:'Chilean peso',COP:'Colombian peso'};
export function currencyChoices(extra:readonly string[]=[]):string[] { return [...new Set<string>([...SUPPORTED_CURRENCIES,...Object.keys(CURRENCY_NAMES),...extra.filter(isCurrencyCode)])]; }
/** Rates use at most six decimals; integer arithmetic preserves exact rounding. */
export function convertMinor(amountMinor:number,rate:number):number {
  if(!Number.isSafeInteger(amountMinor)||!Number.isFinite(rate)||rate<=0||rate>1_000_000||Math.abs(rate*1_000_000-Math.round(rate*1_000_000))>0.0001)throw new Error('Enter a positive exchange rate with at most six decimal places.');
  const negative=amountMinor<0;const scaled=BigInt(Math.abs(amountMinor))*BigInt(Math.round(rate*1_000_000));
  const result=Number((scaled+500_000n)/1_000_000n)*(negative?-1:1);
  if(!Number.isSafeInteger(result))throw new Error('Converted amount exceeds the supported safe range.');
  return result;
}
export function balance(transactions: Transaction[]): number {
  return transactions.reduce((total, tx) => {
    const next = total + signedAmount(tx);
    if (!Number.isSafeInteger(next)) throw new Error('Balance exceeds the supported safe range.');
    return next;
  }, 0);
}
export function safeAdd(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(result)) throw new Error('Total exceeds the supported safe currency range.');
  return result;
}
