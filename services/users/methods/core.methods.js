"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

const bcrypt 		= require("bcryptjs");
const jwt 			= require("jsonwebtoken");

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
			if ( coreData.lang && coreData.langs ) {
				for (let i = 0; i<coreData.langs.length; i++) {
					if (coreData.langs[i].code==coreData.lang) {
						coreData.langs[i]["default"] = true;
						coreData.lang = coreData.langs[i];
						break;
					}
				}
			}
			// set full currency
			if ( coreData.currency && coreData.currencies ) {
				for (let i = 0; i<coreData.currencies.length; i++) {
					if (coreData.currencies[i].code==coreData.currency) {
						coreData.currencies[i]["default"] = true;
						coreData.currency = coreData.currencies[i];
						break;
					}
				}
			}
			// set full country
			if ( coreData.country && coreData.countries ) {
				for (let i = 0; i<coreData.countries.length; i++) {
					if (coreData.countries[i].code==coreData.country) {
						coreData.countries[i]["default"] = true;
						coreData.country = coreData.countries[i];
						break;
					}
				}
			}

			coreData.navigation = { 
				main: SettingsMixin.getSiteSettings('navigation-main'),
				footer: SettingsMixin.getSiteSettings('navigation-footer')
			};

			// get lang from translLang if set
			if ( ctx.params.transLang && ctx.params.transLang!="" && coreData.langs ) {
				// if valid language
				if ( this.isValidTranslationLanguage(ctx.params.transLang, coreData.langs) ) {
					coreData.lang = coreData.lang = this.getValueByCode(coreData.langs, ctx.params.transLang);
				}
			}

			// get other details - user and translation
			coreData.user = null;
			coreData.translation = null;
			coreData.settings = {
				assets: {
					url: process.env.ASSETS_URL
				},
				business: businessSettings.invoiceData.company,
				taxData: businessSettings.taxData.global,
				editableSettings: bsi?.editableSettings?.core === true ? bsi.editableSettings : false
			};

			return coreData;
		},


		/**
		 * Generate a JWT token from user entity
		 *
		 * @param {Object} user
		 */
		generateJWT(user, ctx) { //
			const today = new Date();
			const exp = new Date(today);
			exp.setDate(today.getDate() + 60);

			const generatedJwt = jwt.sign({
				id: user._id,
				username: user.username,
				exp: Math.floor(exp.getTime() / 1000)
			}, this.settings.JWT_SECRET);

			// this.logger.info("users.generateJWT - cookies:", ctx.meta.cookies);
			if ( ctx.meta.cookies ) {
				if (!ctx.meta.makeCookies) {
					ctx.meta.makeCookies = {};
				}
				ctx.meta.makeCookies["token"] = {
					value: generatedJwt,
					options: {
						path: "/",
						signed: true,
						expires: exp,
						secure: ((process.env.COOKIES_SECURE && process.env.COOKIES_SECURE==true) ? true : false),
						httpOnly: true
					}
				};
				if ( process.env.COOKIES_SAME_SITE ) {
					ctx.meta.makeCookies["token"].options["sameSite"] = process.env.COOKIES_SAME_SITE;
				}
				// this.logger.info("users.generateJWT - ctx.meta.makeCookies:", ctx.meta.makeCookies);
			}

			return generatedJwt;
		},


		/**
		 * Generate a JWT token from user entity
		 *
		 * @param {Object} user
		 */
		superloginJWT(user, ctx) {
			let superadmined = false;
			let admin = null;
			let self = this;

			// if user was not found
			if (!user) {
				return this.Promise.reject(new MoleculerClientError("Email is invalid!", 422, "", [{ field: "email", message: "not exists"}]));
			}
			// if user is not active
			if ( !user.dates.dateActivated || user.dates.dateActivated.toString().trim()=="" || user.dates.dateActivated>new Date() ) {
				return this.Promise.reject(new MoleculerClientError("User not activated", 422, "", [{ field: "email", message: "not activated"}]));
			}

			// TODO - save log about user was controlled by admin
			const adminTokenOrig = ctx.meta.cookies["token"];
			const decoded = jwt.decode(adminTokenOrig);

			if (decoded && decoded.id) {
				return this.adapter.findById(decoded.id)
					.then(adminUser => {
						const today = new Date();
						const exp = new Date(today);
						exp.setDate(today.getDate() + 60);

						superadmined = true;
						admin = adminUser;
			
						// // use if you want to save admin token to return back
						// const generatedJwt = jwt.sign({
						// 	id: adminUser._id,
						// 	username: adminUser.username,
						// 	exp: Math.floor(exp.getTime() / 1000)
						// }, self.settings.JWT_SECRET);
			
						// if ( ctx.meta.cookies ) {
						// 	if (!ctx.meta.makeCookies) {
						// 		ctx.meta.makeCookies = {};
						// 	}
						// 	ctx.meta.makeCookies["supertoken"] = {
						// 		value: generatedJwt,
						// 		options: {
						// 			path: "/",
						// 			signed: true,
						// 			expires: exp,
						// 			secure: ((process.env.COOKIES_SECURE && process.env.COOKIES_SECURE==true) ? true : false),
						// 			httpOnly: true
						// 		}
						// 	};
						// 	if ( process.env.COOKIES_SAME_SITE ) {
						// 		ctx.meta.makeCookies["supertoken"].options["sameSite"] = process.env.COOKIES_SAME_SITE;
						// 	}
						// }

						return user;
					})
					.then(auser => this.transformDocuments(ctx, {}, auser))
					.then(auser => {
						if ( ctx.meta.cart ) {
							ctx.meta.cart.user = auser._id;
						}
						return this.transformEntity(auser, false, ctx);
					})
					.then(auser => {
						if (superadmined===true) {
							auser.user.superadmined = true;
						}

						// configuring email message about admin login to user
						let emailSetup = {
							settings: {
								to: user.email,
								subject: process.env.SITE_NAME +" - Administration of your account"
							},
							functionSettings: {
								language: user.settings.language
							},
							template: "adminlogin",
							data: {
								webname: ctx.meta.siteSettings.name,
								admin: admin,
								datetime: (new Date()).toISOString(),
								user: user,
								email: user.email,
								support_email: ctx.meta.siteSettings.supportEmail
							}
						};
						// sending email independently
						ctx.call("users.sendEmail", emailSetup).then(json => {
							this.logger.info("users.superloginJWT() email sent: ", json);
						});

						return auser.user;
					});
			}

			return this.Promise.reject(new MoleculerClientError("No valid admin", 422, "", [{ field: "email", message: "not valid"}]));

		},


		/**
		 * Transform returned user entity. Generate JWT token if neccessary.
		 *
		 * @param {Object} user
		 * @param {Boolean} withToken
		 */
		transformEntity(user, withToken, ctx) {
			if (user) {
				user.image = user.image || "";
				if (withToken) {
					ctx.meta.token = this.generateJWT(user, ctx);
				}
			}

			return { user };
		},


		removePrivateData(user) {
			if (user.data && user.data.constructor === Object) {
				const FEvalidData = ["contentDependencies"];
				Object.keys(user.data).forEach(k => {
					if (FEvalidData.indexOf(k) === -1) {
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
			if ( loggedUser && loggedUser._id && loggedUser._id.toString().trim()!="" ) {
				// if loggedUser is admin and userUpdate data contain _id of user to update - can update any user
				if ( loggedUser.type=="admin" && userUpdate._id && userUpdate._id.toString().trim()!="" ) {
					return true;
				}
				// if loggedUser is admin but userUpdate has no _id - update himself
				if ( loggedUser.type==="admin" && !userUpdate._id ) {
					return true;
				}
				// if loggedUser is not admin - update himself
				if ( loggedUser.type!=="admin" && !userUpdate._id ) {
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

			if ( addressNew ) {
				for (let property in addressNew) {
					if ( Object.prototype.hasOwnProperty.call(resultAddress,property) && Object.prototype.hasOwnProperty.call(addressNew,property)) {
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
			if ( transData && transData.dictionary && transData.dictionary.records &&
				transData.dictionary.records.length>0 && langCode ) {
				for (let i=0; i<transData.dictionary.records.length; i++) {
					let translationRecordString = "";
					// #1 - get translate with same langCode
					for (let j=0; j<transData.dictionary.records[i].translates.length; j++) {
						if (transData.dictionary.records[i].translates[j].langCode===langCode) {
							// GET translation string
							translationRecordString = transData.dictionary.records[i].translates[j].translation;
						} // END if translates langCode
					} // END for traslates
					// #2 - get types and selectors from occurences
					for (let j=0; j<transData.dictionary.records[i].occurrences.length; j++) {
						// TODO - if blockName set, select only specific block
						if (transData.dictionary.records[i].occurrences[j].type) {
							if ((typeof blockName !== "undefined" && blockName!="" &&
							transData.dictionary.records[i].occurrences[j].blockName &&
							transData.dictionary.records[i].occurrences[j].blockName==blockName) ||
							typeof blockName === "undefined") {
								// GET translation TYPE
								let translationRecordType = transData.dictionary.records[i].occurrences[j].type;
								if ( transData.dictionary.records[i].occurrences[j].translationStrings &&
									transData.dictionary.records[i].occurrences[j].translationStrings.length ) {
									for (let k=0; k<transData.dictionary.records[i].occurrences[j].translationStrings.length; k++) {
										let translationRecordSelector = transData.dictionary.records[i].occurrences[j].translationStrings[k].selector;
										let translationRecordOrig = transData.dictionary.records[i].occurrences[j].translationStrings[k].stringOrig;
										extractedTranslation.push({
											type: translationRecordType,
											selector: translationRecordSelector,
											string: translationRecordString,
											original: translationRecordOrig
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
			for (let i = 0; i<langsArray.length; i++) {
				if (langsArray[i].code==lang) {
					isValidTransLang = true;
					break;
				}
			}
			return isValidTransLang;
		},


		sendVerificationEmail(emailData, ctx) {
			let re = new RegExp("\\.", "g");
			// get url from hashed string without first 7 chars ("$2b$10$")
			let hash = emailData.keepItForLater.toString().substring(7);
			hash = encodeURIComponent(hash).replace(re, "--");
			// get email string
			let email = emailData.entity.user.email.toString().replace(re, "--").replace("@", "---");
			// create activation link
			let confirmLink = emailData.url+"/user/verify/"+encodeURIComponent(email)+"/"+hash; // using email to identify and hash to verify
			// setup object for sending email
			let emailSetup = {
				settings: {
					to: emailData.entity.user.email,
					subject: process.env.SITE_NAME +" - Welcome - please activate"
				},
				functionSettings: {
					language: emailData.lang
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
			ctx.call("users.sendEmail", emailSetup).then(json => {
				this.logger.info("users.sendVerificationEmail email sent", json);
			});
		},


		prepareForUpdate(object) { // TODO - unify into mixin
			let objectToSave = JSON.parse(JSON.stringify(object));
			if ( typeof objectToSave._id !== "undefined" && objectToSave._id ) {
				delete objectToSave._id;
			}
			return { "$set": objectToSave };
		},


		buildHashSourceFromEntity(string1, string2, hashedParam) {
			// don't hash only if hashedParam is false
			let hashed = (typeof hashedParam!=="undefined" && hashedParam===false) ? false : true;
			let comboString = string1.substr(12,10)+string2+string1.substr(30);
			if (!hashed) {
				return comboString;
			}
			let hashSource = bcrypt.hashSync(comboString, 10);
			return hashSource;
		},

	}
};
