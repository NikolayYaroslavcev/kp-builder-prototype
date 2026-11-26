import { CATEGORY_NAMES, DEALS, MANAGER, PRICE_MAX_AGE_DAYS, VAT_RATE } from './data.js';
import { pim, demo, resetPim, bumpPrices } from './pim.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const money = n => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const price = n => (n == null ? 'нет цены' : money(n));
const num = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const vatOf = gross => round2(gross * VAT_RATE / (100 + VAT_RATE)); // цены в PIM с НДС (допущение)
const daysSince = iso => Math.floor((Date.now() - new Date(iso)) / 864e5);
const time = iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const date = iso => new Date(iso).toLocaleDateString('ru-RU');
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const positions = n => `${n} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
const parseNum = s => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
const showNum = n => (Number.isFinite(n) ? String(n).replace('.', ',') : '');
const VALID_DAYS = 14; // срок действия КП, допущение
const baseName = name => name.replace(/\s+\S+$/, '');

const state = { dealId: DEALS[0].id, lines: [], version: 1, versions: [], savedAt: null, pimOk: true, discountApproved: false };

const persisted = () => JSON.stringify({ lines: state.lines.map(({ pending, ...l }) => l), version: state.version, versions: state.versions, discountApproved: state.discountApproved });
const store = {
  key: id => `kp-v2-${id}`,
  last: '',
  load(id) {
    try {
      const d = JSON.parse(localStorage.getItem(this.key(id)));
      if (!d || !Array.isArray(d.lines)) return null;
      d.lines = d.lines.filter(l => l && typeof l.sku === 'string' && typeof l.name === 'string')
        .map(l => ({ ...l, qty: Number(l.qty), discount: Number(l.discount) || 0, pending: null }));
      d.versions = Array.isArray(d.versions) ? d.versions : [];
      return d;
    } catch { return null; }
  },
  saveIfChanged() {
    const body = persisted();
    if (body === this.last) return;
    if (!this.last && !state.lines.length && !state.versions.length) { this.last = body; return; }
    this.last = body;
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(this.key(state.dealId), JSON.stringify({ ...JSON.parse(body), savedAt: state.savedAt })); }
    catch { /* приватный режим: черновик живёт до перезагрузки */ }
  },
};

const deal = () => DEALS.find(d => d.id === state.dealId);

// err и price блокируют КП, warn нет
function lineIssues(l) {
  const out = [];
  if (l.status === 'missing') out.push({ kind: 'err', text: 'Артикула больше нет в PIM', action: 'replace' });
  if (l.status === 'archived') out.push({ kind: 'err', text: 'Снят с продажи', action: 'replace' });
  if (l.price == null && l.status !== 'missing') out.push({ kind: 'err', text: 'Нет цены в PIM: уточните цену у руководителя или замените товар', action: 'replace' });
  if (l.pending) out.push({ kind: 'price', text: `Цена в PIM обновилась: было ${money(l.price)}, стало ${money(l.pending.price)}`, action: 'accept' });
  if (!Number.isInteger(l.qty) || l.qty < 1) out.push({ kind: 'err', text: 'Количество: целое число от 1', field: 'qty' });
  if (!Number.isFinite(l.discount) || l.discount < 0 || l.discount > 99) out.push({ kind: 'err', text: 'Скидка: от 0 до 99%', field: 'disc' });
  else if (l.discount > MANAGER.maxDiscount) out.push({ kind: 'warn', text: `Скидка выше лимита ${MANAGER.maxDiscount}%, нужно согласование`, field: 'disc', discount: true });
  if (l.price != null && !l.pending && daysSince(l.priceUpdatedAt) > PRICE_MAX_AGE_DAYS) out.push({ kind: 'warn', text: `Цена не обновлялась ${daysSince(l.priceUpdatedAt)} дн., проверьте актуальность` });
  return out;
}
const hasErr = l => lineIssues(l).some(x => x.kind === 'err');
const counted = l => !lineIssues(l).some(x => x.kind === 'err' || x.kind === 'price');
const lineSum = l => round2(l.price * l.qty * (1 - l.discount / 100));
const allIssues = () => state.lines.flatMap((l, i) => lineIssues(l).map(x => ({ ...x, i, sku: l.sku })));
const needsDiscountOk = () => allIssues().some(x => x.discount);

function totals() {
  const valid = state.lines.filter(counted);
  const gross = round2(valid.reduce((s, l) => s + l.price * l.qty, 0));
  const net = round2(valid.reduce((s, l) => s + lineSum(l), 0));
  return { gross, net, discount: round2(gross - net), vat: vatOf(net), excluded: state.lines.length - valid.length };
}
function blockReason() {
  if (!state.lines.length) return 'empty';
  if (!state.pimOk) return 'pim';
  const iss = allIssues();
  if (iss.some(x => x.kind === 'err')) return 'err';
  if (iss.some(x => x.kind === 'price')) return 'price';
  return null;
}

function renderLines() {
  $('lines').innerHTML = state.lines.map((l, i) => `
    <tr data-row="${i}">
      <td class="num muted">${i + 1}</td>
      <td class="name">
        <div>${esc(l.name)}</div>
        <div class="sku mono">${esc(l.sku)}</div>
        <div class="row-issues" data-issues="${i}"></div>
      </td>
      <td class="num"><input class="n" type="text" inputmode="numeric" autocomplete="off" value="${esc(showNum(l.qty))}" data-qty="${i}" aria-label="Количество, ${esc(l.sku)}"></td>
      <td class="num mono">${price(l.price)}</td>
      <td class="num"><input class="n" type="text" inputmode="decimal" autocomplete="off" value="${esc(showNum(l.discount))}" data-disc="${i}" aria-label="Скидка в процентах, ${esc(l.sku)}"></td>
      <td class="num mono strong" data-sum="${i}"></td>
      <td><button class="btn icon ghost" data-del="${i}" aria-label="Убрать ${esc(l.sku)} из КП">×</button></td>
    </tr>`).join('');
  $('empty').hidden = state.lines.length > 0;
  $('tableWrap').hidden = !state.lines.length;
  renderSummary();
}

// поля ввода не пересоздаются, иначе теряется фокус
function renderSummary() {
  state.lines.forEach((l, i) => {
    const row = $('lines').querySelector(`tr[data-row="${i}"]`);
    if (!row) return;
    const iss = lineIssues(l), err = iss.some(x => x.kind === 'err');
    row.className = err ? 'bad' : iss.some(x => x.kind === 'price') ? 'pending' : iss.length ? 'warn' : '';
    row.querySelector(`[data-sum="${i}"]`).textContent = counted(l) ? money(lineSum(l)) : '—';
    row.querySelector(`[data-issues="${i}"]`).innerHTML = iss.map(x => `
      <p class="issue ${x.kind}"><span class="tag">${x.kind === 'err' ? 'Ошибка' : x.kind === 'price' ? 'Новая цена' : 'Проверить'}</span>${esc(x.text)}
        ${x.action === 'accept' ? `<button class="btn sm" data-accept="${i}">Принять новую цену</button>` : ''}
        ${x.action === 'replace' ? `<button class="btn sm" data-replace="${i}">Найти замену</button>` : ''}</p>`).join('');
  });

  const n = state.lines.length, t = totals();
  $('kpNo').innerHTML = `сохранится как <span class="mono">КП-${state.dealId}-${state.version}</span>`;
  $('lineCount').textContent = n ? positions(n) : '';
  $('totals').hidden = !n;
  $('totals').innerHTML = `
    <dl>
      ${t.discount ? `<dt>Без скидки</dt><dd class="mono">${money(t.gross)} ₽</dd><dt>Скидка</dt><dd class="mono">−${money(t.discount)} ₽</dd>` : ''}
      <dt class="grand">Итого</dt><dd class="mono grand">${money(t.net)} ₽</dd>
      <dt>в т. ч. НДС ${VAT_RATE}%</dt><dd class="mono">${money(t.vat)} ₽</dd>
    </dl>
    ${t.excluded ? `<p class="totals-note">Не учтено в итоге, пока не исправлено: ${positions(t.excluded)}</p>` : ''}`;

  if (!needsDiscountOk()) state.discountApproved = false;
  renderReady();
  $('pimBanner').hidden = state.pimOk;
  store.saveIfChanged();
  $('saveState').textContent = state.savedAt && (n || state.versions.length) ? `Черновик сохранён в ${time(state.savedAt)}` : '';
}

function renderReady() {
  const iss = allIssues(), reason = blockReason();
  const errs = iss.filter(x => x.kind === 'err').length, prices = iss.filter(x => x.kind === 'price').length, warns = iss.filter(x => x.kind === 'warn').length;
  const head = {
    empty: '<p class="muted">Добавьте товары, и здесь появится проверка КП.</p>',
    pim: '<p class="state err">Цены не сверены с PIM</p>',
    err: `<p class="state err">${errs} ${plural(errs, 'ошибка', 'ошибки', 'ошибок')} ${errs === 1 ? 'мешает' : 'мешают'} сформировать КП</p>`,
    price: `<p class="state price">Подтвердите ${prices === 1 ? 'новую цену' : `новые цены (${prices})`} из PIM</p>`,
  }[reason] ?? (warns ? `<p class="state warn">Можно формировать, но проверьте: ${warns} ${plural(warns, 'замечание', 'замечания', 'замечаний')}</p>`
                      : '<p class="state ok">Ошибок нет, КП можно формировать</p>');
  $('readyState').innerHTML = head + (prices > 1 ? '<button class="btn sm" id="acceptAll">Принять все новые цены</button>' : '');
  $('issues').innerHTML = iss.map(x =>
    `<li class="${x.kind}"><button class="link" data-goto="${x.i}" data-field="${x.field ?? ''}"><span class="mono">${esc(x.sku)}</span> ${esc(x.text)}</button></li>`).join('');

  const discountGate = needsDiscountOk() && !reason;
  $('discountOk').hidden = !discountGate;
  $('discountOkBox').checked = state.discountApproved;
  $('preview').disabled = !!reason;
  $('save').disabled = !!reason || (discountGate && !state.discountApproved);
}

function renderVersions() {
  $('versions').innerHTML = state.versions.length
    ? state.versions.map((v, k) => ({ v, k })).reverse().map(({ v, k }) => `
      <li>
        <div class="v-head"><span class="mono strong">${esc(v.no)}</span><span class="muted">${date(v.at)}, ${time(v.at)}</span></div>
        <div class="v-meta">${positions(v.lines.length)} · <span class="mono">${money(v.total)} ₽</span>${v.approved ? ' · скидка согласована' : ''}</div>
        <div class="v-actions">
          <button class="link" data-open-version="${k}">Открыть КП</button>
          <details><summary class="link">Запрос в Битрикс24</summary><pre class="payload">${esc(JSON.stringify(v.payload, null, 2))}</pre></details>
        </div>
      </li>`).join('')
    : '<li class="muted">Пока ничего не сохранено в сделку.</li>';
}

function renderDealCard() {
  const d = deal();
  $('dealCard').innerHTML = `<b>${esc(d.company)}</b><span>${esc(d.contact)} · ${esc(d.email)}</span>`;
}

let refreshReq = 0;
async function refreshFromPim() {
  const req = ++refreshReq, dealId = state.dealId;
  const skus = [...new Set(state.lines.map(l => l.sku))];
  if (!skus.length) { state.pimOk = true; renderSummary(); return; }
  try {
    const fresh = await pim.getMany(skus);
    if (req !== refreshReq || dealId !== state.dealId) return;
    for (const l of state.lines) {
      if (!(l.sku in fresh)) continue;
      const p = fresh[l.sku];
      if (!p) { l.status = 'missing'; continue; }
      Object.assign(l, { name: p.name, status: p.status, priceUpdatedAt: p.priceUpdatedAt });
      if (l.price == null || p.price == null) { l.price = p.price; l.pending = null; }
      else l.pending = p.price !== l.price ? { price: p.price } : null;
    }
    state.pimOk = true;
  } catch {
    if (req !== refreshReq || dealId !== state.dealId) return;
    state.pimOk = false;
  }
  renderLines();
}

function addProduct(p, qty = 1) {
  const line = state.lines.find(l => l.sku === p.sku);
  if (line) line.qty = (Number.isFinite(line.qty) ? line.qty : 0) + qty;
  else state.lines.push({ sku: p.sku, name: p.name, price: p.price, status: p.status, priceUpdatedAt: p.priceUpdatedAt, qty, discount: 0, pending: null });
  return state.lines.findIndex(l => l.sku === p.sku);
}

function flashRow(i) {
  const row = $('lines').querySelector(`tr[data-row="${i}"]`);
  if (!row) return;
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
  row.scrollIntoView({ block: 'nearest' });
}

const sug = { items: [], active: -1, req: 0, timer: 0, loading: false, error: false, enterQueued: null, replace: null };
const pills = (p, inKp) =>
  (p.status === 'archived' ? ' <span class="pill err">снят с продажи</span>' : '') +
  (p.price == null ? ' <span class="pill err">нет цены</span>' : '') +
  (inKp.has(p.sku) ? ` <span class="pill">в КП: ${esc(inKp.get(p.sku))}</span>` : '');

function setActive(k) {
  sug.active = k;
  if (k >= 0 && !$('suggest').hidden) $('add').setAttribute('aria-activedescendant', `sug-${k}`);
  else $('add').removeAttribute('aria-activedescendant');
}
function closeSuggest() {
  $('suggest').hidden = true;
  $('add').setAttribute('aria-expanded', 'false');
  $('add').removeAttribute('aria-activedescendant');
}
function renderSuggest() {
  const ul = $('suggest');
  if (!$('add').value.trim()) { closeSuggest(); return; }
  const inKp = new Map(state.lines.map(l => [l.sku, l.qty]));
  const head = sug.replace != null && state.lines[sug.replace]
    ? `<li class="sug-msg sug-head"><span>Замена для <span class="mono">${esc(state.lines[sug.replace].sku)}</span>, количество и скидка сохранятся</span><button class="btn sm ghost" data-sug-cancel>Отмена</button></li>` : '';
  ul.innerHTML = head + (sug.error
    ? '<li class="sug-msg err">Каталог PIM не отвечает. <button class="btn sm" data-sug-retry>Повторить</button></li>'
    : sug.loading ? '<li class="sug-msg muted">Ищу в PIM…</li>'
    : !sug.items.length ? '<li class="sug-msg muted">Ничего не найдено. Проверьте артикул или откройте каталог.</li>'
    : sug.items.map((p, k) => `
      <li id="sug-${k}" role="option" aria-selected="${k === sug.active}" class="${k === sug.active ? 'active' : ''}" data-sug="${k}">
        <span class="mono sku">${esc(p.sku)}</span>
        <span class="sug-name">${esc(p.name)}${pills(p, inKp)}</span>
        <span class="mono">${price(p.price)}</span>
      </li>`).join(''));
  ul.hidden = false;
  $('add').setAttribute('aria-expanded', 'true');
  setActive(sug.active);
}

async function runSuggest() {
  const q = $('add').value.trim(), req = ++sug.req;
  if (!q) { sug.loading = false; renderSuggest(); return; }
  try {
    const { items } = await pim.search({ q, size: 8 });
    if (req !== sug.req) return;
    const skip = sug.replace != null ? state.lines[sug.replace]?.sku : null;
    sug.items = items.filter(p => p.sku !== skip); sug.error = false;
    const exact = sug.items.findIndex(p => p.sku === q.toUpperCase());
    sug.active = exact >= 0 ? exact : sug.items.length ? 0 : -1;
    const queued = sug.enterQueued;
    sug.enterQueued = null;
    sug.loading = false;
    renderSuggest();
    if (queued && queued.dealId === state.dealId && (exact >= 0 || sug.items.length === 1)) pickSuggestion(exact >= 0 ? exact : 0);
    return;
  } catch {
    if (req !== sug.req) return;
    sug.items = []; sug.error = true; sug.active = -1; sug.enterQueued = null;
  }
  sug.loading = false;
  renderSuggest();
}

function resetSuggest() {
  $('add').value = ''; sug.items = []; sug.active = -1; sug.replace = null; sug.enterQueued = null; sug.req++;
  closeSuggest();
}

function pickSuggestion(k) {
  const p = sug.items[k];
  if (!p) return;
  let i;
  const old = sug.replace != null ? state.lines[sug.replace] : null;
  if (old) {
    const dup = state.lines.findIndex(l => l.sku === p.sku);
    if (dup >= 0) { state.lines[dup].qty += old.qty; state.lines.splice(sug.replace, 1); i = state.lines.findIndex(l => l.sku === p.sku); }
    else { state.lines[sug.replace] = { sku: p.sku, name: p.name, price: p.price, status: p.status, priceUpdatedAt: p.priceUpdatedAt, qty: old.qty, discount: old.discount, pending: null }; i = sug.replace; }
    toast(`${old.sku} заменён на ${p.sku}`);
  } else i = addProduct(p);
  if (p.status === 'archived' || p.price == null) toast(`${p.sku} добавлен с ошибкой: ${p.price == null ? 'нет цены' : 'снят с продажи'}`);
  resetSuggest();
  renderLines(); flashRow(i);
  $('add').focus();
}

$('add').addEventListener('input', () => {
  sug.items = []; sug.active = -1; sug.error = false; sug.loading = true; sug.enterQueued = null;
  renderSuggest();
  clearTimeout(sug.timer); sug.timer = setTimeout(runSuggest, 180);
});
$('add').addEventListener('keydown', e => {
  const n = sug.items.length, open = !$('suggest').hidden;
  if (e.key === 'ArrowDown' && n) { sug.active = (sug.active + 1) % n; renderSuggest(); e.preventDefault(); }
  else if (e.key === 'ArrowUp' && n) { sug.active = (sug.active - 1 + n) % n; renderSuggest(); e.preventDefault(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (sug.loading) sug.enterQueued = { dealId: state.dealId };
    else if (sug.active >= 0) pickSuggestion(sug.active);
  } else if (e.key === 'Escape') {
    if (open) closeSuggest(); else resetSuggest();
  }
});
$('add').addEventListener('blur', () => setTimeout(() => { closeSuggest(); sug.enterQueued = null; }, 150));
$('add').addEventListener('focus', () => { if ($('add').value.trim()) renderSuggest(); });
$('suggest').addEventListener('mousedown', e => {
  e.preventDefault();
  if (e.target.closest('[data-sug-cancel]')) { resetSuggest(); return; }
  if (e.target.closest('[data-sug-retry]')) { sug.loading = true; renderSuggest(); runSuggest(); return; }
  const li = e.target.closest('[data-sug]');
  if (li) pickSuggestion(+li.dataset.sug);
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('dialog[open]')) {
    e.preventDefault(); $('add').focus();
  }
});

$('lines').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.qty == null && t.dataset.disc == null) return;
  if (t.value.trim() === '') return;
  const v = parseNum(t.value);
  if (t.dataset.qty != null) state.lines[+t.dataset.qty].qty = v;
  else { state.lines[+t.dataset.disc].discount = v; state.discountApproved = false; }
  renderSummary();
});
$('lines').addEventListener('change', e => {
  const t = e.target;
  if (t.value.trim() !== '') return;
  const l = state.lines[+(t.dataset.qty ?? t.dataset.disc)];
  if (l) t.value = showNum(t.dataset.qty != null ? l.qty : l.discount);
});

let undo = [];
$('lines').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'), acc = e.target.closest('[data-accept]'), rep = e.target.closest('[data-replace]');
  if (del) {
    const i = +del.dataset.del, [removed] = state.lines.splice(i, 1);
    undo.push({ i, line: removed });
    renderLines();
    toast(undo.length === 1 ? `Позиция ${removed.sku} убрана` : `Убрано позиций: ${undo.length}`, 'Вернуть', () => {
      for (const { i: at, line } of undo.reverse()) {
        const existing = state.lines.findIndex(l => l.sku === line.sku);
        if (existing >= 0) state.lines[existing].qty += line.qty;
        else state.lines.splice(Math.min(at, state.lines.length), 0, line);
      }
      undo = [];
      renderLines();
    });
  } else if (acc) {
    acceptPrice(state.lines[+acc.dataset.accept]);
    renderLines();
  } else if (rep) {
    sug.replace = +rep.dataset.replace;
    $('add').value = baseName(state.lines[sug.replace].name);
    $('add').focus();
    $('add').dispatchEvent(new Event('input'));
  }
});
function acceptPrice(l) { if (l?.pending) { l.price = l.pending.price; l.pending = null; } }
$('readyState').addEventListener('click', e => {
  if (e.target.id !== 'acceptAll') return;
  state.lines.forEach(acceptPrice);
  renderLines();
});
$('issues').addEventListener('click', e => {
  const b = e.target.closest('[data-goto]');
  if (!b) return;
  const i = +b.dataset.goto, row = $('lines').querySelector(`tr[data-row="${i}"]`);
  flashRow(i);
  const target = b.dataset.field ? row?.querySelector(`[data-${b.dataset.field}]`) : row?.querySelector('[data-accept], [data-replace]');
  target?.focus({ preventScroll: true });
});
$('discountOkBox').addEventListener('change', e => { state.discountApproved = e.target.checked; renderSummary(); });

const cat = { q: '', cat: '', page: 0, size: 12, req: 0, timer: 0, items: [] };

async function loadCatalog() {
  const req = ++cat.req;
  $('cprev').disabled = $('cnext').disabled = true;
  $('cbody').innerHTML = `<div class="skeleton">${'<span></span>'.repeat(6)}</div>`;
  try {
    const { total, items } = await pim.search(cat);
    if (req !== cat.req) return;
    const pages = Math.max(1, Math.ceil(total / cat.size));
    if (cat.page > pages - 1) { cat.page = pages - 1; loadCatalog(); return; }
    const inKp = new Map(state.lines.map(l => [l.sku, l.qty]));
    cat.items = items;
    $('cbody').innerHTML = items.length ? `<table class="clist">
      <thead><tr><th>Артикул</th><th>Товар</th><th class="num">Цена, ₽</th><th><span class="visually-hidden">Добавить</span></th></tr></thead>
      <tbody>${items.map(p => `
      <tr class="${p.status === 'archived' || p.price == null ? 'bad' : ''}">
        <td class="mono sku">${esc(p.sku)}</td>
        <td>${esc(p.name)}<span data-pills="${esc(p.sku)}">${pills(p, inKp)}</span></td>
        <td class="num mono">${price(p.price)}</td>
        <td><button class="btn icon" data-cadd="${esc(p.sku)}" aria-label="Добавить ${esc(p.sku)} в КП">+</button></td>
      </tr>`).join('')}</tbody></table>`
      : '<p class="empty-state muted">Ничего не найдено. Проверьте артикул или сбросьте категорию.</p>';
    $('cinfo').textContent = total ? `${cat.page + 1} из ${pages} · найдено ${total}` : '';
    $('cprev').disabled = cat.page === 0;
    $('cnext').disabled = cat.page >= pages - 1;
  } catch {
    if (req !== cat.req) return;
    $('cbody').innerHTML = '<div class="banner err"><span>Каталог PIM не отвечает.</span><button class="btn sm" data-cretry>Повторить</button></div>';
    $('cinfo').textContent = ''; $('cprev').disabled = $('cnext').disabled = true;
  }
}
$('openCatalog').onclick = () => { $('catalog').showModal(); $('cq').focus(); loadCatalog(); };
$('cq').addEventListener('input', () => { clearTimeout(cat.timer); cat.timer = setTimeout(() => { cat.q = $('cq').value; cat.page = 0; loadCatalog(); }, 180); });
$('cq').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); $('catalog').close(); } });
$('ccat').onchange = () => { cat.cat = $('ccat').value; cat.page = 0; loadCatalog(); };
$('cprev').onclick = () => { cat.page = Math.max(0, cat.page - 1); loadCatalog(); };
$('cnext').onclick = () => { cat.page++; loadCatalog(); };
$('cbody').addEventListener('click', e => {
  if (e.target.closest('[data-cretry]')) { loadCatalog(); return; }
  const b = e.target.closest('[data-cadd]');
  if (!b) return;
  const p = cat.items.find(x => x.sku === b.dataset.cadd);
  const i = addProduct(p);
  renderLines(); flashRow(i);
  if (p.status === 'archived' || p.price == null) toast(`${p.sku} добавлен с ошибкой: ${p.price == null ? 'нет цены' : 'снят с продажи'}`);
  $('cbody').querySelector(`[data-pills="${CSS.escape(p.sku)}"]`).innerHTML = pills(p, new Map(state.lines.map(l => [l.sku, l.qty])));
});

// «артикул количество»: понимает «2 шт», «x2», «2x», «2 комплекта», «артикул - 2», «артикул;2;шт»
const UNITS = /(шт|штук[аи]?|pcs|ед|компл[а-яё]*|уп[а-яё]*)\.?/gi; // \w в JS не ловит кириллицу
let bulkRows = [], bulkReq = 0;
function parseBulk(text) {
  return text.split('\n').map(s => s.trim()).filter(Boolean).map(raw => {
    const [sku, ...rest] = raw.split(/[\s;]+/);
    const tail = rest.filter(t => !/^[-–—:=]$/.test(t)).join(' ')
      .replace(new RegExp(`(\\d)\\s*${UNITS.source}`, 'gi'), '$1')
      .replace(new RegExp(`(^|\\s)${UNITS.source}(?=\\s|$)`, 'gi'), ' ')
      .replace(/(^|\s)[xх×*]\s*(?=\d)/gi, ' ')
      .replace(/(\d)\s*[xх×*](?=\s|$)/gi, '$1')
      .trim();
    const nums = tail.match(/-?\d+(?:[.,]\d+)?/g) || [];
    const leftover = tail.replace(/-?\d+(?:[.,]\d+)?/g, '').trim();
    const qty = !tail ? 1 : nums.length === 1 && !leftover ? Number(nums[0].replace(',', '.')) : NaN;
    return { raw, sku: sku.toUpperCase(), qty, qtyOk: Number.isInteger(qty) && qty >= 1 };
  });
}
const bulkLabel = r => r.status === 'missing' ? '<span class="pill err">нет в PIM</span>'
  : r.status === 'badqty' ? '<span class="pill err">количество не распознано</span>'
  : r.p.status === 'archived' ? '<span class="pill warn">снят с продажи, добавится с ошибкой</span>'
  : r.p.price == null ? '<span class="pill warn">нет цены, добавится с ошибкой</span>'
  : r.dup ? '<span class="pill ok">повтор, количество сложится</span>'
  : '<span class="pill ok">добавится</span>';

$('openBulk').onclick = () => { $('bulk').showModal(); $('bulkText').focus(); };
$('bulkParse').onclick = async () => {
  const text = $('bulkText').value, rows = parseBulk(text), req = ++bulkReq;
  if (!rows.length) { $('bulkStatus').textContent = 'Список пуст.'; return; }
  $('bulkStatus').textContent = 'Сверяю с PIM…';
  $('bulkAdd').disabled = true;
  try {
    const found = await pim.getMany([...new Set(rows.map(r => r.sku))]);
    if (req !== bulkReq || text !== $('bulkText').value) return;
    const seen = new Set();
    bulkRows = rows.map(r => {
      const status = !found[r.sku] ? 'missing' : r.qtyOk ? 'ok' : 'badqty';
      const dup = status === 'ok' && (seen.has(r.sku) || state.lines.some(l => l.sku === r.sku));
      if (status === 'ok') seen.add(r.sku);
      return { ...r, p: found[r.sku], status, dup };
    });
    const ok = bulkRows.filter(r => r.status === 'ok');
    $('bulkPreview').innerHTML = `<table class="clist bulk-list"><thead><tr><th>Строка</th><th>Товар</th><th class="num">Кол-во</th><th></th></tr></thead><tbody>${bulkRows.map(r => `
      <tr><td class="mono raw">${esc(r.raw)}</td><td>${r.p ? esc(r.p.name) : '<span class="muted">не найден</span>'}</td>
      <td class="num mono">${r.status === 'badqty' || !Number.isFinite(r.qty) ? '?' : esc(num(r.qty))}</td><td>${bulkLabel(r)}</td></tr>`).join('')}</tbody></table>`;
    $('bulkStatus').textContent = `Распознано ${ok.length} из ${bulkRows.length}.` + (ok.length < bulkRows.length ? ' Остальные строки не добавятся.' : '');
    $('bulkAdd').disabled = !ok.length;
    $('bulkAdd').textContent = ok.length ? `Добавить ${ok.length} ${plural(ok.length, 'позицию', 'позиции', 'позиций')}` : 'Добавить';
  } catch {
    if (req === bulkReq) $('bulkStatus').textContent = 'Каталог PIM не отвечает, попробуйте ещё раз.';
  }
};
function resetBulk() { bulkReq++; bulkRows = []; $('bulkAdd').disabled = true; $('bulkAdd').textContent = 'Добавить'; $('bulkPreview').innerHTML = ''; $('bulkStatus').textContent = ''; }
$('bulkText').addEventListener('input', resetBulk);
$('bulkAdd').onclick = () => {
  const ok = bulkRows.filter(r => r.status === 'ok'), skipped = bulkRows.length - ok.length;
  const withErr = ok.filter(r => r.p.status === 'archived' || r.p.price == null).length;
  let last = -1;
  for (const r of ok) last = addProduct(r.p, r.qty);
  $('bulk').close();
  $('bulkText').value = ''; resetBulk();
  renderLines(); if (last >= 0) flashRow(last);
  toast(`Добавлено: ${positions(ok.length)}` + (withErr ? `, из них с ошибкой: ${withErr}` : '') + (skipped ? `; пропущено строк: ${skipped}` : ''));
};

function snapshot() {
  const valid = state.lines.filter(counted);
  return { approved: state.discountApproved && needsDiscountOk(), no: `КП-${state.dealId}-${state.version}`, at: new Date().toISOString(), total: totals().net,
    lines: valid.map(l => ({ sku: l.sku, name: l.name, qty: l.qty, price: l.price, discount: l.discount, sum: lineSum(l) })) };
}
function docHtml(v, draft) {
  const d = deal(), net = v.total, validTill = new Date(new Date(v.at).getTime() + VALID_DAYS * 864e5).toISOString();
  const gross = round2(v.lines.reduce((s, l) => s + l.price * l.qty, 0));
  return `
    ${draft ? '<p class="doc-draft">Черновик. Номер КП присваивается при сохранении в сделку.</p>' : ''}
    <div class="doc-top"><div class="doc-logo screen-only">Логотип и реквизиты<br>из шаблона компании</div>
      <div class="doc-meta"><h1>Коммерческое предложение</h1><p>${draft ? 'Черновик' : `№ ${esc(v.no)}`} от ${date(v.at)}<br>Действительно до ${date(validTill)}</p></div></div>
    <p class="doc-to"><span>Для</span>${esc(d.company)}, ${esc(d.contact)}</p>
    <table class="doc-table"><thead><tr><th>№</th><th>Артикул</th><th>Наименование</th><th class="num">Кол-во</th><th class="num">Цена, ₽</th><th class="num">Скидка</th><th class="num">Сумма, ₽</th></tr></thead>
    <tbody>${v.lines.map((l, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(l.sku)}</td><td>${esc(l.name)}</td><td class="num">${esc(l.qty)}</td><td class="num mono">${money(l.price)}</td><td class="num">${l.discount ? esc(num(l.discount)) + '%' : ''}</td><td class="num mono">${money(l.sum)}</td></tr>`).join('')}</tbody></table>
    <dl class="doc-totals">
      ${gross !== net ? `<dt>Без скидки</dt><dd class="mono">${money(gross)} ₽</dd><dt>Скидка</dt><dd class="mono">−${money(round2(gross - net))} ₽</dd>` : ''}
      <dt class="grand">Итого</dt><dd class="mono grand">${money(net)} ₽</dd>
      <dt>в т. ч. НДС ${VAT_RATE}%</dt><dd class="mono">${money(vatOf(net))} ₽</dd>
    </dl>
    <p class="doc-terms screen-only">Условия оплаты, поставки и гарантии подставляются из шаблона компании.</p>
    <p class="doc-sign">Менеджер: ${esc(MANAGER.name)}</p>`;
}
function openDoc(v, draft) {
  $('docBody').innerHTML = docHtml(v, draft);
  $('print').textContent = draft ? 'Печать черновика' : 'Печать или PDF';
  $('doc').showModal(); $('doc').scrollTop = 0;
}
$('preview').onclick = () => openDoc(snapshot(), true);
// печатаем копию листа: модальное окно при печати обрезает длинное КП
const fillPrint = () => { $('printArea').innerHTML = $('doc').open ? $('docBody').innerHTML : ''; };
window.addEventListener('beforeprint', fillPrint);
$('print').onclick = () => { fillPrint(); window.print(); };

const sameLines = (a, b) => JSON.stringify(a.map(({ sum, ...l }) => l)) === JSON.stringify(b.map(({ sum, ...l }) => l));
$('save').onclick = () => {
  const v = snapshot(), prev = state.versions.at(-1);
  if (prev && sameLines(prev.lines, v.lines)) { toast(`Без изменений с ${prev.no}, новая версия не нужна`); return; }
  // Допущения о Битрикс24, сверить с порталом: PRICE — цена за единицу после скидки с НДС; PRODUCT_ID требует
  // сопоставления артикулов PIM с каталогом Битрикс24; метод заменяет все товарные строки сделки.
  v.payload = { method: 'crm.deal.productrows.set', id: state.dealId,
    rows: v.lines.map(l => ({ PRODUCT_NAME: `${l.sku} ${l.name}`, PRICE: round2(l.price * (1 - l.discount / 100)), QUANTITY: l.qty,
      DISCOUNT_TYPE_ID: 2, DISCOUNT_RATE: l.discount, TAX_RATE: VAT_RATE, TAX_INCLUDED: 'Y' })) };
  state.versions.push(v);
  state.version++;
  renderVersions(); renderSummary();
  toast(`${v.no} сохранено в сделку #${state.dealId} (демо, без отправки)`);
};
$('versions').addEventListener('click', e => {
  const b = e.target.closest('[data-open-version]');
  if (b) openDoc(state.versions[+b.dataset.openVersion], false);
});

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
}

