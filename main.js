import { PageFlip } from "https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.module.js";
import { API, MODE_NAME, IS_DEVELOPMENT } from './config.js';
const DEFAULT_ITEM_IMG = 'img/item.png';
const DEFAULT_CATEGORY_IMG = 'img/category.png'; // 필요 시 species별 맵핑에 활용

let wallet = null;
let flip;
const apiLimit = 24;            // /entries limit
let cardsPerPageView = 4;       // 동적으로 계산될 값

// 페이지 높이에 맞는 카드 개수 계산
function calculateCardsPerPage(availableHeight) {
  const cardHeight = 80 + 10 + 12; // 카드 높이(80px) + 패딩(10px*2) + 간격(12px)
  const pageContentHeight = availableHeight - 40; // 페이지 패딩(20px*2) 제외
  const cardsPerSinglePage = Math.floor(pageContentHeight / cardHeight);
  
  // 최소 1개, 최대 10개로 제한
  const safeCardsPerPage = Math.max(1, Math.min(10, cardsPerSinglePage));
  
  console.log(`[Layout] Page height: ${availableHeight}px, cards per page: ${safeCardsPerPage}`);
  
  // 좌우 두 페이지이므로 2배
  return safeCardsPerPage * 2;
}

let currentSpecies = '';
let currentQuery = '';
let currentApiPage = 1;
let totalItems = 0;
let rowsAccum = [];

// DOM 요소들을 함수로 매번 새로 찾기 (로그인 시 DOM 재구성 대응)
function getBookEl() { return document.getElementById('book'); }
function getThumbsEl() { return document.getElementById('thumbs'); }
function getSpeciesListEl() { return document.getElementById('speciesList'); }
function getConnectBtn() { return document.getElementById('connectBtn'); }
function getAddrEl() { return document.getElementById('addr'); }

// DOM 요소가 준비될 때까지 대기하는 헬퍼 함수
async function waitForElement(selector, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const element = typeof selector === 'function' ? selector() : document.querySelector(selector);
    if (element) {
      console.log(`[DOM] Found element after ${i + 1} attempts`);
      return element;
    }
    console.warn(`[DOM] Element not found, attempt ${i + 1}/${maxAttempts}`);
    await new Promise(resolve => setTimeout(resolve, 200)); // 200ms 대기
  }
  throw new Error(`Element not found after ${maxAttempts} attempts`);
}

// 안전한 DOM 요소 찾기 (실패해도 계속 진행)
async function safeWaitForElement(selector, maxAttempts = 5) {
  try {
    return await waitForElement(selector, maxAttempts);
  } catch (e) {
    console.warn(`[DOM] Safe wait failed for element:`, e.message);
    return null;
  }
}

// ---- Phantom 연결 ----
getConnectBtn().addEventListener('click', async () => {
  const p = window.solana;
  if (!p || !p.isPhantom) { alert('Phantom 지갑을 설치해 주세요.'); return; }
  
  if (wallet) {
    // 이미 연결된 경우 - 연결 해제
    try {
      await p.disconnect();
      wallet = null;
      localStorage.removeItem('connectedWallet');
      getAddrEl().textContent = '';
      connectBtn.textContent = 'Connect Wallet';
      console.log('[Wallet] Disconnected');
      await updateOwnershipStatus(); // 소유 상태만 업데이트
    } catch (error) {
      console.error('[Wallet] Disconnect failed:', error);
    }
  } else {
    // 연결되지 않은 경우 - 연결
    try {
      const resp = await p.connect();
      wallet = resp.publicKey.toString();
      localStorage.setItem('connectedWallet', wallet);
      getAddrEl().textContent = wallet.slice(0,4)+'...'+wallet.slice(-4);
      connectBtn.textContent = 'Disconnect';
      console.log('[Wallet] Connected:', wallet);
      await updateOwnershipStatus(); // 소유 상태만 업데이트
    } catch (error) {
      console.error('[Wallet] Connection failed:', error);
    }
  }
});

if (window.solana?.on) {
  window.solana.on('accountChanged', async (pk)=>{
    const newWallet = pk ? pk.toString() : null;
    if (newWallet !== wallet) {
      wallet = newWallet;
      getAddrEl().textContent = wallet ? (wallet.slice(0,4)+'...'+wallet.slice(-4)) : '';
      connectBtn.textContent = wallet ? 'Disconnect' : 'Connect Wallet';
      console.log('[Wallet] Account changed:', wallet);
      await updateOwnershipStatus(); // 소유 상태만 업데이트
    }
  });
}

// ---- 소유 상태 업데이트 ----
async function updateOwnershipStatus() {
  console.log('[App] Updating ownership status only...');
  
  // 현재 표시된 모든 entry 요소들의 소유 상태만 업데이트
  const entries = document.querySelectorAll('.entry');
  
  if (entries.length === 0) {
    console.log('[App] No entries found, skipping ownership update');
    return;
  }
  
  // 각 entry의 asset_id를 수집하여 API로 소유 상태 확인
  const assetIds = Array.from(entries).map(entry => entry.dataset.assetId).filter(Boolean);
  
  if (assetIds.length === 0) {
    console.log('[App] No asset IDs found, skipping ownership update');
    return;
  }
  
  console.log(`[App] Checking ownership for ${assetIds.length} items`);
  
  // API에서 소유 상태만 가져오기 (기존 데이터 재사용)
  try {
    const params = new URLSearchParams({ 
      limit: assetIds.length,
      owner: wallet || ''  // 백엔드 API는 owner 파라미터 사용
    });
    
    const response = await fetch(`${API}/entries?${params}`);
    const data = await response.json();
    
    console.log('[App] API response structure:', { 
      hasItems: !!data.items, 
      hasRows: !!data.rows,
      dataKeys: Object.keys(data),
      dataType: typeof data
    });
    
    // API 응답 구조 확인 및 처리 (entries API는 rows 필드를 사용)
    const items = data.items || data.rows || [];
    
    if (!Array.isArray(items)) {
      console.error('[App] API response items is not array:', items);
      return;
    }
    
    // 소유 상태에 따라 CSS 클래스만 업데이트
    entries.forEach(entry => {
      const assetId = entry.dataset.assetId;
      const item = items.find(i => i.asset_id === assetId);
      
      if (item) {
        entry.className = 'entry ' + (
          !wallet ? 'not-logged-in' : 
          item.owned ? 'owned' : 'unowned'
        );
      }
    });
    
    console.log('[App] Ownership status updated');
    
  } catch (error) {
    console.error('[App] Failed to update ownership status:', error);
  }
}

