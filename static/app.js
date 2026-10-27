import {pointIndex, indexPoint, neighbors, groupInfo} from './view-model.mjs';

const $ = id => document.getElementById(id);
const coordinates = p => `(${p.join(', ')})`;
const colorName = color => color === 1 ? '黑棋' : '白棋';
const displayNumber = number => Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
const svgElement = (tag, attrs = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
  return node;
};

let state = null, scene = null, busy = false, inspection = null, hintedPoint = null;
let layer = null, focusedSlice = 2, spacing = 1.15, autoRotate = false, initializedView = false;
let notice = '', noticeError = false, sliceNodes = new Map(), previousSize = null;
const mutationButtons = ['pass-button','undo-button','hint-button','resign-button','resume-button','new-button','demo-button','load-button','save-button'];
window.go3d = {
  scene:null,
  getState:() => state,
  getView:() => ({layer,focusedSlice,spacing,autoRotate,inspection:inspection ? [...inspection] : null}),
};

function setNotice(message, error = false) { notice = message; noticeError = error; renderStatus(); }
function setBusy(value) {
  busy = value;
  scene?.setEnabled(!value);
  renderControls();
  document.querySelector('.slice-board')?.setAttribute('aria-busy',String(value));
}
function renderControls() {
  const game = state?.game;
  for (const id of mutationButtons) $(id).disabled = busy || !game;
  if (!game) return;
  const computerTurn = state.mode === 'ai' && game.turn === 2;
  $('pass-button').disabled = busy || game.finished || computerTurn;
  $('hint-button').disabled = busy || game.finished || computerTurn;
  $('resign-button').disabled = busy || game.finished || computerTurn;
  $('undo-button').disabled = busy || (!game.move_number && !game.finished);
  $('resume-button').hidden = !game.finished || game.resigned !== null;
  for (const id of ['size-select','mode-select','komi-input']) $(id).disabled = busy;
}
function renderStatus() {
  const banner = $('status-banner'); banner.classList.toggle('error',noticeError);
  if (busy) { banner.textContent = '正在计算棋局，请稍候…'; return; }
  if (notice) { banner.textContent = notice; return; }
  if (!state) { banner.textContent = '正在连接棋盘…'; return; }
  const game = state.game;
  if (game.resigned !== null) banner.textContent = `${colorName(game.resigned)}认输，${colorName(3-game.resigned)}获胜。`;
  else if (game.finished) {
    const difference = game.score.black-game.score.white;
    const result = difference === 0 ? '当前平局' : `${colorName(difference > 0 ? 1 : 2)}暂胜 ${displayNumber(Math.abs(difference))} 目`;
    banner.textContent = `${result}。点棋块标记死子，双方确认死活后数子。`;
  } else if (game.last_captured.length) banner.textContent = `上一手提走 ${game.last_captured.length} 子。跨层连接的无气棋块会被一起提走。`;
  else if (game.pass_count) banner.textContent = '上一手停着。若下一手也停着，将进入数子。';
  else banner.textContent = '点击空间格点落子。位置遮挡时，可用下方切层精准落子。';
}

