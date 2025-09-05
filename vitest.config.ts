import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
	},
	resolve: {
		alias: {
			// Keep consistent with tsconfig paths if needed
		},
	},
});
