"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const {
	normalizeProductAmount,
	sanitizeProductDecimalAmountData,
	getDecimalAmountConfig,
} = require("../../../mixins/product.amount");

describe("product.amount", () => {
	it("rounds amount up to integer when decimal amounts are not allowed", () => {
		expect(normalizeProductAmount(1.2, {})).toBe(2);
		expect(normalizeProductAmount(2, {})).toBe(2);
		expect(normalizeProductAmount(1.01, { data: { decimalAmount: { allowed: false, maxDepth: 2 } } })).toBe(2);
	});

	it("keeps decimals within maxDepth when allowed", () => {
		const product = { data: { decimalAmount: { allowed: true, maxDepth: 2 } } };
		expect(normalizeProductAmount(1.25, product)).toBe(1.25);
		expect(getDecimalAmountConfig(product).maxDepth).toBe(2);
	});

	it("rejects amounts with too many decimal places", () => {
		const product = { data: { decimalAmount: { allowed: true, maxDepth: 2 } } };
		expect(() => normalizeProductAmount(1.234, product)).toThrow(MoleculerClientError);
	});

	it("sanitizes decimalAmount on product save", () => {
		const data = { decimalAmount: { allowed: true, maxDepth: 2.9 }, other: true };
		sanitizeProductDecimalAmountData(data);
		expect(data.decimalAmount).toEqual({ allowed: true, maxDepth: 2 });
		expect(data.other).toBe(true);

		const removed = { decimalAmount: { allowed: false, maxDepth: 2 } };
		sanitizeProductDecimalAmountData(removed);
		expect(removed.decimalAmount).toBeUndefined();
	});

	it("rejects invalid maxDepth on product save", () => {
		expect(() => sanitizeProductDecimalAmountData({
			decimalAmount: { allowed: true, maxDepth: 0 },
		})).toThrow(MoleculerClientError);
		expect(() => sanitizeProductDecimalAmountData({
			decimalAmount: { allowed: true, maxDepth: 11 },
		})).toThrow(MoleculerClientError);
	});
});
