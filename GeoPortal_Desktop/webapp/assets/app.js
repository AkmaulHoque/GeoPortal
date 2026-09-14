// OpenLayers is loaded as a browser bundle by geoportal.html.
const CLIENT_BUILD = '2026-08-24-java8compat-v6';
// This avoids the previous failure mode where one remote ES-module import
// prevented the entire application (map + buttons) from initializing.
if (!window.ol) {
  const errorBox = document.getElementById('mapInitError');
  if (errorBox) {
    errorBox.hidden = false;
    errorBox.textContent = 'Map library could not be loaded. Check internet/CDN access or your firewall, then reload the page.';
  }
  throw new Error('OpenLayers browser bundle is unavailable');
}

const Map = ol.Map;
const View = ol.View;
const TileLayer = ol.layer.Tile;
const WebGLTileLayer = ol.layer.WebGLTile;
const ImageLayer = ol.layer.Image;
const VectorLayer = ol.layer.Vector;
const OSM = ol.source.OSM;
const XYZ = ol.source.XYZ;
const Google = ol.source.Google;
const TileWMS = ol.source.TileWMS;
const GeoTIFF = ol.source.GeoTIFF;
const ImageStatic = ol.source.ImageStatic;
const VectorSource = ol.source.Vector;
const Feature = ol.Feature;
const LineString = ol.geom.LineString;
const Point = ol.geom.Point;
const Style = ol.style.Style;
const Stroke = ol.style.Stroke;
const Fill = ol.style.Fill;
const TextStyle = ol.style.Text;
const CircleStyle = ol.style.Circle;
const WMTS = ol.source.WMTS;
const optionsFromCapabilities = ol.source.WMTS.optionsFromCapabilities;
const WMTSCapabilities = ol.format.WMTSCapabilities;
const GeoJSON = ol.format.GeoJSON;
const KML = ol.format.KML;
const GPX = ol.format.GPX;
const Draw = ol.interaction.Draw;
const fromLonLat = ol.proj.fromLonLat;
const toLonLat = ol.proj.toLonLat;
const transformExtent = ol.proj.transformExtent;
const getPointResolution = ol.proj.getPointResolution;
const geodesicArea = ol.sphere.getArea;
const geodesicLength = ol.sphere.getLength;

