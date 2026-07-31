"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// settings
const SettingsMixin = require("../../../mixins/settings.mixin");


module.exports = {

	/**
	 * Methods
	 */
	methods: {


		getCoreDataBase(ctx) {
			let coreData = ctx.meta.localsDefault;
			const businessSettings = SettingsMixin.getSiteSettings('business');
			const bsi = SettingsMixin.getSiteSettings('business', true);

			// set full lang
			if (coreData.lang && coreData.langs) {
				for (const element of coreData.langs) {
					if (element.code == coreData.lang) {
						element["default"] = true;
						coreData.lang = element;
						break;
					}
				}
			}
			// set full currency
			if (coreData.currency && coreData.currencies) {
				for (const element of coreData.currencies) {
					if (element.code == coreData.currency) {
						element["default"] = true;
						coreData.currency = element;
						break;
					}
				}
			}
			// set full country
			if (coreData.country && coreData.countries) {
				for (const element of coreData.countries) {
					if (element.code == coreData.country) {
						element["default"] = true;
						coreData.country = element;
						break;
					}
				}
			}

			coreData.navigation = {
				main: SettingsMixin.getSiteSettings('navigation-main'),
				footer: SettingsMixin.getSiteSettings('navigation-footer')
			};

			// get lang from translLang if set
			if (ctx.params.transLang && ctx.params.transLang != "" && coreData.langs) {
				// if valid language
				if (this.isValidTranslationLanguage(ctx.params.transLang, coreData.langs)) {
					coreData.lang = coreData.lang = this.getValueByCode(coreData.langs, ctx.params.transLang);
				}
			}

			let additional = {};
			// get additional settings eg. from 3rd parties like google
			if (process.env.GOOGLE_TAG) {
				additional.googleTag = process.env.GOOGLE_TAG.trim();
			}

			// get other details - user and translation
			coreData.user = null;
			coreData.translation = null;
			coreData.settings = {
				assets: {
					url: process.env.ASSETS_URL
				},
				business: businessSettings.invoiceData.company,
				priceLevels: businessSettings.priceLevels.validTypes.userTypes,
				taxData: businessSettings.taxData.global,
				editableSettings: bsi?.editableSettings?.core === true ? bsi.editableSettings : false,
				additional: additional
			};

			return coreData;
		},


		/**
		 * Generate a JWT token from user entity
		 *
		 * @param {Object} user
		 * @param {Object} ctx
		 * @param {Object} [options]
		 * @param {boolean} [options.actAs] - impersonation session
		 * @param {string} [options.adminId] - real admin id when actAs
		 * @param {number} [options.expiresInHours] - override lifetime (default 60 days)
		 */
		generateJWT(user, ctx, options = {}) {
			const today = new Date();
			const exp = new Date(today);
			if (options.expiresInHours && options.expiresInHours > 0) {
				exp.setTime(today.getTime() + options.expiresInHours * 60 * 60 * 1000);
			} else {
				exp.setDate(today.getDate() + 60);
			}

			// cover the case all cookies are missing
			if (!ctx.meta.cookies) {
				ctx.meta.cookies = {};
			}

			const payload = {
				id: user._id,
				username: user.username,
				exp: Math.floor(exp.getTime() / 1000)
			};
			if (options.actAs && options.adminId) {
				payload.actAs = true;
				payload.adminId = String(options.adminId);
			}

			const generatedJwt = jwt.sign(payload, this.settings.JWT_SECRET);

			if (ctx.meta.cookies) {
				if (!ctx.meta.makeCookies) {
					ctx.meta.makeCookies = {};
				}
				ctx.meta.makeCookies["token"] = {
					value: generatedJwt,
					options: {
						path: "/",
						signed: true,
						expires: exp,
						secure: require("../../../mixins/env.helpers").isCookiesSecure(),
						httpOnly: true
					}
				};
				if (process.env.COOKIES_SAME_SITE) {
					ctx.meta.makeCookies["token"].options["sameSite"] = process.env.COOKIES_SAME_SITE;
				}
			}

			return generatedJwt;
		},


		/**
		 * Impersonate a non-admin user while preserving the admin session for restore.
		 *
		 * @param {Object} targetUser - DB user to act as
		 * @param {Object} ctx
		 * @returns {Promise<Object>} transformed target user with superadmined flag
		 */
		superloginJWT(targetUser, ctx) {
			if (!targetUser) {
				return this.Promise.reject(new MoleculerClientError("Email is invalid!", 422, "", [{ field: "email", message: "not exists" }]));
			}
			if (!targetUser.dates?.dateActivated || targetUser.dates.dateActivated.toString().trim() == "" || targetUser.dates.dateActivated > new Date()) {
				return this.Promise.reject(new MoleculerClientError("User not activated", 422, "", [{ field: "email", message: "not activated" }]));
			}
			if (targetUser.type === "admin") {
				return this.Promise.reject(new MoleculerClientError("Cannot impersonate admin", 403, "", [{ field: "email", message: "forbidden" }]));
			}

			const caller = ctx.meta.user;
			if (!caller || caller.type !== "admin" || !caller._id) {
				return this.Promise.reject(new MoleculerClientError("Not authorized!", 403, "", [{ field: "login", message: "unauthorized" }]));
			}

			const adminTokenOrig = ctx.meta.cookies?.token || ctx.meta.token;
			if (!adminTokenOrig) {
				return this.Promise.reject(new MoleculerClientError("No valid admin", 422, "", [{ field: "email", message: "not valid" }]));
			}

			let decoded;
			try {
				decoded = jwt.verify(adminTokenOrig, this.settings.JWT_SECRET, { algorithms: ["HS256"] });
			} catch (e) {
				return this.Promise.reject(new MoleculerClientError("No valid admin", 422, "", [{ field: "email", message: "not valid" }]));
			}

			if (!decoded?.id || String(decoded.id) !== String(caller._id)) {
				return this.Promise.reject(new MoleculerClientError("No valid admin", 422, "", [{ field: "email", message: "not valid" }]));
			}
			if (decoded.actAs) {
				return this.Promise.reject(new MoleculerClientError("Already impersonating", 403, "", [{ field: "login", message: "unauthorized" }]));
			}

			return this.adapter.findById(decoded.id)
				.then(adminUser => {
					if (!adminUser || adminUser.type !== "admin") {
						return this.Promise.reject(new MoleculerClientError("No valid admin", 422, "", [{ field: "email", message: "not valid" }]));
					}

					this.logger.warn("users.superloginJWT audit", {
						adminId: String(adminUser._id),
						adminEmail: adminUser.email,
						targetId: String(targetUser._id),
						targetEmail: targetUser.email,
						ip: ctx.meta.remoteAddress,
						at: new Date().toISOString()
					});

					// Preserve admin session for restore
					if (!ctx.meta.makeCookies) {
						ctx.meta.makeCookies = {};
					}
					const adminExp = new Date();
					adminExp.setDate(adminExp.getDate() + 60);
					ctx.meta.makeCookies["admin_token"] = {
						value: adminTokenOrig,
						options: {
							path: "/",
							signed: true,
							expires: adminExp,
							secure: require("../../../mixins/env.helpers").isCookiesSecure(),
							httpOnly: true
						}
					};
					if (process.env.COOKIES_SAME_SITE) {
						ctx.meta.makeCookies["admin_token"].options["sameSite"] = process.env.COOKIES_SAME_SITE;
					}

					return this.transformDocuments(ctx, {}, targetUser)
						.then(doc => {
							if (ctx.meta.cart) {
								ctx.meta.cart.user = doc._id;
							}
							doc = this.removePrivateData(doc);
							this.generateJWT(doc, ctx, {
								actAs: true,
								adminId: String(adminUser._id),
								expiresInHours: 1
							});
							const entity = this.transformEntity(doc, false, ctx);
							entity.user.superadmined = true;
							entity.user.adminId = String(adminUser._id);

							const emailSetup = {
								settings: {
									to: targetUser.email,
									subject: process.env.SITE_NAME + " - Administration of your account"
								},
								functionSettings: {
									language: targetUser.settings?.language
								},
								template: "admin/adminlogin",
								data: {
									webname: ctx.meta.siteSettings?.name,
									admin: {
										_id: adminUser._id,
										username: adminUser.username,
										email: adminUser.email
									},
									datetime: (new Date()).toISOString(),
									user: targetUser,
									email: targetUser.email,
									support_email: ctx.meta.siteSettings?.supportEmail
								}
							};
							ctx.call("users.sendEmail", emailSetup).then(json => {
								this.logger.info("users.superloginJWT() email sent: ", json);
							}).catch(err => {
								this.logger.error("users.superloginJWT() email error: ", err);
							});

							return entity;
						});
				});
		},


		/**
		 * Restore admin session after impersonation.
		 * Prefers admin_token cookie; falls back to actAs JWT adminId claim
		 * (needed when Set-Cookie overwrite dropped admin_token in non-HTTPS setups).
		 *
		 * @param {Object} ctx
		 * @returns {Promise<Object>} admin user entity with token
		 */
		restoreAdminSession(ctx) {
			const unauthorized = () => this.Promise.reject(
				new MoleculerClientError("No admin session to restore", 422, "", [{ field: "login", message: "unauthorized" }])
			);

			let adminId = null;
			const adminToken = ctx.meta.cookies?.admin_token;

			if (adminToken) {
				try {
					const decoded = jwt.verify(adminToken, this.settings.JWT_SECRET, { algorithms: ["HS256"] });
					if (decoded?.id && !decoded.actAs) {
						adminId = String(decoded.id);
					}
				} catch (e) {
					// fall through to actAs claim
				}
			}

			if (!adminId) {
				const currentToken = ctx.meta.cookies?.token || ctx.meta.token;
				if (!currentToken) {
					return unauthorized();
				}
				let decoded;
				try {
					decoded = jwt.verify(currentToken, this.settings.JWT_SECRET, { algorithms: ["HS256"] });
				} catch (e) {
					return unauthorized();
				}
				if (!decoded?.actAs || !decoded.adminId) {
					return unauthorized();
				}
				if (ctx.meta.user?._id && String(ctx.meta.user._id) !== String(decoded.id)) {
					return unauthorized();
				}
				adminId = String(decoded.adminId);
			}

			return this.adapter.findById(adminId)
				.then(adminUser => {
					if (!adminUser || adminUser.type !== "admin") {
						return this.Promise.reject(new MoleculerClientError("No valid admin", 422, "", [{ field: "login", message: "unauthorized" }]));
					}

					this.logger.warn("users.restoreAdminSession audit", {
						adminId: String(adminUser._id),
						ip: ctx.meta.remoteAddress,
						at: new Date().toISOString()
					});

					if (!ctx.meta.makeCookies) {
						ctx.meta.makeCookies = {};
					}
					// Clear impersonation restore cookie (if present)
					ctx.meta.makeCookies["admin_token"] = {
						value: "",
						options: {
							path: "/",
							signed: true,
							expires: new Date(0),
							secure: require("../../../mixins/env.helpers").isCookiesSecure(),
							httpOnly: true
						}
					};

					// Drop actAs session context so the new JWT is a normal admin token
					ctx.meta.token = null;
					ctx.meta.actAs = false;
					ctx.meta.adminId = null;
					if (ctx.meta.cookies) {
						delete ctx.meta.cookies.token;
					}
					if (ctx.meta.user) {
						delete ctx.meta.user.actAs;
						delete ctx.meta.user.adminId;
						delete ctx.meta.user.superadmined;
					}

					return this.transformDocuments(ctx, {}, adminUser)
						.then(doc => {
							doc = this.removePrivateData(doc);
							return this.transformEntity(doc, true, ctx, { skipActAsPreserve: true });
						})
						.then(entity => {
							entity.user.superadmined = false;
							return entity;
						});
				});
		},


		/**
		 * Transform returned user entity. Generate JWT token if neccessary.
		 *
		 * @param {Object} user
		 * @param {Boolean} withToken
		 * @param {Object} ctx
		 * @param {Object} [options]
		 * @param {boolean} [options.skipActAsPreserve] - do not carry over impersonation claims
		 */
		transformEntity(user, withToken, ctx, options = {}) {
			if (user) {
				user.image = user.image || "";
				if (withToken) {
					const opts = {};
					if (!options.skipActAsPreserve) {
						const existingToken = ctx.meta.token || ctx.meta.cookies?.token;
						if (existingToken) {
							try {
								const decoded = jwt.verify(existingToken, this.settings.JWT_SECRET, { algorithms: ["HS256"] });
								if (decoded.actAs && decoded.adminId) {
									opts.actAs = true;
									opts.adminId = String(decoded.adminId);
									const remainingMs = (decoded.exp * 1000) - Date.now();
									opts.expiresInHours = Math.max(0.05, Math.min(1, remainingMs / (60 * 60 * 1000)));
									user.superadmined = true;
									user.adminId = opts.adminId;
								}
							} catch (e) {
								// fall through to normal token issue
							}
						} else if (user.actAs && user.adminId) {
							opts.actAs = true;
							opts.adminId = String(user.adminId);
							opts.expiresInHours = 1;
							user.superadmined = true;
						}
					}
					ctx.meta.token = this.generateJWT(user, ctx, opts);
				}
			}

			return { user };
		},


		removePrivateData(user) {
			if (user.data?.constructor === Object) {
				const FEvalidData = ["contentDependencies"];
				Object.keys(user.data).forEach(k => {
					if (!FEvalidData.includes(k)) {
						delete user.data[k];
					}
				});
			}
			return user;
		},


		/**
		 * Transform returned user entity as profile.
		 *
		 * @param {Context} ctx
		 * @param {Object} user
		 * @param {Object?} loggedInUser
		 */
		transformProfile(ctx, user, loggedInUser) {
			user.image = user.image || "";

			if (loggedInUser) {
				return ctx.call("follows.has", { user: loggedInUser._id.toString(), follow: user._id.toString() })
					.then(res => {
						user.following = res;
						return { profile: user };
					});
			}

			user.following = false;

			return { profile: user };
		},


		/**
		 * Check if user can edit user data
		 *
		 * @param {Object} loggedUser
		 * @param {Object} userUpdate
		 *
		 * @return {Boolean}
		 */
		userCanUpdate(loggedUser, userUpdate) {
			this.logger.info("users.userCanUpdate params: ", {
				loggedUser: loggedUser,
				userUpdate: userUpdate
			});
			// check if loggedUser data has _id
			if (loggedUser && loggedUser._id && loggedUser._id.toString().trim() != "") {
				// if loggedUser is admin and userUpdate data contain _id of user to update - can update any user
				if (loggedUser.type == "admin" && userUpdate._id && userUpdate._id.toString().trim() != "") {
					return true;
				}
				// if loggedUser is admin but userUpdate has no _id - update himself
				if (loggedUser.type === "admin" && !userUpdate._id) {
					return true;
				}
				// if loggedUser is not admin - update himself
				if (loggedUser.type !== "admin" && !userUpdate._id) {
					return true;
				}
			}

			return false;
		},


		/**
		 * Merge two post addresses
		 *
		 * @param {Object} addressOrig
		 * @param {Object} addressNew
		 *
		 * @return {Object}
		 */
		mergeTwoAddresses(addressOrig, addressNew) {
			let resultAddress = addressOrig;

			if (addressNew) {
				for (let property in addressNew) {
					if (Object.hasOwn(resultAddress, property) && Object.hasOwn(addressNew, property)) {
						resultAddress[property] = addressNew[property];
					}
				}
			}

			return resultAddress;
		},



		/**
		 * Extract translation by language from translation object
		 *
		 * @param {Object} transData
		 * @param {String} langCode
		 * @param {String} blockName
		 *
		 * @return {Object}
		 */
		extractTranslation(transData, langCode, blockName) {
			let extractedTranslation = []; // { type: "text", selector: "...", string:   }
			if (transData?.dictionary?.records &&
				transData.dictionary.records.length > 0 && langCode) {
				for (const element of transData.dictionary.records) {
					let translationRecordString = "";
					// #1 - get translate with same langCode
					for (let j = 0; j < element.translates.length; j++) {
						if (element.translates[j].langCode === langCode) {
							// GET translation string
							translationRecordString = element.translates[j].translation;
						} // END if translates langCode
					} // END for traslates
					// #2 - get types and selectors from occurences
					for (let j = 0; j < element.occurrences.length; j++) {
						// TODO - if blockName set, select only specific block
						if (element.occurrences[j].type) {
							if ((blockName !== undefined && blockName != "" &&
								element.occurrences[j].blockName &&
								element.occurrences[j].blockName == blockName) ||
								blockName === undefined) {
								// GET translation TYPE
								let translationRecordType = element.occurrences[j].type;
								if (element.occurrences[j].translationStrings?.length) {
									for (let k = 0; k < element.occurrences[j].translationStrings.length; k++) {
										let translationRecordSelector = element.occurrences[j].translationStrings[k].selector;
										let translationRecordOrig = element.occurrences[j].translationStrings[k].stringOrig;
										let translationRecordPath = element.occurrences[j].path?.toString().trim().split("/src/")[1] || "";
										extractedTranslation.push({
											type: translationRecordType,
											selector: translationRecordSelector,
											string: translationRecordString,
											original: translationRecordOrig,
											path: translationRecordPath
										});
									} // END for translationStrings
								} // END if translationStrings
							} // END if blockName
						} // END if type
					} // END for occurrences
				}
			}
			let result = {};
			result[langCode] = extractedTranslation;
			return result;
		},

		isValidTranslationLanguage(lang, langsArray) {
			let isValidTransLang = false;
			for (const element of langsArray) {
				if (element.code == lang) {
					isValidTransLang = true;
					break;
				}
			}
			return isValidTransLang;
		},


		sendVerificationEmail(emailData, ctx) {
			let re = /\./g;
			// get url from hashed string without first 7 chars ("$2b$10$")
			let hash = emailData.keepItForLater.toString().substring(7);
			hash = encodeURIComponent(hash).replace(re, "--");
			// get email string
			let email = emailData.entity.user.email.toString().replace(re, "--").replace("@", "---");
			// create activation link
			let confirmLink = emailData.url + "/user/verify/" + encodeURIComponent(email) + "/" + hash; // using email to identify and hash to verify
			const isPasswordReset = emailData.templateName === "auth/pwdreset";
			// setup object for sending email
			let emailSetup = {
				settings: {
					to: emailData.entity.user.email,
					subject: isPasswordReset
						? process.env.SITE_NAME + " - Password reset"
						: process.env.SITE_NAME + " - Welcome - please activate"
				},
				functionSettings: {
					language: emailData.language || emailData.lang
				},
				template: emailData.templateName,
				data: {
					webname: process.env.SITE_NAME,
					username: emailData.entity.user.username,
					email: emailData.entity.user.email,
					confirm_link: confirmLink
				}
			};

			// sending email
			ctx.call("users.sendEmail", emailSetup)
				.then(json => {
					this.logger.info("users.sendVerificationEmail email sent", json);
				})
				.catch(error => {
					this.logger.error("users.sendVerificationEmail email failed:", error);
				});
		},


		prepareForUpdate(object) { // TODO - unify into mixin
			let objectToSave = structuredClone(object);
			if (objectToSave._id !== undefined && objectToSave._id) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		},


		buildHashSourceFromEntity(string1, string2, hashedParam) {
			// don't hash only if hashedParam is false
			let hashed = !((hashedParam !== undefined && hashedParam === false));
			let comboString = string1.substr(12, 10) + string2 + string1.substr(30);
			if (!hashed) {
				return comboString;
			}
			let hashSource = bcrypt.hashSync(comboString, 10);
			return hashSource;
		},

		/**
		 * Add special values from context to coreData 
		 * eg. session for mobile app
		 * 
		 * @param {*} ctx 
		 * @param {*} coreData 
		 * @returns 
		 */
		specialValuesFromContext(ctx, coreData) {
			const headers = ctx.meta.headers;
			const cookies = ctx.meta.cookies;
			// send session in coreData for special header - for mobile app
			if (headers['resource-type'] && headers['resource-type'] === 'MAL') {
				coreData.settings.additional['mal'] = cookies['session'];
			}
			return coreData;
		}

	}
};
