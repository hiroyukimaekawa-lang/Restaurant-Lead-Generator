/**
 * background.js  (Service Worker)
 *
 * クロール全体の司令塔。
 * - popup.js からの START / STOP メッセージを受け取る
 * - content.js に一覧取得・詳細取得・次ページ遷移を順番に指示
 * - 取得済みデータを chrome.storage.session に蓄積
 * - 進捗を popup.js にブロードキャスト
 */

// ============================================================
// 定数
// ============================================================
const DELAY_DETAIL   = 1500;  // 詳細ページ滞在時間 (ms)
const DELAY_LIST     = 1500;  // 一覧ページ読み込み待機 (ms)
const DELAY_NAVIGATE = 2000;  // ページ遷移後の安定待機 (ms)
const MAX_DEFAULT    = Infinity;   // デフォルト最大取得件数

// ============================================================
// 状態
// ============================================================
let crawlState = {
  running:    false,
  tabId:      null,
  listUrl:    null,   // 一覧ページに戻るURL
  results:    [],
  maxItems:   MAX_DEFAULT,
  pageCount:  0,
};

// ============================================================
// ユーティリティ
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** 指定タブでスクリプトを実行して結果を返す */
async function execInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func,
    args,
  });
  return results?.[0]?.result;
}

/** タブが完全にロードされるまで待機 */
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // タイムアウトしても続行
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Popup へ進捗を送信 */
function broadcast(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {
    // popup が閉じている場合は無視
  });
}

// ============================================================
// 食べログ: 一覧ページから店舗URLリストを収集
// ============================================================
function tabelogGetLinks() {
  const links = [];
  // 実際のDOM: .list-rst__rst-name-target  または  .js-rst-cassette-wrap 内の店舗リンク
  const anchors = document.querySelectorAll(
    '.list-rst__rst-name-target, .js-rst-cassette-wrap a.list-rst__name, a[href*="/rst/"][class*="rst-name"]'
  );
  anchors.forEach(a => {
    const href = a.href;
    if (href && href.includes('/rst/') && !links.includes(href)) {
      links.push(href);
    }
  });
  // フォールバック: rstLstページ内の /rst/ リンクを広く拾う
  if (links.length === 0) {
    document.querySelectorAll('a[href*="tabelog.com"][href*="/rst/"]').forEach(a => {
      const href = a.href.split('?')[0]; // クエリ除去
      if (href && !links.includes(href)) links.push(href);
    });
  }
  return links;
}

/** 食べログ: 詳細ページから情報を取得 */
function tabelogGetDetail() {
  try {
    let name = '';
    const nameWrap = document.querySelector('.rstinfo-table__name-wrap');
    if (nameWrap) {
      name = nameWrap.textContent.trim();
    } else {
      name = document.querySelector('h1.display-name span')?.textContent?.trim() ||
        document.querySelector('.rst-name-main')?.textContent?.trim() ||
        document.querySelector('h1[class*="rst"]')?.textContent?.trim() ||
        document.title.split('|')[0].trim();
    }

    let genre = '';
    const thElements = document.querySelectorAll('th');
    for (const th of thElements) {
      if (th.textContent.trim() === 'ジャンル') {
        const td = th.nextElementSibling;
        if (td) {
          genre = td.textContent.trim();
        }
        break;
      }
    }

    // 住所: 複数のセレクタを試みる
    const address =
      document.querySelector('.rstinfo-table__address')?.textContent?.trim() ||
      document.querySelector('[itemprop="streetAddress"]')?.textContent?.trim() ||
      document.querySelector('.rstdtl-side-yoyaku__address')?.textContent?.trim() ||
      '';

    // 電話番号: tel: リンク or テキスト
    const telAnchor = document.querySelector('a[href^="tel:"]');
    let phone = '';
    if (telAnchor) {
      phone = telAnchor.href.replace('tel:', '').trim();
    } else {
      const telEl =
        document.querySelector('.rstinfo-table__tel') ||
        document.querySelector('[class*="tel"]');
      if (telEl) phone = telEl.textContent.trim();
    }
    // 電話番号の正規化（数字・ハイフンのみ）
    phone = phone.replace(/[^\d\-]/g, '');

    const url = window.location.href.split('?')[0];

    return { name, genre, address, phone, url, source: 'tabelog' };
  } catch (e) {
    return { name: '', genre: '', address: '', phone: '', url: window.location.href, source: 'tabelog', _error: e.message };
  }
}

