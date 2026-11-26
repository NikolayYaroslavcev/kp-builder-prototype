import { PRODUCTS, CATEGORY_NAMES, DEALS, MANAGER, PRICE_MAX_AGE_DAYS, VAT_RATE } from './data.js';

const $ = id => document.getElementById(id);
const money = n => n == null ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round(n * 100) / 100;
const vatOf = gross => round2(gross * VAT_RATE / (100 + VAT_RATE)); // цены с НДС (допущение)
const bySku = new Map(PRODUCTS.map(p => [p.sku, p]));
const PAGE = 15;

// «API» каталога: поиск, фильтр и страницы — как будет на стороне сервера/PIM, а не выгрузкой всего каталога в браузер.
function searchCatalog({ q, cat, page }) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = PRODUCTS.filter(p =>
    (!cat || p.category === cat) &&
    words.every(w => p.sku.toLowerCase().includes(w) || p.name.toLowerCase().includes(w)));
  return { total: found.length, items: found.slice(page * PAGE, page * PAGE + PAGE) };
}

const state = { dealId: DEALS[0].id, q: '', cat: '', page: 0, lines: [], version: 1 };

const store = {
  key: id => `kp-draft-${id}`,
  load(id) {
    try {
      const d = JSON.parse(localStorage.getItem(this.key(id)));
      if (!d || !Array.isArray(d.lines)) return null;
      // строки с артикулами, которых больше нет в каталоге, отбрасываем
      d.lines = d.lines.filter(l => l && bySku.has(l.sku)).map(l => ({ sku: l.sku, qty: Number(l.qty), discount: Number(l.discount) || 0 }));
      return d;
    } catch { return null; }
  },
  save() { try { localStorage.setItem(this.key(state.dealId), JSON.stringify({ lines: state.lines, version: state.version })); } catch {} },
};

function loadDeal(id) {
  state.dealId = id;
  const d = store.load(id);
  state.lines = d?.lines ?? [];
  state.version = Number.isInteger(d?.version) ? d.version : 1;
  const deal = DEALS.find(x => x.id === id);
  $('dealInfo').textContent = `${deal.company} · ${deal.contact}`;
  renderCatalog();
  renderLines();
}

function addItem(sku, qty = 1) {
  if (!bySku.has(sku)) return false;
  const line = state.lines.find(l => l.sku === sku);
  if (line) line.qty += qty; else state.lines.push({ sku, qty, discount: 0 });
  return true;
}

function lineSum(l) {
  const p = bySku.get(l.sku);
  return p.price == null || !Number.isFinite(l.qty) || !Number.isFinite(l.discount) ? 0 : round2(p.price * l.qty * (1 - l.discount / 100));
}

function checks() {
  const out = [];
  if (!state.lines.length) out.push(['err', 'В КП нет товаров']);
  for (const l of state.lines) {
    const p = bySku.get(l.sku);
    const days = Math.floor((Date.now() - new Date(p.priceUpdatedAt)) / 864e5);
    if (p.price == null) out.push(['err', `${p.sku}: нет цены в PIM — уточнить цену до отправки`, l.sku]);
    if (p.status === 'archived') out.push(['err', `${p.sku}: товар снят с продажи — заменить`, l.sku]);
    if (!Number.isInteger(l.qty) || l.qty < 1) out.push(['err', `${p.sku}: количество должно быть целым числом от 1`, l.sku]);
    if (!Number.isFinite(l.discount) || l.discount < 0 || l.discount > 99) out.push(['err', `${p.sku}: скидка вне диапазона 0–99%`, l.sku]);
    else if (l.discount > MANAGER.maxDiscount) out.push(['warn', `${p.sku}: скидка ${l.discount}% выше лимита ${MANAGER.maxDiscount}% — нужно согласование`, l.sku]);
    if (p.price != null && days > PRICE_MAX_AGE_DAYS) out.push(['warn', `${p.sku}: цена не обновлялась ${days} дн. — проверить актуальность`, l.sku]);
  }
  return out;
}

