import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// n8n-workflow's ESM build lacks "type": "module", so Vitest would transform it (noisy
		// sourcemap warnings). Use the CommonJS build, which n8n itself loads at runtime.
		alias: [{ find: /^n8n-workflow$/, replacement: 'n8n-workflow/dist/cjs/index.js' }],
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