/** 食べログ: 次のページボタンを押す。次ページがなければ false を返す */
function tabelogClickNext() {
  // 「次の20件」ボタン
  const nextBtn =
    document.querySelector('a.c-pagination__arrow--next') ||
    document.querySelector('.pagination-parts a[rel="next"]') ||
    document.querySelector('a[title="次のページ"]') ||
    document.querySelector('.c-pagination__num a.is-current + a') ||
    (() => {
      // 現在ページの次の数字リンク
      const current = document.querySelector('.c-pagination__num .is-current');
      return current?.nextElementSibling?.querySelector('a') || null;
    })();

  if (nextBtn && nextBtn.href) {
    nextBtn.click();
    return nextBtn.href;
  }
  return false;
}

// ============================================================
// ホットペッパー: 一覧ページから店舗URLリストを収集
// ============================================================
function hotpepperGetLinks() {
  const links = [];
  // .shopDetailLink, .shopName a, h3 a などが候補
  const anchors = document.querySelectorAll(
    '.shopDetailLink, .shopName a, .list-cassette__unit a[href*="/A"], h3.shopName a'
  );
  anchors.forEach(a => {
    const href = a.href;
    if (href && href.includes('hotpepper.jp') && !links.includes(href)) {
      links.push(href);
    }
  });
  if (links.length === 0) {
    document.querySelectorAll('a[href*="hotpepper.jp/A"]').forEach(a => {
      const href = a.href.split('?')[0];
      if (href && !links.includes(href)) links.push(href);
    });
  }
  return links;
}

/** ホットペッパー: 詳細ページから情報を取得 */
function hotpepperGetDetail() {
  try {
    const name =
      document.querySelector('h1.shopDetailMainTitle')?.textContent?.trim() ||
      document.querySelector('.shopName')?.textContent?.trim() ||
      document.querySelector('h1[class*="shop"]')?.textContent?.trim() ||
      document.title.split('|')[0].trim();

    const address =
      document.querySelector('.shopDetailInfoAddress')?.textContent?.trim() ||
      document.querySelector('[itemprop="streetAddress"]')?.textContent?.trim() ||
      document.querySelector('.adr')?.textContent?.trim() ||
      '';

    const telAnchor = document.querySelector('a[href^="tel:"]');
    let phone = '';
    if (telAnchor) {
      phone = telAnchor.href.replace('tel:', '').trim();
    } else {
      const telEl = document.querySelector('.shopDetailInfoTel, [class*="tel"]');
      if (telEl) phone = telEl.textContent.trim();
    }
    phone = phone.replace(/[^\d\-]/g, '');

    const url = window.location.href.split('?')[0];
    return { name, genre: '', address, phone, url, source: 'hotpepper' };
  } catch (e) {
    return { name: '', genre: '', address: '', phone: '', url: window.location.href, source: 'hotpepper', _error: e.message };
  }
}

/** ホットペッパー: 次のページへ */
function hotpepperClickNext() {
  const nextBtn =
    document.querySelector('a.pa_next') ||
    document.querySelector('.pager a[title="次のページへ"]') ||
    document.querySelector('.pagination a[rel="next"]') ||
    document.querySelector('a[href*="PA="][class*="next"]');
  if (nextBtn && nextBtn.href) {
    nextBtn.click();
    return nextBtn.href;
  }
  return false;
}

// ============================================================
// サイト判定ヘルパー
// ============================================================
function getSiteType(url) {
  if (/tabelog\.com/.test(url))   return 'tabelog';
  if (/hotpepper\.jp/.test(url))  return 'hotpepper';
  return null;
}

