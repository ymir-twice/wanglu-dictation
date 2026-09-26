"""Validate corpus structure, source coverage and audio references (stdlib only)."""
import json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
corpus=json.loads((ROOT/'data/corpus.json').read_text())
audio=json.loads((ROOT/'data/audio.json').read_text())
legacy=json.loads((ROOT/'data/legacy-vocab.json').read_text())
assert corpus['schemaVersion']==audio['schemaVersion']==1
chapters=corpus['chapters'];tracks=audio['tracks']
ids=[c['id'] for c in chapters];audio_ids=[t['id'] for t in tracks]
assert len(ids)==len(set(ids)) and len(audio_ids)==len(set(audio_ids))
assert {c['chapter'] for c in chapters}==set(range(2,12))
assert len(tracks)==141
by_id={c['id']:c for c in chapters};by_audio={t['id']:t for t in tracks}
for c in chapters:
    assert re.fullmatch(r'\d+\.\d+(?:-[a-z0-9]+)?',c['id']),c['id']
    assert c['words'] and c['source']
    for i,w in enumerate(c['words'],1):
        assert w['id']==f"{c['id']}:{i}"
        assert isinstance(w['w'],str) and w['w'].strip()==w['w'] and w['w']
        assert '综合测试' not in w['w'] and 'ielts6699' not in w['w'].lower()
        assert isinstance(w.get('p',''),str) and isinstance(w.get('m',''),str)
        assert isinstance(w.get('answers',[]),list)
        assert all(isinstance(a,str) and a.strip() for a in w.get('answers',[]))
        assert w.get('kind','') in ['', 'number', 'code', 'date', 'money', 'quantity']
    for track_id in c['audio']:
        t=by_audio[track_id]
        assert t['chapter']==c['chapter']
        assert '纵向测试' not in t['title'],(c['id'],track_id)
    if c['source']=='textbook-pdf':assert all(1<=p<=263 for p in c['pdfPages'])
# All original vocabulary survives, except the four non-answer chapter headings.
for chapter,words in legacy.items():
    assert [w['w'] for w in by_id[chapter]['words']]==[w['w'] for w in words if w['w']!='综合测试'],chapter
assert [len(by_id[f'11.{i}-sheet']['words']) for i in range(1,5)]==[334,365,309,442]
assert len(by_id['8.2']['words'])==123
assert len(by_id['7.3']['words'])==54
assert len(by_id['9.2']['words'])==112
for t in tracks:
    assert t['url'].startswith('https://raw.githubusercontent.com/27rabbit-penguin/IELTS_repo/'+audio['revision']+'/')
    assert t['url'].endswith('.mp3') and t['bytes']>0
print(f"PASS: {len(chapters)} exercises, {sum(len(c['words']) for c in chapters)} entries, {len(tracks)} audio tracks; original vocabulary preserved")
