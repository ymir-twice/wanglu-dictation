let VOCAB = {}, CORPUS = null, CHAPTERS = {}, AUDIO = [];
// ── HELPERS ──
const VARIANTS=[['organise','organize'],['organisation','organization'],['colour','color'],
['licence','license'],['practise','practice'],['defence','defense'],['offence','offense'],
['labour','labor'],['behaviour','behavior'],['favourite','favorite'],['neighbour','neighbor'],
['honour','honor'],['recognise','recognize'],['specialise','specialize'],['analyse','analyze'],
['travelled','traveled'],['travelling','traveling'],['catalogue','catalog'],['programme','program']];

function norm(s){return String(s ?? '').normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ');}

function isOk(inp,ans,alternatives=[],kind=''){
  const formatted=value=>{
    let v=norm(value);
    if(kind==='number')return v.replace(/[ ,]/g,'');
    if(kind==='code')return v.replace(/\s/g,'');
    if(kind==='money'||kind==='quantity')return v.replace(/\s/g,'');
    if(kind==='date'){
      v=v.replace(/(\d)(st|nd|rd|th)\b/g,'$1').replace(/,/g,'');
      const match=v.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/)||v.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/);
      if(match){const day=/^\d/.test(match[1])?match[1]:match[2];const month=/^\d/.test(match[1])?match[2]:match[1];return `${Number(day)} ${month} ${match[3]||''}`.trim();}
    }
    return v;
  };
  if(kind&&norm(inp)&&[ans,...alternatives].some(a=>formatted(inp)===formatted(a)))return true;
  const canonical=s=>norm(s).split(' ').map(t=>{const pair=VARIANTS.find(p=>p.includes(t));return pair?pair[0]:t;}).join(' ');
  return !!norm(inp)&&[ans,...alternatives].some(a=>canonical(inp)===canonical(a));
}

function qs(s){return document.querySelector(s);}
function getLS(k){try{const v=JSON.parse(localStorage.getItem(k)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch(e){return {};}}

function setLS(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){notify('浏览器未能保存记录，请导出备份后检查存储空间或隐私设置。');return false;}}

function fmtDate(d){return d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});}
function fmtDateFull(d){return d.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});}

// ── STATE ──
let curChap=null,curWords=[],wbMode=false,wbSortBy='count';
let activeWord=0, submitted=false, grades=null, sessionId='', speechRunning=false, speechTimer=null, speechToken=0, localAudioURL=null, draftTimer=null, lastPractice=[];

// ── STORAGE ──
function getHist(){return getStore().hist;}

function saveHist(h){const state=getStore();state.hist=h;return setLS('wl4_state',state);}

function getWb(){return getStore().wb;}

function saveWb(w){const state=getStore();state.wb=w;return setLS('wl4_state',state);}

function chapSessions(chap){
  const h=getHist();
  return h[chap]||[];
}

function lastScore(chap){
  const s=chapSessions(chap);
  return s.length?s[s.length-1].pct:null;
}

function wordKey(w){return (w.chap||'未知章节')+'::'+norm(w.w||w.word);}

// ── NAVIGATION ──
function showScreen(id){
  if(id!=='dict'){saveDraft();stopPlayback();}
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  document.getElementById('sc-'+id).classList.add('on');
}
function activateTab(id){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  const el=document.getElementById('tab-'+id);
  if(el)el.classList.add('on');
}

function toHome(){showScreen('home');renderHome();activateTab('home');}
function toWb(){renderWb();showScreen('wb');activateTab('wb');}

// ── HOME ──
const GROUPS=Array.from({length:10},(_,i)=>[ `第 ${i+2} 章`,k=>k.startsWith((i+2)+'.')]);

function renderHome(){
  qs('.home-hero p').textContent=`${Object.keys(VOCAB).length} 个练习 · ${Object.values(VOCAB).reduce((n,w)=>n+w.length,0)} 条语料 · 点击章节开始听写`;
  let html='';
  GROUPS.forEach(([label,fn])=>{
    const chs=Object.keys(VOCAB).filter(fn);
    if(!chs.length)return;
    html+=`<div class="group-label">${label}</div><div class="grid">`;
    chs.forEach(ch=>{
      const cnt=VOCAB[ch].length;
      const sc=lastScore(ch);
      const sessions=chapSessions(ch);
      let badge='';
      if(sc===null)badge=`<span class="badge n">未练</span>`;
      else if(sc>=80)badge=`<span class="badge g">${sc}%</span>`;
      else if(sc>=50)badge=`<span class="badge y">${sc}%</span>`;
      else badge=`<span class="badge r">${sc}%</span>`;

      const sparkId=`spark-${ch.replace(/\./g,'-')}`;
      html+=`<div class="card" onclick="openStats('${ch}')">
        <div class="card-name">${ch}</div>
        <div class="card-title">${escapeHtml(CHAPTERS[ch]?.title||ch)}</div>
        <div class="card-cnt">${cnt} 词 · ${sessions.length ? sessions.length+'次' : '未练'}</div>
        ${badge}
        <div class="card-chart"><canvas id="${sparkId}" height="28" style="width:100%;"></canvas></div>
      </div>`;
    });
    html+='</div>';
  });
  qs('#home-body').innerHTML=html;
  qs('#home-status').replaceChildren();
  if(getLS('wl4_draft').words?.length){const b=document.createElement('button');b.className='btn btn-ghost btn-sm';b.textContent='继续上次未完成的听写';b.onclick=resumeDraft;qs('#home-status').append(b);}

  // draw sparklines
  GROUPS.forEach(([,fn])=>{
    Object.keys(VOCAB).filter(fn).forEach(ch=>{
      const sessions=chapSessions(ch);
      const sparkId=`spark-${ch.replace(/\./g,'-')}`;
      drawSparkline(sparkId,sessions.map(s=>s.pct));
    });
  });
}

