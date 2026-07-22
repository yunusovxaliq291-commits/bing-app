const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// token(phone) -> socket.id, for routing call signaling to the right device
const onlineSockets = {};

io.on('connection', (socket) => {
  let myToken = null;

  socket.on('register', (token) => {
    if (!token) return;
    myToken = token;
    onlineSockets[token] = socket.id;
  });

  socket.on('call-user', ({ token, toPhone, offer, isVideo, callerName }) => {
    const target = onlineSockets[toPhone];
    if (!target) { socket.emit('call-failed', { reason: 'offline' }); return; }
    io.to(target).emit('incoming-call', { fromPhone: token, offer, isVideo, callerName });
  });

  socket.on('answer-call', ({ token, toPhone, answer }) => {
    const target = onlineSockets[toPhone];
    if (target) io.to(target).emit('call-answered', { fromPhone: token, answer });
  });

  socket.on('ice-candidate', ({ token, toPhone, candidate }) => {
    const target = onlineSockets[toPhone];
    if (target) io.to(target).emit('ice-candidate', { fromPhone: token, candidate });
  });

  socket.on('reject-call', ({ token, toPhone }) => {
    const target = onlineSockets[toPhone];
    if (target) io.to(target).emit('call-rejected', { fromPhone: token });
  });

  socket.on('end-call', ({ token, toPhone }) => {
    const target = onlineSockets[toPhone];
    if (target) io.to(target).emit('call-ended', { fromPhone: token });
  });

  socket.on('disconnect', () => {
    if (myToken && onlineSockets[myToken] === socket.id) delete onlineSockets[myToken];
  });
});

['uploads/videos','uploads/thumbs','uploads/avatars'].forEach(d=>{
  if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true});
});

/* ══════════════════════════════════════════════════════════
   VERİLƏNLƏR BAZASI — MongoDB Atlas (Render-in diski silinəndə
   belə (server yenidən başlayanda/deploy ediləndə) məlumatlar
   İTMİR, çünki artıq Render-in özündə saxlanmır).
   MONGODB_URI mühit dəyişənini Render-in "Environment" bölməsində
   qeyd etməlisiniz (bax README.md).
   ══════════════════════════════════════════════════════════ */
const MONGODB_URI = process.env.MONGODB_URI;
let mongoCollection = null;

async function connectDB(){
  if(!MONGODB_URI){
    console.warn('XƏBƏRDARLIQ: MONGODB_URI tapılmadı — məlumatlar YALNIZ yaddaşda saxlanacaq və server yenidən başlayanda İTƏCƏK. README.md-yə baxın.');
    return;
  }
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bingapp');
  mongoCollection = db.collection('store');
  console.log('MongoDB-yə qoşuldu ✅ — məlumatlar daimi saxlanılacaq');
}

// yaddaşda ehtiyat (fallback) — Mongo qoşulmayanda tətbiq yenə də açılsın deyə
const memoryStore = {};

