/* ═════════════════════════════════════════════
   天氣海象 + 突發事件系統
   每次 welcome-screen 顯示時重新抽選一次

   ⚠️ 跨檔案依賴注意（重要）：
   本檔案用到的 weatherDB / eventDB / locationDB 定義在 db.js，漁港顯示用的
   shortName/name 現在也併在 db.js 的 locationDB 裡，透過 welcome-screen.js
   的 window.getHarborInfo() 讀取。但 index.html 裡 <script> 標籤的載入順序是：
       weather-event.js → welcome-screen.js → ... → db.js → main.js
   也就是本檔案「載入時」，這些變數其實都還不存在！
   之所以目前運作正常，是因為本檔案的函式（getPortIds()、
   window.rollAndApplyWeather()）都只在被「呼叫」的當下才去讀取這些變數
   （呼叫時機是玩家進到選港口畫面之後，那時候 db.js / welcome-screen.js
   早就載入完了）。rollAndApplyWeather() 內有針對 weatherDB/eventDB
   做 typeof 防呆，getPortIds() 對 locationDB、對 window.getHarborInfo()
   的呼叫也都有做防呆，但終究是靠「呼叫時機夠晚」保護，不是靠邏輯保護。
   → 請勿在頁面載入當下（script 執行的最外層）直接呼叫本檔案內的函式，
     一定要等使用者實際進入選港口流程後才會被觸發。
   → 若之後要調整 index.html 的 script 載入順序，務必連帶檢查這裡。

   ⚠️ window.playWeatherFx()（天氣特效，一次性播放不循環）也是同樣的
   「呼叫時機夠晚」保護：它讀取的 #ws-weather-fx 容器、.wsfx-* CSS
   class 都定義在 welcome-screen.js 注入的樣式/HTML 裡，由
   welcome-screen.js 自己在畫面顯示 5 秒後才呼叫，此時 welcome-screen.js
   當然早就載入完了。若之後 .wsfx-* 的 class 名稱或 #ws-weather-fx 的
   id 在 welcome-screen.js 那邊改名，這裡要同步修改。
   ═════════════════════════════════════════════ */
