(() => {
  'use strict';
  // The 2026/2027 images are geo-referenced PDF reproductions, not parcel ownership records.
  // The vector layer is a separate historic CAD reference dated 2016-07-26.
  const CAD = Array.isArray(window.BELOVO_CAD) ? window.BELOVO_CAD : [];
  const sheets = [
    {id:'west', b:[248541.17,4674690.42,255435.17,4679196.42], name:'Карта 1 · запад'},
    {id:'east', b:[255141.05,4675801.06,259737.05,4678805.06], name:'Карта 2 · изток'}
  ];
  const total = [248430,4674550,259850,4679290];
  const seam = (sheets[0].b[2] + sheets[1].b[0])/2;
  const TILE_COLS=3, TILE_ROWS=2;
  for (const s of sheets){s.tiles=[];for(let r=0;r<TILE_ROWS;r++)for(let c=0;c<TILE_COLS;c++)s.tiles.push({r,c,src:`assets/tiles/${s.id}-r${r}c${c}.webp`})}
  const byId = id => document.getElementById(id);
  const canvas = byId('map-canvas'), pane = byId('map-pane'), ctx = canvas.getContext('2d', {alpha:false});
  const toggler = byId('cad-toggle'), mode = byId('sheet-select'), opacity = byId('opacity-range');
  const satelliteToggle = byId('satellite-toggle'), satellite = window.BELOVO_SATELLITE;
  const search = byId('parcel-search'), suggestions = byId('suggestions'), tooltip = byId('map-tooltip');
  const detail = byId('detail-card'), status = byId('map-status'), loading = byId('loading-overlay');
  const fmt = n => Number(n).toLocaleString('bg-BG',{maximumFractionDigits:2});
  const fullCAD = CAD.reduce((a,p) => {const b=p[2];return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])]},[Infinity,Infinity,-Infinity,-Infinity]);
  let w = 920, h = 660, dpr = 1, cx = 254150, cy = 4676900, zoom = .08;
  let selected = null, hovered = null, drag = null, wasDragged = false;
  let frame = 0, lastCadVisible = 0, ready = false, toastTimer = 0;
  let pointerX = -1000, pointerY = -1000;
  const siteLabels = CAD.map(f => String(f[0]));
  byId('count-features').textContent = fmt(CAD.length);
  const minZoom = .002, maxZoom = 45;

  function requestDraw(){ if(!frame) frame = requestAnimationFrame(() => {frame = 0; draw()}); }
  function xPix(x){return (x - cx) * zoom + w/2}
  function yPix(y){return (cy - y) * zoom + h/2}
  function xMap(x){return (x - w/2)/zoom + cx}
  function yMap(y){return cy - (y - h/2)/zoom}
  function visibleBounds(){return [xMap(0),yMap(h),xMap(w),yMap(0)]}
  function overlaps(a,b){return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3]}
  function resize(){
    const rect = pane.getBoundingClientRect();
    w = Math.max(300,rect.width); h = Math.max(250,rect.height);
    dpr = Math.min(2,window.devicePixelRatio || 1);
    canvas.width = Math.max(1,Math.round(w*dpr)); canvas.height = Math.max(1,Math.round(h*dpr));
    requestDraw();
  }
  function fit(bounds, margin = 35){
    const [a,b,c,d]=bounds;
    if(!(c > a && d > b))return;
    cx=(a+c)/2;cy=(b+d)/2;
    zoom=Math.min((w-margin*2)/(c-a),(h-margin*2)/(d-b));
    zoom=Math.min(maxZoom,Math.max(minZoom,zoom));
    requestDraw();
  }
  function focus(bounds){
    const [a,b,c,d]=bounds;
    cx=(a+c)/2; cy=(b+d)/2;
    zoom=Math.min(9,Math.max(.26,Math.min((w-155)/Math.max(30,c-a),(h-155)/Math.max(30,d-b))));
    requestDraw();
  }
  function changeZoom(factor,px=w/2,py=h/2){
    const mx=xMap(px),my=yMap(py);
    zoom=Math.min(maxZoom,Math.max(minZoom,zoom*factor));
    cx=mx-(px-w/2)/zoom;cy=my+(py-h/2)/zoom;
    requestDraw();
  }
  function drawGrid(){
    ctx.save();ctx.fillStyle='#eef3f5';ctx.fillRect(0,0,w,h);
    const step=zoom < .025? 5000 : zoom < .11? 1000 : zoom < .4? 250 : 100;
    const b=visibleBounds();
    ctx.strokeStyle='#dbe6ea';ctx.lineWidth=.75;ctx.beginPath();
    for(let x=Math.ceil(b[0]/step)*step; x<b[2]; x+=step){const px=xPix(x);ctx.moveTo(px,0);ctx.lineTo(px,h)}
    for(let y=Math.ceil(b[1]/step)*step; y<b[3]; y+=step){const py=yPix(y);ctx.moveTo(0,py);ctx.lineTo(w,py)}
    ctx.stroke();ctx.restore();
  }
  function drawSheet(s,minX,maxX){
    const b=s.b, vis=visibleBounds();
    if(!overlaps(b,vis))return;
    ctx.save();ctx.beginPath();
    ctx.rect(xPix(minX),yPix(b[3]),(maxX-minX)*zoom,(b[3]-b[1])*zoom);
    ctx.clip();ctx.globalAlpha=Number(opacity.value)/100;
    for(const t of s.tiles){
      if(!t.img?.naturalWidth)continue;
      const x0=b[0]+t.c/TILE_COLS*(b[2]-b[0]);
      const x1=b[0]+(t.c+1)/TILE_COLS*(b[2]-b[0]);
      const yTop=b[3]-t.r/TILE_ROWS*(b[3]-b[1]);
      const yBottom=b[3]-(t.r+1)/TILE_ROWS*(b[3]-b[1]);
      // The satellite view uses a transparent, color-only mask instead of the
      // original PDF pixels. No white paper rectangle is drawn over the terrain.
      const picture = satelliteToggle.checked ? t.contours : t.img;
      if(picture)ctx.drawImage(picture,xPix(x0),yPix(yTop),(x1-x0)*zoom,(yTop-yBottom)*zoom);
    }
    ctx.restore();
  }
  function ringPath(ring){
    for(let i=0;i<ring.length;i++){
      const p=ring[i];if(i===0)ctx.moveTo(xPix(p[0]),yPix(p[1])); else ctx.lineTo(xPix(p[0]),yPix(p[1]));
    }
    ctx.closePath();
  }
  function featurePath(f){for(const ring of f[3]) if(ring.length>=3)ringPath(ring)}
  function drawCAD(){
    if(!toggler.checked){lastCadVisible=0;return}
    const vis=visibleBounds();lastCadVisible=0;
    ctx.save(); ctx.beginPath();
    for(const f of CAD){if(!overlaps(f[2],vis))continue;lastCadVisible++;featurePath(f)}
    ctx.strokeStyle=zoom < .075?'rgba(35,69,86,.42)':'rgba(27,61,75,.65)';
    ctx.lineWidth=zoom>.7?1.08:.78;ctx.stroke();
    if(zoom > .55 && lastCadVisible < 175){
      ctx.font='10px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      for(const f of CAD){if(!overlaps(f[2],vis) || f===selected)continue;
        const b=f[2],px=xPix((b[0]+b[2])/2),py=yPix((b[1]+b[3])/2);
        if(px>=0&&px<w&&py>=0&&py<h){ctx.fillStyle='rgba(250,253,253,.8)';const tw=Math.min(75,ctx.measureText(f[0]).width+9);ctx.fillRect(px-tw/2,py-7,tw,14);ctx.fillStyle='#365666';ctx.fillText(f[0],px,py,75)}
      }
    }
    ctx.restore();
  }
  function highlightFeature(f,isHover){
    if(!f)return;
    const b=f[2];if(!overlaps(b,visibleBounds()))return;
    ctx.save();ctx.beginPath();featurePath(f);
    ctx.fillStyle=isHover?'rgba(31,142,164,.16)':'rgba(242,130,52,.22)';
    ctx.strokeStyle=isHover?'#0b889b':'#e66722';
    ctx.lineWidth=isHover?2:3;ctx.fill('evenodd');ctx.stroke();ctx.restore();
  }
  function updateScale(){
    if(!ready)return;
    const target=115 / zoom;
    const p=Math.pow(10,Math.floor(Math.log10(target)));
    let val=1*p;
    for(const v of [1,2,5,10]){if(v*p>=target*.68){val=v*p;break}}
    const px=val*zoom;
    byId('scale-line').style.width=Math.round(Math.max(18,Math.min(220,px)))+'px';
    byId('scale-text').textContent=val>=1000?fmt(val/1000)+' km':fmt(val)+' m';
  }
  function draw(){
    if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    drawGrid();
    if(satelliteToggle.checked && satellite) satellite.draw(ctx,{cx,cy,zoom,w,h},requestDraw);
    if(mode.value==='both'){drawSheet(sheets[0],sheets[0].b[0],seam);drawSheet(sheets[1],seam,sheets[1].b[2]);}
    else {const sheet=sheets.find(s=>s.id===mode.value);if(sheet)drawSheet(sheet,sheet.b[0],sheet.b[2]);}
    drawCAD();
    if(window.BELOVO_LAND_USE) window.BELOVO_LAND_USE.draw(ctx,{cx,cy,zoom,w,h},requestDraw);
    if(hovered && hovered!==selected && toggler.checked)highlightFeature(hovered,true);
    if(selected && toggler.checked)highlightFeature(selected,false);
    updateScale();
    if(ready){status.textContent=toggler.checked?`${fmt(lastCadVisible)} контура в изгледа · CAD 2016`:'Работни карти 2026/2027';status.classList.add('ready')}
  }
  function insideRing(x,y,ring){
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];
      if(((a[1]>y)!==(b[1]>y)) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;
  }
  function pickMap(x,y){
    const visPoint=[x,y,x,y];let result=null;
    // Last matching smaller parcel wins over large enclosing polygons.
    for(const f of CAD){if(!overlaps(f[2],visPoint))continue;let inside=false;
      for(const ring of f[3]) if(insideRing(x,y,ring))inside=!inside;
      if(inside && (!result||f[1]<result[1]))result=f;
    }return result;
  }
  function clearTooltip(){tooltip.hidden=true;hovered=null;requestDraw()}
  function displayTooltip(f,px,py){
    if(!f){tooltip.hidden=true;return}
    tooltip.innerHTML=`<strong>CAD № ${escapeHTML(f[0])}</strong><div>Геометрична площ: ${fmt(f[1])} дка</div><small>Справочен контур · 2016 г.</small>`;
    tooltip.hidden=false;
    const tw=230,th=85;
    tooltip.style.left=(px+tw+18>w?Math.max(12,px-tw-12):px+16)+'px';
    tooltip.style.top=(py+th+12>h?Math.max(8,py-th-10):py+10)+'px';
  }
  function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function detailCard(f){
    if(!f){detail.innerHTML='<div class="detail-icon">⌖</div><div><strong>Няма избран имот</strong><p>Включете CAD слоя и изберете контур върху картата или потърсете номер.</p></div>';return}
    const b=f[2],east=(b[0]+b[2])/2,north=(b[1]+b[3])/2;
    detail.innerHTML=`<div class="detail-icon">▣</div><div class="detail-content"><strong>Стар CAD № ${escapeHTML(f[0])}</strong><p>Кадастрална основа от 26.07.2016 г.</p><dl><dt>Геометрична площ</dt><dd>${fmt(f[1])} дка</dd><dt>Център по UTM</dt><dd>${Math.round(east)} / ${Math.round(north)}</dd><dt>Координатна система</dt><dd>EPSG:32635</dd></dl><div class="detail-buttons"><button id="go-selected" type="button">Центрирай</button><button id="clear-selected" type="button">Изчисти</button></div></div>`;
    byId('go-selected').addEventListener('click',()=>focus(f[2]));
    byId('clear-selected').addEventListener('click',()=>selectFeature(null));
  }
  function selectFeature(f,doZoom=false){selected=f; detailCard(f); if(f){toggler.checked=true;search.value=f[0];if(doZoom)focus(f[2]);closeMobile();}else{search.value=''} suggestions.hidden=true;requestDraw();}
  function showToast(msg){
    const t=byId('toast');t.textContent=msg;t.classList.add('show');window.clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>t.classList.remove('show'),3400);
  }
  function findFeature(){
    const val=search.value.trim().replace(/,/g,'.');
    if(!val){showToast('Въведете CAD номер за търсене.');return}
    let f=CAD.find(o=>o[0]===val);
    if(!f)f=CAD.find(o=>o[0].toLowerCase()===val.toLowerCase());
    if(!f){showToast('Не е намерен CAD контур с номер '+val);suggestions.hidden=true;return}
    selectFeature(f,true);
  }
  function updateSuggestions(){
    const q=search.value.trim().toLowerCase().replace(/,/g,'.');
    if(q.length<1){suggestions.hidden=true;return}
    const exact=[],pref=[],rest=[];
    for(let i=0;i<siteLabels.length;i++){
      const s=siteLabels[i].toLowerCase();if(s===q)exact.push(i);else if(s.startsWith(q))pref.push(i);else if(s.includes(q))rest.push(i);
    }
    const found=exact.concat(pref,rest).slice(0,12);
    if(!found.length){suggestions.hidden=true;return}
    suggestions.innerHTML='';
    for(const i of found){const f=CAD[i],b=document.createElement('button');b.type='button';b.className='suggestion-item';b.innerHTML=`<span>CAD ${escapeHTML(f[0])}</span><span>${fmt(f[1])} дка</span>`;
      b.addEventListener('click',()=>selectFeature(f,true));suggestions.appendChild(b)}
    suggestions.hidden=false;
  }
  function serialize(){
    const p=new URLSearchParams();p.set('x',Math.round(cx));p.set('y',Math.round(cy));p.set('s',zoom.toFixed(4));
    p.set('sheet',mode.value);p.set('cad',toggler.checked?'1':'0');p.set('opacity',opacity.value);
    p.set('satellite',satelliteToggle.checked?'1':'0');
    if(selected)p.set('parcel',selected[0]);return p.toString();
  }
  function restore(){
    if(!location.hash.includes('='))return false;
    try{const p=new URLSearchParams(location.hash.slice(1));
      const x=Number(p.get('x')),y=Number(p.get('y')),z=Number(p.get('s'));
      if(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)&&z>=minZoom&&z<=maxZoom){cx=x;cy=y;zoom=z}else return false;
      const m=p.get('sheet');if(['both','west','east'].includes(m))mode.value=m;
      toggler.checked=p.get('cad')==='1';satelliteToggle.checked=p.get('satellite')==='1';const a=Number(p.get('opacity'));if(a>=15&&a<=100)opacity.value=a;

      byId('opacity-label').textContent=opacity.value+'%';
      const id=p.get('parcel');if(id){const f=CAD.find(c=>c[0]===id);if(f)selectFeature(f,false)}
      return true;
    }catch{return false}
  }
  async function shareView(){
    const url=location.href.split('#')[0]+'#'+serialize();
    try{await navigator.clipboard.writeText(url);showToast('Връзката към текущия изглед е копирана.');}
    catch{const t=document.createElement('textarea');t.value=url;document.body.appendChild(t);t.select();try{document.execCommand('copy');showToast('Връзката е копирана.')}catch{showToast('Копирайте адреса от браузъра.')}t.remove()}
    history.replaceState(null,'','#'+serialize());
  }
  function exportPNG(){
    try{const link=document.createElement('a');link.download='belovo-03592-map-2026-2027.png';link.href=canvas.toDataURL('image/png');document.body.appendChild(link);link.click();link.remove();showToast('Изображението на картата е подготвено.');}
    catch{showToast('Неуспешен експорт. Опитайте отново след зареждане.');}
  }
  function closeMobile(){byId('app-body').classList.remove('sidebar-open');byId('mobile-menu').setAttribute('aria-expanded','false')}
  function initControls(){
    byId('fit-maps').addEventListener('click',()=>fit(total));
    byId('fit-cad').addEventListener('click',()=>{toggler.checked=true;fit(fullCAD)});
    byId('zoom-in').addEventListener('click',()=>changeZoom(1.5));
    byId('zoom-out').addEventListener('click',()=>changeZoom(1/1.5));
    byId('zoom-reset').addEventListener('click',()=>fit(total));
    mode.addEventListener('change',()=>{
      if(mode.value==='west')fit(sheets[0].b);else if(mode.value==='east')fit(sheets[1].b);else fit(total);
    });
    toggler.addEventListener('change',requestDraw);
    satelliteToggle.addEventListener('change',()=>{
      // Contour pixels already contain transparency: keep full color contrast.
      // The opacity slider stays user-controlled in both modes.
      byId('map-attribution').textContent=satelliteToggle.checked?'Esri World Imagery · Esri, Vantor, Earthstar Geographics, GIS User Community · PDF контури 2026/2027 · CAD 2016':'PDF: 2026/2027 · CAD: 2016 · справочен преглед';
      requestDraw();
    });
    opacity.addEventListener('input',()=>{byId('opacity-label').textContent=opacity.value+'%';requestDraw()});
    search.addEventListener('input',updateSuggestions);
    search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findFeature()}else if(e.key==='Escape')suggestions.hidden=true});
    byId('search-button').addEventListener('click',findFeature);
    document.addEventListener('click',e=>{if(!e.target.closest('.search-row')&&!e.target.closest('#suggestions'))suggestions.hidden=true});
    byId('download-png').addEventListener('click',exportPNG);
    byId('share-view').addEventListener('click',shareView);
    byId('mobile-menu').addEventListener('click',()=>{const shell=byId('app-body');const open=shell.classList.toggle('sidebar-open');byId('mobile-menu').setAttribute('aria-expanded',String(open))});
    byId('sidebar-backdrop').addEventListener('click',closeMobile);
    const grip=byId('resize-grip');let resizing=false;
    grip.addEventListener('pointerdown',e=>{resizing=true;grip.setPointerCapture(e.pointerId);e.preventDefault()});
    grip.addEventListener('pointermove',e=>{if(!resizing)return;document.documentElement.style.setProperty('--sidebar-width',Math.min(595,Math.max(285,e.clientX))+'px');resize()});
    grip.addEventListener('pointerup',()=>{resizing=false});grip.addEventListener('pointercancel',()=>{resizing=false});
    grip.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();let val=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'),10)||356;val+=e.key==='ArrowRight'?22:-22;document.documentElement.style.setProperty('--sidebar-width',Math.min(595,Math.max(285,val))+'px');resize()});
  }
  function initPointer(){
    pane.addEventListener('pointerdown',e=>{
      if(e.target!==canvas)return;
      drag={x:e.clientX,y:e.clientY,cx,cy};wasDragged=false;canvas.setPointerCapture(e.pointerId);pane.classList.add('dragging');tooltip.hidden=true;
    });
    pane.addEventListener('pointermove',e=>{
      const rect=canvas.getBoundingClientRect(),px=e.clientX-rect.left,py=e.clientY-rect.top;
      pointerX=px;pointerY=py;
      if(px>=0&&px<w&&py>=0&&py<h)byId('map-coordinates').textContent=`UTM ${Math.round(xMap(px))} E · ${Math.round(yMap(py))} N`;
      if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)wasDragged=true;
        cx=drag.cx-dx/zoom;cy=drag.cy+dy/zoom;requestDraw();return;
      }
      if(!toggler.checked){if(hovered){hovered=null;tooltip.hidden=true;requestDraw()}return}
      const next=pickMap(xMap(px),yMap(py));if(next!==hovered){hovered=next;requestDraw()}
      // The land-use layer owns the hover popup while enabled.
      if(!byId('landuse-toggle')?.checked){if(next)displayTooltip(next,px,py);else tooltip.hidden=true;}
    });
    pane.addEventListener('pointerup',e=>{
      if(!drag)return;pane.classList.remove('dragging');
      const rect=canvas.getBoundingClientRect(),px=e.clientX-rect.left,py=e.clientY-rect.top;
      if(!wasDragged&&toggler.checked)selectFeature(pickMap(xMap(px),yMap(py)),false);
      drag=null;
    });
    pane.addEventListener('pointercancel',()=>{drag=null;pane.classList.remove('dragging')});
    pane.addEventListener('pointerleave',()=>{if(!drag){hovered=null;tooltip.hidden=true;requestDraw()}});
    pane.addEventListener('wheel',e=>{if(e.target!==canvas)return;e.preventDefault();const r=canvas.getBoundingClientRect();changeZoom(e.deltaY<0?1.18:1/1.18,e.clientX-r.left,e.clientY-r.top)},{passive:false});
    pane.addEventListener('dblclick',e=>{if(e.target!==canvas)return;e.preventDefault();const r=canvas.getBoundingClientRect();changeZoom(1.8,e.clientX-r.left,e.clientY-r.top)});
  }
  function initImages(){
    const tiles=sheets.flatMap(s=>s.tiles);
    let loaded=0,failed=0;
    for(const tile of tiles){
      const img=new Image();tile.img=img;
      const done=ok=>{
        if(ok && window.BELOVO_CONTOURS) {
          try {tile.contours = window.BELOVO_CONTOURS.create(img);}
          catch(err) {
            console.error('Unable to prepare transparent map contours:', err);
            // Avoid drawing the opaque PDF sheet on top of satellite imagery.
          }
        }
        loaded++;if(!ok)failed++;
        if(loaded===tiles.length){
          ready=true;loading.classList.add('hidden');window.setTimeout(()=>loading.hidden=true,350);
          if(failed){status.classList.add('error');showToast(`${failed} картни плочки не са заредени. Проверете мрежата и обновете.`)}
          requestDraw();
        }else requestDraw();
      };
      img.addEventListener('load',()=>done(true),{once:true});img.addEventListener('error',()=>done(false),{once:true});img.src=tile.src;
    }
  }
  // Small, read-only map hooks for the separately maintained land-use layer.
  window.BELOVO_FOCUS = focus;
  window.BELOVO_FIT = fit;
  window.BELOVO_REDRAW = requestDraw;
  initControls();initPointer();resize();if(!restore())fit(total);
  if(satelliteToggle.checked)byId('map-attribution').textContent='Esri World Imagery · Esri, Vantor, Earthstar Geographics, GIS User Community · PDF контури 2026/2027 · CAD 2016';
  initImages();
  window.addEventListener('resize',resize);if(window.ResizeObserver)new ResizeObserver(resize).observe(pane);
})();