const DB = {
  read: async (p) => {
    if(mongoCollection){
      const doc = await mongoCollection.findOne({_id:p});
      return doc ? doc.data : null;
    }
    return memoryStore[p]!==undefined ? memoryStore[p] : null;
  },
  write: async (p,d) => {
    if(mongoCollection){
      await mongoCollection.updateOne({_id:p},{$set:{data:d}},{upsert:true});
    } else {
      memoryStore[p]=d;
    }
  },
  readOrDef: async (p,def) => {
    const v = await DB.read(p);
    return (v===null||v===undefined) ? def : v;
  }
};

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
app.post('/api/auth/login', async (req,res)=>{
  const {phone,password,name,handle} = req.body;
  if(!phone) return res.json({ok:false,msg:'Nömrə lazımdır'});
  const users = await DB.readOrDef('users',{});
  const cleanPhone = phone.replace(/\D/g,'');
  const isAdmin = cleanPhone.endsWith(ADMIN_PHONE) && password===ADMIN_PASS;
  if(isAdmin){
    if(!users[ADMIN_PHONE]){
      users[ADMIN_PHONE]={phone:ADMIN_PHONE,name:'Bing',handle:'@bing',admin:true,init:'BI',color:'#3897F0',history:[],liked:[],saved:[],friends:[],createdAt:Date.now()};
      await DB.write('users',users);
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
    await DB.write('users',users);
  }
  res.json({ok:true,user:users[cleanPhone],token:cleanPhone});
});

app.get('/api/auth/me/:token', async (req,res)=>{
  const users=await DB.readOrDef('users',{});
  const u=users[req.params.token];
  if(!u) return res.json({ok:false});
  res.json({ok:true,user:u});
});

app.post('/api/auth/update', async (req,res)=>{
  const {token,name,handle,bio} = req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  if(name){users[token].name=name;users[token].init=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'SN';}
  if(handle) users[token].handle=handle.startsWith('@')?handle:'@'+handle;
  if(bio!==undefined) users[token].bio=bio;
  await DB.write('users',users);
  res.json({ok:true,user:users[token]});
});

const avatarStorage = multer.diskStorage({
  destination:(req,file,cb)=>cb(null,'uploads/avatars'),
  filename:(req,file,cb)=>cb(null,uuidv4()+path.extname(file.originalname))
});
const uploadAvatar = multer({storage: avatarStorage, limits:{fileSize:10*1024*1024}});

app.post('/api/auth/avatar', uploadAvatar.single('avatar'), async (req,res)=>{
  const {token} = req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false,msg:'Giriş edin'});
  if(!req.file) return res.json({ok:false,msg:'Şəkil seçin'});
  users[token].avatar = '/uploads/avatars/'+req.file.filename;
  await DB.write('users',users);
  res.json({ok:true,user:users[token]});
});

// ── VIDEOS ──
app.post('/api/videos/upload', upload.single('video'), async (req,res)=>{
  const {token,title,caption,tags,type,thumb,dur} = req.body;
  const users=await DB.readOrDef('users',{});
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
    const shorts=await DB.readOrDef('shorts',[]);
    shorts.unshift(vid);await DB.write('shorts',shorts);
  } else {
    const videos=await DB.readOrDef('videos',[]);
    videos.unshift(vid);await DB.write('videos',videos);
  }
  res.json({ok:true,video:vid});
});

app.get('/api/videos', async (req,res)=>{
  res.json({ok:true,videos:await DB.readOrDef('videos',[])});
});

app.get('/api/shorts', async (req,res)=>{
  res.json({ok:true,shorts:await DB.readOrDef('shorts',[])});
});

app.get('/api/search', async (req,res)=>{
  const q=(req.query.q||'').toLowerCase();
  if(!q) return res.json({ok:true,videos:[],shorts:[]});
  const videos=(await DB.readOrDef('videos',[])).filter(v=>
    v.title.toLowerCase().includes(q)||(v.tags||'').toLowerCase().includes(q)||v.handle.toLowerCase().includes(q)
  );
  const shorts=(await DB.readOrDef('shorts',[])).filter(s=>
    s.title.toLowerCase().includes(q)||(s.tags||'').toLowerCase().includes(q)||s.handle.toLowerCase().includes(q)
  );
  res.json({ok:true,videos,shorts});
});

app.post('/api/videos/:id/like', async (req,res)=>{
  const {token}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const id=req.params.id;
  const liked=users[token].liked||[];
  const idx=liked.indexOf(id);
  let delta=0;
  if(idx>-1){liked.splice(idx,1);delta=-1;}else{liked.push(id);delta=1;}
  users[token].liked=liked;
  await DB.write('users',users);
  const videos=await DB.readOrDef('videos',[]);
  const shorts=await DB.readOrDef('shorts',[]);
  let vf=false;
  for(const v of videos){if(v.id===id){v.likes=Math.max(0,(v.likes||0)+delta);vf=true;break;}}
  if(vf)await DB.write('videos',videos);
  else{for(const s of shorts){if(s.id===id){s.likes=Math.max(0,(s.likes||0)+delta);break;}}await DB.write('shorts',shorts);}
  res.json({ok:true,liked:idx===-1,likedList:liked});
});