// ── SPARKLINE ──
function drawSparkline(canvasId,data){
  const el=document.getElementById(canvasId);
  if(!el)return;
  const dpr=window.devicePixelRatio||1;
  const W=el.offsetWidth||160,H=28;
  el.width=W*dpr;el.height=H*dpr;
  el.style.width=W+'px';el.style.height=H+'px';
  const ctx=el.getContext('2d');
  ctx.scale(dpr,dpr);
  if(!data||data.length<2){
    if(data&&data.length===1){
      ctx.beginPath();ctx.arc(W/2,H/2,3,0,Math.PI*2);
      ctx.fillStyle='#4493f8';ctx.fill();
    }
    return;
  }
  const pad=4;
  const minV=0,maxV=100;
  const xStep=(W-pad*2)/(data.length-1);
  const yScale=(H-pad*2)/(maxV-minV);

  function xOf(i){return pad+i*xStep;}
  function yOf(v){return H-pad-(v-minV)*yScale;}

  // gradient fill
  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(68,147,248,0.25)');
  grad.addColorStop(1,'rgba(68,147,248,0)');
  ctx.beginPath();
  ctx.moveTo(xOf(0),yOf(data[0]));
  data.forEach((v,i)=>{if(i>0)ctx.lineTo(xOf(i),yOf(v));});
  ctx.lineTo(xOf(data.length-1),H-pad);
  ctx.lineTo(xOf(0),H-pad);
  ctx.closePath();
  ctx.fillStyle=grad;ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(xOf(0),yOf(data[0]));
  data.forEach((v,i)=>{if(i>0)ctx.lineTo(xOf(i),yOf(v));});
  ctx.strokeStyle='#4493f8';ctx.lineWidth=1.5;ctx.stroke();

  // last dot
  const last=data[data.length-1];
  ctx.beginPath();ctx.arc(xOf(data.length-1),yOf(last),3,0,Math.PI*2);
  const dotColor=last>=80?'#3fb950':last>=50?'#d29922':'#f85149';
  ctx.fillStyle=dotColor;ctx.fill();
}

// ── STATS SCREEN ──
function openStats(chap){
  const sessions=chapSessions(chap);
  qs('#st-title').textContent=`章节 ${chap}`;
  qs('#st-subtitle').textContent=`共 ${VOCAB[chap].length} 个单词 · 已练 ${sessions.length} 次`;
  qs('#st-start-btn').onclick=()=>startDict(chap);
  const wrong=Object.values(getWb()).filter(w=>w.chap===chap&&!w.mastered);
  qs('#st-wrong-btn').textContent=`只听本章错题 (${wrong.length})`;
  qs('#st-wrong-btn').disabled=!wrong.length;
  qs('#st-wrong-btn').onclick=()=>practiceChapWb(chap);
  const draft=getLS('wl4_draft');
  qs('#st-resume-btn').hidden=draft.chap!==chap||!draft.words?.length;
  qs('#st-resume-btn').onclick=()=>resumeDraft();
  qs('#st-source').textContent=[CHAPTERS[chap]?.title,CHAPTERS[chap]?.notes].filter(Boolean).join(' · ');

  // summary boxes
  if(sessions.length===0){
    qs('#st-summary').innerHTML=`<div class="stat-box"><div class="stat-box-val">—</div><div class="stat-box-lbl">暂无记录</div></div>`;
  } else {
    const pcts=sessions.map(s=>s.pct);
    const best=Math.max(...pcts),latest=pcts[pcts.length-1];
    const avg=Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length);
    const trend=pcts.length>1?pcts[pcts.length-1]-pcts[pcts.length-2]:null;
    const cls=v=>v>=80?'g':v>=50?'y':'r';
    qs('#st-summary').innerHTML=`
      <div class="stat-box"><div class="stat-box-val ${cls(latest)}">${latest}%</div><div class="stat-box-lbl">最近一次</div></div>
      <div class="stat-box"><div class="stat-box-val ${cls(best)}">${best}%</div><div class="stat-box-lbl">最高正确率</div></div>
      <div class="stat-box"><div class="stat-box-val ${cls(avg)}">${avg}%</div><div class="stat-box-lbl">平均正确率</div></div>
      <div class="stat-box"><div class="stat-box-val" style="color:var(--purple)">${sessions.length}</div><div class="stat-box-lbl">听写次数</div></div>
      ${trend!==null?`<div class="stat-box"><div class="stat-box-val" style="color:${trend>=0?'var(--gb)':'var(--rb)'}">${trend>=0?'+':''}${trend}%</div><div class="stat-box-lbl">较上次变化</div></div>`:''}
    `;
  }

  // main chart
  drawMainChart('main-chart', sessions);

  // history table
  let rows='';
  [...sessions].reverse().forEach(s=>{
    const d=new Date(s.date);
    const cls=s.pct>=80?'g':s.pct>=50?'y':'r';
    const hasDetail=s.all&&s.all.length>0;
    rows+=`<tr>
      <td style="color:var(--purple)">第 ${s.n} 次</td>
      <td style="color:var(--dim)">${fmtDateFull(d)}</td>
      <td class="pct-cell ${cls}">${s.pct}%</td>
      <td style="color:var(--dim)">${s.correct??'—'} / ${s.total??VOCAB[chap].length}</td>
      <td><button class="sort-btn${hasDetail?' on':''}" style="padding:3px 8px;font-size:10px;"
        onclick="${hasDetail?`openSessionDetail('${chap}',${s.n})`:'void(0)'}"
        ${hasDetail?'':'disabled title="旧记录无详情"'}>
        ${hasDetail?'查看详情':'—'}
      </button></td>
    </tr>`;
  });
  qs('#hist-tbody').innerHTML=rows||`<tr><td colspan="5" style="color:var(--dim);text-align:center;padding:20px;">暂无记录</td></tr>`;

  showScreen('stats');
  activateTab('home');
}

