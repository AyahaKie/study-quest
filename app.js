'use strict';
/* Study Quest 2.0 — local-only PWA. No personal schedules, exams or subjects are bundled. */
const VERSION='2.0.0', STORAGE='studyquest_v2', TIMER_STORAGE='studyquest_timer_v2';
const $=id=>document.getElementById(id);
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>globalThis.crypto?.randomUUID?.()||('sq'+Date.now()+Math.random().toString(36).slice(2));
const pad=n=>String(n).padStart(2,'0');
const day=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dateAt=s=>new Date(`${s}T12:00:00`);
const shiftDay=(d,n)=>day(new Date(dateAt(d).getTime()+n*86400000));
const diffDay=(a,b)=>Math.round((dateAt(b)-dateAt(a))/86400000);
const jpDate=d=>`${dateAt(d).getMonth()+1}月${dateAt(d).getDate()}日(${['日','月','火','水','木','金','土'][dateAt(d).getDay()]})`;
const fmtMin=n=>n==null?'未算出':(n>=60?`${Math.floor(n/60)}時間${n%60?`${Math.round(n%60)}分`:''}`:`${Math.round(n)}分`);
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const number=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const sum=(items,fn=x=>x)=>items.reduce((a,x)=>a+number(fn(x)),0);
const escAttr=html;const pct=(n,d)=>d>0?clamp(Math.round(n/d*100),0,100):0;
const fmtTime=ms=>`${pad(Math.floor(ms/60000))}:${pad(Math.floor((ms%60000)/1000))}`;
const fileSafe=s=>String(s).replace(/[^a-zA-Z0-9_-]/g,'-');
const timeNow=()=>{const d=new Date();return `${pad(d.getHours())}:${pad(d.getMinutes())}`};
const defaults=()=>({
 version:2,createdAt:new Date().toISOString(),xp:0,coins:0,
 exams:[],subjects:[],materials:[],sessions:[],scores:[],events:[],reviews:[],purchases:[],
 rewards:[{id:'starter_cafe',name:'カフェで勉強',cost:100,starter:true},{id:'starter_sweets',name:'好きなスイーツ',cost:150,starter:true},{id:'starter_merch',name:'音楽グッズ',cost:500,starter:true},{id:'starter_special',name:'特別なごほうび',cost:1000,starter:true}],
 dayModes:{},bufferDays:{},daysOff:{},dayStatus:{},missionClaims:{},achievements:{},equippedTitle:null,
 settings:{bufferMinutes:60,focusMinutes:25,shortBreak:5,longBreak:15,longEvery:4,reminderTime:'20:00',notifyStudy:true,notifyExams:true,notifyReview:true,notifyMission:true},
});
function normalize(data){if(!data||typeof data!=='object'||Number(data.version)!==2)throw Error('対応していないバックアップ形式です');const base=defaults();const x={...base,...data,settings:{...base.settings,...(data.settings||{})}};
 for(const k of ['exams','subjects','materials','sessions','scores','events','reviews','purchases','rewards'])if(!Array.isArray(x[k]))x[k]=[];
 for(const k of ['dayModes','bufferDays','daysOff','dayStatus','missionClaims','achievements'])if(!x[k]||typeof x[k]!=='object'||Array.isArray(x[k]))x[k]={};
 x.xp=Math.max(0,number(x.xp));x.coins=Math.max(0,number(x.coins));return x;
}
let db;try{db=normalize(JSON.parse(localStorage.getItem(STORAGE)))}catch(e){db=defaults()}
function save(){try{localStorage.setItem(STORAGE,JSON.stringify(db));return true}catch(e){toast('保存できませんでした。容量を確認してください');return false}}
function modify(fn){fn();save();completeAchievements();completeMissions();redraw()}
const subject=id=>db.subjects.find(x=>x.id===id);
const exam=id=>db.exams.find(x=>x.id===id);
const material=id=>db.materials.find(x=>x.id===id);
const review=id=>db.reviews.find(x=>x.id===id);
const examSubjects=e=>(e?.subjectIds||[]).map(subject).filter(Boolean);
const subjectExams=id=>db.exams.filter(e=>(e.subjectIds||[]).includes(id));
const focusSubjectIds=examId=>examId?(exam(examId)?.subjectIds||[]):db.subjects.map(s=>s.id);
const sessionsFor=(d,exid='',sid='')=>db.sessions.filter(s=>(!d||s.date===d)&&(!sid||s.subjectId===sid)&&(!exid||focusSubjectIds(exid).includes(s.subjectId)));
const reviewsDue=(d=day())=>db.reviews.filter(r=>r.status!=='done'&&r.due<=d);
const minutesDay=d=>sum(sessionsFor(d),s=>s.minutes);
const minutesSubject=(sid,from=null,to=null)=>sum(db.sessions.filter(s=>s.subjectId===sid&&(!from||s.date>=from)&&(!to||s.date<=to)),s=>s.minutes);
const correctStats=(sid=null,examId=null)=>{const logs=db.sessions.filter(s=>(!sid||s.subjectId===sid)&&(!examId||focusSubjectIds(examId).includes(s.subjectId)));return {questions:sum(logs,s=>s.questions),correct:sum(logs,s=>s.correct),newQuestions:sum(logs.filter(s=>!s.reviewId),s=>s.questions),reviewQuestions:sum(logs.filter(s=>s.reviewId),s=>s.questions)};};
const subjectAccuracy=sid=>{const x=correctStats(sid);return x.questions?x.correct/x.questions:null};
function levelInfo(){let level=1,spent=0,cost=70;while(db.xp>=spent+cost&&level<500){spent+=cost;level++;cost=Math.round(70+(level-1)*30)}return{level,current:db.xp-spent,next:cost,pct:pct(db.xp-spent,cost)}}
function streak(){let count=0,d=day();if(minutesDay(d)===0)d=shiftDay(d,-1);while(minutesDay(d)>0&&count<1000){count++;d=shiftDay(d,-1)}return count}
const TAB_INFO=[['home','⌂','ホーム'],['study','◷','学習'],['plan','▦','計画'],['report','▥','分析'],['rewards','✦','報酬'],['settings','⚙','設定']];
let page='home',calendarDay=day(),calendarView='week',reportRange='week',reportExam='',reportSubject='',reportChart='minutes',rewardManage=false,setupTab='exam';
let liveModal=null,toastTimeout=null,importCandidate=null,restoreBackupConfirmed=false;
function toast(message){const el=$('toast');if(!el)return;el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.add('hidden'),3800)}
function openModal(title,body,options=''){liveModal={title};$('modalBox').innerHTML=`<div class="section-head"><h2 id="modalTitle">${html(title)}</h2><button class="btn small secondary" data-action="modal-close" aria-label="閉じる">✕</button></div>${body}${options}`;$('modalOverlay').classList.remove('hidden');$('modalBox').scrollTop=0}
function closeModal(){$('modalOverlay').classList.add('hidden');$('modalBox').innerHTML='';liveModal=null}
const btn=(label,action,extra='',cls='secondary')=>`<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const field=(label,name,value='',type='text',other='')=>`<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${escAttr(value)}" ${other}></div>`;
const textArea=(label,name,value='')=>`<div class="field"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}">${html(value)}</textarea></div>`;
const choose=(label,name,opts,selected='',extra='')=>`<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" ${extra}>${opts.map(o=>`<option value="${escAttr(o[0])}" ${String(o[0])===String(selected)?'selected':''}>${html(o[1])}</option>`).join('')}</select></div>`;
const box=(title,content,extra='')=>`<section class="card ${extra}"><div class="section-head"><h2>${title}</h2></div>${content}</section>`;
const row=(name,value)=>`<div class="value-row"><span class="muted">${name}</span><b>${value}</b></div>`;
const stat=(name,value,sub='')=>`<div class="stat"><label>${name}</label><strong>${value}</strong>${sub?`<small>${sub}</small>`:''}</div>`;
function redraw(preserveScroll=true){const pos=window.scrollY;render();if(preserveScroll)requestAnimationFrame(()=>window.scrollTo({top:pos,behavior:'instant'}))}
function go(p){if(!TAB_INFO.some(x=>x[0]===p))return;page=p;render();window.scrollTo({top:0,behavior:'instant'})}
function render(){const d=day();const current=TAB_INFO.find(t=>t[0]===page);$('topbar').innerHTML=`<div class="heading"><div><div class="eyebrow">${page==='home'?'MY STUDY JOURNEY':html(current[2]).toUpperCase()}</div><h1>${page==='home'?'✦ Study Quest':html(current[2])}</h1><div class="subtitle">${page==='home'?'今日の一歩を、未来の力に。':'無理なく続ける、私の学習管理'}</div></div><span class="heading-chip">${jpDate(d)}</span></div>`;
 $('nav').innerHTML=TAB_INFO.map(([key,icon,name])=>`<button type="button" class="nav-button ${key===page?'active':''}" data-action="nav" data-page="${key}" aria-current="${key===page?'page':'false'}"><span class="nav-icon">${icon}</span><span>${name}</span></button>`).join('');
 let content='';try{content=({home:renderHome,study:renderStudy,plan:renderPlan,report:renderReport,rewards:renderRewards,settings:renderSettings})[page]()}catch(e){console.error(e);content=box('表示エラー',`<p class="muted">画面を読み込めませんでした。バックアップを保存してから再読み込みしてください。</p><code>${html(e.message)}</code>`)}$('page').innerHTML=content;
 if(page==='study')paintTimer();}
/* XP, rewards and titles are independent: spending coins does not reduce XP or level. */
const ACHIEVEMENTS=[
 {id:'first',title:'最初の一歩',desc:'学習記録を1件残す',check:()=>db.sessions.length>=1},
 {id:'sprout',title:'集中の芽',desc:'累計60分学習',check:()=>sum(db.sessions,s=>s.minutes)>=60},
 {id:'steady',title:'3日続けた人',desc:'3日連続学習',check:()=>streak()>=3},
 {id:'week',title:'習慣のつくり手',desc:'7日連続学習',check:()=>streak()>=7},
 {id:'tenhours',title:'積み重ねの達人',desc:'累計10時間学習',check:()=>sum(db.sessions,s=>s.minutes)>=600},
 {id:'hundred',title:'問題ハンター',desc:'新規問題を100問解く',check:()=>correctStats().newQuestions>=100},
 {id:'accuracy',title:'正確さの探究者',desc:'累計50問以上で正答率80%以上',check:()=>{const a=correctStats();return a.questions>=50&&a.correct/a.questions>=.8}},
 {id:'progress',title:'教材コンプリート',desc:'登録教材を1つ完了',check:()=>db.materials.some(m=>m.total>0&&m.done>=m.total)},
 {id:'early',title:'朝の挑戦者',desc:'午前中にタイマー学習',check:()=>db.sessions.some(s=>s.source==='timer'&&s.startHour!=null&&s.startHour<12)},
 {id:'journey',title:'学びの旅人',desc:'学習記録30件',check:()=>db.sessions.length>=30},
];
function completeAchievements(){let unlocked=0;for(const a of ACHIEVEMENTS){if(!db.achievements[a.id]&&a.check()){db.achievements[a.id]={date:day()};unlocked++}}if(unlocked){save();toast(`新しい実績を${unlocked}個獲得！`)}}
function missionDefs(d=day()){const s=sessionsFor(d),minutes=sum(s,x=>x.minutes),a=correctStats(null,null),due=db.reviews.filter(r=>r.status==='done'&&r.completed===d).length;const favorite=bestSubjects(1)[0]?.s;
 return[{id:'start',label:'学習を1回記録する',detail:`${s.length}回`,done:s.length>=1},
 {id:'minutes',label:'25分集中する',detail:`${minutes}/25分`,done:minutes>=25},
 {id:'problems',label:'問題を10問解く',detail:`${sum(s,x=>x.questions)}/10問`,done:sum(s,x=>x.questions)>=10},
 {id:'review',label:'復習を1件完了する',detail:`${due}件`,done:due>=1}];}
