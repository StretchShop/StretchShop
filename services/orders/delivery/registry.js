"use strict";

const packeta = require("./suppliers/packeta");

const suppliers = {
	[packeta.codename]: packeta,
};

/**
 * @param {string} codename
 * @returns {object|null}
 */
function getSupplier(codename) {
	if (!codename || typeof codename !== "string") {
		return null;
	}
	return suppliers[codename] || null;
}

/**
 * @param {object} source
 * @returns {string|null}
 */
function physicalCodename(source) {
	const deliveryData = source?.data?.deliveryData || source;
	const physical = deliveryData?.codename?.physical;
	if (typeof physical === "string") {
		return physical;
	}
	return physical?.value || null;
}

/**
 * Drop supplier secrets before a delivery method is sent to the client.
 * @param {object} method
 * @returns {object}
 */
function publicDeliveryMethod(method) {
	if (!method || typeof method !== "object") {
		return method;
	}
	const supplier = getSupplier(method.codename);
	if (supplier?.publicSettings) {
		return supplier.publicSettings(method);
	}
	if (!method.data) {
		return method;
	}
	const data = { ...method.data };
	delete data.deliveryServiceApiKey;
	delete data.apiPassword;
	return { ...method, data };
}

/**
 * Keep a validated pickup point only for methods that ask for one.
 * @param {object} deliveryData
 * @param {Array} methods
 * @returns {{ ok: boolean, errors?: string[] }}
 */
function applyOrderDestination(deliveryData, methods) {
	if (!deliveryData || typeof deliveryData !== "object") {
		return { ok: true };
	}
	const codename = physicalCodename(deliveryData);
	const method = (methods || []).find((item) => item && item.codename === codename);
	const requiresDestination = method?.data?.destinationSelectionPlugin === true;
	if (!requiresDestination) {
		delete deliveryData.destination;
		return { ok: true };
	}
	const supplier = getSupplier(codename);
	const validation = supplier
		? supplier.validateDestination(deliveryData.destination)
		: { ok: false, errors: ["supplier"] };
	if (!validation.ok) {
		delete deliveryData.destination;
		return validation;
	}
	deliveryData.destination = supplier.sanitizeDestination(deliveryData.destination);
	return { ok: true };
}

module.exports = {
	getSupplier,
	physicalCodename,
	publicDeliveryMethod,
	applyOrderDestination,
};
