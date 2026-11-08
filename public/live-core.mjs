/** Stateless helpers shared by UI and tests. */
export function computeDelta(full, confirmed) {
  const all = String(full || ''), old = String(confirmed || '');
  return all.startsWith(old) ? {reset:false, delta: all.slice(old.length)} : {reset:true, delta:all};
}
export function sanitizeCard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const str = v => typeof v === 'string' ? v : '';
  const rows = (items, keys, max) => (Array.isArray(items) ? items : []).slice(0,max).filter(v => v && typeof v === 'object').map(v => Object.fromEntries(keys.map(k=>[k,str(v[k])])));
  return {projectType:str(input.projectType),summary:str(input.summary),
    requirements: rows(input.requirements,['title','detail','room','status','evidence'],25),
    facts: rows(input.facts,['label','value','status','evidence'],20),
    questions: (Array.isArray(input.questions) ? input.questions : []).slice(0,3).map(str)};
}
export function mergeTranscription(oldText, nextText) {
  const old=String(oldText||'').trim(), next=String(nextText||'').trim();
  if(!next) return old;
  if(!old) return next;
  const tokenize=s=> [...s.matchAll(/\S+/gu)].map(m=>({raw:m[0], start:m.index,
    normalized:m[0].toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')})).filter(x=>x.normalized);
  const a=tokenize(old), b=tokenize(next);
  if(!b.length) return old;
  const max=Math.min(18,a.length,b.length);let overlap=0;
  for(let n=max;n>=1;n--){
    if(n===1 && b[0].normalized.length < 6) continue;
    if(a.slice(-n).every((t,i)=>t.normalized===b[i].normalized)){overlap=n;break}
  }
  if(overlap===b.length) return old;
  let suffix = overlap ? next.slice(b[overlap].start).trim() : next;
  if(!suffix) return old;
  return old + (/[.!?]$/.test(old)?'\n':' ') + suffix;
}
export function pcmToWav(samples, sampleRate) {
  const rate = Number(sampleRate);
  if(!(rate >= 8000 && rate <= 192000)) throw new Error('Nieprawidłowa częstotliwość audio');
  if(!samples?.length) throw new Error('Puste nagranie');
  const desired=16000, ratio=rate/desired;
  const length=Math.max(1,Math.floor(samples.length/ratio));
  const ab=new ArrayBuffer(44+length*2), view=new DataView(ab);
  const write=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i))};
  write(0,'RIFF');view.setUint32(4,36+length*2,true);write(8,'WAVE');write(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,desired,true);view.setUint32(28,desired*2,true);view.setUint16(32,2,true);
  view.setUint16(34,16,true);write(36,'data');view.setUint32(40,length*2,true);
  // Average an input interval per output sample (simple anti-alias; input is speech).
  for(let i=0;i<length;i++){
    const begin=Math.floor(i*ratio), end=Math.min(samples.length,Math.max(begin+1,Math.floor((i+1)*ratio)));
    let sum=0;for(let j=begin;j<end;j++)sum+=samples[j];
    const v=Math.max(-1,Math.min(1,sum/(end-begin)));
    view.setInt16(44+i*2,Math.round(v<0?v*32768:v*32767),true);
  }
  return ab;
}
export function likelySilent(samples){
  if (!samples.length) return true;
  let peak=0,sum=0;
  for(let i=0;i<samples.length;i+=13){const x=Math.abs(samples[i]);peak=Math.max(peak,x);sum+=x*x}
  return peak<0.018 && Math.sqrt(sum/Math.ceil(samples.length/13))<0.005;
}