async function readResponse(response) {
  let data;
  try { data = await response.json(); }
  catch { throw new Error('服务响应无法读取。请检查本地 Python 程序是否仍在运行。'); }
  if (!response.ok) {
    if (data.state) applyState(data.state);
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return data;
}
async function action(name, parameters = {}) {
  if (busy || !state) return;
  setBusy(true); notice = ''; noticeError = false; renderStatus();
  try {
    const data = await readResponse(await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:name,revision:state.revision,...parameters})}));
    hintedPoint = name === 'hint' ? data.hint : null;
    applyState(data,{animate:name === 'move' || name === 'dead' || name === 'undo'});
    if (name === 'demo') {
      focusedSlice = 2; setLayer(2); inspection = [1,1,1]; renderSlice(); updateInspection();
      setNotice('白子五面已围：在 z = 2 层的 (1, 1, 2) 落黑，补掉最后一气。');
    }
    if (name === 'hint') {
      if (data.hint) {
        inspection = [...data.hint]; focusedSlice = data.hint[2];
        if (layer !== null) setLayer(data.hint[2]);
        else { syncLayerControls(); renderSlice(); }
        updateInspection(); setNotice(data.message || `试试 ${coordinates(data.hint)}。提示来自入门启发式判断。`);
      } else setNotice(data.message || '没有推荐落点，可以选择停一手。');
    }
  } catch (error) { setNotice(error.message,true); }
  finally { setBusy(false); renderStatus(); }
}
function applyState(next, {animate = true} = {}) {
  const previousGameSize = state?.game.size;
  const previousLayer = layer;
  state = next;
  const size = state.game.size;
  if (!initializedView) { focusedSlice = Math.floor(size/2); initializedView = true; }
  focusedSlice = Math.min(focusedSlice,size-1);
  if (layer !== null) layer = Math.min(layer,size-1);
  if (inspection && inspection.some(value => value >= size)) inspection = null;
  if (hintedPoint && hintedPoint.some(value => value >= size)) hintedPoint = null;
  scene?.setGame(state.game,{animate});
  if (previousGameSize !== size || previousLayer !== layer) scene?.setLayer(layer);
  renderChrome(); renderSlice(); updateInspection(); renderControls(); renderStatus();
}
function renderChrome() {
  const game = state.game;
  $('total-points').textContent = `${game.size ** 3} 个格点`;
  $('board-size-mark').replaceChildren(document.createTextNode(String(game.size)));
  const exponent = document.createElement('span'); exponent.textContent = '³'; $('board-size-mark').append(exponent);
  if (scene && !scene.failed) $('scene-stats').textContent = `${game.size ** 3} 格点 · 3D`;
  $('turn-stone').className = `turn-stone ${game.turn === 1 ? 'black' : 'white'}`;
  $('turn-title').textContent = game.finished ? (game.resigned !== null ? '棋局结束' : '共同确认数子') : `${colorName(game.turn)}落子`;
  $('turn-subtitle').textContent = game.finished ? (game.resigned !== null ? '认输结束' : '点击棋块标记或恢复死子') : state.mode === 'ai' ? '你执黑 · 电脑执白' : '双人对弈 · 黑先白后';
  $('move-number').textContent = String(game.move_number).padStart(2,'0');
  $('black-player').textContent = state.mode === 'ai' ? '你' : '玩家一';
  $('white-player').textContent = state.mode === 'ai' ? '电脑' : '玩家二';
  $('black-captures').textContent = `提 ${game.captures.black}`; $('white-captures').textContent = `提 ${game.captures.white}`;
  $('black-score').textContent = displayNumber(game.score.black); $('white-score').textContent = displayNumber(game.score.white);
  $('score-title').textContent = game.finished ? '终局数子' : '预估面积';
  $('komi-label').textContent = `白贴 ${displayNumber(game.komi)}`;
  $('score-breakdown').textContent = `黑 ${game.score.black_stones} 子 + ${game.score.black_territory} 地 · 白 ${game.score.white_stones} 子 + ${game.score.white_territory} 地`;
  $('score-note').textContent = game.finished && game.resigned === null ? `已标记 ${game.dead.length} 枚死子；公气 ${game.score.neutral} 点。双方确认死活后，以此面积为结果。` : game.resigned !== null ? '认输结果优先，面积仅供查看。' : '中盘空域变化很大，估算不代表胜负；终局需共同确认死活。';
  $('size-select').value = String(game.size); $('mode-select').value = state.mode; $('komi-input').value = String(game.komi);
  if (previousSize !== game.size) {
    const all = document.createElement('option'); all.value = 'all'; all.textContent = '全部层';
    $('layer-select').replaceChildren(all); $('slice-layer-select').replaceChildren();
    for (let z = 0; z < game.size; z += 1) {
      const option = document.createElement('option'); option.value = String(z); option.textContent = `z = ${z}`;
      $('layer-select').append(option); $('slice-layer-select').append(option.cloneNode(true));
    }
    previousSize = game.size;
  }
  syncLayerControls(); renderHistory();
}
function syncLayerControls() {
  $('layer-select').value = layer === null ? 'all' : String(layer);
  $('slice-layer-select').value = String(focusedSlice);
}
function renderHistory() {
  const moves = state.game.moves, list = $('history-list'); list.replaceChildren();
  $('history-count').textContent = `${moves.length} 手`;
  if (!moves.length) { const empty = document.createElement('li'); empty.className = 'history-empty'; empty.textContent = '棋局尚未开始'; list.append(empty); return; }
  for (let i = moves.length-1; i >= Math.max(0,moves.length-30); i -= 1) {
    const move = moves[i], item = document.createElement('li');
    const number = document.createElement('span'); number.className = 'history-index'; number.textContent = String(i+1).padStart(2,'0');
    const stone = document.createElement('i'); stone.className = `small-stone ${move.color === 1 ? 'black' : 'white'}`;
    const name = document.createElement('span'); name.textContent = colorName(move.color);
    const text = document.createElement('span'); text.className = 'history-action'; text.textContent = move.point ? coordinates(move.point) : move.action === 'resign' ? '认输' : move.action === 'resume' ? '继续对弈' : '停着';
    item.append(number,stone,name,text); list.append(item);
  }
}

