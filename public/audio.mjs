import {pcmToWav,likelySilent} from './live-core.mjs';

// Each sent window is a complete standalone WAV. This avoids the broken WebM
// timeslice problem on mobile browsers. Samples remain in RAM only.
export class CloudRecorder {
  constructor({getPin,getLanguage,onTranscript,onStatus,onError,onProgress}) {
    Object.assign(this,{getPin,getLanguage,onTranscript,onStatus,onError,onProgress});
    this.active=false;this.paused=false;this.blocked=false;this.running=false;
    this.parts=[];this.total=0;this.freshSamples=0;this.queue=[];this.sampleRate=48000;
  }
  async start(){
    if(this.running||this.active||this.queue.length)throw new Error('Najpierw dokończ poprzednią kolejkę STT.');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Mikrofon wymaga HTTPS i obsługi getUserMedia.');
    if(!this.getPin()||this.getPin().length<8)throw new Error('Tryb STT Groq wymaga PIN-u (min. 8 znaków).');
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)throw new Error('Ta przeglądarka nie obsługuje Web Audio API.');
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      this.ctx=new AC();this.sampleRate=this.ctx.sampleRate;
      this.source=this.ctx.createMediaStreamSource(this.stream);
      this.sink=this.ctx.createGain();this.sink.gain.value=0;
      if(this.ctx.audioWorklet?.addModule){
        try{
          await this.ctx.audioWorklet.addModule('./pcm-worklet.js');
          this.node=new AudioWorkletNode(this.ctx,'wycennikai-pcm');
          this.node.port.onmessage=({data})=>this.capture(data);
        }catch(e){this.onStatus('AudioWorklet niedostępny, używam zgodnego trybu zapasowego.');}
      }
      if(!this.node){
        if(!this.ctx.createScriptProcessor)throw new Error('Brak AudioWorklet i trybu zapasowego ScriptProcessor.');
        this.node=this.ctx.createScriptProcessor(4096,1,1);
        this.node.onaudioprocess=e=>this.capture(new Float32Array(e.inputBuffer.getChannelData(0)));
      }
      this.source.connect(this.node);this.node.connect(this.sink);this.sink.connect(this.ctx.destination);
      await this.ctx.resume();
      this.parts=[];this.total=0;this.freshSamples=0;this.blocked=false;this.active=true;this.paused=false;
      this.onStatus(`Mikrofon aktywny · WAV ${Math.round(this.sampleRate/1000)} kHz → 16 kHz`);
    }catch(e){await this.release();throw e;}
  }
  capture(samples){
    if(!this.active||this.paused||!samples?.length)return;
    this.parts.push(samples);this.total+=samples.length;this.freshSamples+=samples.length;
    if(this.total>=Math.round(13*this.sampleRate))this.flush(false);
  }
  pack(){
    const merged=new Float32Array(this.total);let offset=0;
    for(const part of this.parts){merged.set(part,offset);offset+=part.length}
    return merged;
  }
  flush(final){
    if(this.freshSamples<Math.round(0.5*this.sampleRate)){
      if(final){this.parts=[];this.total=0;this.freshSamples=0;}
      return;
    }
    const merged=this.pack();
    const min=final?Math.round(0.9*this.sampleRate):Math.round(13*this.sampleRate);
    if(merged.length<min){this.parts=[];this.total=0;this.freshSamples=0;return;}
    if(!likelySilent(merged)){
      const wav=pcmToWav(merged,this.sampleRate);
      this.queue.push({wav,language:this.getLanguage(),attempts:0});
      this.onProgress(this.queue.length);
      if(this.queue.length>15){
        this.blocked=true;this.onError('Kolejka STT przekroczyła 15 fragmentów. Zatrzymaj rozmowę i ponów oczekujące próbki.');
      }
    }else{this.onStatus('Pomijam niemal całkowitą ciszę.');}
    const overlap=final?0:Math.min(merged.length,Math.round(1.2*this.sampleRate));
    this.parts=overlap?[merged.slice(-overlap)]:[];this.total=overlap;this.freshSamples=0;
    void this.drain();
  }
  async drain(){
    if(this.running||this.blocked)return;
    this.running=true;
    try{
      while(this.queue.length&&!this.blocked){
        const entry=this.queue[0];entry.attempts++;
        this.onStatus(`Transkrypcja segmentu (kolejka: ${this.queue.length})…`);
        const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),28000);
        try{
          const response=await fetch('/.netlify/functions/transcribe',{
            method:'POST',headers:{'content-type':'audio/wav','x-test-pin':this.getPin(),'x-audio-language':entry.language},
            body:entry.wav,signal:ctrl.signal
          });
          let body;try{body=await response.json()}catch{throw new Error(`Funkcja STT zwróciła nie-JSON (HTTP ${response.status}). Sprawdź deploy funkcji.`)}
          if(!response.ok)throw new Error(body.message||`HTTP ${response.status}`);
          this.queue.shift();this.onProgress(this.queue.length);
          if(body.text?.trim())this.onTranscript(body.text);
          this.onStatus(this.active?'Mikrofon aktywny · STT aktualne':'Gotowe · kolejka STT opróżniona');
        }catch(e){
          this.blocked=true;
          this.onError(`STT: ${e.name==='AbortError'?'upłynął czas oczekiwania':e.message}. Dźwięk pozostaje w pamięci tej karty — użyj „Ponów STT” (${this.queue.length} fragmentów).`);
        }finally{clearTimeout(timeout)}
      }
    }finally{this.running=false;this.onProgress(this.queue.length);}
  }
  retry(){if(!this.queue.length){this.onStatus('Brak zaległych fragmentów STT.');return;}this.blocked=false;void this.drain();}
  async pause(){if(!this.active||this.paused)return;this.paused=true;this.flush(true);await this.ctx?.suspend();this.onStatus('Pauza · czekam na zakończenie STT');}
  async resume(){if(!this.active||!this.paused)return;await this.ctx?.resume();this.paused=false;this.onStatus('Mikrofon aktywny');}
  async stop(){
    if(!this.active)return;
    this.active=false;this.paused=false;this.flush(true);await this.release();
    this.onStatus(this.queue.length?`Mikrofon zatrzymany · oczekuje ${this.queue.length} fragmentów STT`:'Mikrofon zatrzymany');
  }
  async release(){
    try{this.node?.disconnect();this.source?.disconnect();this.sink?.disconnect();}catch{}
    try{this.stream?.getTracks().forEach(t=>t.stop())}catch{}
    try{if(this.ctx&&this.ctx.state!=='closed')await this.ctx.close()}catch{}
    this.stream=null;this.ctx=null;this.node=null;this.source=null;this.sink=null;
  }
  hasPending(){return this.queue.length>0||this.running}
}

