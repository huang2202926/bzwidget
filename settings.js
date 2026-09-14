const $ = id => document.getElementById(id);

let config = null;

async function load() {
  config = await window.electronAPI.getConfig();
  showTheme(config.theme);

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

function showTheme(theme) {
  const selected = WidgetThemes.apply(theme);
  for (const button of $('themePicker').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === selected));
  }
}

let themeSaving = false;
async function selectTheme(theme) {
  if (!config || themeSaving) return;
  themeSaving = true;
  const buttons = $('themePicker').querySelectorAll('button');
  buttons.forEach(button => { button.disabled = true; });
  $('btnSave').disabled = true;
  $('btnCancel').disabled = true;
  const previous = config.theme;
  showTheme(theme);
  try {
    const saved = await window.electronAPI.setConfig({ theme });
    config.theme = saved.theme;
    showTheme(saved.theme);
    $('themeMessage').textContent = '皮肤已自动保存。其他设置请点击底部“保存”。';
  } catch (error) {
    showTheme(previous);
    $('themeMessage').textContent = '皮肤保存失败，请重试。';
  } finally {
    themeSaving = false;
    buttons.forEach(button => { button.disabled = false; });
    $('btnSave').disabled = false;
    $('btnCancel').disabled = false;
  }
}

for (const theme of WidgetThemes.themes) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-choice';
  button.dataset.theme = theme.id;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', theme.name);
  button.textContent = theme.name;
  const sample = document.createElement('span');
  sample.className = 'theme-sample';
  sample.textContent = '¥ 313.47';
  sample.setAttribute('aria-hidden', 'true');
  const line = document.createElement('span');
  line.className = 'theme-line';
  line.setAttribute('aria-hidden', 'true');
  button.append(sample, line);
  button.addEventListener('click', () => selectTheme(theme.id));
  $('themePicker').append(button);
}

$('btnOpenAdmin').addEventListener('click', () => {
  window.electronAPI.openAdmin();
});

$('opacity').addEventListener('input', () => {
  $('opacityValue').textContent = $('opacity').value;
});

$('btnSave').addEventListener('click', async () => {
  const newConfig = gatherConfig();
  try {
    await window.electronAPI.setConfig(newConfig);
    window.close();
  } catch (error) {
    $('themeMessage').textContent = '设置保存失败，请重试。';
  }
});

$('btnCancel').addEventListener('click', () => {
  window.close();
});

load();
