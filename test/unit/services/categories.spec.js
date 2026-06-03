"use strict";

const { createTestBroker } = require("../../setup/broker");
const CategoriesService = require("../../../services/categories/categories.service");
const ProductsService = require("../../../services/products/products.service");
const { seedTestCategory, TEST_CATEGORY_SLUG } = require("../../setup/seed");

describe("Test 'categories' service", () => {
	let broker;
	let service;

	beforeAll(async () => {
		broker = createTestBroker();
		broker.createService(ProductsService);
		service = broker.createService(CategoriesService);
		await broker.start();
		await seedTestCategory(service);
	});

	afterAll(async () => {
		await broker.stop();
	});

	describe("categories.findActive action", () => {
		it("should return seeded active category", async () => {
			const categories = await broker.call("categories.findActive", {
				query: { slug: TEST_CATEGORY_SLUG },
			});

			expect(Array.isArray(categories)).toBe(true);
			expect(categories.length).toBeGreaterThan(0);
			expect(categories[0].slug).toBe(TEST_CATEGORY_SLUG);
		});
	});

	describe("categories.find action", () => {
		it("should find seeded category by slug", async () => {
			const categories = await broker.call("categories.find", {
				query: { slug: TEST_CATEGORY_SLUG },
			});

			expect(categories.length).toBeGreaterThan(0);
			expect(categories[0].slug).toBe(TEST_CATEGORY_SLUG);
		});
	});

	describe("methods", () => {
		it("filterOnlyActiveCategories should add activity date constraints", () => {
			const query = { $and: [{ slug: TEST_CATEGORY_SLUG }] };
			const filtered = service.filterOnlyActiveCategories(query, {});
			expect(filtered.$and.length).toBeGreaterThan(1);
		});
	});
});
