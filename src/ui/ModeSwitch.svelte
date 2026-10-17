<script lang="ts">
  import { t } from '../i18n/en';
  import { appMode } from '../state/site';
  import Tabs from './Tabs.svelte';

  const modes = [
    { id: 'machine', label: t.modeMachine },
    { id: 'site', label: t.modeSite },
  ];
  function setMode(id: string) {
    if (id === 'machine' || id === 'site') appMode.set(id);
  }
</script>

<!-- Tab test ids: mode-machine, mode-site. -->
<div class="mode">
  <Tabs tabs={modes} active={$appMode} onchange={setMode} label={t.modeLabel} testid="mode" panel={false} />
</div>

<style>
  .mode :global(.tab) {
    padding: 4px 12px;
  }
  @media (max-width: 760px) {
    .mode :global(.tab) {
      padding: 4px 8px;
    }
  }
</style>
