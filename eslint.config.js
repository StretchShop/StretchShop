const js = require("@eslint/js");

module.exports = [
	{
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: "commonjs",
			globals: {
				// Node.js globals (Node 18+)
				__dirname: "readonly",
				__filename: "readonly",
				Buffer: "readonly",
				clearImmediate: "readonly",
				clearInterval: "readonly",
				clearTimeout: "readonly",
				console: "readonly",
				global: "readonly",
				process: "readonly",
				setImmediate: "readonly",
				setInterval: "readonly",
				setTimeout: "readonly",
				// Node 17+ globals
				structuredClone: "readonly",
				crypto: "readonly",
				fetch: "readonly",
				// Jest globals
				describe: "readonly",
				it: "readonly",
				expect: "readonly",
				beforeEach: "readonly",
				afterEach: "readonly",
				beforeAll: "readonly",
				afterAll: "readonly",
				// Moleculer framework - service context
				// These are available within service methods/actions
			},
		},
		rules: {
			...js.configs.recommended.rules,
			"indent": ["warn", "tab"],
			"quotes": ["warn", "double"],
			"semi": ["error", "always"],
			"no-var": ["error"],
			"no-console": ["off"],
			"no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			"no-useless-assignment": "warn",
			"no-constant-binary-expression": "warn",
			"valid-typeof": "warn",
		},
	},
	// Moleculer-specific configuration for service files
	{
		files: ["services/**/*.js", "mixins/**/*.js"],
		languageOptions: {
			globals: {
				// Moleculer provides these in service context
				// They're injected at runtime, so we ignore them for linting
				MoleculerClientError: "readonly",
				MoleculerError: "readonly",
				ValidationError: "readonly",
			},
		},
		rules: {
			// Relax some rules for Moleculer services
			"no-undef": ["warn"], // Warn instead of error for undefined (Moleculer injects at runtime)
		},
	},
];
