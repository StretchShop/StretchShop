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

						// updates only setting that are set and other remain from default options
						let mailOptions = this.settings.mailSettings.defaultOptions;
						if ( ctx.params.settings ) {
							for (let newProperty in ctx.params.settings) {
								if ( Object.prototype.hasOwnProperty.call(ctx.params.settings,newProperty) && Object.prototype.hasOwnProperty.call(ctx.params.settings,newProperty) ) {
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
									return reject(error);
								}
								if ( info && info.messageId ) {
									self.logger.info("users.sendEmail sendMail MessageId: ", info.messageId);
								}
								// Preview only available when sending through an Ethereal account
								self.logger.info("user.sendEmail sendMail messageUrl: ", nodemailer.getTestMessageUrl(info));
								resolve(true);
							});
						});

						return emailSentResponse.then(result => {
							return result;
						})
							.catch(err => {
								this.logger.error("users.sendEmail - emailSentResponse error:", err);
							});
					})
					.catch(err => {
						this.logger.error("users.sendEmail - template error:", err);
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
							let wannabeHash = this.buildHashSourceFromEntity(found.password, found.dates.dateCreated.toISOString(), false);
							return bcrypt.compare(wannabeHash, hash)
								.then((result) => { 
									this.logger.info("users.verifyHash compared:", result);

									if (result) {
										found.dates.dateActivated = new Date();
										return this.adapter.updateById(found._id, this.prepareForUpdate(found))
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
				return this.adapter.findOne({ email: ctx.params.email })
					.then((found) => {
						if ( found ) {
							delete found.dates.dateActivated;
							found.dates.dateUpdated = new Date();
							if ( !found.settings ) {
								found.settings = {
									language: ctx.meta.localsDefault.lang,
									currency: ctx.meta.localsDefault.currency
								};
							}

							let forUpdateUser = this.prepareForUpdate(found);
							// set date of last update (and settings if not set)
							return this.adapter.updateById(found._id, forUpdateUser)
								.then(updated => {
									// remove activation date
									return this.adapter.updateById(found._id, {
										"$unset": { "dates.dateActivated":1 }})
										.then(removedActivation => {
											let entity = { user : updated };
											// send email separately asynchronously not waiting for response
											let emailData = {
												"entity": entity,
												"keepItForLater": this.buildHashSourceFromEntity(entity.user.password, entity.user.dates.dateCreated),
												"url": ctx.meta.siteSettings.url+"/"+entity.user.settings.language,
												"language": entity.user.settings.language,
												"templateName": "auth/pwdreset"
											};
											this.sendVerificationEmail(emailData, ctx);
											this.logger.info("users.resetPassword - Email sent");
		
											return entity.user;
										});
								});
						}
						return Promise.reject(new MoleculerClientError("Account reset failed - try again", 422, "", [{ field: "email", message: "not found"}]));
					})
					.catch(err => {
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