function completeMissions(){const d=day();if(db.dayModes[d]==='rest')return;db.missionClaims[d]??={};let gained=0;for(const m of missionDefs(d)){if(m.done&&!db.missionClaims[d][m.id]){db.missionClaims[d][m.id]=true;gained++}}if(gained){db.xp+=gained*10;db.coins+=gained*2;save()}}
function earnSession(s){if(!s.id)s.id=uid();let xp=Math.max(1,Math.round(s.minutes*2))+Math.max(0,number(s.questions))*2+(s.questions>0&&s.correct/s.questions>=.8?5:0);s.xp=xp;s.coins=Math.floor(xp/12);db.xp+=xp;db.coins+=s.coins;db.sessions.push(s);applyMaterialProgress(s);scheduleReview(s);save();completeAchievements();completeMissions();return xp}
function applyMaterialProgress(s){if(!s.materialId||!number(s.unitsDone))return;const m=material(s.materialId);if(!m)return;m.done=clamp(number(m.done)+number(s.unitsDone),0,m.total);}
function scheduleReview(s){const errors=Math.max(0,number(s.questions)-number(s.correct));if(!errors||s.reviewId||!s.subjectId)return;const now=s.date;const due=shiftDay(now,1);db.reviews.push({id:uid(),subjectId:s.subjectId,examId:s.examId||'',topicId:s.topicId||'',materialId:s.materialId||'',sourceSessionId:s.id,due,created:now,count:errors,stage:0,status:'due',completed:null})}
function bestSubjects(count=5){const ds=day();const options=[];for(const e of db.exams){const days=diffDay(ds,e.date);if(days<0)continue;for(const sid of e.subjectIds||[]){const s=subject(sid);if(!s)continue;const accuracy=subjectAccuracy(sid);const due=db.reviews.filter(r=>r.subjectId===sid&&r.status!=='done'&&r.due<=ds).length;
 const mats=db.materials.filter(m=>m.subjectId===sid);const unfinished=sum(mats,m=>m.total>0?1-m.done/m.total:0);
 const timeSince=Math.max(0,diffDay(db.sessions.filter(x=>x.subjectId===sid).map(x=>x.date).sort().at(-1)||shiftDay(ds,-14),ds));
 const lastScore=db.scores.filter(x=>x.examId===e.id).sort((a,b)=>b.date.localeCompare(a.date))[0];const scoreGap=lastScore&&e.targetScore!=null?Math.max(0,number(e.targetScore)-lastScore.score)/Math.max(1,lastScore.max):0;
 const score=70/Math.sqrt(Math.max(1,days+1))+30*(accuracy==null?.55:1-accuracy)+due*10+unfinished*8+Math.min(10,timeSince/2)+scoreGap*25;
 options.push({e,s,days,score,due,accuracy})}}
 // Shared subjects can appear in multiple exam plans; rank each exam but do not double-count study sessions.
 return options.sort((a,b)=>b.score-a.score).slice(0,count)}
function upcomingExams(n=5){return db.exams.filter(e=>diffDay(day(),e.date)>=0).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,n)}
function dayMode(d=day()){return db.dayModes[d]||'normal'}
function dayRest(d=day()){return dayMode(d)==='rest'||Boolean(db.bufferDays[d])}
/* Calendar, recurring life events, Buffer and achievable study windows. */
const minuteOf=t=>{const m=/^(\d{2}):(\d{2})$/.exec(t||'');return m?Number(m[1])*60+Number(m[2]):0};
const prettyMinute=n=>`${pad(Math.floor(n/60)%24)}:${pad(n%60)}`;
function eventOccurs(e,d){if(e.date>d)return false;const delta=diffDay(e.date,d),wd=dateAt(d).getDay();switch(e.repeat){case'daily':return true;case'weekdays':return wd!==0&&wd!==6;case'weekly':return delta%7===0;case'monthly':return dateAt(e.date).getDate()===dateAt(d).getDate();default:return e.date===d;}}
function eventsOn(d){return db.events.filter(e=>eventOccurs(e,d)).sort((a,b)=>a.start.localeCompare(b.start))}
function intervals(d){const result=[];for(const e of db.events){const start=minuteOf(e.start),end=minuteOf(e.end);if(eventOccurs(e,d)){if(end>start)result.push({start,end,event:e});else if(end<start){result.push({start,end:1440,event:e})}else if(start===end)result.push({start:0,end:1440,event:e})}if(end<start&&eventOccurs(e,shiftDay(d,-1)))result.push({start:0,end,event:e});}
 const status=db.dayStatus[d]||{};for(const x of result){if(x.event.kind==='work'&&status.homeAt&&x.end<=1440&&x.start<x.end)x.end=clamp(minuteOf(status.homeAt),x.start,1440);if(x.event.kind==='meal'&&status.dinnerEnded&&x.start<x.end)x.end=clamp(minuteOf(status.dinnerEnded),x.start,1440);if(x.event.kind==='meal'&&status.dinnerStarted&&x.start<x.end)x.start=clamp(minuteOf(status.dinnerStarted),0,x.end)}return result.filter(x=>x.end>x.start)}
function mergeIntervals(xs){let merged=[];for(const x of [...xs].sort((a,b)=>a.start-b.start)){let last=merged.at(-1);if(last&&x.start<=last.end)last.end=Math.max(last.end,x.end);else merged.push({start:x.start,end:x.end})}return merged}
function availableOn(d){if(dayRest(d))return{known:true,minutes:0,provisional:false,slots:[],reason:dayMode(d)==='rest'?'休養日':'Buffer Day'};
 const ev=eventsOn(d),past=eventsOn(shiftDay(d,-1));const hasSleep=ev.some(e=>e.kind==='sleep')||past.some(e=>e.kind==='sleep');const hasMeals=ev.some(e=>e.kind==='meal');const hasWork=ev.some(e=>e.kind==='work')||Boolean(db.daysOff[d]);
 if(!(hasSleep&&hasMeals&&hasWork))return{known:false,minutes:null,provisional:true,slots:[],reason:'睡眠・食事・仕事（または休日）の登録が必要です'};
 const status=db.dayStatus[d]||{};const provisional=ev.some(e=>e.certainty==='flexible'&&((e.kind==='work'&&!status.homeAt)||(e.kind==='meal'&&!status.dinnerEnded)||(e.kind!=='meal'&&e.kind!=='work')));
 const occupied=mergeIntervals(intervals(d));let slots=[],cursor=0;for(const x of occupied){if(x.start>cursor)slots.push({start:cursor,end:x.start});cursor=Math.max(cursor,x.end)}if(cursor<1440)slots.push({start:cursor,end:1440});
 if(d===day()){const now=new Date();const from=now.getHours()*60+now.getMinutes();slots=slots.map(x=>({start:Math.max(x.start,from),end:x.end})).filter(x=>x.end>x.start)}
 const buffer=number(db.settings.bufferMinutes,60);let left=Math.max(0,sum(slots,x=>x.end-x.start)-buffer);return{known:true,minutes:left,provisional,slots,reason:provisional?'未確定の生活予定を含む暫定値です':'登録された生活予定から算出（未登録の移動等は含まれません）'};}
function workload(d=day()){
 if(dayRest(d))return{known:true,minutes:0,reason:'休養日・Buffer Day',partial:0};
 const upcoming=db.exams.filter(e=>diffDay(d,e.date)>=0);
 if(!upcoming.length)return{known:false,minutes:null,reason:'試験を登録すると必要な学習量を推定します',partial:0};
 const subjTargets=new Map();for(const e of upcoming)for(const sid of (e.subjectIds||[])){
  const current=subjTargets.get(sid);if(!current||e.date<current.date)subjTargets.set(sid,{date:e.date,examName:e.name});}
 if(!subjTargets.size)return{known:false,minutes:null,reason:'試験に科目を登録してください',partial:0};
 let need=0,unknown=0;
 for(const [sid,target] of subjTargets){const mats=db.materials.filter(m=>m.subjectId===sid&&m.total>0);if(!mats.length){unknown++;continue}
 for(const m of mats){const remaining=Math.max(0,number(m.total)-number(m.done));if(!remaining)continue;
  const records=db.sessions.filter(s=>s.materialId===m.id&&s.unitsDone>0&&s.minutes>0);
  const paced=sum(records,s=>s.minutes)/sum(records,s=>s.unitsDone);const minutesPerUnit=number(m.minutesPerUnit)>0?number(m.minutesPerUnit):paced;
  if(!Number.isFinite(minutesPerUnit)||minutesPerUnit<=0){unknown++;continue}
  const days=Math.max(1,diffDay(d,target.date)+1);need+=remaining*minutesPerUnit/days;
 }}
 if(unknown)return{known:false,minutes:null,reason:`${unknown}件の教材・学習ペースが未確定です。教材の総量と1単位あたりの所要時間、または学習実績を登録してください。`,partial:Math.ceil(need/5)*5};
 return{known:true,minutes:Math.ceil(need/5)*5,reason:'教材残量÷試験までの日数×実績ペースの暫定値。合格の保証ではありません',partial:need};
}
function proposeSlots(d){const a=availableOn(d),w=workload(d);if(!a.known)return[];
 let budget=dayRest(d)?0:(w.known?Math.min(w.minutes,a.minutes):Math.min(25,a.minutes));if(dayMode(d)==='busy')budget=Math.min(budget,40);let slots=[];for(const x of a.slots){if(budget<10)break;const free=x.end-x.start;if(free<15)continue;const length=Math.min(40,free,budget);if(length<10)continue;slots.push({start:x.start,end:x.start+length});budget-=length;if(slots.length>=6)break}return slots;}
function planSummary(d){const w=workload(d),a=availableOn(d),rec=bestSubjects(1)[0],buffer=number(db.settings.bufferMinutes,60),status=db.dayStatus[d]||{},rest=dayRest(d);
 const forecast=n=>{const vals=Array.from({length:n},(_,i)=>{const date=shiftDay(d,i);return db.exams.some(e=>e.date>=date)?workload(date):{known:true,minutes:0}});return db.exams.length&&vals.every(x=>x.known)?sum(vals,x=>x.minutes):null};
 const weekTarget=forecast(7),monthTarget=forecast(30);
 let deficit=w.known&&a.known?Math.max(0,w.minutes-a.minutes):null;
 return `<div class="subcard"><div class="section-head" style="margin-bottom:7px"><h3>${jpDate(d)} の学習計画</h3><span class="badge ${rest?'warm':''}">${rest?'休養・調整':dayMode(d)==='busy'?'忙しい日':'通常日'}</span></div>
 ${row('合格に向けた必要量の暫定目安',w.known?fmtMin(w.minutes):'算出待ち')}
 ${row('生活上の学習可能時間',a.known?`${fmtMin(a.minutes)}${a.provisional?'（暫定）':''}`:'未確定')}
 ${row('7日間の必要量（暫定）',weekTarget!=null?fmtMin(weekTarget):'算出待ち')}
 ${row('30日間の必要量（暫定）',monthTarget!=null?fmtMin(monthTarget):'算出待ち')}
 ${row('Buffer（予備時間）',`${buffer}分`)}
 ${deficit>0?`<p class="notice warning">必要量に対して${fmtMin(deficit)}不足する見込み。優先順位・日程・休養を見直せます。</p>`:''}
 ${rec?`<p class="muted" style="margin-top:10px">優先候補：<b>${html(rec.s.name)}</b>（${html(rec.e.name)}）</p>`:''}
 <p class="tiny">${html(w.reason)}</p><p class="tiny">${html(a.reason)}</p>
 ${a.known&&!rest&&a.minutes>0?`<details class="accordion"><summary>学習時間帯の提案を見る</summary><div class="accordion-content">${proposeSlots(d).map(x=>`<div class="item"><b>${prettyMinute(x.start)}〜${prettyMinute(x.end)}</b> <span class="muted">集中学習の候補</span></div>`).join('')||'<p class="muted">空き時間がまだ少ないため提案できません。</p>'}<p class="tiny">空き時間の提案であり、予定を自動追加しません。</p></div></details>`:''}
 </div>`}
function calendarCells(){const selected=dateAt(calendarDay);const first=calendarView==='month'?new Date(selected.getFullYear(),selected.getMonth(),1):selected;
 const begin=shiftDay(day(first),-first.getDay());const length=calendarView==='month'?42:7;
 return `<div class="calendar-grid">${['日','月','火','水','木','金','土'].map(x=>`<div class="dayname">${x}</div>`).join('')}
 ${Array.from({length},(_,i)=>{const d=shiftDay(begin,i),out=calendarView==='month'&&dateAt(d).getMonth()!==selected.getMonth(),events=eventsOn(d),logs=sessionsFor(d),examsHere=db.exams.filter(e=>e.date===d);return `<button type="button" data-action="pick-day" data-date="${d}" aria-label="${jpDate(d)} ${examsHere.length?'試験あり':''}" class="day ${d===calendarDay?'active':''} ${d===day()?'today':''} ${out?'out':''}"><span class="day-number">${dateAt(d).getDate()}</span><span class="day-dots">${events.length?'<i></i>':''}${logs.length?'<i></i>':''}${db.bufferDays[d]?'<i></i>':''}${examsHere.length?'<i class="exam-dot"></i>':''}</span></button>`}).join('')}</div>`}
