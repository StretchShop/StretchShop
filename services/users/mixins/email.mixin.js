"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const emailTemplate = require("../../../mixins/email.mixin");

module.exports = {
	actions: {
		/**
		 * Send email based on template and data for it
		 * Auth is required!
		 *
		 * @actions
		 *
		 * @param {String} template - name of template
		 * @param {Object} data - Email data to place in email
		 * @param {Object} settings - Email settings
		 *
		 * @return {Boolean}
		 */
		sendEmail: {
			auth: "required",
			params: {
				template: { type: "string", min: 3 },
				data: { type: "object" },
				settings: { type: "object", optional: true },
				functionSettings: { type: "object", optional: true }
			},
			handler(ctx) {
				let self = this;

				// After SMTP auth failure, skip further attempts until cooldown expires
				// (avoids log floods / provider rate limits when credentials are wrong).
				if (this._emailBlockedUntil && Date.now() < this._emailBlockedUntil) {
					const waitSec = Math.ceil((this._emailBlockedUntil - Date.now()) / 1000);
					const err = new Error(`SMTP temporarily disabled after authentication failure (retry in ${waitSec}s)`);
					err.code = "EAUTH_BLOCKED";
					err.emailTransportBlocked = true;
					this.logger.warn("users.sendEmail - skipped:", err.message);
					return Promise.reject(err);
				}

				ctx.params.settings = (typeof ctx.params.settings !== "undefined") ?  ctx.params.settings : null;
				ctx.params.functionSettings = (typeof ctx.params.functionSettings !== "undefined") ?  ctx.params.functionSettings : null;
				// set language of template
				let langCode = (ctx.meta.localsDefault && ctx.meta.localsDefault.lang) || "null";
				if ( ctx.params.functionSettings && typeof ctx.params.functionSettings.language !== "undefined" && ctx.params.functionSettings.language ) {
					langCode = ctx.params.functionSettings.language;
				}
				if ( (langCode == "null" || !langCode) && ctx.params.data && ctx.params.data.order && ctx.params.data.order.lang ) {
					langCode = ctx.params.data.order.lang;
				}
				if ( typeof langCode.code !== "undefined" ) {
					langCode = langCode.code;
				}
				// load templates
				return emailTemplate(ctx.params.template+"-"+langCode, ctx.params.data)
					.then((templates)=>{
						let transporter = nodemailer.createTransport(this.settings.mailSettings.smtp);

						// Clone defaults — never mutate shared mailSettings.defaultOptions
						// (otherwise subject/body from one email leak into later sends).
						let mailOptions = Object.assign({}, this.settings.mailSettings.defaultOptions);
						if ( ctx.params.settings ) {
							for (let newProperty in ctx.params.settings) {
								if ( Object.prototype.hasOwnProperty.call(ctx.params.settings,newProperty) ) {
									mailOptions[newProperty] = ctx.params.settings[newProperty];
								}
							}
						}

						if (templates.html) {
							mailOptions.html = templates.html;
						}
						if (templates.txt) {
							mailOptions.text = templates.txt;
						}
						this.logger.info("users.sendEmail - Trying to send email with these options:", mailOptions);

						let emailSentResponse = new Promise(function(resolve, reject) {
							transporter.sendMail(mailOptions, (error, info) => {
								if (error) {
									self.logger.error("users.sendEmail sendMail error: ", error);
									if (error.code === "EAUTH" || error.responseCode === 535 || error.responseCode === 403) {
										let cooldownMs = 5 * 60 * 1000;
										const match = /Check again in (\d+) seconds/i.exec(
											String(error.response || error.message || "")
										);
										if (match) {
											cooldownMs = (parseInt(match[1], 10) + 30) * 1000;
										}
										self._emailBlockedUntil = Date.now() + cooldownMs;
										self.logger.warn(
											"users.sendEmail - SMTP auth failed; blocking further sends for " +
											Math.ceil(cooldownMs / 1000) + "s"
										);
									}
									return reject(error);
								}
								// Clear block after a successful send
								self._emailBlockedUntil = null;
								if ( info && info.messageId ) {
									self.logger.info("users.sendEmail sendMail MessageId: ", info.messageId);
								}
								// Preview only available when sending through an Ethereal account
								self.logger.info("user.sendEmail sendMail messageUrl: ", nodemailer.getTestMessageUrl(info));
								resolve(true);
							});
						});

						return emailSentResponse
							.catch(err => {
								this.logger.error("users.sendEmail - emailSentResponse error:", err.message || err);
								return Promise.reject(err);
							});
					})
					.catch(err => {
						this.logger.error("users.sendEmail - template/send error:", err.message || err);
						return Promise.reject(err);
					});
			}

		},


		/**
		 * Verify if email has this hash - returns user
		 *
		 * @actions
		 *
		 * @param {String} email - email address to verify
		 * @param {Object} hash - hash to verify
		 * @param {Object} string - action if other than activation =
		 *
		 */
		verifyHash: {
			params: {
				email: { type: "string" },
				hash: { type: "string" },
				action: { type: "string", optional: true }
			},
			handler(ctx) {
				// transform email string to email address
				let re = new RegExp("--", "g");
				let email = ctx.params.email.toString().replace("---", "@").replace(re, ".");
				const TIME_TO_PAST = 60 * 60 * 1000 * 2; // 2 hours
				let oldDate = new Date();
				oldDate.setTime( (new Date().getTime()) - TIME_TO_PAST );
				let hash = "$2b$10$"+decodeURIComponent(ctx.params.hash).toString().replace(re, ".");
				
				this.logger.info("users.verifyHash: ", { 
					email: email, 
					"dates.dateActivated": {"$exists": false},
					"dates.dateLastVerify": {"$gt": oldDate} 
				});
				return this.adapter.find({
					query: { 
						email: email, 
						"dates.dateActivated": {"$exists": false},
						"dates.dateLastVerify": {"$gt": oldDate} 
					}
				})
					.then((found) => {
						if ( found && found.constructor === Array && found.length>0 ) {
							found = found[0];
						}
						if ( found && found.password && found.password.toString().trim()!="" ) {
							const dateCreated = found.dates.dateCreated;
							const dateCreatedIso = (dateCreated instanceof Date)
								? dateCreated.toISOString()
								: new Date(dateCreated).toISOString();
							let wannabeHash = this.buildHashSourceFromEntity(found.password, dateCreatedIso, false);
							return bcrypt.compare(wannabeHash, hash)
								.then((result) => { 
									this.logger.info("users.verifyHash compared:", result);

									if (result) {
										// Write Date objects only — prepareForUpdate JSON-stringifies Dates
										return this.adapter.updateById(found._id, {
											"$set": { "dates.dateActivated": new Date() }
										})
											.then(doc => {
												return this.transformDocuments(ctx, {}, doc);
											})
											.then(user => {
												return this.transformEntity(user, true, ctx);
											})
											.then(json => {
												return this.entityChanged("updated", json, ctx)
													.then(() => json);
											});
									} else {
										return Promise.reject(new MoleculerClientError("Activation failed!", 422, "", [{ field: "activation", message: "failed"}]));
									}

								});
						}
						return Promise.reject(new MoleculerClientError("Activation failed - try again", 422, "", [{ field: "activation", message: "failed"}]));
					})
					.catch(err => {
						if (err instanceof MoleculerClientError) {
							return Promise.reject(err);
						}
						console.error("users.verifyHash activation failed: ", err);
						return Promise.reject(new MoleculerClientError("Activation failed - try again", 422, "", [{ field: "activation", message: "failed"}]));
					});
				/**
				 * - verify hash (by email) & date stored in dates.dateLastVerify (2 hours),
				 * - set activated date if activate action,
				 * - set token,
				 * - redirect to profile page
				 */
			}
		},


		/**
		 * Reset password - returns user
		 *
		 * @actions
		 *
		 * @param {String} email - email address to reset
		 *
		 */
		resetPassword: {
			auth: "required",
			authType: "csrfCheck",
			params: {
				email: { type: "string" }
			},
			handler(ctx) {
				this.logger.info("users.resetPassword params.email: ", ctx.params.email);
				return this.enforceRateLimit(ctx, "resetPassword", { limit: 3, windowMs: 60 * 60 * 1000 })
					.then(() => this.adapter.findOne({ email: ctx.params.email }))
					.then((found) => {
						if ( found ) {
							if ( !found.settings ) {
								found.settings = {
									language: ctx.meta.localsDefault.lang,
									currency: ctx.meta.localsDefault.currency
								};
							}

							const now = new Date();
							// Targeted update with real Date objects.
							// Do NOT use prepareForUpdate here — JSON.stringify turns Dates into
							// strings, and verifyHash's Date $gt query then never matches.
							const update = {
								"$set": {
									"dates.dateUpdated": now,
									"dates.dateLastVerify": now,
									settings: found.settings
								},
								"$unset": { "dates.dateActivated": 1 }
							};

							return this.adapter.updateById(found._id, update)
								.then(() => {
									const dateCreated = found.dates.dateCreated;
									const dateCreatedIso = (dateCreated instanceof Date)
										? dateCreated.toISOString()
										: new Date(dateCreated).toISOString();
									const entity = { user: found };
									// send email separately asynchronously not waiting for response
									let emailData = {
										"entity": entity,
										"keepItForLater": this.buildHashSourceFromEntity(found.password, dateCreatedIso),
										"url": ctx.meta.siteSettings.url+"/"+found.settings.language,
										"language": found.settings.language,
										"templateName": "auth/pwdreset"
									};
									this.sendVerificationEmail(emailData, ctx);
									this.logger.info("users.resetPassword - Email sent");
									// Never return password hash or full DB document
									return { success: true };
								});
						}
						// Same generic response whether or not the email exists
						return { success: true };
					})
					.catch(err => {
						if (err?.code === 429) {
							return Promise.reject(err);
						}
						console.error("users.resetPassword account reset failed: ", err);
						return Promise.reject(new MoleculerClientError("Account reset failed - try again", 422, "", [{ field: "email", message: "not found"}]));
					});
				/**
				 * - verify hash (by email) & date stored in dates.dateLastVerify (2 hours),
				 * - set activated date if activate action,
				 * - set token,
				 * - redirect to profile page
				 */
			}
		},
	}
};
