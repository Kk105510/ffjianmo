/**
 * Optional small API gateway for GitHub Pages when the public PF API does not
 * allow direct requests from the browser. No player credentials are involved.
 * Deploy on your own Cloudflare Workers account if required.
 */
const UPSTREAM='https://xivpf.littlenightmare.top';
const HEADERS={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Methods':'GET,OPTIONS',
 'Access-Control-Allow-Headers':'Accept,Content-Type',
 'Cache-Control':'public, max-age=50',
 'X-Content-Type-Options':'nosniff',
};
export default {
 async fetch(request){
   const url=new URL(request.url);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
   if(request.method!=='GET'||!['/api/listings','/api/v2/listings'].includes(url.pathname))return Response.json({error:'Not found'},{status:404,headers:HEADERS});
   const page=Number(url.searchParams.get('page')||1);
   const size=Number(url.searchParams.get('per_page')||100);
   if(!Number.isSafeInteger(page)||page<1||page>80||!Number.isSafeInteger(size)||size<1||size>100)
     return Response.json({error:'Invalid pagination'},{status:400,headers:HEADERS});
   const target=new URL(url.pathname,UPSTREAM);
   target.searchParams.set('page',String(page));
   target.searchParams.set('per_page',String(size));
   try {
     const res=await fetch(target.toString(),{headers:{Accept:'application/json'},cf:{cacheTtl:60,cacheEverything:true},signal:AbortSignal.timeout(17000)});
     if(!res.ok)return Response.json({error:`Upstream ${res.status}`},{status:502,headers:HEADERS});
     const data=await res.json();
     if(!data||typeof data!=='object'||!Array.isArray(data.data??data.listings))
       return Response.json({error:'Invalid upstream response'},{status:502,headers:HEADERS});
     return Response.json(data,{headers:HEADERS});
   }catch(e){return Response.json({error:'Upstream not reachable'},{status:502,headers:HEADERS})}
 }
};