function renderSlice() {
  if (!state) return;
  const game = state.game, size = game.size;
  const focused = document.activeElement?.dataset.point;
  const board = $('slice-board'); board.replaceChildren(); sliceNodes = new Map();
  const svg = svgElement('svg',{viewBox:'0 0 200 200',class:'slice-board','aria-label':`z 等于 ${focusedSlice} 的 XY 切片`,'aria-busy':busy});
  const defs = svgElement('defs');
  for (const [id,colors] of [['black-stone',['#59696f','#1d2b31','#0b1117']],['white-stone',['#fffefa','#f2f0df','#c7c7b5']]]) {
    const gradient = svgElement('radialGradient',{id,cx:'32%',cy:'24%',r:'80%'});
    for (let i=0;i<colors.length;i+=1) gradient.append(svgElement('stop',{offset:`${i*50}%`,'stop-color':colors[i]}));
    defs.append(gradient);
  }
  svg.append(defs);
  const position = value => 25 + value*150/(size-1), radius = size === 3 ? 21 : size === 5 ? 13 : 9;
  const dead = new Set(game.dead.map(point => pointIndex(point,size)));
  for (let i=0;i<size;i+=1) {
    svg.append(svgElement('line',{x1:25,y1:position(i),x2:175,y2:position(i),class:'grid-line'}),svgElement('line',{x1:position(i),y1:25,x2:position(i),y2:175,class:'grid-line'}));
    const xLabel=svgElement('text',{x:position(i),y:12,'text-anchor':'middle',class:'axis-label'}); xLabel.textContent=i;
    const yLabel=svgElement('text',{x:10,y:position(i)+3,'text-anchor':'middle',class:'axis-label'}); yLabel.textContent=i; svg.append(xLabel,yLabel);
  }
  for (let y=0;y<size;y+=1) {
    for (let x=0;x<size;x+=1) {
      const point=[x,y,focusedSlice], index=pointIndex(point,size), color=game.board[index], cx=position(x), cy=position(y);
      if ($('territory-toggle').checked && !color && game.score.territory[index]) svg.append(svgElement('rect',{x:cx-3.5,y:cy-3.5,width:7,height:7,rx:1,class:`territory-mark ${game.score.territory[index]===1?'black':'white'}`}));
      const circle=svgElement('circle',{cx,cy,r:radius,class:`point-surface ${color===1?'black':color===2?'white':'empty'}${dead.has(index)?' dead-stone':''}`,'data-point':point.join(','),role:'button',tabindex:0,'aria-label':`${coordinates(point)}，${color?colorName(color):'空点'}${dead.has(index)?'，已标记死子':''}`});
      circle.addEventListener('pointerenter',()=>inspectPoint(point)); circle.addEventListener('focus',()=>inspectPoint(point));
      circle.addEventListener('click',()=>playPoint(point));
      circle.addEventListener('keydown',event=>{
        if (event.key==='Enter'||event.key===' ') {event.preventDefault();playPoint(point);}
        else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
          event.preventDefault(); const next=[...point], axis=['ArrowLeft','ArrowRight'].includes(event.key)?0:1;
          next[axis]+=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
          if(next[axis]>=0&&next[axis]<size) sliceNodes.get(pointIndex(next,size))?.focus();
        }
      });
      svg.append(circle);sliceNodes.set(index,circle);
      if(game.last_move&&index===pointIndex(game.last_move,size)&&color)svg.append(svgElement('circle',{cx,cy,r:2.8,class:`point-decoration last-marker ${color===2?'white':''}`}));
      if(dead.has(index)){const delta=radius*.55;svg.append(svgElement('path',{d:`M${cx-delta},${cy-delta} L${cx+delta},${cy+delta} M${cx+delta},${cy-delta} L${cx-delta},${cy+delta}`,class:'point-decoration dead-marker'}));}
    }
  }
  board.append(svg);
  if (focused) {
    const point=focused.split(',').map(Number);
    if(point[2]===focusedSlice&&point[0]<size&&point[1]<size)sliceNodes.get(pointIndex(point,size))?.focus({preventScroll:true});
  }
  updateInspection();
}
function inspectPoint(point) {
  if(!state)return;
  inspection=point?[...point]:null;
  if(point&&point[2]!==focusedSlice) {focusedSlice=point[2];syncLayerControls();renderSlice();}
  updateInspection();
}
function updateInspection() {
  if(!state)return;
  const game=state.game,size=game.size,index=inspection?pointIndex(inspection,size):-1;
  const adjacent=new Set(inspection?neighbors(inspection,size).map(point=>pointIndex(point,size)):[]);
  const info=inspection?groupInfo(game.board,size,inspection):{stones:new Set(),liberties:new Set()};
  const hintIndex=hintedPoint?pointIndex(hintedPoint,size):-1;
  scene?.setInspection(inspection,{neighbors:adjacent,stones:info.stones,liberties:info.liberties,hintIndex});
  for(const [i,node] of sliceNodes){node.classList.toggle('inspected',i===index);node.classList.toggle('is-neighbor',adjacent.has(i));node.classList.toggle('in-group',info.stones.has(i));node.classList.toggle('is-liberty',info.liberties.has(i));node.classList.toggle('hint-point',i===hintIndex);}
  if(!inspection){$('inspect-title').textContent='在空间中探索一个点';$('inspect-description').textContent='悬停棋子或聚焦切层交叉点，查看三维邻点、整块棋子与全部气。';return;}
  const color=game.board[index],cross=neighbors(inspection,size).filter(point=>point[2]!==inspection[2]).length;
  $('inspect-title').textContent=`${coordinates(inspection)} · ${color?`${colorName(color)} ${info.stones.size} 子 · ${info.liberties.size} 气`:`空点 · ${adjacent.size} 邻点`}`;
  $('inspect-description').textContent=`${adjacent.size} 个邻点中有 ${cross} 个在上下层。${color?'整块同色棋子和全部气跨层一起计算。':'沿 x、y、z 走一步才相邻；对角线不相邻。'}`;
}
function playPoint(point) {
  if(busy||!state)return;
  const game=state.game;
  if(game.finished&&game.resigned!==null){setNotice('棋局已因认输结束。可以悔棋或开始新局。');return;}
  if(game.finished){if(!game.board[pointIndex(point,game.size)]){setNotice('数子阶段请点击棋子，将整块标记为死子；再点一次可恢复。');return;}action('dead',{point});}
  else if(state.mode==='ai'&&game.turn===2)setNotice('电脑执白，正在等待电脑落子。');
  else action('move',{point});
}
function setLayer(value) {
  layer=value;
  if(value!==null)focusedSlice=value;
  scene?.setLayer(value);syncLayerControls();
  if(state)renderSlice();
}