// ---- API ----
async function fetchSpecies() {
  try {
    console.log('[API] Fetching species...');
    const r = await fetch(`${API}/species`, { cache: 'no-cache' });
    if (!r.ok) {
      throw new Error(`Species API failed: ${r.status} ${r.statusText}`);
    }
    const data = await r.json();
    console.log('[API] Species loaded:', data.length);
    return data;
  } catch (error) {
    console.error('[API] fetchSpecies failed:', error);
    return []; // 빈 배열 반환으로 앱이 계속 동작하도록 함
  }
}

async function fetchEntriesPage(page=1) {
  try {
    console.log(`[API] Fetching entries page ${page}...`);
    const u = new URL(`${API}/entries`);
    if (currentSpecies) u.searchParams.set('species', currentSpecies);
    if (currentQuery)   u.searchParams.set('q', currentQuery);
    if (wallet)         u.searchParams.set('owner', wallet);
    u.searchParams.set('page', String(page));
    u.searchParams.set('limit', String(apiLimit));
    
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) {
      throw new Error(`Entries API failed: ${r.status} ${r.statusText}`);
    }
    const data = await r.json();
    console.log(`[API] Entries page ${page} loaded:`, data.rows?.length || 0, 'items');
    return data; // { page, limit, total, rows }
  } catch (error) {
    console.error('[API] fetchEntriesPage failed:', error);
    throw error; // 이 오류는 상위에서 처리
  }
}

// ---- 렌더 ----
function h(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

function entryCard(item){
  const src = item.image_url ? `${API}/img-proxy?url=${encodeURIComponent(item.image_url)}` : DEFAULT_ITEM_IMG;
  
  // 로그인 상태별 스타일 결정
  let cardClass = 'entry';
  if (!wallet) {
    // 로그인하지 않은 경우 - 모두 흑백
    cardClass += ' not-logged-in';
  } else if (item.owned) {
    // 로그인했고 소유한 경우 - 컬러
    cardClass += ' owned';
  } else {
    // 로그인했지만 소유하지 않은 경우 - 흑백
    cardClass += ' unowned';
  }
  
  // 소유한 에디션 개수 정보
  const editionInfo = item.asset_ids ? `(${item.asset_ids.length} editions)` : '';
  
  return `
    <article class="${cardClass}" data-asset-id="${h(item.asset_id)}" data-species="${h(item.species || '')}">
      <div class="imgbox">
        <img loading="lazy" decoding="async"
             src="${src}"
             onerror="this.onerror=null;this.src='${DEFAULT_ITEM_IMG}'"
             alt="${h(item.name||'NFT')}"/>
      </div>
      <div class="meta">
        <div class="name">${h(item.name||'Untitled')}</div>
        <div class="species">${h(item.species || 'Unknown')} ${editionInfo}</div>
        ${!wallet ? '<div class="login-hint">Connect wallet to see ownership</div>' : ''}
      </div>
    </article>
  `;
}

function buildPagesFromRows(rows){
  const frag = document.createDocumentFragment();
  
  // 한 면당 카드 개수 계산 (전체의 절반)
  const cardsPerSinglePage = cardsPerPageView / 2;
  
  // 두 페이지씩 묶어서 처리 (좌우 펼침)
  for (let i=0; i<rows.length; i+=cardsPerPageView) {
    const chunk = rows.slice(i, i+cardsPerPageView);
    
    // 좌측 페이지 (항상 생성)
    const leftPageCards = chunk.slice(0, cardsPerSinglePage);
    const leftPage = document.createElement('div');
    leftPage.className = 'page';
    leftPage.innerHTML = `<div class="grid">${leftPageCards.map(entryCard).join('')}</div>`;
    frag.appendChild(leftPage);
    
    // 우측 페이지 (항상 생성 - 비어있어도 빈 페이지로)
    const rightPageCards = chunk.slice(cardsPerSinglePage, cardsPerPageView);
    const rightPage = document.createElement('div');
    rightPage.className = 'page';
    rightPage.innerHTML = `<div class="grid">${rightPageCards.map(entryCard).join('')}</div>`;
    frag.appendChild(rightPage);
  }
  
  // 최소 2개 페이지 보장 (두 페이지 모드 강제)
  if (frag.children.length < 2) {
    while (frag.children.length < 2) {
      const emptyPage = document.createElement('div');
      emptyPage.className = 'page';
      emptyPage.innerHTML = '<div class="grid"></div>';
      frag.appendChild(emptyPage);
    }
  }
  
  console.log(`[PageFlip] Generated ${frag.children.length} pages (min 2 for landscape mode)`);
  return frag;
}

function renderThumbs(){
  getThumbsEl().innerHTML = '';
  const pageCount = Math.ceil(rowsAccum.length / cardsPerPageView);
  for (let i=0;i<pageCount;i++){
    const b = document.createElement('button'); b.className='thumb'; b.textContent = `P${i+1}`;
    b.onclick = ()=> flip?.flip(i);
    getThumbsEl().appendChild(b);
  }
}

// ---- 초기화 & 무한 로드 ----
async function resetAndInit(){
  // 리더보드 뷰에 있을 때는 초기화하지 않음
  if (currentView === 'leaderboard') {
    console.log('[App] Skipping initialization - currently in leaderboard view');
    return;
  }

  try {
    console.log('[App] Initializing...');
    
    // 기존 observer 정리
    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }
    
    currentApiPage = 1;
    rowsAccum = [];
    isLoadingMore = false;

    // species 사이드바
    const sps = await fetchSpecies();
    getSpeciesListEl().innerHTML = '';
    // "All" 항목 추가(옵션)
    const all = document.createElement('div');
    all.className = 'species-item';
    all.textContent = `All`;
    all.onclick = async ()=>{ currentSpecies=''; await resetAndInit(); };
    getSpeciesListEl().appendChild(all);

    sps.forEach((s)=>{
      const item = document.createElement('div');
      item.className = 'species-item';
      item.textContent = `${s.species} (${s.cnt})`;
      item.onclick = async ()=>{
        currentSpecies = s.species === 'All' ? '' : s.species;
        await resetAndInit();
      };
      getSpeciesListEl().appendChild(item);
    });

    // 첫 페이지 (DOM 렌더링 완료 후)
    setTimeout(async () => {
      try {
        await loadInitialPage();
        console.log('[App] Initialization complete');
      } catch (error) {
        console.error('[App] Delayed initialization failed:', error);
        // 재시도
        setTimeout(async () => {
          try {
            await loadInitialPage();
            console.log('[App] Retry initialization complete');
          } catch (retryError) {
            console.error('[App] Retry failed:', retryError);
          }
        }, 500);
      }
    }, 100);
    // TODO: 무한 로딩 문제 해결 후 활성화
    // observeForMore();
  } catch (error) {
    console.error('[App] Initialization failed:', error);
    // 오류 발생 시 기본 화면 표시
    getBookEl().innerHTML = `
      <div class="page" style="display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center; color:#666;">
          <div style="font-weight:700; margin-bottom:6px;">초기화 중 오류가 발생했습니다</div>
          <div style="font-size:13px;">서버 연결을 확인하고 페이지를 새로고침해 주세요.</div>
          <div style="font-size:12px; margin-top:8px; color:#999;">Error: ${error.message}</div>
        </div>
      </div>`;
  }
}

