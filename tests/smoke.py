"""Проверка прототипа в браузере (Playwright).
Запуск: python -m http.server 8780 в папке прототипа, затем python tests/smoke.py
Другой адрес: URL=https://... python tests/smoke.py"""
import os, sys, tempfile
from playwright.sync_api import sync_playwright

URL = os.environ.get('URL', 'http://localhost:8780/')
fails = []


def check(name, ok, info=''):
    print(('OK  ' if ok else 'FAIL'), name, '' if ok else info)
    if not ok:
        fails.append(name)


def text(pg, sel):
    return pg.inner_text(sel).replace(chr(0xA0), ' ').replace(chr(0x202F), ' ')


def add(pg, query):
    pg.fill('#add', query)
    pg.wait_for_selector('#suggest li[data-sug]')
    pg.keyboard.press('Enter')


def qtys(pg):
    return pg.locator('input[data-qty]').evaluate_all('els => els.map(e => e.value)')


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('dialog', lambda d: d.accept())
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(URL)
    pg.evaluate('localStorage.clear()')
    pg.reload()
    pg.wait_for_timeout(500)

    # пустое КП
    check('пустое КП: подсказка, нет плашки PIM и итогов',
          pg.is_visible('#empty') and not pg.is_visible('#pimBanner') and not pg.is_visible('#totals'))
    check('пустое КП: кнопки неактивны', pg.is_disabled('#preview') and pg.is_disabled('#save'))

    # строка добавления
    pg.keyboard.press('/')
    check('«/» ставит фокус в строку добавления', pg.evaluate('document.activeElement.id') == 'add')
    add(pg, 'LIFT-0001')
    add(pg, 'COMP-0048')
    add(pg, 'COMP-0048')
    check('приёмка 1: дубль суммирует количество', qtys(pg) == ['1', '2'], str(qtys(pg)))

    # быстрый ввод: Enter сразу после ввода добавляет именно введённый артикул
    pg.fill('#add', 'COMP')
    pg.wait_for_selector('#suggest li[data-sug]')
    pg.fill('#add', 'LIFT-0005')
    pg.keyboard.press('Enter')
    pg.wait_for_function("document.querySelectorAll('#lines tr').length === 3")
    check('быстрый Enter добавляет введённый артикул, а не из прошлого поиска', 'LIFT-0005' in pg.inner_text('#lines'))
    pg.locator('[data-del="2"]').click()
    pg.wait_for_selector('#toast', state='hidden', timeout=8000)

    # фокус не теряется при вводе и Tab
    pg.locator('input[data-qty]').first.fill('2')
    pg.keyboard.press('Tab')
    check('Tab из количества переходит в скидку', pg.evaluate('document.activeElement.dataset.disc') == '0')

    # приёмка 4: 459 600 × 2, скидка 5%
    pg.locator('input[data-disc]').first.fill('5')
    pg.locator('[data-del="1"]').click()
    t = text(pg, '#totals')
    check('приёмка 4: 873 240,00 и НДС 22% 157 469,51', '873 240,00' in t and '157 469,51' in t, t)

    # отмена удаления
    check('удаление предлагает «Вернуть»', pg.is_visible('#toastAction') and 'Вернуть' in pg.inner_text('#toastAction'))
    pg.click('#toastAction')
    check('«Вернуть» возвращает позицию', pg.locator('#lines tr').count() == 2)
    pg.locator('[data-del="1"]').click()                     # убрали COMP-0048 ×2
    add(pg, 'COMP-0048')                                     # добавили снова ×1
    pg.locator('[data-del="1"]').click()                     # убрали ×1, в тосте его «Вернуть»
    add(pg, 'COMP-0048')
    pg.click('#toastAction') if pg.is_visible('#toastAction') else None
    check('«Вернуть» после повторного добавления сливает количество, без дубля',
          pg.locator('#lines tr').count() == 2, str(qtys(pg)))
    pg.locator('[data-del="1"]').click()
    pg.select_option('#deal', '1043')
    check('при смене сделки «Вернуть» исчезает', not pg.is_visible('#toast'))
    pg.select_option('#deal', '1042')
    add(pg, 'ACC-0092')
    add(pg, 'ACC-0093')
    n0 = pg.locator('#lines tr').count()
    pg.locator('[data-del="1"]').click()
    pg.locator('[data-del="1"]').click()
    check('два удаления подряд: тост про обе позиции', 'Убрано позиций: 2' in pg.inner_text('#toast'))
    pg.click('#toastAction')
    check('«Вернуть» возвращает обе', pg.locator('#lines tr').count() == n0)
    pg.locator('[data-del="2"]').click()
    pg.locator('[data-del="1"]').click()
    pg.select_option('#deal', '1043')
    pg.select_option('#deal', '1042')

    # приёмка 3 и неверные значения не попадают в итог
    d0, q0 = pg.locator('input[data-disc]').first, pg.locator('input[data-qty]').first
    d0.fill('15')
    check('скидка 15%: предупреждение, предпросмотр доступен', 'выше лимита' in pg.inner_text('#lines') and not pg.is_disabled('#preview'))
    check('скидка 15%: сохранение ждёт согласования', pg.is_visible('#discountOk') and pg.is_disabled('#save'))
    pg.check('#discountOkBox')
    check('после отметки «согласована» сохранение доступно', not pg.is_disabled('#save'))
    d0.fill('120')
    check('скидка 120%: ошибка, КП недоступно', 'от 0 до 99' in pg.inner_text('#lines') and pg.is_disabled('#preview'))
    check('скидка 120%: строка не входит в итог (нет отрицательной суммы)',
          '—' in text(pg, '[data-sum="0"]') and 'Не учтено в итоге' in pg.inner_text('#totals') and '−' not in text(pg, '#totals').replace('Скидка', ''), text(pg, '#totals'))
    d0.fill('5')
    q0.fill('0.5')
    check('количество 0,5: ошибка, не в итоге', 'целое число' in pg.inner_text('#lines') and pg.is_disabled('#preview') and 'Не учтено' in pg.inner_text('#totals'))
    red = lambda loc: loc.get_attribute('aria-invalid') == 'true' and loc.evaluate("e => getComputedStyle(e).borderTopColor === getComputedStyle(document.querySelector('.issue.err')).color")
    check('количество 0,5: поле красное, в фокусе тоже', red(q0) and q0.evaluate('e => e === document.activeElement'))
    for bad in ('1e3', '0x10', '100000', '-1', 'абв'):
        q0.fill(bad)
        check(f'количество «{bad}»: ошибка, поле красное', 'целое число' in pg.inner_text('#lines') and red(q0) and pg.is_disabled('#preview'))
    q0.fill('2')
    check('исправленное количество: поле снова обычное', q0.get_attribute('aria-invalid') == 'false')
    d0.fill('15')
    check('скидка выше лимита: у поля рамка замечания', 'warn' in (d0.get_attribute('class') or '') and d0.get_attribute('aria-invalid') == 'false')
    d0.fill('1e1')
    check('скидка «1e1»: ошибка, поле красное', 'от 0 до 99' in pg.inner_text('#lines') and red(d0))
    d0.fill('5')

    # приёмка 2: товар без цены блокирует, есть «Найти замену»
    add(pg, 'TIRE-0027')
    check('без цены: КП недоступно, предложена замена', 'Нет цены' in pg.inner_text('#lines') and pg.is_disabled('#preview') and pg.is_visible('[data-replace]'))
    pg.locator('input[data-qty]').nth(1).fill('3')
    pg.click('[data-replace]')
    pg.wait_for_selector('#suggest li[data-sug]')
    check('«Найти замену» ищет аналоги без самого товара',
          pg.locator('#suggest li[data-sug]').count() > 1 and 'TIRE-0027' not in ' '.join(pg.locator('#suggest li[data-sug]').all_inner_texts()))
    pg.locator('#suggest li[data-sug]').first.click()
    check('замена встаёт на место строки с её количеством',
          pg.locator('#lines tr').count() == 2 and 'TIRE-0027' not in pg.inner_text('#lines') and qtys(pg)[1] == '3', str(qtys(pg)))
    pg.locator('[data-del="1"]').click()
    check('после удаления: КП доступно', not pg.is_disabled('#preview'))

    # Enter до ответа PIM: неоднозначный запрос ничего не добавляет, смена сделки отменяет добавление
    pg.fill('#add', 'компрессор')
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(600)
    check('Enter по неоднозначному запросу не добавляет товар вслепую', pg.locator('#lines tr').count() == 1)
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape')
    pg.fill('#add', 'ACC-0099')
    pg.keyboard.press('Enter')
    pg.select_option('#deal', '1043')
    pg.wait_for_timeout(600)
    check('Enter перед сменой сделки не добавляет товар в другую сделку', pg.is_visible('#empty'))
    pg.select_option('#deal', '1042')
    check('в исходной сделке тоже без лишней строки', pg.locator('#lines tr').count() == 1)

    # перепечатывание количества: пустое поле не превращает строку в ошибку
    q = pg.locator('input[data-qty]').first
    q.fill('')
    check('пустое поле количества во время ввода не даёт ошибку', 'целое число' not in pg.inner_text('#lines'))
    q.fill('2')

    # вставка списка: единицы, «x», точка с запятой, неверные количества не добавляются
    pg.click('#openBulk')
    pg.fill('#bulkText', 'COMP-0048 2 шт\nACC-0092 x2\nACC-0093;3;шт\nFOO 1\nACC-0094 0\nACC-0095 1,5\nACC-0097 -3\nBAL-0040')
    pg.click('#bulkParse')
    pg.wait_for_selector('#bulkPreview table')
    pv = pg.inner_text('#bulkPreview')
    check('список: «2 шт», «x2», «;3;шт» распознаны', pv.count('добавится') >= 3, pv)
    check('список: 0, 1,5 и -3 не распознаны', pv.count('количество не распознано') == 3, pv)
    check('список: неизвестный артикул', 'нет в PIM' in pv)
    pg.click('#bulkAdd')
    check('список: добавлены только распознанные строки', pg.locator('#lines tr').count() == 5, str(qtys(pg)))

    pg.click('#openBulk')
    pg.fill('#bulkText', 'LIFT-0002 1')
    pg.click('#bulkParse')
    pg.fill('#bulkText', 'LIFT-0003 2')
    pg.wait_for_timeout(600)
    check('список: ответ на старый текст отбрасывается', pg.is_disabled('#bulkAdd') and 'LIFT-0002' not in pg.inner_text('#bulkPreview'))
    pg.fill('#bulkText', 'LIFT-0004 2x\nLIFT-0006 2 комплекта\nLIFT-0007 - 2')
    pg.click('#bulkParse')
    pg.wait_for_selector('#bulkPreview table')
    check('список: «2x», «2 комплекта», «- 2» распознаны', pg.inner_text('#bulkPreview').count('добавится') == 3, pg.inner_text('#bulkPreview'))
    pg.keyboard.press('Escape')

    # смена цены в PIM: блок до подтверждения, «Принять все»
    pg.click('summary:has-text("Демо")')
    pg.click('#demoPrices')
    pg.wait_for_selector('[data-accept]')
    check('смена цены: КП недоступно до подтверждения', pg.is_disabled('#preview'))
    pg.click('#acceptAll')
    price = text(pg, '#lines tr:first-child td:nth-child(4)').strip()
    check('«Принять все новые цены»: в строке новая цена 480 300,00', price == '480 300,00', price)

    # приёмка 5: PIM не отвечает
    pg.check('#demoOffline')
    pg.wait_for_selector('#pimBanner:not([hidden])')
    check('PIM недоступен: плашка сразу, строки на месте, КП недоступно',
          pg.locator('#lines tr').count() == 5 and pg.is_disabled('#preview'))
    pg.uncheck('#demoOffline')
    pg.wait_for_selector('#pimBanner', state='hidden')
    check('PIM снова доступен: плашка ушла', not pg.is_visible('#pimBanner'))

    # сохранение и версии
    pg.evaluate("for (let i = 0; i < 9; i++) { const b = document.querySelector('#lines tr.bad [data-del]'); if (!b) break; b.click(); }")
    if pg.is_visible('#discountOk'):
        pg.check('#discountOkBox')
    pg.click('#save')
    check('сохранение: версия КП-1042-1, черновик стал КП-1042-2',
          'КП-1042-1' in pg.inner_text('#versions') and 'КП-1042-2' in pg.inner_text('#kpNo'))
    pg.click('#save')
    check('повторное сохранение без изменений не создаёт версию', pg.locator('#versions li').count() == 1)

    # предпросмотр: черновик без номера, закрытие
    is_open = lambda: pg.evaluate("document.getElementById('doc').open")
    pg.click('#preview')
    check('предпросмотр помечен как черновик', 'Черновик' in pg.inner_text('#docBody') and 'КП-1042-2' not in pg.inner_text('#docBody'))
    box = pg.locator('#doc').bounding_box()
    pg.mouse.click(box['x'] + 10, box['y'] + 10)
    check('клик внутри окна не закрывает', is_open())
    pg.mouse.click(5, 5)
    check('клик мимо окна закрывает', not is_open())
    pg.click('#preview'); pg.click('#doc .dlg-x')
    check('крестик закрывает', not is_open())
    pg.click('#preview'); pg.keyboard.press('Escape')
    check('Esc закрывает', not is_open())
    pg.click('[data-open-version="0"]')
    check('сохранённая версия открывается с номером', 'КП-1042-1' in pg.inner_text('#docBody'))
    pg.keyboard.press('Escape')

    # каталог: Esc закрывает с первого раза, «+» не сбрасывает прокрутку
    pg.click('#openCatalog')
    pg.fill('#cq', 'накладки')
    pg.wait_for_timeout(500)
    pg.keyboard.press('Escape')
    check('каталог: Esc из поиска закрывает', not pg.evaluate("document.getElementById('catalog').open"))
    pg.click('#openCatalog')
    pg.fill('#cq', '')
    pg.select_option('#ccat', 'acc')
    pg.wait_for_timeout(400)
    for _ in range(3):
        pg.wait_for_selector('#cbody [data-cadd]')
        for k in range(pg.locator('#cbody [data-cadd]').count()):
            pg.locator('#cbody [data-cadd]').nth(k).click()
        if pg.is_disabled('#cnext'):
            break
        pg.click('#cnext')
        pg.wait_for_timeout(400)
    pg.select_option('#ccat', '')
    pg.wait_for_selector('#cbody [data-cadd]')
    for _ in range(15):
        if not pg.is_disabled('#cnext'):
            pg.click('#cnext')
    pg.wait_for_timeout(800)
    info = pg.inner_text('#cinfo')
    page_no = int(info.split()[0]) if info[:1].isdigit() else 99
    check('каталог: быстрые клики по страницам не уходят за последнюю', 1 <= page_no <= 10 and 'найдено 118' in info, info)
    pg.select_option('#ccat', 'acc')
    pg.wait_for_selector('#cbody [data-cadd]')
    pg.locator('#cbody [data-cadd]').first.click()
    check('каталог: после «+» фокус остаётся на кнопке', pg.evaluate("document.activeElement.dataset.cadd != null"))
    pg.keyboard.press('Escape')

    # печать длинного КП целиком
    pg.evaluate("for (let i = 0; i < 40; i++) { const b = document.querySelector('#lines tr.bad [data-del]'); if (!b) break; b.click(); }")
    if pg.is_visible('#discountOk'):
        pg.check('#discountOkBox')
    n = pg.locator('#lines tr').count()
    pg.click('#save')
    pg.click('[data-open-version="1"]')
    pg.evaluate('window.print = () => {}')
    pg.click('#print')
    pg.emulate_media(media='print')
    pdf = os.path.join(tempfile.gettempdir(), 'kp-smoke.pdf')
    pg.pdf(path=pdf, format='A4')
    pg.emulate_media(media='screen')
    pg.keyboard.press('Escape')
    try:
        import pymupdf
        t = ''.join(x.get_text() for x in pymupdf.open(pdf))
        check(f'печать {n} позиций: шапка, первая и последняя строка, итог, без служебных подсказок',
              n > 20 and 'Коммерческое предложение' in t and 'LIFT-0001' in t and f'\n{n}\n' in t and 'Итого' in t and 'шаблона компании' not in t, t[:300])
    except ImportError:
        print('pymupdf не установлен, PDF не проверен')

    pg.evaluate('''async () => { const m = await import('./pim.js'); const orig = m.pim.getMany;
        m.pim.getMany = async skus => { const r = await orig(skus); if (r['LIFT-0001']) r['LIFT-0001'] = { ...r['LIFT-0001'], price: null }; return r; }; }''')
    pg.check('#demoOffline')
    pg.uncheck('#demoOffline')
    pg.wait_for_timeout(700)
    check('PIM убрал цену у строки: ошибка «нет цены», интерфейс работает',
          'Нет цены' in pg.inner_text('#lines') and pg.is_disabled('#preview'), pg.inner_text('#lines')[:200])
    pg.reload()
    pg.wait_for_timeout(700)

    # перезагрузка: данные на месте, время сохранения не меняется
    stamp = pg.evaluate("JSON.parse(localStorage.getItem('kp-v2-1042')).savedAt")
    pg.reload()
    pg.wait_for_timeout(700)
    check('после перезагрузки: строки и версии на месте', pg.locator('#lines tr').count() == n and 'КП-1042-2' in pg.inner_text('#versions'))
    check('перезагрузка не переписывает время сохранения', pg.evaluate("JSON.parse(localStorage.getItem('kp-v2-1042')).savedAt") == stamp)
    pg.evaluate("localStorage.setItem('kp-v2-1043', '{\"lines\": 5}')")
    pg.select_option('#deal', '1043')
    check('битый черновик: пустое КП без ошибок', pg.is_visible('#empty'))
    pg.reload()
    pg.wait_for_timeout(500)
    check('выбранная сделка запоминается', pg.input_value('#deal') == '1043')
    check('пустые сделки не записываются в хранилище', pg.evaluate("localStorage.getItem('kp-v2-1047')") is None)
    check('нет ошибок в консоли', not errors, str(errors))

    # телефон с позициями в КП: без горизонтального сдвига, окна в пределах экрана
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    m = ctx.new_page()
    m.goto(URL)
    m.evaluate('localStorage.clear()')
    m.reload()
    m.wait_for_timeout(400)
    for q in ('LIFT-0001', 'COMP-0048', 'ACC-0092'):
        add(m, q)
    m.wait_for_timeout(300)
    check('телефон: ширина страницы не больше экрана', m.evaluate('document.documentElement.scrollWidth') <= 390,
          str(m.evaluate('document.documentElement.scrollWidth')))
    m.click('#preview')
    box = m.locator('#doc').bounding_box()
    check('телефон: предпросмотр в пределах экрана', box['x'] >= 0 and box['x'] + box['width'] <= 390, str(box))
    fits = lambda sel: m.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); return e.scrollWidth <= e.clientWidth + 1; }})()")
    check('телефон: лист КП не сдвигается вбок, таблица листается сама', fits('#doc') and not fits('#doc .doc-scroll'))
    y = m.evaluate('scrollY'); m.mouse.wheel(0, 600); m.wait_for_timeout(200)
    check('телефон: страница под открытым окном не листается', m.evaluate('getComputedStyle(document.documentElement).overflow') == 'hidden' and m.evaluate('scrollY') == y)
    m.keyboard.press('Escape')
    m.click('#openCatalog')
    m.wait_for_selector('#cbody [data-cadd]')
    box = m.locator('#catalog').bounding_box()
    check('телефон: каталог на всю ширину, ничего не обрезано', box['x'] >= 0 and box['x'] + box['width'] <= 391 and fits('#cbody'), str(box))
    m.keyboard.press('Escape')
    m.click('#openBulk')
    m.fill('#bulkText', 'LIFT-0001 2\nFOO\nTIRE-0017 1')
    m.click('#bulkParse')
    m.wait_for_selector('#bulkPreview table')
    check('телефон: окно вставки списка без обрезки', fits('#bulk .dlg-body'))
    b.close()

print(f'\nИтого: {"ошибок нет" if not fails else str(len(fails)) + " FAIL"}')
sys.exit(1 if fails else 0)