function renderPlan(){const e=eventsOn(calendarDay),mode=dayMode(calendarDay);
 const calendar=box('マイスケジュール',`<div class="calendar-top">${btn('‹','calendar-prev','','small secondary')}<h3>${dateAt(calendarDay).getFullYear()}年${dateAt(calendarDay).getMonth()+1}月</h3>${btn('›','calendar-next','','small secondary')}</div>
 <div class="seg" style="margin-top:12px">${btn('週','calendar-week','','small '+(calendarView==='week'?'selected':'secondary'))}${btn('月','calendar-month','','small '+(calendarView==='month'?'selected':'secondary'))}${btn('今日','calendar-today','','small secondary')}</div>
 ${calendarCells()}
 ${planSummary(calendarDay)}
 <div class="section-head" style="margin-top:16px"><h3 style="margin:0">この日の予定</h3>${btn('＋ 予定を追加','event-add','','small primary')}</div>
 ${db.exams.filter(x=>x.date===calendarDay).map(ex=>`<div class="event-left exam"><b>試験：${html(ex.name)}</b><div class="tiny">${ex.tentative?'仮日程':'登録日程'}</div></div>`).join('')}
 ${e.length?`<div class="list">${e.map(ev=>`<div class="event-left ${html(ev.kind)}"><div class="value-row"><b>${html(ev.name)}</b>${btn('編集','event-edit',`data-id="${ev.id}"`,'small secondary')}</div><div class="tiny">${html(ev.start)}〜${html(ev.end)} ・ ${html({none:'今回のみ',daily:'毎日',weekdays:'平日',weekly:'毎週',monthly:'毎月'}[ev.repeat])}${ev.certainty==='flexible'?' ・ 時間未確定':''}</div></div>`).join('')}</div>`:'<div class="empty">予定はまだありません</div>'}
 <details class="accordion"><summary>Buffer・休養日の設定</summary><div class="accordion-content"><div class="fields">${field('毎日のBuffer（分）','buffer',db.settings.bufferMinutes,'number','min="0" max="480" step="5"')}${choose('この日のモード','dayMode',[['normal','通常'],['busy','忙しい'],['rest','休養']],mode)}</div><label class="checkline"><input type="checkbox" id="bufferDayCheck" ${db.bufferDays[calendarDay]?'checked':''}>この日をBuffer Dayにする</label><label class="checkline"><input type="checkbox" id="dayOffCheck" ${db.daysOff[calendarDay]?'checked':''}>この日は仕事の予定がない</label>${btn('設定を保存','plan-options-save','','primary block')}<p class="tiny">Buffer Dayは追いつき学習にも休養にも使えます。休む日にもXPの減点はありません。</p></div></details>
 `);
 const eList=db.exams.map(e=>`<div class="item"><div class="item-title">${html(e.name)}</div><div class="item-sub">${jpDate(e.date)}${e.tentative?' ・ 仮日程':''} ・ ${examSubjects(e).length}科目</div><div class="item-actions">${btn('編集','exam-edit',`data-id="${e.id}"`,'small secondary')}${btn('科目を割り当て','exam-link',`data-id="${e.id}"`,'small secondary')}${btn('削除','exam-delete',`data-id="${e.id}"`,'small danger')}</div></div>`).join('');
 const subjects=db.subjects.map(s=>`<div class="item"><div class="item-title">${html(s.name)}</div><div class="item-sub">${subjectExams(s.id).length}試験で共通利用 ・ ${s.topics.length}分野</div><div class="item-actions">${btn('分野を追加','topic-add',`data-id="${s.id}"`,'small secondary')}${btn('編集','subject-edit',`data-id="${s.id}"`,'small secondary')}${btn('削除','subject-delete',`data-id="${s.id}"`,'small danger')}</div></div>`).join('');
 const mats=db.materials.map(m=>`<div class="item"><div class="item-title">${html(m.name)}</div><div class="item-sub">${html(subject(m.subjectId)?.name||'科目未設定')} ・ ${m.done}/${m.total} ${html(m.unit)} ・ ${pct(m.done,m.total)}%</div><div class="progress"><span style="width:${pct(m.done,m.total)}%"></span></div><div class="item-actions">${btn('進捗を更新','material-progress',`data-id="${m.id}"`,'small secondary')}${btn('編集','material-edit',`data-id="${m.id}"`,'small secondary')}${btn('削除','material-delete',`data-id="${m.id}"`,'small danger')}</div></div>`).join('');
 return calendar+box('試験・科目・教材',`<div class="button-row">${btn('＋ 試験','exam-add','','small primary')}${btn('＋ 科目','subject-add','','small secondary')}${btn('＋ 教材','material-add','','small secondary')}</div>
 <details class="accordion" open><summary>登録した試験（${db.exams.length}件）</summary><div class="accordion-content">${eList||'<div class="empty">試験を登録すると、日程をもとに優先科目を提案します</div>'}</div></details>
 <details class="accordion"><summary>共通科目と分野（${db.subjects.length}件）</summary><div class="accordion-content">${subjects||'<div class="empty">科目は複数の試験で共通して使えます</div>'}</div></details>
 <details class="accordion"><summary>教材と進捗（${db.materials.length}件）</summary><div class="accordion-content">${mats||'<div class="empty">教材を登録すると進捗を記録できます</div>'}</div></details>
 <p class="tiny">試験の優先度と必要学習時間はアプリが判断します。教材の進捗と実績が不足する間は推定値を断定しません。</p>`);
}
/* User-initiated editors: all entered values live in browser storage, never in public files. */
function examEditor(id=null){const e=id?exam(id):null;openModal(e?'試験を編集':'試験を追加',`<form id="examForm" class="form-stack" data-id="${e?.id||''}">${field('試験名','name',e?.name||'','text','required maxlength="80"')}
 ${field('試験日','date',e?.date||shiftDay(day(),30),'date','required')}
 <label class="checkline"><input type="checkbox" name="tentative" ${e?.tentative?'checked':''}>仮日程として登録</label>
 ${field('目標点（任意）','targetScore',e?.targetScore??'','number','min="0" step="0.1" placeholder="例：800"')}
 <p class="tiny">優先度の入力は不要です。試験日・進捗・苦手度で自動判断します。</p>
 <div class="modal-actions">${btn('キャンセル','modal-close','','secondary')}<button class="btn primary" type="submit">保存する</button></div></form>`)}
function subjectEditor(id=null){const s=id?subject(id):null;openModal(s?'科目を編集':'科目を登録',`<form id="subjectForm" data-id="${s?.id||''}" class="form-stack">
 ${field('科目名','name',s?.name||'','text','required maxlength="70"')}
 <p class="tiny">同じ科目を別の試験にも割り当てると、学習履歴・教材の進捗を共有します。</p>
 <div class="modal-actions">${btn('キャンセル','modal-close')}<button class="btn primary" type="submit">保存する</button></div></form>`)}
function linkEditor(exid){const e=exam(exid);if(!e)return;openModal(`「${e.name}」の科目`, `<form id="linkForm" data-id="${e.id}"><div class="form-stack">${db.subjects.length?db.subjects.map(s=>`<label class="checkline"><input type="checkbox" name="subjectIds" value="${s.id}" ${(e.subjectIds||[]).includes(s.id)?'checked':''}>${html(s.name)}</label>`).join(''):'<p class="muted">先に科目を登録してください</p>'}</div><div class="modal-actions">${btn('キャンセル','modal-close')}<button type="submit" class="btn primary">割り当てを保存</button></div></form>`)}
function topicEditor(sid){const s=subject(sid);if(!s)return;openModal(`「${s.name}」に分野を追加`,`<form id="topicForm" data-id="${sid}" class="form-stack">${field('分野名','name','','text','required maxlength="75"')}<div class="modal-actions">${btn('キャンセル','modal-close')}<button type="submit" class="btn primary">追加する</button></div></form>${s.topics.length?`<div class="divider"></div><div class="tiny">現在の分野：${s.topics.map(x=>html(x.name)).join('／')}</div>`:''}`)}
function materialEditor(id=null){const m=id?material(id):null;openModal(m?'教材を編集':'教材を登録',`<form id="materialForm" class="form-stack" data-id="${m?.id||''}">
 ${field('教材名','name',m?.name||'','text','required maxlength="90"')}
 ${choose('科目','subjectId',db.subjects.map(s=>[s.id,s.name]),m?.subjectId||db.subjects[0]?.id||'','required')}
 ${choose('進捗の単位','unit',[['講義','講義'],['ページ','ページ'],['問題','問題'],['章','章・単元'],['回','回'],['その他','その他']],m?.unit||'講義')}
 <div class="fields">${field('総量','total',m?.total??'','number','required min="1" step="1"')}${field(m?'現在の完了数':'登録時の完了数','done',m?.done??0,'number','required min="0" step="1"')}</div>
 ${field('1単位の目安時間（任意・分）','minutesPerUnit',m?.minutesPerUnit??'','number','min="0" step="0.5" placeholder="学習記録から自動推定も可能"')}
 <p class="tiny">登録時の完了数は、アプリ使用前に終わっていた分です。以降は記録時の進捗数を加算し、二重計上を防ぎます。</p>
 <div class="modal-actions">${btn('キャンセル','modal-close')}<button class="btn primary" type="submit">保存する</button></div></form>`)}
function progressEditor(id){const m=material(id);if(!m)return;openModal(`教材進捗：${m.name}`,`<form id="progressForm" class="form-stack" data-id="${id}"><div class="notice">${html(m.unit)}：全${m.total}／現在${m.done}（${pct(m.done,m.total)}%）</div>${field('現在の完了数','done',m.done,'number',`min="0" max="${m.total}" step="1" required`)}<p class="tiny">過去の学習記録に加算せず、進捗だけを補正します。</p><div class="modal-actions">${btn('キャンセル','modal-close')}<button class="btn primary" type="submit">更新する</button></div></form>`)}
function eventEditor(id=null){const e=id?db.events.find(x=>x.id===id):null;openModal(e?'予定を編集':'予定を追加',`<form id="eventForm" class="form-stack" data-id="${e?.id||''}">
 ${field('予定名','name',e?.name||'','text','required maxlength="80" placeholder="仕事・夕食・睡眠など"')}
 ${field('日付（繰り返しの開始日）','date',e?.date||calendarDay,'date','required')}
 <div class="fields">${field('開始','start',e?.start||'18:00','time','required')}${field('終了','end',e?.end||'19:00','time','required')}</div>
 <div class="fields">${choose('繰り返し','repeat',[['none','今回だけ'],['daily','毎日'],['weekdays','平日'],['weekly','毎週'],['monthly','毎月']],e?.repeat||'none')}${choose('予定の確実性','certainty',[['fixed','時間が決まっている'],['flexible','時間が変わりやすい']],e?.certainty||'fixed')}</div>
 ${choose('予定の種類','kind',[['sleep','睡眠'],['work','仕事・用事'],['meal','食事'],['life','移動・生活'],['free','自由時間・休息']],e?.kind||'life')}
 <p class="tiny">生活予定は、このiPhone内にのみ保存されます。予定が不確定な日は学習可能時間も暫定表示になります。</p>
 <div class="modal-actions">${btn('キャンセル','modal-close')}<button type="submit" class="btn primary">予定を保存</button></div></form>
 ${e?`<div style="margin-top:10px">${btn('この予定を削除','event-delete',`data-id="${e.id}"`,'small danger')}</div>`:''}`)}
function statusEditor(d=day()){const status=db.dayStatus[d]||{};openModal('今日の生活状況',`<form id="statusForm" class="form-stack" data-date="${d}">
 <p class="tiny">必要な時刻だけ入力できます。現在時刻が初期値です。</p><div class="fields">${field('帰宅時刻','homeAt',status.homeAt||'','time')}${field('夕食開始','dinnerStarted',status.dinnerStarted||'','time')}</div><div class="fields">${field('夕食終了','dinnerEnded',status.dinnerEnded||'','time')}</div><div class="modal-actions">${btn('キャンセル','modal-close')}<button class="btn primary" type="submit">状況を更新</button></div></form>`)}
