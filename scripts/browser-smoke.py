"""Browser integration checks. Run with a Python environment containing playwright."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=os.environ.get('WL_TEST_URL','http://localhost:8000')
CHROME=os.environ.get('WL_CHROME','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=CHROME,headless=True)
    context=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    # Avoid downloading entire MP3s in interaction checks. Playback availability
    # is verified separately against the upstream URL.
    context.route('https://raw.githubusercontent.com/**',lambda route:route.abort())
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.goto(BASE);page.wait_for_function('Object.keys(VOCAB).length===74')
    assert page.locator('.card').count()==74
    page.screenshot(path='/tmp/wanglu-home.png',full_page=True)
    page.evaluate("startDict('4.4')")
    assert page.locator('.row-input').count()==12
    page.locator('#inp-0').fill(' ALMOST  ')
    page.locator('#inp-0').press('Enter')
    assert page.locator('#inp-1').evaluate('(el)=>el===document.activeElement')
    page.locator('#inp-1').fill('<img src=x onerror=alert(1)>')
    assert page.locator('#d-stat').inner_text()=='2 / 12'
    page.locator('#tab-home').click()
    page.get_by_role('button',name='继续上次未完成的听写').click()
    assert page.locator('#inp-0').input_value()==' ALMOST  '
    page.reload();page.wait_for_function('Object.keys(VOCAB).length===74')
    page.get_by_role('button',name='继续上次未完成的听写').click()
    assert page.locator('#inp-1').input_value().startswith('<img')
    page.locator('#btn-check').click()
    assert page.locator('#inp-0').get_attribute('readonly') is not None
    page.evaluate('checkAll();checkAll();')
    page.locator('#btn-finish').click()
    page.evaluate('finishDict()')
    assert page.locator('#r-pct').inner_text()=='8%'
    assert page.locator('#r-wrong img').count()==0
    state=page.evaluate('getStore()')
    assert len(state['hist']['4.4'])==1
    assert len(state['wb'])==11 and all(w['n']==1 for w in state['wb'].values())
    assert page.evaluate("localStorage.getItem('wl4_draft')") is None
    with page.expect_download() as result:page.get_by_role('button',name='导出本次错题').click()
    path=result.value.path();assert '正确答案' in Path(path).read_text(encoding='utf-8-sig')
    page.locator('#tab-wb').click()
    assert page.locator('.wb-item').count()==11
    with page.expect_download() as result:page.get_by_role('button',name='导出 CSV').click()
    assert len(Path(result.value.path()).read_text(encoding='utf-8-sig').splitlines())==12
    page.get_by_role('button',name='只听错题',exact=True).click()
    assert page.locator('#audio-mode').input_value()=='speech'
    assert page.evaluate("curWords.every(w=>w.chap==='4.4')")
    page.evaluate("window.spoken=[]; speechSynthesis.speak=u=>window.spoken.push({text:u.text,lang:u.lang}); speechSynthesis.cancel=()=>{}")
    page.get_by_role('button',name='重听第 1 题',exact=True).click()
    assert page.evaluate('spoken.length')==1
    page.evaluate("curWords.forEach((w,i)=>document.getElementById('inp-'+i).value=w.w)")
    page.locator('#btn-finish').click()
    assert page.locator('#r-pct').inner_text()=='100%'
    assert page.evaluate('Object.values(getWb()).every(w=>w.mastered)')
    page.get_by_role('button',name='重练',exact=True).click()
    assert page.locator('.row-input').count()==11
    page.locator('#tab-wb').click()
    assert page.locator('.wb-item').count()==0
    page.locator('#wb-mastered').check()
    assert page.locator('.wb-item').count()==11
    # Stable legacy migration and same word in different chapters.
    page.evaluate("localStorage.removeItem('wl4_state'); localStorage.setItem('wl3_wb',JSON.stringify({almost:{word:'almost',phon:'',mean:'几乎',chap:'4.4',n:2,d:'2026/9/1'}}));localStorage.removeItem('wl4_draft');")
    page.reload();page.wait_for_function('Object.keys(VOCAB).length===74')
    assert page.evaluate("getWb()['4.4::almost'].n")==2
    page.evaluate("startDict('4.4',[{w:'almost',chap:'4.4'},{w:'almost',chap:'7.2'}]);finishDict()")
    assert page.evaluate("getWb()['4.4::almost'].n")==3
    assert page.evaluate("getWb()['7.2::almost'].n")==1
    # Explicit formatting rules must not accept the wrong date/year or missing digits.
    assert page.evaluate("isOk('62126611','6212 6611',[],'number')")
    assert not page.evaluate("isOk('6212661','6212 6611',[],'number')")
    assert page.evaluate("isOk('January 13th, 1973','13 January, 1973',[],'date')")
    assert not page.evaluate("isOk('January 13, 1974','13 January, 1973',[],'date')")
    assert page.evaluate("isOk('favorite color','favourite colour')")
    assert not page.evaluate("isOk('student','students')")
    # Atomic import and repeat import.
    page.locator('#tab-import').click()
    backup=page.evaluate('getStore()')
    page.locator('#import-input').fill(json.dumps(backup))
    page.locator('#sc-import').get_by_role('button',name='导入数据',exact=True).click()
    assert page.evaluate('getStore()')==backup
    page.locator('#import-input').fill('{"hist":{"__proto__":[]},"wb":{}}')
    page.locator('#sc-import').get_by_role('button',name='导入数据',exact=True).click()
    assert '导入失败' in page.locator('#import-result').inner_text()
    assert page.evaluate('getStore()')==backup
    # Mobile layout.
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate("startDict('8.3-1')")
    assert page.evaluate('document.documentElement.scrollWidth<=390')
    page.screenshot(path='/tmp/wanglu-mobile.png',full_page=True)
    page.set_viewport_size({'width':1280,'height':900})
    page.evaluate("startDict('3.3-1')")
    page.screenshot(path='/tmp/wanglu-dictation.png',full_page=True)
    assert not errors,errors
    print('PASS: 74 exercises; grading, duplicate submission, drafts, wrong-only speech, mastery, CSV, migration, import and mobile layout')
    browser.close()
