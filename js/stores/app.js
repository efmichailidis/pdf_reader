(function(){
"use strict";
// Endpoint που επιστρέφει { success, items: { stores: [[...]], facilities: [[...]] } }
const API_URL = "/api/sheets";

const coll = new Intl.Collator("el",{numeric:true,sensitivity:"base"});
const nf = new Intl.NumberFormat("el-GR",{maximumFractionDigits:2});
const PALETTE = ["#A92A1F","#D27A22","#3D7A57","#2E5C8A","#7B4D8E","#8A7531","#3F8587","#9A4636","#5A6670","#B08E5C","#6F8B3A","#B24E7A"];
const EMPTY = "\u0000";
const EMPTY_LABEL = "Χωρίς τιμή";

const SCHEMAS = {
  stores:{
    label:"Καταστήματα", one:"κατάστημα", many:"καταστήματα",
    fields:{code:["Κωδικός"],name:["Ονομασία"],type:["Τύπος Καταστήματος"],address:["Διεύθυνση"],tk:["ΤΚ"],city:["Πόλη / Περιοχή"],geo:["Γεωγραφική Περιφέρεια"],network:["ΔΙΚΤΥΟ","Δίκτυο Εξυπηρέτησης"],region:["ΠΕΡΙΦΕΡΕΙΑ"],status:["Κατάσταση"],loctype:["Τύπος τοποθεσίας"],owner:["Ιδιοκτησιακό καθεστώς"],area:["Επιφάνεια ακινήτου (τ.μ.)"],desc:["Ανάλυση / περιγραφή ακινήτου"],email:["Email"],update:["ΤΕΛΕΥΤΑΙΑ ΕΝΗΜΕΡΩΣΗ"]},
    typeLabel:"Τύπος", mixTitle:"Κατανομή ανά τύπο καταστήματος",
    facets:[["type","Τύπος"],["geo","Γεωγρ. περιφέρεια"],["network","Δίκτυο"],["region","Περιφέρεια"],["owner","Ιδιοκτησία"],["loctype","Τύπος τοποθεσίας"]]
  },
  facilities:{
    label:"Εγκαταστάσεις", one:"εγκατάσταση", many:"εγκαταστάσεις",
    fields:{code:["Κωδικός Εγκατάστασης","Κωδικός"],name:["Ονομασία"],type:["Κατηγορία Εγκατάστασης"],address:["Διεύθυνση"],tk:["ΤΚ"],city:["Πόλη / Περιοχή"],geo:["Γεωγραφική Περιφέρεια"],network:["Δίκτυο Εξυπηρέτησης","ΔΙΚΤΥΟ"],region:["ΠΕΡΙΦΕΡΕΙΑ"],status:["Κατάσταση"],loctype:["Τύπος τοποθεσίας"],owner:["Ιδιοκτησιακό καθεστώς"],area:["Επιφάνεια ακινήτου (τ.μ.)"],desc:["Ανάλυση / περιγραφή ακινήτου"],email:["Email"],update:["ΤΕΛΕΥΤΑΙΑ ΕΝΗΜΕΡΩΣΗ"]},
    typeLabel:"Κατηγορία", mixTitle:"Κατανομή ανά κατηγορία εγκατάστασης",
    facets:[["type","Κατηγορία"],["geo","Γεωγρ. περιφέρεια"],["network","Δίκτυο"],["loctype","Τύπος τοποθεσίας"],["owner","Ιδιοκτησία"]]
  }
};
// Spelling variants of the same store type are merged so filters don't split them.
// Καταστάσεις που δεν εμφανίζονται καθόλου στη σελίδα.
const HIDDEN_STATUSES = new Set(["μελλοντικό"]);
// Τύποι καταστημάτων: σειρά εμφάνισης, ονομασία που εμφανίζεται, και οι τιμές του φύλλου που αντιστοιχούν.
// Η σύγκριση αγνοεί κεφαλαία, κενά και παύλες. Τύποι που δεν είναι εδώ μπαίνουν μετά, αλφαβητικά.
const TYPE_ORDER = [
  ["Hypermarket",           ["HYPER","HYPERMARKET"]],
  ["Supermarket+",          ["SUPER+","SUPERMARKET+"]],
  ["Supermarket",           ["SUPER","SUPERMARKET"]],
  ["Freshmarket",           ["FRESH","FRESHMARKET","FRESH MARKET"]],
  ["Self-service",          ["SELF-SERVICE","SELF SERVICE","SELFSERVICE"]],
  ["Food to Go",            ["FTG","FOOD TO GO","FOOD-TO-GO"]],
  ["Franchise",             ["FRANCHISE"]],
  ["Franchise Food to Go",  ["FTG FRANCHISE","FRANCHISE FTG","FRANCHISE FOOD TO GO","FOOD TO GO FRANCHISE"]]
];
const typeKey = s => String(s).toUpperCase().replace(/[\s\-_]+/g,"");
const TYPE_CANON = new Map(), TYPE_RANK = new Map();
TYPE_ORDER.forEach(([label,aliases],i)=>{ TYPE_RANK.set(label,i); [label,...aliases].forEach(a=>TYPE_CANON.set(typeKey(a),label)); });
const canonType = s => s ? (TYPE_CANON.get(typeKey(s)) || s) : s;
const typeRank = s => TYPE_RANK.has(s) ? TYPE_RANK.get(s) : TYPE_ORDER.length;
const compareType = (a,b) => (typeRank(a)-typeRank(b)) || coll.compare(a,b);

const COLUMNS = [
  {key:"code",label:"Κωδικός",cls:"code"},
  {key:"name",label:"Ονομασία",cls:"name"},
  {key:"type",label:null},
  {key:"city",label:"Τοποθεσία"},
  {key:"map",label:"Χάρτης",nosort:true,cls:"map"},
  {key:"geo",label:"Γεωγρ. περιφέρεια"},
  {key:"network",label:"Δίκτυο"},
  {key:"status",label:"Κατάσταση"},
  {key:"owner",label:"Ιδιοκτησία"},
  {key:"area",label:"Επιφάνεια (τ.μ.)",cls:"num"}
];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fold = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const clean = v => (v==null?"":String(v)).replace(/\s+$/,"").replace(/^\s+/,"");

function parseArea(s){
  const m = clean(s).match(/\d[\d.]*(,\d*)?/);
  if(!m) return null;
  let num = m[0];
  // Ελληνική μορφή: η τελεία είναι διαχωριστικό χιλιάδων («2.042»). Αν όμως δεν υπάρχει κόμμα
  // και η τελευταία ομάδα μετά την τελεία δεν έχει 3 ψηφία («4.472.77»), είναι υποδιαστολή.
  if(!num.includes(",")){ const k = num.lastIndexOf("."); if(k>=0 && num.length-k-1!==3) num = num.slice(0,k)+","+num.slice(k+1); }
  const n = parseFloat(num.replace(/\./g,"").replace(",","."));
  return isFinite(n) ? n : null;
}

function buildDataset(kind, rows){
  const sc = SCHEMAS[kind];
  if(!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) return null;
  const header = rows[0].map(h=>clean(h).toLowerCase());
  const idx = {};
  for(const [k,names] of Object.entries(sc.fields)){
    idx[k] = -1;
    for(const n of names){ const i = header.indexOf(n.toLowerCase()); if(i>=0){ idx[k]=i; break; } }
  }
  const has = k => idx[k] >= 0;
  let updateNote = "";
  const items = [];
  rows.slice(1).forEach((r,i)=>{
    if(!Array.isArray(r)) return;
    const g = k => has(k) ? clean(r[idx[k]]) : "";
    if(!updateNote && g("update")) updateNote = g("update");
    if(!g("code") && !g("name")) return;
    if(HIDDEN_STATUSES.has(g("status").toLowerCase())) return;  // τα μελλοντικά δεν εμφανίζονται
    const type = canonType(g("type"));
    const it = {
      id: kind+":"+i, code:g("code"), name:g("name"), type, address:g("address"), tk:g("tk"), city:g("city"),
      geo:g("geo"), network:g("network"), region:g("region"), status:g("status"), loctype:g("loctype"),
      owner:g("owner"), areaRaw:g("area"), area:parseArea(g("area")), desc:g("desc"),
      emails: g("email").split(/[\s,;]+/).filter(e=>e.includes("@"))
    };
    it.hay = fold([it.code,it.name,it.address,it.tk,it.tk.replace(/\s/g,""),it.city,it.region,it.network,it.desc,it.emails.join(" ")].join(" | "));
    items.push(it);
  });
  const facets = sc.facets.filter(([k])=>has(k));
  const typeValues = [...new Set(items.map(i=>i.type||EMPTY))]
    .sort((a,b)=>items.filter(i=>(i.type||EMPTY)===b).length - items.filter(i=>(i.type||EMPTY)===a).length);
  const colors = {}; typeValues.forEach((t,i)=>colors[t] = t===EMPTY ? "#8C949B" : PALETTE[i % PALETTE.length]);
  return {kind, sc, items, facets, has, colors, updateNote};
}

const state = {tab:"stores", data:{}, view:{}};
function freshView(){ return {q:"", sel:{}, sort:{key:"name",dir:1}, open:new Set()}; }

function load(json, sourceLabel, keepViews){
  const items = json && json.items;
  if(!items || (!items.stores && !items.facilities)) throw new Error("Το αρχείο δεν περιέχει items.stores ή items.facilities.");
  const data = {};
  for(const k of ["stores","facilities"]){
    if(items[k]){ const d = buildDataset(k, items[k]); if(d) data[k]=d; }
  }
  if(!Object.keys(data).length) throw new Error("Οι πίνακες δεν έχουν την αναμενόμενη μορφή (πρώτη γραμμή επικεφαλίδες, μετά γραμμές τιμών).");
  state.data = data;
  for(const k of Object.keys(data)) if(!keepViews || !state.view[k]) state.view[k] = freshView();
  if(!data[state.tab]) state.tab = Object.keys(data)[0];
  $("source").textContent = sourceLabel;
  renderAll();
}

/* ---------- filtering ---------- */
const D = () => state.data && state.data[state.tab];
const V = () => state.view[state.tab];
const val = (it,k) => it[k] || EMPTY;

function passes(it, v, except){
  for(const [k,set] of Object.entries(v.sel)){
    if(k===except || !set.size) continue;
    if(!set.has(val(it,k))) return false;
  }
  if(v.q){
    const terms = fold(v.q).split(/\s+/).filter(Boolean);
    for(const t of terms) if(!it.hay.includes(t)) return false;
  }
  return true;
}
function counts(key){
  const d=D(), v=V(), m=new Map();
  for(const it of d.items){ if(passes(it,v,key)){ const x=val(it,key); m.set(x,(m.get(x)||0)+1); } }
  return m;
}
function allValues(key){
  const s=new Set(D().items.map(it=>val(it,key)));
  const cmp = key==="type" ? compareType : coll.compare;
  return [...s].sort((a,b)=> a===EMPTY?1 : b===EMPTY?-1 : cmp(a,b));
}
function sortItems(list){
  const {key,dir}=V().sort;
  const get = it => key==="area" ? it.area : (key==="city" ? (it.city||"") : (it[key]||""));
  return list.slice().sort((a,b)=>{
    const x=get(a), y=get(b);
    const ex = x===null||x==="", ey = y===null||y==="";
    if(ex&&ey) return coll.compare(a.name,b.name);
    if(ex) return 1; if(ey) return -1;
    const c = key==="area" ? x-y : key==="type" ? compareType(x,y) : coll.compare(x,y);
    return c ? c*dir : coll.compare(a.name,b.name);
  });
}

/* ---------- rendering ---------- */
function renderAll(){ renderTabs(); renderFacetShells(); renderSortSelect(); syncInputs(); render(); }

function renderTabs(){
  $("tabs").innerHTML = Object.values(state.data).map(d=>
    `<button class="tab" role="tab" data-tab="${d.kind}" aria-selected="${d.kind===state.tab}">${esc(d.sc.label)}<span class="count">${d.items.length}</span></button>`
  ).join("");
}
function renderFacetShells(){
  $("facets").innerHTML = D().facets.map(([k,label])=>
    `<details class="facet" data-key="${k}"><summary>${esc(label)}<span class="b"></span></summary><div class="menu"><div class="list"></div><div class="menu-foot"><button class="btn link" data-clear="${k}" type="button">Καθαρισμός</button></div></div></details>`
  ).join("");
}
function renderSortSelect(){
  const opts=[];
  for(const c of COLUMNS){
    if(c.nosort) continue;
    const l = c.label || D().sc.typeLabel;
    if(c.key==="area"){ opts.push(["area:-1",l+": μεγαλύτερη πρώτα"],["area:1",l+": μικρότερη πρώτα"]); }
    else opts.push([c.key+":1",l+": Α→Ω"],[c.key+":-1",l+": Ω→Α"]);
  }
  $("sortsel").innerHTML = opts.map(([v,l])=>`<option value="${v}">Ταξινόμηση: ${esc(l)}</option>`).join("");
}
function syncInputs(){
  const v=V(); $("q").value=v.q; 
}

function render(){
  const d=D(), v=V();
  const list = sortItems(d.items.filter(it=>passes(it,v)));
  renderFacetLists(); renderChips(); renderHead(); renderBody(list);
  $("sortsel").value = v.sort.key+":"+v.sort.dir;
  const total = list.reduce((s,it)=>s+(it.area||0),0);
  const missing = list.filter(it=>it.area==null).length;
  $("count").innerHTML = list.length===d.items.length
    ? `<strong>${list.length}</strong> ${d.sc.many}`
    : `Εμφανίζονται <strong>${list.length}</strong> από ${d.items.length} ${d.sc.many}`;
  const note = $("note");
  if(d.updateNote){
    const [first,...rest] = d.updateNote.split("\n");
    note.hidden=false;
    note.innerHTML = `<summary>Τελευταία ενημέρωση φύλλου: ${esc(first)}</summary>${rest.length?`<pre>${esc(rest.join("\n"))}</pre>`:""}`;
  } else note.hidden=true;
}

function renderFacetLists(){
  const v=V();
  document.querySelectorAll("#facets details.facet").forEach(det=>{
    const k=det.dataset.key, c=counts(k), sel=v.sel[k]||new Set();
    const focused = document.activeElement && det.contains(document.activeElement) ? document.activeElement.value : null;
    det.querySelector(".list").innerHTML = allValues(k).map(x=>{
      const n=c.get(x)||0;
      return `<label class="${n?"":"zero"}"><input type="checkbox" value="${esc(x)}" ${sel.has(x)?"checked":""}><span class="lbl ${x===EMPTY?"empty-val":""}">${esc(x===EMPTY?EMPTY_LABEL:x)}</span><span class="n">${n}</span></label>`;
    }).join("");
    det.classList.toggle("active", sel.size>0);
    det.querySelector("summary .b").innerHTML = sel.size?`<span class="badge">${sel.size}</span>`:"";
    if(focused!=null){ const el=[...det.querySelectorAll("input")].find(i=>i.value===focused); if(el) el.focus(); }
  });
}

function renderChips(){
  const d=D(), v=V(), chips=[];
  const label = k => (d.facets.find(f=>f[0]===k)||[k,k])[1];
  for(const [k,set] of Object.entries(v.sel)) for(const x of set)
    chips.push(`<button class="chip" data-chip="${k}" data-val="${esc(x)}">${esc(label(k))}: ${esc(x===EMPTY?EMPTY_LABEL:x)}<span class="x" aria-hidden="true">×</span><span class="sr">Αφαίρεση</span></button>`);
  if(v.q) chips.push(`<button class="chip" data-chip="q">Αναζήτηση: «${esc(v.q)}»<span class="x">×</span></button>`);
  if(chips.length>1) chips.push(`<button class="btn link" data-chip="all">Καθαρισμός όλων</button>`);
  $("chips").innerHTML = chips.join("");
}

function renderHead(){
  const v=V();
  $("thead").innerHTML = "<tr>" + COLUMNS.map(c=>{
    const l = c.label || D().sc.typeLabel;
    if(c.nosort) return `<th class="${c.cls||""}"><span class="th-plain">${esc(l)}</span></th>`;
    const on = v.sort.key===c.key;
    const aria = on ? (v.sort.dir===1?"ascending":"descending") : "none";
    const arrow = on ? (v.sort.dir===1?"▲":"▼") : "▲";
    return `<th class="${c.cls||""}" aria-sort="${aria}"><button data-sort="${c.key}">${esc(l)}<span class="arrow" aria-hidden="true">${arrow}</span></button></th>`;
  }).join("") + `<th aria-label="Λεπτομέρειες"></th></tr>`;
}

const blank = `<span class="blank">—</span>`;
// Google Maps search με τη διεύθυνση, γιατί τα δεδομένα δεν έχουν συντεταγμένες.
function mapsUrl(it){
  const parts = [it.address, [it.tk,it.city].filter(Boolean).join(" ")].filter(Boolean);
  if(!parts.length) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(parts.join(", ") + ", Ελλάδα");
}
function mapLink(it){
  const u = mapsUrl(it);
  if(!u) return blank;
  const addr = [it.address,[it.tk,it.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return `<a class="maplink" data-addr="${esc(addr)}" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="Άνοιγμα στο Google Maps (νέα καρτέλα)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span class="sr">Χάρτης για ${esc(it.name||it.code)}, ανοίγει σε νέα καρτέλα</span><span class="ext" aria-hidden="true">↗</span></a>`;
}
const txt = s => s ? esc(s) : blank;

function renderBody(list){
  const d=D(), v=V(), tl=d.sc.typeLabel;
  if(!list.length){
    $("tbody").innerHTML = `<tr><td colspan="${COLUMNS.length+1}" class="empty"><p>Κανένα αποτέλεσμα με αυτά τα φίλτρα.</p><button class="btn" data-chip="all">Καθαρισμός φίλτρων</button></td></tr>`;
    return;
  }
  $("tbody").innerHTML = list.map(it=>{
    const open = v.open.has(it.id);
    const st = it.status==="Σε λειτουργία" ? "ok" : it.status==="Μελλοντικό" ? "future" : "";
    const row = `<tr class="row ${open?"open":""}" data-id="${it.id}">
      <td class="code">${txt(it.code)}</td>
      <td class="name"><button class="nm" aria-expanded="${open}">${txt(it.name)}</button></td>
      <td data-label="${esc(tl)}">${it.type?`<span class="tag" style="--c:${d.colors[it.type]}">${esc(it.type)}</span>`:blank}</td>
      <td data-label="Τοποθεσία"><span>${txt(it.address)}<span class="second">${esc([it.tk,it.city].filter(Boolean).join(" "))||""}</span></span></td>
      <td class="map" data-label="Χάρτης">${mapLink(it)}</td>
      <td data-label="Γεωγρ. περιφέρεια">${txt(it.geo)}</td>
      <td data-label="Δίκτυο"><span>${txt(it.network)}${it.region?`<span class="second">${esc(it.region)}</span>`:""}</span></td>
      <td data-label="Κατάσταση">${it.status?`<span class="status ${st}">${esc(it.status)}</span>`:blank}</td>
      <td data-label="Ιδιοκτησία">${txt(it.owner)}</td>
      <td class="num" data-label="Επιφάνεια">${it.area!=null?nf.format(it.area):blank}</td>
      <td class="chev muted" aria-hidden="true">${open?"▾":"▸"}</td>
    </tr>`;
    if(!open) return row;
    const items = [
      ["Περιγραφή ακινήτου", txt(it.desc)],
      ["Email", it.emails.length ? it.emails.map(e=>`<a href="mailto:${esc(e)}">${esc(e)}</a>`).join("<br>") : blank],
      ["Διεύθυνση", txt([it.address,[it.tk,it.city].filter(Boolean).join(" ")].filter(Boolean).join(", "))],
      ["Επιφάνεια όπως καταχωρήθηκε", txt(it.areaRaw)]
    ];
    if(d.has("region")) items.push(["Περιφέρεια", txt(it.region)]);
    if(d.has("loctype")) items.push(["Τύπος τοποθεσίας", txt(it.loctype)]);
    return row + `<tr class="detail"><td colspan="${COLUMNS.length+1}"><dl class="dgrid">${items.map(([a,b])=>`<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl></td></tr>`;
  }).join("");
}

/* ---------- events ---------- */
document.addEventListener("click", e=>{
  const t = e.target.closest("button,summary,a,input,label") || e.target;
  // close other facet menus
  document.querySelectorAll("details.facet[open]").forEach(det=>{ if(!det.contains(e.target)) det.open=false; });

  if(!D()) return;
  const tab = e.target.closest("[data-tab]");
  if(tab){ state.tab=tab.dataset.tab; renderAll(); return; }


  const so = e.target.closest("[data-sort]");
  if(so){ const v=V(), k=so.dataset.sort;
    if(v.sort.key===k) v.sort.dir*=-1; else v.sort={key:k,dir:k==="area"?-1:1};
    render(); return; }

  const cl = e.target.closest("[data-clear]");
  if(cl){ delete V().sel[cl.dataset.clear]; render(); return; }

  const ch = e.target.closest("[data-chip]");
  if(ch){ const v=V(), k=ch.dataset.chip;
    if(k==="all"){ v.sel={}; v.q=""; syncInputs(); }
    else if(k==="q"){ v.q=""; syncInputs(); }
    else { const s=v.sel[k]; s && s.delete(ch.dataset.val); }
    render(); return; }

  const row = e.target.closest("tr.row");
  if(row && !e.target.closest("a")){
    const v=V(), id=row.dataset.id;
    v.open.has(id)?v.open.delete(id):v.open.add(id);
    render();
    if(e.detail===0){ const again=document.querySelector(`tr.row[data-id="${CSS.escape(id)}"] .nm`); if(again) again.focus({preventScroll:true}); }
  }
});
function toggle(k,x){
  const v=V(); const s=v.sel[k]||(v.sel[k]=new Set());
  s.has(x)?s.delete(x):s.add(x); render();
}
$("facets").addEventListener("change", e=>{ if(!D()) return;
  const det=e.target.closest("details.facet"); if(!det) return;
  toggle(det.dataset.key, e.target.value);
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape") document.querySelectorAll("details.facet[open]").forEach(d=>{d.open=false; d.querySelector("summary").focus();});
});
let qt; $("q").addEventListener("input", e=>{ clearTimeout(qt); qt=setTimeout(()=>{ if(!D()) return; V().q=e.target.value.trim(); render(); },120); });
$("sortsel").addEventListener("change", e=>{ if(!D()) return; const [k,d]=e.target.value.split(":"); V().sort={key:k,dir:+d}; render(); });

/* ---------- loading a new JSON ---------- */
function banner(msg, err){
  $("banner").innerHTML = `<div class="banner ${err?"err":""}" role="status"><span>${msg}</span><button class="btn link" type="button" onclick="this.closest('.banner').remove()">Απόκρυψη</button></div>`;
}
function readFile(f){
  if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      load(JSON.parse(r.result), "Δεδομένα από το αρχείο " + f.name, true);
      const d=state.data;
      banner(`Φορτώθηκε το ${esc(f.name)}: ${d.stores?d.stores.items.length+" καταστήματα":""}${d.stores&&d.facilities?" και ":""}${d.facilities?d.facilities.items.length+" εγκαταστάσεις":""}. Με «Ανανέωση» επιστρέφετε στα δεδομένα του API.`);
    }catch(err){ banner(`Δεν φορτώθηκε το ${esc(f.name)}. ${esc(err.message||"Μη έγκυρο JSON.")}`, true); }
  };
  r.onerror=()=>banner(`Δεν διαβάστηκε το ${esc(f.name)}.`, true);
  r.readAsText(f,"utf-8");
}
// $("file").addEventListener("change", e=>{ readFile(e.target.files[0]); e.target.value=""; });
let dragDepth=0;
window.addEventListener("dragenter", e=>{ if([...(e.dataTransfer?.types||[])].includes("Files")){ dragDepth++; $("drop").classList.add("on"); } });
window.addEventListener("dragleave", ()=>{ if(--dragDepth<=0){ dragDepth=0; $("drop").classList.remove("on"); } });
window.addEventListener("dragover", e=>e.preventDefault());
window.addEventListener("drop", e=>{ e.preventDefault(); dragDepth=0; $("drop").classList.remove("on"); readFile(e.dataTransfer.files[0]); });

/* ---------- Google Maps μέσα σε iframe / Staffbase ----------
   Μέσα στη Staffbase η σελίδα τρέχει σε iframe, όπου ένα απλό target="_blank" μπορεί να
   φορτώσει τον χάρτη μέσα στο πλαίσιο και το Google να τον μπλοκάρει ("refused to connect").
   1) Στη native εφαρμογή Staffbase (κινητό) ζητάμε από την εφαρμογή να ανοίξει τον σύνδεσμο
      στον browser της συσκευής (openLinkExternal).
   2) Στη Staffbase μέσω browser (desktop/web) το openLinkExternal φορτώνει τον σύνδεσμο μέσα
      στο πλαίσιο, όπου το Google τον μπλοκάρει (ERR_BLOCKED_BY_RESPONSE). Εκεί, όπως και σε
      κάθε άλλο iframe, ανοίγουμε ρητά νέα καρτέλα με window.open.
   3) Αν δεν επιτρέπεται κανένα από τα δύο, εμφανίζουμε επιλογές αντιγραφής. */
const inFrame = (()=>{ try{ return window.self !== window.top; }catch(_){ return true; } })();
const SB = window["plugins-client-sdk"] || null;
const PAGE_VERSION = "2026-11-23";
const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
let staffbaseConnected = false, staffbaseNative = false, staffbasePlatform = null;
const diagLog = [];
function diag(msg){ diagLog.push(new Date().toLocaleTimeString("el-GR",{hourCycle:"h23"})+"  "+msg); if(diagLog.length>20) diagLog.shift(); renderDiag(); }
if(inFrame && SB){
  // Η Staffbase απαντά στο HELLO του SDK με SUCCESS. Το παρακολουθούμε για να ξέρουμε ότι η σύνδεση είναι πραγματική.
  window.addEventListener("message", e=>{
    if(e.source!==window.parent || !Array.isArray(e.data) || e.data[0]!=="SUCCESS") return;
    staffbaseConnected = true;
    const payload = e.data[2];
    if(payload && typeof payload==="object" && payload.platform){
      staffbasePlatform = payload.platform;
      staffbaseNative = !!payload.platform.native;
    }
    renderDiag();
  });
  try{ SB.isNativeApp().catch(()=>{}); }catch(_){}  // ξεκινά τη σύνδεση από τη φόρτωση, όχι στο πρώτο κλικ
}
function openInNewWindow(url){
  let w = null;
  try{ w = window.open(url, "_blank"); }catch(_){}
  if(w){ try{ w.opener = null; }catch(_){} return true; }
  return false;
}
document.addEventListener("click", e=>{
  const a = e.target.closest("a.maplink");
  if(!a) return;
  if(!inFrame){ diag("Κλικ χάρτη: όχι σε iframe, κανονικός σύνδεσμος (target=_blank)"); return; }
  if(e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault(); e.stopPropagation();
  const url = a.href, addr = a.dataset.addr || "";
  // Το SDK μόνο σε native εφαρμογή ΚΑΙ σε κινητή συσκευή. Σε οτιδήποτε άλλο το openLinkExternal
  // μπορεί να φορτώσει τον σύνδεσμο μέσα στο πλαίσιο, όπου το Google τον μπλοκάρει.
  if(staffbaseConnected && staffbaseNative && isMobileDevice){
    diag("Κλικ χάρτη: Staffbase SDK openLinkExternal");
    SB.openLinkExternal(url)
      .then(ok=>{ diag("SDK απάντησε: "+ok); if(ok===false) showMapFallback(url, addr); })
      .catch(err=>{ diag("SDK σφάλμα: "+(err&&err.message||err)); if(!openInNewWindow(url)) showMapFallback(url, addr); });
    return;
  }
  const ok = openInNewWindow(url);
  diag("Κλικ χάρτη: window.open → " + (ok ? "άνοιξε νέο παράθυρο" : "μπλοκαρίστηκε, εμφάνιση παραθύρου αντιγραφής"));
  if(!ok) showMapFallback(url, addr);
}, true);
function renderDiag(){
  const el = document.getElementById("diag"); if(!el || el.hidden) return;
  const rows = [
    ["Έκδοση σελίδας", PAGE_VERSION],
    ["Σε iframe", inFrame],
    ["Staffbase SDK φορτωμένο", !!SB],
    ["Σύνδεση με Staffbase", staffbaseConnected],
    ["Staffbase platform", staffbasePlatform ? JSON.stringify(staffbasePlatform) : "—"],
    ["Κινητή συσκευή", isMobileDevice],
    ["User agent", navigator.userAgent]
  ];
  el.querySelector("dl").innerHTML = rows.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join("");
  el.querySelector("pre").textContent = diagLog.join("\n") || "Πατήστε ένα εικονίδιο χάρτη για να καταγραφεί τι συμβαίνει.";
}
function toggleDiag(){ const el=$("diag"); el.hidden=!el.hidden; renderDiag(); }
// document.querySelector("h1").addEventListener("click", e=>{ if(e.detail===3) toggleDiag(); });
if(/[?&]debug=1\b/.test(location.search)) toggleDiag();
$("diag").addEventListener("click", async e=>{
  if(e.target.closest("[data-diag-close]")) toggleDiag();
  if(e.target.closest("[data-diag-copy]")){
    const text = [...$("diag").querySelectorAll("dt")].map(dt=>dt.textContent+": "+dt.nextElementSibling.textContent).join("\n")+"\n\n"+diagLog.join("\n");
    const ok = await copyText(text);
    e.target.closest("[data-diag-copy]").textContent = ok ? "Αντιγράφηκε" : "Επιλέξτε και αντιγράψτε χειροκίνητα";
  }
});
function showMapFallback(url, addr){
  const d = $("mapdlg");
  $("mapdlg-addr").textContent = addr;
  $("mapdlg-url").value = url;
  $("mapdlg-status").textContent = "";
  d.dataset.addr = addr;
  if(typeof d.showModal === "function"){ if(!d.open) d.showModal(); } else d.setAttribute("open","");
}
async function copyText(s){
  try{ await navigator.clipboard.writeText(s); return true; }
  catch(_){
    const ta=document.createElement("textarea"); ta.value=s; ta.style.position="fixed"; ta.style.opacity="0";
    (document.querySelector("dialog[open]")||document.body).appendChild(ta); ta.select();
    let ok=false; try{ ok=document.execCommand("copy"); }catch(_){}
    ta.remove(); return ok;
  }
}
$("mapdlg").addEventListener("click", async e=>{
  const d=$("mapdlg");
  if(e.target===d || e.target.closest("[data-close]")){ d.close ? d.close() : d.removeAttribute("open"); return; }
  const c=e.target.closest("[data-copy]"); if(!c) return;
  const what = c.dataset.copy==="url" ? $("mapdlg-url").value : d.dataset.addr;
  const ok = await copyText(what);
  if(ok) $("mapdlg-status").textContent = c.dataset.copy==="url" ? "Ο σύνδεσμος αντιγράφηκε." : "Η διεύθυνση αντιγράφηκε.";
  else { $("mapdlg-url").select(); $("mapdlg-status").textContent = "Η αντιγραφή δεν επιτρέπεται εδώ. Ο σύνδεσμος είναι επιλεγμένος, πατήστε Ctrl+C."; }
});
$("mapdlg-url").addEventListener("focus", e=>e.target.select());

const timeFmt = new Intl.DateTimeFormat("el-GR",{hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
let inFlight = null;
async function loadFromApi(){
  if(inFlight) inFlight.abort();
  const ctrl = new AbortController(); inFlight = ctrl;
  const timer = setTimeout(()=>ctrl.abort("timeout"), 30000);
  const btn = $("refresh"); btn.disabled = true; btn.classList.add("spin");
  const first = !Object.keys(state.data||{}).length;
  try{
    const res = await fetch(API_URL, {cache:"no-store", credentials:"same-origin", headers:{Accept:"application/json"}, signal:ctrl.signal});
    if(!res.ok) throw new Error(`Το API απάντησε ${res.status}${res.statusText?" "+res.statusText:""}.`);
    let json;
    try{ json = await res.json(); }catch(_){ throw new Error("Η απάντηση του API δεν είναι έγκυρο JSON."); }
    if(json && json.success === false) throw new Error("Το API επέστρεψε success: false" + (json.error||json.message ? ` (${json.error||json.message})` : "") + ".");
    load(json,'', true);
    $("banner").innerHTML = "";
  }catch(err){
    if(ctrl.signal.aborted && ctrl.signal.reason !== "timeout" && inFlight !== ctrl) return; // αντικαταστάθηκε από νεότερο αίτημα
    const msg = ctrl.signal.reason === "timeout" ? "Το API δεν απάντησε μέσα σε 30 δευτερόλεπτα." :
      (err instanceof TypeError ? "Δεν υπάρχει σύνδεση με το API. Ελέγξτε ότι η σελίδα φιλοξενείται στον ίδιο server με το " + API_URL + "." : err.message);
    banner(`${first ? "Δεν φορτώθηκαν τα δεδομένα" : "Η ανανέωση απέτυχε, εμφανίζονται τα προηγούμενα δεδομένα"}. ${esc(msg)} <button class="btn link" type="button" data-retry>Δοκιμάστε ξανά</button>`, true);
    if(first){
      $("source").textContent = "Τα δεδομένα δεν είναι διαθέσιμα";
      $("tbody").innerHTML = `<tr><td class="loading">Δεν υπάρχουν δεδομένα. Δοκιμάστε ξανά ή φορτώστε ένα αρχείο JSON.</td></tr>`;
    }
  }finally{
    clearTimeout(timer);
    if(inFlight === ctrl){ inFlight = null; btn.disabled = false; btn.classList.remove("spin"); }
  }
}
$("refresh").addEventListener("click", loadFromApi);
document.addEventListener("click", e=>{ if(e.target.closest("[data-retry]")) loadFromApi(); });
loadFromApi();
})();