function scoreEditor(){openModal('模試・本試験の成績を登録',`<form id="scoreForm" class="form-stack">${choose('試験','examId',db.exams.map(e=>[e.id,e.name]),db.exams[0]?.id||'','required')}${field('受験日','date',day(),'date','required')}
 ${choose('区分','kind',[['mock','模試'],['actual','本試験'],['practice','その他']], 'mock')}
 <div class="fields">${field('得点','score','','number','min="0" step="0.1" required')}${field('満点','max','100','number','min="0.1" step="0.1" required')}</div>${textArea('メモ（任意）','note')}
 <div class="modal-actions">${btn('キャンセル','modal-close')}<button class="btn primary" type="submit">成績を保存</button></div></form>`)}
function rewardEditor(id=null){const r=db.rewards.find(x=>x.id===id);openModal(r?'ごほうびを編集':'ごほうびを追加',`<form id="rewardForm" class="form-stack" data-id="${r?.id||''}">${field('ごほうび名','name',r?.name||'','text','required maxlength="65"')}${field('必要コイン','cost',r?.cost??200,'number','required min="1" step="1"')}<div class="modal-actions">${btn('キャンセル','modal-close')}<button class="btn primary" type="submit">保存する</button></div></form>`)}
const requiredFormValue=(f,k)=>f.elements.namedItem(k)?.value??'';
function handleForm(form){const fid=form.id,id=form.dataset.id||'',f=k=>requiredFormValue(form,k);const n=k=>Number(f(k));let ok=true;
 try{switch(fid){
 case'examForm':{
  if(!f('name').trim()||!f('date'))throw Error('試験名と日付を入力してください');if(id){Object.assign(exam(id),{name:f('name').trim(),date:f('date'),tentative:Boolean(form.elements.namedItem('tentative').checked),targetScore:f('targetScore')?n('targetScore'):null})}
  else db.exams.push({id:uid(),name:f('name').trim(),date:f('date'),tentative:Boolean(form.elements.namedItem('tentative').checked),targetScore:f('targetScore')?n('targetScore'):null,subjectIds:[]});break;}
 case'subjectForm':{if(!f('name').trim())throw Error('科目名を入力してください');if(id)subject(id).name=f('name').trim();else if(db.subjects.some(s=>s.name===f('name').trim()))throw Error('同じ名前の科目が既にあります');else db.subjects.push({id:uid(),name:f('name').trim(),topics:[]});break;}
 case'linkForm':{const e=exam(id);if(!e)throw Error('試験が見つかりません');e.subjectIds=[...form.querySelectorAll('input[name=subjectIds]:checked')].map(el=>el.value);break;}
 case'topicForm':{if(!f('name').trim())throw Error('分野名を入力してください');const s=subject(id);if(!s)throw Error('科目が見つかりません');if(s.topics.some(t=>t.name===f('name').trim()))throw Error('同じ分野があります');s.topics.push({id:uid(),name:f('name').trim()});break;}
 case'materialForm':{if(!db.subjects.length)throw Error('先に科目を追加してください');if(!f('name').trim()||!f('subjectId')||n('total')<=0||n('done')<0||n('done')>n('total'))throw Error('教材名、総量、完了数を確認してください');const data={name:f('name').trim(),subjectId:f('subjectId'),unit:f('unit'),total:Math.floor(n('total')),done:Math.floor(n('done')),minutesPerUnit:f('minutesPerUnit')&&n('minutesPerUnit')>0?n('minutesPerUnit'):null};if(id){Object.assign(material(id),data)}else db.materials.push({id:uid(),...data,baselineDone:data.done});break;}
 case'progressForm':{const m=material(id);if(!m||n('done')<0||n('done')>m.total)throw Error('完了数を確認してください');m.done=Math.floor(n('done'));break;}
 case'eventForm':{if(!f('name').trim()||!f('date')||!f('start')||!f('end'))throw Error('予定名と時刻を入力してください');const o={name:f('name').trim(),date:f('date'),start:f('start'),end:f('end'),repeat:f('repeat'),certainty:f('certainty'),kind:f('kind')};if(id)Object.assign(db.events.find(x=>x.id===id),o);else db.events.push({id:uid(),...o});calendarDay=o.date;break;}
 case'statusForm':{const d=form.dataset.date;db.dayStatus[d]={homeAt:f('homeAt'),dinnerStarted:f('dinnerStarted'),dinnerEnded:f('dinnerEnded')};break;}
 case'scoreForm':{if(!f('examId')||!f('date')||n('max')<=0||n('score')<0||n('score')>n('max'))throw Error('試験・得点・満点を確認してください');db.scores.push({id:uid(),examId:f('examId'),date:f('date'),kind:f('kind'),score:n('score'),max:n('max'),note:f('note')});break;}
 case'rewardForm':{if(!f('name').trim()||!Number.isInteger(n('cost'))||n('cost')<1)throw Error('ごほうび名と必要コインを確認してください');if(id)Object.assign(db.rewards.find(x=>x.id===id),{name:f('name').trim(),cost:n('cost')});else db.rewards.push({id:uid(),name:f('name').trim(),cost:n('cost'),starter:false});break;}
 default:ok=false;
 }}catch(e){toast(e.message);return}
 if(ok){save();closeModal();completeAchievements();redraw();toast('保存しました')}
}
/* Home dashboard: compact, actionable and grounded in recorded data. */
function weekBars(){const days=Array.from({length:7},(_,i)=>shiftDay(day(),i-6)),nums=days.map(minutesDay),max=Math.max(30,...nums);return `<div class="week-graph">${days.map((d,i)=>`<div class="bar-group"><span class="tiny">${nums[i]?fmtMin(nums[i]):''}</span><div class="bar" style="height:${Math.max(3,Math.round(nums[i]/max*82))}px"></div><span>${['日','月','火','水','木','金','土'][dateAt(d).getDay()]}</span></div>`).join('')}</div>`}
function renderHome(){const lv=levelInfo(),d=day(),min=minutesDay(d),due=reviewsDue(),status=db.dayStatus[d]||{},w=workload(),next=upcomingExams(4);
 const hero=box('今日の学習',`<div class="grid3">${stat('今日の学習',fmtMin(min))}${stat('レベル',lv.level,'＋'+lv.current+' XP')}${stat('コイン',db.coins,'coins')}</div>
 <div class="value-row" style="margin-top:10px"><b>Lv.${lv.level} → Lv.${lv.level+1}</b><span class="muted">${lv.current}/${lv.next} XP</span></div><div class="progress"><span style="width:${lv.pct}%"></span></div>
 <div class="button-row" style="margin-top:14px">${btn('▶ 学習を始める','home-study','','primary')}${btn('計画を見る','home-plan','','secondary')}</div>
 ${db.equippedTitle?`<p class="tiny">装備中の称号：${html(ACHIEVEMENTS.find(a=>a.id===db.equippedTitle)?.title||'')}</p>`:''}`);
 const statusCard=box('今日の生活状況',`<p class="muted">生活の変化に合わせて、その日の計画を調整します。</p><div class="status-steps">
 ${btn(status.homeAt?`帰宅 ${status.homeAt}`:'帰宅した','home-status-home', '', 'small secondary')}
 ${btn(status.dinnerStarted?`夕食 ${status.dinnerStarted}`:'夕食中','home-status-dinner','','small secondary')}
 ${btn(status.dinnerEnded?`夕食終了 ${status.dinnerEnded}`:'夕食が終わった','home-status-done','','small secondary')}
 ${btn(dayMode(d)==='rest'?'休養日に設定済み':'今日は休む','home-status-rest','','small secondary')}
 </div><div class="button-right" style="margin-top:10px">${btn('時刻を修正','home-status-edit','','small ghost')}</div>`);
 const ms=missionDefs();const missions=box('今日のミッション',`${dayRest()?'<p class="notice">今日は休養・調整日。ミッション未達によるペナルティはありません。</p>':''}<div class="list">${ms.map(m=>`<div class="item"><div class="value-row"><span class="item-title">${m.done?'✓ ':''}${html(m.label)}</span><span class="badge ${m.done?'good':''}">${m.done?'達成':'未達成'}</span></div><div class="item-sub">${html(m.detail)} ・ 達成するとXPとコインを自動獲得</div></div>`).join('')}</div>`);
 const study=box('おすすめ学習',`${bestSubjects(3).length?`<div class="list">${bestSubjects(3).map((x,i)=>`<div class="item"><div class="item-title">${i+1}. ${html(x.s.name)} <span class="badge">${Math.max(0,x.days)}日後</span></div><div class="item-sub">${html(x.e.name)} ・ ${x.due?'復習あり':'試験日と進捗から優先候補'}</div></div>`).join('')}</div>`:'<div class="empty">試験と科目を登録するとおすすめを表示します</div>'}
 <div class="notice">${w.known?`必要学習量の暫定目安：<b>${fmtMin(w.minutes)}/日</b>`:'必要学習量はまだ算出できません。'}<div class="tiny">${html(w.reason)}</div></div>`);
 const approaching=box('近日の試験',`${next.length?`<div class="list">${next.map(e=>`<div class="item"><div class="value-row"><div><div class="item-title">${html(e.name)}</div><div class="item-sub">${jpDate(e.date)} ${e.tentative?'（仮）':''}</div></div><span class="badge ${diffDay(d,e.date)<=7?'warm':''}">残り${diffDay(d,e.date)}日</span></div></div>`).join('')}</div>`:'<div class="empty">まだ試験が登録されていません</div>'}`);
 const activity=box('学習の積み重ね',`<div class="grid3">${stat('連続学習',`${streak()}日`)}${stat('復習待ち',`${due.length}件`)}${stat('学習記録',`${db.sessions.length}件`)}</div>${weekBars()}`);
 return hero+statusCard+missions+study+activity+approaching;
}
/* Pomodoro and stopwatch: time calculated from real clock even when app is backgrounded. */
const timerDefault=()=>({mode:'pomodoro',phase:'focus',running:false,startedAt:0,elapsedMs:0,sets:0,context:{examId:'',subjectId:'',topicId:'',materialId:'',questions:0,correct:0,unitsDone:0},focusStartedHour:null});
let timer;try{timer={...timerDefault(),...JSON.parse(localStorage.getItem(TIMER_STORAGE))}}catch{timer=timerDefault()}
function saveTimer(){try{localStorage.setItem(TIMER_STORAGE,JSON.stringify(timer))}catch{}}
function timerElapsed(){return Math.max(0,number(timer.elapsedMs)+(timer.running?Date.now()-number(timer.startedAt):0))}
function timerTotalMs(){return (timer.phase==='break'?(timer.breakMinutes||db.settings.shortBreak):db.settings.focusMinutes)*60*1000}
function timerRemaining(){return timer.mode==='stopwatch'&&timer.phase==='focus'?timerElapsed():Math.max(0,timerTotalMs()-timerElapsed())}
function paintTimer(){const txt=$('timerText'),round=$('timerRound'),phase=$('timerPhase');if(!txt||!round)return;const remain=timerRemaining();txt.textContent=fmtTime(remain);round.style.setProperty('--pct',(timer.mode==='stopwatch'?((timerElapsed()/60000)%100):clamp(timerElapsed()/timerTotalMs()*100,0,100))+'%');if(phase)phase.textContent=timer.mode==='stopwatch'?'ストップウォッチ':timer.phase==='break'?'休憩中':`ポモドーロ · 集中 ${Math.max(1,timer.sets%db.settings.longEvery+1)}/${db.settings.longEvery}`;
 const status=$('timerStatus');if(status)status.textContent=timer.running?'計測中':timer.elapsedMs?'一時停止中':'スタートできます';}
