/* Flow scheduling is local to this task and does not change platform/Firebase rules. */
(()=>{
 const reasons=new Set(),delays=new Set();let pausedAt=0,resumeMusic=false;
 const flow=window.marketFlow={get paused(){return reasons.size>0},
 pause(reason){if(!reasons.size){pausedAt=Date.now();resumeMusic=!bgm.paused;if(resumeMusic)bgm.pause()}reasons.add(reason);document.getElementById('flow-pause').textContent='已暫停'},
 showResume(){if(!document.hidden&&!document.getElementById('help-overlay').classList.contains('show')&&!document.getElementById('history-drawer').classList.contains('open'))document.getElementById('pause-overlay').classList.add('show')},
 waitForResume(reason){reasons.delete(reason);if(!reasons.size)reasons.add('resume');flow.showResume()},
 resume(){if(document.hidden||reasons.has('help')||reasons.has('history')||reasons.has('dialog'))return;const elapsed=Date.now()-pausedAt;if(auctionState.pendingAiAt)auctionState.pendingAiAt+=elapsed;reasons.clear();for(const d of delays)d.last=performance.now();document.getElementById('pause-overlay').classList.remove('show');document.getElementById('flow-pause').textContent='暫停';if(resumeMusic)bgm.play().catch(()=>{});resumeMusic=false},
 delay(fn,ms){const d={left:ms,last:performance.now(),id:null};d.id=window.setInterval(()=>{const now=performance.now(),dt=now-d.last;d.last=now;if(flow.paused)return;d.left-=dt;if(d.left<=0){window.clearInterval(d.id);delays.delete(d);fn()}},25);delays.add(d);return d.id},
 reset(){for(const d of delays)window.clearInterval(d.id);delays.clear();clearInterval(auctionState.mainTimer);clearInterval(auctionState.aiTimer);clearInterval(auctionState.nextBoxTimer);auctionState.mainTimer=auctionState.aiTimer=auctionState.nextBoxTimer=null;reasons.clear();resumeMusic=false;document.getElementById('pause-overlay').classList.remove('show');document.getElementById('flow-pause').textContent='暫停';demoIncrement=1}
 };
 window.resumeFromPause=()=>flow.resume();
 document.getElementById('flow-pause').onclick=()=>{if(document.getElementById('intro-screen').style.display!=='none')return;flow.pause('manual');flow.showResume()};
 const watch=(id,cls,reason)=>{const el=document.getElementById(id);let was=el.classList.contains(cls);new MutationObserver(()=>{const active=el.classList.contains(cls);if(active===was)return;was=active;if(active)flow.pause(reason);else flow.waitForResume(reason)}).observe(el,{attributes:true,attributeFilter:['class']})};
 watch('help-overlay','show','help');watch('history-drawer','open','history');
 document.addEventListener('visibilitychange',()=>{if(document.hidden){if(document.getElementById('intro-screen').style.display==='none')flow.pause('background')}else if(reasons.has('background'))flow.waitForResume('background')});
 for(const name of ['taskAlert','taskConfirm']){const original=window[name];window[name]=async(...args)=>{flow.pause('dialog');try{return await original(...args)}finally{flow.waitForResume('dialog')}}}
 const originalBid=playerBid;playerBid=function(amount){if(flow.paused)return;originalBid(amount)};
 const originalPass=fastForwardAuction;fastForwardAuction=function(){if(flow.paused)return;originalPass()};
 const originalStart=startRoundAuction;startRoundAuction=function(){if(flow.paused||auctionState.currentBox?.status==='active')return;originalStart()};
 const originalFinal=showFinalResult;showFinalResult=function(){if(document.getElementById('final-result-screen').classList.contains('show'))return;originalFinal()};
 const oldSummary=updateInventorySummary;updateInventorySummary=function(){oldSummary();document.getElementById('flow-inventory').textContent=document.getElementById('ui-inventory-summary').textContent};
 const oldStage=setStageLabel;setStageLabel=function(text){oldStage(text);document.getElementById('flow-stage').textContent=text};
 const oldUpdate=updateAuctionUI;updateAuctionUI=function(){oldUpdate();const bidding=auctionState.phase==='bidding',lead=auctionState.highestBidderId==='player',price=auctionState.currentPrice+auctionState.bidStep*demoIncrement;const panel=document.querySelector('.arena-col-left');panel.classList.toggle('player-leading',lead);panel.classList.toggle('observe-phase',!bidding);const bid=document.getElementById('arena-btn-5');if(!bid.disabled&&price>gameState.budget){bid.disabled=true;bid.textContent='現金不足'}document.getElementById('flow-stage').textContent=!bidding?'觀察魚貨 · 倒數後開放出價':lead?'你目前領先 · 等待落槌':'競標中 · 出價後重新倒數 8 秒';document.getElementById('demo-phase').textContent=!bidding?'觀察魚貨':auctionState.timeLeft<=3?'即將落槌':'競標倒數';};
 const oldSetup=setupNextBox;setupNextBox=function(){demoIncrement=1;oldSetup()};
 document.getElementById('pause-overlay').querySelector('h3').insertAdjacentHTML('afterend','<p>倒數、對手出價與換箱流程已暫停。<br>按下繼續後才恢復。</p>');
 const prevNext=nextRound;nextRound=function(){if(flow.paused||!gameState.history.some(r=>r.round===gameState.round)||gameState.round>=TOTAL_ROUNDS)return;prevNext()};
 // Results may only settle once per season even if a delayed callback is repeated.
 const oldFinish=finishAuctionRound;finishAuctionRound=function(){if(gameState.history.some(r=>r.round===gameState.round))return;oldFinish()};
})();
// Keep buyer nodes stable: refreshing the timer must never restart a bid animation.
let buyerBidSequence=0;
function renderBuyerRow(){
 const row=document.getElementById('arena-ai-row');
 if(row.dataset.roster!==auctionState.aiStatus.map(a=>a.id).join(',')){
  row.dataset.roster=auctionState.aiStatus.map(a=>a.id).join(',');row.replaceChildren();
  for(const ai of auctionState.aiStatus){const chip=document.createElement('div');chip.dataset.buyerId=ai.id;chip.className='ai-chip';const clip=document.createElement('div');clip.className='ai-chip-clip';const img=document.createElement('img');img.className='ai-chip-avatar';img.src=DEMO_ASSETS.avatars[splitAiName(ai.name).label];img.alt=splitAiName(ai.name).label;clip.append(img);const name=document.createElement('span');name.className='ai-name';name.textContent=splitAiName(ai.name).label;const status=document.createElement('span');status.className='ai-status';chip.append(clip,name,status);row.append(chip)}
 }
 for(const ai of auctionState.aiStatus){const chip=[...row.children].find(e=>e.dataset.buyerId===ai.id);const leading=auctionState.highestBidderId===ai.id,cue=!!ai._bidCueActive&&auctionState.currentBox?.status==='active';chip.classList.toggle('out',!!ai.out);chip.classList.toggle('leader',leading);chip.classList.toggle('bid',cue);chip.classList.toggle('thinking',!cue&&!leading&&!ai.out&&ai.status.includes('思考中'));chip.querySelector('.ai-status').textContent=cue?'出價中':ai.out?'放棄':leading?'領先中':ai.status.includes('思考中')?'思考中':'觀望';let paddle=chip.querySelector('.ai-bid-paddle');if(cue){if(!paddle||paddle.dataset.sequence!==String(ai._bidCueSequence)){paddle?.remove();paddle=document.createElement('div');paddle.className='ai-bid-paddle';paddle.dataset.sequence=ai._bidCueSequence;paddle.textContent='＋$'+ai._bidCueAmount;chip.append(paddle)}}else paddle?.remove()}
}
const stableAiBid=aiBiddingStep;aiBiddingStep=function(){const before=auctionState.aiBidCount,price=auctionState.currentPrice,result=stableAiBid();if(auctionState.aiBidCount>before){const ai=auctionState.aiStatus.find(a=>a.id===auctionState.highestBidderId);if(ai){clearTimeout(ai._bubbleTimer);ai._bidCueActive=true;ai._bidCueAmount=auctionState.currentPrice-price;ai._bidCueSequence=++buyerBidSequence;const sequence=ai._bidCueSequence;marketFlow.delay(()=>{if(ai._bidCueSequence!==sequence)return;ai._bidCueActive=false;ai.status=ai.out?'放棄':auctionState.highestBidderId===ai.id?'領先中':'觀望';renderBuyerRow()},1100)}}return result};
renderBoard=function(){
 const board=document.getElementById('board-strip');board.replaceChildren();
 for(const box of gameState.todayBoxes){const article=document.createElement('article');article.className='strip-card '+box.status;const cavity=document.createElement('div');cavity.className='strip-cavity';const img=document.createElement('img');img.src=fishIcon(box.fish);img.alt=box.fish.name;cavity.append(img);const info=document.createElement('div');info.className='full-card-info';for(const[tag,value]of [['strong',box.fish.name],['span',box.qty+'尾・'+box.size+'cm'],['span',box.fish.methodName]]){const el=document.createElement(tag);el.textContent=value;info.append(el)}const status=document.createElement('div');status.className='lot-state';const buyer=box.status==='sold-player'?'你得標':box.status==='sold-other'?splitAiName(box.soldBy||'').label||'其他買家':box.status==='active'?'正在拍賣':box.status==='pending'?'等待拍賣':'流標';status.textContent=buyer+(box.soldPrice!=null?'｜'+box.soldPrice+' 元':'');status.title=status.textContent;article.append(cavity,info,status);board.append(article)}
};
