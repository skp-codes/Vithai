// Normalise fund names so a Tickertape export row ("Invesco India Midcap Fund") matches the
// AMFI scheme ("Invesco India Mid Cap Fund - Direct Plan - Growth").

const SYNONYMS = [
  [/\bpru\b/g, 'prudential'],
  [/\bcorp\b/g, 'corporate'],
  [/\babsl\b/g, 'aditya birla sun life'],
  [/\bfof\b/g, 'fund of funds'],
  [/\bpsu debt\b/g, 'psu'],
  [/\boppor?\b/g, 'opportunities'],
];
const DROP = /\b(direct|regular|plan|growth|option|fund|scheme|the|and|a|an|series)\b/g;

export function nameKey(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/\(.*?\)/g, ' ');           // drop "(IDCW)" style suffixes
  s = s.replace(/&/g, ' and ');
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  s = s.replace(DROP, ' ');
  return s.replace(/[^a-z0-9]/g, '');
}

// Strip plan/option suffixes for display
export function cleanName(name) {
  return String(name || '')
    .replace(/\s*-\s*(Direct|Regular)\b.*$/i, '')
    .replace(/\s+Direct Plan.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
