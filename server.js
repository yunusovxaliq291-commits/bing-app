const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

['uploads/videos','uploads/thumbs','data'].forEach(d=>{
  if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true});
});

const DB = {
  file: p => path.join('data', p+'.json'),
  read: p => { try{ return JSON.parse(fs.readFileSync(DB.file(p),'utf8')); }catch(e){ return null; } },
  write: (p,d) => fs.writeFileSync(DB.file(p), JSON.stringify(d,null,2)),
  readOrDef: (p,def) => DB.read(p) || def
};

if(!DB.read('users')) DB.write('users',{});
if(!DB.read('videos')) DB.write('videos',[]);
if(!DB.read('shorts')) DB.write('shorts',[]);

app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination:(req,file,cb)=>cb(null,'uploads/videos'),
  filename:(req,file,cb)=>cb(null,uuidv4()+path.extname(file.originalname))
});
const upload = multer({storage, limits:{fileSize:500*1024*1024}});

const ADMIN_PHONE='702008702';
const ADMIN_PASS='ekbe433ekbe43333bing.com';

// ── AUTH ──
app.post('/api/auth/login', (req,res)=>{
  const {phone,password,name,handle} = req.body;
  if(!phone) return res.json({ok:false,msg:'Nömrə lazımdır'});
  const users = DB.readOrDef('users',{});
  const cleanPhone = phone.replace(/\D/g,'');
  const isAdmin = cleanPhone.endsWith(ADMIN_PHONE) && password===ADMIN_PASS;
  if(isAdmin){
    if(!users[ADMIN_PHONE]){
      users[ADMIN_PHONE]={phone:ADMIN_PHONE,name:'Bing',handle:'@bing',admin:true,init:'BI',color:'#3897F0',history:[],liked:[],saved:[],friends:[],createdAt:Date.now()};
      DB.write('users',users);
    }
    return res.json({ok:true,user:users[ADMIN_PHONE],token:ADMIN_PHONE});
  }
  if(!users[cleanPhone]){
    if(!name) return res.json({ok:false,msg:'Ad Soyad lazımdır'});
    const colors=['#7F77DD','#D85A30','#1D9E75','#BA7517','#5DCAA5'];
    users[cleanPhone]={
      phone:cleanPhone,name,handle:handle||(handle||('@user'+cleanPhone.slice(-4))),
      admin:false,init:name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'SN',
      color:colors[Object.keys(users).length%colors.length],
      history:[],liked:[],saved:[],friends:[],createdAt:Date.now()
    };
    DB.write('users',users);
  }
  res.json({ok:true,user:users[cleanPhone],token:cleanPhone});
});

app.get('/api/auth/me/:token', (req,res)=>{
  const users=DB.readOrDef('users',{});
  const u=users[req.params.token];
  if(!u) return res.json({ok:false});
  res.json({ok:true,user:u});
});

app.post('/api/auth/update', (req,res)=>{
  const {token,name,handle,bio} = req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  if(name){users[token].name=name;users[token].init=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'SN';}
  if(handle) users[token].handle=handle.startsWith('@')?handle:'@'+handle;
  if(bio!==undefined) users[token].bio=bio;
  DB.write('users',users);
  res.json({ok:true,user:users[token]});
});

// ── VIDEOS ──
app.post('/api/videos/upload', upload.single('video'), (req,res)=>{
  const {token,title,caption,tags,type,thumb,dur} = req.body;
  const users=DB.readOrDef('users',{});
  const u=users[token];
  if(!u) return res.json({ok:false,msg:'Giriş edin'});
  if(!req.file) return res.json({ok:false,msg:'Video faylı seçin'});
  if(!title) return res.json({ok:false,msg:'Başlıq yazın'});
  const vid={
    id:uuidv4(),type:type||'video',title,caption:caption||'',tags:tags||'',
    videoUrl:'/uploads/videos/'+req.file.filename,
    thumb:thumb||null,dur:dur||'0:00',
    handle:u.handle,chName:u.name,init:u.init,color:u.color,
    verified:u.admin,ownerPhone:token,
    views:0,likes:0,comments:[],
    createdAt:Date.now(),date:'İndi'
  };
  if(type==='short'){
    const shorts=DB.readOrDef('shorts',[]);
    shorts.unshift(vid);DB.write('shorts',shorts);
  } else {
    const videos=DB.readOrDef('videos',[]);
    videos.unshift(vid);DB.write('videos',videos);
  }
  res.json({ok:true,video:vid});
});

