const FIELD_DEFS = [
  { key: 'index', label: '序号' },
  { key: 'coverImage', label: '商品封面' },
  { key: 'url', label: '商品链接' },
  { key: 'location', label: '发布地' },
  { key: 'wantCount', label: '想要数' },
  { key: 'viewCount', label: '浏览量' },
  { key: 'price', label: '价格' },
  { key: 'shopName', label: '店铺名称' },
  { key: 'description', label: '产品文案' }
];

const STORAGE_KEY = 'exportFields';

document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('fieldsGrid');
  const status = document.getElementById('status');

  // Load saved config
  let config = {};
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    config = result[STORAGE_KEY] || {};
  } catch (e) {
    console.error('加载配置失败:', e);
  }

  // Ensure all fields exist in config (default: all visible)
  FIELD_DEFS.forEach(f => {
    if (!(f.key in config)) config[f.key] = true;
  });

  // Render checkboxes (no auto-save)
  FIELD_DEFS.forEach(f => {
    const label = document.createElement('label');
    label.className = 'field-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = config[f.key];
    cb.dataset.key = f.key;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(f.label));
    grid.appendChild(label);
  });

  // Select all (no auto-save)
  document.getElementById('selectAll').addEventListener('click', () => {
    grid.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });

  // Deselect all (no auto-save)
  document.getElementById('deselectAll').addEventListener('click', () => {
    grid.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });

  // Manual save
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const data = {};
    grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      data[cb.dataset.key] = cb.checked;
    });
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
      status.textContent = '已保存 ' + new Date().toLocaleTimeString();
      status.className = 'status saved';
      setTimeout(() => { status.className = 'status'; }, 2000);
    } catch (e) {
      status.textContent = '保存失败';
      status.className = 'status error';
    }
  });
});
