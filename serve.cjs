const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,port=Number(process.env.PORT)||5173;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.json':'application/json; charset=utf-8'};
http.createServer((req,res)=>{
  try{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const target=fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;
    if(!fs.statSync(target).isFile())throw new Error();
    res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(target).pipe(res);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`DUSTVECTOR: http://127.0.0.1:${port}`));
