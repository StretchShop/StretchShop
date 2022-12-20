"use strict";

const path = require("path");
const mkdir = require("mkdirp").sync;

const DbService	= require("moleculer-db");
// const DbService	= require("@stretchshop/moleculer-db");

module.exports = function(collection) {
	if (process.env.MONGO_URI) {
		// Mongo adapter
		const MongoAdapter = require("moleculer-db-adapter-mongo");

		return {
			mixins: [DbService],
			adapter: new MongoAdapter(process.env.MONGO_URI, { 
				useNewUrlParser: true,
				useUnifiedTopology: true
			}),
			collection,
			methods: {
				fixStringToId(idString) {
					if ( typeof this.adapter.stringToObjectID !== "undefined" ) {
						return this.adapter.stringToObjectID(idString);
					}
					return idString;
				},

				fixRequestIds(request, idAnalysis) {
					let self = this;
					const regex = /^[a-fA-F0-9]{24}$/; // MongoDb ObjectId.toString() has 24 characters
					idAnalysis = (typeof idAnalysis !== "undefined") ?  idAnalysis : false;
				
					if (request) {
						// if request is array, for values and fix any _id
						if ( request.constructor === Array && request.length > 0) {
							request.forEach( (v, i) => {
								if (v.constructor === String && regex.test(v)) {
									request[i] = self.fixStringToId(v);
								} else if (request[i].constructor === Array || request[i].constructor === Object ) {
									request[i] = self.fixRequestIds(request[i], idAnalysis);
								}
							});
						} else 
						// if request is object, look keys and fix any for _id
						if ( request.constructor === Object && Object.keys(request).length > 0) {
							Object.keys(request).forEach(k => {
								if (typeof request[k] !== "undefined" && request[k] !== null) {
									if (idAnalysis && request[k].constructor === String && regex.test(request[k])) {
										request[k] = self.fixStringToId(request[k]);
									} else if (k === "_id") {
										request[k] = self.fixRequestIds(request[k], true);
									} else if (request[k].constructor === Array || request[k].constructor === Object ) {
										request[k] = self.fixRequestIds(request[k], idAnalysis);
									}
								} else {
									// delete request[k]; // if value is null
								}
							});
						} else 
						// string
						if (request.constructor === String && regex.test(request)) {
							request = self.fixStringToId(request);
						}
					}
					
					return request;
				}
			}
		};
	}

	// --- NeDB fallback DB adapter

	// Create data folder
	mkdir(path.resolve("./data"));

	return {
		mixins: [DbService],
		adapter: new DbService.MemoryAdapter({ filename: `./data/${collection}.db` }),

		methods: {
			entityChanged(type, json, ctx) {
				return this.clearCache().then(() => {
					const eventName = `${this.name}.entity.${type}`;
					this.broker.emit(eventName, { meta: ctx.meta, entity: json });
				});
			},
			fixStringToId(idString) {
				return idString;
			}
		}
	};
};
