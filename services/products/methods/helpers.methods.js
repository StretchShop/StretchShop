"use strict";

const SettingsMixin = require("../../../mixins/settings.mixin");


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
					{ "activity.end": { "$gte": new Date() } }
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
			filter.sort = SettingsMixin.getSiteSettings('business')?.sorting?.products?.default; // default
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


		/**
		 * Process category products properties results into better one
		 * 
		 * @param {Array} propertyGroup 
		 * @returns {Object}
		 */
		processCategoryProductsProperties(propertyGroup) {
			let result = {};
			if (propertyGroup && propertyGroup.length) {
				// loop all groups
				propertyGroup.forEach(properties => {
					// loop all properties
					Object.keys(properties).forEach(key => {
						this.logger.debug("processCategoryProductsProperties --- KEY: ", key);
						if (properties[key]) {
							// if property does not exists, add it
							if (!result[key]) {
								this.logger.debug("processCategoryProductsProperties --- NO result 4: ", key);
								result[key] = properties[key];
							// if property exists, merge new one into it
							} else {
								this.logger.debug("processCategoryProductsProperties --- HAS result 4: ", key);
								result[key] = this.mergeProductProperties(result[key], properties[key]);
							}
						}
					});

				});
			}
			return result;
		},
		/**
		 * Update property storing the maximum of available information
		 * 
		 * @param {*} oldProperty 
		 * @param {*} newProperty 
		 * @returns {Object}
		 */
		mergeProductProperties(oldProperty, newProperty) {
			const simpleTypes = this.simpleTypes();
			// author: ["Mrkva Salat", "Gombi Bombi"]
			// ISBN: { value: { sk: "SK12-345-67890", en: "EN12-345-67890"} }
			/*
			bindings: {
				name: {
					sk: "Väzba",
					en: "Bindings"
				},
				value: {
					sk: "Tvrdá",
					en: "Hard"
				}
			}
			*/
			if (oldProperty && newProperty) {
				// if not simple type
				if (simpleTypes.indexOf(oldProperty) === -1) {
					oldProperty = structuredClone(oldProperty);
				}
				this.logger.debug("mergeProductProperties --- oldProperty && newProperty: ", oldProperty, newProperty);
				// properties to check for NAME
				if (oldProperty.name && newProperty.name) { //
					this.logger.debug("mpp NAME old & new");
					oldProperty.name = this.variableTypeMerge(oldProperty.name, newProperty.name);
				// not set in old property, but set in new property
				} else if (!oldProperty.name && newProperty.name) {
					this.logger.debug("mpp NAME !old & new");
					let tempProp = { name: null, value: null };
					tempProp.value = oldProperty;
					tempProp.name = this.variableTypeMerge(null, newProperty.name);
					oldProperty = tempProp;
				// value already set in old property, but not in new
				} else if (oldProperty.name && !newProperty.name) {
					this.logger.debug("mpp NAME old & !new");
					oldProperty.name = this.variableTypeMerge(oldProperty.name, null);
				// set in none of properties
				} else if (!oldProperty.name && !newProperty.name) {
					this.logger.debug("mpp NAME !old & !new");
					// oldProperty = this.variableTypeMerge(oldProperty, newProperty);
				}
				// properties to check for VALUE
				if (oldProperty.value && newProperty.value) { //
					this.logger.debug("mpp VALUE old & new");
					oldProperty.value = this.variableTypeMerge(oldProperty.value, newProperty.value);
				// not set in old property, but set in new property
				} else if (!oldProperty.value && newProperty.value) {
					this.logger.debug("mpp VALUE !old & new");
					oldProperty.value = this.variableTypeMerge(oldProperty, newProperty.value);
				// value already set in old property, but not in new
				} else if (oldProperty.value && !newProperty.value && !newProperty.name) {
					this.logger.debug("mpp VALUE old & !new");
					oldProperty.value = this.variableTypeMerge(oldProperty.value, newProperty);
				// set in none of properties
				} else if (!oldProperty.value && !newProperty.value) {
					this.logger.debug("mpp VALUE !old & !new");
					oldProperty = this.variableTypeMerge(oldProperty, newProperty);
				}
			}
			return oldProperty;
		},
		/**
		 * 
		 * @param {any} oldVar 
		 * @param {any} newVar 
		 */
		variableTypeMerge(oldVar, newVar) {
			const simpleTypes = this.simpleTypes();
			const oldType = typeof oldVar;
			const newType = typeof newVar;
			let result = null;
			this.logger.debug("vtm ----> vars: ", oldVar, oldType, newVar, newType);
			// FIRST solve null and array cases
			// if old value is null, use only new one
			if ( (!oldVar || oldVar === null) && (newVar && newVar !== null)) {
				// set only new value
				result = newVar;
				this.logger.debug("vtm ----> a01: ", result);
			// if new value is null, use only old value
			} else if ( (oldVar && oldVar !== null) && (!newVar || newVar === null)) {
				// set only old value
				result = oldVar;
				this.logger.debug("vtm ----> a02: ", result);
			// if old and new variable is Array, just merge them
			} else if (oldVar.constructor === Array && newVar.constructor === Array) {
				// merge arrays
				result = [...new Set([].concat(...oldVar,...newVar))];
				this.logger.debug("vtm ----> a1: ", result);
			// if old is array and new one is simple type
			} else if (oldVar.constructor === Array && simpleTypes.indexOf(newType) > -1) {
				// push to array
				if (oldVar.indexOf(newVar) === -1) {
					oldVar.push(newVar);
				}
				result = [...oldVar];
				this.logger.debug("vtm ----> a2: ", result);
			// if old is simple type and new one is array
			} else if (simpleTypes.indexOf(oldVar) > -1 && newType.constructor === Array ) {
				// put value on begining of array
				if (newVar.indexOf(oldVar) === -1) {
					newVar.unshift(oldVar);
				}
				result = [...newVar];
				this.logger.debug("vtm ----> a3: ", result);
			// if old is array and new is object
			} else if (oldVar.constructor === Array && newType === "object") {
				// loop object property values and merge them with array
				result = {};
				Object.keys(newVar).forEach(k => {
					result[k] = this.variableTypeMerge(oldVar, newVar[k]);
				});
				this.logger.debug("vtm ----> a4: ", result);
			// if old is object and new is array
			} else if (oldType === "object" && newVar.constructor === Array) {
				// loop object property values and merge them with array
				result = {};
				Object.keys(oldVar).forEach(k => {
					result[k] = this.variableTypeMerge(oldVar[k], newVar);
				});
				this.logger.debug("vtm ----> a5: ", result);
			// SECOND if types match
			} else if (oldType === newType) {
				this.logger.debug("vtm ----> t1==t2: ");
				// both are objects means they have translations, loop them
				if (oldType === "object") {
					result = {};
					Object.keys(oldVar).forEach(k => {
						result[k] = this.variableTypeMerge(oldVar[k], newVar[k]);
					});
					this.logger.debug("vtm ----> t1==t2 obj: ", result);
				} else {
					// any other types can me turned to array
					if (oldVar === newVar) {
						// same values, avoid duplicate
						result = [oldVar];
					} else {
						result = [oldVar, newVar];
					}
					this.logger.debug("vtm ----> t1==t2 else: ", result);
				}
			// ELSE if no array and types don't match
			} else {
				// if both types are simple, make an array of them
				if (simpleTypes.indexOf(oldType) > -1 && simpleTypes.indexOf(newType) > -1) {
					result = [oldVar, newVar];
					this.logger.debug("vtm ----> simples: ", result);
				} else {
					// one of them is an object, merge them together with languages
					result = {};
					if (oldType === "object") {
						Object.keys(oldVar).forEach(k => {
							result[k] = this.variableTypeMerge(oldVar[k], newVar);
						});
						this.logger.debug("vtm ----> old obj: ", result);
					} else if (newType === "object") {
						Object.keys(newVar).forEach(k => {
							result[k] = this.variableTypeMerge(oldVar, newVar[k]);
						});
						this.logger.debug("vtm ----> new obj: ", result);
					}
				}
			}
			return result;
		},
		/**
		 * Get 
		 * @returns {array}
		 */
		simpleTypes() {
			return ["string", "number", "boolean"];
		}


	}
};