// 중복 아이템 제거 및 소유 여부 통합
function deduplicateAndMergeOwnership(items) {
  const uniqueItems = new Map();
  
  for (const item of items) {
    // name + image_url을 기준으로 중복 판단
    const key = `${item.name}::${item.image_url}`;
    
    if (uniqueItems.has(key)) {
      // 이미 존재하는 경우, 소유 여부만 업데이트 (하나라도 owned면 true)
      const existing = uniqueItems.get(key);
      existing.owned = existing.owned || item.owned;
      // asset_id 목록도 유지
      if (!existing.asset_ids) existing.asset_ids = [existing.asset_id];
      existing.asset_ids.push(item.asset_id);
    } else {
      // 새로운 아이템 추가
      const uniqueItem = { ...item };
      uniqueItem.asset_ids = [item.asset_id]; // 모든 asset_id 저장
      uniqueItems.set(key, uniqueItem);
    }
  }
  
  const result = Array.from(uniqueItems.values());
  console.log(`[Dedup] Original: ${items.length}, Unique: ${result.length}`);
  return result;
}

// 첫 페이지 로드 (전체 재생성)
async function loadInitialPage(){
  try {
    console.log(`[App] Loading initial page...`);
    const response = await fetchEntriesPage(currentApiPage);
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid API response');
    }
    
    const { rows = [], total = 0 } = response;
    totalItems = total;
    
    // 중복 제거 및 소유 여부 통합
    const uniqueRows = deduplicateAndMergeOwnership(rows);
    rowsAccum = uniqueRows;
    
    console.log(`[App] Loaded ${rows.length} raw items, ${uniqueRows.length} unique items`);

    // DOM 요소 안전하게 대기해서 찾기
    const bookEl = await safeWaitForElement(getBookEl);
    const thumbsEl = await safeWaitForElement(getThumbsEl);
    
    if (!bookEl) {
      console.error('[App] Could not find book element, aborting initialization');
      return;
    }
    
    console.log(`[DOM] Successfully found book and thumbs elements`);

    // 빈 상태 처리
    if (rowsAccum.length === 0) {
      bookEl.innerHTML = `
        <div class="page" style="display:flex;align-items:center;justify-content:center;">
          <div style="text-align:center; color:#666;">
            <div style="font-weight:700; margin-bottom:6px;">표시할 아이템이 없습니다</div>
            <div style="font-size:13px;">컬렉션 동기화를 기다리거나 Species/검색 필터를 초기화해 보세요.</div>
          </div>
        </div>`;
      if (thumbsEl) thumbsEl.innerHTML = '';
      return;
    }

    // PageFlip 초기화
    if (flip) {
      try { 
        flip.destroy(); 
      } catch(e) { 
        console.warn('[App] PageFlip destroy warning:', e); 
      }
    }
    
    bookEl.innerHTML = '';
    
    // PageFlip 대신 기본 두 페이지 레이아웃 직접 구현
    console.log('[App] PageFlip 건너뛰고 기본 레이아웃 사용');
    
    const cardsPerPage = Math.floor(cardsPerPageView / 2);
    
    // 첫 번째 페이지 (좌측)
    const leftPage = document.createElement('div');
    leftPage.className = 'page';
    leftPage.innerHTML = `<div class="grid">${rowsAccum.slice(0, cardsPerPage).map(entryCard).join('')}</div>`;
    bookEl.appendChild(leftPage);
    
    // 두 번째 페이지 (우측)
    const rightPage = document.createElement('div');
    rightPage.className = 'page';
    rightPage.innerHTML = `<div class="grid">${rowsAccum.slice(cardsPerPage, cardsPerPageView).map(entryCard).join('')}</div>`;
    bookEl.appendChild(rightPage);
    
    // Flexbox 기본 레이아웃 적용
    bookEl.style.cssText = `
      display: flex !important;
      flex-direction: row !important;
      width: 100% !important;
      height: 100% !important;
      gap: 20px !important;
    `;
    
    // 각 페이지 스타일링
    const pages = bookEl.querySelectorAll('.page');
    pages.forEach((page) => {
      page.style.cssText = `
        flex: 1 !important;
        width: calc(50% - 10px) !important;
        height: 100% !important;
        background: #fff !important;
        border: 1px solid #e8e2d7 !important;
        box-shadow: 0 6px 30px rgba(0,0,0,0.08) !important;
        padding: 20px !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      `;
    });
    
    console.log(`[App] 기본 두 페이지 레이아웃 적용: ${pages.length}개 페이지`);
    
    // PageFlip 관련 코드는 모두 건너뛰기
    /*
    // PageFlip 초기화 시도
    try {
      // 컨테이너의 실제 크기 계산 (더 안정적인 방법)
      let bookWrap = bookEl.parentElement;
      
      // parentElement가 없거나 잘못된 경우 재찾기
      if (!bookWrap || !bookWrap.classList.contains('book-wrap')) {
        bookWrap = document.querySelector('.book-wrap');
        // bookEl이 올바른 부모에 있는지 확인
        if (bookWrap && !bookWrap.contains(bookEl)) {
          // DOM 구조 문제가 있다면 리프레시 필요할 수 있음
        }
      }
      
      if (!bookWrap) {
        throw new Error('[PageFlip] Book wrap container not found in DOM');
      }
      
      // 컨테이너가 렌더링될 때까지 대기
      let attempts = 0;
      while ((bookWrap.clientWidth === 0 || bookWrap.clientHeight === 0) && attempts < 3) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (bookWrap.clientWidth === 0 || bookWrap.clientHeight === 0) {
        var availableWidth = window.innerWidth - 100;
        var availableHeight = window.innerHeight - 200;
      } else {
        var availableWidth = bookWrap.clientWidth;
        var availableHeight = bookWrap.clientHeight;
      }
      
      // PageFlip에는 전체 너비를 전달 (landscape 두 페이지 모드)
      const pageWidth = availableWidth; // 전체 너비를 PageFlip에 전달
      const pageHeight = availableHeight;
      
      // 페이지 높이에 맞는 카드 개수 계산
      cardsPerPageView = calculateCardsPerPage(availableHeight);
      
      // PageFlip 초기화 (필수 설정만 사용)
      console.log(`[PageFlip] 초기화: ${pageWidth}x${pageHeight} (Available: ${availableWidth}x${availableHeight})`);
      
      flip = new PageFlip(bookEl, {
        width: pageWidth,
        height: pageHeight,
        size: 'fixed',
        showCover: false,
        usePortrait: false, // landscape 모드 강제
        autoSize: false,
        startPage: 0,
        drawShadow: true,
        flippingTime: 1000,
        useMouseEvents: true
      });
      
      const initialPages = bookEl.querySelectorAll('.page');
      
      try {
        flip.loadFromHTML(initialPages);
        
        // 초기 DOM 생성 확인
        setTimeout(() => {
          const stfParent = bookEl.querySelector('.stf__parent');
          const stfItems = bookEl.querySelectorAll('.stf__item');
          console.log(`[PageFlip] 초기 DOM 생성: Parent=${!!stfParent}, Items=${stfItems.length}`);
          if (stfParent) {
            console.log(`[PageFlip] 초기 크기: ${stfParent.offsetWidth}x${stfParent.offsetHeight}`);
          }
        }, 100);
        
      } catch (error) {
        console.error(`[PageFlip] 초기 로딩 실패:`, error);
      }
      
      // PageFlip DOM 생성 확인을 더 빨리, 더 자주 체크
      const checkPageFlipDOM = () => {
        const stfParent = bookEl.querySelector('.stf__parent');
        
        if (!stfParent) {
          console.warn('[PageFlip] DOM 생성 실패, 기본 레이아웃으로 대체');
          
          // PageFlip 제거
          if (flip) {
            flip.destroy();
            flip = null;
          }
          
          // bookEl 비우고 페이지를 다시 생성 (현재 변수 스코프에서 접근 가능)
          bookEl.innerHTML = '';
          
          // 한 페이지당 카드 수 계산 (전체의 절반)
          const cardsPerPage = Math.floor(cardsPerPageView / 2);
          
          // 첫 번째 페이지 생성 (좌측)
          const leftPage = document.createElement('div');
          leftPage.className = 'page';
          leftPage.innerHTML = `<div class="grid">${rowsAccum.slice(0, cardsPerPage).map(entryCard).join('')}</div>`;
          bookEl.appendChild(leftPage);
          
          // 두 번째 페이지 생성 (우측) 
          const rightPage = document.createElement('div');
          rightPage.className = 'page';
          rightPage.innerHTML = `<div class="grid">${rowsAccum.slice(cardsPerPage, cardsPerPageView).map(entryCard).join('')}</div>`;
          bookEl.appendChild(rightPage);
          
          // 기본 두 페이지 레이아웃 적용
          bookEl.style.cssText = `
            display: flex !important;
            flex-direction: row !important;
            width: 100% !important;
            height: 100% !important;
            gap: 20px !important;
          `;
          
          const pages = bookEl.querySelectorAll('.page');
          pages.forEach((page, index) => {
            page.style.cssText = `
              flex: 1 !important;
              width: calc(50% - 10px) !important;
              height: 100% !important;
              background: #fff !important;
              border: 1px solid #e8e2d7 !important;
              box-shadow: 0 6px 30px rgba(0,0,0,0.08) !important;
              padding: 20px !important;
              box-sizing: border-box !important;
              overflow: hidden !important;
            `;
          });
          
          console.log(`[PageFlip] 기본 레이아웃 적용: ${pages.length}개 페이지`);
        } else {
          console.log(`[PageFlip] 정상 작동: ${stfParent.offsetWidth}x${stfParent.offsetHeight}`);
        }
      };
      
      // 여러 시점에서 체크 (10ms, 50ms, 100ms, 200ms)
      setTimeout(checkPageFlipDOM, 10);
      setTimeout(() => {
        const stfParent = bookEl.querySelector('.stf__parent');
        if (!stfParent) {
          checkPageFlipDOM();
        }
      }, 50);
      setTimeout(() => {
        const stfParent = bookEl.querySelector('.stf__parent');
        if (!stfParent) {
          checkPageFlipDOM();
        }
      }, 100);
      
      const navPrev = document.querySelector('.nav-prev');
      const navNext = document.querySelector('.nav-next');
      
      // PageFlip이 있으면 PageFlip 네비게이션 사용, 없으면 기본 네비게이션
      if (navPrev) navPrev.onclick = () => {
        if (flip) {
          flip.flipPrev();
        } else {
          // 기본 레이아웃에서는 페이지 스크롤 (향후 구현 가능)
          console.log('[Nav] Previous page (basic layout)');
        }
      };
      
      if (navNext) navNext.onclick = () => {
        if (flip) {
          flip.flipNext();
        } else {
          // 기본 레이아웃에서는 페이지 스크롤 (향후 구현 가능)
          console.log('[Nav] Next page (basic layout)');
        }
      };
    } catch(e) {
      console.error('[App] PageFlip initialization failed:', e);
    }
    */
    
    // 네비게이션 버튼은 기본 레이아웃에서는 비활성화
    const navPrev = document.querySelector('.nav-prev');
    const navNext = document.querySelector('.nav-next');
    if (navPrev) navPrev.onclick = () => console.log('[Nav] Previous page (기본 레이아웃)');
    if (navNext) navNext.onclick = () => console.log('[Nav] Next page (기본 레이아웃)');

    renderThumbs();
    currentApiPage++;
  } catch (error) {
    console.error('[App] loadInitialPage failed:', error);
    
    // 오류가 발생해도 기본 PageFlip 구조 유지
    try {
      const errorPage1 = document.createElement('div');
      errorPage1.className = 'page';
      errorPage1.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;">
          <div style="text-align:center; color:#666;">
            <div style="font-weight:700; margin-bottom:6px;">데이터 로드 중 오류가 발생했습니다</div>
            <div style="font-size:13px;">서버가 실행 중인지 확인해 주세요.</div>
            <div style="font-size:12px; margin-top:8px; color:#999;">Error: ${error.message}</div>
          </div>
        </div>`;
      
      const errorPage2 = document.createElement('div');
      errorPage2.className = 'page';
      errorPage2.innerHTML = '<div class="grid"></div>';
      
      const errorBookEl = await safeWaitForElement(getBookEl);
      if (errorBookEl) {
        errorBookEl.innerHTML = '';
        errorBookEl.appendChild(errorPage1);
        errorBookEl.appendChild(errorPage2);
        
        // 간단한 PageFlip 초기화 시도
        if (typeof PageFlip !== 'undefined') {
          try {
            if (flip) { flip.destroy(); }
            flip = new PageFlip(errorBookEl, {
            width: 1200,
            height: 800,
            size: 'fixed',
            usePortrait: false,
            autoSize: false
          });
          flip.loadFromHTML(errorBookEl.querySelectorAll('.page'));
          } catch (flipError) {
            console.warn('[App] Fallback PageFlip failed:', flipError);
          }
        }
      } else {
        console.error('[App] Could not find book element for error display');
      }
      
    } catch (fallbackError) {
      console.error('[App] Fallback rendering failed:', fallbackError);
      // 안전한 폴백 처리
      try {
        const finalBookEl = await safeWaitForElement(getBookEl);
        if (finalBookEl) {
          finalBookEl.innerHTML = `<div class="page">오류 발생</div>`;
        } else {
          console.warn('[App] Could not find book element for final fallback');
        }
      } catch (e) {
        console.error('[App] Final fallback failed:', e);
      }
    }
    
    try {
      const thumbsEl = getThumbsEl();
      if (thumbsEl) thumbsEl.innerHTML = '';
    } catch (e) {
      console.warn('[App] Could not clear thumbs:', e);
    }
  }
}

// 추가 페이지 로드 (기존 콘텐츠에 추가)
async function loadMore(){
  try {
    console.log(`[App] Loading additional page ${currentApiPage}...`);
    const response = await fetchEntriesPage(currentApiPage);
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid API response');
    }
    
    const { rows = [], total = 0 } = response;
    if (rows.length === 0) {
      console.log('[App] No more items to load');
      return;
    }
    
    totalItems = total;
    
    // 새로운 데이터와 기존 데이터를 합쳐서 중복 제거
    const allItems = [...rowsAccum, ...rows];
    const uniqueItems = deduplicateAndMergeOwnership(allItems);
    rowsAccum = uniqueItems;
    
    console.log(`[App] Added ${rows.length} raw items, total unique: ${uniqueItems.length}`);

    // PageFlip 재구성 (기존 방식 유지 - PageFlip 특성상 전체 재생성 필요)
    if (flip) {
      try { 
        flip.destroy(); 
      } catch(e) { 
        console.warn('[App] PageFlip destroy warning:', e); 
      }
    }
    
    getBookEl().innerHTML = '';
    getBookEl().appendChild(buildPagesFromRows(rowsAccum));

    // PageFlip 재초기화
    try {
      // 컨테이너의 실제 크기 계산 (안전한 확인)
      let bookWrap = getBookEl().parentElement;
      
      // parentElement가 없으면 직접 찾기
      if (!bookWrap) {
        bookWrap = document.querySelector('.book-wrap');
        console.warn('[PageFlip] Parent element not found, using .book-wrap directly');
      }
      
      if (!bookWrap) {
        console.error('[PageFlip] Book wrap container not found in DOM');
        // 기본값 사용
        var availableWidth = 1200;
        var availableHeight = 800;
      } else if (bookWrap.clientWidth === 0 || bookWrap.clientHeight === 0) {
        console.warn('[PageFlip] Container not yet rendered, using fallback dimensions');
        // 기본값 사용
        var availableWidth = 1200;
        var availableHeight = 800;
      } else {
        var availableWidth = bookWrap.clientWidth;
        var availableHeight = bookWrap.clientHeight;
      }
      
      console.log(`[PageFlip] Using container size: ${availableWidth}x${availableHeight}`);
      
      // PageFlip에는 전체 컨테이너 크기를 전달 (라이브러리가 자동으로 두 페이지 모드 처리)
      const pageWidth = availableWidth; // 전체 컨테이너 너비
      const pageHeight = availableHeight;
      
      // 페이지 높이에 맞는 카드 개수 재계산
      cardsPerPageView = calculateCardsPerPage(availableHeight);
      
      console.log(`[PageFlip] Re-init with size: ${availableWidth}x${availableHeight}`);
      console.log(`[PageFlip] Container size: ${pageWidth}x${pageHeight} (for landscape two-page mode)`);
      console.log(`[PageFlip] Cards per view: ${cardsPerPageView}`);
      
      flip = new PageFlip(bookEl, {
        width: pageWidth,
        height: pageHeight,
        size: 'fixed',
        maxShadowOpacity: 0.5,
        showCover: false,
        mobileScrollSupport: false, // 모바일 모드 비활성화
        usePortrait: false, // 세로형 비활성화 = 가로형(좌우 두 페이지)
        autoSize: false,
        clickEventForward: true,
        swipeDistance: 30,
        startPage: 0, // 첫 페이지부터 시작
        drawShadow: true, // 그림자 효과
        flippingTime: 1000, // 페이지 넘김 시간
        useMouseEvents: true, // 마우스 이벤트 활성화
        startZIndex: 0,
        minWidth: availableWidth, // 최소 너비를 전체 너비로 설정
        maxWidth: availableWidth // 최대 너비를 전체 너비로 설정
      });
      flip.loadFromHTML(getBookEl().querySelectorAll('.page'));
      
      // PageFlip 실제 크기 확인 (CSS로 처리하므로 로깅만)
      setTimeout(() => {
        const stfParent = getBookEl().querySelector('.stf__parent');
        const stfBlock = getBookEl().querySelector('.stf__block');
        const items = getBookEl().querySelectorAll('.stf__item');
        
        console.log(`[PageFlip] Container size: ${availableWidth}px x ${availableHeight}px`);
        if (stfParent) {
          console.log(`[PageFlip] Parent computed: ${stfParent.offsetWidth}px x ${stfParent.offsetHeight}px`);
        }
        if (stfBlock) {
          console.log(`[PageFlip] Block computed: ${stfBlock.offsetWidth}px x ${stfBlock.offsetHeight}px`);
        }
        console.log(`[PageFlip] Found ${items.length} page items`);
        items.forEach((item, i) => {
          console.log(`[PageFlip] Item ${i}: ${item.offsetWidth}px x ${item.offsetHeight}px, classes: ${item.className}`);
        });
      }, 100);
      
      const navPrev = document.querySelector('.nav-prev');
      const navNext = document.querySelector('.nav-next');
      if (navPrev) navPrev.onclick = ()=> flip.flipPrev();
      if (navNext) navNext.onclick = ()=> flip.flipNext();
    } catch(e) {
      console.error('[App] PageFlip re-initialization failed:', e);
    }

    renderThumbs();
    currentApiPage++;
  } catch (error) {
    console.error('[App] loadMore failed:', error);
    // 추가 로드 실패는 기존 콘텐츠를 유지하고 에러만 로그
  }
}


// IntersectionObserver 중복 생성 방지
let currentObserver = null;
let isLoadingMore = false;

function observeForMore(){
  // 기존 observer 정리
  if (currentObserver) {
    currentObserver.disconnect();
    currentObserver = null;
  }

  // sentinel을 북 컨테이너 끝에 배치
  let sentinel = document.getElementById('sentinel');
  if (sentinel) {
    sentinel.remove(); // 기존 sentinel 제거
  }
  
  sentinel = document.createElement('div');
  sentinel.id = 'sentinel';
  sentinel.style.height = '1px';
  sentinel.style.width = '1px';
  sentinel.style.position = 'relative';
  sentinel.style.clear = 'both';
  
  // 북 컨테이너의 끝에 추가 (실제 콘텐츠 이후)
  const bookWrap = document.querySelector('.book-wrap');
  if (bookWrap) {
    bookWrap.appendChild(sentinel);
  } else {
    document.body.appendChild(sentinel);
  }
  
  currentObserver = new IntersectionObserver(async (entries)=>{
    for (const e of entries) {
      if (!e.isIntersecting || isLoadingMore) continue;
      if (rowsAccum.length >= totalItems) {
        console.log('[App] All items loaded, disconnecting observer');
        currentObserver?.disconnect();
        return;
      }
      
      isLoadingMore = true;
      console.log('[App] Auto-loading more items...');
      try {
        await loadMore();
      } catch (error) {
        console.error('[App] Auto-load failed:', error);
      } finally {
        isLoadingMore = false;
      }
    }
  }, { 
    root: null, 
    rootMargin: '50px', // 100px에서 50px로 더 줄임 - 실제 스크롤 시에만 트리거
    threshold: 0.1 // threshold도 추가하여 더 명확한 트리거 조건
  });
  
  currentObserver.observe(sentinel);
}

// 지갑 상태 복원
async function restoreWalletState() {
  const savedWallet = localStorage.getItem('connectedWallet');
  if (savedWallet && window.solana?.isPhantom) {
    try {
      // Phantom이 여전히 연결되어 있는지 확인
      const response = await window.solana.connect({ onlyIfTrusted: true });
      if (response.publicKey.toString() === savedWallet) {
        wallet = savedWallet;
        getAddrEl().textContent = wallet.slice(0,4)+'...'+wallet.slice(-4);
        connectBtn.textContent = 'Disconnect';
        console.log('[Wallet] Restored connection:', wallet);
        await updateOwnershipStatus();
      } else {
        // 저장된 주소와 다르면 로컬스토리지 정리
        localStorage.removeItem('connectedWallet');
      }
    } catch (error) {
      // 자동 연결 실패 시 로컬스토리지 정리
      console.log('[Wallet] Auto-connect failed, clearing saved state');
      localStorage.removeItem('connectedWallet');
    }
  }
}

// 중복 초기화 방지
let isInitialized = false;
let currentView = 'codex'; // 현재 활성화된 뷰 추적

// 리사이즈 핸들러 비활성화 - PageFlip 자체 기능에 맡김
// 문제: 수동 리사이즈 처리가 PageFlip 내부 상태와 충돌하여 콘텐츠 손실 발생
console.log('[App] Manual resize handler disabled - using PageFlip built-in responsiveness');

async function safeInit() {
  if (isInitialized) {
    console.log('[App] Already initialized, skipping...');
    return;
  }
  isInitialized = true;
  
  try {
    console.log('[App] Starting initialization...');
    await restoreWalletState();
    await resetAndInit();
  } catch (error) {
    console.error('[App] Fatal initialization error:', error);
    isInitialized = false; // 실패 시 재시도 허용
  }
}

// ---------- 리더보드 기능 ----------
let currentLeaderboardPage = 1;
let currentSearch = '';
let leaderboardData = null;

// 리더보드 데이터 가져오기
async function fetchLeaderboard(page = 1, search = '') {
  try {
    const params = new URLSearchParams({ page, limit: 50, search });
    const response = await fetch(`${API}/leaderboard?${params}`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('[Leaderboard] API 요청 실패:', error);
    return null;
  }
}

// 리더보드 강제 업데이트
async function refreshLeaderboard() {
  const refreshBtn = document.getElementById('refreshBtn');
  if (!refreshBtn) return;
  
  refreshBtn.classList.add('loading');
  refreshBtn.textContent = '🔄 Updating...';
  
  try {
    const response = await fetch(`${API}/leaderboard/update`, { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      console.log('[Leaderboard] 업데이트 성공');
      await loadLeaderboard(); // 리더보드 다시 로드
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (error) {
    console.error('[Leaderboard] 업데이트 실패:', error);
    alert('Leaderboard update failed. Please try again.');
  } finally {
    refreshBtn.classList.remove('loading');
    refreshBtn.textContent = '🔄 Refresh';
  }
}

// 자격 조건에 해당하는 주소들을 클립보드에 복사
async function copyQualifiedAddresses(condition, holders) {
  if (!holders || holders.length === 0) {
    alert('No holders data available');
    return;
  }

  // 해당 조건을 만족하는 홀더들의 주소만 필터링
  const qualifiedAddresses = holders
    .filter(holder => holder.qualifications && holder.qualifications[condition])
    .map(holder => holder.address);

  if (qualifiedAddresses.length === 0) {
    alert(`No addresses found for ${condition}`);
    return;
  }

  // 주소들을 한 줄에 하나씩, 각 줄 끝에 콤마 추가
  const addressList = qualifiedAddresses.map(address => address + ',').join('\n');

  try {
    await navigator.clipboard.writeText(addressList);

    // 조건명을 사용자 친화적으로 변환
    const conditionNames = {
      top3: 'Top 3',
      top10: 'Top 10',
      top30: 'Top 30',
      top100: 'Top 100',
      holder500k: '500K+ Holders'
    };

    const conditionName = conditionNames[condition] || condition;
    alert(`${qualifiedAddresses.length} ${conditionName} addresses copied to clipboard!`);
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);

    // 클립보드 API가 실패하면 fallback으로 텍스트 선택
    const textArea = document.createElement('textarea');
    textArea.value = addressList;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);

    alert(`${qualifiedAddresses.length} addresses copied to clipboard!`);
  }
}

// 티어 클래스 이름 생성
function getTierClass(tier) {
  if (tier.includes('Top 3')) return 'top3';
  if (tier.includes('Top 10')) return 'top10';
  if (tier.includes('Top 30')) return 'top30';
  if (tier.includes('Top 100')) return 'top100';
  if (tier.includes('500K+')) return 'common';
  return 'none';
}

// 주소 단축 표시
function formatAddress(address) {
  if (!address) return 'N/A';
  return `${address.substring(0, 8)}...${address.substring(address.length - 8)}`;
}

// 티어 표시 포맷팅 함수
function formatTierDisplay(tier) {
  if (tier.includes(' + ')) {
    // 다중 티어인 경우 간략하게 표시
    const tiers = tier.split(' + ').map(t => {
      if (t.includes('Top 3')) return 'Top 3';
      if (t.includes('Top 10')) return 'Top 10';
      if (t.includes('Top 30')) return 'Top 30';
      if (t.includes('Top 100')) return 'Top 100';
      if (t.includes('500K+')) return '500K+';
      return t.split(' (')[0];
    });
    return tiers.join(' + ');
  }
  return tier.split(' (')[0];
}

// 리더보드 렌더링
function renderLeaderboard(data) {
  console.log('[Leaderboard] Rendering', data.holders?.length, 'holders');
  leaderboardData = data;
  
  // 마지막 업데이트 시간 표시
  const lastUpdated = document.getElementById('lastUpdated');
  if (lastUpdated && data.meta.lastUpdated) {
    const date = new Date(data.meta.lastUpdated);
    lastUpdated.textContent = `Last updated: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }
  
  // 개별 조건별 통계 렌더링
  const tierStatsEl = document.getElementById('tierStats');
  if (tierStatsEl && data.conditionStats) {
    const conditionOrder = [
      { key: 'top3', name: 'Top 3', reward: '1/1 Unique<br>Prisoner' },
      { key: 'top10', name: 'Top 10', reward: '1 Legendary<br>Prisoner' },
      { key: 'top30', name: 'Top 30', reward: '1 Super Rare<br>Prisoner' },
      { key: 'top100', name: 'Top 100', reward: '1 Rare<br>Prisoner' },
      { key: 'holder500k', name: '500K+ Holders', reward: '1 Common<br>Prisoner' }
    ];
    
    const statsHtml = conditionOrder.map(condition => {
      const count = data.conditionStats[condition.key] || 0;

      return `
        <div class="tier-stat" data-condition="${condition.key}" style="cursor: pointer;">
          <div class="tier-name">${condition.name}</div>
          <div class="tier-count">${count}</div>
          <div class="tier-reward">${condition.reward}</div>
        </div>
      `;
    }).join('');
    
    tierStatsEl.innerHTML = statsHtml;

    // 통계 카드 클릭 이벤트 추가
    tierStatsEl.addEventListener('click', (e) => {
      const tierStat = e.target.closest('.tier-stat');
      if (tierStat) {
        const condition = tierStat.getAttribute('data-condition');
        copyQualifiedAddresses(condition, data.holders);
      }
    });
  }
  
  // 홀더 리스트 렌더링
  const holdersListEl = document.getElementById('holdersList');
  if (holdersListEl) {
    if (!data.holders || data.holders.length === 0) {
      holdersListEl.innerHTML = `
        <div class="table-row" style="justify-content:center;color:#666;">
          No holders found
        </div>
      `;
    } else {
      const holdersHtml = data.holders.map(holder => {
        const rankClass = getTierClass(holder.tier);
        
        // 현재 지갑과 동일한지 확인
        const isMyWallet = wallet && wallet === holder.address;
        if (isMyWallet) {
          console.log('[Debug] Found my wallet at rank:', holder.rank);
        }
        const rowClass = isMyWallet ? 'table-row my-wallet' : 'table-row';
        
        // 자격 조건 숫자 태그
        const qualificationTag = (number, className, qualified) => {
          return qualified ? `<div class="qualification-tag ${className}">${number}</div>` : '';
        };
        
        return `
          <div class="${rowClass}">
            <div class="rank ${rankClass}">#${holder.rank}</div>
            <div class="address" title="${holder.address}">${formatAddress(holder.address)}</div>
            <div class="balance">${holder.balanceFormatted}</div>
            <div class="qualification-check">${qualificationTag('3', 'tag-3', holder.qualifications?.top3)}</div>
            <div class="qualification-check">${qualificationTag('10', 'tag-10', holder.qualifications?.top10)}</div>
            <div class="qualification-check">${qualificationTag('30', 'tag-30', holder.qualifications?.top30)}</div>
            <div class="qualification-check">${qualificationTag('100', 'tag-100', holder.qualifications?.top100)}</div>
            <div class="qualification-check">${qualificationTag('500K', 'tag-500k', holder.qualifications?.holder500k)}</div>
          </div>
        `;
      }).join('');
      
      holdersListEl.innerHTML = holdersHtml;
      
      // Display excluded holders
      if (data.excludedHolders && data.excludedHolders.length > 0) {
        const excludedSection = document.createElement('div');
        excludedSection.className = 'excluded-section';
        excludedSection.innerHTML = `
          <div class="excluded-header">
            <h3>Excluded Addresses (Not eligible for airdrop)</h3>
          </div>
        `;
        
        const excludedHtml = data.excludedHolders.map(holder => {
          const isMyWallet = wallet && wallet === holder.address;
          const rowClass = isMyWallet ? 'table-row my-wallet excluded-row' : 'table-row excluded-row';
          
          return `
            <div class="${rowClass}">
              <div class="rank">-</div>
              <div class="address" title="${holder.address}">
                ${formatAddress(holder.address)}
                <span class="exclude-tag">${holder.excludeReason}</span>
              </div>
              <div class="balance">${holder.balanceFormatted}</div>
              <div class="qualification-check">-</div>
              <div class="qualification-check">-</div>
              <div class="qualification-check">-</div>
              <div class="qualification-check">-</div>
              <div class="qualification-check">-</div>
            </div>
          `;
        }).join('');
        
        excludedSection.innerHTML += excludedHtml;
        holdersListEl.appendChild(excludedSection);
      }
    }
  }
  
  // 페이지네이션 렌더링
  renderPagination(data.meta);
}