function timerStart(){if(timer.running)return;if(timer.phase==='focus'&&$('f-timerExam')){syncStudyContext('timer');const qs=Math.max(0,number($('f-timerQuestions')?.value));const co=Math.max(0,number($('f-timerCorrect')?.value));if(co>qs){toast('問題数と正解数を確認してください');return}timer.context={...timer.context,examId:draft.timerExam||'',subjectId:draft.timerSubject||'',topicId:draft.timerTopic||'',materialId:draft.timerMaterial||'',questions:qs,correct:co,unitsDone:Math.max(0,number($('f-timerUnits')?.value))}}timer.startedAt=Date.now();timer.running=true;if(timer.phase==='focus'&&timer.focusStartedHour==null)timer.focusStartedHour=new Date().getHours();saveTimer();paintTimer()}
function timerPause(){if(!timer.running)return;timer.elapsedMs=timerElapsed();timer.running=false;timer.startedAt=0;saveTimer();paintTimer()}
function timerReset(){if(timerElapsed()>0&&!confirm('現在の計測を破棄しますか？（学習時間は記録されません）'))return;timer={...timerDefault(),mode:timer.mode};saveTimer();redraw()}
function timerModeSwitch(mode){if(timer.running||timerElapsed()>0){toast('切り替える前にタイマーを終了またはリセットしてください');return}timer.mode=mode;timer.phase='focus';timer.focusStartedHour=null;saveTimer();redraw()}
function finishFocus(fromAuto=false){if(timer.phase==='break'){timer.running=false;timer.elapsedMs=0;timer.startedAt=0;timer.phase='focus';saveTimer();redraw();toast('休憩終了。次の集中を始められます');return;}
 const elapsed=timerElapsed();if(elapsed<60000&&!fromAuto){toast('1分以上計測すると学習記録に保存できます');return}
 const minutes=Math.max(1,Math.round((fromAuto?timerTotalMs():elapsed)/60000));timer.running=false;timer.startedAt=0;timer.elapsedMs=0;const c=timer.context||{};const focusHour=timer.focusStartedHour;timer.focusStartedHour=null;if(timer.mode==='pomodoro')timer.sets+=1;saveTimer();
 const record={id:uid(),date:day(),minutes,examId:c.examId||'',subjectId:c.subjectId||'',topicId:c.topicId||'',materialId:c.materialId||'',unitsDone:Math.max(0,number(c.unitsDone)),questions:Math.max(0,number(c.questions)),correct:Math.max(0,number(c.correct)),note:'',reviewId:null,source:'timer',mode:timer.mode,startHour:focusHour};
 if(record.correct>record.questions)record.correct=record.questions;
 earnSession(record);timer.context.questions=0;timer.context.correct=0;timer.context.unitsDone=0;saveTimer();redraw();
 const suggested=timer.sets%Math.max(1,db.settings.longEvery)===0?db.settings.longBreak:db.settings.shortBreak;
 openModal('集中学習、おつかれさま！',`<p>実際の集中時間 <b>${fmtMin(minutes)}</b> を記録してXPを獲得しました。</p><p class="muted">休憩はタイマー学習の終了時だけ選べます。</p><div class="grid2">${btn(`${suggested}分休憩する`,'timer-break',`data-minutes="${suggested}"`,'primary block')}${btn('休憩しない','modal-close','','secondary block')}</div><p class="tiny">ポモドーロでは${db.settings.longEvery}セットごとに長めの休憩をおすすめします。</p>`);
}
function timerStartBreak(minutes){timer.phase='break';timer.mode='pomodoro';timer.breakMinutes=minutes;timer.running=false;timer.elapsedMs=0;timer.startedAt=0;saveTimer();closeModal();go('study');timerStart()}
let timerLastTick=0;
function timerTick(){if(!timer.running)return;paintTimer();if(timer.mode==='pomodoro'&&timerElapsed()>=timerTotalMs()&&Date.now()-timerLastTick>1000){timerLastTick=Date.now();if(timer.phase==='break')finishFocus(true);else finishFocus(true)}}
let draft={manualExam:'',manualSubject:'',manualTopic:'',manualMaterial:'',manualReviewId:'',timerExam:timer.context?.examId||'',timerSubject:timer.context?.subjectId||'',timerTopic:timer.context?.topicId||'',timerMaterial:timer.context?.materialId||''};
function examOptions(selected){return [['','試験を指定しない'],...db.exams.map(e=>[e.id,e.name])]}
function subjectOptions(exid){return [['','科目を選択'],...(exid?examSubjects(exam(exid)):db.subjects).map(s=>[s.id,s.name])]}
function topicOptions(sid){return [['','分野なし'],...(subject(sid)?.topics||[]).map(x=>[x.id,x.name])]}
function materialOptions(sid){return [['','教材なし'],...db.materials.filter(m=>!sid||m.subjectId===sid).map(m=>[m.id,m.name])]}
function studyControls(prefix){const ex=draft[prefix+'Exam']||'',sid=draft[prefix+'Subject']||'';return `<div class="fields">${choose('試験',prefix+'Exam',examOptions(),ex)}${choose('科目',prefix+'Subject',subjectOptions(ex),sid)}</div><div class="fields">${choose('分野（任意）',prefix+'Topic',topicOptions(sid),draft[prefix+'Topic']||'')}${choose('教材（任意）',prefix+'Material',materialOptions(sid),draft[prefix+'Material']||'')}</div>`}
function renderStudy(){const timeOpts=box('集中タイマー',`<div class="timer-mode">${btn('ポモドーロ','timer-mode-pomo','','pill '+(timer.mode==='pomodoro'?'active':''))}${btn('ストップウォッチ','timer-mode-stop','','pill '+(timer.mode==='stopwatch'?'active':''))}</div>
 <div class="timer-face"><div class="timer-progress" id="timerRound"><div class="timer-inner"><div class="timer-caption" id="timerPhase">集中学習</div><div class="timer-time" id="timerText">25:00</div><div class="timer-caption" id="timerStatus">スタートできます</div></div></div></div>
 <div class="button-row" style="justify-content:center">${btn('▶ 開始','timer-start','','primary')}${btn('Ⅱ 一時停止','timer-pause','','secondary')}${btn('■ 終了して記録','timer-finish','','secondary')}${btn('↻ リセット','timer-reset','','small ghost')}</div>
 <details class="accordion"><summary>学習内容・タイマー設定</summary><div class="accordion-content form-stack">${studyControls('timer')}
 <div class="fields">${field('進めた教材の量','timerUnits',timer.context.unitsDone||0,'number','min="0" step="1"')}${field('解いた問題数','timerQuestions',timer.context.questions||0,'number','min="0" step="1"')}</div>
 ${field('正解数','timerCorrect',timer.context.correct||0,'number','min="0" step="1"')}
 ${btn('学習内容をタイマーに反映','timer-context-save','','secondary block')}
 <div class="divider"></div><div class="fields">${field('集中（分）','focusMinutes',db.settings.focusMinutes,'number','min="1" max="180"')}${field('短い休憩（分）','shortBreak',db.settings.shortBreak,'number','min="1" max="60"')}</div>
 <div class="fields">${field('長い休憩（分）','longBreak',db.settings.longBreak,'number','min="1" max="90"')}${field('長い休憩までの回数','longEvery',db.settings.longEvery,'number','min="1" max="12"')}</div>
 ${btn('タイマー設定を保存','timer-options-save','','secondary block')}
 <p class="tiny">バックグラウンドでも実時間で計測します。iPhoneが停止・再開した際はアプリを開いた時点で終了を検知します。</p></div></details>`);
 const manual=box('手動で学習を記録',`<form id="manualForm" class="form-stack">
 <div class="fields">${field('日付','date',day(),'date','required')}${field('学習時間（分）','minutes','25','number','required min="1" step="1"')}</div>
 <div class="fields">${choose('試験','manualExam',examOptions(),draft.manualExam||'')}${choose('科目','manualSubject',subjectOptions(draft.manualExam||''),draft.manualSubject||'')}</div>
 <div class="fields">${field('問題数','questions','0','number','min="0" step="1"')}${field('正解数','correct','0','number','min="0" step="1"')}</div>
 <details class="accordion" ${draft.manualReviewId?'open':''}><summary>分野・教材・進捗・メモ（任意）</summary><div class="accordion-content form-stack"><div class="fields">${choose('分野','manualTopic',topicOptions(draft.manualSubject||''),draft.manualTopic||'')}${choose('教材','manualMaterial',materialOptions(draft.manualSubject||''),draft.manualMaterial||'')}</div>${field('今回進めた教材の量','unitsDone','0','number','min="0" step="1"')}${textArea('メモ','note',draft.manualReviewId?'復習として学習':'')}</div></details>
 ${draft.manualReviewId?`<div class="notice">復習を記録中です。保存後にこの復習予定を完了にします。</div>`:''}
 <button type="submit" class="btn primary block">記録してXPを獲得</button>
 <p class="tiny">教材を選んで進捗量を入力すると教材の完了数にも反映されます。手動入力では休憩確認を表示しません。</p></form>`);
 const history=box('最近の学習記録',`${db.sessions.length?`<div class="list">${[...db.sessions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10).map(s=>`<div class="item"><div class="value-row"><div><b>${html(subject(s.subjectId)?.name||'自由学習')}</b><div class="item-sub">${jpDate(s.date)} ・ ${html(s.mode||s.source)}${s.reviewId?' ・ 復習':''}</div></div><b>${fmtMin(s.minutes)}</b></div><div class="item-sub">${s.questions?`問題${s.questions}問／正解${s.correct}問 ・ `:''}+${s.xp||0} XP</div><div class="button-right">${btn('削除','session-delete',`data-id="${s.id}"`,'small ghost')}</div></div>`).join('')}</div>`:'<div class="empty">まだ学習記録がありません</div>'}`);
 return timeOpts+manual+history;}
function saveManual(form){const f=k=>form.elements.namedItem(k)?.value??'',minutes=Number(f('minutes')),questions=Number(f('questions')),correct=Number(f('correct'));
 if(!f('date')||!Number.isInteger(minutes)||minutes<1||questions<0||!Number.isInteger(questions)||correct<0||correct>questions||!Number.isInteger(correct)){toast('日付・時間・問題数・正解数を確認してください');return}
 const sid=f('manualSubject');const mid=f('manualMaterial');const units=Number(form.elements.namedItem('unitsDone')?.value||0);
 if(units<0||!Number.isInteger(units)){toast('教材の進捗は0以上の整数で入力してください');return}
 if(mid&&material(mid)?.subjectId!==sid){toast('教材と科目が一致しません');return}
 const rid=draft.manualReviewId;const s={id:uid(),date:f('date'),minutes,examId:f('manualExam'),subjectId:sid,topicId:f('manualTopic'),materialId:mid,unitsDone:units,questions,correct,note:f('note'),reviewId:rid||null,source:'manual',mode:'manual'};
 earnSession(s);
 if(rid){const r=review(rid);if(r){r.status='done';r.completed=s.date;const wrong=questions-correct;if(wrong>0){const stages=[3,7,14,30];db.reviews.push({id:uid(),subjectId:r.subjectId,examId:r.examId,topicId:r.topicId,materialId:r.materialId,sourceSessionId:s.id,due:shiftDay(s.date,stages[Math.min(r.stage,stages.length-1)]),created:s.date,count:wrong,stage:r.stage+1,status:'due',completed:null})}}draft.manualReviewId='';save()}
 form.reset();redraw();toast(`${s.xp} XPを獲得！`);
}
function syncStudyContext(prefix){const e=$("f-"+prefix+'Exam'),s=$("f-"+prefix+'Subject'),t=$("f-"+prefix+'Topic'),m=$("f-"+prefix+'Material');if(!e||!s)return;
 draft[prefix+'Exam']=e.value;draft[prefix+'Subject']=s.value;draft[prefix+'Topic']=t?.value||'';draft[prefix+'Material']=m?.value||''}
