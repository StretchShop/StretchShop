"use strict";

const orderStatuses = [
	"saved", // 0 order is saved but not even prepared for paygate
	"prepared", // 1 order is prepared for paygate
	// --
	"paid", // 2 order is paid - products are being shipped or subscriptions are running
	"finished", // 3 order is all finished - all products are delivered, all subscriptions are completed
	// --
	"stopped", // 4 order is paused or canceled - temporarily or permanently
	"failed" // 5 order has failed
];

module.exports = { orderStatuses };
