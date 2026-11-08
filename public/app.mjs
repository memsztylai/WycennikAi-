import {EDITION,VERSION,DEFAULT_STT} from './config.mjs';
import {mergeTranscription} from './live-core.mjs';
import {BrowserRecorder,CloudRecorder} from './audio.mjs';
import {setupAI} from './ai.mjs';

const $=id=>document.getElementById(id),TRANSCRIPT_KEY='wycennikai-mobile-text',PIN_KEY='wycennikai-test-pin';
const safeStorage=name=>{try{return window[name]}catch{return {getItem:()=>null,setItem:()=>{},removeItem:()=>{}}}};
const localStore=safeStorage('localStorage'),sessionStore=safeStorage('sessionStorage');
const getStore=(storage,k)=>{try{return storage.getItem(k)||''}catch{return ''}};
const showMessage=t=>{$('message').textContent=t||''};
let transcript=getStore(localStore,TRANSCRIPT_KEY),partial='',recorder=null,active=false,paused=false,busyStart=false,cloudMode=false;
let editionDefault=DEFAULT_STT;
$('edition').textContent=`${EDITION==='ANDROID'?'Android':'Universal'} · v${VERSION}`;
$('mode').value=editionDefault;
$('pin').value=getStore(sessionStore,PIN_KEY);
function pin(){return $('pin').value.trim()}
function language(){return $('lang').value}
function saveTranscript(){try{localStore.setItem(TRANSCRIPT_KEY,transcript)}catch{showMessage('Pamięć urządzenia niedostępna. Pobierz TXT, aby zachować tekst.')}}
function paint(){
  $('text').textContent=transcript+(partial?`\n[… ${partial}]`:'')||'Tutaj pojawi się tekst rozmowy.';
  $('count').textContent=`${transcript.length} znaków`;
  $('text').scrollTop=$('text').scrollHeight;
}
function markUpdated(){saveTranscript();paint();window.dispatchEvent(new CustomEvent('wycennikai:transcript'))}
function appendText(next){
  const updated=mergeTranscription(transcript,next);
  if(updated===transcript)return;
  transcript=updated;partial='';markUpdated();
}
function showStatus(t){$('recordStatus').textContent=t}
function refreshButtons(){
  $('start').disabled=active||busyStart||!!recorder?.hasPending();
  $('pause').disabled=!active||busyStart;
  $('stop').disabled=!active||busyStart;
  $('lang').disabled=active||busyStart;
  $('mode').disabled=active||busyStart||!!recorder?.hasPending();
  $('pause').textContent=paused?'▶ WZNÓW':'⏸ PAUZA';
  $('retryAudio').classList.toggle('hide',!recorder?.hasPending());
}
const ai=setupAI({getTranscript:()=>transcript,getPin:pin,getLanguage:language,showMessage});
$('pin').addEventListener('input',()=>{
  try{if(pin())sessionStore.setItem(PIN_KEY,pin());else sessionStore.removeItem(PIN_KEY)}catch{}
  ai.onPinUpdated();
});
$('forgetPin').onclick=()=>{$('pin').value='';try{sessionStore.removeItem(PIN_KEY)}catch{};$('connection').textContent='PIN usunięty z pamięci tej karty.';};
async function checkConnection(verifyPin=false){
  const box=$('connection');box.textContent=verifyPin?'Sprawdzam PIN…':'Sprawdzam funkcje Netlify…';
  try{
    const response=await fetch('/.netlify/functions/health',{method:verifyPin?'POST':'GET',headers:verifyPin?{'x-test-pin':pin()}:{},cache:'no-store'});
    let data;try{data=await response.json()}catch{throw new Error(`HTTP ${response.status}: endpoint /health nie zwrócił JSON. Funkcje Netlify prawdopodobnie nie zostały wdrożone.`)}
    if(!response.ok)throw new Error(data.message||`HTTP ${response.status}`);
    if(verifyPin){box.textContent='✓ PIN poprawny · funkcje dostępne.';ai.onPinUpdated();}
    else box.textContent='✓ Funkcja Netlify /health działa.';
    $('serverDetails').textContent=`Wersja serwera: ${data.version||'?'} · Groq API: ${data.aiConfigured?'ustawiony':'BRAK'} · PIN: ${data.pinConfigured?'ustawiony':'BRAK'}.`;
  }catch(e){box.textContent='✕ '+e.message;$('serverDetails').textContent='Sprawdź, czy wdrożono pełny projekt z netlify/functions, nie sam folder public.';}
}
$('check').onclick=()=>void checkConnection(true);
$('mode').addEventListener('change',()=>{
  $('audioStatus').textContent=$('mode').value==='cloud'?'Groq STT: pełne 13-sekundowe WAV + zakładka 1,2 s; działa po podaniu PIN.':'Web Speech: odczyt na żywo, ale jakość i ciągłość zależą od przeglądarki. Na Androidzie rekomendowany Groq STT.';
});
function audioDone(){refreshButtons()}
$('start').onclick=async()=>{
  if(active||busyStart)return;
  if(recorder?.hasPending()){showMessage('Zaległe segmenty STT: kliknij Ponów STT i poczekaj na wynik.');return;}
  cloudMode=$('mode').value==='cloud';
  if(cloudMode&&pin().length<8){showMessage('W trybie Groq STT najpierw wpisz PIN (min. 8 znaków), następnie kliknij Sprawdź PIN.');return;}
  if(!window.isSecureContext&&!['localhost','127.0.0.1'].includes(location.hostname)){
    showMessage('Mikrofon jest dostępny tylko przez HTTPS.');return;
  }
  busyStart=true;refreshButtons();showMessage('');showStatus('Uruchamiam mikrofon…');
  const settings={getPin:pin,getLanguage:language,language,onTranscript:appendText,
    onPartial:s=>{partial=s;paint()},onStatus:showStatus,onError:showMessage,
    onProgress:()=>refreshButtons()};
  try{
    recorder=cloudMode?new CloudRecorder(settings):new BrowserRecorder(settings);
    await recorder.start();active=true;paused=false;
    if(cloudMode)showStatus('🎙 Mikrofon aktywny · wysyłka co około 13 sekund.');
    else showStatus('🎙 Web Speech aktywny.');
  }catch(e){recorder=null;showMessage('Start: '+e.message);showStatus('Mikrofon nie został uruchomiony');}
  finally{busyStart=false;refreshButtons();}
};
$('pause').onclick=async()=>{
  if(!active)return;
  try{if(!paused){await recorder.pause();paused=true}else{await recorder.resume();paused=false}}
  catch(e){showMessage('Pauza/wznowienie: '+e.message)}
  refreshButtons();
};
$('stop').onclick=async()=>{
  if(!active)return;
  active=false;paused=false;refreshButtons();
  try{await recorder.stop()}catch(e){showMessage('Zatrzymanie: '+e.message)}
  refreshButtons();
};
$('retryAudio').onclick=()=>{recorder?.retry?.();refreshButtons()};
function fileDownload(content,name,type){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)
}
$('export').onclick=()=>fileDownload(transcript,'wycennikai-transkrypcja.txt','text/plain;charset=utf-8');
$('edit').onclick=()=>{
  if(active||recorder?.hasPending()){showMessage('Przed edycją zakończ nagrywanie i STT.');return}
  $('editor').value=transcript;$('editor').classList.remove('hide');$('save').classList.remove('hide');
};
$('save').onclick=()=>{
  if(active||recorder?.hasPending())return;
  transcript=$('editor').value.trim();$('editor').classList.add('hide');$('save').classList.add('hide');
  markUpdated();showMessage('Zapisano. Jeśli zmieniono treść, karta AI zostanie przeliczona od początku.');
};
$('clear').onclick=()=>{
  if(active||recorder?.hasPending()){showMessage('Najpierw zatrzymaj mikrofon i zakończ kolejkę STT.');return}
  if(!confirm('Nowa rozmowa usunie zapisaną transkrypcję oraz kartę AI. Kontynuować?'))return;
  transcript='';partial='';try{localStore.removeItem(TRANSCRIPT_KEY)}catch{};
  $('editor').classList.add('hide');$('save').classList.add('hide');
  window.dispatchEvent(new CustomEvent('wycennikai:cleared'));paint();showMessage('Rozpoczęto nową rozmowę.');
};
// A retry button is available only when untranscribed audio is buffered in RAM.
const retry=$('retryAudio');retry.classList.add('hide');
window.addEventListener('pagehide',()=>{if(active)showStatus('Uwaga: strona opuszczona, mikrofon może zostać zatrzymany.')});
paint();refreshButtons();
void checkConnection(false);
$('mode').dispatchEvent(new Event('change'));
