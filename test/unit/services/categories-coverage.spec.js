"use strict";

const helpers = require("../../../services/categories/methods/helpers.methods");
const adminMixin = require("../../../services/categories/mixins/categories.actions.admin.mixin");

describe("categories helpers", () => {
	it("converts date strings on entity dates and activity", () => {
		const entity = helpers.methods.fixEntityDates({
			dates: { dateCreated: "2024-01-01T00:00:00.000Z", dateUpdated: "" },
			activity: { start: "2024-02-01T00:00:00.000Z", end: null },
		});
		expect(entity.dates.dateCreated).toBeInstanceOf(Date);
		expect(entity.dates.dateUpdated).toBe("");
		expect(entity.activity.start).toBeInstanceOf(Date);
	});
});

describe("categories.admin actions", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
	};

	it("forbids import and delete for non-admins", async () => {
		const ctx = { meta: { user: { type: "user" } }, params: {} };
		await expect(adminMixin.actions.import.handler.call(service, ctx)).rejects.toMatchObject({ code: 403 });
		await expect(adminMixin.actions.delete.handler.call(service, ctx)).rejects.toMatchObject({ code: 403 });
	});

	it("returns empty import/delete results for admins with no entities", async () => {
		const ctx = { meta: { user: { type: "admin" } }, params: {} };
		await expect(adminMixin.actions.import.handler.call(service, ctx)).resolves.toEqual([]);
		await expect(adminMixin.actions.delete.handler.call(service, ctx)).resolves.toEqual([]);
	});
});
