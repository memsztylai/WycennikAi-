import {response,originAllowed,configured,pinOK,VERSION} from '../lib/server-core.mjs';
export default async function handler(req){
  if(!originAllowed(req))return response({error:'origin_forbidden',message:'Nieprawidłowe pochodzenie zapytania.'},403);
  if(!['GET','POST'].includes(req.method))return response({error:'method_not_allowed'},405);
  const c=configured();
  if(req.method==='GET')return response({version:VERSION,server:'online',aiConfigured:c.key,sttConfigured:c.key,pinConfigured:c.pin});
  if(!c.key||!c.pin)return response({error:'not_configured',message:'Brak GROQ_API_KEY lub WYCENNIKAI_TEST_PIN (min. 8 znaków) w zmiennych środowiska Netlify.'},503);
  if(!pinOK(req.headers.get('x-test-pin')))return response({error:'unauthorized',message:'PIN nie zgadza się z WYCENNIKAI_TEST_PIN w Netlify.'},401);
  return response({ok:true,version:VERSION,aiConfigured:true,sttConfigured:true,message:'PIN poprawny. Funkcje skonfigurowane (bez testu połączenia z Groq).'});
}
