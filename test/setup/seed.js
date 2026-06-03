"use strict";

const { ObjectId } = require("mongodb");

const TEST_PRODUCT_ID = "5c8183d176feb5cd4f7573ff";
const TEST_CATEGORY_SLUG = "test-category";

/**
 * Insert a product used by cart/orders integration tests when missing.
 */
async function seedTestProduct(productsService) {
	const id = productsService.fixStringToId
		? productsService.fixStringToId(TEST_PRODUCT_ID)
		: new ObjectId(TEST_PRODUCT_ID);

	const existing = await productsService.adapter.findById(id);
	if (existing) {
		return existing;
	}

	return productsService.adapter.insert({
		_id: id,
		externalId: "test-product-ext",
		orderCode: "TEST-PRODUCT-001",
		slug: "test-product",
		publisher: "test@example.com",
		type: "product",
		subtype: "physical",
		name: { en: "Test Product" },
		descriptionShort: { en: "Test product for unit tests" },
		price: 19.99,
		stockAmount: 100,
		dates: {
			dateCreated: new Date(),
			dateUpdated: new Date(),
		},
	});
}

/**
 * Insert an active category for categories service tests.
 */
async function seedTestCategory(categoriesService) {
	const existing = await categoriesService.adapter.findOne({ slug: TEST_CATEGORY_SLUG });
	if (existing) {
		if (existing.type !== "products") {
			await categoriesService.adapter.updateById(existing._id, {
				$set: { type: "products", dateUpdated: new Date() },
			});
			existing.type = "products";
		}
		return existing;
	}

	const now = new Date();
	return categoriesService.adapter.insert({
		externalId: "test-category-ext",
		slug: TEST_CATEGORY_SLUG,
		pathSlug: TEST_CATEGORY_SLUG,
		parentPath: [],
		parentPathSlug: TEST_CATEGORY_SLUG,
		publisher: "test@example.com",
		type: "products",
		name: { en: "Test Category" },
		dates: {
			dateCreated: now,
			dateUpdated: now,
		},
		activity: {
			start: new Date(now.getTime() - 86400000),
			end: new Date(now.getTime() + 86400000 * 365),
		},
	});
}

module.exports = {
	TEST_PRODUCT_ID,
	TEST_CATEGORY_SLUG,
	seedTestProduct,
	seedTestCategory,
};
