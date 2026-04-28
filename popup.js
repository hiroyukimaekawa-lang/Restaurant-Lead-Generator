/**
 * popup.js
 * Popup UI ロジック
 */

// ============================================================
// DOM 参照
// ============================================================
const scrapeBtn   = document.getElementById('scrapeBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const errorBox    = document.getElementById('errorBox');
const previewSection = document.getElementById('previewSection');
const previewList    = document.getElementById('previewList');

// ============================================================
// 状態管理
// ============================================================
let restaurants = [];

// ============================================================
// UI ヘルパー
// ============================================================
function setStatus(type, html) {
  // type: 'idle' | 'loading' | 'success' | 'warning' | 'error'
  statusDot.className = 'status-dot';
  if (type === 'loading') {
    statusDot.classList.add('active', 'pulse');
  } else if (type === 'success') {
    statusDot.classList.add('success');
  } else if (type === 'warning') {
    statusDot.classList.add('warning');
  } else if (type === 'error') {
    statusDot.classList.add('error');
  }
  statusText.innerHTML = html;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
}

function hideError() {
  errorBox.classList.remove('visible');
}

function renderPreview(data) {
  previewList.innerHTML = '';
  const max = Math.min(data.length, 30); // 最大30件プレビュー
  for (let i = 0; i < max; i++) {
    const r = data[i];
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `
      <div class="preview-name">${escapeHtml(r.name)}</div>
      <div class="preview-meta">${escapeHtml(r.address || '住所なし')}${r.phone ? ' · ' + escapeHtml(r.phone) : ''}</div>
    `;
    previewList.appendChild(item);
  }
  if (data.length > max) {
    const more = document.createElement('div');
    more.className = 'preview-item';
    more.innerHTML = `<div class="preview-meta" style="text-align:center">... 他 ${data.length - max} 件</div>`;
    previewList.appendChild(more);
  }
  previewSection.classList.add('visible');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// CSV 生成
// ============================================================
function toCSV(data) {
  const headers = ['name', 'address', 'phone', 'url', 'source'];
  const escapeField = (val) => {
    const s = String(val ?? '');
    // カンマ・改行・ダブルクォートを含む場合はダブルクォートで囲む
    if (s.includes(',') || s.includes('\n') || s.includes('"')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const rows = data.map((r) =>
    headers.map((h) => escapeField(r[h])).join(',')
  );

  // BOM付きUTF-8（Excelでの文字化け防止）
  return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

function downloadCSV(data) {
  const csv = toCSV(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const now = new Date();
  const ts  = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const filename = `restaurant_list_${ts}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// メインアクション: スクレイピング実行
// ============================================================
scrapeBtn.addEventListener('click', async () => {
  hideError();
  restaurants = [];
  downloadBtn.disabled = true;
  previewSection.classList.remove('visible');

  scrapeBtn.disabled = true;
  setStatus('loading', '店舗情報を取得中...');

  try {
    // アクティブタブを取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      throw new Error('アクティブなタブが見つかりません');
    }

    // Content Script が注入済みか確認し、メッセージ送信
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    } catch (sendErr) {
      // Content Script が未注入の場合は手動注入してリトライ
      console.warn('[Popup] Content script 未注入。手動注入します。', sendErr);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content.js'],
      });
      // 少し待ってからリトライ
      await new Promise(r => setTimeout(r, 300));
      response = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    }

    if (!response) {
      throw new Error('Content Script から応答がありませんでした');
    }

    if (response.error) {
      setStatus('warning', response.error);
      showError(response.error);
      return;
    }

    const data = response.data || [];

    if (data.length === 0) {
      setStatus('warning', `
        <span style="font-size:11px">店舗情報が見つかりませんでした。<br>
        検索結果が表示されているページで実行してください。</span>
      `);
      showError('DOM構造が変更されている可能性があります。コンソールのログを確認してください。');
      return;
    }

    restaurants = data;
    const sourceName = { hotpepper: 'ホットペッパー', tabelog: '食べログ', google: 'Googleマップ' };
    const src = sourceName[response.source] || response.source;

    setStatus('success', `
      <span class="count">${data.length}</span>
      件取得完了 — ${src}
    `);

    renderPreview(data);
    downloadBtn.disabled = false;

  } catch (err) {
    console.error('[Popup] エラー:', err);
    setStatus('error', 'エラーが発生しました');
    showError(err.message || '不明なエラー');
  } finally {
    scrapeBtn.disabled = false;
  }
});

// ============================================================
// CSVダウンロード
// ============================================================
downloadBtn.addEventListener('click', () => {
  if (restaurants.length === 0) return;
  downloadCSV(restaurants);
});