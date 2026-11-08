import { timingSafeEqual } from 'node:crypto';
export const VERSION='0.5.0';
export const ANALYZE_MODEL=process.env.GROQ_ANALYZE_MODEL||'openai/gpt-oss-20b';
export const STT_MODEL=process.env.GROQ_STT_MODEL||'whisper-large-v3-turbo';
export const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export const originAllowed=req=>{const origin=req.headers.get('origin');try{return !origin||origin===new URL(req.url).origin}catch{return false}};
export const configured=()=>({key:Boolean(process.env.GROQ_API_KEY),pin:Boolean(process.env.WYCENNIKAI_TEST_PIN && process.env.WYCENNIKAI_TEST_PIN.length>=8)});
export function pinOK(raw){const pin=process.env.WYCENNIKAI_TEST_PIN||'',a=Buffer.from(String(raw||'')),b=Buffer.from(pin);return b.length>=8&&a.length===b.length&&timingSafeEqual(a,b)}
export const trim=(s,n=200)=>typeof s==='string'?s.trim().slice(0,n):'';
export async function readJson(req,max=65000){
  const contentLen=Number(req.headers.get('content-length')||0);
  if(contentLen>max)throw Object.assign(new Error('Zbyt duże żądanie'),{status:413});
  const raw=await req.text();if(Buffer.byteLength(raw,'utf8')>max)throw Object.assign(new Error('Zbyt duże żądanie'),{status:413});
  try{return JSON.parse(raw)}catch{throw Object.assign(new Error('Nieprawidłowy JSON'),{status:400})}
}
export const errorMessage=(status)=>status===401?'Nieprawidłowy klucz API Groq.':status===429?'Limit Groq (429) — zmniejsz częstotliwość lub sprawdź plan.':status===413?'Nagranie przekracza limit wielkości.':`Dostawca Groq zwrócił HTTP ${status}.`;