(function(){

	/* 漁港代碼清單：改為每次即時從 db.js 的 locationDB 組出來，不再另外寫死一份。
	   跟 rollAndApplyWeather() 一樣，只在被「呼叫」的當下才會讀 locationDB，
	   所以即使本檔案在 db.js 之前載入也不會出錯（見檔頭警語）。
	   之後 db.js 增減漁港，這裡完全不用同步修改。 */
	function getPortIds(){
		return (typeof locationDB !== 'undefined') ? locationDB.map(function(l){ return l.id; }) : [];
	}

	/* 依 weight 加權隨機抽 1 筆 */
	function weightedPick(arr){
		var total = arr.reduce(function(s,o){ return s + o.weight; }, 0);
		var r = Math.random() * total;
		for(var i=0;i<arr.length;i++){
			r -= arr[i].weight;
			if(r <= 0) return arr[i];
		}
		return arr[arr.length-1];
	}

	/* 主運算：回傳 { weather, event, portStatus:{id:true/false}, closedByEvent:{id:eventName} } */
	function rollWeatherAndEvents(){
		var weather = weightedPick(weatherDB);

		/* 1. 依天氣機率，每港獨立丟骰 */
		var portIds = getPortIds();
		var portStatus = {};
		portIds.forEach(function(id){
			var chance = (weather.ports && weather.ports[id] != null) ? weather.ports[id] : 100;
			portStatus[id] = (Math.random() * 100 < chance);
		});

		/* 2. 判定是否觸發事件 */
		var event = null;
		var closedByEvent = {};
		var triggered = Math.random() * 100 < (weather.eventChance || 0);
		if(triggered && typeof eventDB !== 'undefined' && eventDB.length){
			event = weightedPick(eventDB);
			/* 收集所有標 "pick" 的候選港口（無論天氣判定是否已關閉，pick 候選池都看事件表本身） */
			var candidates = portIds.filter(function(id){
				return event.ports && event.ports[id] === 'pick';
			});
			if(candidates.length){
				var chosen = candidates[Math.floor(Math.random() * candidates.length)];
				portStatus[chosen] = false;
				closedByEvent[chosen] = event.name;
			}
		}

		return { weather: weather, event: event, portStatus: portStatus, closedByEvent: closedByEvent };
	}

	/* 套用結果到 DOM */
	function applyWeatherToUI(result){
		window._wsWeatherResult = result;

		/* 天氣卡片：只顯示當天天氣名稱 */
		var wBox = document.getElementById('ws-weather-box');
		var wName = document.getElementById('ws-weather-name');
		if(wName) wName.textContent = result.weather.name;
		if(wBox) requestAnimationFrame(function(){ wBox.classList.add('show'); });

		/* 港口開放/關閉：只變暗，不疊加圖示 */
		/* info 來源改呼叫 welcome-screen.js 的 window.getHarborInfo()（依 db.js locationDB
		   即時組出），而不是直接讀一份靜態物件；呼叫時機一樣晚（見檔頭警語），
		   所以跟 locationDB 尚未載入完成無關。 */
		var harborInfo = (typeof window.getHarborInfo === 'function') ? window.getHarborInfo() : {};
		var closedList = [];
		getPortIds().forEach(function(id){
			var el = document.getElementById('wsh-'+id);
			if(!el) return;
			var isOpen = result.portStatus[id];
			el.classList.toggle('ws-closed', !isOpen);
			if(!isOpen){
				var info = harborInfo[id] || {};
				var reason = result.closedByEvent[id] || result.weather.name;
				closedList.push((info.shortName || info.name || id) + '（' + reason + '）');
			}
		});

		/* 右下角面板提示：開場時列出所有封港原因
		   （玩家點選任一漁港後，此提示會被面板內容取代，消失即可，無需另外處理） */
		var hint = document.getElementById('ws-panel-hint');
		if(hint){
			if(closedList.length){
				hint.innerHTML = '⚓ 今日封港：<br>' + closedList.join('<br>');
			} else {
				hint.innerHTML = '👆 點選地圖上<br>的漁港出發';
			}
		}

		/* 若先前選的港口這次被關閉，清除選擇並提示 */
		if(window.selectedLocationId && result.portStatus[window.selectedLocationId] === false){
			window.selectedLocationId = null;
			sessionStorage.removeItem('selectedLocationId');
			document.querySelectorAll('.ws-harbor').forEach(function(el){ el.classList.remove('ws-selected'); });
			var content = document.getElementById('ws-panel-content');
			if(hint) hint.style.display = 'block';
			if(content) content.style.display = 'none';
			wsShowToast('⚠️ 原出發漁港今日封港，請重新選擇');
		}
	}

	window.rollAndApplyWeather = function(){
		if(typeof weatherDB === 'undefined' || typeof eventDB === 'undefined'){
			return; /* db.js 尚未載入或不存在，略過 */
		}
		var result = rollWeatherAndEvents();
		applyWeatherToUI(result);
	};

	/* ══════════════════════════════════════════════════════════
	   天氣特效（一次性播放，不循環）
	   由 welcome-screen.js 在進入畫面 5 秒後呼叫一次，播放 welcome-screen.js
	   注入的 CSS 裡定義好的 .wsfx-* 動畫。全部都是「forwards 定格」或
	   「播完自己歸零」的一次性 CSS 動畫，這裡只負責生成/擺放元素，不維持
	   任何 JS 計時迴圈；播放完之後畫面上不會再有東西持續耗效能。
	   cloudy（多雲微浪）、cold_front（寒流來襲）刻意不套用任何特效。
	   ══════════════════════════════════════════════════════════ */
	function rand(min, max){ return min + Math.random() * (max - min); }

	/* 加一層滿版環境效果（陽光/霧/警戒色），元素本身用 forwards 定格，
	   不用清理，下次呼叫 playWeatherFx() 時開頭的 fx.innerHTML='' 會一起清掉 */
	function fxAddLayer(container, cls){
		var el = document.createElement('div');
		el.className = cls;
		container.appendChild(el);
		return el;
	}

	/* 星光粒子（sunny 專用）：閃一下自己淡出，動畫結束就從 DOM 移除保持整潔。
	   xRange/yRange 可指定散佈範圍（% ），預設整個畫面；sunny 會傳入
	   偏太陽錨點附近的範圍，讓星光看起來像被陽光照到反光，而不是隨機screen dust。 */
	function fxSpawnSparkles(container, n, xRange, yRange){
		xRange = xRange || [5, 95];
		yRange = yRange || [5, 60];
		for(var i = 0; i < n; i++){
			var s = document.createElement('div');
			s.className = 'wsfx-sparkle';
			s.style.setProperty('--x', rand(xRange[0], xRange[1]).toFixed(1) + '%');
			s.style.setProperty('--y', rand(yRange[0], yRange[1]).toFixed(1) + '%');
			s.style.setProperty('--delay', rand(0, 1.2).toFixed(2) + 's');
			s.addEventListener('animationend', function(){ this.remove(); }, { once:true });
			container.appendChild(s);
		}
	}

	/* 光柱（sunny 專用）：從太陽錨點（跟 .wsfx-sun-glow 同一個 left:92% top:8% 錨點）
	   往畫面內以不同角度「長出來」，模擬光線灑落進畫面的方向感。
	   angleFrom/angleTo 定義扇形範圍（單位：deg，CSS rotate 的角度，順時針），
	   錨點在右上角，所以角度要指向左下方（目前 sunny 用的是 100°~190°）才會朝畫面內灑。 */
	function fxSpawnSunBeams(container, n, angleFrom, angleTo){
		for(var i = 0; i < n; i++){
			var t = n > 1 ? i / (n - 1) : 0.5;
			var angle = angleFrom + (angleTo - angleFrom) * t + rand(-5, 5); // 均勻分布 + 一點 jitter，避免太規律死板
			var b = document.createElement('div');
			b.className = 'wsfx-sun-beam';
			b.style.setProperty('--angle', angle.toFixed(1) + 'deg');
			b.style.setProperty('--delay', rand(0, 0.5).toFixed(2) + 's');
			container.appendChild(b); // 光柱是環境層（forwards 定格），不用 animationend 清理
		}
	}

	/* 風線（季風／颱風共用）：一次橫掃過畫面就消失。
	   gustCount 是「陣風」的數量，每陣風實際上是 2 條 y 位置、延遲都
	   稍微錯開的 .wsfx-wind（每個 .wsfx-wind 自己又用 ::before/::after
	   疊出雙線頭粗尾細的造型，見 welcome-screen.js 的 CSS），
	   一陣風＝4 條線疊在一起，比單一條細線更有「一陣風掃過去」的份量感。 */
	function fxSpawnWind(container, gustCount, fast){
		for(var i = 0; i < gustCount; i++){
			var y = rand(10, 82);
			var dur = rand(fast ? 0.8 : 1.1, fast ? 1.2 : 1.7).toFixed(2) + 's';
			var baseDelay = rand(0, fast ? 0.8 : 1.5);
			for(var j = 0; j < 2; j++){
				var w = document.createElement('div');
				w.className = 'wsfx-wind';
				w.style.setProperty('--y', (y + j * rand(1.5, 3.2)).toFixed(1) + '%');
				w.style.setProperty('--dur', dur);
				w.style.setProperty('--delay', (baseDelay + j * 0.08).toFixed(2) + 's');
				w.addEventListener('animationend', function(){ this.remove(); }, { once:true });
				container.appendChild(w);
			}
		}
	}

	/* 雨滴（暴雨／颱風共用）：一次落下就消失 */
	function fxSpawnRain(container, n, fast){
		for(var i = 0; i < n; i++){
			var r = document.createElement('div');
			r.className = 'wsfx-rain-drop';
			r.style.setProperty('--x', rand(0, 100).toFixed(1) + '%');
			r.style.setProperty('--dur', rand(fast ? 0.55 : 0.8, fast ? 0.85 : 1.3).toFixed(2) + 's');
			r.style.setProperty('--delay', rand(0, fast ? 1.0 : 1.8).toFixed(2) + 's');
			r.addEventListener('animationend', function(){ this.remove(); }, { once:true });
			container.appendChild(r);
		}
	}

	/* 播放當日天氣對應的一次性特效；weatherId 對不到任何 case（例如
	   cloudy／cold_front）就什麼都不做，維持原本畫面。 */
	window.playWeatherFx = function(weatherId){
		var fx = document.getElementById('ws-weather-fx');
		if(!fx) return;
		fx.innerHTML = ''; /* 保險：避免上一次還沒清乾淨就疊播 */

		if(weatherId === 'sunny'){
			fxAddLayer(fx, 'wsfx-sun-glow');
			fxSpawnSunBeams(fx, 7, 100, 190);           // 從右上角錨點往左下方扇形灑出 7 條光柱
			fxSpawnSparkles(fx, 8, [42, 98], [2, 42]);  // 星光集中在太陽附近，像反光，不是滿畫面亂飄

		} else if(weatherId === 'ne_monsoon' || weatherId === 'sw_flow'){
			fxSpawnWind(fx, 5, false);                  // 5 陣風 × 4 條線 = 20 條線

		} else if(weatherId === 'fog'){
			fxAddLayer(fx, 'wsfx-fog');

		} else if(weatherId === 'rainstorm'){
			fxSpawnRain(fx, 26, false);

		} else if(typeof weatherId === 'string' && weatherId.indexOf('typhoon') === 0){
			/* typhoon_east / typhoon_cross / typhoon_south 共用：暴雨＋強風，
			   單純用「雨更急、風更密」表現颱風的強度，不額外疊警戒色暈影、
			   也不讓地圖跟著搖晃（依需求已移除這兩個效果）。 */
			fxSpawnRain(fx, 40, true);
			fxSpawnWind(fx, 7, true);                   // 7 陣風 × 4 條線 = 28 條線，比季風密
		}
		/* cloudy／cold_front／其他未列出的天氣：不套用任何特效 */
	};

})();