const $ = id => document.getElementById(id);
const status = text => { $('status').textContent = text; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const val = id => $(id).value.trim();
const num = (id, fallback=0) => { const n=Number($(id).value); return Number.isFinite(n)?n:fallback; };
const fmt = (n,d=2) => Number.isFinite(n)?n.toFixed(d):'—';
const analysisHistory=[];

// API context resolution -----------------------------------------------------
// The distributed production application is geoportal.war, therefore the
// canonical Tomcat context is /geoportal/.  Never derive an API base from an
// extracted source-package name such as /GeoPortal_Source_*/src/main/webapp/.
// We only accept a candidate after its /api/health endpoint returns JSON with
// {status:"ok"}.
function normalizeBase(base) {
  let value = String(base || '/').trim();
  if (!value.startsWith('/')) value = '/' + value;
  if (!value.endsWith('/')) value += '/';
  return value.replace(/\/{2,}/g, '/');
}
function sourceLikePath(pathname = window.location.pathname || '/') {
  const p = pathname.toLowerCase();
  return p.includes('/src/main/webapp') ||
         p.includes('geoportal_source') ||
         p.includes('geoportal-source') ||
         p.includes('source_smooth') ||
         p.includes('source_gistools') ||
         p.includes('source_api');
}
function currentContextCandidate() {
  const parts = (window.location.pathname || '/').split('/').filter(Boolean);
  if (!parts.length || parts[0].includes('.')) return '/';
  return normalizeBase('/' + parts[0]);
}
function configuredApiBase() {
  const meta = document.querySelector('meta[name="geoportal-api-base"]');
  const fromMeta = meta?.getAttribute('content')?.trim();
  if (fromMeta) return normalizeBase(fromMeta);
  return '/geoportal/';
}
let APP_BASE_PATH = configuredApiBase();
function appUrl(relativePath, base=APP_BASE_PATH) {
  const clean = String(relativePath || '').replace(/^\/+/, '');
  return new URL(clean, window.location.origin + normalizeBase(base)).toString();
}
function apiUrl(path) {
  const clean = String(path || '').replace(/^\/+/, '').replace(/^api\//, '');
  return appUrl('api/' + clean);
}
function apiBaseCandidates() {
  const list=[];
  const add=b=>{b=normalizeBase(b);if(!list.includes(b))list.push(b)};
  // Always probe the actual WAR context first. This is the production path.
  add(configuredApiBase());
  add('/geoportal/');
  add('/GeoPortal/');
  // A renamed compiled WAR is supported only when the page itself is not an
  // extracted source tree. Source-package folder names are never API bases.
  if (!sourceLikePath()) add(currentContextCandidate());
  add('/');
  return list;
}
async function probeHealth(base) {
  const url=appUrl('api/health', base);
  try {
    const response=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'}});
    const contentType=(response.headers.get('content-type')||'').toLowerCase();
    const text=await response.text();
    if(!response.ok || !contentType.includes('application/json')) return {ok:false,url,status:response.status};
    let data; try { data=JSON.parse(text); } catch (_) { return {ok:false,url,status:response.status}; }
    if(data && data.status==='ok') return {ok:true,url,data};
    return {ok:false,url,status:response.status};
  } catch (_) { return {ok:false,url,status:0}; }
}
async function discoverApiBase() {
  const tried=[];
  for (const base of apiBaseCandidates()) {
    const result=await probeHealth(base);tried.push(`${result.url} [${result.status||'network'}]`);
    if(result.ok){
      APP_BASE_PATH=normalizeBase(result.data.contextPath || base);
      // If someone opened an extracted source copy while the proper WAR is
      // already deployed, move them to the canonical compiled workspace.
      if(sourceLikePath() && APP_BASE_PATH.toLowerCase()==='/geoportal/' &&
         !window.location.pathname.toLowerCase().startsWith('/geoportal/')) {
        const canonical=appUrl('geoportal.html', APP_BASE_PATH);
        window.setTimeout(()=>window.location.replace(canonical), 50);
      }
      return result.data;
    }
  }
  APP_BASE_PATH=normalizeBase(configuredApiBase());
  throw new Error('Compiled GeoPortal backend not found. Checked: '+tried.join(' | ')+'. Copy geoportal.war to Tomcat webapps as exactly geoportal.war, remove any GeoPortal_Source_* folder from webapps, restart Tomcat, then open /geoportal/geoportal.html.');
}


async function fetchJson(url, options={}, label='Server request') {
  let response;
  try { response = await fetch(url, options); }
  catch (e) { throw new Error(`${label}: network connection failed (${e.message})`); }
  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try { data = JSON.parse(text); }
    catch (_) {
      const compact = text.replace(/\s+/g,' ').trim();
      if (/^<!doctype|^<html/i.test(compact)) {
        throw new Error(`${label}: API endpoint returned HTML (HTTP ${response.status}). Requested ${response.url || url}. Resolved API base: ${APP_BASE_PATH}. Deploy the compiled geoportal.war; do not use src/main/webapp as the Tomcat application root.`);
      }
      throw new Error(`${label}: invalid server response (HTTP ${response.status}): ${compact.slice(0,180) || 'empty response'}`);
    }
  }
  if (!response.ok) {
    const message = data?.error || data?.log || `${label} failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return data || {};
}

async function responseError(response, label='Server request') {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data.error || data.log || `${label} failed with HTTP ${response.status}`;
  } catch (_) {
    const compact = text.replace(/\s+/g,' ').trim();
    if (/^<!doctype|^<html/i.test(compact)) return `${label}: server returned HTML instead of API data (HTTP ${response.status}). Redeploy the current WAR and restart Tomcat.`;
    return compact || `${label} failed with HTTP ${response.status}`;
  }
}

const UNIT_HTML={
  'mm/day':'mm day<sup>−1</sup>',
  'MJ/m2/day':'MJ m<sup>−2</sup> day<sup>−1</sup>',
  'kPa':'kPa',
  'degC-day':'°C day',
  'degC':'°C',
  'mm':'mm',
  'percent':'%',
  'm3':'m<sup>3</sup>',
  'm2':'m<sup>2</sup>',
  'ha':'ha',
  'km':'km',
  'm':'m',
  'day':'day',
  'none':'—'
};
const UNIT_TEXT={
  'mm/day':'mm day^-1',
  'MJ/m2/day':'MJ m^-2 day^-1',
  'kPa':'kPa',
  'degC-day':'deg C day',
  'degC':'deg C',
  'mm':'mm',
  'percent':'%',
  'm3':'m^3',
  'm2':'m^2',
  'ha':'ha',
  'km':'km',
  'm':'m',
  'day':'day',
  'none':'-'
};
function metric(label,value,unit='none',decimals=2){return{label:String(label),value:Number(value),unit,decimals}}
function metricValue(m){return Number.isFinite(m.value)?m.value.toFixed(Number.isInteger(m.decimals)?m.decimals:2):String(m.value??'—')}
function unitHtml(unit){return UNIT_HTML[unit]||esc(unit||'—')}
function unitText(unit){return UNIT_TEXT[unit]||String(unit||'-')}
function metricTableHtml(metrics,title=''){
  const rows=(metrics||[]).map(m=>`<tr><td>${esc(m.label)}</td><td class="num">${esc(metricValue(m))}</td><td>${unitHtml(m.unit)}</td></tr>`).join('');
  return `${title?`<div class="result-title">${title}</div>`:''}<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function showMetrics(id,metrics,title=''){ $(id).innerHTML=metricTableHtml(metrics,title); }
function record(category, operation, result, metrics=[]){
  const text=String(result);
  const duplicate=analysisHistory.findIndex(x=>x.category===category&&x.operation===operation&&x.result===text);
  if(duplicate>=0)analysisHistory.splice(duplicate,1);
  analysisHistory.unshift({time:new Date().toISOString(),category,operation,result:text,metrics:Array.isArray(metrics)?metrics:[]});
  if(analysisHistory.length>100) analysisHistory.length=100;
  renderHistory();
}
function renderHistory(){
  const root=$('historySummary');
  if(!analysisHistory.length){root.textContent='No analysis results recorded yet.';return;}
  const rows=[];
  analysisHistory.slice(0,12).forEach(item=>{
    if(item.metrics&&item.metrics.length){
      item.metrics.forEach((m,i)=>rows.push(`<tr><td>${i===0?esc(item.category):''}</td><td>${i===0?esc(item.operation):''}</td><td>${esc(m.label)}</td><td class="num">${esc(metricValue(m))}</td><td>${unitHtml(m.unit)}</td><td>${i===0?esc(new Date(item.time).toLocaleString()):''}</td></tr>`));
    }else{
      rows.push(`<tr><td>${esc(item.category)}</td><td>${esc(item.operation)}</td><td>Result</td><td colspan="2">${esc(item.result)}</td><td>${esc(new Date(item.time).toLocaleString())}</td></tr>`);
    }
  });
  root.innerHTML=`<div class="analysis-table-wrap history-table"><table class="analysis-table"><thead><tr><th>Module</th><th>Analysis</th><th>Parameter</th><th>Value</th><th>Unit</th><th>Time</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}

const osmLayer = new TileLayer({source:new OSM({crossOrigin:'anonymous'}),properties:{title:'OpenStreetMap',kind:'base',baseId:'osm'}});
const satelliteLayer = new TileLayer({visible:false,source:new XYZ({url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',crossOrigin:'anonymous',maxZoom:23,attributions:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'}),properties:{title:'Satellite (Esri World Imagery)',kind:'base',baseId:'satellite'}});
let baseTileErrors=0;
function watchBaseSource(source,label){
  if(!source||!source.on)return;
  source.on('tileloaderror',()=>{baseTileErrors++;if(baseTileErrors<=3)status(label+' tiles could not be reached. Check internet/proxy/firewall access.');});
  source.on('tileloadend',()=>{if(baseTileErrors){baseTileErrors=0;status(label+' basemap connected.');}});
}
watchBaseSource(osmLayer.getSource(),'OpenStreetMap');
watchBaseSource(satelliteLayer.getSource(),'Satellite');
const gridSource=new VectorSource();
const gridLayer=new VectorLayer({
  source:gridSource,
  declutter:false,
  style:feature=>{
    if(feature.get('gridLabel')){
      return new Style({text:new TextStyle({
        text:feature.get('gridLabel'),
        font:'12px Times New Roman, Times, serif',
        fill:new Fill({color:'#17382c'}),
        stroke:new Stroke({color:'rgba(255,255,255,.96)',width:3}),
        offsetX:feature.get('axis')==='lat'?24:0,
        offsetY:feature.get('axis')==='lon'?-9:0
      })});
    }
    return new Style({stroke:new Stroke({color:'rgba(35,87,67,.48)',width:1,lineDash:[5,4]})});
  },
  properties:{title:'Latitude / longitude grid',kind:'grid'}
});
const drawings=new VectorSource();
const drawLayer=new VectorLayer({
  source:drawings,
  style:new Style({stroke:new Stroke({color:'#16714c',width:3}),fill:new Fill({color:'rgba(32,137,92,.16)'}),image:new CircleStyle({radius:6,fill:new Fill({color:'#1d8b5d'}),stroke:new Stroke({color:'#ffffff',width:2})})}),
  properties:{title:'Drawing layer',kind:'draw'}
});
const measurements=new VectorSource();
const measureLayer=new VectorLayer({
  source:measurements,
  style:new Style({stroke:new Stroke({color:'#176fa5',width:3,lineDash:[8,5]}),fill:new Fill({color:'rgba(32,128,184,.10)'})}),
  properties:{title:'Measurement layer',kind:'measure'}
});
const initialCenter = fromLonLat([80.5,22.5]);
let map;
try {
  // Preferred path: one OpenLayers browser bundle provides both Map and View.
  // Keeping both classes from the same global bundle avoids the duplicate-class
  // problem caused by importing Map.js/+esm and View.js/+esm independently.
  map = new Map({
    target:'map',
    layers:[osmLayer,satelliteLayer,gridLayer,drawLayer,measureLayer],
    view:new View({center:initialCenter,zoom:4.5})
  });
} catch (mapError) {
  // Defensive compatibility path. OpenLayers accepts Promise<ViewOptions>; this
  // also survives a stale/cross-bundle View instance that Map does not recognize.
  const msg=String(mapError && (mapError.stack || mapError.message || mapError));
  if (/view\.then|then is not a function/i.test(msg)) {
    console.warn('GeoPortal recovered from an OpenLayers View bundle mismatch.', mapError);
    map = new Map({
      target:'map',
      layers:[osmLayer,satelliteLayer,gridLayer,drawLayer,measureLayer],
      view:Promise.resolve({center:initialCenter,zoom:4.5})
    });
  } else {
    const errorBox=$('mapInitError');
    if(errorBox){errorBox.hidden=false;errorBox.textContent='Map initialization failed: '+(mapError.message||mapError);}
    throw mapError;
  }
}
console.info('AgriGeo client build', CLIENT_BUILD);
let draw=null, measureDraw=null, serverFiles=[], googleApiKey='', activeBasemap='osm', googleRoadLayer=null, googleSatelliteLayer=null;
let capabilities={gdal:false,ogr:false,pdal:false,gdalCalc:false};
let gridMode='auto', currentGridInterval=1;

function gridInterval(){
  if(gridMode!=='auto'&&gridMode!=='off')return Number(gridMode);
  const z=map.getView().getZoom()||4;
  if(z<4)return 10;
  if(z<5.5)return 5;
  if(z<7)return 2;
  if(z<9)return 1;
  if(z<11)return 0.5;
  if(z<13)return 0.25;
  return 0.1;
}
function gridLabel(value,axis){
  const a=Math.abs(value);
  const suffix=axis==='lon'?(value<0?'W':'E'):(value<0?'S':'N');
  const decimals=currentGridInterval<1?2:currentGridInterval<2?1:0;
  return `${a.toFixed(decimals)}° ${suffix}`;
}
function updateCoordinateGrid(){
  gridSource.clear();
  if(gridMode==='off'){gridLayer.setVisible(false);return;}
  gridLayer.setVisible(true);
  const size=map.getSize();
  if(!size)return;
  let ext;
  try{ext=transformExtent(map.getView().calculateExtent(size),map.getView().getProjection(),'EPSG:4326');}catch(_){return;}
  let [minLon,minLat,maxLon,maxLat]=ext;
  minLon=Math.max(-180,minLon);maxLon=Math.min(180,maxLon);minLat=Math.max(-85,minLat);maxLat=Math.min(85,maxLat);
  if(!(maxLon>minLon&&maxLat>minLat))return;
  const step=gridInterval();currentGridInterval=step;
  const startLon=Math.ceil(minLon/step)*step,startLat=Math.ceil(minLat/step)*step;
  const features=[];
  let count=0;
  for(let lon=startLon;lon<=maxLon+step*1e-6&&count<160;lon+=step,count++){
    const x=Math.round(lon*1e8)/1e8;
    features.push(new Feature({geometry:new LineString([fromLonLat([x,minLat]),fromLonLat([x,maxLat])])}));
    features.push(new Feature({geometry:new Point(fromLonLat([x,minLat+(maxLat-minLat)*0.035])),gridLabel:gridLabel(x,'lon'),axis:'lon'}));
  }
  count=0;
  for(let lat=startLat;lat<=maxLat+step*1e-6&&count<160;lat+=step,count++){
    const y=Math.round(lat*1e8)/1e8;
    features.push(new Feature({geometry:new LineString([fromLonLat([minLon,y]),fromLonLat([maxLon,y])])}));
    features.push(new Feature({geometry:new Point(fromLonLat([minLon+(maxLon-minLon)*0.028,y])),gridLabel:gridLabel(y,'lat'),axis:'lat'}));
  }
  gridSource.addFeatures(features);
}
map.on('moveend',updateCoordinateGrid);

function layerTitle(layer){return layer.get('title')||'Untitled layer'}
function isGoogleBase(id){return id==='google-road'||id==='google-satellite'}
function googleLogoVisible(show){$('googleLogo').hidden=!show}
function baseLayers(){return [osmLayer,satelliteLayer,googleRoadLayer,googleSatelliteLayer].filter(Boolean)}
function googleErrorHint(message){
  const m=String(message||'Google Map Tiles API error').replace(/\s+/g,' ').trim();
  if(/403|permission|forbidden|denied|billing/i.test(m))return 'Google basemap denied access. Enable Map Tiles API and billing, and check HTTP-referrer/API restrictions for this key. '+m;
  if(/429|quota/i.test(m))return 'Google Map Tiles API quota is exhausted. '+m;
  if(/400|invalid|key/i.test(m))return 'Google basemap configuration was rejected. Verify the Map Tiles API key. '+m;
  return 'Google basemap could not start. '+m;
}
function waitForGoogleSource(source,title){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(ok,msg)=>{if(settled)return;settled=true;clearTimeout(timer);ok?resolve():reject(new Error(msg))};
    const inspect=()=>{
      const state=source.getState?.();
      if(state==='ready')finish(true);
      else if(state==='error')finish(false,googleErrorHint(source.getError?.()||title+' source entered error state'));
    };
    source.on('change',inspect);
    source.on('error',()=>finish(false,googleErrorHint(source.getError?.()||title+' source error')));
    const timer=setTimeout(()=>{const state=source.getState?.();if(state==='ready')finish(true);else finish(false,googleErrorHint(source.getError?.()||title+' did not become ready within 12 seconds'))},12000);
    inspect();
  });
}
async function makeGoogleLayer(mapType,id,title){
  if(!googleApiKey)throw new Error('Google basemap requires a Google Map Tiles API key. Add it under OGC → Basemap configuration first.');
  if(typeof Google!=='function')throw new Error('This OpenLayers build does not provide ol.source.Google. Reload the current GeoPortal build.');
  status('Connecting to '+title+'…');
  const source=new Google({key:googleApiKey,mapType,language:'en-US',region:'IN',scale:'scaleFactor2x',highDpi:true});
  let tileErrors=0;
  source.on('tileloaderror',()=>{tileErrors++;if(tileErrors<=2)status(title+' tile load failed. Check API-key restrictions, quota, billing, proxy/firewall and browser console.');});
  source.on('tileloadend',()=>{if(tileErrors){tileErrors=0;status(title+' basemap connected.')}});
  await waitForGoogleSource(source,title);
  return new TileLayer({source,visible:false,properties:{title,kind:'base',baseId:id}});
}
async function ensureGoogleLayer(id){
  if(id==='google-road'){if(!googleRoadLayer){googleRoadLayer=await makeGoogleLayer('roadmap','google-road','Google Map');map.getLayers().insertAt(2,googleRoadLayer)}return googleRoadLayer}
  if(id==='google-satellite'){if(!googleSatelliteLayer){googleSatelliteLayer=await makeGoogleLayer('satellite','google-satellite','Google Satellite');map.getLayers().insertAt(3,googleSatelliteLayer)}return googleSatelliteLayer}
  return null;
}
function resetGoogleLayers(){[googleRoadLayer,googleSatelliteLayer].filter(Boolean).forEach(l=>map.removeLayer(l));googleRoadLayer=null;googleSatelliteLayer=null}
async function switchBasemap(id,quiet=false){
  const previous=activeBasemap;let target=null;
  try{
    if(isGoogleBase(id))target=await ensureGoogleLayer(id);
    else target=id==='satellite'?satelliteLayer:osmLayer;
  }catch(e){$('basemapSelect').value=previous;googleLogoVisible(isGoogleBase(previous));status(e.message);return false}
  baseLayers().forEach(l=>l.setVisible(l===target));activeBasemap=id;$('basemapSelect').value=id;googleLogoVisible(isGoogleBase(id));refreshLayers();if(!quiet)status('Basemap: '+layerTitle(target));return true;
}
$('basemapSelect').addEventListener('change',e=>switchBasemap(e.target.value));
$('gridModeSelect').addEventListener('change',e=>{gridMode=e.target.value;updateCoordinateGrid();refreshLayers();status(gridMode==='off'?'Coordinate grid hidden.':`Coordinate grid: ${gridMode==='auto'?'automatic':gridMode+'°'} interval.`)});

function renderLayerList(root){root.innerHTML='';map.getLayers().getArray().forEach(layer=>{const d=document.createElement('div');d.className='layeritem';const left=document.createElement('div');left.innerHTML=`<b>${esc(layerTitle(layer))}</b><div class="small">${esc(layer.get('kind')||'layer')}</div>`;const actions=document.createElement('div');actions.className='fileactions';const b=document.createElement('button');b.className='toolbtn';b.textContent=layer.getVisible()?'Hide':'Show';b.addEventListener('click',()=>{layer.setVisible(!layer.getVisible());renderAllLayerLists()});actions.appendChild(b);if(!['base','draw','measure','grid'].includes(layer.get('kind'))){const rm=document.createElement('button');rm.className='toolbtn';rm.textContent='Remove';rm.addEventListener('click',()=>{map.removeLayer(layer);renderAllLayerLists()});actions.appendChild(rm)}d.append(left,actions);root.appendChild(d)})}
function renderAllLayerLists(){renderLayerList($('layerList'));if($('drawer').classList.contains('open')&&$('drawer').dataset.mode==='layers')renderDrawerLayers()}
function refreshLayers(){renderAllLayerLists()}
function fitSource(src){const e=src.getExtent();if(e.every(Number.isFinite))map.getView().fit(e,{padding:[50,50,50,50],maxZoom:17,duration:400})}
const dataVectorStyle=new Style({stroke:new Stroke({color:'#0b6847',width:2.5}),fill:new Fill({color:'rgba(24,128,87,.18)'}),image:new CircleStyle({radius:6,fill:new Fill({color:'#0b6847'}),stroke:new Stroke({color:'#ffffff',width:2})})});
function addVectorFeatures(features,title){if(!features||!features.length)throw new Error('Dataset contains no map features.');const src=new VectorSource({features});const layer=new VectorLayer({source:src,style:dataVectorStyle,properties:{title,kind:'vector'}});map.getLayers().push(layer);fitSource(src);refreshLayers();status(`Loaded ${features.length} feature(s): ${title}`)}
function shpParser(){return globalThis.shp||window.shp||null}
function geojsonObjects(parsed){return Array.isArray(parsed)?parsed:[parsed]}
function addGeojsonObject(parsed,title){
  let total=0;
  for(const obj of geojsonObjects(parsed)){
    if(!obj)continue;
    const label=obj.fileName?`${title} — ${obj.fileName}`:title;
    const features=new GeoJSON().readFeatures(obj,{dataProjection:'EPSG:4326',featureProjection:map.getView().getProjection()});
    if(features.length){addVectorFeatures(features,label);total+=features.length}
  }
  if(!total)throw new Error('No features could be read from this dataset.');
  return total;
}
async function parseShapefileZip(buffer,title){
  const parser=shpParser();
  if(typeof parser!=='function')throw new Error('Browser Shapefile reader could not be loaded. Check CDN/internet access or use server OGR preview.');
  const parsed=await parser(buffer);
  return addGeojsonObject(parsed,title);
}
async function loadLocal(file){
  if(/\.zip$/i.test(file.name)){
    status('Reading zipped Shapefile in the browser…');
    await parseShapefileZip(await file.arrayBuffer(),file.name);
    return;
  }
  const text=await file.text();let fmt;
  if(/\.kml$/i.test(file.name))fmt=new KML({extractStyles:true});
  else if(/\.gpx$/i.test(file.name))fmt=new GPX();
  else fmt=new GeoJSON();
  const features=fmt.readFeatures(text,{featureProjection:map.getView().getProjection()});
  addVectorFeatures(features,file.name);
}
$('localFile').addEventListener('change',e=>e.target.files[0]&&loadLocal(e.target.files[0]).catch(x=>status('Load failed: '+x.message)));
const drop=$('drop');['dragenter','dragover'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>e.dataTransfer.files[0]&&loadLocal(e.dataTransfer.files[0]).catch(x=>status('Load failed: '+x.message)));

function isMappableVector(name){return /\.(shp|zip|geojson|json|kml|gpx|gpkg|gml|sqlite)$/i.test(name)}
function isBrowserVector(name){return /\.(shp|zip|geojson|json|kml|gpx)$/i.test(name)}
function isMappableRaster(name){return /\.(tif|tiff|img|vrt|nc|hdf|h5|asc|grd|jp2|bil|dem)$/i.test(name)}
function serverFileUrl(name,bucket,inline=true){return apiUrl(`files?bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(name)}${inline?'&inline=1':''}`)}
async function fetchServerFile(name,bucket,kind='arrayBuffer'){
  const r=await fetch(serverFileUrl(name,bucket,true),{cache:'no-store'});
  if(!r.ok)throw new Error(await responseError(r,'Dataset download'));
  return kind==='text'?r.text():r.arrayBuffer();
}
async function mapServerVectorBrowser(name,bucket){
  const lower=name.toLowerCase();
  if(lower.endsWith('.zip')){
    status('OGR unavailable/failed; reading zipped Shapefile directly in the browser…');
    return parseShapefileZip(await fetchServerFile(name,bucket,'arrayBuffer'),name.replace(/^\d+_/,''));
  }
  if(/\.(geojson|json)$/i.test(lower)){
    const text=await fetchServerFile(name,bucket,'text');
    const features=new GeoJSON().readFeatures(text,{dataProjection:'EPSG:4326',featureProjection:map.getView().getProjection()});
    return addVectorFeatures(features,name.replace(/^\d+_/,''));
  }
  if(/\.kml$/i.test(lower)){
    const text=await fetchServerFile(name,bucket,'text');
    return addVectorFeatures(new KML({extractStyles:true}).readFeatures(text,{featureProjection:map.getView().getProjection()}),name.replace(/^\d+_/,''));
  }
  if(/\.gpx$/i.test(lower)){
    const text=await fetchServerFile(name,bucket,'text');
    return addVectorFeatures(new GPX().readFeatures(text,{featureProjection:map.getView().getProjection()}),name.replace(/^\d+_/,''));
  }
  if(/\.shp$/i.test(lower)){
    const parser=shpParser();
    if(typeof parser!=='function')throw new Error('Browser Shapefile reader is unavailable.');
    const stem=name.replace(/\.shp$/i,'');
    const matching=ext=>serverFiles.find(f=>f.bucket===bucket&&f.name.toLowerCase()===(stem+ext).toLowerCase());
    const shpBuf=await fetchServerFile(name,bucket,'arrayBuffer');
    const obj={shp:shpBuf};
    const dbf=matching('.dbf'),prj=matching('.prj'),cpg=matching('.cpg');
    if(dbf)obj.dbf=await fetchServerFile(dbf.name,bucket,'arrayBuffer');
    if(prj)obj.prj=await fetchServerFile(prj.name,bucket,'text');
    if(cpg)obj.cpg=await fetchServerFile(cpg.name,bucket,'text');
    const parsed=await parser(obj);
    return addGeojsonObject(parsed,name.replace(/^\d+_/,''));
  }
  throw new Error('This vector format needs OGR for visualization. Install/configure OGR or convert it to GeoJSON/zipped Shapefile.');
}
async function mapServerVector(name,bucket){
  status('Preparing vector preview for '+name+'…');
  if(!capabilities.ogr && isBrowserVector(name))return mapServerVectorBrowser(name,bucket);
  try{
    const r=await fetch(apiUrl(`preview?bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(name)}`));
    const text=await r.text();
    if(!r.ok){let msg=text;try{msg=JSON.parse(text).error||text}catch{}throw new Error(msg)}
    let features;try{features=new GeoJSON().readFeatures(text,{dataProjection:'EPSG:4326',featureProjection:map.getView().getProjection()})}catch(e){throw new Error('Vector preview is not valid GeoJSON: '+e.message)}
    addVectorFeatures(features,name.replace(/^\d+_/,''));
  }catch(serverError){
    if(isBrowserVector(name)){
      status('Server OGR preview unavailable; using browser visualization…');
      try{return await mapServerVectorBrowser(name,bucket)}catch(browserError){throw new Error(`Vector visualization failed. Server: ${serverError.message}; browser: ${browserError.message}`)}
    }
    throw serverError;
  }
}
async function mapRasterWithServerPreview(name,bucket){
  const meta=await fetchJson(apiUrl(`raster-preview?mode=meta&bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(name)}`),{cache:'no-store'},'Raster preview');
  if(!Array.isArray(meta.extent)||meta.extent.length!==4)throw new Error('Raster preview did not return a geographic extent.');
  const extent4326=meta.extent.map(Number);if(!extent4326.every(Number.isFinite))throw new Error('Raster preview extent is invalid.');
  const source=new ImageStatic({url:apiUrl(`raster-preview?mode=image&bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(name)}`),imageExtent:extent4326,projection:'EPSG:4326',crossOrigin:'anonymous'});
  source.on('imageloaderror',()=>status('Raster preview image failed to load: '+name));
  const layer=new ImageLayer({source,opacity:0.92,properties:{title:name.replace(/^\d+_/,''),kind:'raster-preview',sourceFile:{name,bucket}}});
  map.getLayers().push(layer);refreshLayers();
  const mapExtent=transformExtent(extent4326,'EPSG:4326',map.getView().getProjection());
  map.getView().fit(mapExtent,{padding:[55,55,55,55],duration:500,maxZoom:16});
  status(`Raster visualized: ${name} · ${meta.bands||1} band(s)`);return layer;
}
async function mapRasterDirectGeoTiff(name,bucket){
  const url=apiUrl(`files?bucket=${encodeURIComponent(bucket)}&name=${encodeURIComponent(name)}&inline=1`);
  const source=new GeoTIFF({sources:[{url}],normalize:true,convertToRGB:'auto'});
  const layer=new WebGLTileLayer({source,opacity:0.9,properties:{title:name.replace(/^\d+_/,''),kind:'raster',sourceFile:{name,bucket}}});
  map.getLayers().push(layer);refreshLayers();
  const v=await Promise.race([source.getView(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('GeoTIFF view timed out')),12000))]);
  if(v?.extent&&v?.projection){const from=typeof v.projection==='string'?v.projection:v.projection.getCode();const extent=transformExtent(v.extent,from,map.getView().getProjection());map.getView().fit(extent,{padding:[55,55,55,55],duration:500,maxZoom:16});}
  status('Raster added to map: '+name);return layer;
}
async function mapServerRaster(name,bucket){status('Preparing raster visualization for '+name+'…');if(!capabilities.gdal&&/\.(tif|tiff)$/i.test(name)){status('GDAL is unavailable; rendering GeoTIFF directly in the browser…');return mapRasterDirectGeoTiff(name,bucket)}try{return await mapRasterWithServerPreview(name,bucket)}catch(serverError){if(!/\.(tif|tiff)$/i.test(name))throw serverError;status('Server preview unavailable; trying direct GeoTIFF rendering…');try{return await mapRasterDirectGeoTiff(name,bucket)}catch(clientError){throw new Error(`Raster visualization failed. Server preview: ${serverError.message}; direct GeoTIFF: ${clientError.message}`)}}}
async function mapServerFile(name,bucket){if(isMappableRaster(name))return mapServerRaster(name,bucket);return mapServerVector(name,bucket)}
function exportDatasetLink(f,format,label){const a=document.createElement('a');a.className='filelink export-format';a.href=apiUrl(`export/dataset?format=${encodeURIComponent(format)}&bucket=${encodeURIComponent(f.bucket)}&name=${encodeURIComponent(f.name)}`);a.textContent=label;a.title=format==='shp'?'Download as ESRI Shapefile ZIP':'Download as GeoTIFF';return a}
function fileActions(f){
  const wrap=document.createElement('div');wrap.className='fileactions';
  if(isMappableVector(f.name)||isMappableRaster(f.name)){
    const b=document.createElement('button');b.className='toolbtn';b.textContent='Map';b.addEventListener('click',async()=>{b.disabled=true;const old=b.textContent;b.textContent='Loading…';try{await mapServerFile(f.name,f.bucket)}catch(e){status('Map preview failed: '+e.message)}finally{b.disabled=false;b.textContent=old}});wrap.appendChild(b)
  }
  if(isMappableVector(f.name)){
    if(capabilities.ogr)wrap.appendChild(exportDatasetLink(f,'shp','SHP'));
    else{const x=document.createElement('span');x.className='filelink disabled-link';x.textContent='SHP';x.title=capabilityMessage('ogr');wrap.appendChild(x)}
  }
  if(isMappableRaster(f.name)){
    if(capabilities.gdal)wrap.appendChild(exportDatasetLink(f,'tiff','GeoTIFF'));
    else if(/\.(tif|tiff)$/i.test(f.name)){const a=document.createElement('a');a.className='filelink';a.href=serverFileUrl(f.name,f.bucket,false);a.textContent='GeoTIFF';a.title='Original uploaded GeoTIFF';wrap.appendChild(a)}
    else{const x=document.createElement('span');x.className='filelink disabled-link';x.textContent='GeoTIFF';x.title=capabilityMessage('gdal');wrap.appendChild(x)}
  }
  const a=document.createElement('a');a.className='filelink';a.href=serverFileUrl(f.name,f.bucket,false);a.textContent='Original';wrap.appendChild(a);return wrap
}
function renderFileList(root,files=serverFiles){root.innerHTML='';if(!files.length){root.innerHTML='<div class="help">No server datasets yet.</div>';return}files.forEach(f=>{const d=document.createElement('div');d.className='fileitem';const left=document.createElement('div');left.innerHTML=`<b>${esc(f.name)}</b><div class="small">${esc(f.bucket)} · ${(f.size/1048576).toFixed(2)} MB</div>`;d.append(left,fileActions(f));root.appendChild(d)})}
function populateDatasetSelects(){document.querySelectorAll('.dataset-select').forEach(sel=>{const previous=sel.value;sel.innerHTML='<option value="">Select uploaded dataset…</option>';serverFiles.filter(f=>f.bucket==='uploads').forEach(f=>{const o=document.createElement('option');o.value=f.name;o.textContent=f.name;sel.appendChild(o)});if([...sel.options].some(o=>o.value===previous))sel.value=previous})}
async function refreshFiles(){try{const j=await fetchJson(apiUrl('files'),{cache:'no-store'},'Dataset list');serverFiles=j.files||[];renderFileList($('fileList'));populateDatasetSelects();refreshDrawer()}catch(e){status('File list failed: '+e.message)}}
$('refreshFiles').addEventListener('click',refreshFiles);$('filesBtn').addEventListener('click',()=>openDrawer('files'));$('layersBtn').addEventListener('click',()=>openDrawer('layers'));
function refreshDrawer(){if(!$('drawer').classList.contains('open'))return;openDrawer($('drawer').dataset.mode,true)}
function renderDrawerLayers(){const c=$('drawerContent');c.innerHTML='<h3 style="margin:2px 0 8px">Map layers</h3>';const list=document.createElement('div');c.appendChild(list);renderLayerList(list)}
function openDrawer(mode,force=false){const d=$('drawer');if(!force&&d.classList.contains('open')&&d.dataset.mode===mode){d.classList.remove('open');return}d.classList.add('open');d.dataset.mode=mode;if(mode==='layers')renderDrawerLayers();else{const c=$('drawerContent');c.innerHTML='<h3 style="margin:2px 0 8px">Server datasets</h3>';const list=document.createElement('div');c.appendChild(list);renderFileList(list)}}

$('serverFile').addEventListener('change',e=>{const n=e.target.files.length;status(n?`${n} GIS / RS file(s) selected. Click Upload dataset to send them to the processing server.`:'No GIS / RS files selected.');});
$('uploadBtn').addEventListener('click',async()=>{const files=[...$('serverFile').files];if(!files.length){status('Choose one or more files first');return}const shpFiles=files.filter(f=>/\.shp$/i.test(f.name));if(shpFiles.length){const names=new Set(files.map(f=>f.name.toLowerCase()));const missing=[];shpFiles.forEach(f=>{const stem=f.name.replace(/\.shp$/i,'').toLowerCase();['.shx','.dbf'].forEach(ext=>{if(!names.has(stem+ext))missing.push(stem+ext)})});if(missing.length)status('Shapefile warning: also select '+[...new Set(missing)].join(', ')+'. Uploading selected files…')}const fd=new FormData();files.forEach(file=>fd.append('file',file));$('uploadBtn').disabled=true;try{const j=await fetchJson(apiUrl('upload'),{method:'POST',body:fd},'GIS / RS upload');$('serverFile').value='';await refreshFiles();const candidates=(j.files||[]).map(x=>({name:x.name,bucket:'uploads'})).filter(x=>isMappableVector(x.name)||isMappableRaster(x.name)).slice(0,5);let mapped=0;for(const item of candidates){try{await mapServerFile(item.name,item.bucket);mapped++}catch(e){status('Uploaded, but preview failed for '+item.name+': '+e.message)}}status(`Uploaded ${(j.files||[]).length} file(s)${mapped?` · visualized ${mapped} dataset(s)`:''}.`)}catch(e){status(e.message)}finally{$('uploadBtn').disabled=false}});

$('addOgc').addEventListener('click',async()=>{const type=val('ogcType'),url=val('ogcUrl'),layerName=val('ogcLayer'),title=val('ogcTitle')||`${type}: ${layerName}`;if(!url||!layerName){status('Enter service URL and layer name');return}try{if(type==='WMS'){map.getLayers().push(new TileLayer({source:new TileWMS({url,params:{LAYERS:layerName,TILED:true},crossOrigin:'anonymous'}),properties:{title,kind:'WMS',service:{type,url,layerName,title}}}))}else if(type==='WFS'){const sep=url.includes('?')?'&':'?';const u=url+sep+'service=WFS&version=2.0.0&request=GetFeature&typeNames='+encodeURIComponent(layerName)+'&outputFormat=application/json&srsName=EPSG:3857';const r=await fetch(u);if(!r.ok)throw new Error('WFS HTTP '+r.status);const features=new GeoJSON().readFeatures(await r.text(),{featureProjection:map.getView().getProjection()});const src=new VectorSource({features});map.getLayers().push(new VectorLayer({source:src,properties:{title,kind:'WFS',service:{type,url,layerName,title}}}));fitSource(src)}else{const sep=url.includes('?')?'&':'?';const r=await fetch(url+sep+'SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0');if(!r.ok)throw new Error('WMTS HTTP '+r.status);const caps=new WMTSCapabilities().read(await r.text());const opts=optionsFromCapabilities(caps,{layer:layerName});if(!opts)throw new Error('Layer not found in WMTS capabilities');map.getLayers().push(new TileLayer({source:new WMTS(opts),properties:{title,kind:'WMTS',service:{type,url,layerName,title}}}))}refreshLayers();status(`Added ${title}`)}catch(e){status(type+' failed: '+e.message)}});

async function runProcess(buttonId,logId,params,category,label){const button=$(buttonId);const log=$(logId);button.disabled=true;log.textContent='Running…';try{const fd=new URLSearchParams();Object.entries(params).forEach(([k,v])=>fd.set(k,String(v??'')));const j=await fetchJson(apiUrl('process'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:fd},label||'GIS processing');log.textContent=j.log||j.error||JSON.stringify(j,null,2);const result=j.output?`Created ${j.output}`:'Information returned';record(category,label,result);await refreshFiles();if(j.output&&(isMappableVector(j.output)||isMappableRaster(j.output))){try{await mapServerFile(j.output,'results');status(result+' · result visualized on map.')}catch(e){status(result+' · visualization failed: '+e.message)}}else status(result);return j}catch(e){status(e.message);record(category,label,'FAILED: '+e.message);throw e}finally{button.disabled=false}}
$('runPrep').addEventListener('click',()=>{const cap=requiredCapability(val('prepOperation'));if(cap&&!capabilities[cap]){status(capabilityMessage(cap));return}const input=val('prepInput');if(!input){status('Select an uploaded preprocessing input.');return}runProcess('runPrep','prepLog',{input,operation:val('prepOperation'),epsg:val('epsg'),resampling:val('resampling'),pixelSize:val('pixelSize'),interval:val('interval'),tolerance:val('tolerance'),xmin:val('xmin'),ymin:val('ymin'),xmax:val('xmax'),ymax:val('ymax'),output:val('prepOutput')},'Preprocessing',val('prepOperation')).catch(()=>{})});
$('runAgri').addEventListener('click',()=>{if(!capabilities.gdalCalc){status(capabilityMessage('gdalCalc'));return}const input=val('agriInput');if(!input){status('Select an uploaded multiband raster.');return}runProcess('runAgri','agriLog',{input,operation:val('agriOperation'),bandBlue:val('bandBlue'),bandGreen:val('bandGreen'),bandRed:val('bandRed'),bandNir:val('bandNir'),bandSwir1:val('bandSwir1'),bandSwir2:val('bandSwir2'),saviL:val('saviL'),output:val('agriOutput')},'Agriculture',val('agriOperation')).catch(()=>{})});

function capabilityBadge(label,ok,path){return `<div class="cap-row ${ok?'ok':'missing'}"><span class="cap-dot"></span><b>${label}</b><span>${ok?'ready':'missing'}</span><small>${esc(path||'not resolved')}</small></div>`}
function requiredCapability(operation){
  if(/^vector_/.test(operation))return 'ogr';
  if(/^lidar_/.test(operation))return 'pdal';
  if(/^index_/.test(operation))return 'gdalCalc';
  if(/^raster_/.test(operation))return 'gdal';
  return null;
}
function capabilityMessage(cap){
  if(cap==='ogr')return 'OGR is not available to Tomcat. Vector server processing and SHP export are disabled; browser preview still works for GeoJSON/KML/GPX/zipped Shapefile.';
  if(cap==='gdal')return 'GDAL is not available to Tomcat. Raster processing is disabled; GeoTIFF can still be displayed directly in the browser.';
  if(cap==='gdalCalc')return 'GDAL raster calculator is not available to Tomcat. NDVI/SAVI/EVI/NDWI/NDMI/NBR processing is disabled.';
  if(cap==='pdal')return 'PDAL is not available to Tomcat. LiDAR processing is disabled.';
  return 'Required server GIS tool is unavailable.';
}
function updateProcessingUi(){
  const prepOp=$('prepOperation')?.value||'';const prepCap=requiredCapability(prepOp);const prep=$('runPrep');
  if(prep){prep.disabled=!!(prepCap&&!capabilities[prepCap]);prep.title=prep.disabled?capabilityMessage(prepCap):''}
  const agri=$('runAgri');if(agri){agri.disabled=!capabilities.gdalCalc;agri.title=agri.disabled?capabilityMessage('gdalCalc'):''}
  const shpBtn=$('downloadShp');if(shpBtn){shpBtn.disabled=!capabilities.ogr;shpBtn.title=shpBtn.disabled?capabilityMessage('ogr'):''}
}
async function checkHealth(){try{
  const j=await fetchJson(apiUrl('health'),{cache:'no-store'},'Backend health check');
  capabilities={gdal:!!j.gdal,ogr:!!j.ogr,pdal:!!j.pdal,gdalCalc:!!j.gdalCalc};
  $('health').innerHTML=`${capabilityBadge('GDAL',capabilities.gdal,j.gdalPath)}${capabilityBadge('OGR',capabilities.ogr,j.ogrPath)}${capabilityBadge('PDAL',capabilities.pdal,j.pdalPath)}${capabilityBadge('Raster calculator',capabilities.gdalCalc,j.gdalCalcPath)}<div class="small" style="margin-top:7px">API: ${esc(j.contextPath||APP_BASE_PATH)} · Data: ${esc(j.dataDir||'')}</div><div class="help-inline">Visualization remains available for browser-supported formats even when server GIS tools are missing.</div>`;
  updateProcessingUi();
}catch(e){$('health').textContent=e.message;}}
$('prepOperation')?.addEventListener('change',updateProcessingUi);


function saturationVaporPressure(t){return 0.6108*Math.exp((17.27*t)/(t+237.3))}
function calcEt0(){const tmax=num('etTmax'),tmin=num('etTmin'),rh=num('etRh'),u2=num('etWind'),rs=num('etRs'),z=num('etElev'),lat=num('etLat'),doy=num('etDoy');if(rh<=0||rh>100||doy<1||doy>366||lat<-90||lat>90||u2<0||rs<0){status('Check ET0 input ranges.');return}const t=(tmax+tmin)/2,es=(saturationVaporPressure(tmax)+saturationVaporPressure(tmin))/2,ea=es*rh/100,delta=4098*saturationVaporPressure(t)/Math.pow(t+237.3,2),p=101.3*Math.pow((293-0.0065*z)/293,5.26),gamma=0.000665*p,phi=lat*Math.PI/180,dr=1+0.033*Math.cos(2*Math.PI*doy/365),solarDecl=0.409*Math.sin(2*Math.PI*doy/365-1.39),ws=Math.acos(Math.max(-1,Math.min(1,-Math.tan(phi)*Math.tan(solarDecl)))),ra=(24*60/Math.PI)*0.0820*dr*(ws*Math.sin(phi)*Math.sin(solarDecl)+Math.cos(phi)*Math.cos(solarDecl)*Math.sin(ws)),rso=Math.max(0.001,(0.75+2e-5*z)*ra),rns=0.77*rs,sigma=4.903e-9,rnl=sigma*((Math.pow(tmax+273.16,4)+Math.pow(tmin+273.16,4))/2)*(0.34-0.14*Math.sqrt(Math.max(0,ea)))*(1.35*Math.min(1.5,rs/rso)-0.35),rn=rns-rnl,et0=(0.408*delta*rn+gamma*(900/(t+273))*u2*(es-ea))/(delta+gamma*(1+0.34*u2)),safe=Math.max(0,et0),vpd=es-ea;const metrics=[metric('Reference evapotranspiration (ET0)',safe,'mm/day',2),metric('Net radiation (Rn)',rn,'MJ/m2/day',2),metric('Extraterrestrial radiation (Ra)',ra,'MJ/m2/day',2),metric('Vapour pressure deficit (VPD)',vpd,'kPa',2)];showMetrics('et0Result',metrics,'FAO-56 reference evapotranspiration');$('wmEt0').value=safe.toFixed(2);record('Agroclimatology','FAO-56 ET0',`ET0 ${fmt(safe,2)} mm/day; Rn ${fmt(rn,2)} MJ m^-2 day^-1; Ra ${fmt(ra,2)} MJ m^-2 day^-1; VPD ${fmt(vpd,2)} kPa`,metrics)}
$('calcEt0').addEventListener('click',calcEt0);
$('calcGdd').addEventListener('click',()=>{let tmax=num('gddTmax'),tmin=num('gddTmin'),base=num('gddBase');const upper=val('gddUpper')===''?null:num('gddUpper');if(upper!==null){tmax=Math.min(tmax,upper);tmin=Math.min(tmin,upper)}const gdd=Math.max(0,(tmax+tmin)/2-base);const metrics=[metric('Growing degree days (GDD)',gdd,'degC-day',2),metric('Base temperature',base,'degC',1)];if(upper!==null)metrics.push(metric('Upper cutoff temperature',upper,'degC',1));showMetrics('gddResult',metrics,'Daily thermal time');record('Agroclimatology','Growing degree days',`GDD ${fmt(gdd,2)} deg C day; base ${fmt(base,1)} deg C${upper!==null?'; upper cutoff '+fmt(upper,1)+' deg C':''}`,metrics)});
$('calcRain').addEventListener('click',()=>{const p=Math.max(0,num('rainMonthly')),normal=Math.max(0,num('rainNormal'));const pe=p<=250?p*(125-0.2*p)/125:125+0.1*p;const anomaly=normal>0?100*(p-normal)/normal:0;const metrics=[metric('Monthly rainfall',p,'mm',1),metric('Effective rainfall',pe,'mm',1),metric('Rainfall anomaly',anomaly,'percent',1)];showMetrics('rainResult',metrics,'Rainfall effectiveness');record('Agroclimatology','Rainfall effectiveness',`Rainfall ${fmt(p,1)} mm; effective rainfall ${fmt(pe,1)} mm; anomaly ${anomaly>=0?'+':''}${fmt(anomaly,1)}%`,metrics)});

$('calcWater').addEventListener('click',()=>{const et0=Math.max(0,num('wmEt0')),kc=Math.max(0,num('wmKc')),rain=Math.max(0,num('wmRain')),eff=num('wmEff'),area=Math.max(0,num('wmArea')),days=Math.max(1,num('wmDays'));if(eff<=0||eff>100){status('Irrigation efficiency must be between 1 and 100%.');return}const etc=et0*kc,net=Math.max(0,etc-rain),gross=net/(eff/100),volume=gross*area*10*days;const metrics=[metric('Crop evapotranspiration (ETc)',etc,'mm/day',2),metric('Net irrigation requirement',net,'mm/day',2),metric('Gross irrigation requirement',gross,'mm/day',2),metric('Planned irrigation volume',volume,'m3',1),metric('Planning period',days,'day',0),metric('Command area',area,'ha',2)];showMetrics('waterResult',metrics,'Crop water and irrigation requirement');record('Water management','Crop irrigation requirement',`ETc ${fmt(etc,2)} mm/day; net ${fmt(net,2)} mm/day; gross ${fmt(gross,2)} mm/day; volume ${fmt(volume,1)} m^3`,metrics)});
$('calcRunoff').addEventListener('click',()=>{const p=Math.max(0,num('runoffRain')),cn=num('runoffCn');if(cn<=0||cn>100){status('Curve Number must be 1-100.');return}const s=25400/cn-254,ia=0.2*s,q=p>ia?Math.pow(p-ia,2)/(p+0.8*s):0,c=p>0?q/p:0;const metrics=[metric('Storm rainfall (P)',p,'mm',1),metric('Curve Number (CN)',cn,'none',1),metric('Direct runoff (Q)',q,'mm',2),metric('Runoff coefficient',c,'none',3),metric('Potential maximum retention (S)',s,'mm',1)];showMetrics('runoffResult',metrics,'SCS Curve Number runoff');record('Water management','SCS Curve Number runoff',`P ${fmt(p,1)} mm; CN ${fmt(cn,1)}; runoff Q ${fmt(q,2)} mm; runoff coefficient ${fmt(c,3)}`,metrics)});
$('calcStorage').addEventListener('click',()=>{const area=Math.max(0,num('pondCatch')),rain=Math.max(0,num('pondRain')),coef=Math.min(1,Math.max(0,num('pondCoeff'))),eff=Math.min(100,Math.max(0,num('pondEff'))),gross=area*(rain/1000)*coef,stored=gross*(eff/100);const metrics=[metric('Catchment area',area,'m2',0),metric('Design rainfall',rain,'mm',1),metric('Harvestable runoff inflow',gross,'m3',1),metric('Usable storage',stored,'m3',1),metric('Storage efficiency',eff,'percent',1)];showMetrics('storageResult',metrics,'Farm pond / Jalkund storage');record('Water management','Farm pond/Jalkund storage',`Catchment ${fmt(area,0)} m^2; rainfall ${fmt(rain,1)} mm; inflow ${fmt(gross,1)} m^3; usable storage ${fmt(stored,1)} m^3`,metrics)});

function stopSketchInteractions(){
  if(draw){map.removeInteraction(draw);draw=null;}
  if(measureDraw){map.removeInteraction(measureDraw);measureDraw=null;}
}
function startDraw(type){
  stopSketchInteractions();
  draw=new Draw({source:drawings,type});
  map.addInteraction(draw);
  status('Drawing '+type+' — click map; double-click to finish. Measurement features are kept separately.');
}
$('drawPoint').addEventListener('click',()=>startDraw('Point'));
$('drawLine').addEventListener('click',()=>startDraw('LineString'));
$('drawPolygon').addEventListener('click',()=>startDraw('Polygon'));
$('clearDraw').addEventListener('click',()=>{
  if(draw){map.removeInteraction(draw);draw=null;}
  drawings.clear();
  $('fieldSummary').textContent='No field polygons calculated yet.';
  status('Drawing layer cleared. Measurement features were not changed.');
});
$('downloadGeojson').addEventListener('click',()=>{
  const features=drawings.getFeatures();
  if(!features.length){status('There are no drawings to download.');return;}
  const data=new GeoJSON().writeFeatures(features,{featureProjection:map.getView().getProjection(),dataProjection:'EPSG:4326'});
  downloadBlob(new Blob([data],{type:'application/geo+json'}),'agrigeo-drawings.geojson');
});

function drawingGroups(){
  const groups={points:[],lines:[],polygons:[]};
  drawings.getFeatures().forEach(f=>{
    const type=f.getGeometry()?.getType();
    if(type==='Point'||type==='MultiPoint')groups.points.push(f);
    else if(type==='LineString'||type==='MultiLineString')groups.lines.push(f);
    else if(type==='Polygon'||type==='MultiPolygon')groups.polygons.push(f);
  });
  return groups;
}
$('downloadShp').addEventListener('click',async()=>{
  const groups=drawingGroups();
  const total=groups.points.length+groups.lines.length+groups.polygons.length;
  if(!total){status('Draw at least one point, line or polygon before exporting a Shapefile.');return;}
  const fd=new FormData();
  const format=new GeoJSON();
  Object.entries(groups).forEach(([name,features])=>{
    if(!features.length)return;
    const json=format.writeFeatures(features,{featureProjection:map.getView().getProjection(),dataProjection:'EPSG:4326'});
    fd.append('file',new Blob([json],{type:'application/geo+json'}),name+'.geojson');
  });
  const button=$('downloadShp');button.disabled=true;
  status('Creating ESRI Shapefile package on the GIS server…');
  try{
    const response=await fetch(apiUrl('export/shapefile'),{method:'POST',body:fd});
    if(!response.ok)throw new Error(await responseError(response,'Shapefile export'));
    const blob=await response.blob();
    if(!blob.size)throw new Error('Shapefile export returned an empty ZIP file.');
    downloadBlob(blob,'agrigeo-drawings-shapefile.zip');
    status('Shapefile ZIP created. Points, lines and polygons are stored as separate shapefiles when needed.');
    record('Export','Drawing Shapefile',`Exported ${total} drawing feature(s) as ESRI Shapefile ZIP`);
  }catch(e){status(e.message)}finally{button.disabled=false;}
});

function measurementMetrics(geometry){
  const projection=map.getView().getProjection();
  const type=geometry?.getType();
  if(type==='LineString'){
    const length=Math.abs(geodesicLength(geometry,{projection})||0);
    return [metric('Distance',length,'m',1),metric('Distance',length/1000,'km',3)];
  }
  if(type==='Polygon'){
    const area=Math.abs(geodesicArea(geometry,{projection})||0);
    const perimeter=Math.abs(geodesicLength(geometry.getLinearRing(0),{projection})||0);
    return [metric('Area',area,'m2',1),metric('Area',area/10000,'ha',4),metric('Perimeter',perimeter,'m',1)];
  }
  return [];
}
function startMeasure(type){
  stopSketchInteractions();
  measureDraw=new Draw({source:measurements,type});
  map.addInteraction(measureDraw);
  status(type==='LineString'?'Measurement: click along the route and double-click to finish distance.':'Measurement: click the boundary and double-click to finish area.');
  measureDraw.once('drawend',evt=>{
    const metrics=measurementMetrics(evt.feature.getGeometry());
    showMetrics('measureResult',metrics,type==='LineString'?'Distance measurement':'Area measurement');
    if(metrics.length)record('GIS measurement',type==='LineString'?'Distance':'Area','Interactive map measurement',metrics);
    setTimeout(()=>{if(measureDraw){map.removeInteraction(measureDraw);measureDraw=null;}},0);
  });
}
$('measureDistance').addEventListener('click',()=>startMeasure('LineString'));
$('measureArea').addEventListener('click',()=>startMeasure('Polygon'));
$('clearMeasure').addEventListener('click',()=>{
  if(measureDraw){map.removeInteraction(measureDraw);measureDraw=null;}
  measurements.clear();
  $('measureResult').textContent='No active measurement.';
  status('Measurement layer cleared. Drawing features were not changed.');
});

$('measureFields').addEventListener('click',()=>{
  const projection=map.getView().getProjection();let polygons=0,area=0,perimeter=0,lines=0,length=0;
  drawings.getFeatures().forEach(f=>{const g=f.getGeometry();if(!g)return;const t=g.getType();if(t==='Polygon'||t==='MultiPolygon'){polygons++;area+=Math.abs(geodesicArea(g,{projection})||0);if(t==='Polygon')perimeter+=Math.abs(geodesicLength(g.getLinearRing(0),{projection})||0)}else if(t==='LineString'||t==='MultiLineString'){lines++;length+=Math.abs(geodesicLength(g,{projection})||0)}});
  const ha=area/10000;const metrics=[metric('Field polygons',polygons,'none',0),metric('Total field area',ha,'ha',3),metric('Total field area',area,'m2',0),metric('Polygon perimeter',perimeter,'m',1),metric('Drawn lines',lines,'none',0),metric('Line length',length/1000,'km',3)];
  showMetrics('fieldSummary',metrics,'Drawing-layer field summary');
  record('Agriculture','Drawing-layer field summary',`${polygons} polygon(s); ${fmt(ha,3)} ha; perimeter ${fmt(perimeter,1)} m; ${lines} line(s); ${fmt(length/1000,3)} km`,metrics);
});

function mapState(){const view=map.getView();return{center:toLonLat(view.getCenter()),zoom:view.getZoom(),basemap:activeBasemap,grid:gridMode,services:map.getLayers().getArray().map(l=>l.get('service')).filter(Boolean)}}
$('shareLink').addEventListener('click',()=>{const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(mapState())))).replace(/=+$/,'');const url=location.href.split('#')[0]+'#map='+encoded;$('shareOutput').value=url;status('Share link created.')});
async function restore(){const m=location.hash.match(/#map=([^&]+)/);if(!m)return;try{const raw=m[1].replace(/-/g,'+').replace(/_/g,'/'),padded=raw+'='.repeat((4-raw.length%4)%4),s=JSON.parse(decodeURIComponent(escape(atob(padded))));if(Array.isArray(s.center))map.getView().setCenter(fromLonLat(s.center));if(Number.isFinite(s.zoom))map.getView().setZoom(s.zoom);if(s.basemap)await switchBasemap(s.basemap,true);if(s.grid){gridMode=s.grid;$('gridModeSelect').value=gridMode;updateCoordinateGrid()}for(const x of s.services||[]){$('ogcType').value=x.type;$('ogcUrl').value=x.url;$('ogcLayer').value=x.layerName;$('ogcTitle').value=x.title;$('addOgc').click()}}catch(e){status('Could not restore shared map: '+e.message)}}

function composeMapCanvas(){const size=map.getSize();const mapCanvas=document.createElement('canvas');mapCanvas.width=size[0];mapCanvas.height=size[1];const ctx=mapCanvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size[0],size[1]);document.querySelectorAll('#map .ol-layer canvas, #map canvas.ol-layer').forEach(canvas=>{if(canvas.width===0||canvas.height===0)return;const opacity=canvas.parentNode?.style?.opacity||canvas.style.opacity;ctx.globalAlpha=opacity===''?1:Number(opacity);const transform=canvas.style.transform||getComputedStyle(canvas).transform;if(transform&&transform!=='none'){const match=transform.match(/^matrix\(([^)]+)\)$/);if(match){ctx.setTransform(...match[1].split(',').map(Number))}else ctx.setTransform(1,0,0,1,0,0)}else ctx.setTransform(1,0,0,1,0,0);const bg=canvas.parentNode?.style?.backgroundColor;if(bg){ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height)}ctx.drawImage(canvas,0,0)});ctx.globalAlpha=1;ctx.setTransform(1,0,0,1,0,0);return mapCanvas}
async function waitRender(){return new Promise(resolve=>{map.once('rendercomplete',resolve);map.renderSync();setTimeout(resolve,1200)})}
$('exportPng').addEventListener('click',async()=>{try{await waitRender();const c=composeMapCanvas();c.toBlob(blob=>{if(!blob)throw new Error('Could not create map image');downloadBlob(blob,'agrigeo-map.png')},'image/png');record('Export','Map PNG','Exported current map as PNG')}catch(e){status('Map export failed: '+e.message)}});
function visibleLegend(){return map.getLayers().getArray().filter(l=>l.getVisible()&&l.get('kind')!=='grid').map(layerTitle)}
function niceScale(n){if(!Number.isFinite(n)||n<=0)return 0;const p=Math.pow(10,Math.floor(Math.log10(n))),x=n/p;const k=x<1.5?1:x<3.5?2:x<7.5?5:10;return Math.round(k*p)}
async function loadJsPdf(){
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  throw new Error('PDF library did not load. Check CDN/firewall access and reload the portal.');
}
function pdfSafe(text){
  return String(text??'')
    .replace(/[–—]/g,'-').replace(/≈/g,'approx.')
    .replace(/·/g,';').replace(/₀/g,'0')
    .replace(/[⁻−]/g,'-').replace(/²/g,'2').replace(/³/g,'3').replace(/¹/g,'1')
    .replace(/\u00a0/g,' ');
}
function pdfUnitRuns(unit){
  const deg='°';
  switch(unit){
    case 'mm/day': return [{text:'mm day'},{text:'-1',sup:true}];
    case 'MJ/m2/day': return [{text:'MJ m'},{text:'-2',sup:true},{text:' day'},{text:'-1',sup:true}];
    case 'degC-day': return [{text:deg+'C day'}];
    case 'degC': return [{text:deg+'C'}];
    case 'm3': return [{text:'m'},{text:'3',sup:true}];
    case 'm2': return [{text:'m'},{text:'2',sup:true}];
    case 'percent': return [{text:'%'}];
    case 'none': return [{text:'-'}];
    default: return [{text:unitText(unit)}];
  }
}
function drawPdfRuns(doc,runs,x,y,maxWidth=999){
  let xx=x;const base=doc.getFontSize();
  for(const run of runs){
    const size=run.sup?base*0.72:base;
    doc.setFontSize(size);
    const t=pdfSafe(run.text);
    const yy=run.sup?y-1.35:y;
    if(xx-x+doc.getTextWidth(t)>maxWidth)break;
    doc.text(t,xx,yy);
    xx+=doc.getTextWidth(t);
  }
  doc.setFontSize(base);
}
function gridDescription(){return gridMode==='off'?'Off':`${currentGridInterval}° latitude / longitude`;}
function drawPdfMetaTable(doc,rows,x,y,width){
  const labelW=38,rowH=6;
  doc.setFont('times','normal');doc.setFontSize(8.5);doc.setDrawColor(165,175,170);
  rows.forEach(([label,value],i)=>{
    const yy=y+i*rowH;
    doc.setFillColor(i%2?250:244,248,246);doc.rect(x,yy,width,rowH,'F');doc.rect(x,yy,width,rowH);
    doc.line(x+labelW,yy,x+labelW,yy+rowH);
    doc.setFont('times','bold');doc.text(pdfSafe(label),x+2,yy+4.2);
    doc.setFont('times','normal');doc.text(pdfSafe(value),x+labelW+2,yy+4.2);
  });
  return y+rows.length*rowH;
}
function historyRows(){
  const rows=[];
  analysisHistory.forEach(item=>{
    if(item.metrics&&item.metrics.length){
      item.metrics.forEach(m=>rows.push({module:item.category,analysis:item.operation,parameter:m.label,value:metricValue(m),unit:m.unit}));
    }else{
      rows.push({module:item.category,analysis:item.operation,parameter:'Result',value:pdfSafe(item.result),unit:'none'});
    }
  });
  return rows;
}
function drawAnalysisTable(doc,rows,startY){
  const margin=12,pageBottom=282,headers=['Module','Analysis','Parameter','Value','Unit'],widths=[28,40,48,38,32];
  const xStarts=[margin];for(let i=0;i<widths.length-1;i++)xStarts.push(xStarts[i]+widths[i]);
  const drawHeader=y=>{
    doc.setFillColor(226,239,231);doc.setDrawColor(135,155,145);doc.setFont('times','bold');doc.setFontSize(8.2);
    let x=margin;headers.forEach((h,i)=>{doc.rect(x,y,widths[i],7,'FD');doc.text(h,x+1.5,y+4.8);x+=widths[i]});
    return y+7;
  };
  let y=drawHeader(startY);
  doc.setFontSize(8);
  for(const row of rows){
    const cells=[pdfSafe(row.module),pdfSafe(row.analysis),pdfSafe(row.parameter),pdfSafe(row.value)];
    const wraps=[
      doc.splitTextToSize(cells[0],widths[0]-3),
      doc.splitTextToSize(cells[1],widths[1]-3),
      doc.splitTextToSize(cells[2],widths[2]-3),
      doc.splitTextToSize(cells[3],widths[3]-3)
    ];
    const lineCount=Math.max(1,...wraps.map(a=>a.length));
    const rowH=Math.max(7,2.7+lineCount*3.55);
    if(y+rowH>pageBottom){doc.addPage();doc.setFont('times','normal');y=drawHeader(14)}
    doc.setFillColor(255,255,255);doc.setDrawColor(190,200,195);
    let x=margin;for(let i=0;i<widths.length;i++){doc.rect(x,y,widths[i],rowH);x+=widths[i]}
    doc.setFont('times','normal');doc.setFontSize(8);
    wraps.forEach((lines,i)=>doc.text(lines,xStarts[i]+1.5,y+4));
    drawPdfRuns(doc,pdfUnitRuns(row.unit),xStarts[4]+1.5,y+4,widths[4]-3);
    y+=rowH;
  }
  return y;
}
async function mapPdf(){
  await waitRender();
  const canvas=composeMapCanvas(),img=canvas.toDataURL('image/jpeg',0.92),jsPDF=await loadJsPdf(),paper=val('paperSize').toLowerCase(),orientation=val('orientation'),doc=new jsPDF({orientation,unit:'mm',format:paper});
  const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight(),margin=10,header=18,footer=10,legendW=Math.min(55,w*0.22),mapX=margin,mapY=margin+header,mapW=w-2*margin-legendW-5,mapH=h-mapY-footer-margin;
  doc.setFont('times','bold');doc.setFontSize(16);doc.text(pdfSafe(val('mapTitle')||'Agricultural Resource Analysis Map'),margin,margin+6);
  doc.setFont('times','normal');doc.setFontSize(8.5);doc.text(pdfSafe([val('mapOrg'),val('mapAuthor')].filter(Boolean).join(' | ')),margin,margin+12);
  doc.addImage(img,'JPEG',mapX,mapY,mapW,mapH,'','FAST');
  const lx=mapX+mapW+5;doc.setDrawColor(90);doc.rect(lx,mapY,legendW,mapH);doc.setFont('times','bold');doc.setFontSize(9);doc.text('LEGEND / MAP INFORMATION',lx+4,mapY+7);
  doc.setFont('times','normal');doc.setFontSize(7.5);let yy=mapY+14;
  visibleLegend().slice(0,12).forEach(x=>{doc.rect(lx+4,yy-2.2,4,2.7);doc.text(pdfSafe(String(x).slice(0,44)),lx+10,yy);yy+=5});
  const center=toLonLat(map.getView().getCenter()),res=map.getView().getResolution(),mpp=getPointResolution(map.getView().getProjection(),res,map.getView().getCenter(),'m'),mapWidthMeters=mpp*canvas.width,scale=niceScale((mapWidthMeters*1000)/mapW);
  yy=Math.max(yy+4,mapY+mapH-43);doc.setFont('times','bold');doc.setFontSize(9);doc.text('N',lx+legendW/2,yy,{align:'center'});doc.line(lx+legendW/2,yy+2,lx+legendW/2,yy+13);doc.line(lx+legendW/2,yy+2,lx+legendW/2-2.5,yy+7);doc.line(lx+legendW/2,yy+2,lx+legendW/2+2.5,yy+7);
  doc.setFont('times','normal');doc.setFontSize(7.5);doc.text(`Scale 1 : ${scale.toLocaleString()}`,lx+4,yy+19);doc.text(`Longitude: ${center[0].toFixed(4)}°`,lx+4,yy+24);doc.text(`Latitude: ${center[1].toFixed(4)}°`,lx+4,yy+29);doc.text(`CRS: ${map.getView().getProjection().getCode()}`,lx+4,yy+34);doc.text(`Grid: ${gridDescription()}`,lx+4,yy+39);
  doc.setFontSize(7);doc.text(pdfSafe(val('mapNotes')||'Generated by AgriGeo Analytics Portal'),margin,h-5);doc.text(pdfSafe(new Date().toLocaleString()),w-margin,h-5,{align:'right'});
  doc.save('agrigeo-standard-map.pdf');record('Export','Standard PDF map',`${paper.toUpperCase()} ${orientation}; scale 1:${scale}; grid ${gridDescription()}`);
}
$('exportPdf').addEventListener('click',()=>mapPdf().catch(e=>status('PDF export failed: '+e.message)));
$('exportCsv').addEventListener('click',()=>{
  if(!analysisHistory.length){status('Run at least one analysis before exporting CSV.');return}
  const rows=[['time','module','analysis','parameter','value','unit']];
  analysisHistory.forEach(item=>{
    if(item.metrics&&item.metrics.length)item.metrics.forEach(m=>rows.push([item.time,item.category,item.operation,m.label,metricValue(m),unitText(m.unit)]));
    else rows.push([item.time,item.category,item.operation,'Result',item.result,'']);
  });
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),'agrigeo-analysis-summary.csv');
});
$('exportReport').addEventListener('click',async()=>{
  try{
    const jsPDF=await loadJsPdf(),doc=new jsPDF({unit:'mm',format:'a4'}),w=doc.internal.pageSize.getWidth(),center=toLonLat(map.getView().getCenter());
    doc.setFont('times','bold');doc.setFontSize(17);doc.text('AgriGeo Analysis Report',12,15);
    doc.setFont('times','italic');doc.setFontSize(9);doc.text('Agriculture | Agroclimatology | Water Management',12,21);
    const meta=[
      ['Generated',new Date().toLocaleString()],
      ['Longitude',`${center[0].toFixed(4)}°`],
      ['Latitude',`${center[1].toFixed(4)}°`],
      ['Map CRS',map.getView().getProjection().getCode()],
      ['Map grid',gridDescription()]
    ];
    let y=drawPdfMetaTable(doc,meta,12,26,w-24)+8;
    doc.setFont('times','bold');doc.setFontSize(11);doc.text('Analysis results',12,y);y+=3;
    const rows=historyRows();
    if(rows.length)y=drawAnalysisTable(doc,rows,y+2);else{doc.setFont('times','normal');doc.setFontSize(9);doc.text('No recorded analysis results. Run an analysis first.',12,y+7);y+=14}
    await waitRender();
    try{
      const c=composeMapCanvas(),img=c.toDataURL('image/jpeg',0.84),imgH=74;
      if(y+imgH+15>282){doc.addPage();y=14}
      doc.setFont('times','bold');doc.setFontSize(11);doc.text('Current map view with coordinate grid',12,y+5);
      doc.addImage(img,'JPEG',12,y+9,w-24,imgH,'','FAST');
      y+=imgH+14;
    }catch(_){}
    const pages=doc.getNumberOfPages();
    for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFont('times','normal');doc.setFontSize(7);doc.text(`AgriGeo Analysis Report | Page ${i} of ${pages}`,12,291);}
    doc.save('agrigeo-analysis-report.pdf');record('Export','PDF analysis report','Generated Times-style tabular analysis report with coordinate-grid map.');
  }catch(e){status('Report export failed: '+e.message)}
});

map.on('pointermove',e=>{const c=toLonLat(e.coordinate);$('coords').textContent=`Lon ${c[0].toFixed(5)} · Lat ${c[1].toFixed(5)}`});
$('homeBtn').addEventListener('click',()=>map.getView().animate({center:fromLonLat([80.5,22.5]),zoom:4.5,duration:350}));

const appShell=document.querySelector('.app');
const sidebarToggle=$('sidebarToggle');
const sidebarRestoreBtn=$('sidebarRestoreBtn');
function resizeMapSoon(){requestAnimationFrame(()=>{map.updateSize();setTimeout(()=>map.updateSize(),220)})}
function setSidebarCollapsed(collapsed){
  appShell.classList.toggle('sidebar-collapsed',collapsed);
  sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
  sidebarRestoreBtn.setAttribute('aria-expanded',String(!collapsed));
  status(collapsed?'Analysis sidebar minimized. Use “Tools” to reopen it.':'Analysis sidebar restored.');
  resizeMapSoon();
}
sidebarToggle.addEventListener('click',()=>setSidebarCollapsed(true));
sidebarRestoreBtn.addEventListener('click',()=>setSidebarCollapsed(false));

const fullscreenBtn=$('fullscreenBtn');
let fullscreenFallback=false;
function workspaceIsFullscreen(){return document.fullscreenElement===workspace||fullscreenFallback}
function updateFullscreenUi(){
  const active=workspaceIsFullscreen();
  fullscreenBtn.textContent=active?'⛶ Exit fullscreen':'⛶ Fullscreen';
  fullscreenBtn.classList.toggle('active',active);
  fullscreenBtn.setAttribute('aria-label',active?'Exit fullscreen map':'Enter fullscreen map');
  fullscreenBtn.title=active?'Exit fullscreen map':'Fullscreen map';
  resizeMapSoon();
}
async function toggleFullscreen(){
  try{
    if(document.fullscreenElement){await document.exitFullscreen();return}
    if(fullscreenFallback){workspace.classList.remove('map-fullscreen-fallback');document.body.classList.remove('map-fullscreen-fallback-active');fullscreenFallback=false;updateFullscreenUi();return}
    if(workspace.requestFullscreen){await workspace.requestFullscreen();return}
  }catch(e){console.warn('Fullscreen API unavailable; using layout fallback.',e)}
  fullscreenFallback=!fullscreenFallback;
  workspace.classList.toggle('map-fullscreen-fallback',fullscreenFallback);
  document.body.classList.toggle('map-fullscreen-fallback-active',fullscreenFallback);
  updateFullscreenUi();
}
fullscreenBtn.addEventListener('click',toggleFullscreen);
document.addEventListener('fullscreenchange',updateFullscreenUi);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&fullscreenFallback){fullscreenFallback=false;workspace.classList.remove('map-fullscreen-fallback');document.body.classList.remove('map-fullscreen-fallback-active');updateFullscreenUi()}});
const panelLabels={data:'Data & analysis workspace',preprocess:'Preprocessing & terrain',agriculture:'Agricultural remote sensing',climate:'Agroclimatology',water:'Water management',services:'OGC services',export:'Map & report export'};
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));t.classList.add('active');$('panel-'+t.dataset.panel).classList.add('active');$('mapMode').textContent=panelLabels[t.dataset.panel]||'';setTimeout(()=>map.updateSize(),0)}));
$('useGoogleKey').addEventListener('click',async()=>{const key=val('googleApiKey');if(!key){status('Enter a Google Map Tiles API key first.');return}googleApiKey=key;const current=activeBasemap;resetGoogleLayers();if(isGoogleBase(current)){await switchBasemap(current,true);return}status('Google basemap key loaded. Choose Google Map or Google Satellite to validate the Map Tiles API session.')});
async function loadConfig(){try{const j=await fetchJson(apiUrl('config'),{cache:'no-store'},'Portal configuration');if(j.googleMapsApiKey){googleApiKey=j.googleMapsApiKey;$('googleApiKey').value=googleApiKey}}catch(e){status(e.message)}}
const workspace=document.querySelector('.workspace');if('ResizeObserver'in window)new ResizeObserver(()=>map.updateSize()).observe(workspace);window.addEventListener('resize',()=>map.updateSize());
async function init(){try{const health=await discoverApiBase();status('Backend connected at '+normalizeBase(health.contextPath||APP_BASE_PATH));}catch(e){$('health').textContent=e.message;status(e.message)}await loadConfig();refreshLayers();await checkHealth();await refreshFiles();await restore();map.updateSize();updateCoordinateGrid();renderHistory();if(!$('health').textContent.includes('not found'))status('AgriGeo ready — API '+APP_BASE_PATH+' · browser visualization active; server GIS processing follows the capability panel.')}
init();
