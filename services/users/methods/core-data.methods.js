"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		/**
		 * Get core data - langs, countries, currencies
		 *
		 * @actions
		 *
		 * @returns {Object} core data from api service
		 */
		getCoreData: {
			auth: "optional", // we get user if possible
			params: {
				transLang: { type: "string", optional: true },
				transBlockName: { type: "string", optional: true }
			},
			handler(ctx) {
				let coreData = this.getCoreDataBase(ctx);

				delete coreData.settings.business.account;
				// have user, add translations
				if (ctx.meta.user?._id) {
					return ctx.call("users.me")
						.then(user => {
							if (user?.user) {
								user.user = this.removePrivateData(user.user);
								coreData.user = user.user;
								// if no transLang use user.settings.lang
								if ((ctx.params.transLang || ctx.params.transLang.trim() == "") &&
									coreData.user.settings?.lang &&
									this.isValidTranslationLanguage(coreData.user.settings.lang, coreData.langs)) {
									coreData.lang = this.getValueByCode(coreData.langs, coreData.user.settings.lang);
								}
							}
							return ctx.call("users.readTranslation", {
								lang: coreData.lang.code,
								blockName: ctx.params.transBlockName
							})
								.then(translation => {
									coreData.translation = translation;
									if (ctx.params.transLang != coreData.lang.code) {
										coreData.lang = this.getValueByCode(coreData.langs, ctx.params.transLang);
									}
									coreData = this.specialValuesFromContext(ctx, coreData);
									return coreData;
								});
						})
						.catch(error => {
							this.logger.error("users.getCoreData users.me error:", error);
						});
				} else { // no user
					// get translation if language not default
					if (coreData.lang.code && coreData.langs &&
						this.isValidTranslationLanguage(coreData.lang.code, coreData.langs)) {
						return ctx.call("users.readTranslation", {
							lang: coreData.lang.code,
							blockName: ctx.params.transBlockName
						})
							.then(translation => {
								coreData.translation = translation;
								coreData = this.specialValuesFromContext(ctx, coreData);
								return coreData;
							})
							.catch(err => {
								console.error("users.getCoreData error: ", err);
								return this.Promise.reject(new MoleculerClientError("Can't read coredata", 422, "", []));
							});
					}
					return coreData;
				}
			}
		},
	}
};
