(function (root) {
  const themes = [
    { id: 'mint', name: '深海薄荷' },
    { id: 'latte', name: '奶油拿铁' },
    { id: 'blue', name: '午夜冰蓝' },
    { id: 'iris', name: '暮色鸢尾' }
  ];
  function normalize(value) { return themes.some(theme => theme.id === value) ? value : 'mint'; }
  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    return theme;
  }
  const api = { themes, normalize, apply };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetThemes = api;
})(globalThis);
