"use strict";

const SettingsMixin = require("../../../mixins/settings.mixin");
const priceLevels = require("../../../mixins/price.levels.mixin");

describe("price.levels.mixin", () => {
	const originalGet = SettingsMixin.getSiteSettings;
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		...priceLevels.methods,
	};

	beforeEach(() => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockReturnValue({
			priceLevels: {
				validTypes: { userTypes: ["user.gold", "user.silver"] },
				discounts: {
					"user.gold": { type: "percent", value: -10 },
					"user.silver": { type: "amount", value: -5 },
				},
			},
		});
	});

	afterEach(() => {
		SettingsMixin.getSiteSettings.mockRestore?.();
		SettingsMixin.getSiteSettings = originalGet;
	});

	it("validates usertypes and picks price variables", () => {
		expect(service.isValidUsertype("user.gold")).toBe(true);
		expect(service.isValidUsertype("admin.super")).toBe(false);
		expect(service.getPriceVariable({ type: "user", subtype: "gold" })).toBe("priceLevels.user.gold");
		expect(service.getPriceVariable(null)).toBe("price");
	});

	it("applies user price levels and hides activity from non-admins", () => {
		const priced = service.priceByUser({
			price: 100,
			activity: { start: null },
			priceLevels: { user: { gold: { price: 80 } } },
		}, { type: "user", subtype: "gold" });
		expect(priced.price).toBe(80);
		expect(priced.activity).toBeUndefined();
		expect(priced.priceLevels).toBeUndefined();

		const admin = service.priceByUser({
			price: 100,
			activity: { start: null },
			priceLevels: { user: { gold: { price: 80 } } },
		}, { type: "admin", subtype: "gold" }, true);
		expect(admin.price).toBe(100);
		expect(admin.priceLevels).toBeDefined();
	});

	it("calculates percent and amount discounts", () => {
		expect(service.calculatePriceForUsertype(100, "user.gold")).toBe(90);
		expect(service.calculatePriceForUsertype(20, "user.silver")).toBe(15);
		expect(service.calculatePriceForUsertype(3, "user.silver")).toBe(0);
	});

	it("builds missing price levels", () => {
		const product = service.makeProductPriceLevels({ price: 100, id: "p1" });
		expect(product.priceLevels.user).toBeDefined();
		const subtype = product.priceLevels.user.silver || product.priceLevels.user.gold;
		expect(subtype.type).toBe("calculated");
		expect(typeof subtype.price).toBe("number");
	});
});
