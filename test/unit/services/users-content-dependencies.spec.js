"use strict";

const fs = require("fs-extra");
const { createTestBroker } = require("../../setup/broker");
const UsersService = require("../../../services/users/users.service");

const testLocals = require("../../../resources/settings/locals.json");

describe("Test users content dependency actions", () => {
	let broker;
	let serviceUsers;
	let testUserId;

	const createCtxMeta = (userType = "user") => ({
		localsDefault: testLocals,
		user: {
			_id: testUserId,
			type: userType,
		},
		siteSettings: {
			url: "http://localhost:3000",
			name: "Test Site",
			supportEmail: "support@example.com",
			translation: {
				dictionaryPath: "./.temp/test-dictionary.json",
			},
		},
	});

	beforeAll(async () => {
		broker = createTestBroker();
		serviceUsers = broker.createService(UsersService, { meta: { localsDefault: testLocals } });
		await broker.start();

		const inserted = await serviceUsers.adapter.insert({
			username: "cd_user_" + Date.now(),
			email: "cd_user_" + Date.now() + "@example.com",
			password: "hashed-password",
			type: "user",
			data: {
				contentDependencies: {
					list: ["EXISTING-CODE"],
				},
			},
			dates: {
				dateCreated: new Date(),
				dateUpdated: new Date(),
			},
		});
		testUserId = inserted._id.toString();
	});

	afterAll(async () => {
		await broker.stop();
	});

	describe("users.updateContentDependencies", () => {
		it("should replace content dependency list for a user", async () => {
			const result = await broker.call("users.updateContentDependencies", {
				userId: testUserId,
				productCodes: ["PROD-A", "PROD-B", "PROD-A"],
			});

			expect(result.data.contentDependencies.list).toEqual(["PROD-A", "PROD-B"]);
		});

		it("should reject when user does not exist", async () => {
			await expect(
				broker.call("users.updateContentDependencies", {
					userId: "507f1f77bcf86cd799439011",
					productCodes: ["PROD-X"],
				})
			).rejects.toMatchObject({
				code: 404,
			});
		});
	});

	describe("users.removeContentDependencies", () => {
		it("should remove specific product codes from user list", async () => {
			await broker.call("users.updateContentDependencies", {
				userId: testUserId,
				productCodes: ["KEEP-ME", "REMOVE-ME"],
			});

			const result = await broker.call("users.removeContentDependencies", {
				userId: testUserId,
				productCodes: ["REMOVE-ME"],
			});

			expect(result.data.contentDependencies.list).toEqual(["KEEP-ME"]);
		});

		it("should reject when user does not exist", async () => {
			await expect(
				broker.call("users.removeContentDependencies", {
					userId: "507f1f77bcf86cd799439011",
					productCodes: ["PROD-X"],
				})
			).rejects.toMatchObject({
				code: 404,
			});
		});
	});

	describe("users.updateDictionary", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("should reject non-admin users", async () => {
			await expect(
				broker.call(
					"users.updateDictionary",
					{ dictionary: { hello: "world" } },
					{ meta: createCtxMeta("user") }
				)
			).rejects.toMatchObject({
				code: 403,
			});
		});

		it("should allow admin to update dictionary file", async () => {
			const writeJsonSpy = jest.spyOn(fs, "writeJson").mockResolvedValue(undefined);

			const result = await broker.call(
				"users.updateDictionary",
				{ dictionary: { hello: "admin" } },
				{ meta: createCtxMeta("admin") }
			);

			expect(result).toEqual({ success: true });
			expect(writeJsonSpy).toHaveBeenCalledWith(
				"./.temp/test-dictionary.json",
				{ hello: "admin" },
				{ spaces: 2 }
			);
		});
	});
});
