const $ = id => document.getElementById(id);
const frame = $('prototype');
let eventCount=0;
const params=new URLSearchParams(location.search);
for(const id of ['scenario','viewport','condition'])if([...$(id).options].some(o=>o.value===params.get(id)))$(id).value=params.get(id);
function send(payload){frame.contentWindow.postMessage({channel:'reader-design-lab',...payload},location.origin);}
function log(text){$('event-count').textContent=++eventCount;const li=document.createElement('li');li.textContent=new Date().toLocaleTimeString('zh-CN')+' '+text;$('events').prepend(li);}
function layout(){const mode=$('viewport').value;$('frame-wrap').style.width=/^\d+$/.test(mode)?mode+'px':'100%';$('size-label').textContent=Math.round(frame.getBoundingClientRect().width)+' × '+Math.round(frame.getBoundingClientRect().height);}
function update(){frame.src='prototype.html?'+new URLSearchParams({view:$('scenario').value,condition:$('condition').value});layout();const state=new URLSearchParams();for(const id of ['scenario','viewport','condition'])state.set(id,$(id).value);history.replaceState(null,'','?'+state);}
for(const id of ['scenario','condition'])$(id).addEventListener('change',update);
$('viewport').addEventListener('change',layout);new ResizeObserver(layout).observe($('stage'));
$('reset').onclick=()=>{send({type:'reset'});log('已重置原型数据与外观');};
$('selection').onclick=()=>send({type:'select-example'});
$('walkthrough').onclick=()=>{$('scenario').value='reader';$('condition').value='normal';frame.addEventListener('load',()=>send({type:'select-example'}),{once:true});update();};
window.addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.origin===location.origin&&e.data?.channel==='reader-design-lab'&&e.data.type==='event')log(e.data.message);});
update();
