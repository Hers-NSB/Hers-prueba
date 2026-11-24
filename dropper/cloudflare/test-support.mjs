import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import worker from './worker.mjs';

crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const origin = 'https://dropper.test';
export const firstId = 'a1326529-f99e-4907-aa89-44b6b2fca21e';
export const secondId = '0e79d05a-d897-48c6-8538-727558762d64';
export const firstToken = '12345678:'+'A'.repeat(35);
export const secondToken = '87654321:'+'B'.repeat(35);
export const input = {creator_id: 52, telegram_token: firstToken, api_key: 'agency-private-key', revision: 0};

export function makeEnvironment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const DB = {async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }, prepare(sql) {
    let params = [];
    return {bind(...values) {params = values; return this;},
      async first() {return sqlite.prepare(sql).get(...params)||null;},
      async all() {return {results: sqlite.prepare(sql).all(...params)};},
      async run() {const result = sqlite.prepare(sql).run(...params); return {meta: {changes: Number(result.changes)}};}};
  }};
  return {env:{DB, ACCESS_TOKEN:'desktop-access-token', ADMIN_TOKEN:'admin-code-separate-from-app-code',
    ENCRYPTION_KEY:Buffer.alloc(32,29).toString('base64')},sqlite};
}

export function installUpstream() {
  const state = {names:{52:'CRM alias',99:'Other alias'},ofNames:{52:'Lilith',99:'Lola'},meStatus:200,pages:1,calls:[],status:200,invalid:false};
  globalThis.fetch = async (url,options) => {
    url = new URL(url);
    state.calls.push(url.toString());
    if (url.hostname!=='app.agencykey.com') throw new Error('Unexpected upstream');
    if (options.headers['x-public-api-key']!=='agency-private-key') return Response.json({}, {status:401});
    if (state.status!==200) return Response.json({}, {status:state.status});
    if (state.invalid) return new Response('not-json');
    const match=url.pathname.match(/^\/api\/v1\/onlyfans\/(\d+)\/api2\/v2\/users\/me$/);
    if(match){if(state.meStatus!==200)return Response.json({}, {status:state.meStatus});const id=Number(match[1]);return Response.json({id,name:state.ofNames[id],username:'model_'+id});}
    if(url.pathname!=='/api/v1/onlyfans/creators')throw new Error('Unexpected upstream');
    const page=Number(url.searchParams.get('page'));
    const entries=Object.entries(state.names).map(([id,name])=>({name,account:{externalId:Number(id),username:'model_'+id}}));
    const data=state.pages===2?(page===1?entries.slice(1):entries.slice(0,1)):entries;
    return Response.json({data,pagination:{pages:state.pages}});
  };
  return state;
}

export function request(env,method,path,body,headers={},ctx=undefined) {
  const init={method,headers:{Origin:origin,'Content-Type':'application/json',...headers}};
  if(body!==undefined)init.body=typeof body==='string'?body:JSON.stringify(body);
  return worker.fetch(new Request(origin+path,init),env,ctx);
}

export async function admin(env,method,path,body,headers={}) {
  const login=await request(env,'POST','/v1/admin/login',{password:env.TEST_ADMIN_PASSWORD||env.ADMIN_TOKEN});
  if(login.status!==200)return login;
  const cookie=login.headers.get('set-cookie').split(';')[0];
  return request(env,method,path,body,{Cookie:cookie,...headers});
}
export function desktop(env,method,path,body,code=env.ACCESS_TOKEN) {
  return request(env,method,path,body,{Authorization:'Bearer '+code,'X-Recorder-Protocol':'2'});
}
