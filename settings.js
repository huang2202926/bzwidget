const $ = id => document.getElementById(id);

let config = null;
let lang = 'zh';

function T(key, params) {
  return WidgetI18n.t(key, lang, params);
}

/* 语言由主进程解析（effectiveLanguage）：auto = 跟随系统 */
function syncLang(next) {
  lang = WidgetI18n.resolve(next?.effectiveLanguage ?? next?.language, navigator.language);
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
}

/* 把带 data-i18n 的元素文案刷成当前语言（placeholder 用 data-i18n-ph） */
function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = T(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = T(el.dataset.i18nPh);
  }
  document.title = T('app.settingsTitle');
}

async function load() {
  config = await window.electronAPI.getConfig();
  syncLang(config);
  applyI18n();
  showTheme(config.theme);
  showLanguage(config.language);

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

/* ---------------- 皮肤 ---------------- */

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
    $('themeMessage').textContent = T('settings.themeSaved');
  } catch (error) {
    showTheme(previous);
    $('themeMessage').textContent = T('settings.themeFailed');
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

/* ---------------- 界面语言 ---------------- */

/* 选项：跟随系统 / 简体中文 / English（语言名一律用其本族写法，不翻译） */
function languageOptions() {
  return [
    { id: 'auto', key: 'settings.languageAuto' },
    ...WidgetI18n.langs.map(l => ({ id: l.id, text: l.name }))
  ];
}

function showLanguage(selected) {
  const value = WidgetI18n.normalize(selected);
  for (const button of $('languagePicker').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === value));
  }
}

function renderLanguagePicker() {
  const picker = $('languagePicker');
  picker.textContent = '';
  for (const option of languageOptions()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lang-choice';
    button.dataset.language = option.id;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = option.text || T(option.key);
    button.addEventListener('click', () => selectLanguage(option.id));
    picker.append(button);
  }
}

let langSaving = false;
async function selectLanguage(value) {
  if (!config || langSaving) return;
  langSaving = true;
  const buttons = $('languagePicker').querySelectorAll('button');
  buttons.forEach(button => { button.disabled = true; });
  $('btnSave').disabled = true;
  $('btnCancel').disabled = true;
  const previous = config.language;
  showLanguage(value);
  try {
    const saved = await window.electronAPI.setConfig({ language: value });
    config.language = saved.language;
    // 先切语言、再刷全部文案，最后写提示，保证提示本身也是新语言
    syncLang(saved);
    renderLanguagePicker();
    applyI18n();
    showLanguage(saved.language);
    $('languageMessage').textContent = T('settings.languageSaved');
  } catch (error) {
    config.language = previous;
    syncLang(config);
    renderLanguagePicker();
    applyI18n();
    showLanguage(previous);
    $('languageMessage').textContent = T('settings.languageFailed');
  } finally {
    langSaving = false;
    buttons.forEach(button => { button.disabled = false; });
    $('btnSave').disabled = false;
    $('btnCancel').disabled = false;
  }
}

renderLanguagePicker();

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
    $('languageMessage').textContent = T('settings.saveFailed');
  }
});

$('btnCancel').addEventListener('click', () => {
  window.close();
});

load();
