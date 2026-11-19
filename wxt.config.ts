import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Keep imports explicit so every file says where things come from.
  imports: false,
  manifest: {
    name: 'Margin Notes',
    description: 'Highlight, annotate and clip passages while you read on the web.',
    permissions: ['storage', 'unlimitedStorage', 'sidePanel', 'contextMenus', 'activeTab', 'scripting', 'alarms'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Margin Notes: open side panel' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Open the notes side panel',
      },
      'toggle-notes': {
        suggested_key: { default: 'Alt+Shift+N' },
        description: 'Turn note-taking on/off for this tab',
      },
      'highlight-selection': {
        suggested_key: { default: 'Alt+Shift+H' },
        description: 'Highlight the selected text',
      },
      'snip-region': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Snip a region of the page as a screenshot',
      },
    },
  },
});
