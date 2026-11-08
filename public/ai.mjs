import {computeDelta,sanitizeCard} from './live-core.mjs';

export function setupAI({getTranscript,getPin,getLanguage,showMessage}){
  const $=id=>document.getElementById(id);
  const STORE='wycennikai-live-state-v05';
  const oldStore='wycennikai-v03-live-state';
  const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let card=null,confirmed='',calls=0,lastResult=null,busy=false,needsRun=false,epoch=0,timer=null,controller=null,lastCall=0,retries=0;
  const status=t=>{$('liveStatus').textContent=t};
  function persist(){try{localStorage.setItem(STORE,JSON.stringify({confirmed,card,calls,lastResult}));}catch{}}
  function render(){
    if(!card){$('analysis').textContent='Brak karty AI. Wpisz PIN i nagraj rozmowę lub uzupełnij transkrypcję.';$('exportCard').disabled=true;$('exportCardTxt').disabled=true;return}
    const labels={active:'Aktualne',changed:'Zmienione',cancelled:'Odwołane',uncertain:'Niepewne',declared:'Deklarowane',confirmed:'Potwierdzone'};
    const transcript=getTranscript().toLocaleLowerCase().replace(/\s+/g,' ');
    const evidence=e=>{
      const value=String(e||'').toLocaleLowerCase().replace(/\s+/g,' ').trim();
      return value&&transcript.includes(value)?'✓ cytat w transkrypcji':'⚠ cytat niepotwierdzony';
    };
    const reqs=card.requirements.map(x=>`<li><b>${escape(x.title)}</b> — ${escape(x.detail)} <span class="state-badge">${escape(labels[x.status]||x.status)}</span> ${escape(x.room)}<br><small>Źródło: „${escape(x.evidence||'brak cytatu')}” ${evidence(x.evidence)}</small></li>`).join('');
    const facts=card.facts.map(x=>`<li><b>${escape(x.label)}:</b> ${escape(x.value)} <span class="state-badge">${escape(labels[x.status]||x.status)}</span><br><small>Źródło: „${escape(x.evidence||'brak cytatu')}” ${evidence(x.evidence)}</small></li>`).join('');
    const questions=card.questions.map(x=>`<li>${escape(x)}</li>`).join('');
    $('analysis').innerHTML=`<small>AI LIVE • karta wymaga weryfikacji</small><p><b>Projekt:</b> ${escape(card.projectType||'Nieokreślony')}</p><p>${escape(card.summary)}</p><b>Prace (${card.requirements.length})</b>${reqs?`<ul>${reqs}</ul>`:'<p>Brak wykrytych prac.</p>'}<b>Parametry</b>${facts?`<ul>${facts}</ul>`:'<p>Brak deklaracji.</p>'}<b>Pytania do klienta</b>${questions?`<ol>${questions}</ol>`:'<p>Brak pytań.</p>'}`;
    $('exportCard').disabled=false;$('exportCardTxt').disabled=false;
  }
  function reset(quiet=false){
    epoch++;controller?.abort();controller=null;clearTimeout(timer);busy=false;needsRun=false;
    confirmed='';card=null;calls=0;lastResult=null;retries=0;
    try{localStorage.removeItem(STORE);localStorage.removeItem(oldStore)}catch{}
    if(!quiet)status('AI: karta wyczyszczona. Kolejny fragment będzie analizowany od początku.');
    render();
  }
  async function execute(force=false){
    clearTimeout(timer);
    if(busy){needsRun=true;return}
    const full=getTranscript(),diff=computeDelta(full,confirmed);
    if(diff.reset){confirmed='';card=null;calls=0;lastResult=null;persist();render();}
    const payload=diff.delta.slice(0,6500);
    if(!payload.trim()){if(force)status('AI: brak nowych fragmentów.');return;}
    if(getPin().length<8){status('AI: wprowadź PIN o długości co najmniej 8 znaków.');return;}
    const elapsed=Date.now()-lastCall;
    if(!force&&elapsed<3600){schedule(3650-elapsed);return}
    busy=true;needsRun=false;const requestEpoch=epoch;
    controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),32000);
    lastCall=Date.now();const started=performance.now();
    status('AI LIVE: analizuję fragment… możesz nadal mówić.');
    let succeeded=false;
    try{
      const response=await fetch('/.netlify/functions/analyze',{
        method:'POST',headers:{'content-type':'application/json','x-test-pin':getPin()},
        body:JSON.stringify({language:getLanguage(),newText:payload,previousState:card}),signal:controller.signal
      });
      let out;try{out=await response.json()}catch{throw Object.assign(new Error(`Funkcja analyze nie zwróciła JSON (HTTP ${response.status})`),{status:response.status})}
      if(!response.ok)throw Object.assign(new Error(out.message||out.error||`HTTP ${response.status}`),{status:response.status});
      if(requestEpoch!==epoch)return;
      const next=sanitizeCard(out.state);
      if(!next)throw new Error('AI zwróciło nieprawidłową kartę.');
      card=next;confirmed+=payload;calls++;retries=0;succeeded=true;
      lastResult={date:out.createdAt,model:out.model,latencyMs:Math.round(performance.now()-started),usage:out.usage};
      persist();render();
      status(`AI LIVE ✓ ${calls} aktualizacji · ${(lastResult.latencyMs/1000).toFixed(1)} s · ${new Date().toLocaleTimeString('pl-PL')}`);
    }catch(e){
      if(requestEpoch!==epoch)return;
      if(e.name==='AbortError'){status('AI: przekroczony czas; kliknij Analizuj teraz.');return}
      status('AI: '+e.message+' · tekst pozostaje zapisany.');
      if(![400,401,403,413,503].includes(e.status)&&$('liveEnabled').checked&&retries<2){
        retries++;needsRun=true;showMessage(`AI: automatyczna ponowna próba ${retries}/2`);
      }
    }finally{
      clearTimeout(timeout);
      if(requestEpoch===epoch){
        busy=false;controller=null;
        const pending=computeDelta(getTranscript(),confirmed).delta.trim();
        if($('liveEnabled').checked&&getPin()&&(succeeded&&pending||needsRun)){
          needsRun=false;schedule(succeeded?3800:12000);
        }
      }
    }
  }
  function schedule(ms=2200){if(!$('liveEnabled').checked)return;clearTimeout(timer);timer=setTimeout(()=>void execute(),ms)}
  function onNewTranscript(){
    const delta=computeDelta(getTranscript(),confirmed);
    if(delta.reset){reset(true);status('AI: transkrypcja zmieniona — przeliczę kartę od początku.');}
    schedule(2200);
  }
  window.addEventListener('wycennikai:transcript',onNewTranscript);
  window.addEventListener('wycennikai:cleared',()=>reset());
  $('analyze').onclick=()=>void execute(true);
  $('resetAI').onclick=()=>{if(confirm('Zresetować kartę AI? Transkrypcja pozostanie.')){reset();schedule(350)}};
  $('liveEnabled').addEventListener('change',()=>{if($('liveEnabled').checked)schedule(350);else{clearTimeout(timer);status('AI LIVE wyłączone; ręczna analiza nadal dostępna.')}});
  const download=(text,name,type)=>{const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1800)};
  $('exportCard').onclick=()=>{if(card)download(JSON.stringify({version:'0.5.0',source:getTranscript(),language:getLanguage(),state:card,diagnostics:{calls,lastResult,analyzedCharacters:confirmed.length}},null,2),'wycennikai-karta.json','application/json;charset=utf-8')};
  $('exportCardTxt').onclick=()=>{if(!card)return;download(['WYCENNIKAI LIVE 0.5.0','Projekt: '+card.projectType,'Podsumowanie: '+card.summary,'','PRACE:',...card.requirements.map(x=>`• ${x.title} (${x.status}): ${x.detail} / ${x.room} / Cytat: ${x.evidence}`),'','PARAMETRY:',...card.facts.map(x=>`• ${x.label}: ${x.value} (${x.status}) / Cytat: ${x.evidence}`),'','PYTANIA:',...card.questions.map((x,i)=>`${i+1}. ${x}`),'','TRANSKRYPCJA:',getTranscript()].join('\n'),'wycennikai-karta.txt','text/plain;charset=utf-8')};
  try{
    const saved=JSON.parse(localStorage.getItem(STORE)||'null');
    if(saved&&typeof saved.confirmed==='string'&&getTranscript().startsWith(saved.confirmed)){
      confirmed=saved.confirmed;card=sanitizeCard(saved.card);calls=saved.calls||0;lastResult=saved.lastResult||null;
      render();status(`AI: przywrócono ${calls} aktualizacji.`);
      if(getTranscript().length>confirmed.length)schedule(500);
    }else{try{localStorage.removeItem(STORE)}catch{}}
  }catch{status('AI: nie udało się odczytać pamięci karty.');}
  render();
  return {onPinUpdated:()=>{if(getPin().length>=8&&getTranscript())schedule(350)},reset};
}