// ============================================================
// メインクロールループ
// ============================================================
async function runCrawl() {
  const { tabId, maxItems } = crawlState;
  let collected = 0;
  let pageNum = 1;

  try {
    while (crawlState.running && collected < maxItems) {
      // --- 現在のタブURLを確認 ---
      const tab = await chrome.tabs.get(tabId);
      const siteType = getSiteType(tab.url);
      if (!siteType) {
        broadcast('ERROR', { message: '対応サイトではありません' });
        break;
      }

      broadcast('PAGE_START', { page: pageNum, collected });

      // ① 一覧から店舗URLを収集
      await sleep(DELAY_LIST);
      const getLinks = siteType === 'tabelog' ? tabelogGetLinks : hotpepperGetLinks;
      let links = await execInTab(tabId, getLinks) || [];

      // 重複排除（既取得URLを除外）
      const existingUrls = new Set(crawlState.results.map(r => r.url));
      links = links.filter(l => !existingUrls.has(l.split('?')[0]));

      // 最大件数に合わせてスライス
      const remaining = maxItems - collected;
      links = links.slice(0, remaining);

      if (links.length === 0) {
        broadcast('INFO', { message: `${pageNum}ページ目: 新規リンクなし → 終了` });
        break;
      }

      broadcast('INFO', { message: `${pageNum}ページ目: ${links.length}件のリンクを取得` });

      // ② 各詳細ページへ遷移して情報取得
      const listUrl = tab.url; // 一覧に戻るためのURL

      for (const link of links) {
        if (!crawlState.running) break;

        try {
          // 詳細ページへ遷移
          await chrome.tabs.update(tabId, { url: link });
          await waitForTabLoad(tabId);
          await sleep(DELAY_DETAIL);

          // 詳細情報取得
          const getDetail = siteType === 'tabelog' ? tabelogGetDetail : hotpepperGetDetail;
          const detail = await execInTab(tabId, getDetail);

          if (detail && detail.name) {
            crawlState.results.push(detail);
            collected++;
            broadcast('PROGRESS', {
              collected,
              maxItems,
              latest: detail.name,
              page: pageNum,
            });
          } else {
            console.warn('[BG] 詳細取得失敗:', link);
          }
        } catch (err) {
          console.error('[BG] 詳細ページエラー:', link, err);
        }
      }

      if (!crawlState.running || collected >= maxItems) break;

      // ③ 一覧ページに戻る
      await chrome.tabs.update(tabId, { url: listUrl });
      await waitForTabLoad(tabId);
      await sleep(DELAY_NAVIGATE);

      // ④ 次ページへ
      const clickNext = siteType === 'tabelog' ? tabelogClickNext : hotpepperClickNext;
      const nextUrl = await execInTab(tabId, clickNext);

      if (!nextUrl) {
        broadcast('INFO', { message: '最終ページに達しました' });
        break;
      }

      // 次ページ読み込み完了待機
      await waitForTabLoad(tabId);
      await sleep(DELAY_NAVIGATE);
      pageNum++;
    }
  } catch (err) {
    console.error('[BG] クロールエラー:', err);
    broadcast('ERROR', { message: err.message });
  } finally {
    crawlState.running = false;
    broadcast('DONE', {
      collected: crawlState.results.length,
      results: crawlState.results,
    });
  }
}

// ============================================================
// メッセージリスナー
// ============================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  // --- クロール開始 ---
  if (message.action === 'START_CRAWL') {
    if (crawlState.running) {
      sendResponse({ ok: false, error: '既に実行中です' });
      return;
    }
    crawlState = {
      running:   true,
      tabId:     message.tabId,
      listUrl:   message.listUrl,
      results:   [],
      maxItems:  message.maxItems || MAX_DEFAULT,
      pageCount: 0,
    };
    runCrawl();
    sendResponse({ ok: true });
    return;
  }

  // --- クロール停止 ---
  if (message.action === 'STOP_CRAWL') {
    crawlState.running = false;
    sendResponse({ ok: true });
    return;
  }

  // --- 現在の結果を取得 ---
  if (message.action === 'GET_RESULTS') {
    sendResponse({ results: crawlState.results, running: crawlState.running });
    return;
  }

  return true;
});
