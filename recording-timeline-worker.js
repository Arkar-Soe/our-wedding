'use strict';
// Rebuild only the container/index, after capture has stopped. Encoded packets are copied.
self.onmessage=async event=>{
  const {blob,key,mime,libraryURL,chunkSize=4*1024*1024}=event.data;let db,input;
  const transaction=(run)=>new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');run(tx.objectStore('chunks'));tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Timeline storage failed'));});
  try{
    importScripts(libraryURL);const M=self.Mediabunny;
    db=await new Promise((resolve,reject)=>{const r=indexedDB.open('our-wedding-memories',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    input=new M.Input({source:new M.BlobSource(blob),formats:M.ALL_FORMATS});
    let sequence=0,size=0,lastProgress=0;
    const target=new M.StreamTarget(new WritableStream({write:async chunk=>{
      const part={session:key,index:sequence++,position:chunk.position,blob:new Blob([chunk.data])};
      await transaction(store=>store.put(part));size=Math.max(size,chunk.position+chunk.data.byteLength);
    }}),{chunked:true,chunkSize});
    const format=mime.includes('mp4')?new M.Mp4OutputFormat({fastStart:false}):new M.WebMOutputFormat();
    const output=new M.Output({format,target});
    const conversion=await M.Conversion.init({input,output,copy:{mode:'forced'}});
    if(!conversion.isValid||conversion.discardedTracks.length)throw new Error('This file cannot be indexed without losing a track. The original was kept.');
    const duration=await input.computeDuration();if(!Number.isFinite(duration)||duration<=0)throw new Error('No complete video timeline was found in this file.');
    conversion.onProgress=progress=>{const now=performance.now();if(now-lastProgress>300||progress===1){lastProgress=now;self.postMessage({type:'progress',progress});}};
    await conversion.execute();if(!size)throw new Error('The indexed file is empty.');
    self.postMessage({type:'complete',key,size,durationMs:Math.round(duration*1000),parts:sequence});
  }catch(error){
    if(db)try{await transaction(store=>{const r=store.index('session').openCursor(IDBKeyRange.only(key));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue();}};});}catch{}
    self.postMessage({type:'error',message:error.message||'The timeline could not be finished.'});
  }finally{input?.dispose();db?.close();}
};