function drawMainChart(canvasId,sessions){
  const canvas=document.getElementById(canvasId);
  if(!canvas)return;
  const wrap=canvas.parentElement;
  const dpr=window.devicePixelRatio||1;
  const W=wrap.offsetWidth||600,H=180;
  canvas.width=W*dpr;canvas.height=H*dpr;
  canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);

  const padL=40,padR=20,padT=16,padB=32;
  const cW=W-padL-padR,cH=H-padT-padB;

  // background grid
  ctx.strokeStyle='#1e2a35';ctx.lineWidth=1;
  [0,25,50,75,100].forEach(v=>{
    const y=padT+cH-(v/100*cH);
    ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+cW,y);ctx.stroke();
    ctx.fillStyle='#768390';ctx.font=`${10*dpr/dpr}px JetBrains Mono, monospace`;
    ctx.textAlign='right';
    ctx.fillText(v+'%',padL-6,y+4);
  });

  if(!sessions||sessions.length===0){
    ctx.fillStyle='#768390';ctx.font='12px sans-serif';ctx.textAlign='center';
    ctx.fillText('暂无数据',W/2,H/2);return;
  }

  const data=sessions.map(s=>s.pct);
  const n=data.length;
  function xOf(i){return padL+(n===1?cW/2:i/(n-1)*cW);}
  function yOf(v){return padT+cH-(v/100*cH);}

  // gradient fill
  const grad=ctx.createLinearGradient(0,padT,0,padT+cH);
  grad.addColorStop(0,'rgba(68,147,248,0.3)');
  grad.addColorStop(1,'rgba(68,147,248,0)');
  ctx.beginPath();
  ctx.moveTo(xOf(0),yOf(data[0]));
  data.forEach((v,i)=>{if(i>0)ctx.lineTo(xOf(i),yOf(v));});
  ctx.lineTo(xOf(n-1),padT+cH);ctx.lineTo(xOf(0),padT+cH);ctx.closePath();
  ctx.fillStyle=grad;ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(xOf(0),yOf(data[0]));
  data.forEach((v,i)=>{if(i>0)ctx.lineTo(xOf(i),yOf(v));});
  ctx.strokeStyle='#4493f8';ctx.lineWidth=2;ctx.stroke();

  // dots + labels
  data.forEach((v,i)=>{
    const x=xOf(i),y=yOf(v);
    const dotColor=v>=80?'#3fb950':v>=50?'#d29922':'#f85149';
    ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);
    ctx.fillStyle=dotColor;ctx.fill();
    ctx.strokeStyle=var2hex('--bg');ctx.lineWidth=1.5;ctx.stroke();

    // x-axis label: "第N次\n日期"
    const s=sessions[i];
    const d=new Date(s.date);
    ctx.fillStyle='#768390';ctx.font=`9px JetBrains Mono,monospace`;ctx.textAlign='center';
    ctx.fillText(`第${s.n}次`,x,padT+cH+12);
    ctx.fillText(fmtDate(d),x,padT+cH+22);
  });
}

function var2hex(v){
  // approximate -- just return bg color for stroke
  return '#080c10';
}

// ── DICTATION ──
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

