function allowedHost(host) {
  return ['agencykey.com','onlyfans.com'].some(domain=>host===domain || host.endsWith('.'+domain));
}

export function cleanStorageState(state) {
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins) || JSON.stringify(state).length>500000) {
    throw new Error('Invalid browser state');
  }
  const cookies = state.cookies.filter(cookie=>typeof cookie.domain==='string' && allowedHost(cookie.domain.replace(/^\./,'')));
  const origins = state.origins.filter(item=>{
    try {const url=new URL(item.origin);return url.protocol==='https:' && allowedHost(url.hostname);} catch {return false;}
  });
  if (!cookies.length && !origins.some(item=>item.localStorage?.length || item.indexedDB?.length)) throw new Error('Empty browser state');
  return {cookies,origins};
}
