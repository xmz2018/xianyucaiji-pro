document.addEventListener('DOMContentLoaded', () => {
  // --- DOM refs ---
  const startButton = document.getElementById('startCollect');
  const tabAuto = document.getElementById('tabAuto');
  const tabManual = document.getElementById('tabManual');
  const autoConfig = document.getElementById('autoConfig');
  const manualConfig = document.getElementById('manualConfig');

  const keywordInput = document.getElementById('keyword');
  const pageCountInput = document.getElementById('pageCount');
  const collectDetailCheckbox = document.getElementById('collectDetail');
  const exportTypeEl = document.getElementById('exportType');
  const concurrentCountEl = document.getElementById('concurrentCount');

  const concurrentCountManual = document.getElementById('concurrentCountManual');
  const collectDetailManual = document.getElementById('collectDetailManual');
  const collectImagesManual = document.getElementById('collectImagesManual');
  const exportTypeManual = document.getElementById('exportTypeManual');

  const collectImagesCheckbox = document.getElementById('collectImages');

  const tabLink = document.getElementById('tabLink');
  const linkConfig = document.getElementById('linkConfig');
  const linkInput = document.getElementById('linkInput');
  const collectDetailLink = document.getElementById('collectDetailLink');
  const collectImagesLink = document.getElementById('collectImagesLink');
  const exportTypeLink = document.getElementById('exportTypeLink');

  const progressContainer = document.getElementById('progress');
  const progressText = document.querySelector('.progress-text');
  const progressStatus = document.querySelector('.progress-status');
  const progressFill = document.querySelector('.progress-fill');
  const logOutput = document.getElementById('logOutput');
  const clearLogButton = document.getElementById('clearLog');

  let currentMode = 'auto'; // 'auto' | 'manual'
  let selectedFields = null; // 从 storage 加载的导出字段配置

  // --- 加载字段配置 ---
  (async function loadFieldConfig() {
    try {
      const result = await chrome.storage.local.get('exportFields');
      if (result.exportFields) {
        selectedFields = Object.keys(result.exportFields).filter(k => result.exportFields[k]);
      }
    } catch (e) { /* 忽略，使用默认全部字段 */ }
  })();

  // --- 打开选项页 ---
  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // --- Mode switching ---
  function switchMode(mode) {
    currentMode = mode;
    if (mode === 'auto') {
      tabAuto.classList.add('active');
      tabManual.classList.remove('active');
      tabLink.classList.remove('active');
      autoConfig.style.display = '';
      manualConfig.style.display = 'none';
      linkConfig.style.display = 'none';
      startButton.textContent = '开始采集';
      startButton.disabled = false;
      progressContainer.style.display = 'none';
    } else if (mode === 'manual') {
      tabManual.classList.add('active');
      tabAuto.classList.remove('active');
      tabLink.classList.remove('active');
      autoConfig.style.display = 'none';
      manualConfig.style.display = '';
      linkConfig.style.display = 'none';
      startButton.textContent = '开启勾选模式';
      startButton.disabled = false;
      progressContainer.style.display = 'none';
    } else {
      tabLink.classList.add('active');
      tabAuto.classList.remove('active');
      tabManual.classList.remove('active');
      autoConfig.style.display = 'none';
      manualConfig.style.display = 'none';
      linkConfig.style.display = '';
      startButton.textContent = '开始采集';
      startButton.disabled = false;
      progressContainer.style.display = 'none';
    }
  }

  tabAuto.addEventListener('click', () => switchMode('auto'));
  tabManual.addEventListener('click', () => switchMode('manual'));
tabLink.addEventListener('click', () => switchMode('link'));

  // --- Helpers ---
  function waitForPageLoad(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  }

  async function injectAndWaitForContentScript(tabId) {
    try {
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        return;
      } catch (error) {
        console.log('需要注入 content script');
      }
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
      console.error('注入脚本失败:', error);
      throw error;
    }
  }

  function updateProgress(current, total, status = '') {
    progressContainer.style.display = 'block';
    progressStatus.textContent = `${current}/${total}`;
    const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    if (status) {
      progressText.textContent = status;
    }
  }

  function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    logOutput.value += `[${timestamp}] ${message}\n`;
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  clearLogButton.addEventListener('click', () => {
    logOutput.value = '';
  });

  // --- 链接提取 ---
  function extractItemUrl(text) {
    // Try m.tb.cn short link
    var m = text.match(/https?:\/\/m\.tb\.cn\/[^\s]+/i);
    if (m) return m[0];

    // Try h5.m.goofish.com/item long link
    m = text.match(/https?:\/\/h5\.m\.goofish\.com\/item[^\s]*/i);
    if (m) {
      var idMatch = m[0].match(/[?&](?:id|itemId)=([^&\s]+)/i);
      if (idMatch) {
        return 'https://www.goofish.com/item?id=' + idMatch[1];
      }
      return m[0];
    }

    // Try www.goofish.com direct link
    m = text.match(/https?:\/\/(?:www\.)?goofish\.com\/item[^\s]*/i);
    if (m) return m[0];

    return null;
  }

  // --- Start button handler ---
  startButton.addEventListener('click', async () => {
    if (currentMode === 'manual') {
      // --- 手动勾选模式 ---
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.url.includes('goofish.com') && !tab.url.includes('idle.fish')) {
          log('请先打开闲鱼搜索页面，手动搜索后再使用勾选模式');
          return;
        }

        await injectAndWaitForContentScript(tab.id);

        const concurrentCount = parseInt(concurrentCountManual.value) || 3;
        const collectDetail = collectDetailManual.checked;
        const collectImages = collectImagesManual ? collectImagesManual.checked : false;
        const exportType = exportTypeManual ? exportTypeManual.value : 'csv';

        await chrome.tabs.sendMessage(tab.id, {
          action: 'enableSelectMode',
          collectDetail: collectDetail,
          collectImages: collectImages,
          selectedFields: selectedFields,
          concurrentCount: concurrentCount,
          exportType: exportType
        });

        startButton.textContent = '勾选模式已开启';
        startButton.disabled = true;
        log('勾选模式已开启，请在页面中勾选商品，完成后点击底部"确认采集"');
      } catch (error) {
        log(`开启勾选模式失败: ${error.message}`);
      }
      return;
    }

    if (currentMode === 'link') {
      // --- 单链接采集模式 ---
      try {
        var linkText = linkInput.value.trim();
        if (!linkText) {
          log('请粘贴闲鱼商品链接或分享文案');
          return;
        }

        var itemUrl = extractItemUrl(linkText);
        if (!itemUrl) {
          log('未识别到有效的闲鱼商品链接');
          return;
        }
        log('识别到链接: ' + itemUrl);

        var collectDetail = collectDetailLink.checked;
        var collectImages = collectImagesLink ? collectImagesLink.checked : false;
        var exportType = exportTypeLink ? exportTypeLink.value : 'csv';

        startButton.textContent = '采集中...';
        startButton.disabled = true;
        progressContainer.style.display = 'block';
        progressText.textContent = '正在采集商品详情...';
        progressFill.style.width = '0%';

        var [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await injectAndWaitForContentScript(tab.id);

        var response = await chrome.tabs.sendMessage(tab.id, {
          action: 'collectSingle',
          url: itemUrl,
          collectDetail: collectDetail,
          collectImages: collectImages,
          exportType: exportType,
          selectedFields: selectedFields
        });

        if (response && response.success) {
          startButton.textContent = '采集完成';
          log('单链接采集完成');
        } else {
          log('采集失败: ' + (response ? response.error : '未知错误'));
        }
      } catch (error) {
        log('采集失败: ' + error.message);
      } finally {
        startButton.disabled = false;
        setTimeout(function() { startButton.textContent = '开始采集'; }, 2000);
      }
      return;
    }

    // --- 全量采集模式（原有逻辑）---
    try {
      const keyword = keywordInput.value.trim();
      if (!keyword) {
        log('请输入搜索关键词');
        return;
      }

      log(`开始采集关键词: ${keyword}`);

      const pageCount = parseInt(pageCountInput.value) || 10;
      if (pageCount < 1 || pageCount > 100) {
        log('页数必须在1-100之间');
        return;
      }

      const collectDetail = collectDetailCheckbox.checked;
      const collectImages = collectImagesCheckbox ? collectImagesCheckbox.checked : false;
      const exportType = exportTypeEl ? exportTypeEl.value : 'csv';

      startButton.textContent = '采集中...';
      startButton.disabled = true;
      progressContainer.style.display = 'block';
      progressText.textContent = '正在采集商品链接...';
      progressFill.style.width = '0%';
      progressStatus.textContent = '0/0';

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url.includes('goofish.com') && !tab.url.includes('idle.fish')) {
        const searchUrl = `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`;
        await chrome.tabs.update(tab.id, { url: searchUrl });
        await waitForPageLoad(tab.id);
      }

      await injectAndWaitForContentScript(tab.id);

      if (tab.url.includes('goofish.com') || tab.url.includes('idle.fish')) {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'search',
          keyword: keyword
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const concurrentCount = parseInt(concurrentCountEl.value) || 3;

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'collect',
        pageCount: pageCount,
        keyword: keyword,
        collectDetail: collectDetail,
        collectImages: collectImages,
        selectedFields: selectedFields,
        concurrentCount: concurrentCount,
        exportType: exportType
      });

      if (response?.links?.length > 0) {
        if (collectDetail) {
          log('详细数据已导出');
        }
        startButton.textContent = `成功采集 ${response.links.length} 个商品`;
        log(`采集完成，共 ${response.links.length} 个商品`);
      } else {
        log('未找到商品链接，请确保在闲鱼搜索结果页面');
      }
    } catch (error) {
      log(`采集失败: ${error.message}`);
    } finally {
      startButton.disabled = false;
      setTimeout(() => {
        startButton.textContent = '开始采集';
      }, 2000);
    }
  });

  // --- 监听来自 content.js 的消息 ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'log') {
      log(request.message);
    }
    if (request.action === 'progress') {
      const { current = 0, total = 0, status = '' } = request;
      updateProgress(current, total, status);
    }
    if (request.action === 'selectionComplete') {
      log(`手动采集完成，共 ${request.count || 0} 个商品已导出`);
      startButton.textContent = '开启勾选模式';
      startButton.disabled = false;
      progressContainer.style.display = 'none';
    }
  });
});
