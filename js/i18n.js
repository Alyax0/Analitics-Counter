// Traducciones de la interfaz (i18n/es.json, i18n/en.json).
// t('clave.anidada', { n, ... }): si el valor es { one, other } elige el plural
// según n; {nombre} se reemplaza por el parámetro. Lo que falte en un idioma
// sale del español. Los parámetros con HTML deben llegar ya escapados.

export const LANGS = ['es', 'en'];
const STORAGE_KEY = 'lang';

let lang = 'es';
let dict = {};
let base = {};

async function fetchDict(code) {
  const res = await fetch(`i18n/${code}.json`);
  if (!res.ok) throw new Error(`i18n ${code}: ${res.status}`);
  return res.json();
}

// Idioma guardado; si no hay, el primero del navegador que soportemos
export function preferredLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // storage bloqueado: seguimos con el navegador
  }
  const browser = navigator.languages?.length ? navigator.languages : [navigator.language || 'es'];
  for (const l of browser) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return 'es';
}

export async function setLang(code) {
  if (!LANGS.includes(code)) code = 'es';
  if (!base.nav) base = await fetchDict('es');
  dict = code === 'es' ? base : await fetchDict(code);
  lang = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // no se recuerda, pero el cambio aplica igual
  }
  document.documentElement.lang = code;
}

export const getLang = () => lang;

const lookup = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function t(key, params = {}) {
  let value = lookup(dict, key) ?? lookup(base, key);
  if (value == null) return key;
  if (typeof value === 'object') value = value[new Intl.PluralRules(lang).select(params.n ?? 0)] ?? value.other;
  return String(value).replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : params[k]));
}
