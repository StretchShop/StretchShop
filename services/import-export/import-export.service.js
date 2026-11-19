"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const HelpersMixin = require("../../mixins/helpers.mixin");
const openApiActionMetadata = require("../../mixins/openapi.action-metadata.mixin");
const { listProviders, getProvider } = require("../../modules/import-export");

const PAGE_SIZE = 100;

module.exports = {
	name: "import-export",
	mixins: [
		HelpersMixin,
		openApiActionMetadata("import-export")
	],

	actions: {
		providers: {
			auth: "required",
			cache: false,
			handler(ctx) {
				const denied = this.requireAdmin(ctx);
				if (denied) {
					return denied;
				}
				return listProviders();
			}
		},

		/**
		 * Import catalog data from a provider file.
		 * Called directly (JSON with contentBase64) or via multipart upload handler.
		 */
		import: {
			auth: "required",
			cache: false,
			params: {
				provider: { type: "string", min: 2 },
				entities: { type: "array", items: "string", optional: true },
				filename: { type: "string", optional: true },
				contentBase64: { type: "string", optional: true },
				$$strict: false
			},
			handler(ctx) {
				const denied = this.requireAdmin(ctx);
				if (denied) {
					return denied;
				}
				return this.runImport(ctx);
			}
		},

		export: {
			auth: "required",
			cache: false,
			params: {
				provider: { type: "string", min: 2 },
				entities: { type: "array", items: "string", optional: true }
			},
			handler(ctx) {
				const denied = this.requireAdmin(ctx);
				if (denied) {
					return denied;
				}
				return this.runExport(ctx);
			}
		}
	},

	methods: {
		getDefaultLang(ctx) {
			const lang = ctx.meta?.localsDefault?.lang;
			if (lang && typeof lang === "object" && lang.code) {
				return lang.code;
			}
			if (typeof lang === "string" && lang.trim()) {
				return lang.trim();
			}
			return "en";
		},

		normalizeEntities(entities, provider) {
			const requested = Array.isArray(entities) && entities.length
				? entities.map((e) => String(e).toLowerCase())
				: ["products", "categories", "pages"];
			const supported = Object.keys(provider.entities || {}).filter((k) => provider.entities[k]);
			const filtered = requested.filter((e) => supported.includes(e));
			const unsupported = requested.filter((e) => !supported.includes(e));
			if (unsupported.length) {
				throw new MoleculerClientError(
					"Entities not supported for provider " + provider.id + ": " + unsupported.join(", "),
					400,
					"ERR_UNSUPPORTED_ENTITIES",
					{ unsupported }
				);
			}
			if (!filtered.length) {
				throw new MoleculerClientError("No valid entities selected", 400, "ERR_NO_ENTITIES");
			}
			return filtered;
		},

		async runImport(ctx) {
			let provider;
			try {
				provider = getProvider(ctx.params.provider);
			} catch (err) {
				throw new MoleculerClientError(err.message, 400, "ERR_UNKNOWN_PROVIDER");
			}

			const entities = this.normalizeEntities(ctx.params.entities, provider);
			const defaultLang = this.getDefaultLang(ctx);

			let buffer = ctx.params._fileBuffer;
			if (!buffer && ctx.params.contentBase64) {
				buffer = Buffer.from(ctx.params.contentBase64, "base64");
			}
			if (!buffer || !buffer.length) {
				throw new MoleculerClientError("No file content provided", 400, "ERR_NO_FILE");
			}

			let parsed;
			try {
				parsed = provider.import.parse(buffer, {
					filename: ctx.params.filename || "",
					defaultLang,
					entities
				});
			} catch (err) {
				throw new MoleculerClientError(err.message || "Parse failed", 422, "ERR_PARSE");
			}

			const publisher = ctx.meta.user?.email || "import@stretchshop";
			const summary = {
				created: { products: 0, categories: 0, pages: 0 },
				updated: { products: 0, categories: 0, pages: 0 },
				skipped: { products: 0, categories: 0, pages: 0 },
				errors: []
			};

			if (entities.includes("categories") && parsed.categories?.length) {
				await this.importEntities(ctx, "categories", parsed.categories, publisher, summary);
			}
			if (entities.includes("products") && parsed.products?.length) {
				await this.importEntities(ctx, "products", parsed.products, publisher, summary);
			}
			if (entities.includes("pages") && parsed.pages?.length) {
				await this.importEntities(ctx, "pages", parsed.pages, publisher, summary);
			}

			return summary;
		},

		async importEntities(ctx, type, list, publisher, summary) {
			const action = type + ".import";
			const paramKey = type;
			const batch = (list || []).map((entity) => {
				const copy = { ...entity };
				if (!copy.publisher) {
					copy.publisher = publisher;
				}
				return copy;
			});

			try {
				const results = await ctx.call(action, { [paramKey]: batch });
				(results || []).forEach((result) => {
					if (!result) {
						summary.skipped[type]++;
						return;
					}
					if (result.error) {
						summary.errors.push({ type, error: result.error });
						summary.skipped[type]++;
						return;
					}
					// Heuristic: newly created docs typically have dates.dateCreated ≈ dateUpdated
					const created = result.dates?.dateCreated;
					const updated = result.dates?.dateUpdated;
					if (created && updated && new Date(created).getTime() === new Date(updated).getTime()) {
						summary.created[type]++;
					} else if (result._id || result.id) {
						summary.updated[type]++;
					} else {
						summary.updated[type]++;
					}
				});
			} catch (err) {
				this.logger.error("import-export.importEntities error", type, err);
				summary.errors.push({
					type,
					error: err.message || String(err)
				});
			}
		},

		async runExport(ctx) {
			let provider;
			try {
				provider = getProvider(ctx.params.provider);
			} catch (err) {
				throw new MoleculerClientError(err.message, 400, "ERR_UNKNOWN_PROVIDER");
			}

			const entities = this.normalizeEntities(ctx.params.entities, provider);
			const defaultLang = this.getDefaultLang(ctx);

			const data = {
				products: [],
				categories: [],
				pages: []
			};

			if (entities.includes("products")) {
				data.products = await this.loadAll(ctx, "products");
			}
			if (entities.includes("categories")) {
				data.categories = await this.loadAll(ctx, "categories");
			}
			if (entities.includes("pages")) {
				data.pages = await this.loadAll(ctx, "pages");
			}

			let serialized;
			try {
				serialized = provider.export.serialize(data, { defaultLang, entities });
			} catch (err) {
				throw new MoleculerClientError(err.message || "Export failed", 422, "ERR_EXPORT");
			}

			return {
				filename: serialized.filename,
				contentType: serialized.contentType,
				contentBase64: serialized.buffer.toString("base64")
			};
		},

		async loadAll(ctx, serviceName) {
			const all = [];
			let offset = 0;
			for (;;) {
				const page = await ctx.call(serviceName + ".find", {
					query: {},
					limit: PAGE_SIZE,
					offset
				});
				const rows = Array.isArray(page) ? page : [];
				all.push(...rows);
				if (rows.length < PAGE_SIZE) {
					break;
				}
				offset += PAGE_SIZE;
			}
			return all;
		}
	}
};