app.post('/api/videos/:id/save', async (req,res)=>{
  const {token}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const id=req.params.id;
  const saved=users[token].saved||[];
  const idx=saved.indexOf(id);
  if(idx>-1)saved.splice(idx,1);else saved.push(id);
  users[token].saved=saved;
  await DB.write('users',users);
  res.json({ok:true,saved:idx===-1,savedList:saved});
});

app.post('/api/videos/:id/history', async (req,res)=>{
  const {token}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const id=req.params.id;
  const hist=users[token].history||[];
  const ei=hist.indexOf(id);
  if(ei>-1)hist.splice(ei,1);
  hist.unshift(id);
  users[token].history=hist.slice(0,100);
  await DB.write('users',users);
  res.json({ok:true});
});

app.post('/api/videos/:id/comment', async (req,res)=>{
  const {token,text}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]||!text) return res.json({ok:false});
  const u=users[token];
  const cmt={id:uuidv4(),name:u.name,init:u.init,color:u.color,verified:u.admin,text,createdAt:Date.now()};
  const videos=await DB.readOrDef('videos',[]);
  const shorts=await DB.readOrDef('shorts',[]);
  let found=false;
  for(const v of videos){if(v.id===req.params.id){v.comments=v.comments||[];v.comments.unshift(cmt);found=true;break;}}
  if(found)await DB.write('videos',videos);
  else{for(const s of shorts){if(s.id===req.params.id){s.comments=s.comments||[];s.comments.unshift(cmt);break;}}await DB.write('shorts',shorts);}
  res.json({ok:true,comment:cmt});
});

app.put('/api/videos/:id', async (req,res)=>{
  const {token,title,caption,tags}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const videos=await DB.readOrDef('videos',[]);
  const shorts=await DB.readOrDef('shorts',[]);
  let found=false;
  for(const v of videos){
    if(v.id===req.params.id){
      if(v.ownerPhone!==token&&!users[token].admin) return res.json({ok:false,msg:'İcazəniz yoxdur'});
      if(title)v.title=title;if(caption!==undefined)v.caption=caption;if(tags!==undefined)v.tags=tags;
      found=true;break;
    }
  }
  if(found){await DB.write('videos',videos);return res.json({ok:true});}
  for(const s of shorts){
    if(s.id===req.params.id){
      if(s.ownerPhone!==token&&!users[token].admin) return res.json({ok:false,msg:'İcazəniz yoxdur'});
      if(title)s.title=title;if(caption!==undefined)s.caption=caption;if(tags!==undefined)s.tags=tags;break;
    }
  }
  await DB.write('shorts',shorts);
  res.json({ok:true});
});

app.delete('/api/videos/:id', async (req,res)=>{
  const {token}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  let videos=await DB.readOrDef('videos',[]);
  let shorts=await DB.readOrDef('shorts',[]);
  const vi=videos.findIndex(v=>v.id===req.params.id);
  if(vi>-1){
    if(videos[vi].ownerPhone!==token&&!users[token].admin) return res.json({ok:false});
    try{fs.unlinkSync('uploads/videos/'+path.basename(videos[vi].videoUrl));}catch(e){}
    videos.splice(vi,1);await DB.write('videos',videos);return res.json({ok:true});
  }
  const si=shorts.findIndex(s=>s.id===req.params.id);
  if(si>-1){
    if(shorts[si].ownerPhone!==token&&!users[token].admin) return res.json({ok:false});
    try{fs.unlinkSync('uploads/videos/'+path.basename(shorts[si].videoUrl));}catch(e){}
    shorts.splice(si,1);await DB.write('shorts',shorts);return res.json({ok:true});
  }
  res.json({ok:false});
});

// ── FRIENDS ──
app.post('/api/friends/add', async (req,res)=>{
  const {token,targetPhone}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const clean=targetPhone.replace(/\D/g,'');
  if(!users[clean]) return res.json({ok:false,msg:'Bu nömrədə hesab tapılmadı'});
  if(!users[token].friends)users[token].friends=[];
  if(!users[token].friends.includes(clean)){
    users[token].friends.push(clean);
    if(!users[clean].friends)users[clean].friends=[];
    if(!users[clean].friends.includes(token))users[clean].friends.push(token);
  }
  await DB.write('users',users);
  res.json({ok:true,friend:users[clean]});
});

