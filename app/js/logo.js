/* 标题 Squiddle：Playfair Display 斜体 Black 横向压窄后栅格化的点阵（存在页面里，不加载字体），
   再画成方案二的样子：粉到淡紫渐变字面、顶边高光、深墨描边、靛蓝立体投影、黄色四芒星。1 个画布像素 = 1 格。 */
(function(){
  const cv=document.getElementById('logo');if(!cv)return;
  const W=162,H=58,N=W*H,MASK={x0:9,y0:6,w:138,h:44,b64:"AAAAAAAAAAA4AAAHAHAABwAAAAAAAAAAAPAB4B8A/uEPAAAAAAAAAAAAwAcAfwDwhz8AAIA/AgAAAACAHwD4AYAP/AAAAI8JAAAAAAB+AOADAD7wAwAAHjgAAAAAAPgBgA8A+MAPAAB8YAAAAAAA4AcAPgDwAx8AAPABAQAAAAAADwD4AMAPfAAA4AcEAAAAAAAAAPADAD/wAQCAHxAAAAAAAAAAwA8AfMAHAAB+QAAAAAAAAAAAHwDwgR8AAPgBARAACAAAAIB8AMgHPgAQ4AcA+Dn48IMPgP8B/B/4ANyBPwDw+fDDB34A7wd4fuADOAf+AMDzQx8f9AGeH/D5gA/wPPgHgM8PfHzQBzx+wOMDP+Dx4B8AHx/y+QEf+PiAjw98gMcD/wB8fOjnh3zg4wMePvABjw/8A/jxgY8P+sGHD3z8wAc8HvAf4MMHPj7gBx8+8PEDH/h4gH+Ajx/4+IAPfPzgxwd+4PMA/gM/PuDzAz748YEPH/jBxwPwD/z4wM8P+ODDBz584AOfB8B/8OEDHz/wgw8f/PCBD3wPAP7hhw98fMAPPnzw4wc++B0A+IcfP/D5AR/8+MGPD/zgHwDAH3784OcHfPDjBz8+8IMfAAB/+PGBnx/4wY8PfPjAB34AAvzhxwc+f+AHPz7w8QMf+AAI8IefH/j8hE/8/MDHD3zgB2DAH35+4PMTPvHzAx+/8IEfgAE/+PmBrw/4wM8vfH7CF34QBvzg9we/vuALv77w+QlP+CEY8AH/D/z5gi/8e8PfF/zg/5DAA/w+4OcHfuDnB35+8AP/QfwH4PmADx/wgI8P+PjAB/gDwAcA4wMIGIABGBjAwQAOgAMAAADADwAAAAAAAAAAAAAAAAAAAAA/AAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAA8AEAAAAAAAAAAAAAAAAAAADABwAAAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAAAAgP8BAAAAAAAAAAAAAAAA"};
  const L=new Uint8Array(N);{const bin=atob(MASK.b64);for(let y=0;y<MASK.h;y++)for(let x=0;x<MASK.w;x++){const k=y*MASK.w+x;if(bin.charCodeAt(k>>3)>>(k&7)&1)L[(y+MASK.y0)*W+x+MASK.x0]=1}}
  const at=(m,x,y)=>x>=0&&y>=0&&x<W&&y<H?m[y*W+x]:0;
  const dil=m=>{const o=new Uint8Array(N);for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(let j=-1;j<=1&&!v;j++)for(let i=-1;i<=1;i++)if(at(m,x+i,y+j)){v=1;break}o[y*W+x]=v}return o};
  const LO=dil(L),E=new Uint8Array(N);
  for(let k=1;k<=4;k++)for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(at(LO,x-(k>>1),y-k)&&!LO[y*W+x])E[y*W+x]=1;
  const LE=LO.map((v,i)=>v|E[i]),O=dil(LE).map((v,i)=>v&&!LE[i]?1:0);
  const g=cv.getContext('2d'),px=(i,c)=>{g.fillStyle=c;g.fillRect(i%W,(i/W)|0,1,1)};
  const y0=MASK.y0,y1=MASK.y0+MASK.h-1,x0=MASK.x0,x1=MASK.x0+MASK.w-1;
  const GR=['#ffd0e2','#ffb3cf','#ff8fb2','#f27aa8','#d980c8','#bdb6ec'];
  for(let i=0;i<N;i++){if(O[i])px(i,'#1a1230');else if(E[i])px(i,'#4a4fb0');else if(LO[i]&&!L[i])px(i,'#1a1230')}
  for(let i=0;i<N;i++){if(!L[i])continue;const x=i%W,y=(i/W)|0;
    if(!at(L,x,y-1)){px(i,'#fff3f8');continue}
    const t=(y-y0)/(y1-y0+1)*GR.length,k=Math.min(GR.length-1,t|0);px(i,((x+y)&1)&&k>0&&(t%1)<.35?GR[k-1]:GR[k])}
  function star(rows,cx,cy,outline){const h=rows.length,w=rows[0].length,ox=cx-(w>>1),oy=cy-(h>>1),on=(i,j)=>j>=0&&j<h&&i>=0&&i<w&&rows[j][i]!=='.';
    if(outline){g.fillStyle='#1a1230';for(let j=-1;j<=h;j++)for(let i=-1;i<=w;i++){if(on(i,j))continue;let n=0;for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++)if(on(i+a,j+b))n=1;if(n)g.fillRect(ox+i,oy+j,1,1)}}
    rows.forEach((r,j)=>[...r].forEach((c,i)=>{if(c==='.')return;g.fillStyle=c==='o'?'#fff1a6':'#ffd23a';g.fillRect(ox+i,oy+j,1,1)}))}
  star(["...x...","...x...","..xox..","xxoooxx","..xox..","...x...","...x..."],x1+6,y0+3,true);
  star(["..x..","..x..","xxoxx","..x..","..x.."],x0-2,y0+1,true);
  star([".x.","xox",".x."],x1+3,y1+2,false);
})();