// 페이지네이션 렌더링
function renderPagination(meta) {
  const paginationEl = document.getElementById('pagination');
  if (!paginationEl) return;
  
  const { page, totalPages } = meta;
  const maxButtons = 7;
  let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  
  let paginationHtml = '';
  
  // Previous button
  paginationHtml += `
    <button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">
      ‹ Previous
    </button>
  `;
  
  // First page
  if (startPage > 1) {
    paginationHtml += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) {
      paginationHtml += `<span style="padding:8px;">...</span>`;
    }
  }
  
  // Page numbers
  for (let i = startPage; i <= endPage; i++) {
    paginationHtml += `
      <button class="page-btn ${i === page ? 'active' : ''}" onclick="goToPage(${i})">
        ${i}
      </button>
    `;
  }
  
  // Last page
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      paginationHtml += `<span style="padding:8px;">...</span>`;
    }
    paginationHtml += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }
  
  // Next button
  paginationHtml += `
    <button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">
      Next ›
    </button>
  `;
  
  paginationEl.innerHTML = paginationHtml;
}

// 페이지 이동
async function goToPage(page) {
  if (page < 1 || (leaderboardData && page > leaderboardData.meta.totalPages)) return;
  
  currentLeaderboardPage = page;
  await loadLeaderboard();
}