function updateSelect(name,opts,selected){const el=$('f-'+name);if(!el)return;el.innerHTML=opts.map(o=>`<option value="${escAttr(o[0])}" ${o[0]===selected?'selected':''}>${html(o[1])}</option>`).join('');}
function changeStudySelect(name){const prefix=name.startsWith('manual')?'manual':'timer';const part=name.slice(prefix.length),e=$('f-'+prefix+'Exam'),s=$('f-'+prefix+'Subject');if(!e||!s)return;if(part==='Exam'){
  updateSelect(prefix+'Subject',subjectOptions(e.value),'');updateSelect(prefix+'Topic',topicOptions(''),'');updateSelect(prefix+'Material',materialOptions(''),'');
 }else if(part==='Subject'){updateSelect(prefix+'Topic',topicOptions(s.value),'');updateSelect(prefix+'Material',materialOptions(s.value),'')}
 syncStudyContext(prefix);
}
/* Analysis: one session ID is counted once even when subjects are shared across exams. */
function periodBounds(range){const d=day(),now=dateAt(d);switch(range){case'day':return[d,d];case'week':return[shiftDay(d,-6),d];case'month':return[shiftDay(d,-29),d];case'quarter':return[shiftDay(d,-89),d];case'half':return[shiftDay(d,-179),d];case'year':return[shiftDay(d,-364),d];case'all':return[db.sessions.map(s=>s.date).concat(db.scores.map(s=>s.date)).sort()[0]||d,d];default:return[shiftDay(d,-6),d]}}
function filteredSessions(){const [from,to]=periodBounds(reportRange);const allowed=reportExam?focusSubjectIds(reportExam):null;return db.sessions.filter(s=>s.date>=from&&s.date<=to&&(!allowed||allowed.includes(s.subjectId))&&(!reportSubject||s.subjectId===reportSubject))}
function chartGroups(items,from,to){const days=Math.max(1,diffDay(from,to)+1);let bins=[],size=1;if(days>365)size=30;else if(days>120)size=14;else if(days>45)size=7;else if(days>20)size=3;
 for(let i=0;i<days;i+=size){const start=shiftDay(from,i),end=shiftDay(from,Math.min(days-1,i+size-1));bins.push({label:days>60?start.slice(5):start.slice(5).replace('-','/'),start,end,minutes:sum(items.filter(s=>s.date>=start&&s.date<=end),s=>s.minutes)})}
 return bins}
