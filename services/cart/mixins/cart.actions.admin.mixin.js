"use strict";

const { MoleculerClientError } = require("moleculer").Errors;

module.exports = {
	actions: {
		cleanCarts: {
			cache: false,
			handler(ctx) {
				let promises = [];
				const d = new Date();
				d.setMonth(d.getMonth() - 1);
				return this.adapter.find({
					query: {
						dateUpdated: { "$lt": d }
					}
				})
					.then(found => {
						found.forEach(cart => {
							promises.push( 
								ctx.call("cart.remove", {id: cart._id} )
									.then(removed => {
										return "Removed carts: " +JSON.stringify(removed);
									})
							);
						});
						// return all delete results
						return Promise.all(promises).then((result) => {
							return result;
						});
					});
			}
		}
	}
};
