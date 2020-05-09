"use strict";


module.exports = function(address){
	let requiredFields = [ "nameFirst", "nameLast", "street", "zip", "city", "country", "phone" ];
	let errors = [];
	let validAddress = true;

	Object.keys(address).forEach(function(key) {
		if ( address[key].trim()=="" && requiredFields.indexOf(key)>-1 ) {
			errors.push({ name: key, action: "is empty" });
			validAddress = false;
		}
	});

	return { result: validAddress, errors: errors };
};
