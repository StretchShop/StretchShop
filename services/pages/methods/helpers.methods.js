"use strict";

const { existsSync } = require("fs");
const pathResolve = require("path").resolve;
const { MoleculerClientError } = require("moleculer").Errors;
const { sanitizePathSegment, assertResolvedUnderRoot } = require("../../../mixins/path.security");
const { allowlistQueryFields } = require("../../../mixins/mongo.security");

const PAGE_FUNCTION_ALLOWLIST = new Set(["getProductsById"]);
const PAGE_LIST_FIELDS = [
	"slug", "categories", "pages", "type", "subtype", "name",
	"publisher", "activity", "externalId", "_id", "status"
];
const PAGE_LIST_OPERATORS = ["$in", "$eq", "$ne", "$exists"];


module.exports = {

	/**
	 * Methods
	 */
	methods: {

		/**
		 * 
		 * @param {String} lang - 2-letter code of active language
		 * @param {String} pageSlug - slug of active page
		 * @returns 
		 */
		getTemplateVars(lang, pageSlug) {
			const langRaw = String(lang || "en").trim().toLowerCase();
			const safeLang = sanitizePathSegment(langRaw.slice(0, 2));
			if (!/^[a-z]{2}$/.test(safeLang)) {
				throw new MoleculerClientError("Page not found!", 400, "", [{ field: "page", message: "not found" }]);
			}
			let pageSlugArray = String(pageSlug || "").split("---");
			let pageName = sanitizePathSegment(pageSlugArray[0]);
			let templateName = "_default";
			if ( pageSlugArray.length>1 ) {
				templateName = sanitizePathSegment(pageSlugArray[1]);
			}
			const pagesRoot = pathResolve(this.settings.paths.resources, "pages");
			let parentDir = pathResolve(pagesRoot, templateName, pageName);
			assertResolvedUnderRoot(pagesRoot, parentDir);
			let filepath = pathResolve(parentDir, pageName + "-" + safeLang + ".html");
			assertResolvedUnderRoot(pagesRoot, filepath);

			// use default template if more relevant not found
			if ( !existsSync(filepath) ) {
				pageName = "default";
				parentDir = pathResolve(pagesRoot, templateName, "default");
				assertResolvedUnderRoot(pagesRoot, parentDir);
				filepath = pathResolve(parentDir, "default-" + safeLang + ".html");
				assertResolvedUnderRoot(pagesRoot, filepath);
			}

			return {
				pageSlugArray,
				templateName,
				pageName,
				parentDir,
				filepath
			};
		},


		/**
		 * 
		 * @param {*} result 
		 * @param {*} parentCategoryDetail 
		 * @param {*} options 
		 * @returns 
		 */
		pageGlobalResultHelper_ParentCat(result, parentCategoryDetail, options) {
			if (options[1]) { // hasStaticCategories
				result.staticData["parentCategoryDetail"] = parentCategoryDetail;
			}
			if (options[0]) { // hasCategories
				result.data["parentCategoryDetail"] = parentCategoryDetail;
			}
			result.global.parentCategoryDetail = parentCategoryDetail;
			return result;
		}, 


		/**
		 * Check if page code contains any functions placeholders
		 * if does, run them and return results
		 * 
		 * @param {*} page 
		 */
		checkAndRunPageFunctions(ctx, page, lang) {
			if ( page && page.data && page.data.blocks[0] && page.data.blocks[0][lang] ) {
				let pageFunctions = this.getPageFunctions(page.data.blocks[0][lang]);
				this.logger.info("pages.checkAndRunPageFunctions() - pageFunctions: ", pageFunctions);

				if (pageFunctions && pageFunctions.length>0) {
					let promises = [];
					for (let pfi in pageFunctions) {
						let pf = pageFunctions[pfi];
						if ( PAGE_FUNCTION_ALLOWLIST.has(pf.method) && typeof this[pf.method] === "function" ) {
							promises.push( this[pf.method](ctx, pf.params) );
						}
					}
					return Promise.all(promises).then((values) => {
						return values;
					});
				}
				return null;
			}
		},


		/**
		 * Get page functions form its content - eg. {{{getBestsellers(latest)}}}
		 * 
		 * @param {*} content 
		 */
		getPageFunctions(content) {
			let re = /\{\{\{(.*)\((.*)\)\}\}\}/g;
			let m;
			let results = [];
			
			do {
				m = re.exec(content);
				if (m) {
					let result = { 
						method: m[1], 
						params: m[2] 
					};
					result.params = result.params.split(";");
					results.push(result);
				}
			} while (m);

			return results;
		},


		/**
		 * Add to db query options to return only active pages
		 * @param {array} query 
		 * 
		 * @returns {*} updated query
		 */
		/**
		 * Drop $where and other client operators; keep only page list fields.
		 * @param {object} clientQuery
		 * @returns {object}
		 */
		sanitizePageListQuery(clientQuery) {
			return allowlistQueryFields(clientQuery, PAGE_LIST_FIELDS, {
				allowedOperators: PAGE_LIST_OPERATORS
			});
		},


		filterOnlyActivePages(query, ctx) {
			// display only active pages (admin can see all)
			if (ctx.meta && ctx.meta.user && ctx.meta.user.type=="admin") {
				return query;
			}
			query["$and"].push({
				"$or": [ 
					{ "activity.start": { "$exists": false } },
					{ "activity.start": null },
					{ "activity.start": { "$lte": new Date() } }
				] 
			});
			query["$and"].push({
				"$or": [ 
					{ "activity.end": { "$exists": false } },
					{ "activity.end": null },
					{ "activity.end": { "$gte": new Date()} }
				]
			});
			return query;
		},




	}

};
