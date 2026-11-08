// Cross-platform mono PCM microphone frames; never records to disk.
class PcmTap extends AudioWorkletProcessor {
  constructor(){super();this.parts=[];this.count=0;}
  process(inputs){
    const channels=inputs[0];
    if(channels && channels[0]){
      const first=channels[0];const copy=new Float32Array(first.length);copy.set(first);
      this.parts.push(copy);this.count+=copy.length;
      if(this.count>=4096){
        const combined=new Float32Array(this.count);let i=0;
        for(const p of this.parts){combined.set(p,i);i+=p.length;}
        this.port.postMessage(combined,[combined.buffer]);this.parts=[];this.count=0;
      }
    }
    return true;
  }
}
registerProcessor('wycennikai-pcm',PcmTap);