app.get('/api/friends/:token', async (req,res)=>{
  const users=await DB.readOrDef('users',{});
  const u=users[req.params.token];
  if(!u) return res.json({ok:false});
  const friends=(u.friends||[]).map(p=>users[p]).filter(Boolean);
  res.json({ok:true,friends});
});

app.get('/api/messages/:token/:other', async (req,res)=>{
  const key=[req.params.token,req.params.other].sort().join('_');
  res.json({ok:true,messages:await DB.readOrDef('msg_'+key,[])});
});

app.post('/api/messages/send', async (req,res)=>{
  const {token,toPhone,text,voice,dur}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const key=[token,toPhone].sort().join('_');
  const msgs=await DB.readOrDef('msg_'+key,[]);
  const msg={id:uuidv4(),from:token,text:text||'',voice:voice||false,dur:dur||'',ts:Date.now()};
  msgs.push(msg);
  await DB.write('msg_'+key,msgs);
  res.json({ok:true,message:msg});
});

// ── OYBİNG (3D DÜNYALAR) ──
app.get('/api/games', async (req,res)=>{
  const games=(await DB.readOrDef('games',[])).map(g=>({
    id:g.id,name:g.name,ownerPhone:g.ownerPhone,ownerName:g.ownerName,
    blockCount:(g.blocks||[]).length,createdAt:g.createdAt
  }));
  res.json({ok:true,games});
});

app.get('/api/games/:id', async (req,res)=>{
  const g=(await DB.readOrDef('games',[])).find(x=>x.id===req.params.id);
  if(!g) return res.json({ok:false});
  res.json({ok:true,game:g});
});

app.post('/api/games/save', async (req,res)=>{
  const {token,id,name,blocks}=req.body;
  const users=await DB.readOrDef('users',{});
  const u=users[token];
  if(!u) return res.json({ok:false,msg:'Giriş edin'});
  if(!Array.isArray(blocks)) return res.json({ok:false,msg:'Yanlış format'});
  if(blocks.length>4000) return res.json({ok:false,msg:'Dünya çox böyükdür (limit 4000 blok)'});
  const games=await DB.readOrDef('games',[]);
  if(id){
    const g=games.find(x=>x.id===id);
    if(!g) return res.json({ok:false,msg:'Dünya tapılmadı'});
    if(g.ownerPhone!==token && !u.admin) return res.json({ok:false,msg:'İcazəniz yoxdur'});
    g.name=name||g.name; g.blocks=blocks; g.updatedAt=Date.now();
    await DB.write('games',games);
    return res.json({ok:true,game:g});
  }
  const g={id:uuidv4(),name:name||'Adsız dünya',ownerPhone:token,ownerName:u.name,blocks,createdAt:Date.now()};
  games.unshift(g);
  await DB.write('games',games);
  res.json({ok:true,game:g});
});

app.delete('/api/games/:id', async (req,res)=>{
  const {token}=req.body;
  const users=await DB.readOrDef('users',{});
  if(!users[token]) return res.json({ok:false});
  const games=await DB.readOrDef('games',[]);
  const idx=games.findIndex(g=>g.id===req.params.id);
  if(idx===-1) return res.json({ok:false});
  if(games[idx].ownerPhone!==token && !users[token].admin) return res.json({ok:false,msg:'İcazəniz yoxdur'});
  games.splice(idx,1);
  await DB.write('games',games);
  res.json({ok:true});
});

app.get('/api/health', async (req,res)=>res.json({ok:true,msg:'Bing Server işləyir!',db:mongoCollection?'mongodb':'yaddaş (müvəqqəti!)'}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

connectDB().finally(()=>{
  httpServer.listen(PORT,()=>console.log(`Bing Server port ${PORT}-də işləyir (WebSocket zəng dəstəyi ilə)`));
});
