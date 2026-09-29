"""Browser checks for playback rates and portable CSV review chapters.

Uses the same Python Playwright, Chrome and server setup as browser-smoke.py.
"""
import csv
import io
import json
import os
import wave
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('WL_TEST_URL', 'http://localhost:8000')
CHROME = os.environ.get('WL_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
HEADER = ['章节', '正确答案', '我的答案', '释义', '音标', '错误次数', '最近练习', '状态']


def csv_bytes(rows):
    output = io.StringIO(newline='')
    csv.writer(output).writerows([HEADER, *rows])
    return output.getvalue().encode('utf-8-sig')


def upload(page, data, name='错题.csv'):
    page.locator('#csv-file').set_input_files({'name': name, 'mimeType': 'text/csv', 'buffer': data})
    page.locator('#csv-import-btn').click()
    page.wait_for_function('!csvImportBusy')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    context.route('https://raw.githubusercontent.com/**', lambda route: route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(BASE)
    page.wait_for_function('Object.keys(VOCAB).length===74')

    # Both new rates reach the media player and speech API.
    page.evaluate("startDict('3.3-1')")
    for rate in ['1.4', '1.6']:
        page.locator('#audio-rate').select_option(rate)
        assert page.locator('#chapter-audio').evaluate('(el)=>el.playbackRate') == float(rate)
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b'\x00\x00' * 800)
    page.locator('#audio-mode').select_option('local')
    page.locator('#local-audio').set_input_files({'name': 'silence.wav', 'mimeType': 'audio/wav', 'buffer': audio.getvalue()})
    page.wait_for_function("document.getElementById('chapter-audio').readyState>=1")
    for rate in ['1.4', '1.6']:
        page.locator('#audio-rate').select_option(rate)
        assert page.locator('#chapter-audio').evaluate('(el)=>el.playbackRate') == float(rate)
    page.locator('#audio-mode').select_option('speech')
    page.evaluate('window.spoken=[]; speechSynthesis.speak=u=>spoken.push({text:u.text,rate:u.rate}); speechSynthesis.cancel=()=>{}')
    for rate in ['1.4', '1.6']:
        page.locator('#audio-rate').select_option(rate)
        page.get_by_role('button', name='重听第 1 题', exact=True).click()
        assert abs(page.evaluate('spoken.at(-1).rate') - float(rate)) < 0.0001

    # Export actual session mistakes, then import their downloaded bytes.
    page.evaluate("startDict('4.4'); finishDict()")
    with page.expect_download() as downloaded:
        page.get_by_role('button', name='导出本次错题').click()
    exported = Path(downloaded.value.path()).read_bytes()
    before_wb = page.evaluate('getWb()')
    page.locator('#tab-import').click()
    page.locator('#csv-name').fill('本周复习 <img src=x>')
    upload(page, exported)
    assert '新增 12 词' in page.locator('#csv-result').inner_text()
    custom_id = page.locator('#csv-target').input_value()
    assert page.evaluate('getWb()') == before_wb
    upload(page, exported)
    assert '新增 0 词' in page.locator('#csv-result').inner_text()
    assert len(page.evaluate('getStore().customChapters')) == 1
    page.locator('#csv-result').get_by_role('button', name='开始听写').click()
    assert page.locator('#audio-mode').input_value() == 'speech'
    assert page.locator('.row-input').count() == 12
    assert page.locator('#inp-0').input_value() == ''
    page.locator('#inp-0').fill('almost')
    page.reload()
    page.wait_for_function('Object.keys(VOCAB).length===75')
    assert page.locator('#home-body img').count() == 0
    assert '本周复习 <img src=x>' in page.locator('#home-body').inner_text()
    page.get_by_role('button', name='继续上次未完成的听写').click()
    assert page.locator('#inp-0').input_value() == 'almost'
    page.evaluate('curWords.forEach((w,i)=>document.getElementById("inp-"+i).value=w.w)')
    page.locator('#btn-finish').click()
    assert page.locator('#r-pct').inner_text() == '100%'
    assert len(page.evaluate('getStore().hist')[custom_id]) == 1
    assert page.evaluate('Object.values(getWb()).every(w=>w.mastered)')

    # Quoted fields, formula escaping, duplicate origins, dates and numbers.
    page.locator('#tab-import').click()
    page.locator('#csv-target').select_option('')
    page.locator('#csv-name').fill('')
    date = '2026-09-26T00:00:00.000Z'
    numeric = page.evaluate("CORPUS.chapters.flatMap(c=>c.words.map(w=>({...w,chap:c.id}))).find(w=>w.kind==='number'&&w.w.includes(' '))")
    dated = page.evaluate("CORPUS.chapters.flatMap(c=>c.words.map(w=>({...w,chap:c.id}))).find(w=>w.kind==='date')")
    rows = [
        ['constructor', 'a,"b"', '<img src=x onerror=alert(1)>', '含逗号,引号"\r\n换行', '/a/', 3, date, '待复习'],
        ['constructor', 'a,"b"', 'duplicate', '', '', 3, date, '待复习'],
        ['__proto__', 'a,"b"', '', '', '', 2, date, '已掌握'],
        ['未知章节', "'-12", "'=1+1", '', '', 1, date, '待复习'],
        [numeric['chap'], numeric['w'], 'wrong', '', '', 2, date, '待复习'],
        [dated['chap'], dated['w'], 'wrong date', '', '', 1, date, '待复习'],
    ]
    upload(page, csv_bytes(rows), '特殊错题.csv')
    assert '新增 5 词' in page.locator('#csv-result').inner_text()
    special_id = page.locator('#csv-target').input_value()
    chapter = page.evaluate('getStore().customChapters')[special_id]
    assert chapter['name'] == '特殊错题'
    assert chapter['words'][0]['m'] == rows[0][3]
    assert chapter['words'][2]['w'] == '-12'
    assert chapter['words'][2]['typed'] == '=1+1'
    assert chapter['words'][3]['kind'] == 'number'
    assert chapter['words'][4]['kind'] == 'date'
    assert page.evaluate('getWb()[\'constructor::a,"b"\'].n') == 3

    # Malformed input is atomic, including failures after valid rows.
    baseline = page.evaluate('localStorage.getItem("wl4_state")')
    for invalid in [b'', b'wrong,header\r\nx,y', csv_bytes(rows) + b'"unterminated', csv_bytes([rows[0], ['broken']])]:
        upload(page, invalid)
        assert '导入失败' in page.locator('#csv-result').inner_text()
        assert page.evaluate('localStorage.getItem("wl4_state")') == baseline

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth<=390')
    page.screenshot(path='/tmp/wanglu-csv-import.png', full_page=True)
    page.locator('#tab-wb').click()
    assert page.locator('#wb-body img').count() == 0

    # Full JSON backup transports custom chapters AND their practice history.
    page.locator('#tab-import').click()
    with page.expect_download() as downloaded:
        page.get_by_role('button', name='导出完整备份').click()
    backup_text = Path(downloaded.value.path()).read_text()
    backup = json.loads(backup_text)
    page.get_by_role('button', name='清空所有数据').click()
    assert page.evaluate('Object.keys(VOCAB).length') == 74
    assert page.evaluate('getStore().customChapters') == {}
    page.locator('#import-input').fill(backup_text)
    for _ in range(2):
        page.locator('#sc-import').get_by_role('button', name='导入数据', exact=True).click()
        assert '已合并' in page.locator('#import-result').inner_text()
        assert page.evaluate('getStore()') == backup
    page.reload()
    page.wait_for_function('Object.keys(VOCAB).length===76')
    assert page.locator('.card').count() == 76
    assert not errors, errors
    print('PASS: 1.4/1.6 media and speech rates; CSV round-trip, dedup, provenance, grading metadata, drafts, malformed input atomicity, JSON restore and mobile layout')
    browser.close()
