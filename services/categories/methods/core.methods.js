"use strict";

const slug = require("slug");

module.exports = {

	/**
	 * Methods
	 */

	methods: {

		// get only categories that match parent category order
		extractChildCategoriesByArrayOrder(childCategories, masterArray) {
			let result = [];

			for (let i=0; i<childCategories.length; i++) {
				let addChild = true;
				for (let j=0; j<masterArray.length; j++) {
					if ( childCategories[i].parentPath[j] != masterArray[j] ) {
						addChild = false;
					}
				}
				if (addChild) {
					result.push(childCategories[i]);
				}
			}

			return result;
		},

		// get only categories that match child category order
		extractParentCategoriesByArrayOrder(childCategories, masterArray) {
			let result = [];

			for (let i=0; i<childCategories.length; i++) {
				if ( masterArray.indexOf(childCategories[i].slug)>-1 ) {
					result.push(childCategories[i]);
				}
			}

			return result;
		},

		// return slugs of all items in array
		getAllPathSlugs(slugsToList) {
			let result = [];

			for (let i=0; i<slugsToList.length; i++) {
				if (slugsToList[i].pathSlug) {
					result.push(slugsToList[i].pathSlug);
				}
			}

			return result;
		},

		// create all parent paths
		getAllParentPathsOfCategory(categoryParentPathsArray) {
			let results = [];

			if (categoryParentPathsArray && categoryParentPathsArray.length>0) {
				let latestPath = [];
				for (let i=0; i<categoryParentPathsArray.length; i++) {
					latestPath.push( categoryParentPathsArray[i] );
					results.push( slug(latestPath.join("-")) );
				}
			}

			return results;
		}, 


		/**
		 * Add to db query options to return only active products
		 * @param {array} query 
		 * 
		 * @returns {*} updated query
		 */
		filterOnlyActiveCategories(query, ctx) {
			// display only active products (admin can see all)
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
