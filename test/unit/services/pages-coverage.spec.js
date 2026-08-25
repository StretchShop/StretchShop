"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const helpers = require("../../../services/pages/methods/helpers.methods");
const listMixin = require("../../../services/pages/mixins/pages.actions.list.mixin");
const contentMixin = require("../../../services/pages/mixins/pages.actions.content.mixin");
const FileHelpers = require("../../../mixins/file.helpers.mixin");

function createService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		Promise,
		settings: { paths: { resources: "resources", assets: "public" } },
		schema: { methods: {} },
		removeParentTraversing: FileHelpers.methods.removeParentTraversing,
		...helpers.methods,
		...extra,
	};
}

describe("pages helpers", () => {
	const service = createService();

	it("builds template vars and falls back to default", () => {
		const vars = service.getTemplateVars("en", "about---docs");
		expect(vars.pageName).toBe("default");
		expect(vars.templateName).toBe("docs");
		expect(vars.filepath).toContain("default-en.html");
	});

	it("attaches parent category details", () => {
		const result = service.pageGlobalResultHelper_ParentCat(
			{ staticData: {}, data: {}, global: {} },
			{ slug: "news" },
			[true, true]
		);
		expect(result.staticData.parentCategoryDetail.slug).toBe("news");
		expect(result.data.parentCategoryDetail.slug).toBe("news");
		expect(result.global.parentCategoryDetail.slug).toBe("news");
	});

	it("extracts page functions from placeholders", () => {
		expect(service.getPageFunctions("{{{getBestsellers(latest;en)}}}")).toEqual([
			{ method: "getBestsellers", params: ["latest", "en"] },
		]);
		expect(service.checkAndRunPageFunctions({}, { data: { blocks: [{}] } }, "en")).toBeUndefined();
	});

	it("filters inactive pages for non-admins", () => {
		const adminQuery = service.filterOnlyActivePages({ $and: [] }, { meta: { user: { type: "admin" } } });
		expect(adminQuery.$and).toHaveLength(0);

		const publicQuery = service.filterOnlyActivePages({ $and: [] }, { meta: { user: { type: "user" } } });
		expect(publicQuery.$and).toHaveLength(2);
	});
});

describe("pages.pagesList", () => {
	it("lists pages for a category with subcategories", async () => {
		const service = createService();
		const ctx = {
			params: { category: "news", filter: { query: { slug: "about" }, limit: 200 } },
			meta: { user: { type: "user" } },
			call: jest.fn((action) => {
				if (action === "categories.detail") {
					return Promise.resolve({ pathSlug: "news", subsSlugs: ["news/blog"] });
				}
				if (action === "pages.find") {
					return Promise.resolve([{ slug: "about" }]);
				}
				if (action === "categories.findActive") {
					return Promise.resolve([{ slug: "blog" }]);
				}
				if (action === "pages.count") {
					return Promise.resolve(3);
				}
				return Promise.resolve([]);
			}),
		};

		const result = await listMixin.actions.pagesList.handler.call(service, ctx);
		expect(result.results).toEqual([{ slug: "about" }]);
		expect(result.categories).toEqual([{ slug: "blog" }]);
		expect(result.filteredPagesCount).toBe(3);
		expect(ctx.call).toHaveBeenCalledWith("pages.find", expect.objectContaining({
			limit: 100,
			sort: "-dates.dateUpdated",
		}));
	});

	it("rejects when the category lookup fails", async () => {
		const service = createService();
		const ctx = {
			params: { category: "missing" },
			call: jest.fn().mockRejectedValue(new Error("no category")),
		};
		await expect(listMixin.actions.pagesList.handler.call(service, ctx)).rejects.toBeInstanceOf(MoleculerClientError);
	});
});

describe("pages.findWithCount", () => {
	it("returns results with count", async () => {
		const service = createService();
		const ctx = {
			params: {
				query: { categories: { $in: ["news"] }, pages: { $in: ["about"] } },
				limit: 200,
				offset: 10,
				sort: "slug",
			},
			meta: { user: { type: "admin" } },
			call: jest.fn((action) => {
				if (action === "pages.find") {
					return Promise.resolve([{ slug: "about" }]);
				}
				if (action === "pages.count") {
					return Promise.resolve(1);
				}
				return Promise.resolve([]);
			}),
		};

		const result = await listMixin.actions.findWithCount.handler.call(service, ctx);
		expect(result.results).toEqual([{ slug: "about" }]);
		expect(result.filteredPagesCount).toBe(1);
		expect(result.categories).toEqual(["news"]);
	});

	it("skips count when minimalData is true", async () => {
		const service = createService();
		const ctx = {
			params: { query: {}, minimalData: true },
			meta: { user: { type: "admin" } },
			call: jest.fn().mockResolvedValue([]),
		};
		const result = await listMixin.actions.findWithCount.handler.call(service, ctx);
		expect(result.results).toEqual([]);
		expect(result.filteredPagesCount).toBeUndefined();
	});
});

describe("pages content actions", () => {
	it("converts string ids in findWithId", async () => {
		const service = createService({
			fixStringToId: (id) => ({ oid: id }),
			adapter: { find: jest.fn().mockResolvedValue([{ slug: "about" }]) },
		});
		const result = await contentMixin.actions.findWithId.handler.call(service, {
			params: { query: { _id: "507f1f77bcf86cd799439011" } },
		});
		expect(service.adapter.find).toHaveBeenCalledWith({
			query: { _id: { oid: "507f1f77bcf86cd799439011" } },
		});
		expect(result).toEqual([{ slug: "about" }]);
	});

	it("loads page detail with language fallback", async () => {
		const service = createService({
			getPageDetail: jest.fn().mockResolvedValue({ slug: "about" }),
		});
		const result = await contentMixin.actions.detail.handler.call(service, {
			params: { page: "about", lang: " sk " },
		});
		expect(service.getPageDetail).toHaveBeenCalled();
		expect(result).toEqual({ slug: "about" });
	});

	it("forbids import and delete for non-admins", async () => {
		const service = createService();
		const ctx = { meta: { user: { type: "user" } }, params: {} };
		await expect(contentMixin.actions.import.handler.call(service, ctx)).rejects.toMatchObject({ code: 403 });
		await expect(contentMixin.actions.delete.handler.call(service, ctx)).rejects.toMatchObject({ code: 403 });
	});

	it("returns empty import/delete results for admins with no entities", async () => {
		const service = createService();
		const ctx = { meta: { user: { type: "admin" } }, params: {} };
		await expect(contentMixin.actions.import.handler.call(service, ctx)).resolves.toEqual([]);
		await expect(contentMixin.actions.delete.handler.call(service, ctx)).resolves.toEqual([]);
	});

	it("checks authorship and updatePageImage", async () => {
		const service = createService({
			adapter: { find: jest.fn().mockResolvedValue([{ slug: "about" }]) },
		});
		await expect(contentMixin.actions.checkAuthor.handler.call(service, {
			params: { data: { slug: "about", publisher: "ed@example.com" } },
		})).resolves.toBe(true);
		expect(contentMixin.actions.checkAuthor.handler.call(service, { params: { data: {} } })).toBe(false);
		expect(contentMixin.actions.updatePageImage.handler.call(service, {
			params: { params: { slug: "about" } },
		})).toBeUndefined();
	});
});
