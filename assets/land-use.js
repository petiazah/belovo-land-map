/* Масиви по чл. 37в за землището на Белово, 2026/2027.
   Ползвателят и номерът на масива идват от официалния регистър по чл. 74.
   Позицията е ОРИЕНТИРОВЪЧНА: очертаване чрез съвпадащи имоти в архивния CAD (2016).
   Това НЕ е официална цифрова граница на масивите за 2026/2027. */
(() => {
  'use strict';
  const CAD = Array.isArray(window.BELOVO_CAD) ? window.BELOVO_CAD : [];
  const cadIndex = new Map(CAD.map(f => [String(f[0]), f]));
  // Saturated, contrasting colors remain legible over variable satellite terrain.
  const colors = [
    '#008de3','#d92d9a','#f07516','#555df0','#00a875','#e74c3c','#9251df',
    '#b99706','#00a5bb','#dc3a77','#6a9912','#a342bd','#146cdb'
  ];
  const elem = id => document.getElementById(id);
  const toggle = elem('landuse-toggle');
  const ownerSelect = elem('owner-select'), massSelect = elem('mass-select');
  const status = elem('landuse-status'), detail = elem('mass-detail');
  const tooltip = elem('map-tooltip'), pane = elem('map-pane'), canvas = elem('map-canvas');
  const fmt = x => Number(x).toLocaleString('bg-BG',{maximumFractionDigits:2});
  const clean = s => String(s).replace(/"/g,'').trim();
  let owners = [], masses = [], ready = false, hovered = null, hoveredFeature = null, selected = null, selectedParcel = null, filter = -1;
  let hitGeometry = [], missing = 0, matchCount = 0;
  let lastView = null, down = null;
  const byId = new Map(), byCad = new Map();

  const intersects = (a,b) => a && a[2]>=b[0] && a[0]<=b[2] && a[3]>=b[1] && a[1]<=b[3];
  function mergeBounds(bounds,addition) {
    if (!bounds) return [...addition];
    return [Math.min(bounds[0],addition[0]),Math.min(bounds[1],addition[1]),
      Math.max(bounds[2],addition[2]),Math.max(bounds[3],addition[3])];
  }
  function featurePath(ctx,feature,view) {
    const {cx,cy,zoom,w,h} = view;
    for (const ring of feature[3]) {
      if (ring.length < 3) continue;
      for (let i=0;i<ring.length;i++) {
        const x=(ring[i][0]-cx)*zoom+w/2;
        const y=(cy-ring[i][1])*zoom+h/2;
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath();
    }
  }
  function inRing(x,y,ring) {
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];
      if(((a[1]>y)!==(b[1]>y)) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
    }
    return inside;
  }
  function pick(x,y) {
    let hit=null;
    for (const entry of hitGeometry) {
      if (filter!==-1 && entry.mass.ownerIndex!==filter) continue;
      const f=entry.feature,b=f[2];
      if (x<b[0]||x>b[2]||y<b[1]||y>b[3]) continue;
      let inside=false;
      for(const ring of f[3]) if(inRing(x,y,ring)) inside=!inside;
      if(inside && (!hit || Number(f[1]) < Number(hit.feature[1]))) hit=entry;
    }
    return hit;
  }
  function popup(entry,x,y) {
    if (!entry) return;
    const m=entry.mass, f=entry.feature;
    const name=clean(owners[m.ownerIndex]);
    tooltip.innerHTML = '<strong>Масив № '+m.id+'</strong>'+
      '<div><b>Ползвател:</b> '+escapeHTML(name)+'</div>'+
      '<div><b>Площ на масива:</b> '+fmt(m.area)+' дка</div>'+
      '<div><b>Имот по CAD 2016:</b> № '+escapeHTML(f[0])+'</div>'+
      '<div><b>Площ на имота по CAD:</b> '+fmt(f[1])+' дка</div>'+
      '<small>Ориентировъчно очертание върху кадастрална основа от 2016 г.</small>';
    tooltip.hidden=false;
    const width=270,height=155;
    tooltip.style.left=(x+width+18>pane.clientWidth?Math.max(9,x-width-13):x+17)+'px';
    tooltip.style.top=(y+height+14>pane.clientHeight?Math.max(7,y-height-12):y+12)+'px';
  }
  function escapeHTML(s) {return String(s).replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));}
  function matchesFilter(m) {return filter===-1 || filter===m.ownerIndex;}
  function choose(m,zoomTo,parcel=null) {
    selected=m; selectedParcel=parcel; hovered=null; hoveredFeature=null;
    if(m && filter!==-1 && m.ownerIndex!==filter){
      filter=m.ownerIndex;ownerSelect.value=String(filter);refreshMassOptions();
    }
    massSelect.value=m?String(m.id):'';
    if(!m) {
      detail.innerHTML='<strong>Избери масив</strong><p>Натисни върху оцветен контур или избери номер на масив.</p>';
    } else {
      const ids=m.parcelIds.length;
      detail.innerHTML='<strong>Масив № '+m.id+'</strong>'+
        '<p><b>'+escapeHTML(clean(owners[m.ownerIndex]))+'</b></p>'+
        '<dl>'+(parcel?'<dt>Избран имот (CAD 2016)</dt><dd>№ '+escapeHTML(parcel[0])+'</dd>':'')+
        '<dt>Площ по регистъра</dt><dd>'+fmt(m.area)+' дка</dd>'+
        '<dt>Имоти в регистъра</dt><dd>'+ids+'</dd>'+
        '<dt>Намерени в CAD 2016</dt><dd>'+m.features.length+' / '+ids+'</dd></dl>'+
        (m.bounds?'<p class="approx-note">Контурите са ориентировъчни, по архивна CAD основа от 2016 г.</p>':
          '<p class="approx-note">Няма съответстващ геометричен контур в наличната CAD основа.</p>');
      if(zoomTo && m.bounds && window.BELOVO_FOCUS) window.BELOVO_FOCUS(m.bounds);
    }
    window.BELOVO_REDRAW?.();
  }
  function refreshMassOptions() {
    const previous=massSelect.value;
    massSelect.textContent='';
    const def=document.createElement('option');def.value='';def.textContent='Избери масив';massSelect.appendChild(def);
    for(const m of masses) {
      if(!matchesFilter(m))continue;
      const opt=document.createElement('option');
      opt.value=String(m.id);opt.textContent='№ '+m.id+' · '+fmt(m.area)+' дка';
      massSelect.appendChild(opt);
    }
    if(masses.some(m=>String(m.id)===previous&&matchesFilter(m)))massSelect.value=previous;
  }
  function init(data) {
    owners=data.users;
    masses=data.massifs.map(row=>{
      const f=row[3].map(id=>cadIndex.get(String(id))).filter(Boolean);
      let bounds=null, sumX=0, sumY=0, sumWeight=0;
      for(const part of f){
        bounds=mergeBounds(bounds,part[2]);
        const weight=Math.max(0.1,Number(part[1])||0.1);
        sumX+=(part[2][0]+part[2][2])/2*weight;
        sumY+=(part[2][1]+part[2][3])/2*weight;sumWeight+=weight;
      }
      const point=sumWeight?[sumX/sumWeight,sumY/sumWeight]:null;
      const anchor=point&&f.reduce((best,item)=>{
        const b=item[2],dx=(b[0]+b[2])/2-point[0],dy=(b[1]+b[3])/2-point[1];
        const dist=dx*dx+dy*dy;
        return !best||dist<best.dist?{dist,feature:item}:best;
      },null)?.feature;
      const center=anchor?[(anchor[2][0]+anchor[2][2])/2,(anchor[2][1]+anchor[2][3])/2]:point;
      return {id:Number(row[0]),ownerIndex:Number(row[1]),area:Number(row[2]),
        parcelIds:row[3],features:f,bounds,center};
    });
    // If an old cadastral ID appears in more than one massif, do not guess its owner.
    for(const m of masses) for(const f of m.features) {
      const key=String(f[0]);
      if(byCad.has(key) && byCad.get(key)!==m) byCad.set(key,null);
      else if(!byCad.has(key)) byCad.set(key,m);
    }
    for(const m of masses) {
      byId.set(m.id,m);
      for(const f of m.features) if(byCad.get(String(f[0]))===m) hitGeometry.push({feature:f,mass:m});
    }
    matchCount=masses.filter(m=>m.features.length>0).length;
    missing=masses.length-matchCount;
    const countParts=data.massifs.reduce((s,r)=>s+r[3].length,0);
    status.textContent=masses.length+' масива · '+owners.length+' ползватели · '+countParts+
      ' имотни записа. Геометрия по CAD 2016: '+matchCount+' масива'+
      (missing?' ('+missing+' без съвпадение)':'')+'.';
    ownerSelect.textContent='';
    const all=document.createElement('option');
    all.value='-1'; all.textContent='Всички ползватели ('+owners.length+')';
    ownerSelect.appendChild(all);
    owners.forEach((name,i)=>{
      const opt=document.createElement('option');
      opt.value=String(i);
      opt.textContent=clean(name)+' ('+masses.filter(m=>m.ownerIndex===i).length+')';
      ownerSelect.appendChild(opt);
    });
    refreshMassOptions();
    ready=true;
    window.BELOVO_REDRAW?.();
  }
  function draw(ctx,view,redraw) {
    window.BELOVO_REDRAW=redraw;
    lastView=view;
    if(!ready||!toggle.checked)return;
    const visible=[view.cx-view.w/(view.zoom*2),view.cy-view.h/(view.zoom*2),
      view.cx+view.w/(view.zoom*2),view.cy+view.h/(view.zoom*2)];
    const visibleMasses=masses.filter(m=>m.bounds && matchesFilter(m)&&intersects(m.bounds,visible));
    // Stronger colored outlines with restrained transparent fills.
    // Geometry remains an approximate match to historic CAD parcels, not legal massif bounds.
    ctx.save();
    ctx.lineJoin='round';
    ctx.lineCap='round';
    for(const m of visibleMasses) {
      const important=m===selected||m===hovered;
      const color=colors[m.ownerIndex%colors.length];
      for(const f of m.features) {
        if(!intersects(f[2],visible)) continue;
        ctx.beginPath();featurePath(ctx,f,view);
        ctx.fillStyle=color;
        ctx.globalAlpha=important?.28:.16;
        ctx.fill('evenodd');
        ctx.globalAlpha=1;
        ctx.strokeStyle=color;
        ctx.lineWidth=important?3.2:Math.max(1.35,Math.min(2.25,1.15+view.zoom*2.3));
        ctx.stroke();
      }
    }
    ctx.restore();

  }
  function pointerCoord(event) {
    if(!lastView)return null;
    const rect=canvas.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top,v=lastView;
    if(px<0||py<0||px>v.w||py>v.h)return null;
    return {px,py,x:(px-v.w/2)/v.zoom+v.cx,y:v.cy-(py-v.h/2)/v.zoom};
  }
  pane.addEventListener('pointerdown',e=>{
    if(e.target===canvas)down={x:e.clientX,y:e.clientY};
  });
  pane.addEventListener('pointermove',e=>{
    if(!ready||!toggle.checked||e.buttons)return;
    const p=pointerCoord(e);
    const entry=p?pick(p.x,p.y):null;
    const m=entry?.mass||null, f=entry?.feature||null;
    if(hovered!==m || hoveredFeature!==f){hovered=m;hoveredFeature=f;window.BELOVO_REDRAW?.();}
    if(entry)popup(entry,p.px,p.py);
    else tooltip.hidden=true;
  });
  pane.addEventListener('pointerup',e=>{
    if(!down)return;
    const dist=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;
    if(!ready||!toggle.checked||dist>7)return;
    const p=pointerCoord(e);if(!p)return;
    const entry=pick(p.x,p.y);
    if(entry)choose(entry.mass,false,entry.feature);
  });
  pane.addEventListener('pointercancel',()=>{down=null;});
  pane.addEventListener('pointerleave',()=>{
    if(hovered||hoveredFeature){hovered=null;hoveredFeature=null;window.BELOVO_REDRAW?.();}
  });
  toggle.addEventListener('change',()=>{hovered=null;hoveredFeature=null;tooltip.hidden=true;window.BELOVO_REDRAW?.();});
  ownerSelect.addEventListener('change',()=>{
    filter=Number(ownerSelect.value);
    selected=null;refreshMassOptions();choose(null,false);
    const filtered=masses.filter(m=>matchesFilter(m)&&m.bounds);
    if(filter>=0 && filtered.length && window.BELOVO_FIT) {
      const bounds=filtered.reduce((b,m)=>mergeBounds(b,m.bounds),null);
      window.BELOVO_FIT(bounds);
    }
  });
  massSelect.addEventListener('change',()=>{
    const m=byId.get(Number(massSelect.value));
    choose(m||null,true);
  });
  window.BELOVO_LAND_USE={draw};
  async function load() {
    try{
      const response=await fetch('data/land-use-2026-2027.gz.b64');
      if(!response.ok)throw new Error('HTTP '+response.status);
      const b64=(await response.text()).trim();
      if(typeof DecompressionStream==='undefined')throw new Error('Този браузър не поддържа DecompressionStream');
      const bytes=Uint8Array.from(atob(b64),char=>char.charCodeAt(0));
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const json=await new Response(stream).text();
      const data=JSON.parse(json);
      if(!Array.isArray(data.users)||!Array.isArray(data.massifs))throw new Error('Невалиден регистър');
      init(data);
    }catch(err){
      status.textContent='Регистърът не се зареди. Обнови страницата. '+err.message;
      status.classList.add('error');
      console.error('Belovo land-use register:',err);
    }
  }
  load();
})();
