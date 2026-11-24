const url = value => {
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' && (u.hostname === 'app.agencykey.com' || /^of-\d+\.agencykey\.com$/.test(u.hostname))) {
      const path = /^\/models\/\d+\/?$|^\/[a-zA-Z0-9_]{1,64}\/?$/.test(u.pathname) ? u.pathname : '/[ruta omitida]';
      return 'https://' + u.hostname + path;
    }
  } catch {}
  return '[URL omitida]';
};
const text = (value, length=500) => typeof value === 'string' ? value.slice(0,length)
  .replace(/https?:\/\/[^\s<>"']+/g, url).replace(/Bearer\s+\S+/gi,'Bearer [oculto]')
  .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g,'[oculto]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[oculto]') : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const id = value => /^[1-9][0-9]{0,24}$/.test(String(value)) ? String(value) : null;
const username = value => typeof value === 'string' && /^[a-z0-9_]{1,64}$/i.test(value) ? value.toLowerCase() : null;
const list = (value, limit) => Array.isArray(value) ? value.slice(0,limit).filter(x=>x && typeof x==='object') : [];

export function cleanWebDiagnostic(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const report = {stage:text(raw.stage,160),error:text(raw.error,2000),error_type:text(raw.error_type,100),
    traceback:text(raw.traceback,12000),opened_url:url(raw.opened_url),http_status:number(raw.http_status),
    browser_closed:raw.browser_closed===true,inspection_error:text(raw.inspection_error,100),
    screenshot_error:text(raw.screenshot_error,100),screenshot_omitted:text(raw.screenshot_omitted,100),
    frames:list(raw.frames,16).map(frame=>({frame_index:number(frame.frame_index),visible:frame.visible===true,
      unavailable:frame.unavailable===true,url:url(frame.url),
      identity:Array.isArray(frame.identity)?[id(frame.identity[0]),username(frame.identity[1])]:null,
      profile_header:frame.profile_header===true,profile_menu:frame.profile_menu===true,
      viewport:Object.fromEntries(['width','height','scrollTop','scrollHeight'].map(key=>[key,number(frame.viewport?.[key])])),
      cards:list(frame.cards,40).map(card=>({id:id(card.id),top:number(card.top),bottom:number(card.bottom),
        height:number(card.height),visible:card.visible===true,pinned:card.pinned===true})),
      images:list(frame.images,60).map(image=>({post_id:id(image.post_id),complete:image.complete===true,loaded:image.loaded===true}))}))};
  const image = raw.screenshot;
  if (image?.mime === 'image/jpeg' && typeof image.data === 'string' && image.data.length<=240000
      && /^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
    try {
      const bytes = atob(image.data);
      if (bytes.endsWith('\xff\xd9')) report.screenshot={mime:'image/jpeg',data:image.data};
    } catch {}
  }
  if (image && !report.screenshot) report.screenshot_omitted='invalid_or_oversized_image';
  // Keep report upload failures separate from the verification result.
  if (new TextEncoder().encode(JSON.stringify(report)).length > 340000) {
    delete report.screenshot;
    report.screenshot_omitted='size_limit';
  }
  return report;
}

// Stored ZIP entries require no runtime-specific compression or external package.
// This function is also embedded into the authenticated admin page for downloads.
export function reportZip(report) {
  const encoder=new TextEncoder();
  const files=[['diagnostic.json',encoder.encode(JSON.stringify({...report,screenshot:report.screenshot?'chrome.jpg':null},null,2))]];
  if(report.screenshot?.mime==='image/jpeg')files.push(['chrome.jpg',Uint8Array.from(atob(report.screenshot.data),c=>c.charCodeAt(0))]);
  const chunks=[],central=[];let offset=0,centralLength=0;
  for(const [filename,data] of files){
    const name=encoder.encode(filename);let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    crc=(crc^0xffffffff)>>>0;
    const local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(12,33,true);
    lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);
    const entry=new Uint8Array(46+name.length),cv=new DataView(entry.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(14,33,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);entry.set(name,46);
    chunks.push(local,data);central.push(entry);offset+=local.length+data.length;centralLength+=entry.length;
  }
  const end=new Uint8Array(22),ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);
  ev.setUint32(12,centralLength,true);ev.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
