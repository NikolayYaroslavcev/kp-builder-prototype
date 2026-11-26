"""Проверка прототипа в браузере: python -m http.server 8765 (в папке прототипа), затем python tests/smoke.py"""
import os, sys, tempfile
from playwright.sync_api import sync_playwright

URL = os.environ.get('URL', 'http://localhost:8765/')
fails = []
def check(name, ok, info=''):
    print(('OK  ' if ok else 'FAIL'), name, info)
    if not ok: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(URL)
    pg.evaluate('localStorage.clear()'); pg.reload()

    check('каталог 118 товаров, 8 страниц', '1 / 8 · найдено 118' in pg.inner_text('#pageInfo'))
    pg.fill('#q', 'компрессор')
    check('поиск', 'найдено 13' in pg.inner_text('#pageInfo'))
    pg.fill('#q', ''); pg.click('#next')
    check('страницы', pg.inner_text('#pageInfo').startswith('2 / 8'))

    # приёмка 1: вставка списка с дублем и ненайденным артикулом; «;» как разделитель полей
    pg.click('text=Вставить список')
    pg.fill('#bulkText', 'LIFT-0001;2\nCOMP-0048\nCOMP-0048\nXXX-1\nACC-0092 2шт')
    pg.click('#bulkAdd')
    res = pg.inner_text('#bulkResult')
    check('вставка: ненайденный и непонятное количество', 'Не найдено в PIM: XXX-1' in res and 'Не понял количество: ACC-0092 2шт' in res, res)
    check('вставка: две строки', pg.locator('#lines tr').count() == 2)
    qtys = pg.locator('input[data-qty]').evaluate_all('els => els.map(e => e.value)')
    check('вставка: LIFT×2, COMP×2', qtys == ['2', '2'], str(qtys))

    # фокус не теряется при вводе и Tab
    q0 = pg.locator('input[data-qty]').first
    q0.fill('3'); pg.keyboard.press('Tab')
    check('фокус после Tab на поле скидки', pg.evaluate('document.activeElement.dataset.disc') == '0')

    # приёмка 3: скидка выше лимита — предупреждение, 100% — ошибка
    d0 = pg.locator('input[data-disc]').first
    d0.fill('15')
    check('скидка 15% — предупреждение, КП доступно', 'выше лимита' in pg.inner_text('#checks') and not pg.is_disabled('#preview'))
    d0.fill('99.5')
    check('скидка 99,5% — ошибка', 'вне диапазона' in pg.inner_text('#checks') and pg.is_disabled('#preview'))
    q0.fill('0.5')
    check('количество 0,5 — ошибка', 'целым числом' in pg.inner_text('#checks'))

    # приёмка 4: 459 600 × 2, скидка 5% (LIFT-0001 — первая строка)
    q0.fill('2'); d0.fill('5'); pg.locator('#lines tr').nth(1).locator('button[data-del]').click()
    sums = pg.inner_text('#totals').replace(chr(0xA0), ' ')
    check('сумма 873 240,00 и НДС 22% 157 469,51', '873 240,00' in sums and '157 469,51' in sums, sums)

    # приёмка 2: товар без цены блокирует КП
    pg.fill('#q', 'TIRE-0027'); pg.click('#catalog button[data-add]')
    check('без цены — КП недоступно', pg.is_disabled('#preview'))
    pg.locator('#lines tr').nth(1).locator('button[data-del]').click()
    check('после удаления — доступно', not pg.is_disabled('#preview'))

    # длинное КП печатается целиком
    pg.fill('#q', 'ACC-')
    for _ in range(3):
        for btn in pg.locator('#catalog button[data-add]').all(): btn.click()
        if pg.is_disabled('#next'): break
        pg.click('#next')
    pg.evaluate("document.querySelectorAll('#lines tr.bad button[data-del]').forEach(b => b.click())")
    pg.evaluate("for (let i = 0; i < 20; i++) { const b = document.querySelector('#lines tr.bad button[data-del]'); if (!b) break; b.click(); }")
    n = pg.locator('#lines tr').count()
    pg.click('#preview'); pg.emulate_media(media='print')
    pdf = os.path.join(tempfile.gettempdir(), 'kp-smoke.pdf'); pg.pdf(path=pdf, format='A4')
    try:
        import pymupdf
        text = ''.join(pg_.get_text() for pg_ in pymupdf.open(pdf))
        check(f'печать {n} позиций: заголовок и итог в PDF', 'Коммерческое предложение' in text and 'Итого' in text and f'\n{n}\n' in text)
    except ImportError:
        print('pymupdf не установлен — PDF не проверен')
    pg.emulate_media(media='screen'); pg.click('#closeDoc')

    # черновик переживает перезагрузку, битый черновик не ломает страницу
    pg.reload()
    check('черновик после перезагрузки', pg.locator('#lines tr').count() == n)
    pg.evaluate("localStorage.setItem('kp-draft-1042', JSON.stringify({lines:[{sku:'NOPE',qty:1}], version:2}))"); pg.reload()
    check('битый черновик', pg.locator('#lines tr').count() == 1 and 'нет товаров' in pg.inner_text('#checks'))

    check('нет ошибок в консоли', not errors, str(errors))
    b.close()

sys.exit(1 if fails else 0)
