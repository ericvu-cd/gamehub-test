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