let toastTimer = 0;
function hideToast() { $('toast').hidden = true; clearTimeout(toastTimer); undo = []; }
function toast(text, actionLabel, action) {
  if (!actionLabel) undo = [];
  $('toastText').textContent = text;
  const btn = $('toastAction');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { action?.(); hideToast(); };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 3500);
}

$('vatRate').textContent = VAT_RATE;
$('discLimit').textContent = MANAGER.maxDiscount;
$('priceAge').textContent = PRICE_MAX_AGE_DAYS;
$('validDays').textContent = VALID_DAYS;
$('demoOffline').onchange = e => { demo.offline = e.target.checked; refreshFromPim(); };
$('retryPim').onclick = () => refreshFromPim();
$('demoPrices').onclick = () => {
  if (!state.lines.length) { toast('Сначала добавьте товары в КП'); return; }
  bumpPrices(state.lines.slice(0, 2).map(l => l.sku));
  refreshFromPim();
  toast('В PIM поменялись цены у первых позиций КП');
};
$('demoReset').onclick = () => {
  if (!confirm('Сбросить демо? Черновики и версии всех сделок будут удалены.')) return;
  try { DEALS.forEach(d => localStorage.removeItem(store.key(d.id))); } catch { /* приватный режим */ }
  demo.offline = false; $('demoOffline').checked = false; resetPim();
  loadDeal(state.dealId);
  toast('Демо сброшено');
};

function loadDeal(id) {
  hideToast();
  resetSuggest();
  state.dealId = id;
  const d = store.load(id);
  state.lines = d?.lines ?? [];
  state.version = Number.isInteger(d?.version) ? d.version : 1;
  state.versions = d?.versions ?? [];
  state.savedAt = d?.savedAt ?? null;
  state.discountApproved = !!d?.discountApproved;
  store.last = d ? persisted() : '';
  renderDealCard(); renderVersions(); renderLines();
  refreshFromPim();
}
$('deal').innerHTML = DEALS.map(d => `<option value="${d.id}">#${d.id} ${esc(d.title)}</option>`).join('');
$('ccat').innerHTML += Object.entries(CATEGORY_NAMES).map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
$('deal').onchange = e => { loadDeal(+e.target.value); try { localStorage.setItem('kp-deal', e.target.value); } catch { /* приватный режим */ } };

let startDeal = DEALS[0].id;
try { const saved = +localStorage.getItem('kp-deal'); if (DEALS.some(d => d.id === saved)) startDeal = saved; } catch { /* приватный режим */ }
$('deal').value = startDeal;
loadDeal(startDeal);