export class BrowserRecorder {
  constructor({language,onTranscript,onPartial,onStatus,onError}){
    Object.assign(this,{language,onTranscript,onPartial,onStatus,onError});
    this.SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    this.active=false;this.paused=false;this.generation=0;this.retry=0;this.restarts=null;this.rec=null;
  }
  start(){
    if(!this.SR)throw new Error('Web Speech API jest niedostępne. Wybierz Groq STT.');
    if(this.active)return;
    this.active=true;this.paused=false;this.retry=0;this.generation++;
    this.launch(this.generation);
  }
  launch(token){
    if(!this.active||this.paused||token!==this.generation)return;
    let rec;
    try{rec=new this.SR();rec.lang=this.language();rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;}
    catch(e){this.fail(e.message);return}
    const recorded=new Set();this.rec=rec;const launched=Date.now();
    rec.onstart=()=>{if(this.rec===rec)this.onStatus('Web Speech: nasłuchiwanie');};
    rec.onresult=e=>{
      if(this.rec!==rec||token!==this.generation)return;
      let interim='';
      for(let i=0;i<e.results.length;i++){
        const result=e.results[i],text=result?.[0]?.transcript||'';
        if(result.isFinal){if(!recorded.has(i)){recorded.add(i);this.retry=0;this.onTranscript(text)}}
        else interim+=(interim?' ':'')+text;
      }
      this.onPartial(interim);
    };
    rec.onerror=e=>{
      if(this.rec!==rec)return;
      const type=e.error||'unknown';
      if(['not-allowed','service-not-allowed','audio-capture','language-not-supported'].includes(type))this.fail('Web Speech: '+type+'. Przełącz na Groq STT lub sprawdź mikrofon.');
      else if(type!=='no-speech')this.onError('Web Speech: '+type+'; próbuję wznowić.');
    };
    rec.onend=()=>{
      if(this.rec!==rec)return;
      this.rec=null;this.onPartial('');
      if(!this.active||this.paused||token!==this.generation)return;
      if(Date.now()-launched<2500)this.retry++;
      if(this.retry>7){this.fail('Web Speech urywa nasłuch. Przełącz silnik na Groq STT.');return}
      const delay=Math.min(5000,500*Math.pow(1.5,this.retry));
      this.onStatus(`Web Speech: automatyczne wznowienie ${this.retry}/7`);
      this.restarts=setTimeout(()=>this.launch(token),delay);
    };
    try{rec.start()}catch(e){this.rec=null;if(++this.retry>7)this.fail(e.message);else this.restarts=setTimeout(()=>this.launch(token),800)}
  }
  fail(message){this.onError(message);this.stop();}
  pause(){if(!this.active||this.paused)return;this.paused=true;clearTimeout(this.restarts);try{this.rec?.stop()}catch{}this.onStatus('Pauza Web Speech');}
  resume(){if(!this.active||!this.paused)return;this.paused=false;this.retry=0;try{this.rec?.abort()}catch{}this.rec=null;this.launch(this.generation);}
  stop(){if(!this.active)return;this.active=false;clearTimeout(this.restarts);try{this.rec?.stop()}catch{}this.onPartial('');this.onStatus('Web Speech zatrzymany');}
  hasPending(){return false}
}
