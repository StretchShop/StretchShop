"use strict";

const jwt = require("jsonwebtoken");
const coreMethods = require("../../../services/users/methods/core.methods");
const HelpersMixin = require("../../../mixins/helpers.mixin");
const SettingsMixin = require("../../../mixins/settings.mixin");

describe("users core methods", () => {
	const service = {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		settings: { JWT_SECRET: process.env.JWT_SECRET },
		getValueByCode: HelpersMixin.methods.getValueByCode,
		isValidTranslationLanguage: (code, langs) => langs.some((lang) => lang.code === code),
		...coreMethods.methods,
	};

	it("builds core data from locals and settings", () => {
		jest.spyOn(SettingsMixin, "getSiteSettings").mockImplementation((name) => {
			if (name === "business") {
				return {
					invoiceData: { company: { name: "StretchShop" } },
					priceLevels: { validTypes: { userTypes: ["user.gold"] } },
					taxData: { global: { taxDecimal: 0.2 } },
				};
			}
			if (name === "navigation-main") {
				return { items: [{ codename: "home" }] };
			}
			if (name === "navigation-footer") {
				return { items: [] };
			}
			return {};
		});
		const coreData = service.getCoreDataBase({
			meta: {
				localsDefault: {
					lang: "en",
					langs: [{ code: "en", name: "English" }, { code: "sk", name: "Slovak" }],
					currency: "EUR",
					currencies: [{ code: "EUR", symbol: "€" }],
					country: "SK",
					countries: [{ code: "SK", name: "Slovakia" }],
				},
			},
			params: { transLang: "sk" },
		});
		expect(coreData.lang.code).toBe("sk");
		expect(coreData.currency.code).toBe("EUR");
		expect(coreData.settings.business.name).toBe("StretchShop");
		expect(coreData.navigation.main.items[0].codename).toBe("home");
		SettingsMixin.getSiteSettings.mockRestore();
	});

	it("signs a JWT and optional impersonation payload", () => {
		const ctx = { meta: {} };
		const token = service.generateJWT(
			{ _id: "u1", username: "jane" },
			ctx,
			{ actAs: true, adminId: "admin-1", expiresInHours: 2 }
		);
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		expect(decoded.username).toBe("jane");
		expect(decoded.actAs).toBe(true);
		expect(ctx.meta.makeCookies.token.value).toBe(token);
	});

	it("rejects impersonation of missing, inactive, or admin users", async () => {
		await expect(service.superloginJWT(null, { meta: {} })).rejects.toMatchObject({ code: 422 });
		await expect(service.superloginJWT({ dates: {} }, { meta: {} })).rejects.toMatchObject({ code: 422 });
		await expect(service.superloginJWT({
			type: "admin",
			dates: { dateActivated: new Date(Date.now() - 1000) },
		}, { meta: {} })).rejects.toMatchObject({ code: 403 });
	});
});