function lineChart(values){const w=610,h=180,padX=28,padY=22,top=18,base=h-padY,max=Math.max(30,...values.map(v=>v.minutes));const dx=values.length>1?(w-padX*2)/(values.length-1):0;
 const coords=values.map((v,i)=>[padX+dx*i,base-v.minutes/max*(base-top)]);const p=coords.map(x=>x.join(',')).join(' ');
 const y0=base,y1=(base+top)/2;
 const dots=coords.filter((_,i)=>values.length<=30||i%Math.ceil(values.length/15)===0).map(x=>`<circle class="chart-point" cx="${x[0].toFixed(1)}" cy="${x[1].toFixed(1)}" r="3.5"/>`).join('');
 const labels=[0,Math.floor((values.length-1)/2),values.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text class="svg-label" text-anchor="middle" x="${(padX+dx*i).toFixed(1)}" y="${h-4}">${html(values[i]?.label||'')}</text>`).join('');
 return `<svg class="graph" viewBox="0 0 ${w} ${h}" role="img" aria-label="期間ごとの学習時間の推移"><line class="chart-axis" x1="${padX}" y1="${y0}" x2="${w-padX}" y2="${y0}"/><line class="chart-axis" x1="${padX}" y1="${y1}" x2="${w-padX}" y2="${y1}"/><text x="3" y="${top+4}" class="svg-label">${Math.round(max)}分</text><text x="6" y="${base-5}" class="svg-label">0</text><polyline class="score-line" points="${p}"/>${dots}${labels}</svg>`}
function scoreTrend(scores){if(!scores.length)return'';const ordered=[...scores].sort((a,b)=>a.date.localeCompare(b.date));const w=610,h=155,margin=30,ys=ordered.map(s=>s.score/s.max*100),max=100;const points=ordered.map((s,i)=>[margin+(w-2*margin)*(ordered.length===1?.5:i/(ordered.length-1)),h-27-(ys[i]/max)*(h-44)]);return `<svg class="graph" viewBox="0 0 ${w} ${h}" role="img" aria-label="成績の推移（得点率）"><line x1="${margin}" y1="${h-27}" x2="${w-margin}" y2="${h-27}" class="chart-axis"/><polyline points="${points.map(a=>a.join(',')).join(' ')}" class="score-line"/>${points.map((a,i)=>`<circle cx="${a[0]}" cy="${a[1]}" r="4" class="chart-point"><title>${html(ordered[i].date)}：${ys[i].toFixed(1)}%</title></circle>`).join('')}<text x="8" y="22" class="svg-label">100%</text><text x="${margin}" y="${h-5}" class="svg-label">${html(ordered[0].date.slice(5))}</text><text x="${w-margin}" y="${h-5}" text-anchor="end" class="svg-label">${html(ordered.at(-1).date.slice(5))}</text></svg>`} 
function accuracyTrend(values,logs){const data=values.map(v=>{const xs=logs.filter(s=>s.date>=v.start&&s.date<=v.end);const q=sum(xs,s=>s.questions),c=sum(xs,s=>s.correct);return {label:v.label,rate:q?c/q*100:null}});const x0=25,x1=590,top=18,bottom=156,w=610,h=182;const coords=data.map((v,i)=>[x0+(data.length===1?.5:i/(data.length-1))*(x1-x0),v.rate==null?null:bottom-v.rate/100*(bottom-top)]);const paths=[];let cur=[];for(const c of coords){if(c[1]==null){if(cur.length)paths.push(cur);cur=[]}else cur.push(c)}if(cur.length)paths.push(cur);return `<svg class="graph" viewBox="0 0 ${w} ${h}" role="img" aria-label="期間別の正答率推移"><line class="chart-axis" x1="${x0}" y1="${bottom}" x2="${x1}" y2="${bottom}"/><line class="chart-axis" x1="${x0}" y1="${top}" x2="${x1}" y2="${top}"/><text class="svg-label" x="2" y="22">100%</text><text class="svg-label" x="4" y="${bottom}">0%</text>${paths.map(path=>`<polyline class="score-line" points="${path.map(v=>v.join(',')).join(' ')}"/>`).join('')}${coords.filter(v=>v[1]!=null).map(v=>`<circle class="chart-point" cx="${v[0]}" cy="${v[1]}" r="3.5"/>`).join('')}<text class="svg-label" x="${x0}" y="${h-5}">${html(data[0]?.label||'')}</text><text class="svg-label" x="${x1}" y="${h-5}" text-anchor="end">${html(data.at(-1)?.label||'')}</text></svg>`}
function renderReport(){const logs=filteredSessions(),[from,to]=periodBounds(reportRange),qs=sum(logs,x=>x.questions),correct=sum(logs,x=>x.correct),minutes=sum(logs,x=>x.minutes);
 const distinct=new Set(logs.map(x=>x.date)).size;const bySubject=new Map();for(const l of logs){const key=l.subjectId||'none';bySubject.set(key,(bySubject.get(key)||0)+l.minutes)}
 const scores=db.scores.filter(s=>s.date>=from&&s.date<=to&&(!reportExam||s.examId===reportExam));const due=reviewsDue();const pendingReviews=db.reviews.filter(r=>r.status!=='done').sort((a,b)=>a.due.localeCompare(b.due));
 const chart=box('学習レポート',`<div class="fields">${choose('対象期間','reportRange',[['day','今日'],['week','直近7日'],['month','直近30日'],['quarter','3か月'],['half','6か月'],['year','1年'],['all','全期間']],reportRange)}${choose('試験','reportExam',[['','すべての試験'],...db.exams.map(e=>[e.id,e.name])],reportExam)}</div><div style="margin-top:12px">${choose('科目','reportSubject',[['','すべての科目'],...db.subjects.filter(s=>!reportExam||focusSubjectIds(reportExam).includes(s.id)).map(s=>[s.id,s.name])],reportSubject)}</div>
 <div class="grid3" style="margin-top:13px">${stat('学習時間',fmtMin(minutes))}${stat('学習日数',`${distinct}日`)}${stat('正答率',qs?pct(correct,qs)+'%':'未算出')}</div>
 <div class="seg" style="margin-top:14px">${btn('学習時間','report-chart-minutes','','small '+(reportChart==='minutes'?'selected':'secondary'))}${btn('正答率','report-chart-accuracy','','small '+(reportChart==='accuracy'?'selected':'secondary'))}</div>
 ${reportChart==='minutes'?lineChart(chartGroups(logs,from,to)):accuracyTrend(chartGroups(logs,from,to),logs)}
 <div class="legend"><span><i></i>${reportChart==='minutes'?'期間別学習時間':'期間別の正答率'}</span><span>${jpDate(from)}〜${jpDate(to)}</span></div>
 <p class="tiny">同じ科目を複数の試験で共有しても、全試験の合計では学習記録を1回だけ数えます。</p>`);
 const max=Math.max(1,...bySubject.values());const subjects=box('科目別の学習と正答率',`${bySubject.size?[...bySubject].sort((a,b)=>b[1]-a[1]).map(([sid,m])=>{const relevant=logs.filter(s=>s.subjectId===sid);const q=sum(relevant,s=>s.questions),c=sum(relevant,s=>s.correct);return `<div class="item"><div class="value-row"><b>${html(subject(sid)?.name||'自由学習')}</b><span class="muted">${fmtMin(m)} ・ ${q?pct(c,q)+'%':'正答率未算出'}</span></div><div class="progress"><span style="width:${Math.round(m/max*100)}%"></span></div></div>`}).join(''):'<div class="empty">この期間の学習記録はありません</div>'}
 <div class="subcard"><div class="value-row"><span>初回学習の問題数</span><b>${sum(logs.filter(s=>!s.reviewId),s=>s.questions)}問</b></div><div class="value-row"><span>復習で解いた問題数</span><b>${sum(logs.filter(s=>s.reviewId),s=>s.questions)}問</b></div></div>`);
 const w=workload(),a=availableOn(day());const gap=box('学習計画との比較',`${row('今の必要学習量の暫定目安',w.known?fmtMin(w.minutes)+'/日':'算出待ち')}${row('今日の学習可能時間',a.known?fmtMin(a.minutes):'未確定')}${row('今日の実際の学習',fmtMin(minutesDay(day())))}${w.known&&a.known&&w.minutes>a.minutes?`<p class="notice warning">目安より確保時間が${fmtMin(w.minutes-a.minutes)}少ない見込みです。</p>`:''}<p class="tiny">${html(w.reason)}</p><p class="tiny">合否を保証する推定ではありません。</p>`);
 const topicStats=new Map();for(const s of logs){if(!s.topicId||!s.questions)continue;const key=s.subjectId+':'+s.topicId;const o=topicStats.get(key)||{sid:s.subjectId,tid:s.topicId,q:0,c:0};o.q+=s.questions;o.c+=s.correct;topicStats.set(key,o)}
 const weakTopics=[...topicStats.values()].filter(t=>t.q>=3).sort((a,b)=>a.c/a.q-b.c/b.q).slice(0,7);
 const weaknesses=box('苦手分野の確認',weakTopics.length?weakTopics.map(t=>`<div class="item"><div class="value-row"><div><b>${html((subject(t.sid)?.topics||[]).find(x=>x.id===t.tid)?.name||'分野')}</b><div class="item-sub">${html(subject(t.sid)?.name||'科目')} ・ ${t.q}問</div></div><span class="badge ${pct(t.c,t.q)<60?'warm':''}">正答率${pct(t.c,t.q)}%</span></div></div>`).join(''):'<div class="empty">分野を選んで問題数を記録すると苦手分野を表示します</div>');
 const progress=box('教材・講義の進捗',`${db.materials.length?db.materials.filter(m=>!reportSubject||m.subjectId===reportSubject).filter(m=>!reportExam||focusSubjectIds(reportExam).includes(m.subjectId)).map(m=>`<div class="item"><div class="value-row"><b>${html(m.name)}</b><span class="muted">${m.done}/${m.total} ${html(m.unit)}</span></div><div class="progress"><span style="width:${pct(m.done,m.total)}%"></span></div></div>`).join(''):'<div class="empty">教材を登録すると進捗が表示されます</div>'}`);
 const reviews=box('復習状況',`<div class="grid2">${stat('期限が来た復習',due.length+'件')}${stat('完了した復習',db.reviews.filter(r=>r.status==='done').length+'件')}</div>
 ${pendingReviews.length?`<div class="list">${pendingReviews.slice(0,20).map(r=>`<div class="item"><div class="value-row"><div><b>${html(subject(r.subjectId)?.name||'科目')}</b><div class="item-sub">${jpDate(r.due)} ・ 間違えた問題${r.count}問</div></div><span class="badge ${r.due<=day()?'warm':''}">${r.due<=day()?'期限到来':'予定'}</span></div><div class="button-right">${btn('復習を開始','review-start',`data-id="${r.id}"`,'small primary')}</div></div>`).join('')}</div>`:'<div class="empty">予定されている復習はありません</div>'}
 <p class="tiny">復習を開始して実際に学習を記録すると完了になります。復習の問題は初回演習の問題数と区別します。</p>`);
 const test=box('模試・本試験の成績',`${btn('＋ 成績を登録','score-add','','small primary')}
 ${scoreTrend(scores)}
 ${scores.length?[...scores].sort((a,b)=>b.date.localeCompare(a.date)).map(s=>`<div class="item"><div class="value-row"><div><b>${html(exam(s.examId)?.name||'試験')}</b><div class="item-sub">${jpDate(s.date)} ・ ${html({mock:'模試',actual:'本試験',practice:'その他'}[s.kind]||'成績')}</div></div><b>${s.score}/${s.max}<small> (${pct(s.score,s.max)}%)</small></b></div><div class="button-right">${btn('削除','score-delete',`data-id="${s.id}"`,'small ghost')}</div></div>`).join(''):'<div class="empty">成績を登録すると推移を分析できます</div>'}`);
 const avg=logs.length?minutes/logs.length:0;const report=box('今の学習のまとめ',`<p class="muted">学習した日：${distinct}日 ／ 合計：${fmtMin(minutes)} ／ 1記録あたり平均：${fmtMin(avg)}</p><p class="muted">${qs?`この期間は${qs}問解き、${correct}問正解（${pct(correct,qs)}%）。`:'問題数を登録すると正答率を分析できます。'}${due.length?` 復習待ちは${due.length}件です。`:''}</p>`);
 return chart+subjects+weaknesses+gap+progress+reviews+test+report;
}
/* Rewards: all catalog items including the starters are editable. */
let longPressHandle=null;
function renderRewards(){const lv=levelInfo();const items=box('ごほうびショップ',`<div class="grid2">${stat('使えるコイン',db.coins+'枚')}${stat('レベル','Lv.'+lv.level,'交換しても減りません')}</div>
 <div class="button-row" style="margin-top:12px">${btn('＋ ごほうびを追加','reward-add','','small primary')}${btn(rewardManage?'管理モードを閉じる':'編集・削除','reward-manage','','small secondary')}</div>
 <p class="tiny">ごほうびは自分で編集できます。長押しでも管理モードを開けます。</p>
 ${db.rewards.map(r=>`<div class="item" data-reward-id="${r.id}"><div class="value-row"><div><b class="item-title">${html(r.name)}</b><div class="item-sub">${r.cost} coins</div></div>${btn('交換','reward-buy',`data-id="${r.id}" ${db.coins<r.cost?'disabled':''}`,'small primary')}</div>${rewardManage?`<div class="item-actions">${btn('編集','reward-edit',`data-id="${r.id}"`,'small secondary')}${btn('削除','reward-delete',`data-id="${r.id}"`,'small danger')}</div>`:''}</div>`).join('')||'<div class="empty">ごほうびがありません。好きなものを登録しよう</div>'}`);
 const titles=box('称号と実績',`<p class="muted">実績を達成すると称号が使えます。装備してもXPやコインは変わりません。</p>
 ${ACHIEVEMENTS.map(a=>{const got=db.achievements[a.id];return `<div class="item"><div class="value-row"><div><b>${html(a.title)}</b><div class="item-sub">${html(a.desc)}</div></div><span class="badge ${got?'good':''}">${got?'獲得':'未獲得'}</span></div>${got?`<div class="button-right">${btn(db.equippedTitle===a.id?'装備中':'称号を装備','title-equip',`data-id="${a.id}"`,'small '+(db.equippedTitle===a.id?'primary':'secondary'))}</div>`:''}</div>`}).join('')}`);
 const history=box('コインの利用履歴',`${db.purchases.length?[...db.purchases].reverse().map(p=>`<div class="item"><div class="value-row"><b>${html(p.name)}</b><span>${p.cost} coins</span></div><div class="item-sub">${jpDate(p.date)}</div></div>`).join(''):'<div class="empty">まだ交換履歴がありません</div>'}`);
 return items+titles+history;
}
/* Settings, local notifications, safe import/export and two-step reset. */
function renderSettings(){const s=db.settings;return box('通知・リマインダー',`<p class="muted">アプリを開いたときにお知らせを表示します。</p>
 <div class="form-stack">${field('学習開始の目安時刻','reminderTime',s.reminderTime,'time')}
 <label class="checkline"><input type="checkbox" id="notifyStudy" ${s.notifyStudy?'checked':''}>学習開始のリマインダー</label>
 <label class="checkline"><input type="checkbox" id="notifyExams" ${s.notifyExams?'checked':''}>試験日カウントダウン</label>
 <label class="checkline"><input type="checkbox" id="notifyReview" ${s.notifyReview?'checked':''}>復習予定の通知</label>
 <label class="checkline"><input type="checkbox" id="notifyMission" ${s.notifyMission?'checked':''}>未達成ミッション</label>
 ${btn('通知設定を保存','notifications-save','','primary block')}
 <p class="tiny">アプリを閉じている間のプッシュ通知には対応していません。</p></div>`)
 +box('データのバックアップ',`<p class="muted">学習記録はこの端末内に保存しています。機種変更などに備えて定期的にバックアップしてください。</p>
 <div class="button-row">${btn('JSONを保存','backup-json','','primary')}${btn('学習記録CSV','backup-csv','','secondary')}</div>
 <div class="divider"></div><div class="field"><label for="restoreFile">JSONバックアップを復元</label><input type="file" id="restoreFile" accept=".json,application/json"></div>
 <p class="tiny">読み込んだ後に内容と件数をプレビューできます。復元前に現在のデータのバックアップを作成します。</p>`)
 +box('詳細設定',`<details class="accordion"><summary>以前のバージョンからの移行</summary><div class="accordion-content"><p class="tiny">旧版のデータは自動で読み込みません。必要な場合のみ手動で移行できます。</p>${btn('旧版の保存データを確認','legacy-preview','','small secondary')}</div></details>
 <details class="accordion"><summary>アプリのデータを初期化</summary><div class="accordion-content"><p class="tiny warn">試験・学習・予定・XP・ごほうび等のデータを初期化します。</p>${btn('データを初期化する','reset-open','','small danger')}</div></details>`)
 +box('アプリについて',`<div class="value-row"><b>Study Quest</b><span class="badge">v${VERSION}</span></div><p class="tiny">このアプリには、個人の試験・予定・学習履歴を初期データとして含めていません。登録データはこの端末のブラウザ保存領域に保存されます。</p><p class="tiny">クラウド同期とバックグラウンド通知は未搭載です。</p>`);
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000)}
function backupJSON(label=''){const packed={meta:{format:'study-quest',schema:2,appVersion:VERSION,exportedAt:new Date().toISOString(),storage:'local-only'},data:db};downloadBlob(new Blob([JSON.stringify(packed,null,2)],{type:'application/json'}),`study-quest-${fileSafe(label||day())}.json`)}
function backupCSV(){const headers=['日付','学習時間(分)','区分','試験','科目','分野','教材','進捗量','問題数','正解数','復習','獲得XP','メモ'];const cells=db.sessions.map(s=>[s.date,s.minutes,s.mode,exam(s.examId)?.name||'',subject(s.subjectId)?.name||'',(subject(s.subjectId)?.topics||[]).find(t=>t.id===s.topicId)?.name||'',material(s.materialId)?.name||'',s.unitsDone||0,s.questions,s.correct,s.reviewId?'はい':'',s.xp,s.note]);const clean=v=>{let x=String(v??'');if(/^[=+@\-]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"'};const csv='\ufeff'+[headers,...cells].map(row=>row.map(clean).join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`study-quest-sessions-${day()}.csv`)}
function convertLegacy(source){const old=source?.data||source;if(!old||!Array.isArray(old.exams)||!Array.isArray(old.sessions))throw Error('対応していない旧版データです');
 const newDb=defaults(),lookup=new Map();const subjMap=new Map();newDb.createdAt=old.created||newDb.createdAt;newDb.xp=number(old.xp);newDb.coins=number(old.coins);
 for(const e of old.exams){const ids=[];for(const s of e.subjects||[]){const key=String(s.name||'').trim().toLowerCase();if(!key)continue;let target=lookup.get(key);if(!target){target={id:uid(),name:s.name,topics:[]};lookup.set(key,target);newDb.subjects.push(target)}subjMap.set(`${e.id}:${s.id}`,target.id);if(!ids.includes(target.id))ids.push(target.id);for(const t of s.topics||[]){if(!target.topics.some(y=>y.name===t.name))target.topics.push({id:uid(),name:t.name})}}
  newDb.exams.push({id:e.id||uid(),name:String(e.name||'試験'),date:e.date||day(),tentative:Boolean(e.approximate),subjectIds:ids,targetScore:null});}
 for(const m of old.materials||[]){const sid=subjMap.get(`${m.examId}:${m.subjectId}`)||newDb.subjects.find(s=>s.id===m.subjectId)?.id;if(!sid)continue;newDb.materials.push({id:m.id||uid(),name:m.name||'教材',subjectId:sid,unit:m.unit||'単位',total:Math.max(1,number(m.total,1)),done:Math.max(0,number(m.done)),baselineDone:Math.max(0,number(m.done)),minutesPerUnit:null})}
 for(const s of old.sessions){const subjId=subjMap.get(`${s.examId}:${s.subjectId}`)||'';newDb.sessions.push({...s,id:s.id||uid(),date:s.date||day(),minutes:number(s.minutes),examId:s.examId||'',subjectId:subjId,questions:number(s.questions),correct:number(s.correct),mode:s.mode||'manual',source:s.source||'manual',xp:number(s.xp),coins:number(s.coins),reviewId:null})}
 newDb.scores=(old.scores||[]).map(s=>({...s,id:s.id||uid(),max:number(s.max||s.maxScore||100),score:number(s.score||s.points),kind:s.kind||'mock'}));
 newDb.events=(old.events||[]).filter(e=>e&&e.name&&e.date&&e.start&&e.end).map(e=>({...e,id:e.id||uid(),repeat:e.repeat||'none',certainty:e.certainty||'fixed',kind:e.kind||'life'}));
 newDb.purchases=(old.purchases||[]).map(p=>({...p,id:p.id||uid()}));return newDb;
}
function previewImport(data,legacy=false){const d=normalize(data);importCandidate=d;restoreBackupConfirmed=false;openModal('復元するデータを確認',`<p class="muted">${legacy?'旧版の保存データ':'選択したJSONファイル'}を読み込みます。現在のデータは復元時に置き換わります。</p>
 <div class="grid2">${stat('試験',`${d.exams.length}件`)}${stat('科目',`${d.subjects.length}件`)}${stat('学習記録',`${d.sessions.length}件`)}${stat('生活予定',`${d.events.length}件`)}</div>
 <div class="notice">復元すると、現在の学習記録・XP・予定などを上書きします。実行前に必ずバックアップを保存してください。</div>
 ${btn('① 現在のデータをバックアップ','backup-before-restore','','secondary block')}
 <div class="modal-actions">${btn('キャンセル','modal-close','','secondary')}<button id="restoreConfirmed" class="btn primary" type="button" data-action="restore-confirm" disabled>② 復元する</button></div>`)}
function checkInAppReminder(){const key=`sq_notice_${day()}`;try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1')}catch{}const d=day(),m=[];if(db.settings.notifyReview&&reviewsDue().length)m.push(`復習の予定が${reviewsDue().length}件あります`);if(db.settings.notifyExams&&upcomingExams(1)[0]&&diffDay(d,upcomingExams(1)[0].date)<=3)m.push('試験日が近づいています');if(db.settings.notifyStudy&&timeNow()>=db.settings.reminderTime&&!minutesDay(d)&&!dayRest(d))m.push('今日の学習を記録できます');if(db.settings.notifyMission&&!dayRest(d)&&db.sessions.length>0&&timeNow()>=db.settings.reminderTime&&missionDefs(d).some(x=>!x.done))m.push('未達成のミッションがあります');if(m.length)toast(m[0]);}
/* Centralized, accessible event handling. */
function shiftMonth(d,inc){const dt=dateAt(d),dayOfMonth=dt.getDate(),next=new Date(dt.getFullYear(),dt.getMonth()+inc,1);const last=new Date(next.getFullYear(),next.getMonth()+1,0).getDate();next.setDate(Math.min(dayOfMonth,last));return day(next)}
function updateStatus(key){if(key==='rest'){db.dayModes[day()]=db.dayModes[day()]==='rest'?'normal':'rest'}else{db.dayStatus[day()]??={};db.dayStatus[day()][key]=timeNow()}save();redraw();toast('生活状況を更新しました')}
function deleteEntry(kind,id){const specs={exam:['試験','exams'],subject:['科目','subjects'],material:['教材','materials'],event:['予定','events'],reward:['ごほうび','rewards'],score:['成績','scores'],session:['学習記録','sessions']};const spec=specs[kind];if(!spec)return;
 if(kind==='subject'&&(db.sessions.some(s=>s.subjectId===id)||db.materials.some(m=>m.subjectId===id))){toast('記録や教材に使っている科目は削除できません。先に関連項目を整理してください');return}
 if(!confirm(`${spec[0]}を削除しますか？${kind==='exam'?'共有科目と学習記録は残ります。':kind==='event'?'繰り返し分も削除します。':''}`))return;
 const item=db[spec[1]].find(x=>x.id===id);if(kind==='session'&&item){db.xp=Math.max(0,db.xp-number(item.xp));db.coins=Math.max(0,db.coins-number(item.coins));const m=material(item.materialId);if(m)m.done=Math.max(m.baselineDone||0,m.done-number(item.unitsDone));db.reviews=db.reviews.filter(r=>r.sourceSessionId!==id)}
 db[spec[1]]=db[spec[1]].filter(x=>x.id!==id);
 if(kind==='subject')for(const e of db.exams)e.subjectIds=e.subjectIds.filter(sid=>sid!==id);
 if(kind==='exam')for(const s of db.sessions)if(s.examId===id)s.examId='';
 save();closeModal();redraw();toast(`${spec[0]}を削除しました`);
}
function onAction(a,b){const action=a.dataset.action,id=a.dataset.id||'';
 switch(action){
 case'nav':go(a.dataset.page);break;
 case'modal-close':closeModal();break;
 case'home-study':go('study');break;case'home-plan':go('plan');break;
 case'home-status-home':updateStatus('homeAt');break;
 case'home-status-dinner':updateStatus('dinnerStarted');break;
 case'home-status-done':updateStatus('dinnerEnded');break;
 case'home-status-rest':updateStatus('rest');break;
 case'home-status-edit':statusEditor();break;
 case'calendar-prev':calendarDay=calendarView==='week'?shiftDay(calendarDay,-7):shiftMonth(calendarDay,-1);redraw();break;
 case'calendar-next':calendarDay=calendarView==='week'?shiftDay(calendarDay,7):shiftMonth(calendarDay,1);redraw();break;
 case'calendar-week':calendarView='week';redraw();break;
 case'calendar-month':calendarView='month';redraw();break;
 case'calendar-today':calendarDay=day();redraw();break;
 case'pick-day':calendarDay=a.dataset.date;redraw();break;
 case'plan-options-save':{
  const val=number($('f-buffer')?.value,60);if(val<0||val>480){toast('Bufferは0〜480分にしてください');break}
  db.settings.bufferMinutes=val;db.dayModes[calendarDay]=$('f-dayMode').value;db.bufferDays[calendarDay]=$('bufferDayCheck').checked;db.daysOff[calendarDay]=$('dayOffCheck').checked;save();redraw();toast('設定を保存しました');break;}
 case'event-add':eventEditor();break;case'event-edit':eventEditor(id);break;case'event-delete':deleteEntry('event',id);break;
 case'exam-add':examEditor();break;case'exam-edit':examEditor(id);break;case'exam-link':linkEditor(id);break;case'exam-delete':deleteEntry('exam',id);break;
 case'subject-add':subjectEditor();break;case'subject-edit':subjectEditor(id);break;case'subject-delete':deleteEntry('subject',id);break;case'topic-add':topicEditor(id);break;
 case'material-add':if(!db.subjects.length){toast('先に科目を登録してください');break}materialEditor();break;
 case'material-edit':materialEditor(id);break;case'material-progress':progressEditor(id);break;case'material-delete':deleteEntry('material',id);break;
 case'timer-mode-pomo':timerModeSwitch('pomodoro');break;case'timer-mode-stop':timerModeSwitch('stopwatch');break;
 case'timer-start':timerStart();break;case'timer-pause':timerPause();break;case'timer-finish':if(timer.phase==='break'){timer.running=false;timer.elapsedMs=0;timer.phase='focus';saveTimer();redraw();}else finishFocus();break;
 case'timer-reset':timerReset();break;
 case'timer-context-save':{
  syncStudyContext('timer');const v=name=>Math.max(0,number($('f-'+name)?.value));const q=v('timerQuestions'),c=v('timerCorrect');if(c>q||!Number.isInteger(q)||!Number.isInteger(c)){toast('問題数と正解数を確認してください');break}
  timer.context={examId:draft.timerExam||'',subjectId:draft.timerSubject||'',topicId:draft.timerTopic||'',materialId:draft.timerMaterial||'',questions:q,correct:c,unitsDone:Math.max(0,Math.floor(v('timerUnits')))};saveTimer();toast('学習内容をタイマーに反映しました');break;}
 case'timer-options-save':{
  if(timer.running||timerElapsed()>0){toast('タイマーを停止・リセットしてから設定を変更してください');break}
  const fields=['focusMinutes','shortBreak','longBreak','longEvery'],vals=fields.map(n=>Math.round(number($('f-'+n)?.value)));if(vals.some((v,i)=>v<1||v>[180,60,90,12][i])){toast('タイマー設定の値を確認してください');break}
  fields.forEach((k,i)=>db.settings[k]=vals[i]);save();redraw();toast('タイマー設定を保存しました');break;}
 case'timer-break':timerStartBreak(number(a.dataset.minutes,5));break;
 case'session-delete':deleteEntry('session',id);break;
 case'report-chart-minutes':reportChart='minutes';redraw();break;case'report-chart-accuracy':reportChart='accuracy';redraw();break;
 case'score-add':if(!db.exams.length){toast('先に試験を登録してください');break}scoreEditor();break;
 case'score-delete':deleteEntry('score',id);break;
 case'review-start':{
  const r=review(id);if(!r)break;draft.manualReviewId=id;draft.manualSubject=r.subjectId;draft.manualExam=r.examId||subjectExams(r.subjectId)[0]?.id||'';draft.manualTopic=r.topicId||'';draft.manualMaterial=r.materialId||'';go('study');requestAnimationFrame(()=>$('manualForm')?.scrollIntoView({behavior:'smooth',block:'start'}));toast('復習する内容を選び、学習後に記録してください');break;}
 case'reward-manage':rewardManage=!rewardManage;redraw();break;
 case'reward-add':rewardEditor();break;case'reward-edit':rewardEditor(id);break;case'reward-delete':deleteEntry('reward',id);break;
 case'reward-buy':{
  const r=db.rewards.find(x=>x.id===id);if(!r||db.coins<r.cost){toast('コインが足りません');break}
  if(!confirm(`「${r.name}」を${r.cost}コインで交換しますか？`))break;
  db.coins-=r.cost;db.purchases.push({id:uid(),name:r.name,cost:r.cost,date:day()});save();redraw();toast('ごほうびを交換しました！');break;}
 case'title-equip':if(db.achievements[id]){db.equippedTitle=db.equippedTitle===id?null:id;save();redraw();toast('称号を変更しました')}break;
 case'notifications-save':db.settings.reminderTime=$('f-reminderTime').value;for(const k of ['notifyStudy','notifyExams','notifyReview','notifyMission'])db.settings[k]=$(k).checked;save();toast('通知設定を保存しました');break;
 case'backup-json':backupJSON();break;case'backup-csv':backupCSV();break;
 case'legacy-preview':{
  let old;try{old=JSON.parse(localStorage.getItem('studyquest_v1')||'null')}catch{}
  if(!old){toast('この保存領域に旧版データはありません');break}
  try{previewImport(convertLegacy(old),true)}catch(e){toast('旧版データを変換できません：'+e.message)}break;}
 case'backup-before-restore':backupJSON('before-restore-'+day());restoreBackupConfirmed=true;const submit=$('restoreConfirmed');if(submit)submit.disabled=false;toast('バックアップを保存しました');break;
 case'restore-confirm':{
  if(!restoreBackupConfirmed||!importCandidate){toast('先にバックアップを保存してください');break}
  if(!confirm('現在のデータを復元データで置き換えます。続行しますか？'))break;
  db=normalize(importCandidate);save();localStorage.removeItem(TIMER_STORAGE);timer=timerDefault();saveTimer();importCandidate=null;restoreBackupConfirmed=false;closeModal();page='home';render();window.scrollTo(0,0);toast('復元しました');break;}
 case'reset-open':openModal('すべてのデータを初期化',`<div class="notice warning">試験、生活予定、学習履歴、コイン、教材の進捗、旧版の保存データも削除します。必要なら先にバックアップを保存してください。</div>${btn('JSONをバックアップ','backup-json','','secondary block')}<p class="muted">実行する場合は、下の欄に「初期化」と入力してください。</p><div class="field">${field('確認のため入力','resetText','','text','autocomplete="off"')}</div><div class="modal-actions">${btn('キャンセル','modal-close')}<button class="btn danger" type="button" data-action="reset-confirm">完全に初期化</button></div>`);break;
 case'reset-confirm':{
  if($('f-resetText')?.value!=='初期化'){toast('「初期化」と入力してください');break}
  if(!confirm('本当にすべてのデータを初期化しますか？'))break;
  db=defaults();localStorage.removeItem(STORAGE);localStorage.removeItem('studyquest_v1');localStorage.removeItem(TIMER_STORAGE);timer=timerDefault();save();saveTimer();draft={manualExam:'',manualSubject:'',manualTopic:'',manualMaterial:'',manualReviewId:'',timerExam:'',timerSubject:'',timerTopic:'',timerMaterial:''};calendarDay=day();closeModal();page='home';render();window.scrollTo(0,0);toast('初期状態に戻しました');break;}
 default:break;
 }}
document.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(target){e.preventDefault();try{onAction(target,e)}catch(err){console.error(err);toast('操作を処理できませんでした：'+err.message)}}else if(e.target===$('modalOverlay'))closeModal()});
document.addEventListener('submit',e=>{const form=e.target.closest('form');if(!form)return;e.preventDefault();if(form.id==='manualForm'){saveManual(form);return}handleForm(form)});
document.addEventListener('change',e=>{const t=e.target;if(t.matches('#f-reportRange')){reportRange=t.value;redraw()}
 else if(t.matches('#f-reportExam')){reportExam=t.value;reportSubject='';redraw()}
 else if(t.matches('#f-reportSubject')){reportSubject=t.value;redraw()}
 else if(t.id==='restoreFile'&&t.files?.[0]){const file=t.files[0];if(file.size>12*1024*1024){toast('バックアップファイルが大きすぎます');return}
  file.text().then(raw=>{let parsed=JSON.parse(raw);if(parsed?.meta?.schema===2)previewImport(parsed.data);else if(parsed?.version===2)previewImport(parsed);else previewImport(convertLegacy(parsed),true)}).catch(err=>toast('JSONを読み込めません：'+err.message));}
 else if(/^f-(manual|timer)(Exam|Subject|Topic|Material)$/.test(t.id))changeStudySelect(t.id.slice(2));});
// Long-press on a reward also opens the accessible management mode; scrolling cancels it.
document.addEventListener('pointerdown',e=>{if(page!=='rewards'||e.target.closest('button'))return;const row=e.target.closest('[data-reward-id]');if(!row)return;clearTimeout(longPressHandle);longPressHandle=setTimeout(()=>{rewardManage=true;redraw();toast('編集・削除を表示しました')},600)});
for(const type of ['pointerup','pointercancel','pointermove','scroll'])document.addEventListener(type,()=>clearTimeout(longPressHandle),{passive:true});
// Persist elapsed wall-clock progress. Real background pushes require a backend and are not claimed.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)timerTick()});
function startApp(){completeAchievements();render();checkInAppReminder();setInterval(timerTick,350);
 if('serviceWorker'in navigator&&location.protocol==='https:'){navigator.serviceWorker.register('./sw.js?v=20',{scope:'./'}).catch(err=>console.warn('Offline support unavailable:',err));}}
startApp();
