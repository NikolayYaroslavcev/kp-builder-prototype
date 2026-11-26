// Имитация API PIM. Для настоящей интеграции меняется только этот модуль.
import { PRODUCTS } from './data.js';

const OVERRIDES_KEY = 'kp-pim-demo';
let db = new Map();
export const demo = { offline: false };

function readOverrides() {
  try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY)) || {}; } catch { return {}; }
}
function load() {
  db = new Map(PRODUCTS.map(p => [p.sku, { ...p }]));
  for (const [sku, patch] of Object.entries(readOverrides())) if (db.has(sku)) Object.assign(db.get(sku), patch);
}
load();

export function resetPim() {
  try { localStorage.removeItem(OVERRIDES_KEY); } catch { /* приватный режим */ }
  load();
}

const wait = ms => new Promise(r => setTimeout(r, ms));
async function call(fn) {
  await wait(120 + Math.random() * 160);
  if (demo.offline) throw new Error('PIM не отвечает');
  return fn();
}

export const pim = {
  search: ({ q = '', cat = '', page = 0, size = 15 }) => call(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const found = [...db.values()].filter(p =>
      (!cat || p.category === cat) &&
      words.every(w => p.sku.toLowerCase().includes(w) || p.name.toLowerCase().includes(w)));
    return { total: found.length, items: found.slice(page * size, page * size + size).map(p => ({ ...p })) };
  }),
  getMany: skus => call(() => Object.fromEntries(skus.map(s => [s, db.has(s) ? { ...db.get(s) } : null]))),
};

// демо: новый прайс поставщика
export function bumpPrices(skus) {
  const today = new Date().toISOString().slice(0, 10), overrides = readOverrides();
  for (const s of skus) {
    const p = db.get(s);
    if (p?.price == null) continue;
    Object.assign(p, { price: Math.round(p.price * 1.045 / 100) * 100, priceUpdatedAt: today });
    overrides[s] = { price: p.price, priceUpdatedAt: today };
  }
  try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)); } catch { /* приватный режим */ }
}