function startDict(chap,words,restore=null){
  stopPlayback();saveDraft();
  curChap=chap;wbMode=!!words;submitted=false;grades=null;activeWord=0;
  sessionId=restore?.sessionId||Date.now()+'-'+Math.random().toString(36).slice(2);
  curWords=(words||VOCAB[chap]||[]).map(w=>({...w,chap:w.chap||chap||'未知章节'}));
  if(!curWords.length){notify('没有可听写的词条。');return;}
  if(wbMode&&!restore)curWords=shuffle(curWords);
  lastPractice=curWords.map(w=>({...w}));
  qs('#d-chap').textContent=wbMode?'只听错题':`章节 ${chap}`;
  qs('#d-meta').textContent=`第 ${chapSessions(chap||'__wb__').length+1} 次 · ${fmtDateFull(new Date())}`;
  qs('#d-footer-info').textContent='Enter 下一格 · Alt + P 播放/暂停 · Alt + R 重听 · 完成后自动批改';
  qs('#btn-finish').disabled=false;qs('#btn-check').disabled=false;
  buildRows();showScreen('dict');activateTab('home');setupAudio();
  if(restore){
    restore.answers.forEach((v,i)=>{const el=document.getElementById('inp-'+i);if(el)el.value=v;});
    activeWord=Math.min(restore.activeWord||0,curWords.length-1);
    if(restore.mode&&[...qs('#audio-mode').options].some(o=>o.value===restore.mode&&!o.disabled))qs('#audio-mode').value=restore.mode;
    if(restore.track&&AUDIO.some(t=>t.id===restore.track))qs('#audio-track').value=restore.track;
    changeAudioMode();
    const player=qs('#chapter-audio');
    if(restore.time)player.addEventListener('loadedmetadata',()=>{player.currentTime=Math.min(restore.time,player.duration||restore.time);},{once:true});
    if(restore.grades)checkAll();
  }
  document.getElementById('inp-'+activeWord)?.focus();updateStrip(activeWord);saveDraft();
}

function buildRows(){
  const scroll=qs('#d-scroll');
  let html='';
  curWords.forEach((w,i)=>{
    html+=`<div class="row" id="row-${i}">
      <div class="row-num">${i+1}</div>
      <button class="listen-btn" aria-label="重听第 ${i+1} 题" onclick="speakWord(${i})">▶</button>
      <input class="row-input" id="inp-${i}" data-idx="${i}" aria-label="第 ${i+1} 题答案"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="">
      <div class="row-answer" id="ans-${i}"></div>
      <div class="row-icon" id="ico-${i}"></div>
    </div>`;
  });
  scroll.innerHTML=html;

  curWords.forEach((_,i)=>{
    const inp=document.getElementById('inp-'+i);
    inp.addEventListener('keydown',(e)=>{
      if(e.key==='Enter'){e.preventDefault();advanceFrom(i);}
    });
    inp.addEventListener('focus',()=>{
      document.querySelectorAll('.row').forEach(r=>r.classList.remove('active-row'));
      document.getElementById('row-'+i).classList.add('active-row');
      activeWord=i;updateStrip(i);
    });
    inp.addEventListener('input',()=>{
      const inp2=document.getElementById('inp-'+i);
      updateStrip(i);clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,300);
      if(inp2.classList.contains('ok')||inp2.classList.contains('err')||inp2.classList.contains('skip')){
        inp2.className='row-input';
        document.getElementById('ans-'+i).textContent='';
        document.getElementById('ans-'+i).className='row-answer';
        document.getElementById('ico-'+i).textContent='';
      }
    });
  });
  updateStrip(0);
}

function advanceFrom(i){
  let next=i+1;
  while(next<curWords.length){
    const inp=document.getElementById('inp-'+next);
    if(!inp.classList.contains('ok')&&!inp.classList.contains('err')&&!inp.classList.contains('skip')){
      inp.focus();inp.scrollIntoView({block:'center',behavior:'smooth'});if(speechRunning)speakWord(next,true);return;
    }
    next++;
  }
  if(speechRunning)stopSpeech();qs('#btn-check').focus();
}

function updateStrip(idx){
  const filled=[...document.querySelectorAll('.row-input')].filter(i=>i.value.trim()).length;
  qs('#d-stat').textContent=`${filled} / ${curWords.length}`;
  qs('#d-rail').style.width=(filled/curWords.length*100)+'%';
}

function checkAll(){
  if(grades)return;
  grades=curWords.map((w,i)=>{const inp=document.getElementById('inp-'+i);const typed=inp.value.trim();return {...w,typed,ok:isOk(typed,w.w,w.answers||[],w.kind)};});
  grades.forEach((w,i)=>{
    const inp=document.getElementById('inp-'+i);inp.readOnly=true;inp.className='row-input '+(w.ok?'ok':w.typed?'err':'skip');
    const answer=document.getElementById('ans-'+i);answer.textContent=w.ok?'':w.w;answer.className='row-answer'+(w.ok?'':' reveal-err');
    document.getElementById('ico-'+i).textContent=w.ok?'✓':'✗';
  });
  const correct=grades.filter(w=>w.ok).length;
  qs('#d-footer-info').textContent=`正确 ${correct} / ${grades.length} · 答案已锁定，点击完成保存记录`;
  qs('#d-stat').textContent=`✓ ${correct} / ${grades.length}`;qs('#btn-check').disabled=true;
  stopPlayback();saveDraft();
}

