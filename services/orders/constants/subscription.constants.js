"use strict";

const subscriptionPaymentStatuses = [
	"saved", // 0 order created but not even prepared for paygate
	"prepared", // 1 order prepared for paygate
	// --
	"trialing", // 2 payment is in trial period
	"active", // 3 payment is active
	"completed", // 4 subscription is completed and finished
	// --
	"paused", // 5 subscription payment is paused
	"canceled", // 6 subscription is canceled, no chance for more payments
	"failed" // 7 something went wrong with payment
];

/*
  e.g. stripe statuses can be found here: https://docs.stripe.com/api/subscriptions/object#subscription_object-status
  2025-05-22 state:
  [
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused"
  ]
*/

module.exports = { subscriptionPaymentStatuses };
