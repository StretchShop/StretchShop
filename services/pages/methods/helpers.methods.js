"use strict";

const { existsSync } = require("fs");
const pathResolve = require("path").resolve;


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
			let pageSlugArray = pageSlug.split("---");
			let pageName = pageSlugArray[0];
			let templateName = "_default";
			if ( pageSlugArray.length>1 ) {
				templateName = pageSlugArray[1];
			}
			let parentDir = this.settings.paths.resources + "/pages/" + templateName+"/" +pageName+"/";
			parentDir = this.removeParentTraversing(parentDir);
			let filepath = parentDir + pageName + "-" + lang + ".html";
			filepath = pathResolve(filepath);

			// use default template if more relevant not found
			if ( !existsSync(filepath) ) {
				pageName = "default";
				parentDir = this.settings.paths.resources + "/pages/" + templateName + "/default/";
				parentDir = this.removeParentTraversing(parentDir);
				filepath = parentDir+"default-"+lang+".html";
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
						if ( Object.prototype.hasOwnProperty.call(this.schema.methods, pf.method) ) {
							promises.push( this.schema.methods[pf.method](ctx, pf.params) );
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
