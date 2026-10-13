import { defineConfig } from 'wxt';
import { VINTED_MATCHES } from './src/vinted/domains';

// See RESEARCH.md (D4, D8, D9) for why the manifest looks like this.
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Vinted Seller Filters',
    description:
      'Adds price range, brand, size, condition, colour, material and pattern filters to Vinted seller pages.',
    // The content script runs in the page's MAIN world and needs no extension APIs,
    // so no permissions are requested. host_permissions only scopes where it runs.
    host_permissions: VINTED_MATCHES,
    minimum_chrome_version: '111',
    browser_specific_settings: {
      gecko: {
        id: 'vinted-seller-filters@local',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
