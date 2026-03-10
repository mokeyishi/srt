// ==UserScript==
// @name         Grab4K 115 一键转存助手（增强版）
// @version      5.4.0
// @description  在 Grab4K 内容页为 115 资源提供一键/批量转存、单资源自动转存与列表选择转存
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
    batchParam: 'g4k_batch',
    listModeKey: 'g4k_list_batch_mode',
    logKey: 'g4k_transfer_logs',
    logMax: 200,
    batchListParam: 'g4k_list',
    batchIdxParam: 'g4k_idx',
    queueStateKey: 'g4k_batch_queue_state',
    lastDoneKey: 'g4k_batch_last_done',
  };

  if (!CONFIG.siteDomains.some(domain => location.hostname.includes(domain))) return;

  const isDetailPage = /\/down\//.test(location.pathname);
  const urlParams = new URLSearchParams(location.search);
  const isBatchContext = urlParams.get(CONFIG.batchParam) === '1';
  const batchListKeyFromUrl = urlParams.get(CONFIG.batchListParam) || '';
  const batchIdxFromUrl = Number(urlParams.get(CONFIG.batchIdxParam));

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const Batch = {
    readLogs() {
      return GM_getValue(CONFIG.logKey, []);
    },
    appendLog(status, movieTitle, message) {
      const logs = this.readLogs();
      logs.unshift({
        time: new Date().toLocaleString(),
        status,
        movieTitle,
        message,
      });
      GM_setValue(CONFIG.logKey, logs.slice(0, CONFIG.logMax));
    },
  };

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

  function getPageMovieTitle() {
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

    let parsed = null;

    try {
      await navigator.clipboard.writeText('');
    } catch (_) {
      // ignore clipboard clear failure
    }

    copyBtn.click();

    const deadline = Date.now() + CONFIG.clipMaxWait;
    while (!parsed && Date.now() < deadline) {
      await sleep(CONFIG.clipPollInterval);
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          parsed = Utils.parse115Link(text);
        }
      } catch (_) {
        // ignore temporary clipboard read failures
      }
    }

    if (!parsed) {
      Toast.show('未获取到有效 115 链接，请确认浏览器允许剪贴板读取', 'error');
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

    if (isBatchContext) {
      const title = getMovieTitle(row) || getPageMovieTitle();
      if (result?.ok) {
        Batch.appendLog(result.skip ? '跳过' : '成功', title, result.msg);
        if (batchListKeyFromUrl && Number.isFinite(batchIdxFromUrl)) {
          GM_setValue(CONFIG.lastDoneKey, {
            listKey: batchListKeyFromUrl,
            idx: batchIdxFromUrl,
            status: result.skip ? '跳过' : '成功',
            at: Date.now(),
          });
        }
        setTimeout(() => {
          window.close();
        }, 1200);
      } else {
        Batch.appendLog('失败', title, result?.msg || '未获取到链接或转存结果');
      }
    }

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
    if (rows.length !== 1) return;

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
    }, 30);

    document.getElementById('g4k-cancel').onclick = () => overlay.remove();
    document.getElementById('g4k-save').onclick = () => {
      GM_setValue('115_cookie', document.getElementById('g4k-cookie').value.trim());
      GM_setValue('115_cid', document.getElementById('g4k-cid').value.trim() || '0');
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

  function currentListKey() {
    const next = new URL(location.href);
    next.searchParams.delete(CONFIG.batchParam);
    next.searchParams.delete(CONFIG.batchListParam);
    next.searchParams.delete(CONFIG.batchIdxParam);
    return `${next.origin}${next.pathname}${next.search}`;
  }

  function withBatchParam(url, listKey, idx) {
    try {
      const next = new URL(url, location.origin);
      next.searchParams.set(CONFIG.batchParam, '1');
      next.searchParams.set(CONFIG.batchListParam, listKey);
      next.searchParams.set(CONFIG.batchIdxParam, String(idx));
      return next.toString();
    } catch (_) {
      return url;
    }
  }

  function getDetailMovieLinks() {
    const all = [...document.querySelectorAll('a[href]')];
    const seen = new Set();
    const links = [];
    all.forEach(link => {
      const href = link.getAttribute('href') || '';
      if (!/\/vod\/(detail|down)\//.test(href)) return;
      if (href.startsWith('javascript:') || href.startsWith('#')) return;
      const abs = new URL(link.href, location.origin).toString();
      if (seen.has(abs)) return;
      seen.add(abs);
      links.push(link);
    });
    return links;
  }

  function startQueueFromLink(link) {
    const links = getDetailMovieLinks();
    const clickedAbs = new URL(link.href, location.origin).toString();
    const idx = links.findIndex(item => new URL(item.href, location.origin).toString() === clickedAbs);
    if (idx < 0) return;

    const listKey = currentListKey();
    GM_setValue(CONFIG.queueStateKey, {
      running: true,
      listKey,
      currentIdx: idx,
      total: links.length,
      updatedAt: Date.now(),
    });

    Toast.show(`队列已开始：第 ${idx + 1}/${links.length} 部`, 'info', 1800);
    window.open(withBatchParam(link.href, listKey, idx), '_blank', 'noopener');
  }

  function bootQueueWatcher(renderLogs) {
    const listKey = currentListKey();
    let lastSignalAt = 0;

    const tick = () => {
      const state = GM_getValue(CONFIG.queueStateKey, null);
      if (!state?.running || state.listKey !== listKey) return;

      const signal = GM_getValue(CONFIG.lastDoneKey, null);
      if (!signal || signal.listKey !== listKey || signal.at === lastSignalAt) return;
      if (signal.idx !== state.currentIdx) return;

      lastSignalAt = signal.at;
      const links = getDetailMovieLinks();
      const nextIdx = state.currentIdx + 1;
      if (nextIdx >= links.length) {
        GM_setValue(CONFIG.queueStateKey, { ...state, running: false, updatedAt: Date.now() });
        Toast.show(`队列完成：共处理 ${state.currentIdx + 1} 部`, 'success', 2600);
        if (typeof renderLogs === 'function') renderLogs();
        return;
      }

      const nextLink = links[nextIdx];
      GM_setValue(CONFIG.queueStateKey, {
        ...state,
        currentIdx: nextIdx,
        total: links.length,
        updatedAt: Date.now(),
      });
      Toast.show(`继续下一部：${nextIdx + 1}/${links.length}`, 'process', 1600);
      window.open(withBatchParam(nextLink.href, listKey, nextIdx), '_blank', 'noopener');
      if (typeof renderLogs === 'function') renderLogs();
    };

    window.addEventListener('focus', tick);
    setInterval(tick, 1200);
  }

  function renderBatchLogs(container) {
    const logs = Batch.readLogs();
    if (!logs.length) {
      container.innerHTML = '<div style="font-size:12px;color:#888;">暂无日志</div>';
      return;
    }

    container.innerHTML = logs.slice(0, 15).map(item => {
      const color = item.status === '成功' ? '#2e7d32' : item.status === '跳过' ? '#6a1b9a' : '#c62828';
      return `<div style="font-size:12px;line-height:1.45;padding:4px 0;border-bottom:1px dashed #eee;">
        <span style="color:${color};font-weight:700;">${item.status}</span>
        <span style="color:#111;"> + ${item.movieTitle}</span>
        <div style="color:#777;">${item.time} · ${item.message}</div>
      </div>`;
    }).join('');
  }

  function addListBatchPanel() {
    if (document.getElementById('g4k-list-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'g4k-list-panel';
    Object.assign(panel.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 100020,
      width: '320px', background: 'rgba(255,255,255,.96)', border: '1px solid #ddd',
      borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,.2)', padding: '12px',
      fontFamily: 'system-ui,sans-serif',
    });

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <b style="font-size:13px;">筛选页批量转存</b>
        <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input id="g4k-list-mode" type="checkbox"> 一键转存模式
        </label>
      </div>
      <div style="font-size:11px;color:#666;margin-top:6px;">开启后，你点击任意一部影片会启动顺序队列：从当前这部开始，成功关闭后自动打开下一部；单资源自动转存，多资源手动点“ 一键转存 ”。</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <b style="font-size:12px;">转存日志</b>
        <button id="g4k-clear-logs" style="border:1px solid #ddd;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;">清空</button>
      </div>
      <div id="g4k-log-list" style="max-height:190px;overflow:auto;margin-top:6px;"></div>
    `;

    document.body.appendChild(panel);

    const modeEl = panel.querySelector('#g4k-list-mode');
    const listEl = panel.querySelector('#g4k-log-list');
    modeEl.checked = GM_getValue(CONFIG.listModeKey, false);
    renderBatchLogs(listEl);

    modeEl.onchange = () => {
      GM_setValue(CONFIG.listModeKey, modeEl.checked);
      Toast.show(modeEl.checked ? '已开启筛选页一键转存模式' : '已关闭筛选页一键转存模式', 'info', 1800);
    };

    panel.querySelector('#g4k-clear-logs').onclick = () => {
      GM_setValue(CONFIG.logKey, []);
      renderBatchLogs(listEl);
      Toast.show('日志已清空', 'success', 1500);
    };

    document.addEventListener('click', event => {
      if (!GM_getValue(CONFIG.listModeKey, false)) return;
      const target = event.target;
      const link = target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
      if (!/\/vod\/(detail|down)\//.test(href)) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      startQueueFromLink(link);
    }, true);

    bootQueueWatcher(() => renderBatchLogs(listEl));
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
    if (isDetailPage) {
      addSettingsButton();
      injectTransferButtons();
      observeListChanges();
      return;
    }
    addListBatchPanel();
  }

  try {
    init();
  } catch (error) {
    console.error('[Grab4K 转存助手] 初始化失败:', error);
  }
})();
