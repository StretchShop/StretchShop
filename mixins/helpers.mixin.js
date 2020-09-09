"use strict";

module.exports = {
	methods: {

		/**
		 * simple function to split string into
		 */
		stringChunk(str, chunkSize, separator) {
			chunkSize = (typeof chunkSize === "undefined") ? 2 : chunkSize;
			separator = (typeof separator === "undefined") ? "/" : separator;
			let resultString = "";

			if ( str.length>0 ) {
				let resultArray = [];
				let chunk = "";
				for ( let i = 0; i<str.length; i=(i+chunkSize) ) {
					chunk = str.substring(i,i+chunkSize);
					if ( chunk.trim()!="" ) {
						resultArray.push(chunk);
					}
				}
				if (resultArray.length) {
					resultString = resultArray.join(separator);
				}
			} else {
				resultString = str;
			}

			return resultString;
		},

		/**
		 * replace parameters marked as ":param" in string with request params object
		 */
		stringReplaceParams(str, params) {
			let resultString = str;
			let paramsArray = Object.keys(params);
			if ( paramsArray.length>0 ) {
				paramsArray.forEach(function(key) {
					let replaceFrom = ":"+key;
					resultString = resultString.replace( replaceFrom, params[key] );
				});
			}
			return resultString;
		},

		/**
		 * replace parameters in array marked as ":param" in string with request params array
		 * 
		 * @param {*} array 
		 * @param {*} params 
		 */
		arrayReplaceParams(array, params) {
			let resultArray = array;
			if ( array.length>0 ) {
				let tempArray = [];
				for ( let i = 0; i<array.length; i++ ) {
					tempArray.push( this.stringReplaceParams(array[i], params) );
				}
				return tempArray;
			}
			return resultArray;
		},
			

		/**
		 * Rounds number with scale param for rounding
		 * thanks to
		 * https://stackoverflow.com/questions/11832914/round-to-at-most-2-decimal-places-only-if-necessary
		 * and
		 * https://plnkr.co/edit/uau8BlS1cqbvWPCHJeOy?p=preview
		 */
		roundNumber(num, scaleParam) {
			let scale = (typeof scaleParam=="undefined") ? scaleParam : 2;
			if (Math.round(num) != num) {
				if (Math.pow(0.1, scale) > num) {
					return 0;
				}
				let sign = Math.sign(num);
				let arr = ("" + Math.abs(num)).split(".");
				if (arr.length > 1) {
					if (arr[1].length > scale) {
						let integ = +arr[0] * Math.pow(10, scale);
						let dec = integ + (+arr[1].slice(0, scale) + Math.pow(10, scale));
						let proc = +arr[1].slice(scale, scale + 1);
						if (proc >= 5) {
							dec = dec + 1;
						}
						dec = sign * (dec - Math.pow(10, scale)) / Math.pow(10, scale);
						return dec;
					}
				}
			}
			return num;
		},

		/**
		 * price to numeral format acceptable by payment gate
		 * 
		 * @param {*} number 
		 */
		formatPrice(number) {
			return parseFloat(this.roundNumber(number).toFixed(2));
		},

		/**
		 * Loop array of objects with parameter "code" and retur
		 * 
		 * @param {*} arrayOfValues 
		 * @param {*} codeToPick 
		 */
		getValueByCode(arrayOfValues, codeToPick) {
			let result = arrayOfValues[0]; 
			if (arrayOfValues.length>0 && codeToPick!="") {
				arrayOfValues.some(function(value){
					if (value && value.code && value.code!="" && value.code==codeToPick) {
						result = value;
						return true;
					}
				});
			}
			return result;
		}, 
		

		/**
		 * Sort object's params in alphabetical order
		 * 
		 * @param {*} o 
		 */
		sortObject(o) {
			let sorted = {},
				key, a = [];

			// get object's keys into array
			for (key in o) {
				if (Object.prototype.hasOwnProperty.call(o, key)) {
					a.push(key);
				}
			}

			// sort array of acquired keys
			a.sort();

			// fill array keys with related values
			for (key = 0; key < a.length; key++) {
				if (typeof o[a[key]] === "object") {
					// if object, sort its keys recursively
					sorted[a[key]] = this.sortObject( o[a[key]] );
				} else {
					// assign value to key
					sorted[a[key]] = o[a[key]];
				}
			}

			// return sorted result
			return sorted;
		},


		/**
		 * Get address of user by type (invoice, delivery)
		 */
		getUserAddress(user, type) {
			let addType = (typeof type=="undefined") ? null : type;
			let allowedTypes = ["invoice", "delivery"];
			let result = null;
			if (user && user.addresses && user.addresses.length>0) {
				user.addresses.some(function(value){
					if ( addType && allowedTypes.indexOf(addType)>-1 ) {
						// if type set check for match
						if ( value.type == addType ) {
							// type matching - return address
							result = value;
							return true;
						}
					} else {
						// no type set or not matching - return first address
						result = value;
						return true;
					}
				});
			}

			return result;
		}, 


		/**
		 * Count prices with & without tax from global or product tax
		 * @returns object with zero values if nothing to count
		 * @param {*} product 
		 * @param {*} settings 
		 */
		getProductTaxData(product, taxSettings) {
			let result = {
				taxDecimal: 0, // eg. 0.2 (= 20%)
				tax: 0, // eg. 30 (0.2 * 150),
				taxType: "VAT",
				priceWithoutTax: null, // eg. 120 (150 - (0.2 * 150))
				priceWithTax: null // eg. 120 (150 - (0.2 * 150))
			};
			// use global tax as default
			if (taxSettings && taxSettings.global && taxSettings.global.taxDecimal) {
				result.taxDecimal = taxSettings.global.taxDecimal;
			}
			// use product tax, if set
			if (product && product.tax && product.tax!==null) {
				result.taxDecimal = product.tax;
			}
			// count tax prices using taxDecimal
			if (result.taxDecimal>0 && product && product.price) {
				result.tax = result.taxDecimal * product.price;
				result.taxType = taxSettings.taxType;
				if (taxSettings.taxType == "IT") {
					result.priceWithoutTax = product.price;
					result.priceWithTax = product.price + (result.taxDecimal * product.price);
				} else { // VAT as default
					result.priceWithTax = product.price;
					result.priceWithoutTax = product.price - (result.taxDecimal * product.price);
				}
			}
			product.taxData = result;
			product.tax = result.taxDecimal;
			return product;
		},


		/**
		 * Get request url and query
		 * @param {*} ctx 
		 */
		getRequestData(ctx) {
			let result = {
				url: null,
				query: null
			};
			
			if (ctx) {
				if (ctx.options && ctx.options.parentCtx && ctx.options.parentCtx.params && 
					ctx.options.parentCtx.params.req) {
					
					// get url as string and array
					if (ctx.options.parentCtx.params.req.parsedUrl) {
						result.url = {
							string: ctx.options.parentCtx.params.req.parsedUrl,
							array: ctx.options.parentCtx.params.req.parsedUrl.split("/")
						};
					}

					// get query as object
					if (ctx.options.parentCtx.params.req.query) {
						result.query = ctx.options.parentCtx.params.req.query;
					}

					// get headers as object
					if (ctx.options.parentCtx.params.req.headers) {
						result.headers = ctx.options.parentCtx.params.req.headers;
					}
				}
			}

			return result;
		}

	}
};