app.get('/api/videos',(req,res)=>{
  res.json({ok:true,videos:DB.readOrDef('videos',[])});
});

app.get('/api/shorts',(req,res)=>{
  res.json({ok:true,shorts:DB.readOrDef('shorts',[])});
});

app.get('/api/search',(req,res)=>{
  const q=(req.query.q||'').toLowerCase();
  if(!q) return res.json({ok:true,videos:[],shorts:[]});
  const videos=DB.readOrDef('videos',[]).filter(v=>
    v.title.toLowerCase().includes(q)||(v.tags||'').toLowerCase().includes(q)||v.handle.toLowerCase().includes(q)
  );
  const shorts=DB.readOrDef('shorts',[]).filter(s=>
    s.title.toLowerCase().includes(q)||(s.tags||'').toLowerCase().includes(q)||s.handle.toLowerCase().includes(q)
  );
  res.json({ok:true,videos,shorts});
});

app.post('/api/videos/:id/like',(req,res)=>{
  const {token}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const id=req.params.id;
  const liked=users[token].liked||[];
  const idx=liked.indexOf(id);
  let delta=0;
  if(idx>-1){liked.splice(idx,1);delta=-1;}else{liked.push(id);delta=1;}
  users[token].liked=liked;
  DB.write('users',users);
  const videos=DB.readOrDef('videos',[]);
  const shorts=DB.readOrDef('shorts',[]);
  let vf=false;
  for(const v of videos){if(v.id===id){v.likes=Math.max(0,(v.likes||0)+delta);vf=true;break;}}
  if(vf)DB.write('videos',videos);
  else{for(const s of shorts){if(s.id===id){s.likes=Math.max(0,(s.likes||0)+delta);break;}}DB.write('shorts',shorts);}
  res.json({ok:true,liked:idx===-1,likedList:liked});
});

app.post('/api/videos/:id/save',(req,res)=>{
  const {token}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const id=req.params.id;
  const saved=users[token].saved||[];
  const idx=saved.indexOf(id);
  if(idx>-1)saved.splice(idx,1);else saved.push(id);
  users[token].saved=saved;
  DB.write('users',users);
  res.json({ok:true,saved:idx===-1,savedList:saved});
});

app.post('/api/videos/:id/history',(req,res)=>{
  const {token}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const id=req.params.id;
  const hist=users[token].history||[];
  const ei=hist.indexOf(id);
  if(ei>-1)hist.splice(ei,1);
  hist.unshift(id);
  users[token].history=hist.slice(0,100);
  DB.write('users',users);
  res.json({ok:true});
});

app.post('/api/videos/:id/comment',(req,res)=>{
  const {token,text}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]||!text) return res.json({ok:false});
  const u=users[token];
  const cmt={id:uuidv4(),name:u.name,init:u.init,color:u.color,verified:u.admin,text,createdAt:Date.now()};
  const videos=DB.readOrDef('videos',[]);
  const shorts=DB.readOrDef('shorts',[]);
  let found=false;
  for(const v of videos){if(v.id===req.params.id){v.comments=v.comments||[];v.comments.unshift(cmt);found=true;break;}}
  if(found)DB.write('videos',videos);
  else{for(const s of shorts){if(s.id===req.params.id){s.comments=s.comments||[];s.comments.unshift(cmt);break;}}DB.write('shorts',shorts);}
  res.json({ok:true,comment:cmt});
});