function finishDict(){
  if(submitted||!curWords.length)return;
  checkAll();
  const state=getStore();
  if(Object.values(state.hist).some(list=>list.some(s=>s.id===sessionId))){submitted=true;return;}
  const correct=grades.filter(w=>w.ok).length,total=grades.length,pct=Math.round(correct/total*100);
  const wrongWords=grades.filter(w=>!w.ok),date=new Date().toISOString(),key=wbMode?'__wb__':curChap;
  if(!state.hist[key])state.hist[key]=[];
  state.hist[key].push({id:sessionId,n:state.hist[key].length+1,pct,correct,total,date,wrong:wrongWords,all:grades,mode:wbMode?'wrong':'chapter'});
  const outcomes=new Map();
  grades.forEach(w=>{const key=wordKey(w);if(!outcomes.has(key)||!w.ok)outcomes.set(key,w);});
  outcomes.forEach(w=>{
    const k=wordKey(w);
    if(!w.ok){const prior=state.wb[k];state.wb[k]={word:w.w,phon:w.p||'',mean:w.m||'',chap:w.chap,answers:w.answers||[],kind:w.kind||'',speech:w.speech||'',n:(prior?.n||0)+1,d:date,typed:w.typed,mastered:false};}
    else if(state.wb[k])state.wb[k].mastered=true;
  });
  if(!setLS('wl4_state',state))return;
  submitted=true;qs('#btn-finish').disabled=true;clearTimeout(draftTimer);localStorage.removeItem('wl4_draft');
  showResults(pct,correct,total,wrongWords);
}

// ── RESULTS ──
function showResults(pct,correct,total,wrongWords){
  const sessions=chapSessions(curChap||'__wb__');
  const sessionNum=wbMode?'—':sessions.length;
  const today=fmtDateFull(new Date());
  const cls=pct>=80?'g':pct>=50?'y':'r';

  qs('#r-meta').textContent=wbMode
    ?`错词练习 · ${today}`
    :`章节 ${curChap} · 第 ${sessionNum} 次 · ${today}`;
  qs('#r-pct').textContent=pct+'%';
  qs('#r-pct').className='res-pct '+cls;
  qs('#r-sub').textContent=`正确 ${correct} / ${total}`;

  let acts=`<button class="btn btn-ghost" onclick="toHome()">← 章节</button>`;
  if(!wbMode&&curChap)
    acts+=`<button class="btn btn-ghost" onclick="openStats('${curChap}')">📊 查看记录</button>`;
  acts+=`<button class="btn btn-ghost" onclick="retryPractice()">重练</button>`;
  if(wrongWords.length)
    acts+=`<button class="btn btn-primary" onclick="startDict(null,[...lastWrong])">再练错词 (${wrongWords.length})</button>`;
  qs('#r-actions').innerHTML=acts;

  window.lastWrong=wrongWords.map(w=>({...w}));
  if(wrongWords.length)qs('#r-actions').insertAdjacentHTML('beforeend','<button class="btn btn-ghost" onclick="exportSessionWrong()">导出本次错题</button>');

  let whtml='';
  if(wrongWords.length){
    whtml=`<div class="wrong-head">错词列表 (${wrongWords.length})</div>`;
    wrongWords.forEach(w=>{
      whtml+=`<div class="wrong-row">
        <span class="wr-correct">${escapeHtml(w.w)}</span>
        <span class="wr-typed">${escapeHtml(w.typed||'（未填）')}</span>
        <span class="wr-mean">${escapeHtml(w.m)}</span>
      </div>`;
    });
  } else {
    whtml='<div style="text-align:center;padding:40px;color:var(--gb);font-size:20px">🎉 全对！</div>';
  }
  qs('#r-wrong').innerHTML=whtml;
  showScreen('res');
}

// ── WORDBOOK ──
function wbSort(by,btn){
  wbSortBy=by;
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderWb();
}

function renderWb(){
  const wb=getWb();
  const items=Object.values(wb).filter(w=>qs('#wb-mastered').checked||!w.mastered);
  const total=items.length;
  qs('#wb-cnt').textContent=`待复习 ${Object.values(wb).filter(w=>!w.mastered).length} 词 · 已掌握 ${Object.values(wb).filter(w=>w.mastered).length} 词`;

  if(!total){
    qs('#wb-body').innerHTML='<div class="wb-empty">还没有错词<br><span style="font-size:11px">完成听写后错词自动收录；答对后标记为已掌握</span></div>';
    return;
  }

  // group by chapter, preserving chapter order
  const chapOrder=Object.keys(VOCAB);
  const groups={};
  items.forEach(w=>{
    const ch=w.chap||'未知章节';
    if(!groups[ch])groups[ch]=[];
    groups[ch].push(w);
  });

  // sort within each group
  const sortFn=wbSortBy==='count'
    ?(a,b)=>b.n-a.n
    :(a,b)=>b.d.localeCompare(a.d);
  Object.values(groups).forEach(g=>g.sort(sortFn));

  // render groups in chapter order, unknown at end
  const orderedChaps=[
    ...chapOrder.filter(ch=>groups[ch]),
    ...Object.keys(groups).filter(ch=>!chapOrder.includes(ch))
  ];

  let html='';
  orderedChaps.forEach(ch=>{
    const g=groups[ch];
    html+=`
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);">
          <span style="font-family:var(--mono);font-size:11px;color:var(--accent);letter-spacing:1px;">${escapeHtml(ch)}</span>
          <span style="font-size:11px;color:var(--dim);">${g.length} 词</span>
          <button class="sort-btn" style="margin-left:auto;padding:3px 10px;font-size:10px;"
            data-chapter="${escapeHtml(ch)}" onclick="practiceChapWb(this.dataset.chapter)">练习本章错词</button>
        </div>
        <div>`;
    g.forEach(w=>{
      html+=`<div class="wb-item">
        <span class="wb-word">${escapeHtml(w.word)}</span>
        <span class="wb-mean">${escapeHtml(w.mean)}</span>
        <span class="wb-cnt2">${w.n}次</span>
        <span class="wb-date">${escapeHtml(w.mastered?'已掌握':fmtDate(new Date(w.d)))}</span>
      </div>`;
    });
    html+=`</div></div>`;
  });
  qs('#wb-body').innerHTML=html;
}

