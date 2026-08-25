"use strict";

const coreMethods = require("../../../services/users/methods/core.methods");
const profileMixin = require("../../../services/users/methods/profile.methods");
const HelpersMixin = require("../../../mixins/helpers.mixin");

function createUserService(extra = {}) {
	return {
		logger: { info() {}, warn() {}, error() {} },
		Promise,
		settings: { JWT_SECRET: process.env.JWT_SECRET },
		getValueByCode: HelpersMixin.methods.getValueByCode,
		generateJWT: coreMethods.methods.generateJWT,
		transformEntity: coreMethods.methods.transformEntity,
		removePrivateData: coreMethods.methods.removePrivateData,
		transformProfile: coreMethods.methods.transformProfile,
		userCanUpdate: coreMethods.methods.userCanUpdate,
		mergeTwoAddresses: coreMethods.methods.mergeTwoAddresses,
		extractTranslation: coreMethods.methods.extractTranslation,
		prepareForUpdate: coreMethods.methods.prepareForUpdate,
		buildHashSourceFromEntity: coreMethods.methods.buildHashSourceFromEntity,
		specialValuesFromContext: coreMethods.methods.specialValuesFromContext,
		transformDocuments: jest.fn((ctx, params, doc) => doc),
		entityChanged: jest.fn().mockResolvedValue(true),
		adapter: {
			findOne: jest.fn(),
			findById: jest.fn(),
			updateById: jest.fn().mockResolvedValue({ _id: "u1", username: "jane", type: "user" }),
			collection: { distinct: jest.fn().mockResolvedValue(["user"]) },
			count: jest.fn().mockResolvedValue(0),
		},
		...extra,
	};
}

describe("users core helpers", () => {
	const service = createUserService();

	it("transforms entities, profiles, and private data", async () => {
		const ctx = { meta: { cookies: {} } };
		const wrapped = service.transformEntity({ username: "jane" }, true, ctx);
		expect(wrapped.user.username).toBe("jane");
		expect(ctx.meta.token).toEqual(expect.any(String));

		expect(service.removePrivateData({ data: { secret: 1, contentDependencies: ["P"] } }).data.secret).toBeUndefined();
		expect(service.transformProfile({}, { username: "jane" }, null).profile.following).toBe(false);

		const followCtx = { call: jest.fn().mockResolvedValue(true) };
		const profile = await service.transformProfile(followCtx, { _id: "a" }, { _id: "b" });
		expect(profile.profile.following).toBe(true);
	});

	it("gates user updates and merges addresses", () => {
		expect(service.userCanUpdate({ _id: "u1", type: "user" }, {})).toBe(true);
		expect(service.userCanUpdate({ _id: "a1", type: "admin" }, { _id: "u2" })).toBe(true);
		expect(service.userCanUpdate({}, { _id: "u2" })).toBe(false);
		expect(service.mergeTwoAddresses({ city: "A", zip: "1" }, { city: "B" })).toEqual({ city: "B", zip: "1" });
		expect(service.prepareForUpdate({ _id: "x", username: "jane" })).toEqual({ $set: { username: "jane" } });
		expect(service.buildHashSourceFromEntity("1234567890abcdefghijklmno1234567890", "salt", false)).toContain("salt");
		const malCore = { settings: { additional: {} } };
		service.specialValuesFromContext({
			meta: { headers: { "resource-type": "MAL" }, cookies: { session: "sess" } },
		}, malCore);
		expect(malCore.settings.additional.mal).toBe("sess");
	});

	it("extracts translations for a language", () => {
		const extracted = service.extractTranslation({
			dictionary: {
				records: [{
					translates: [{ langCode: "en", translation: "Hello" }],
					occurrences: [{
						type: "text",
						blockName: "home",
						path: "/src/components/Home.vue",
						translationStrings: [{ selector: "h1", stringOrig: "Ahoj" }],
					}],
				}],
			},
		}, "en", "home");
		expect(extracted.en[0]).toMatchObject({ string: "Hello", selector: "h1", original: "Ahoj" });
	});
});

describe("users.profile actions", () => {
	it("strips privileged fields for non-admins and rejects when the user cannot update", async () => {
		const service = createUserService();
		const ctx = {
			meta: { user: { _id: "u1", type: "user" } },
			params: { user: { type: "admin", bio: "hi" } },
		};
		service.userCanUpdate = () => false;
		await expect(profileMixin.actions.updateUser.handler.call(service, ctx)).rejects.toMatchObject({ code: 422 });
		expect(ctx.params.user.type).toBeUndefined();
	});

	it("updates a profile image and rejects missing profiles", async () => {
		const service = createUserService();
		await profileMixin.actions.updateMyProfileImage.handler.call(service, {
			meta: { user: { _id: "u1", dates: {} } },
			params: { data: { image: "a.png" } },
		});
		expect(service.adapter.updateById).toHaveBeenCalled();

		service.adapter.findOne.mockResolvedValue(null);
		await expect(profileMixin.actions.profile.handler.call(service, {
			params: { username: "missing" },
			meta: { user: null },
		})).rejects.toMatchObject({ code: 422 });
	});

	it("reports whether a username exists", async () => {
		const service = createUserService({
			enforceRateLimit: jest.fn().mockResolvedValue(true),
		});
		service.adapter.count.mockResolvedValue(0);
		await expect(profileMixin.actions.checkIfUserExists.handler.call(service, {
			params: { username: "newuser" },
		})).resolves.toEqual({ result: { userExists: false } });
		service.adapter.count.mockResolvedValue(2);
		await expect(profileMixin.actions.checkIfUserExists.handler.call(service, {
			params: { username: "jane" },
		})).rejects.toMatchObject({ code: 422 });
	});
});
