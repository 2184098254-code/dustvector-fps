import { mount } from './assets/moments/moments.js';
window.addEventListener('dustvector-results', event => {
  event.detail.previous.__moment?.destroy?.();
  mount(document.getElementById('result-stats')).catch(() => {});
});
