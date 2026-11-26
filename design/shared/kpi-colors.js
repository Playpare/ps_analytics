const accents = new Map([
  ['installs', '#2DD4BF'], ['active users', '#22D3EE'], ['d1 retention', '#38BDF8'],
  ['d0 playtime', '#60A5FA'], ['sessions user', '#818CF8'], ['ftue complete', '#A78BFA'],
  ['revenue', '#34D399'], ['arpdau', '#A3E635'], ['arppu', '#FACC15'],
  ['payer conv', '#FB923C'], ['ad iap share', '#FB7185'], ['ua spend', '#E879F9'],
  ['profit', '#4ADE80'], ['roi', '#FBBF24'], ['d4 retention', '#2DD4E1'],
  ['d7 retention', '#818AF8'], ['d14 retention', '#C084FC'], ['cohort size', '#A3D977'],
  ['iap revenue', '#F472B6'], ['ad revenue', '#5EEAD4'], ['crash rate', '#FB6B78'],
  ['anr rate', '#93A7FA'], ['crash free users', '#41D9AB'], ['store conversion rate', '#7DD3FC'],
  ['revenue streams', '#A78BFA'], ['ecpm', '#93C5FD'], ['fill rate', '#7DD3FC'],
]);

const aliases = new Map([
  ['install', 'installs'], ['new users', 'installs'], ['dau', 'active users'],
  ['playtime d0', 'd0 playtime'], ['sessions per user', 'sessions user'],
  ['new installs day', 'installs'], ['playtime user', 'playtime'],
  ['ftue completion', 'ftue complete'], ['ad iap', 'ad iap share'],
  ['purchase rate', 'payer conv'], ['payer conversion', 'payer conv'],
  ['payer conversion rate', 'payer conv'], ['spend', 'ua spend'], ['cost', 'ua spend'],
  ['network cost', 'ua spend'], ['gross profit', 'profit'], ['conversion rate', 'store conversion rate'],
]);

export function kpiAccent(label){
  const name = String(label || '').toLowerCase();
  const normalized = name.replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(word => !/^(android|ios|amazon|all|overall|total|combined|blended|avg|average|daily|period)$/.test(word))
    .join(' ');
  const key = aliases.get(normalized) || normalized;
  // Platform subtotals keep distinct accents everywhere they appear.
  if(key === 'revenue'){
    if(/\bios\b/.test(name)) return '#60A5FA';
    if(/\bandroid\b/.test(name)) return '#2DD4BF';
  }
  if(accents.has(key)) return accents.get(key);
  // A stable color for each additional metric, independent of page and card order.
  let hash = 0;
  for(const char of key) hash = (Math.imul(31, hash) + char.charCodeAt(0)) >>> 0;
  const hue = 160 + hash % 130, light = .67 + ((hash >>> 9) % 8) / 100;
  const channel = n => {
    const k = (n + hue / 30) % 12;
    const value = light - .36 * (1 - Math.abs(2 * light - 1)) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return '#' + channel(0) + channel(8) + channel(4);
}