function renderCatalog() {
  const { total, items } = searchCatalog(state);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  $('catalog').innerHTML = items.map(p => `
    <tr class="${p.status === 'archived' || p.price == null ? 'bad' : ''}">
      <td class="sku">${esc(p.sku)}</td>
      <td>${esc(p.name)}${p.status === 'archived' ? ' <span class="muted">(снят)</span>' : ''}</td>
      <td class="num">${money(p.price)}</td>
      <td><button data-add="${esc(p.sku)}" title="Добавить в КП">+</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">Ничего не найдено</td></tr>';
  $('pageInfo').textContent = `${state.page + 1} / ${pages} · найдено ${total}`;
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page >= pages - 1;
}

// Полная перерисовка строк — только при добавлении/удалении. При вводе количества и скидки
// обновляются суммы и проверки, а поля ввода не пересоздаются (не теряется фокус).
function renderLines() {
  $('lines').innerHTML = state.lines.map((l, i) => {
    const p = bySku.get(l.sku);
    return `<tr data-row="${i}">
      <td><div>${esc(p.name)}</div><div class="sku">${esc(p.sku)}</div></td>
      <td class="num"><input class="n" type="number" min="1" step="1" value="${esc(l.qty)}" data-qty="${i}"></td>
      <td class="num">${money(p.price)}</td>
      <td class="num"><input class="n" type="number" min="0" max="99" step="0.5" value="${esc(l.discount)}" data-disc="${i}"></td>
      <td class="num" data-sum="${i}"></td>
      <td><button data-del="${i}" title="Убрать">×</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">Добавьте товары из каталога или списком артикулов</td></tr>';
  renderSummary();
}

function renderSummary() {
  const list = checks();
  const flagged = new Map();
  for (const [t, , sku] of list) if (sku && flagged.get(sku) !== 'err') flagged.set(sku, t);
  state.lines.forEach((l, i) => {
    const row = $('lines').querySelector(`tr[data-row="${i}"]`);
    if (!row) return;
    const f = flagged.get(l.sku);
    row.className = f === 'err' ? 'bad' : f === 'warn' ? 'warn' : '';
    row.querySelector(`[data-sum="${i}"]`).textContent = money(lineSum(l));
  });

  $('kpNo').textContent = `КП-${state.dealId}-${state.version}`;
  const gross = round2(state.lines.reduce((s, l) => s + (bySku.get(l.sku).price ?? 0) * (Number.isFinite(l.qty) ? l.qty : 0), 0));
  const net = round2(state.lines.reduce((s, l) => s + lineSum(l), 0));
  $('totals').innerHTML = `Без скидки: ${money(gross)} ₽ · Скидка: ${money(round2(gross - net))} ₽<br>Итого: <b>${money(net)} ₽</b> <span class="muted">(в т. ч. НДС ${VAT_RATE}%: ${money(vatOf(net))} ₽)</span>`;

  $('checks').innerHTML = list.length
    ? list.map(([t, msg]) => `<li class="${t}">${esc(msg)}</li>`).join('')
    : '<li class="ok">Ошибок нет, КП можно формировать</li>';
  const hasErr = list.some(c => c[0] === 'err');
  $('preview').disabled = hasErr;
  $('attach').disabled = hasErr;
  store.save();
}

function kpHtml() {
  const deal = DEALS.find(d => d.id === state.dealId);
  const valid = new Date(Date.now() + 14 * 864e5).toLocaleDateString('ru-RU');
  const rows = state.lines.map((l, i) => {
    const p = bySku.get(l.sku);
    return `<tr><td>${i + 1}</td><td>${esc(p.name)}<br><small>${esc(p.sku)}</small></td><td>${l.qty}</td><td>${money(p.price)}</td><td>${l.discount || ''}</td><td>${money(lineSum(l))}</td></tr>`;
  }).join('');
  const net = round2(state.lines.reduce((s, l) => s + lineSum(l), 0));
  return `<h1>Коммерческое предложение № КП-${state.dealId}-${state.version}</h1>
    <div>от ${new Date().toLocaleDateString('ru-RU')} · действительно до ${valid}</div>
    <p>Кому: ${esc(deal.company)}, ${esc(deal.contact)}</p>
    <table><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Цена, ₽</th><th>Скидка, %</th><th>Сумма, ₽</th></tr></thead><tbody>${rows}</tbody></table>
    <p><b>Итого: ${money(net)} ₽</b>, в т. ч. НДС ${VAT_RATE}% ${money(vatOf(net))} ₽</p>
    <p class="muted">Шаблон условный: реквизиты, условия оплаты и поставки берутся из шаблона компании.</p>`;
}

// события
$('deal').innerHTML = DEALS.map(d => `<option value="${d.id}">#${d.id} ${esc(d.title)}</option>`).join('');
$('cat').innerHTML += Object.entries(CATEGORY_NAMES).map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
$('deal').onchange = e => loadDeal(+e.target.value);
$('q').oninput = e => { state.q = e.target.value; state.page = 0; renderCatalog(); };
$('cat').onchange = e => { state.cat = e.target.value; state.page = 0; renderCatalog(); };
$('prev').onclick = () => { state.page--; renderCatalog(); };
$('next').onclick = () => { state.page++; renderCatalog(); };
$('catalog').onclick = e => { const s = e.target.dataset.add; if (s) { addItem(s); renderLines(); } };
$('lines').onclick = e => { const i = e.target.dataset.del; if (i != null) { state.lines.splice(+i, 1); renderLines(); } };
$('lines').oninput = e => {
  const t = e.target, v = t.value === '' ? NaN : Number(t.value);
  if (t.dataset.qty != null) state.lines[+t.dataset.qty].qty = v;
  else if (t.dataset.disc != null) state.lines[+t.dataset.disc].discount = v;
  else return;
  renderSummary();
};
$('bulkAdd').onclick = () => {
  const missing = [], badQty = [];
  let added = 0;
  for (const raw of $('bulkText').value.split('\n')) {
    const [sku, q] = raw.trim().split(/[\s\t,;]+/);
    if (!sku) continue;
    const qty = q == null ? 1 : Number(q.replace(',', '.'));
    if (!Number.isFinite(qty)) { badQty.push(raw.trim()); continue; }
    // неверное количество (0,5, -3) добавляем как есть — его подсветят проверки
    if (addItem(sku.toUpperCase(), qty)) added++; else missing.push(sku);
  }
  $('bulkResult').textContent = `Добавлено: ${added}`
    + (missing.length ? `. Не найдено в PIM: ${missing.join(', ')}` : '')
    + (badQty.length ? `. Не понял количество: ${badQty.join('; ')}` : '');
  renderLines();
};
$('preview').onclick = () => { $('docBody').innerHTML = kpHtml(); $('doc').showModal(); $('doc').scrollTop = 0; $('closeDoc').focus(); };
$('print').onclick = () => window.print();
$('closeDoc').onclick = () => $('doc').close();
$('clear').onclick = () => { if (state.lines.length && confirm('Удалить все позиции из КП?')) { state.lines = []; renderLines(); } };
$('attach').onclick = () => {
  // Демо: что ушло бы в Битрикс24. Метод и поля — допущение, уточнить на реальном портале.
  const payload = {
    method: 'crm.deal.productrows.set',
    id: state.dealId,
    rows: state.lines.map(l => { const p = bySku.get(l.sku); return { PRODUCT_NAME: p.name, PRICE: p.price, QUANTITY: l.qty, DISCOUNT_TYPE_ID: 2, DISCOUNT_RATE: l.discount }; }),
    file: `КП-${state.dealId}-${state.version}.pdf → прикрепить к сделке (способ уточнить)`,
  };
  $('attachLog').hidden = false;
  $('attachLog').textContent = 'Демо, в Битрикс24 ничего не отправлено. Запрос был бы таким:\n' + JSON.stringify(payload, null, 2);
  state.version++;
  renderSummary();
};

loadDeal(state.dealId);
