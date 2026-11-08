import test from 'node:test';
import assert from 'node:assert/strict';
import {computeDelta,sanitizeCard,mergeTranscription,pcmToWav,likelySilent} from '../public/live-core.mjs';
import health from '../netlify/functions/health.mjs';
import analyze,{validateEvidence} from '../netlify/functions/analyze.mjs';
import transcribe from '../netlify/functions/transcribe.mjs';

const originalFetch=globalThis.fetch;
const url='https://testsite.netlify.app/.netlify/functions/';
const fakeCard={projectType:'Salon',summary:'Remont salonu',requirements:[{title:'Tapeta',detail:'Zielona tapeta',room:'Salon',status:'active',evidence:'zielona tapeta'}],facts:[],questions:['Jaki metraż?']};
function env(){process.env.GROQ_API_KEY='secret-groq';process.env.WYCENNIKAI_TEST_PIN='12345678TEST'}
const req=(name,method='POST',headers={},body)=>new Request(url+name,{method,headers,body});
const jsonReq=(name,body,pin='12345678TEST')=>req(name,'POST',{'content-type':'application/json','x-test-pin':pin,'origin':'https://testsite.netlify.app'},JSON.stringify(body));
const state=()=>({language:'pl-PL',newText:'W salonie zielona tapeta',previousState:null});

test('delta i reset po zmianie tekstu',()=>{
 assert.deepEqual(computeDelta('ABC DEF','ABC'),{reset:false,delta:' DEF'});
 assert.deepEqual(computeDelta('ZMIANA','ABC'),{reset:true,delta:'ZMIANA'});
});
test('merge STT usuwa powtórkę nakładających się zdań',()=>{
 assert.equal(mergeTranscription('Chcę zrobić remont łazienki', 'remont łazienki i nowy prysznic'),'Chcę zrobić remont łazienki i nowy prysznic');
 assert.equal(mergeTranscription('W salonie.', 'W salonie.'),'W salonie.');
 assert.equal(mergeTranscription('Kuchnia ma 12 metrów','12 metrów i nowy blat'),'Kuchnia ma 12 metrów i nowy blat');
});
test('sanitizeCard: ignoruje złośliwy obiekt i brakujące tablice',()=>{
 assert.equal(sanitizeCard(null),null);
 assert.deepEqual(sanitizeCard({projectType:'ok', requirements:[null,{title:'A',other:'hidden'}]}).requirements,[{title:'A',detail:'',room:'',status:'',evidence:''}]);
});
test('PCM -> poprawny WAV mono 16 kHz; wykrywa ciszę',()=>{
 const empty=new Float32Array(48000);assert.equal(likelySilent(empty),true);
 const samples=Float32Array.from({length:48000},(_,i)=>0.4*Math.sin(i/8));assert.equal(likelySilent(samples),false);
 const wav=pcmToWav(samples,48000),v=new DataView(wav);
 assert.equal(String.fromCharCode(...new Uint8Array(wav.slice(0,4))),'RIFF');
 assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(40,true),32000);
});
test('health: 503 brak konfiguracji, 401 zły PIN, 200 dobry PIN',async()=>{
 delete process.env.GROQ_API_KEY;delete process.env.WYCENNIKAI_TEST_PIN;
 const res=await health(req('health','POST',{'x-test-pin':'12345678TEST'}));assert.equal(res.status,503);
 env();assert.equal((await health(req('health','POST',{'x-test-pin':'wrong'}))).status,401);
 const ok=await health(req('health','POST',{'x-test-pin':'12345678TEST'}));assert.equal(ok.status,200);assert.equal((await ok.json()).ok,true);
 const get=await health(req('health','GET'));assert.equal(get.status,200);assert.equal((await get.json()).version,'0.5.0');
});
test('origin: blokada obcej domeny',async()=>{
 env();const res=await analyze(req('analyze','POST',{'origin':'https://attacker.test','x-test-pin':'12345678TEST','content-type':'application/json'},JSON.stringify(state())));assert.equal(res.status,403);
});
test('analyze: 401, limit, prawidłowy Groq payload i walidacja cytatów',async()=>{
 env();assert.equal((await analyze(jsonReq('analyze',state(),'wrong'))).status,401);
 const tooLong=await analyze(jsonReq('analyze',{...state(),newText:'A'.repeat(70000)}));assert.equal(tooLong.status,413);
 let called=0;
 globalThis.fetch=async(url,options)=>{
   called++;
   assert.match(String(url),/chat\/completions/);
   const v=JSON.parse(options.body);
   assert.equal(v.model,'openai/gpt-oss-20b');
   assert.equal(v.response_format.json_schema.strict,true);
   assert.equal(options.headers.authorization,'Bearer secret-groq');
   assert.match(v.messages[1].content,/Remont bez wskazania kolorów/);
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(fakeCard)}}],usage:{prompt_tokens:50,completion_tokens:30}}),{status:200});
 };
 try{
   const r=await analyze(jsonReq('analyze',{...state(),newText:'Remont bez wskazania kolorów'}));assert.equal(r.status,200);
   const j=await r.json();assert.equal(j.state.requirements[0].evidence,'');
   assert.equal(j.state.requirements[0].status,'uncertain');
   assert.ok(!JSON.stringify(j).includes('secret-groq'));
   assert.equal(called,1);
 }finally{globalThis.fetch=originalFetch;}
});
test('validateEvidence: cytat dosłowny, stary cytat',()=>{
 const card=structuredClone(fakeCard);
 validateEvidence(card,null,'Na ścianie jest zielona tapeta');
 assert.equal(card.requirements[0].evidence,'zielona tapeta');
 const other=structuredClone(fakeCard);
 validateEvidence(other,null,'Łazienka i wanna');
 assert.equal(other.requirements[0].status,'uncertain');
});
test('transcribe: walidacja audio, PIN, groq multipart i status 429',async()=>{
 env();const wave=pcmToWav(Float32Array.from({length:16000},(_,i)=>Math.sin(i/14)*.2),16000);
 const h={'x-test-pin':'12345678TEST','x-audio-language':'pl-PL','content-type':'audio/wav','origin':'https://testsite.netlify.app'};
 const bad=await transcribe(req('transcribe','POST',h,'bad'));assert.equal(bad.status,400);
 assert.equal((await transcribe(req('transcribe','POST',{...h,'x-test-pin':'wrong'},wave))).status,401);
 globalThis.fetch=async(url,options)=>{
   assert.match(String(url),/audio\/transcriptions/);
   assert.equal(options.headers.authorization,'Bearer secret-groq');
   assert.equal(options.body.get('model'),'whisper-large-v3-turbo');
   assert.equal(options.body.get('language'),'pl');
   assert.equal(options.body.get('file').size,wave.byteLength);
   return new Response(JSON.stringify({text:'Tu będzie nowa kuchnia'}),{status:200});
 };
 try{
   const r=await transcribe(req('transcribe','POST',h,wave));assert.equal(r.status,200);assert.equal((await r.json()).text,'Tu będzie nowa kuchnia');
   globalThis.fetch=async()=>new Response('{}',{status:429});
   const r2=await transcribe(req('transcribe','POST',h,wave));assert.equal(r2.status,429);
 }finally{globalThis.fetch=originalFetch;}
});
