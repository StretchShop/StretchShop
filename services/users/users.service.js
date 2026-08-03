"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const Cron = require("@stretchshop/moleculer-cron");

require("dotenv").config();

// global mixins
const DbService = require("../../mixins/db.mixin");
const CacheCleanerMixin = require("../../mixins/cache.cleaner.mixin");
const HelpersMixin = require("../../mixins/helpers.mixin");
const priceLevels = require("../../mixins/price.levels.mixin");
const { getRequiredSecret } = require("../../mixins/env.helpers");

// methods
const UsersMethodsCore = require("./methods/core.methods");
const UsersMethodsCoreData = require("./methods/core-data.methods");
const UsersMethodsProfile = require("./methods/profile.methods");
const UsersMethodsAssets = require("./methods/assets.methods");
const UsersMethodsContent = require("./methods/content.methods");
const UsersMethodsAdmin = require("./methods/admin.methods");

// service mixins
const UsersAuthMixin = require("./mixins/auth.mixin");
const UsersEmailMixin = require("./mixins/email.mixin");
const openApiActionMetadata = require("../../mixins/openapi.action-metadata.mixin");
const RateLimitMixin = require("../../mixins/rate-limit.mixin");


module.exports = {
	name: "users",
	mixins: [
		CacheCleanerMixin([
			"cache.clean.users",
		]),
		HelpersMixin,
		priceLevels,
		Cron,
		RateLimitMixin,
		// methods
		UsersMethodsCore,
		UsersMethodsCoreData,
		UsersMethodsProfile,
		UsersMethodsAssets,
		UsersMethodsContent,
		UsersMethodsAdmin,
		// mixins
		UsersAuthMixin,
		UsersEmailMixin,
		openApiActionMetadata("users"),
		DbService("users"), // has to be the last to not override actions
	],
	/**
	 * Default settings
	 */
	settings: {
		cronJobs: [{
			name: "UsersCleaner",
			cronTime: "20 1 * * *",
			onTick: function () {

				this.logger.info("users.crons - Starting to Remove Users that want to Delete their Profile");

				this.broker.call("users.cleanUsers")
					.then((data) => {
						this.logger.info("users.crons - Users Cleaned up", data);
					})
					.catch(err => {
						console.error("crons.clearUsers error: ", err);
						return this.Promise.reject(new MoleculerClientError("Cron clean users failed", 422, "", []));
					});
			}
		}],

		/** Secret for JWT */
		JWT_SECRET: getRequiredSecret("JWT_SECRET", "jwt-stretchshop-secret"),

		/** Public fields */
		fields: ["_id", "username", "email", "type", "subtype", "bio", "image", "company", "addresses", "settings", "data", "dates", "superadmined", "restrictions"],

		/** Validator schema for entity */
		entityValidator: {
			username: { type: "string", min: 2 },//, pattern: /^[a-zA-Z0-9]+$/ },
			password: { type: "string", min: 6 },
			email: { type: "email" },
			type: { type: "string", optional: true },
			subtype: { type: "string", optional: true },
			bio: { type: "string", optional: true },
			image: { type: "string", optional: true },
			dates: {
				type: "object", optional: true, props: {
					dateCreated: { type: "date", optional: true },
					dateLastLogin: { type: "date", optional: true },
					dateUpdated: { type: "date", optional: true },
					dateLastVerify: { type: "date", optional: true },
					dateActivated: { type: "date", optional: true },
					dateToBeErased: { type: "date", optional: true }
				}
			},
			company: {
				type: "object", optional: true, props: {
					name: { type: "string", optional: true },
					orgId: { type: "string", optional: true },
					taxId: { type: "string", optional: true },
					taxVatId: { type: "string", optional: true }
				}
			},
			addresses: {
				type: "array", optional: true, items:
				{
					type: "object", props: {
						type: { type: "string" }, // invoice, delivery, ...
						nameFirst: { type: "string", min: 3 },
						nameLast: { type: "string", min: 3 },
						street: { type: "string", min: 5 },
						street2: { type: "string", optional: true },
						zip: { type: "string", min: 5 },
						city: { type: "string", min: 5 },
						state: { type: "string", optional: true },
						country: { type: "string", min: 2 },
						phone: { type: "string", min: 2 }
					}
				}
			},
			ip: {
				type: "object", optional: true, props: {
					ipRegistration: { type: "string", optional: true },
					ipLastLogin: { type: "string", optional: true }
				}
			},
			settings: {
				type: "object", optional: true, props: {
					language: { type: "string", optional: true },
					currency: { type: "string", optional: true }
				}
			},
			restrictions: {
				type: "array", optional: true, items: {
					type: "string"
				}
			}
		},

		mailSettings: {
			defaultOptions: {
				from: process.env.EMAIL_DEFAULTS_FROM || process.env.SITE_NAME + "\" support\" <support@example.tld>",
				to: "",
				subject: process.env.EMAIL_DEFAULTS_SUBJECT || process.env.SITE_NAME + " - ",
				text: "Hello world!", // plain text body
				html: "<b>Hello world!</b>" // html body
			},
			smtp: {
				host: process.env.EMAIL_SMTP_HOST || "smtp.ethereal.email",
				port: process.env.EMAIL_SMTP_PORT || 587,
				secureConnection: process.env.EMAIL_SMTP_SECURE || false, // true for 465, false for other ports
				auth: {
					user: process.env.EMAIL_SMTP_AUTH_USER || "",
					pass: process.env.EMAIL_SMTP_AUTH_PASS || ""
				},
				tls: {
					ciphers: process.env.EMAIL_SMTP_CIPHERS || "SSLv3"
				}
			}
		},
	},

	/**
	 * Core methods required by this service are located in
	 * /methods/code.methods.js
	 */
	methods: {
	},

	events: {
		"cache.clean.users"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		},
		"cache.clean.follows"() {
			if (this.broker.cacher)
				this.broker.cacher.clean(`${this.name}.*`);
		}
	}
};