function practiceWb(){const items=Object.values(getWb()).filter(w=>!w.mastered);if(items.length)startDict(null,items.map(wbWord));else notify('没有待复习的错题。');}

function practiceChapWb(chap){const items=Object.values(getWb()).filter(w=>w.chap===chap&&!w.mastered);if(items.length)startDict(chap,items.map(wbWord));}

// ── SESSION DETAIL MODAL ──
let modalSession=null, modalChap=null, modalViewMode='wrong';

function openSessionDetail(chap,n){
  const sessions=chapSessions(chap);
  const s=sessions.find(x=>x.n===n);
  if(!s)return;
  modalSession=s; modalChap=chap; modalViewMode='wrong';

  const d=new Date(s.date);
  qs('#modal-title').textContent=`章节 ${chap} · 第 ${s.n} 次听写`;
  qs('#modal-meta').textContent=fmtDateFull(d);

  const cls=s.pct>=80?'g':s.pct>=50?'y':'r';
  qs('#modal-score').textContent=s.pct+'%';
  qs('#modal-score').className='modal-score-num '+cls;
  qs('#modal-score-detail').innerHTML=
    `正确：${s.correct} 词<br>错误：${s.total-s.correct} 词<br>共计：${s.total} 词`;

  // retry button
  const wrongList=(s.wrong||[]).map(w=>({...w,chap:w.chap||chap}));
  const retryBtn=qs('#modal-retry-btn');
  if(wrongList.length){
    retryBtn.style.display='';
    retryBtn.textContent=`再练错词 (${wrongList.length})`;
    retryBtn.onclick=()=>{closeModal();startDict(null,wrongList);};
  } else {
    retryBtn.style.display='none';
  }

  // reset tabs
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('on'));
  qs('#mtab-wrong').classList.add('on');
  renderModalList('wrong');

  qs('#modal-overlay').classList.add('on');
}

function renderModalList(mode){
  modalViewMode=mode;
  const s=modalSession;
  if(!s)return;

  const hasAll=s.all&&s.all.length>0;
  const data=mode==='wrong'
    ?(s.wrong||[]).map(w=>({...w,ok:false}))
    :(hasAll?s.all:(s.wrong||[]).map(w=>({...w,ok:false})));

  qs('#modal-list-title').textContent=
    mode==='wrong'
      ?`错词 (${(s.wrong||[]).length})`
      :`全部单词 (${s.total})`;

  if(!data.length){
    qs('#modal-list').innerHTML=
      `<div style="text-align:center;padding:24px;color:var(--gb)">🎉 本次全部正确！</div>`;
    return;
  }

  let html='';
  data.forEach(w=>{
    const isOkEntry=w.ok;
    html+=`<div class="modal-word-row ${isOkEntry?'right-entry':'wrong-entry'}">
      <span class="mw-correct ${isOkEntry?'ok':'err'}">${escapeHtml(w.w)}</span>
      <span class="mw-typed ${isOkEntry?'ok':''}">${escapeHtml(w.typed||'（未填）')}</span>
      <span class="mw-mean">${escapeHtml(w.m)}</span>
    </div>`;
  });
  qs('#modal-list').innerHTML=html;
}

function modalTab(mode,btn){
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('on'));
  btn.classList.add('on');
  renderModalList(mode);
}

function closeModal(){
  qs('#modal-overlay').classList.remove('on');
  modalSession=null;
}

// close on Escape
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
});



