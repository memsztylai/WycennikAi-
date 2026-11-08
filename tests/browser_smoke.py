#!/usr/bin/env python3
"""Runs mobile DOM + mocked backend in sandboxed Chromium, NO live network.
Requires playwright and Chromium. Chromium here blocks all HTTP via admin policy;
JS modules are loaded as data: URLs and mocked fetch replaces Netlify/Groq.
"""
import base64
import pathlib
import re
from playwright.sync_api import sync_playwright

PUBLIC=pathlib.Path(__file__).resolve().parent.parent/'public'
cache={}
def module_url(name):
    if name in cache:return cache[name]
    src=(PUBLIC/name).read_text()
    def replace(m):
        child=m.group(1)
        return "'"+module_url(child)+"'"
    src=re.sub(r"'\./([a-z-]+\.mjs)'",replace,src)
    url='data:text/javascript;base64,'+base64.b64encode(src.encode()).decode()
    cache[name]=url
    return url

html=(PUBLIC/'index.html').read_text().replace('<script type="module" src="./app.mjs"></script>','')
html=html.replace('<link rel="stylesheet" href="./styles.css">','<style>'+ (PUBLIC/'styles.css').read_text()+'</style>')
app=module_url('app.mjs');audio=module_url('audio.mjs')
ANDROID_PACKAGE="EDITION = 'ANDROID'" in (PUBLIC/'config.mjs').read_text()

MOCK_FETCH="""
window.mockRequests=[];
window.fetch=async(url,opts={})=>{
 const path=String(url);window.mockRequests.push({path,method:opts.method||'GET'});
 let status=200, response={};
 if(path.endsWith('/health')){
   if(opts.method==='POST'){
     status=opts.headers['x-test-pin']==='this-is-test-pin'?200:401;
     response=status===200?{ok:true,version:'0.5.0',aiConfigured:true,pinConfigured:true}:{message:'PIN nieprawidłowy'};
   }else response={version:'0.5.0',server:'online',aiConfigured:true,sttConfigured:true,pinConfigured:true};
 }else if(path.endsWith('/analyze')){
   response={state:{projectType:'Kuchnia',summary:'Remont kuchni',requirements:[{title:'Montaż blatu',detail:'Nowy blat',room:'Kuchnia',status:'active',evidence:'remont kuchni'}],facts:[],questions:['Jaki wymiar blatu?']},model:'mocked',usage:{},createdAt:'2026-11-08T00:00:00Z'};
 }else if(path.endsWith('/transcribe')){
   if(new DataView(opts.body).getUint32(0,false)!==0x52494646){status=400;response={message:'Expected WAV'};}
   else response={text:'Remont kuchni i nowy blat',model:'mocked-stt'};
 }else{status=404;response={message:'Not found'};}
 return new Response(JSON.stringify(response),{status,headers:{'content-type':'application/json'}});
};
"""
with sync_playwright() as pw:
    for device in ['iPhone','Android']:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        ua='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' if device=='iPhone' else 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'
        context=browser.new_context(user_agent=ua,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        page=context.new_page();errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
        page.set_content(html)
        page.evaluate(MOCK_FETCH)
        page.evaluate('(url)=>import(url)',app)
        page.locator('#connection').get_by_text('działa').wait_for(timeout=4000)
        assert page.locator('#mode').input_value()==('cloud' if ANDROID_PACKAGE or device=='Android' else 'browser')
        page.locator('#pin').fill('wrong-pin-123')
        page.locator('#check').click()
        page.locator('#connection').get_by_text('PIN nieprawidłowy').wait_for()
        page.locator('#pin').fill('this-is-test-pin')
        page.locator('#check').click()
        page.locator('#connection').get_by_text('PIN poprawny').wait_for()
        page.locator('#edit').click()
        page.locator('#editor').fill('Proszę o remont kuchni i nowy blat')
        page.locator('#save').click()
        page.locator('#analyze').click()
        page.locator('#analysis').get_by_text('Montaż blatu').wait_for(timeout=5000)
        assert page.locator('#exportCard').is_enabled()
        output=page.evaluate('''async(url)=>{
           const {CloudRecorder}=await import(url);
           let transcript='', errors=[], backlog=[];
           const r=new CloudRecorder({getPin:()=> 'this-is-test-pin',getLanguage:()=> 'pl-PL',
              onTranscript:t=>transcript+=t,onStatus:()=>{},onError:e=>errors.push(e),onProgress:n=>backlog.push(n)});
           r.active=true;r.sampleRate=16000;
           const sample=new Float32Array(13*16000);
           for(let i=0;i<sample.length;i++)sample[i]=Math.sin(i/18)*.18;
           r.capture(sample);
           for(let i=0;i<100 && r.running;i++)await new Promise(resolve=>setTimeout(resolve,30));
           return {transcript,errors,backlog,pending:r.hasPending()};
        }''',audio)
        assert 'Remont kuchni' in output['transcript'],output
        assert output['errors']==[],output
        assert output['pending'] is False,output
        assert not errs,errs
        print('PASS mobile DOM + mocked Netlify: '+device)
        context.close();browser.close()
print('BROWSER TESTS PASSED (mocked APIs; no physical mobile hardware)')
