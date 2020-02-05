"use strict";

module.exports = {
	methods: {

		/**
		 * simple function to split string into
		 */
		stringChunk(str, chunkSize) {
			chunkSize = (typeof chunkSize === "undefined") ? 2 : chunkSize;
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
					resultString = resultArray.join("/");
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

	}
};
