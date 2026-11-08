import {response,configured,originAllowed,pinOK,STT_MODEL,errorMessage,VERSION} from '../lib/server-core.mjs';
const langs={'pl-PL':'pl','nl-NL':'nl','en-GB':'en','de-DE':'de'};
const MAX_BYTES=3_000_000; // >60 seconds WAV mono 16kHz; client sends ~14s
export default async function handler(req){
  if(req.method!=='POST')return response({error:'method_not_allowed'},405);
  if(!originAllowed(req))return response({error:'origin_forbidden',message:'Nieprawidłowe pochodzenie zapytania.'},403);
  const cfg=configured();if(!cfg.key||!cfg.pin)return response({error:'not_configured',message:'Ustaw GROQ_API_KEY i WYCENNIKAI_TEST_PIN w Netlify.'},503);
  if(!pinOK(req.headers.get('x-test-pin')))return response({error:'unauthorized',message:'Nieprawidłowy PIN.'},401);
  const lang=langs[req.headers.get('x-audio-language')];
  if(!lang)return response({error:'invalid_language',message:'Nieprawidłowy język.'},400);
  if(!/^audio\/wav(?:\s*;.*)?$/i.test(req.headers.get('content-type')||''))return response({error:'invalid_audio_type',message:'Akceptowane jest audio/wav.'},415);
  if(Number(req.headers.get('content-length')||0)>MAX_BYTES)return response({error:'too_large'},413);
  let data;
  try{data=await req.arrayBuffer()}catch{return response({error:'read_error'},400)}
  if(data.byteLength>MAX_BYTES)return response({error:'too_large'},413);
  if(data.byteLength<76||Buffer.from(data.slice(0,4)).toString()!=='RIFF'||Buffer.from(data.slice(8,12)).toString()!=='WAVE')return response({error:'invalid_audio',message:'Brak poprawnego nagłówka WAV.'},400);
  const form=new FormData();
  form.set('file',new Blob([data],{type:'audio/wav'}),'segment.wav');
  form.set('model',STT_MODEL);form.set('language',lang);form.set('response_format','json');form.set('temperature','0');
  const prompts={pl:'Rozmowa o remoncie, budowie, instalacjach, materiałach budowlanych i pomiarach.',nl:'Gesprek over renovatie, bouw, installaties, bouwmaterialen en afmetingen.',en:'Discussion about renovation, construction, installations, building materials and measurements.',de:'Gespräch über Renovierung, Bau, Installationen, Baumaterialien und Maße.'};
  form.set('prompt',prompts[lang]);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),23000);
  try{
    const remote=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',signal:controller.signal,headers:{authorization:'Bearer '+process.env.GROQ_API_KEY},body:form});
    if(!remote.ok)return response({error:'stt_provider_error',message:errorMessage(remote.status)},remote.status===429?429:502);
    const out=await remote.json();
    if(typeof out?.text!=='string')return response({error:'invalid_stt_response',message:'Groq nie zwrócił transkrypcji.'},502);
    return response({version:VERSION,text:out.text.slice(0,12000),model:STT_MODEL});
  }catch(e){return response({error:'stt_unavailable',message:e?.name==='AbortError'?'Groq STT przekroczył czas 23 s.':'Nie udało się połączyć z Groq STT.'},504)}
  finally{clearTimeout(timeout)}
}
