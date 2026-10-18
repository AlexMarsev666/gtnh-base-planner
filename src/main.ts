import { mount } from 'svelte';
import { loadCatalog } from './data/catalog';
import { defaultPlan, plan } from './state/store';
import App from './ui/App.svelte';
import './styles/global.css';

// The e2e harness pages share chunks with this entry; only mount where the app root exists.
const target = document.getElementById('app');
if (target) {
  // Everything reads the catalog synchronously, so it must be loaded before the app starts.
  loadCatalog()
    .then(() => {
      // The plan store was created before the catalog existed; the stored plan is restored on mount, after this.
      plan.set(defaultPlan());
      mount(App, { target });
    })
    .catch((err: unknown) => {
      console.error(err);
      const p = document.createElement('p');
      p.textContent = 'The multiblock data could not be loaded. Check your connection and reload the page.';
      const reload = document.createElement('button');
      reload.textContent = 'Reload';
      reload.onclick = () => location.reload();
      target.replaceChildren(p, reload);
    });
}
