// Условные данные: товары и цены выдуманы, структура PIM и Битрикс24 — допущение.
// В рабочей версии сюда придут ответы API PIM и Битрикс24.

const CATEGORIES = [
  { id: 'lift', name: 'Подъёмники', items: ['Подъёмник двухстоечный 4 т', 'Подъёмник двухстоечный 5 т', 'Подъёмник ножничный 3,5 т', 'Подъёмник четырёхстоечный 4 т', 'Подъёмник подкатной 2,5 т'], base: 310000 },
  { id: 'tire', name: 'Шиномонтажные станки', items: ['Шиномонтажный станок полуавтомат 10–24"', 'Шиномонтажный станок автомат 12–26"', 'Шиномонтажный станок для грузовых 14–46"', 'Шиномонтажный станок с третьей рукой'], base: 145000 },
  { id: 'bal', name: 'Балансировочные станки', items: ['Балансировочный станок легковой', 'Балансировочный станок с автовводом', 'Балансировочный станок грузовой', 'Балансировочный станок с лазерным указателем'], base: 120000 },
  { id: 'comp', name: 'Компрессоры', items: ['Компрессор поршневой 270 л', 'Компрессор поршневой 500 л', 'Компрессор винтовой 7,5 кВт', 'Компрессор винтовой 11 кВт'], base: 95000 },
  { id: 'align', name: 'Стенды развал-схождения', items: ['Стенд развал-схождения 3D', 'Стенд развал-схождения 3D мобильный', 'Стенд развал-схождения CCD'], base: 690000 },
  { id: 'diag', name: 'Диагностика', items: ['Сканер мультимарочный', 'Тестер аккумуляторов', 'Газоанализатор', 'Эндоскоп технический', 'Стенд проверки форсунок'], base: 48000 },
  { id: 'acc', name: 'Комплектующие и расходники', items: ['Комплект адаптеров для подъёмника', 'Резиновые накладки (4 шт.)', 'Конус центровочный', 'Защитные накладки на лапы', 'Шланг пневматический 10 м', 'Блок подготовки воздуха', 'Груз балансировочный (уп.)'], base: 3500 },
];
const BRANDS = ['Техмаш', 'АвтоЛифт', 'Сервис-Про', 'Гаражник', 'NordTool'];

function rnd(seed) { // детерминированный генератор, чтобы данные не менялись между загрузками
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const PRODUCTS = (() => {
  const r = rnd(42), list = [];
  let n = 1;
  for (const c of CATEGORIES) {
    for (const name of c.items) {
      for (const brand of BRANDS) {
        if (r() < 0.25) continue;
        const sku = `${c.id.toUpperCase()}-${String(n++).padStart(4, '0')}`;
        const price = Math.round((c.base * (0.6 + r() * 1.2)) / 100) * 100;
        const roll = r();
        const daysAgo = Math.floor(r() * 200);
        list.push({
          sku, name: `${name} ${brand}`, brand, category: c.id,
          price: roll < 0.04 ? null : price,               // нет цены в PIM
          status: roll > 0.95 ? 'archived' : 'active',     // снят с продажи
          priceUpdatedAt: new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10),
        });
      }
    }
  }
  return list;
})();

export const CATEGORY_NAMES = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]));

export const DEALS = [
  { id: 1042, title: 'Оснащение нового бокса', company: 'ООО «Автоцентр Север»', contact: 'Иван Петров', email: 'petrov@example.ru' },
  { id: 1043, title: 'Шиномонтаж под сезон', company: 'ИП Сафонов А. В.', contact: 'Алексей Сафонов', email: 'safonov@example.ru' },
  { id: 1047, title: 'Замена компрессора', company: 'ООО «ТрансСервис»', contact: 'Марина Клюева', email: 'kluyeva@example.ru' },
  { id: 1051, title: 'Развал-схождение, 2 поста', company: 'ООО «Мастер Колёс»', contact: 'Олег Дьяков', email: 'dyakov@example.ru' },
  { id: 1055, title: 'Диагностический пост', company: 'АО «ГорАвтоТранс»', contact: 'Сергей Лаптев', email: 'laptev@example.ru' },
  { id: 1058, title: 'СТО под ключ', company: 'ООО «Дорожник»', contact: 'Елена Гусева', email: 'guseva@example.ru' },
];

export const MANAGER = { name: 'Менеджер (демо)', maxDiscount: 10 }; // лимит скидки — допущение
export const PRICE_MAX_AGE_DAYS = 90; // цена старше — предупреждение (допущение)