function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function notify(message){alert(message);}
function getStore(){
  const state=getLS('wl4_state');
  if(state.version===4&&state.hist&&state.wb)return state;
  const wb={};
  Object.values(getLS('wl3_wb')).forEach(w=>{if(!w||typeof w.word!=='string')return;wb[wordKey(w)]={...w,mastered:false};});
  return {version:4,hist:getLS('wl3_hist'),wb};
}
function wbWord(w){return {w:w.word,p:w.phon||'',m:w.mean||'',chap:w.chap,answers:w.answers||[],kind:w.kind||'',speech:w.speech||''};}
function retryPractice(){startDict(curChap,wbMode?lastPractice:null);}
function saveDraft(){
  if(!curWords.length||submitted||!qs('#sc-dict').classList.contains('on'))return;
  setLS('wl4_draft',{chap:curChap,words:curWords,wbMode,sessionId,activeWord,grades:!!grades,answers:curWords.map((_,i)=>document.getElementById('inp-'+i)?.value||''),mode:qs('#audio-mode').value,track:qs('#audio-track').value,time:qs('#chapter-audio').currentTime});
}
function resumeDraft(){const d=getLS('wl4_draft');if(d.words?.length&&Array.isArray(d.answers))startDict(d.chap,d.wbMode?d.words:null,d);}
function stopSpeech(){speechRunning=false;clearTimeout(speechTimer);speechToken++;window.speechSynthesis?.cancel();qs('#speech-play').textContent='开始逐词播放';}
function stopPlayback(){stopSpeech();qs('#chapter-audio').pause();}
function setupAudio(){
  const tracks=(CHAPTERS[curChap]?.audio||[]).map(id=>AUDIO.find(t=>t.id===id)).filter(Boolean);
  qs('#audio-track').innerHTML=tracks.map(t=>`<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  qs('#audio-mode').querySelector('[value="chapter"]').disabled=!tracks.length||wbMode;
  qs('#audio-mode').value=wbMode||!tracks.length?'speech':'chapter';
  changeAudioMode();
}
function changeAudioMode(){
  stopPlayback();const mode=qs('#audio-mode').value;
  qs('#audio-track').hidden=mode!=='chapter';qs('#local-audio-label').hidden=mode!=='local';
  qs('#recording-controls').hidden=mode==='speech';qs('#speech-controls').hidden=mode!=='speech';
  if(mode==='chapter')loadTrack();
  else if(mode==='speech')qs('#audio-status').textContent='使用浏览器英语语音逐词朗读；点击题号旁的 ▶ 可重听。间隔结束后自动进入下一题。';
  else {qs('#chapter-audio').removeAttribute('src');qs('#chapter-audio').load();qs('#audio-status').textContent='选择本机的教材音频，文件只在当前浏览器播放。';}
}
function loadTrack(){
  const track=AUDIO.find(t=>t.id===qs('#audio-track').value);if(!track)return;
  const player=qs('#chapter-audio');player.pause();player.src=track.url;player.playbackRate=Number(qs('#audio-rate').value);
  qs('#audio-status').textContent='教材原版录音 · 按录音顺序听写，Enter 下一格。录音从 GitHub 加载，也可选择本地音频。';
}
function loadLocalAudio(input){
  if(!input.files[0])return;stopPlayback();if(localAudioURL)URL.revokeObjectURL(localAudioURL);
  localAudioURL=URL.createObjectURL(input.files[0]);qs('#chapter-audio').src=localAudioURL;updateAudioRate();qs('#audio-status').textContent='本地音频：'+input.files[0].name;
}
function updateAudioRate(){qs('#chapter-audio').playbackRate=Number(qs('#audio-rate').value);}
function seekAudio(seconds){const p=qs('#chapter-audio');if(Number.isFinite(p.duration))p.currentTime=Math.min(p.duration,Math.max(0,p.currentTime+seconds));}
function speakWord(index,continuous=false){
  if(!curWords[index])return;
  if(!('speechSynthesis' in window)){qs('#audio-status').textContent='当前浏览器不支持语音朗读，请使用支持英语语音的 Chrome、Edge 或 Safari。';return;}
  clearTimeout(speechTimer);speechToken++;const token=speechToken;window.speechSynthesis.cancel();qs('#chapter-audio').pause();
  if(!continuous){speechRunning=false;qs('#speech-play').textContent='开始逐词播放';}
  activeWord=index;document.getElementById('inp-'+index)?.focus();document.getElementById('row-'+index)?.scrollIntoView({block:'nearest'});
  const word=curWords[index],utterance=new SpeechSynthesisUtterance(word.speech||word.w);
  const voices=window.speechSynthesis.getVoices();const voice=voices.find(v=>v.lang==='en-GB')||voices.find(v=>v.lang.startsWith('en'));
  if(voice)utterance.voice=voice;utterance.lang='en-GB';utterance.rate=Number(qs('#audio-rate').value);
  utterance.onend=()=>{
    if(token!==speechToken||!speechRunning)return;
    speechTimer=setTimeout(()=>{if(token!==speechToken||!speechRunning)return;if(index+1<curWords.length)speakWord(index+1,true);else stopSpeech();},Number(qs('#speech-gap').value)*1000);
  };
  utterance.onerror=e=>{if(token!==speechToken)return;stopSpeech();if(e.error!=='interrupted'&&e.error!=='canceled')qs('#audio-status').textContent='英语语音暂不可用，请检查系统语音设置或使用教材录音。';};
  window.speechSynthesis.speak(utterance);
}
function toggleSpeech(){if(speechRunning)stopSpeech();else{speechRunning=true;qs('#speech-play').textContent='暂停逐词播放';speakWord(activeWord,true);}}
function togglePlayback(){if(qs('#audio-mode').value==='speech')toggleSpeech();else{const p=qs('#chapter-audio');if(p.paused)p.play().catch(()=>{qs('#audio-status').textContent='音频尚未就绪，请稍后重试或选择本地音频。';});else p.pause();}}
qs('#chapter-audio').addEventListener('error',()=>{if(qs('#chapter-audio').getAttribute('src'))qs('#audio-status').textContent='录音加载失败。可切换“本地音频”选择已下载的 MP3，或切换“逐词朗读”继续。';});
qs('#chapter-audio').addEventListener('pause',saveDraft);
document.addEventListener('keydown',e=>{
  if(!qs('#sc-dict').classList.contains('on'))return;
  if(e.altKey&&e.code==='KeyP'){e.preventDefault();togglePlayback();}
  if(e.altKey&&e.code==='KeyR'){e.preventDefault();if(qs('#audio-mode').value==='speech')speakWord(activeWord);else seekAudio(-5);}
});
window.addEventListener('beforeunload',saveDraft);
function download(filename,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvCell(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function exportRows(rows,name){
  if(!rows.length){notify('没有可导出的错题。');return;}
  const data=[['章节','正确答案','我的答案','释义','音标','错误次数','最近练习','状态'],...rows.map(w=>[w.chap,w.word,w.typed,w.mean,w.phon,w.n,w.d,w.mastered?'已掌握':'待复习'])];
  download(name+'-'+new Date().toISOString().slice(0,10)+'.csv','\uFEFF'+data.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
function exportWb(){exportRows(Object.values(getWb()).filter(w=>qs('#wb-mastered').checked||!w.mastered),'王陆错题');}
function exportSessionWrong(){exportRows((window.lastWrong||[]).map(w=>({word:w.w,chap:w.chap,mean:w.m,phon:w.p,typed:w.typed,n:1,d:new Date().toISOString()})),'本次错题');}
function exportBackup(){download('王陆听写备份-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(getStore(),null,2),'application/json');}
function toImport(){
  showScreen('import');activateTab('import');const state=getStore();
  qs('#current-data-info').textContent=`${Object.values(state.hist).reduce((n,a)=>n+a.length,0)} 次练习 · ${Object.keys(state.wb).length} 条错题。记录保存在当前浏览器，建议定期导出备份。`;
}
function doImport(){
  const result=qs('#import-result');
  try{
    const incoming=JSON.parse(qs('#import-input').value);if(!incoming||!incoming.hist||!incoming.wb)throw Error('需要包含 hist 和 wb 的 JSON 备份。');
    const state=getStore();let count=0;
    for(const [chap,sessions] of Object.entries(incoming.hist)){
      if(!Array.isArray(sessions)||!(/^[0-9]+\.[0-9]+(?:-[a-z0-9]+)?$/.test(chap)||chap==='__wb__'))throw Error('章节记录格式无效。');
      if(!state.hist[chap])state.hist[chap]=[];
      for(const session of sessions){
        if(!session||!Number.isFinite(session.pct)||!Number.isFinite(session.total)||!Number.isFinite(session.correct)||!Number.isFinite(Date.parse(session.date)))throw Error('听写记录格式无效。');
        for(const list of [session.all||[],session.wrong||[]])if(!Array.isArray(list)||list.some(w=>!w||typeof w.w!=='string'))throw Error('答案格式无效。');
        if(state.hist[chap].some(s=>session.id?s.id===session.id:s.date===session.date&&s.total===session.total&&s.pct===session.pct))continue;
        state.hist[chap].push({...session,n:state.hist[chap].length+1});count++;
      }
    }
    for(const w of Object.values(incoming.wb)){
      if(!w||typeof w.word!=='string'||!Number.isFinite(w.n))throw Error('错题格式无效。');
      if(w.chap&&!/^[0-9]+\.[0-9]+(?:-[a-z0-9]+)?$/.test(w.chap))throw Error('错题章节格式无效。');
      const key=wordKey(w),old=state.wb[key];if(!old||w.n>old.n)state.wb[key]={...w,mastered:!!w.mastered};
    }
    if(!setLS('wl4_state',state))return;result.style.color='var(--gb)';result.textContent=`已合并 ${count} 条新记录；重复导入不会重复累计。`;toImport();
  }catch(e){result.style.color='var(--rb)';result.textContent='导入失败：'+e.message;}
}
function clearAllData(){
  if(!confirm('确定清空所有听写记录、错题和草稿？请先导出备份。'))return;
  if(!setLS('wl4_state',{version:4,hist:{},wb:{}}))return;
  localStorage.removeItem('wl4_draft');toImport();
}
async function init(){
  try{
    const [corpus,audio]=await Promise.all(['data/corpus.json','data/audio.json'].map(async path=>{const r=await fetch(path);if(!r.ok)throw Error(path+' 加载失败');return r.json();}));
    if(corpus.schemaVersion!==1||!Array.isArray(corpus.chapters)||!Array.isArray(audio.tracks))throw Error('词库格式不正确');
    CORPUS=corpus;AUDIO=audio.tracks;
    corpus.chapters.forEach(c=>{CHAPTERS[c.id]=c;VOCAB[c.id]=c.words;});renderHome();

  }catch(e){qs('.home-hero p').textContent='词库未加载';qs('#home-status').textContent=location.protocol==='file:'?'请通过本地服务器打开：在项目目录运行 python3 -m http.server 8000，再访问 http://localhost:8000。':'加载失败，请刷新重试。'+e.message;}
}
init();
