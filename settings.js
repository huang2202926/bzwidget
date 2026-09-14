const $ = id => document.getElementById(id);

let config = null;

async function load() {
  config = await window.electronAPI.getConfig();

  $('dataSource').value = config.dataSource || 'api';
  $('apiUrl').value = config.apiUrl || '';
  $('apiHeaders').value = config.apiHeaders || '';
  $('refreshInterval').value = config.refreshInterval || 10000;
  $('alwaysOnTop').checked = config.alwaysOnTop !== false;
  $('opacity').value = config.opacity ?? 0.95;
  $('opacityValue').textContent = config.opacity ?? 0.95;

  toggleApiFields();
}

function toggleApiFields() {
  const isApi = $('dataSource').value === 'api';
  $('apiFields').classList.toggle('active', isApi);
}

function gatherConfig() {
  return {
    dataSource: $('dataSource').value,
    apiUrl: $('apiUrl').value.trim(),
    apiHeaders: $('apiHeaders').value.trim(),
    refreshInterval: parseInt($('refreshInterval').value, 10) || 10000,
    alwaysOnTop: $('alwaysOnTop').checked,
    opacity: parseFloat($('opacity').value)
  };
}

$('dataSource').addEventListener('change', toggleApiFields);

$('btnOpenAdmin').addEventListener('click', () => {
  window.electronAPI.openAdmin();
});

$('opacity').addEventListener('input', () => {
  $('opacityValue').textContent = $('opacity').value;
});

$('btnSave').addEventListener('click', async () => {
  const newConfig = gatherConfig();
  await window.electronAPI.setConfig(newConfig);
  window.close();
});

$('btnCancel').addEventListener('click', () => {
  window.close();
});

load();