app.put('/api/videos/:id',(req,res)=>{
  const {token,title,caption,tags}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const videos=DB.readOrDef('videos',[]);
  const shorts=DB.readOrDef('shorts',[]);
  let found=false;
  for(const v of videos){
    if(v.id===req.params.id){
      if(v.ownerPhone!==token&&!users[token].admin) return res.json({ok:false,msg:'İcazəniz yoxdur'});
      if(title)v.title=title;if(caption!==undefined)v.caption=caption;if(tags!==undefined)v.tags=tags;
      found=true;break;
    }
  }
  if(found){DB.write('videos',videos);return res.json({ok:true});}
  for(const s of shorts){
    if(s.id===req.params.id){
      if(s.ownerPhone!==token&&!users[token].admin) return res.json({ok:false,msg:'İcazəniz yoxdur'});
      if(title)s.title=title;if(caption!==undefined)s.caption=caption;if(tags!==undefined)s.tags=tags;break;
    }
  }
  DB.write('shorts',shorts);
  res.json({ok:true});
});

app.delete('/api/videos/:id',(req,res)=>{
  const {token}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  let videos=DB.readOrDef('videos',[]);
  let shorts=DB.readOrDef('shorts',[]);
  const vi=videos.findIndex(v=>v.id===req.params.id);
  if(vi>-1){
    if(videos[vi].ownerPhone!==token&&!users[token].admin) return res.json({ok:false});
    try{fs.unlinkSync('uploads/videos/'+path.basename(videos[vi].videoUrl));}catch(e){}
    videos.splice(vi,1);DB.write('videos',videos);return res.json({ok:true});
  }
  const si=shorts.findIndex(s=>s.id===req.params.id);
  if(si>-1){
    if(shorts[si].ownerPhone!==token&&!users[token].admin) return res.json({ok:false});
    try{fs.unlinkSync('uploads/videos/'+path.basename(shorts[si].videoUrl));}catch(e){}
    shorts.splice(si,1);DB.write('shorts',shorts);return res.json({ok:true});
  }
  res.json({ok:false});
});

// ── FRIENDS ──
app.post('/api/friends/add',(req,res)=>{
  const {token,targetPhone}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const clean=targetPhone.replace(/\D/g,'');
  if(!users[clean]) return res.json({ok:false,msg:'Bu nömrədə hesab tapılmadı'});
  if(!users[token].friends)users[token].friends=[];
  if(!users[token].friends.includes(clean)){
    users[token].friends.push(clean);
    if(!users[clean].friends)users[clean].friends=[];
    if(!users[clean].friends.includes(token))users[clean].friends.push(token);
  }
  DB.write('users',users);
  res.json({ok:true,friend:users[clean]});
});

app.get('/api/friends/:token',(req,res)=>{
  const users=DB.readOrDef('users',{});
  const u=users[req.params.token];
  if(!u) return res.json({ok:false});
  const friends=(u.friends||[]).map(p=>users[p]).filter(Boolean);
  res.json({ok:true,friends});
});

app.get('/api/messages/:token/:other',(req,res)=>{
  const key=[req.params.token,req.params.other].sort().join('_');
  res.json({ok:true,messages:DB.readOrDef('msg_'+key,[])});
});

app.post('/api/messages/send',(req,res)=>{
  const {token,toPhone,text,voice,dur}=req.body;
  const users=DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const key=[token,toPhone].sort().join('_');
  const msgs=DB.readOrDef('msg_'+key,[]);
  const msg={id:uuidv4(),from:token,text:text||'',voice:voice||false,dur:dur||'',ts:Date.now()};
  msgs.push(msg);
  DB.write('msg_'+key,msgs);
  res.json({ok:true,message:msg});
});

app.get('/api/health',(req,res)=>res.json({ok:true,msg:'Bing Server işləyir!'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log(`Bing Server port ${PORT}-də işləyir`));
