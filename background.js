let activeTabs = new Set();

const __OSS_TOKEN = "OSS-NOTICE-3E5F8A7C-2025-09";
let __OSS_OK = false;
(async function __verifyOssNoticeBG() {
  try {
    const mf = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
    if (!mf || mf.x_oss_notice !== __OSS_TOKEN) throw new Error("manifest x_oss_notice missing or changed");
    const res = await fetch(chrome.runtime.getURL("NOTICE.txt"));
    const txt = await res.text();
    if (!txt || !txt.includes(__OSS_TOKEN)) throw new Error("NOTICE token mismatch");
    __OSS_OK = true;
  } catch (e) {
    console.error("OSS Notice verification failed (background):", e && e.message ? e.message : e);
    __OSS_OK = false;
  }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!__OSS_OK) { try { sendResponse({ success: false, error: 'OSS Notice verification failed' }); } catch (_) {} return true; }
  if (request.action === 'cleanup') {
    cleanupAll();
  }
  if (request.action === 'fetchDetail') {
    let responseReceived = false;
    let timeoutId = null;

    const cleanup = (tab) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (tab && tab.id) {
        activeTabs.delete(tab.id);
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    };

    const waitForFullLoad = async (tabId) => {
      // 等待页面基本加载完成
      await new Promise((resolve, reject) => {
        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => reject(new Error('页面加载超时')), 15000);
      });

      // 等待关键元素出现
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 20;
            const checkElements = () => {
              const price = document.querySelector('[class*="price"]');
              const userInfo = document.querySelector('[class*="user-info"]');
              const mainContent = document.querySelector('#content');
              const description = document.querySelector('[class*="desc--"]') || document.querySelector('[class*="notLoginContainer"] [class*="main"]');

              if (price && userInfo && mainContent && description) {
                resolve();
              } else {
                attempts++;
                if (attempts >= maxAttempts) {
                  reject(new Error('关键元素加载超时'));
                } else {
                  setTimeout(checkElements, 500);
                }
              }
            };
            checkElements();
          });
        }
      });

      // 等待高清轮播图加载；失败不阻断详情采集，但后续不会回退低清图
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          function hasHighQualityCarouselImage() {
            return Array.from(document.querySelectorAll('[class*="carouselItem"] img')).some(img => {
              const url = img.currentSrc || img.src || img.dataset.src || '';
              return img.naturalWidth >= 700 || url.includes('_790x10000Q90');
            });
          }

          function waitForHighQualityCarousel(timeoutMs) {
            return new Promise(resolve => {
              const start = Date.now();
              const check = () => {
                if (hasHighQualityCarouselImage()) {
                  resolve(true);
                  return;
                }
                if (Date.now() - start >= timeoutMs) {
                  resolve(false);
                  return;
                }
                setTimeout(check, 500);
              };
              check();
            });
          }

          return (async () => {
            if (await waitForHighQualityCarousel(8000)) {
              return true;
            }

            window.scrollBy({ top: 1, left: 0, behavior: 'auto' });
            await new Promise(resolve => setTimeout(resolve, 500));
            window.scrollBy({ top: -1, left: 0, behavior: 'auto' });
            return waitForHighQualityCarousel(8000);
          })();
        }
      }).catch(error => {
        console.warn('高清轮播图等待失败:', error && error.message ? error.message : error);
      });
    };

    async function createTab(url) {
      // 创建新标签页时添加随机延迟
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

      return chrome.tabs.create({
        url: url,
        active: false
      });
    }

    (async () => {
      let tab = null;
      try {
        // 设置45秒总超时，给高清轮播图加载与一次重试留出时间
        timeoutId = setTimeout(() => {
          if (!responseReceived) {
            cleanup(tab);
            responseReceived = true;
            sendResponse({ success: false, error: '获取详情超时' });
          }
        }, 45000);

        // 创建新标签页
        tab = await createTab(request.url);
        activeTabs.add(tab.id);

        // 等待页面完全加载
        await waitForFullLoad(tab.id);

        // 执行数据采集脚本
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selectors = {
              location: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-user-container--fbTUeNre > a > div > div.item-user-info-text--tKOlwunK > div.item-user-info-intro--ZN1A0_8Y > div:nth-child(1)',
                backup: [
                  '[class*="item-user-info-intro"] div:first-child',
                  '[class*="user-info"] [class*="location"]'
                ]
              },
			   coverImage: {
			      primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-pic-container--G6nYF3fX > div > img',
			      backup: [
			        '[class*="item-pic-container"] img',
			        '[class*="main-img"]',
			        'img[src*="item_pic"]'
			      ]
			    },
              wantCount: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-main-info--ExVwW2NW > div.tips--bJdC_yBS > div.want--ecByv3Sr > div:nth-child(1)',
                backup: [
                  '[class*="tips"] [class*="want"] > div:first-child',
                  'div[class*="want"] > div:first-child'
                ]
              },
              viewCount: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-main-info--ExVwW2NW > div.tips--bJdC_yBS > div.want--ecByv3Sr > div:nth-child(3)',
                backup: [
                  '[class*="tips"] [class*="want"] > div:nth-child(3)',
                  'div[class*="want"] > div:nth-child(3)'
                ]
              },
              price: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-main-container--jhpFKlaS > div.item-main-info--ExVwW2NW > div:nth-child(1) > div > div.price--OEWLbcxC.windows--oJroL99y',
                backup: [
                  '[class*="price"]',
                  'div[class*="price"]'
                ]
              },
              shopName: {
                primary: '#content > div.item-container--yLJD5VZj > div.item-user-container--fbTUeNre > a > div > div.item-user-info-text--tKOlwunK > div.item-user-info-main--iHQtqVC2 > div.item-user-info-nick--rtpDhkmQ',
                backup: [
                  '[class*="user-info-nick"]',
                  '[class*="nick"]'
                ]
              },
              description: {
                primary: '[class*="desc--"]',
                backup: [
                  '[class*="notLoginContainer"] [class*="main"] > div',
                  '[class*="main"] > div'
                ]
              },
              images: {
                primary: collectHighQualityCarouselImages(),
                backup: []
              }
            };

            function getOriginalImageKey(url) {
              return String(url || '')
                .replace(/^https?:\/\//, '')
                .replace(/^\/\//, '')
                .replace(/_\d+x\d+Q?\d*\.jpg_\.webp$/i, '')
                .replace(/_\d+x\d+\.jpg_\.webp$/i, '')
                .replace(/_\d+x10000Q?\d*\.jpg_\.webp$/i, '')
                .replace(/_\d+x10000\.jpg_\.webp$/i, '');
            }

            function collectHighQualityCarouselImages() {
              const seen = new Set();
              return Array.from(document.querySelectorAll('[class*="carouselItem"] img'))
                .filter(img => !img.closest('[class*="slick-cloned"]'))
                .map(img => {
                  const url = img.currentSrc || img.src || img.dataset.src || '';
                  return {
                    url,
                    key: getOriginalImageKey(url),
                    isHighQuality: img.naturalWidth >= 700 || url.includes('_790x10000Q90')
                  };
                })
                .filter(item => {
                  if (!item.url || !item.isHighQuality || !item.key || seen.has(item.key)) {
                    return false;
                  }
                  seen.add(item.key);
                  return true;
                })
                .map(item => item.url);
            }

            function findElement(selectorConfig) {
              let element = document.querySelector(selectorConfig.primary);
              if (element) {
                console.log('使用主选择器成功');
                return element;
              }

              for (const backupSelector of selectorConfig.backup) {
                element = document.querySelector(backupSelector);
                if (element) {
                  console.log('使用备用选择器成功:', backupSelector);
                  return element;
                }
              }

              console.log('所有选择器都失败');
              return null;
            }

            const details = {};
            for (const [key, selectorConfig] of Object.entries(selectors)) {
              if (key === 'images') {
                const seen = new Set();
                details[key] = (selectorConfig.primary || []).filter(url => {
                  if (!url || seen.has(url)) return false;
                  seen.add(url);
                  return true;
                });
              } else if (key === 'description') {
                const element = findElement(selectorConfig);
                details[key] = element ? (element.innerText || element.textContent || '').trim() : '';
                console.log(key + ':', details[key] ? details[key].substring(0, 80) + '...' : '未找到');
              } else {
                const element = findElement(selectorConfig);
                details[key] = element ? element.textContent.trim() : '';
                console.log(key + ':', details[key] || '未找到');
              }
            }

            return details;
          }
        });

        if (!responseReceived) {
          responseReceived = true;
          sendResponse({ success: true, details: result.result });
        }

        cleanup(tab);
      } catch (error) {
        console.error('获取详情失败:', error);
        if (!responseReceived) {
          responseReceived = true;
          sendResponse({ success: false, error: error.message });
        }
        cleanup(tab);
      }
    })();

    return true; // 保持消息通道开启
  }
});

function cleanupAll() {
  for (const tabId of activeTabs) {
    chrome.tabs.remove(tabId).catch(() => {});
  }
  activeTabs.clear();
}

chrome.runtime.onSuspend.addListener(cleanupAll);