function confirmDialog(title,description,buttonText='确认') {
  const dialog=$('confirm-dialog');$('dialog-title').textContent=title;$('dialog-description').textContent=description;$('dialog-confirm').textContent=buttonText;
  return new Promise(resolve=>{dialog.returnValue='cancel';dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();});
}
async function replaceGame(name) {
  if(busy||!state)return;
  const size=Number($('size-select').value),mode=$('mode-select').value,komi=Number($('komi-input').value);
  if(name==='new'&&(!$('komi-input').value.trim()||!Number.isFinite(komi)||komi < -50||komi>50)){setNotice('贴目请输入 -50 到 50 之间的数字。',true);return;}
  if((state.game.move_number>0||state.game.finished)&&!(await confirmDialog(name==='demo'?'打开教学局面？':'开始新局？','当前棋局将被替换。可先保存棋局，以便稍后继续。',name==='demo'?'打开教学':'开始新局')))return;
  inspection=null;
  await action(name,name==='new'?{size,mode,komi}:{});
}
async function saveGame() {
  if(busy||!state)return;
  setBusy(true);
  try {
    const data=await readResponse(await fetch('/api/export'));
    const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`go3d-${state.game.size}x${state.game.size}-move${state.game.move_number}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice('棋局 JSON 已生成。可通过「读取棋局」恢复局面与规则历史。');
  }catch(error){setNotice(error.message,true);}finally{setBusy(false);renderStatus();}
}
async function loadGame(event) {
  const file=event.target.files[0];event.target.value='';
  if(!file||busy||!state)return;
  if(file.size>2000000){setNotice('存档超过 2,000,000 字节，无法读取。',true);return;}
  let data;
  try{data=JSON.parse(await file.text());}catch{setNotice('文件不是有效的 JSON 存档，当前棋局已保留。',true);return;}
  if((state.game.move_number>0||state.game.finished)&&!(await confirmDialog('读取保存的棋局？',`将用 ${file.name} 替换当前棋局。未保存的落子将丢失。`,'读取棋局')))return;
  setBusy(true);notice='';noticeError=false;renderStatus();
  try{const next=await readResponse(await fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,data})}));inspection=null;hintedPoint=null;applyState(next,{animate:false});setNotice('棋局已恢复，可以继续对弈。');}catch(error){setNotice(error.message,true);}finally{setBusy(false);renderStatus();}
}
function showSceneFallback(message) {
  window.go3d.sceneError=message;
  $('scene-panel').classList.add('is-fallback');$('scene-fallback').hidden=false;$('scene-stats').textContent='切层模式';
  $('scene-error').textContent='当前设备未能开启 3D 视图。仍可通过下方切层棋盘落子、提子和完成对弈。';
  for (const id of ['spacing-range','reset-view-button','auto-rotate']) $(id).disabled=true;
}
async function initializeScene() {
  try {
    const {BoardScene}=await import('./scene.js');
    scene=new BoardScene($('scene-host'),{
      onHover:point=>{const focused=document.activeElement?.dataset.point;inspectPoint(point||(focused?focused.split(',').map(Number):null));},
      onSelect:playPoint,
      onStats:stats=>{window.go3d.stats=stats;},
      onError:showSceneFallback,
    });
    window.go3d.scene=scene;
    if (scene.failed) return;
    scene.setSpacing(spacing);scene.setLayer(layer);scene.setAutoRotate(autoRotate);scene.setEnabled(!busy);
    if(state){scene.setGame(state.game,{animate:false});updateInspection();$('scene-stats').textContent=`${state.game.size**3} 格点 · 3D`;}
    else $('scene-stats').textContent='3D 已连接';
  }catch(error){showSceneFallback(error.message);}
}

$('layer-select').addEventListener('change',event=>setLayer(event.target.value==='all'?null:Number(event.target.value)));
$('slice-layer-select').addEventListener('change',event=>setLayer(Number(event.target.value)));
$('spacing-range').addEventListener('input',event=>{spacing=Number(event.target.value);$('spacing-value').textContent=`${spacing.toFixed(2)}×`;scene?.setSpacing(spacing);});
$('reset-view-button').addEventListener('click',()=>scene?.resetView());
$('auto-rotate').addEventListener('change',event=>{autoRotate=event.target.checked;scene?.setAutoRotate(autoRotate);});
$('territory-toggle').addEventListener('change',()=>renderSlice());
$('slice-board').addEventListener('pointerleave',()=>{const focused=document.activeElement?.dataset.point;inspectPoint(focused?focused.split(',').map(Number):null);});
$('pass-button').addEventListener('click',()=>action('pass'));$('undo-button').addEventListener('click',()=>action('undo'));$('hint-button').addEventListener('click',()=>action('hint'));$('resume-button').addEventListener('click',()=>action('resume'));
$('new-button').addEventListener('click',()=>replaceGame('new'));$('demo-button').addEventListener('click',()=>replaceGame('demo'));
$('resign-button').addEventListener('click',async()=>{if(state&&!busy&&await confirmDialog(`${colorName(state.game.turn)}认输？`,'认输会立即结束当前棋局，对方获胜。','确认认输'))action('resign');});
$('save-button').addEventListener('click',saveGame);$('load-button').addEventListener('click',()=>$('load-file').click());$('load-file').addEventListener('change',loadGame);
window.addEventListener('pagehide',()=>scene?.dispose(),{once:true});

async function initialize() {
  setBusy(true);
  try{applyState(await readResponse(await fetch('/api/state',{cache:'no-store'})),{animate:false});}catch(error){setNotice(error.message,true);}finally{setBusy(false);renderStatus();}
}
initialize();initializeScene();
