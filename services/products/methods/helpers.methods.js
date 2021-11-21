"use strict";


const sppf = require("../../../mixins/subproject.helper");
let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../../resources");
const businessSettings = require( resourcesDirectory+"/settings/business");


module.exports = {

	/**
	 * Methods
	 */
	methods: {

		
		/**
		 * Add to db query options to return only active products
		 * @param {array} query 
		 * 
		 * @returns {*} updated query
		 */
		filterOnlyActiveProducts(query, metaUser) {
			// display only active products (admin can see all)
			if (metaUser && metaUser.type=="admin") {
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
			query["$and"].push({
				"$or": [
					{"stockAmount": { "$gte": 0 }},
					{"stockAmount": -1}
				]
			});
			return query;
		},


		/**
		 * Get sort based on request and user
		 * @param {*} filter 
		 * @param {*} ctx 
		 * 
		 * @returns {*} filter
		 */
		getFilterSort(filter, ctx) {
			filter.sort = businessSettings.sorting.products.default; // default
			if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
				// if applicable, get sort from request
				filter.sort = ctx.params.sort;
			}
			if (filter.sort=="price" || filter.sort=="-price") {
				let isNegative = "";
				if ( filter.sort.substring(0,1)=="-" ) {
					isNegative = "-";
				}
				// if price, set user specific price
				filter.sort = isNegative + this.getPriceVariable(ctx.meta.user);
			}

			return filter;
		},


		/**
		 * Get chunk of products and update them with price levels
		 * @param {Array} products 
		 * 
		 * @returns {Array} true if no results
		 */
		rebuildProductChunks(products) {
			let self = this;
			let result = [];

			products.forEach(p => {
				let entityId = p._id;
				p = self.makeProductPriceLevels(p);
				if (p.priceLevels) {
					result.push({
						id: entityId, 
						levels: p.priceLevels
					});
				}
				// delete p.id;
				let p2 = Object.assign({}, p);
				delete p2._id;
				const update = {
					"$set": p2
				};
				self.adapter.updateById(entityId, update);
			});

			return result;
		},


	}
};