// 리더보드 로드
async function loadLeaderboard() {
  console.log('[Leaderboard] 로딩 중...');
  
  const data = await fetchLeaderboard(currentLeaderboardPage, currentSearch);
  if (data) {
    renderLeaderboard(data);
  } else {
    // 에러 표시
    const holdersListEl = document.getElementById('holdersList');
    if (holdersListEl) {
      holdersListEl.innerHTML = `
        <div class="table-row" style="justify-content:center;color:#f56565;">
          Failed to load leaderboard data. Please try again.
        </div>
      `;
    }
  }
}

// 검색 기능
let searchTimeout;
function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;
  
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      currentSearch = e.target.value.trim();
      currentLeaderboardPage = 1; // 검색 시 첫 페이지로
      await loadLeaderboard();
    }, 300); // 300ms 디바운스
  });
}

// 뷰 전환 기능
function switchView(view) {
  const codexWrap = document.querySelector('.book-wrap');
  const leaderboardWrap = document.querySelector('.leaderboard-wrap');
  const codexBtn = document.getElementById('viewCodex');
  const leaderboardBtn = document.getElementById('viewLeaderboard');

  currentView = view; // 현재 뷰 업데이트
  console.log('[App] View switched to:', view);

  if (view === 'leaderboard') {
    // 책장 숨기기, 리더보드 보이기
    codexWrap.classList.add('hidden');
    leaderboardWrap.classList.add('active');
    codexBtn.classList.remove('active');
    leaderboardBtn.classList.add('active');

    // 리더보드 첫 로드
    if (!leaderboardData) {
      loadLeaderboard();
    }
  } else {
    // 리더보드 숨기기, 책장 보이기
    codexWrap.classList.remove('hidden');
    leaderboardWrap.classList.remove('active');
    codexBtn.classList.add('active');
    leaderboardBtn.classList.remove('active');
  }
}

// 전역 함수로 등록 (HTML onclick에서 사용)
window.goToPage = goToPage;
window.refreshLeaderboard = refreshLeaderboard;

// 이벤트 리스너 설정
function setupLeaderboardEvents() {
  const viewCodexBtn = document.getElementById('viewCodex');
  const viewLeaderboardBtn = document.getElementById('viewLeaderboard');
  const refreshBtn = document.getElementById('refreshBtn');
  
  if (viewCodexBtn) {
    viewCodexBtn.addEventListener('click', () => switchView('codex'));
  }
  
  if (viewLeaderboardBtn) {
    viewLeaderboardBtn.addEventListener('click', () => switchView('leaderboard'));
  }
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshLeaderboard);
  }
  
  setupSearch();
}

// 최초 로드
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    safeInit();
    setupLeaderboardEvents();
  });
} else {
  // DOM이 이미 로드됨
  safeInit();
  setupLeaderboardEvents();
}
