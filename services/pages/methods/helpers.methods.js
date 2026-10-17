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
		 * True when the localized template or its language-less sibling exists.
		 * @param {String} filepath
		 * @returns {Boolean}
		 */
		pageTemplateExists(filepath) {
			if (existsSync(filepath)) {
				return true;
			}
			const noLangPath = String(filepath).replace(/-[a-z]{2}(\.[^.\\/]+)$/i, "$1");
			return noLangPath !== filepath && existsSync(noLangPath);
		},


		/**
		 * Resolve one template directory under the page group.
		 * @param {String} pagesRoot
		 * @param {String} templateName
		 * @param {String} name
		 * @param {String} safeLang
		 * @returns {{ pageName: String, parentDir: String, filepath: String }}
		 */
		resolvePageTemplate(pagesRoot, templateName, name, safeLang) {
			const pageName = sanitizePathSegment(name);
			const parentDir = pathResolve(pagesRoot, templateName, pageName);
			assertResolvedUnderRoot(pagesRoot, parentDir);
			const filepath = pathResolve(parentDir, pageName + "-" + safeLang + ".html");
			assertResolvedUnderRoot(pagesRoot, filepath);
			return { pageName, parentDir, filepath };
		},


		/**
		 * Resolve the page template directory.
		 * The page subtype is the template name. Missing templates fall back to default.
		 * Subtype "slug" looks in resources/pages/_slugs/{slug} before that fallback.
		 * The homepage slug always uses the homepage subtype.
		 *
		 * @param {String} lang - 2-letter code of active language
		 * @param {String} pageSlug - slug of active page
		 * @param {String} [subtype] - page subtype used as the template name
		 * @returns
		 */
		getTemplateVars(lang, pageSlug, subtype) {
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

			const candidates = [];
			let subtypeRaw = String(subtype || "").trim();
			if (pageName.toLowerCase() === "homepage") {
				subtypeRaw = "homepage";
			}
			if (subtypeRaw.toLowerCase() === "slug") {
				candidates.push({ group: "_slugs", name: pageName });
			} else if (subtypeRaw) {
				try {
					const safeSubtype = sanitizePathSegment(subtypeRaw);
					if (safeSubtype && safeSubtype !== "default") {
						candidates.push({ group: templateName, name: safeSubtype });
					}
				} catch {
					// ignore subtypes that are not safe path segments
				}
			}
			candidates.push({ group: templateName, name: "default" });

			let resolved = null;
			for (let i = 0; i < candidates.length; i++) {
				const item = candidates[i];
				const candidate = this.resolvePageTemplate(pagesRoot, item.group, item.name, safeLang);
				const isLast = i === candidates.length - 1;
				if (isLast || this.pageTemplateExists(candidate.filepath)) {
					resolved = {
						templateName: item.group,
						pageName: candidate.pageName,
						parentDir: candidate.parentDir,
						filepath: candidate.filepath
					};
					break;
				}
			}

			return {
				pageSlugArray,
				templateName: resolved.templateName,
				pageName: resolved.pageName,
				parentDir: resolved.parentDir,
				filepath: resolved.filepath
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
