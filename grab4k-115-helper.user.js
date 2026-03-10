// ==UserScript==
// @name         Grab4K 115 一键转存助手（增强版）
// @version      5.6.0
// @description  Grab4K 筛选页顺序新标签浏览助手（仅筛选页生效）
// @author       楠 (adapted for Grab4K, enhanced by Codex)
// @match        *://grab4k.com/*
// @match        *://www.grab4k.com/*
// @match        *://grab4k.cn/*
// @match        *://www.grab4k.cn/*
// @match        *://grab4k.org/*
// @match        *://www.grab4k.org/*
// @match        *://vip.grab4k.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      115cdn.com
// @license      MIT
// @icon         https://grab4k.com/mxstatic/picture/logo.png
// @namespace    https://greasyfork.org/users/1514724
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    siteDomains: ['grab4k.com', 'grab4k.cn', 'grab4k.org', 'vip.grab4k.com'],
    api115: 'https://115cdn.com/webapi/share/receive',
    snap115: 'https://115cdn.com/webapi/share/snap',
    link115Regex: /https?:\/\/115(?:cdn)?\.com\/s\/([a-zA-Z0-9]+)(?:\?password=|\?pass=|\?pwd=)([a-zA-Z0-9]{4})/i,
    clipMaxWait: 6000,
    clipPollInterval: 250,
    requestTimeout: 15000,
    autoTransferDelay: 900,
    autoTransferredFlag: 'g4k_auto_transferred',
    seqStateKey: 'g4k_seq_state',
    seqCloseKey: 'g4k_seq_closed',
  };

  if (!CONFIG.siteDomains.some(domain => location.hostname.includes(domain))) return;

  const isDetailPage = /\/down\//.test(location.pathname);
  if (isDetailPage) return;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function withSeqParams(rawUrl, sid, idx) {
    const url = new URL(rawUrl, location.origin);
    url.searchParams.set('g4k_sid', sid);
    url.searchParams.set('g4k_idx', String(idx));
    return url.toString();
  }

  function readSeqParams() {
    const url = new URL(location.href);
    const sid = url.searchParams.get('g4k_sid');
    const idxText = url.searchParams.get('g4k_idx');
    const idx = Number(idxText);
    if (!sid || Number.isNaN(idx)) return null;
    return { sid, idx };
  }

  const Utils = {
    parse115Link(text) {
      const match = (text || '').match(CONFIG.link115Regex);
      return match ? { url: match[0], shareCode: match[1], password: match[2] } : null;
    },
    humanSize(size) {
      if (size < 1024) return `${size}B`;
      if (size < 1048576) return `${(size / 1024).toFixed(2)}KB`;
      if (size < 1073741824) return `${(size / 1048576).toFixed(2)}MB`;
      if (size < 1099511627776) return `${(size / 1073741824).toFixed(2)}GB`;
      return `${(size / 1099511627776).toFixed(2)}TB`;
    },
    getResourceLabel(row, index) {
      const title = row.querySelector('.module-row-title, .module-row-name, .title, .name')?.textContent?.trim();
      const meta = row.querySelector('.module-row-size, .size, .module-row-info-tips')?.textContent?.trim();
      if (title && meta) return `${index + 1}. ${title} (${meta})`;
      if (title) return `${index + 1}. ${title}`;
      return `${index + 1}. 资源 ${index + 1}`;
    },
  };

  function getMovieTitle(row) {
    const rowTitle = row?.querySelector('.module-row-title, .module-row-name, .title, .name')?.textContent?.trim();
    if (rowTitle) return rowTitle;

    const blockTitle = row?.closest('.module-list, .module-row')?.querySelector('.module-item-title, .module-title')?.textContent?.trim();
    if (blockTitle) return blockTitle;

    return document.querySelector('.page-title')?.textContent?.trim()
      || document.querySelector('h1')?.textContent?.trim()
      || document.title.split('|')[0].split('-')[0].trim()
      || '影片';
  }

  const Toast = {
    el: null,
    timer: null,
    init() {
      if (this.el) return;
      const el = document.createElement('div');
      el.id = 'g4k-toast';
      Object.assign(el.style, {
        position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%) translateY(-80px)',
        zIndex: 100001, padding: '10px 22px', borderRadius: '10px', fontFamily: 'system-ui,sans-serif',
        fontSize: '13px', fontWeight: '600', boxShadow: '0 4px 20px rgba(0,0,0,.18)',
        transition: 'transform .35s ease, opacity .35s ease', opacity: 0, pointerEvents: 'none',
        maxWidth: '560px', textAlign: 'center', whiteSpace: 'nowrap',
      });
      document.body.appendChild(el);
      this.el = el;
    },
    show(msg, type = 'info', ms = 3000) {
      if (!this.el) this.init();
      clearTimeout(this.timer);

      const theme = {
        success: { bg: '#e8f5e9', bd: '#66bb6a', c: '#2e7d32', i: '✅' },
        error: { bg: '#ffebee', bd: '#ef5350', c: '#c62828', i: '❌' },
        process: { bg: '#e3f2fd', bd: '#42a5f5', c: '#1565c0', i: '⏳' },
        info: { bg: '#fff8e1', bd: '#ffa726', c: '#e65100', i: 'ℹ️' },
        skip: { bg: '#f3e5f5', bd: '#ab47bc', c: '#6a1b9a', i: '⏭️' },
      }[type] || { bg: '#fff', bd: '#ccc', c: '#333', i: '' };

      this.el.style.background = theme.bg;
      this.el.style.border = `1px solid ${theme.bd}`;
      this.el.style.color = theme.c;
      this.el.textContent = `${theme.i} ${msg}`;
      this.el.style.transform = 'translateX(-50%) translateY(0)';
      this.el.style.opacity = 1;

      this.timer = setTimeout(() => {
        this.el.style.transform = 'translateX(-50%) translateY(-80px)';
        this.el.style.opacity = 0;
      }, ms);
    },
  };

  const Transfer = {
    run(shareCode, password, cookie, cid) {
      return new Promise(resolve => {
        GM_xmlhttpRequest({
          method: 'POST',
          url: CONFIG.api115,
          headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
          data: new URLSearchParams({
            share_code: shareCode,
            receive_code: password,
            cid,
            is_check: 0,
          }).toString(),
          timeout: CONFIG.requestTimeout,
          onload(response) {
            try {
              const json = JSON.parse(response.responseText);
              if (json.state === true) {
                Transfer.fileSize(shareCode, password, cookie)
                  .then(size => resolve({ ok: true, skip: false, msg: `转存成功 [${size}]` }))
                  .catch(() => resolve({ ok: true, skip: false, msg: '转存成功' }));
                return;
              }

              if (json.errno === 4100024) {
                resolve({ ok: true, skip: true, msg: '已转存过' });
                return;
              }

              const errorMap = {
                4100008: '密码错误',
                4100010: '分享已取消',
                4100018: '分享已过期',
                910001: 'Cookie 无效或失效',
              };
              resolve({ ok: false, skip: false, msg: errorMap[json.errno] || json.error || '未知错误' });
            } catch (error) {
              resolve({ ok: false, skip: false, msg: error.message || '返回解析失败' });
            }
          },
          onerror: () => resolve({ ok: false, skip: false, msg: '接口调用失败' }),
          ontimeout: () => resolve({ ok: false, skip: false, msg: '请求超时' }),
        });
      });
    },

    fileSize(shareCode, receiveCode, cookie) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `${CONFIG.snap115}?${new URLSearchParams({
            _v: 2,
            share_code: shareCode,
            receive_code: receiveCode,
            offset: 0,
            limit: 20,
            cid: '',
          })}`,
          headers: { Cookie: cookie, Referer: 'https://115.com/' },
          timeout: 10000,
          onload(response) {
            try {
              const data = JSON.parse(response.responseText);
              const list = data?.data?.list || data?.data;
              if (!list?.[0]) reject(new Error('empty list'));
              resolve(Utils.humanSize(list[0].s || list[0].size || 0));
            } catch (error) {
              reject(error);
            }
          },
          onerror: reject,
          ontimeout: reject,
        });
      });
    },
  };

  function get115Rows() {
    const dl = document.getElementById('download-list');
    if (!dl) return [];
    const titles = [...dl.querySelectorAll('font.module-title')];
    const titleNode = titles.find(node => node.textContent?.includes('115'));
    if (!titleNode) return [];

    let section = titleNode.nextElementSibling;
    while (section && !section.classList?.contains('box')) {
      section = section.nextElementSibling;
    }
    if (!section) return [];

    return [...section.querySelectorAll('.module-row-info')];
  }

  async function clickCopyAndTransfer(copyBtn) {
    const cookie = GM_getValue('115_cookie', '');
    if (!cookie) {
      Toast.show('请先点击 ⚙️ 设置 115 Cookie', 'error');
      return null;
    }

    const cid = GM_getValue('115_cid', '0');

    try {
      await navigator.clipboard.writeText('');
    } catch (_) {
      // ignore clipboard clear failure
    }

    copyBtn.click();

    const deadline = Date.now() + CONFIG.clipMaxWait;
    let parsed = null;
    while (Date.now() < deadline) {
      await sleep(CONFIG.clipPollInterval);
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          parsed = Utils.parse115Link(text);
          if (parsed) break;
        }
      } catch (_) {
        // ignore temporary clipboard read failures
      }
    }

    if (!parsed) {
      Toast.show('未获取到有效 115 链接，请检查复制权限', 'error');
      return null;
    }

    return Transfer.run(parsed.shareCode, parsed.password, cookie, cid);
  }

  async function transferRow(row, triggerBtn) {
    const copyBtn = row.querySelector('.js-copy,.btn-copyurl.copy');
    if (!copyBtn) {
      Toast.show('当前资源无复制按钮，无法转存', 'error');
      return { ok: false, skip: false, msg: '无复制按钮' };
    }

    const spanEl = triggerBtn?.querySelector('span');
    if (triggerBtn && spanEl) {
      triggerBtn.style.pointerEvents = 'none';
      triggerBtn.style.opacity = '.7';
      spanEl.textContent = '转存中...';
    }

    Toast.show(`正在转存：${getMovieTitle(row)}`, 'process', 2500);
    const result = await clickCopyAndTransfer(copyBtn);

    if (triggerBtn && spanEl) {
      if (result?.ok) {
        triggerBtn.style.background = result.skip ? '#ff9800' : '#43a047';
        triggerBtn.style.opacity = '1';
        spanEl.textContent = result.skip ? '已转存' : '成功 ✓';
      } else {
        triggerBtn.style.pointerEvents = '';
        triggerBtn.style.opacity = '1';
        triggerBtn.style.background = 'linear-gradient(135deg,#2196F3,#1565C0)';
        spanEl.textContent = '一键转存';
      }
    }

    if (result?.ok) Toast.show(result.msg, result.skip ? 'skip' : 'success', 2500);
    else if (result) Toast.show(result.msg, 'error', 2800);

    return result;
  }

  function showBatchSelectionModal(rows) {
    const existing = document.getElementById('g4k-select-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'g4k-select-modal';
    Object.assign(overlay.style, {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100004,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      backdropFilter: 'blur(4px)',
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      width: '520px', maxWidth: '92vw', maxHeight: '78vh', overflow: 'auto',
      background: '#fff', borderRadius: '12px', padding: '18px 16px',
      boxShadow: '0 24px 64px rgba(0,0,0,.2)', fontFamily: 'system-ui,sans-serif',
    });

    const items = rows.map((row, index) => `
      <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 6px;border-radius:8px;cursor:pointer;">
        <input type="checkbox" data-idx="${index}" checked style="margin-top:2px;">
        <span style="font-size:13px;line-height:1.45;color:#2b2b2b;">${Utils.getResourceLabel(row, index)}</span>
      </label>
    `).join('');

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <h3 style="margin:0;font-size:15px;">选择需要转存的资源</h3>
        <button id="g4k-select-close" style="border:none;background:transparent;font-size:18px;cursor:pointer;">×</button>
      </div>
      <div style="font-size:12px;color:#666;margin-bottom:10px;">共 ${rows.length} 个资源，支持批量顺序转存。</div>
      <div id="g4k-select-items" style="border:1px solid #eee;border-radius:10px;padding:8px;">${items}</div>
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;">
        <div>
          <button id="g4k-select-all" style="padding:7px 10px;border:1px solid #ddd;border-radius:7px;background:#fff;cursor:pointer;">全选</button>
          <button id="g4k-unselect-all" style="padding:7px 10px;border:1px solid #ddd;border-radius:7px;background:#fff;cursor:pointer;margin-left:6px;">清空</button>
        </div>
        <button id="g4k-start-transfer" style="padding:8px 14px;border:none;border-radius:8px;background:linear-gradient(135deg,#1976d2,#1565c0);color:#fff;cursor:pointer;font-weight:700;">开始转存</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.onclick = event => {
      if (event.target === overlay) close();
    };
    modal.querySelector('#g4k-select-close').onclick = close;

    modal.querySelector('#g4k-select-all').onclick = () => {
      modal.querySelectorAll('input[type="checkbox"]').forEach(box => {
        box.checked = true;
      });
    };

    modal.querySelector('#g4k-unselect-all').onclick = () => {
      modal.querySelectorAll('input[type="checkbox"]').forEach(box => {
        box.checked = false;
      });
    };

    modal.querySelector('#g4k-start-transfer').onclick = async () => {
      const selectedIndexes = [...modal.querySelectorAll('input[type="checkbox"]:checked')].map(box => Number(box.dataset.idx));
      if (!selectedIndexes.length) {
        Toast.show('请至少选择一个资源', 'info');
        return;
      }

      close();
      let ok = 0;
      let skip = 0;
      let fail = 0;

      for (let i = 0; i < selectedIndexes.length; i += 1) {
        const row = rows[selectedIndexes[i]];
        Toast.show(`批量转存中 (${i + 1}/${selectedIndexes.length})`, 'process', 1800);
        const result = await transferRow(row, row.querySelector('.g4k-transfer-btn'));
        if (result?.ok && result.skip) skip += 1;
        else if (result?.ok) ok += 1;
        else fail += 1;
        await sleep(350);
      }

      Toast.show(`批量完成：成功 ${ok}，已存在 ${skip}，失败 ${fail}`, fail ? 'info' : 'success', 4200);
    };
  }

  async function maybeAutoTransferSingle(rows) {
    const autoEnabled = GM_getValue('auto_single_transfer', true);
    if (!autoEnabled || rows.length !== 1) return;

    if (sessionStorage.getItem(CONFIG.autoTransferredFlag) === '1') return;
    sessionStorage.setItem(CONFIG.autoTransferredFlag, '1');

    await sleep(CONFIG.autoTransferDelay);
    const btn = rows[0].querySelector('.g4k-transfer-btn');
    if (btn) {
      Toast.show('检测到单个资源，自动开始转存', 'info', 2200);
      btn.click();
    }
  }

  function injectTransferButtons() {
    const rows = get115Rows();
    if (!rows.length) return;

    rows.forEach(row => {
      if (row.querySelector('.g4k-transfer-btn')) return;
      const copyBtn = row.querySelector('.js-copy,.btn-copyurl.copy');
      if (!copyBtn) return;

      const btn = document.createElement('div');
      btn.className = 'g4k-transfer-btn';
      Object.assign(btn.style, {
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '5px 14px', cursor: 'pointer', marginLeft: '8px',
        background: 'linear-gradient(135deg,#2196F3,#1565C0)',
        color: '#fff', fontSize: '12px', fontWeight: '700', borderRadius: '6px',
        transition: 'all .25s', whiteSpace: 'nowrap', height: '30px', boxSizing: 'border-box',
        boxShadow: '0 2px 8px rgba(33,150,243,.3)', verticalAlign: 'middle',
      });
      btn.innerHTML = '<img src="https://115.com/favicon.ico" style="width:14px;height:14px;"><span>一键转存</span>';

      btn.onmouseenter = () => {
        btn.style.filter = 'brightness(1.1)';
        btn.style.transform = 'translateY(-1px)';
      };
      btn.onmouseleave = () => {
        btn.style.filter = '';
        btn.style.transform = '';
      };

      btn.onclick = async event => {
        event.preventDefault();
        event.stopPropagation();
        await transferRow(row, btn);
      };

      const shortcuts = row.querySelector('.module-row-shortcuts');
      if (shortcuts) shortcuts.appendChild(btn);
      else row.appendChild(btn);
    });

    const toolbar = document.querySelector('#download-list .module-tab-items, #download-list .module-heading, #download-list');
    if (toolbar && !document.getElementById('g4k-batch-transfer-btn') && rows.length > 1) {
      const batchBtn = document.createElement('button');
      batchBtn.id = 'g4k-batch-transfer-btn';
      batchBtn.textContent = '选择后批量转存';
      Object.assign(batchBtn.style, {
        margin: '8px 0 12px', padding: '6px 12px', borderRadius: '8px', border: 'none',
        background: 'linear-gradient(135deg,#7b1fa2,#6a1b9a)', color: '#fff',
        fontSize: '12px', cursor: 'pointer', fontWeight: '700',
      });
      batchBtn.onclick = () => showBatchSelectionModal(rows);
      toolbar.prepend(batchBtn);
    }

    maybeAutoTransferSingle(rows);
  }

  function showSettings() {
    if (document.getElementById('g4k-settings')) return;

    const overlay = document.createElement('div');
    overlay.id = 'g4k-settings';
    Object.assign(overlay.style, {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      backdropFilter: 'blur(6px)', zIndex: 100003,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#fff', borderRadius: '14px', width: '390px',
      padding: '22px', boxShadow: '0 20px 60px rgba(0,0,0,.2)',
      fontFamily: 'system-ui,sans-serif', fontSize: '13px', color: '#333',
    });

    modal.innerHTML = `
      <h3 style="margin:0 0 16px;font-size:16px;display:flex;align-items:center;gap:8px;">⚙️ 转存设置</h3>
      <div style="margin-bottom:14px;">
        <b>115 Cookie</b>
        <input id="g4k-cookie" type="password" placeholder="UID=xxx;CID=xxx;SEID=xxx;..."
          style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;margin-top:6px;">
        <div style="font-size:11px;color:#999;margin-top:4px;">从浏览器开发者工具中获取</div>
      </div>
      <div style="margin-bottom:14px;">
        <b>目标文件夹 CID</b>
        <input id="g4k-cid" type="text" placeholder="0 = 根目录"
          style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;margin-top:6px;">
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:18px;cursor:pointer;">
        <input id="g4k-auto-single" type="checkbox" style="width:14px;height:14px;">
        <span>当内容页仅有 1 个资源时自动转存</span>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="g4k-cancel" style="padding:7px 18px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;">取消</button>
        <button id="g4k-save" style="padding:7px 18px;border:none;border-radius:8px;background:linear-gradient(135deg,#1976d2,#1565c0);color:#fff;cursor:pointer;font-weight:600;font-size:13px;">保存</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    setTimeout(() => {
      document.getElementById('g4k-cookie').value = GM_getValue('115_cookie', '');
      document.getElementById('g4k-cid').value = GM_getValue('115_cid', '0');
      document.getElementById('g4k-auto-single').checked = GM_getValue('auto_single_transfer', true);
    }, 30);

    document.getElementById('g4k-cancel').onclick = () => overlay.remove();
    document.getElementById('g4k-save').onclick = () => {
      GM_setValue('115_cookie', document.getElementById('g4k-cookie').value.trim());
      GM_setValue('115_cid', document.getElementById('g4k-cid').value.trim() || '0');
      GM_setValue('auto_single_transfer', document.getElementById('g4k-auto-single').checked);
      Toast.show('设置已保存', 'success');
      overlay.remove();
    };

    overlay.onclick = event => {
      if (event.target === overlay) overlay.remove();
    };
  }

  function addSettingsButton() {
    if (document.getElementById('g4k-setting-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'g4k-setting-fab';
    fab.innerHTML = '⚙️';
    fab.title = '转存设置';
    Object.assign(fab.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 99998,
      width: '42px', height: '42px', borderRadius: '50%',
      background: 'linear-gradient(135deg,#1976D2,#1565C0)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '18px', cursor: 'pointer', userSelect: 'none',
      boxShadow: '0 2px 10px rgba(0,0,0,.2)', transition: 'all .2s',
    });

    fab.onmouseenter = () => {
      fab.style.transform = 'scale(1.1)';
    };
    fab.onmouseleave = () => {
      fab.style.transform = '';
    };
    fab.onclick = () => showSettings();

    document.body.appendChild(fab);
  }


  const SequenceNavigator = {
    state: { enabled: false, sid: '', queue: [], current: -1 },
    pollTimer: null,
    openedTabRef: null,

    normalizeHref(href) {
      const url = new URL(href, location.origin);
      url.search = '';
      url.hash = '';
      return url.toString();
    },

    getCard(anchor) {
      return anchor.closest('.module-item, .module-card-item, .module-list-item') || anchor;
    },

    getMovieItems() {
      const anchors = [...document.querySelectorAll('a[href*="/down/"]')]
        .filter(a => a.closest('.module-item, .module-card-item, .module-list-item'));

      const seenCard = new WeakSet();
      const items = [];
      anchors.forEach(anchor => {
        const card = this.getCard(anchor);
        if (seenCard.has(card)) return;
        seenCard.add(card);
        const href = anchor.getAttribute('href');
        if (!href) return;
        items.push({ anchor, card, href: this.normalizeHref(href) });
      });
      return items;
    },

    ensureBadge(card) {
      let badge = card.querySelector('.g4k-seq-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'g4k-seq-badge';
        card.appendChild(badge);
      }
      return badge;
    },

    clearBadges() {
      document.querySelectorAll('.g4k-seq-badge').forEach(el => el.remove());
      document.querySelectorAll('.g4k-seq-card').forEach(el => el.classList.remove('g4k-seq-card'));
    },

    renderOutline() {
      this.getMovieItems().forEach(item => {
        item.card.classList.add('g4k-seq-card');
      });
    },

    saveState() {
      GM_setValue(CONFIG.seqStateKey, this.state);
    },

    loadState() {
      const raw = GM_getValue(CONFIG.seqStateKey, null);
      if (raw && raw.sid) this.state = raw;
    },

    reset(clearPersist = true) {
      this.state = { enabled: false, sid: '', queue: [], current: -1 };
      this.openedTabRef = null;
      this.clearBadges();
      if (clearPersist) {
        GM_setValue(CONFIG.seqStateKey, null);
      }
      this.updatePanel();
    },

    updatePanel() {
      const startBtn = document.getElementById('g4k-seq-start');
      const stopBtn = document.getElementById('g4k-seq-stop');
      const status = document.getElementById('g4k-seq-status');
      if (!startBtn || !stopBtn || !status) return;
      startBtn.style.display = this.state.enabled ? 'none' : 'inline-block';
      stopBtn.style.display = this.state.enabled ? 'inline-block' : 'none';
      status.textContent = this.state.enabled
        ? `已开启，当前进度 ${Math.max(this.state.current + 1, 0)}/${this.state.queue.length}`
        : '未开启';
    },

    start() {
      this.state.enabled = true;
      this.state.sid = `sid_${Date.now()}`;
      this.state.queue = [];
      this.state.current = -1;
      this.openedTabRef = null;
      this.saveState();
      this.renderOutline();
      this.updatePanel();
      Toast.show('请点击任意影片作为起点，将按顺序新标签打开', 'info', 3000);
    },

    openCurrent() {
      if (!this.state.enabled) return;
      const url = this.state.queue[this.state.current];
      if (!url) {
        Toast.show('队列已完成', 'success', 2600);
        this.reset();
        return;
      }
      const target = withSeqParams(url, this.state.sid, this.state.current);
      this.openedTabRef = window.open(target, '_blank');
      this.saveState();
      this.updatePanel();
      Toast.show(`已打开第 ${this.state.current + 1} 部`, 'process', 1800);
    },

    startFromAnchor(anchor) {
      const items = this.getMovieItems();
      const clickedCard = this.getCard(anchor);
      const idx = items.findIndex(item => item.card === clickedCard);
      if (idx < 0) return;

      this.state.queue = items.slice(idx).map(item => item.href);
      this.state.current = 0;
      this.clearBadges();
      items.slice(idx).forEach((item, i) => {
        item.card.classList.add('g4k-seq-card');
        const badge = this.ensureBadge(item.card);
        badge.textContent = String(i + 1);
      });

      this.saveState();
      this.updatePanel();
      this.openCurrent();
    },

    openNext() {
      this.state.current += 1;
      this.openedTabRef = null;
      this.saveState();
      if (this.state.current >= this.state.queue.length) {
        Toast.show('顺序浏览完成', 'success', 3000);
        this.reset();
        return;
      }
      this.openCurrent();
    },

    maybeOpenNextByTabClose() {
      if (!this.state.enabled || this.state.current < 0) return;
      if (!this.openedTabRef) return;
      if (!this.openedTabRef.closed) return;
      this.openNext();
    },

    maybeOpenNextByCloseSignal() {
      if (!this.state.enabled || this.state.current < 0) return;
      const closed = GM_getValue(CONFIG.seqCloseKey, null);
      if (!closed || closed.sid !== this.state.sid) return;
      if (closed.idx !== this.state.current) return;
      GM_setValue(CONFIG.seqCloseKey, null);
      this.openNext();
    },

    bindEvents() {
      document.addEventListener('click', event => {
        if (!this.state.enabled) return;
        const anchor = event.target.closest('a[href*="/down/"]');
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.state.current === -1) {
          this.startFromAnchor(anchor);
        }
      }, true);

      window.addEventListener('focus', () => {
        this.maybeOpenNextByTabClose();
        this.maybeOpenNextByCloseSignal();
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.maybeOpenNextByTabClose();
          this.maybeOpenNextByCloseSignal();
        }
      });
      this.pollTimer = window.setInterval(() => {
        this.maybeOpenNextByTabClose();
        this.maybeOpenNextByCloseSignal();
      }, 800);
    },

    mountPanel() {
      if (document.getElementById('g4k-seq-panel')) return;
      const panel = document.createElement('div');
      panel.id = 'g4k-seq-panel';
      panel.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;">顺序看片助手</div>
        <div id="g4k-seq-status" style="font-size:12px;color:#ddd;margin-bottom:8px;">未开启</div>
        <div style="display:flex;gap:6px;">
          <button id="g4k-seq-start">开始</button>
          <button id="g4k-seq-stop">停止</button>
        </div>
      `;
      Object.assign(panel.style, {
        position: 'fixed', right: '18px', bottom: '80px', zIndex: 99997,
        background: 'rgba(15,23,42,.9)', color: '#fff', borderRadius: '10px',
        padding: '10px', width: '180px', fontSize: '13px', fontFamily: 'system-ui,sans-serif',
      });
      document.body.appendChild(panel);
      const btnStyle = {
        border: 'none', borderRadius: '6px', cursor: 'pointer', padding: '6px 10px', fontSize: '12px', fontWeight: '700',
      };
      const startBtn = panel.querySelector('#g4k-seq-start');
      const stopBtn = panel.querySelector('#g4k-seq-stop');
      Object.assign(startBtn.style, btnStyle, { background: '#22c55e', color: '#062d16' });
      Object.assign(stopBtn.style, btnStyle, { background: '#ef4444', color: '#fff', display: 'none' });
      startBtn.onclick = () => this.start();
      stopBtn.onclick = () => this.reset();
      this.updatePanel();
    },

    init() {
      this.loadState();
      this.mountPanel();
      this.bindEvents();
      if (this.state.enabled) {
        this.renderOutline();
        const items = this.getMovieItems();
        this.state.queue.forEach((href, i) => {
          const item = items.find(it => it.href === href);
          if (!item) return;
          const badge = this.ensureBadge(item.card);
          badge.textContent = String(i + 1);
        });
      }
    },
  };

  function initDetailCloseReporter() {
    const info = readSeqParams();
    if (!info) return;
    window.addEventListener('beforeunload', () => {
      GM_setValue(CONFIG.seqCloseKey, { sid: info.sid, idx: info.idx, at: Date.now() });
    });
  }

  function injectStyles() {
    if (document.getElementById('g4k-style')) return;
    const style = document.createElement('style');
    style.id = 'g4k-style';
    style.textContent = `
      #g4k-settings input:focus {
        border-color: #1976d2 !important;
        box-shadow: 0 0 0 3px rgba(25,118,210,.1);
        outline: none;
      }
      .g4k-transfer-btn:hover { filter: brightness(1.08); }
      #g4k-select-items label:hover { background: #f8fafe; }
      .g4k-seq-card { outline: 2px dashed #22c55e; outline-offset: 3px; position: relative; }
      .g4k-seq-badge {
        position: absolute; top: 6px; left: 6px; z-index: 3;
        min-width: 24px; height: 24px; line-height: 24px; text-align: center;
        border-radius: 999px; background: #ef4444; color: #fff; font-weight: 800; font-size: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,.35);
      }
    `;
    document.head.appendChild(style);
  }

  function observeListChanges() {
    const root = document.getElementById('download-list');
    if (!root) return;

    const observer = new MutationObserver(() => {
      injectTransferButtons();
    });

    observer.observe(root, { childList: true, subtree: true });
  }

  function init() {
    injectStyles();
    Toast.init();
    SequenceNavigator.init();
  }

  try {
    init();
  } catch (error) {
    console.error('[Grab4K 转存助手] 初始化失败:', error);
  }
})();
