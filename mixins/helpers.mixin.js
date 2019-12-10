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
        paramsArray.forEach(function(key,index) {
          let replaceFrom = "\:"+key;
          resultString = resultString.replace( replaceFrom, params[key] );
        });
 		  }
 			return resultString;
 		},

		/**
		 * replace parameters in array marked as ":param" in string with request params array
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
 		}

  }
};
