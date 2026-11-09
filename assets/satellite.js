/* Optional Esri World Imagery basemap, reprojected client-side from Web Mercator tiles to EPSG:32635.
   Sources: Esri, Vantor, Earthstar Geographics and the GIS User Community. */
(() => {
  'use strict';
  const R = 6378137, E2 = 0.00669437999014, EP2 = E2/(1-E2), K = 0.9996, DEG = Math.PI/180;
  const e1 = (1-Math.sqrt(1-E2))/(1+Math.sqrt(1-E2));
  const cache = new Map();
  let failedCount = 0;
  const limit = 220;

  function toLatLon(easting,northing) {
    const x=easting-500000, mu=northing/(K*R*(1-E2/4-3*E2*E2/64-5*E2*E2*E2/256));
    const p=mu + (3*e1/2-27*e1**3/32)*Math.sin(2*mu)
      + (21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)
      + (151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
    const s=Math.sin(p),c=Math.cos(p),t=Math.tan(p);
    const n=R/Math.sqrt(1-E2*s*s), rr=R*(1-E2)/Math.pow(1-E2*s*s,1.5);
    const T=t*t,C=EP2*c*c,D=x/(n*K);
    const lat=p-(n*t/rr)*(D*D/2-(5+3*T+10*C-4*C*C-9*EP2)*D**4/24
      +(61+90*T+298*C+45*T*T-252*EP2-3*C*C)*D**6/720);
    const lon=27*DEG+(D-(1+2*T+C)*D**3/6
      +(5-2*C+28*T-3*C*C+8*EP2+24*T*T)*D**5/120)/c;
    return [lon/DEG,lat/DEG];
  }

  function toUTM(lon,lat) {
    const p=lat*DEG, delta=(lon-27)*DEG;
    const s=Math.sin(p),c=Math.cos(p),t=Math.tan(p);
    const N=R/Math.sqrt(1-E2*s*s),T=t*t,C=EP2*c*c,A=c*delta;
    const M=R*((1-E2/4-3*E2**2/64-5*E2**3/256)*p
      -(3*E2/8+3*E2**2/32+45*E2**3/1024)*Math.sin(2*p)
      +(15*E2**2/256+45*E2**3/1024)*Math.sin(4*p)
      -(35*E2**3/3072)*Math.sin(6*p));
    return [500000+K*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*EP2)*A**5/120),
      K*(M+N*t*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*EP2)*A**6/720))];
  }

  function toTile(e,n,z) {
    const ll=toLatLon(e,n),phi=ll[1]*DEG,side=2**z;
    return [(ll[0]+180)/360*side,(1-Math.log(Math.tan(Math.PI/4+phi/2))/Math.PI)/2*side];
  }

  function corner(ix,iy,z) {
    const side=2**z,lon=ix/side*360-180;
    const lat=Math.atan(Math.sinh(Math.PI*(1-2*iy/side)))/DEG;
    return toUTM(lon,lat);
  }

  function requestTile(z,tx,ty,redraw) {
    const key=z+'/'+tx+'/'+ty;
    if(cache.has(key)) return cache.get(key);
    const img=new Image();
    const entry={img,ready:false,failed:false};
    cache.set(key,entry);
    img.crossOrigin='anonymous';
    img.onload=()=>{entry.ready=true;redraw()};
    img.onerror=()=>{entry.failed=true;failedCount++;redraw()};
    img.src='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/'+z+'/'+ty+'/'+tx;
    // Keep a limited in-memory tile cache, not an offline image archive.
    while(cache.size>limit)cache.delete(cache.keys().next().value);
    return entry;
  }

  window.BELOVO_SATELLITE = {
    draw(ctx,view,redraw) {
      const {cx,cy,zoom,w,h}=view;
      const [midLon,midLat]=toLatLon(cx,cy);
      const z=Math.max(2,Math.min(19,Math.round(Math.log2(156543.033928*Math.cos(midLat*DEG)*zoom))));
      const corners=[
        [cx-w/(2*zoom),cy-h/(2*zoom)], [cx+w/(2*zoom),cy-h/(2*zoom)],
        [cx-w/(2*zoom),cy+h/(2*zoom)], [cx+w/(2*zoom),cy+h/(2*zoom)]
      ].map(([e,n])=>toTile(e,n,z));
      const x0=Math.max(0,Math.floor(Math.min(...corners.map(v=>v[0])))-1);
      const y0=Math.max(0,Math.floor(Math.min(...corners.map(v=>v[1])))-1);
      const x1=Math.min(2**z-1,Math.ceil(Math.max(...corners.map(v=>v[0]))));
      const y1=Math.min(2**z-1,Math.ceil(Math.max(...corners.map(v=>v[1]))));
      // Guard against unbounded network requests for invalid/extreme views.
      if((x1-x0+1)*(y1-y0+1)>96)return;
      const sx=e=>(e-cx)*zoom+w/2, sy=n=>(cy-n)*zoom+h/2;
      for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){
        const tile=requestTile(z,xx,yy,redraw);
        if(!tile.ready)continue;
        const a=corner(xx,yy,z),b=corner(xx+1,yy,z),c=corner(xx,yy+1,z);
        const x=sx(a[0]),y=sy(a[1]);
        ctx.save();
        ctx.transform((sx(b[0])-x)/256,(sy(b[1])-y)/256,
          (sx(c[0])-x)/256,(sy(c[1])-y)/256,x,y);
        ctx.drawImage(tile.img,0,0,256,256);
        ctx.restore();
      }
    },
    failedCount:()=>failedCount
  };
})();
