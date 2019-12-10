"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const slug = require("slug");

const { readdirSync, statSync } = require('fs');
const pathResolve = require('path').resolve;

//const crypto 		= require("crypto");
const Cookies   = require("cookies");

const DbService = require("../mixins/db.mixin");
const FileHelpers = require("../mixins/file.helpers.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

module.exports = {
	name: "pages",
	mixins: [
		DbService("pages"),
		FileHelpers,
		// CacheCleanerMixin([
		// 	"cache.clean.cart"
		// ])
	],

	/**
	 * Default settings
	 */
	settings: {
		/** Public fields */
    idField: "_id",

		fields: [
			"_id", "externalId", "variationGroupId", "slug",
			"publisher", "authors", // authors = object
			"type", "subtype",
			"name", "descriptionShort", "descriptionLong",
			"editorBlocks", 
			"properties", "data", // {color, size, ...}, {assets, posible upgrades, ...}
			"categories", // list of category slugs of parent categories
			"pages", // list of page slugs of parent pages
			"dates", // dateCreated, dateUpdated, dateSynced
			"note", "activity"
		],

		/** Validator schema for entity */
		entityValidator: {
			externalId: { type: "string", min: 3 },
      variationGroupId: {type: "string", optional: true },
			slug: {type: "string", optional: true },
			publisher: {type: "string", min: 3 },
			authors: { type: "array", optional: true, items:
				{ type: "object", props: {
					name: { type: "string", optional: true },
					email: { type: "string", min: 8 }
				} }
			},
			type: { type: "string", min: 3 },
			subtype: { type: "string", min: 3, optional: true },
			name: { type: "object" },
			descriptionShort: { type: "object", optional: true },
			descriptionLong: { type: "object", optional: true },
			properties: { type: "object", optional: true, props: {
			} },
			data: { type: "object", optional: true, props: {
				blocks: { type: "array", items: "object", optional: true }, // WYSIWYG strings
				tagList: { type: "array", items: "string", optional: true }
			} },
			categories: { type: "array", items: "string", optional: true }, // parent categories paths
			pages: { type: "array", items: "string", optional: true }, // parent pages paths
			dates: { type: "object", optional: true, props: {
				dateCreated: { type: "date", optional: true },
				dateUpdated: { type: "date", optional: true },
				dateSynced: { type: "date", optional: true },
				datePublish: { type: "date", optional: true },
				dateHide: { type: "date", optional: true },
			}},
			note: { type: "string", optional: true },
			activity: { type: "number", optional: true },
		},

		// ------------- PAGES VARIABLES AND SETTINGS -------------
	},


	/**
	 * Actions
	 */
	actions: {
		/**
		 * Add item to user's cart
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity & token
		 */
		pagesList: {
			// auth: "",
			params: {
				category: { type: "string", min: 2 },
				listSubs: { type: "boolean", optional: true },
				filter: { type: "object", optional: true }
			},
			handler(ctx) {
				return ctx.call('categories.detail', { categoryPath: ctx.params.category })
					.then(category => {
						// 1. category exists
						if (category) {
							let categoriesToListPagesIn = [ctx.params.category];
							if (category.subsSlugs && category.subsSlugs.length>0) {
								categoriesToListPagesIn = category.subsSlugs;
                categoriesToListPagesIn.push(ctx.params.category);
							}
              if ( categoriesToListPagesIn.length<1 ) {
                categoriesToListPagesIn = [categoriesToListPagesIn];
              }


              // fix filter if needed
              let filter = { query: {}, limit: 100};
              if (typeof ctx.params.filter !== 'undefined' && ctx.params.filter) {
                filter = ctx.params.filter;
                if (typeof filter.query === 'undefined' || !filter.query) {
                  filter.query = {};
                }
              }
              // set categories if from detail
              filter["query"]["categories"] = {
                "$in": categoriesToListPagesIn
              };
              // set max of results
              if (filter.limit>100) {
                filter.limit = 100;
              }
              if (typeof filter.sort === "undefined" || !filter.sort) {
                filter.sort = "price";
              }

							return ctx.call("pages.find", filter)
								.then(categoryPages => {
									let result = {
										'categoryDetail': category,
										'results': categoryPages
									};

                  // TODO - check if this can be removed, if data not already in category var
									return ctx.call("categories.find", {
										"query": {
											parentPathSlug: category.pathSlug
										}
									})
									.then(categoriesList => {
										result['categories'] = categoriesList;
                    if ( JSON.stringify(filter.query) != '{"categories":{"$in":'+JSON.stringify(categoriesToListPagesIn)+'}}' ) {
                      return ctx.call('pages.count', filter)
      								.then(filteredPagesCount => {
                        result['filteredPagesCount'] = filteredPagesCount;
                        return result;
                      });
                    }
										return result;
									});
								});
						}
					});
			}
		},

		/**
		 * list templates
		 */
		listTemplates: {
			params: {
				page: { type: "string", min: 2 },
				query: { type: "object" },
				group: { type: "string", min: 2, optional: true }
			},
			handler(ctx) {
				// TODO - use group default option;
				let path = "./resources/pages/_default";
				let dirs = readdirSync(path).filter(function (file) {
					return statSync(path+'/'+file).isDirectory();
				});
				console.log('listTemplates 1:', dirs);
				let pageIndex = dirs.indexOf(ctx.params.page);
				if (pageIndex>-1) {
					dirs.splice(pageIndex, 1);
				}
				console.log('listTemplates 2:', dirs);
				console.log('listTemplates 3:', ctx.params.query.slug);
				return dirs.filter(function(dir) {
					return dir.indexOf(ctx.params.query.slug.toLowerCase())>-1;
				});
			}
		},

    /**
		 * Add item to user's cart
		 *
		 * @actions
		 * @param {Object} user - User entity
		 *
		 * @returns {Object} Created entity & token
		 */
		findWithCount: {
			// auth: "",
			params: {
				query: { type: "object", optional: true },
        limit: { type: "number", optional: true },
        offset: { type: "number", optional: true },
        sort: { type: "string", optional: true },
        minimalData: { type: "boolean", optional: true }
			},
			handler(ctx) {
        // fix filter if needed
        let filter = { query: {}, limit: 100};
        if (typeof ctx.params.query !== "undefined" && ctx.params.query) {
          filter.query = ctx.params.query;
        }
        // if categories sent, use them
        let categories = [];
        if (ctx.params.query.categories && typeof ctx.params.query.categories["$in"] !== "undefined") {
          categories = ctx.params.query.categories["$in"];
        }
        // if categories sent, use them
        let pages = [];
        if (ctx.params.query.pages && typeof ctx.params.query.pages["$in"] !== "undefined") {
          pages = ctx.params.query.pages["$in"];
        }
        // set offset
        if (ctx.params.offset && ctx.params.offset>0) {
          filter.offset = ctx.params.offset;
        }
        // set max of results
        if (typeof ctx.params.limit !== "undefined" && ctx.params.limit) {
          filter.limit = ctx.params.limit;
        }
        if (filter.limit>100) {
          filter.limit = 100;
        }
        // sort
        filter.sort = "price";
        if (typeof ctx.params.sort !== "undefined" && ctx.params.sort) {
          filter.sort = ctx.params.sort;
        }

				console.log("pages.filter", filter);
				return ctx.call("pages.find", filter)
				.then(categoryPages => {
					let result = {
						'categories': categories,
						'pages': pages,
						'results': categoryPages
					};

          if (typeof ctx.params.minimalData !== "undefined" && ctx.params.minimalData==true) {
            return result;
          } else {
            // count pages inside this category and its subcategories
            return ctx.call('pages.count', {
              "query": filter.query
            })
            .then(pagesCount => {
              result['filteredPagesCount'] = pagesCount;
              return result;
            });
          }

        });

			}
		},


    /**
     * Mongo specific search with _id included
     *
     * @param {Object} query - original query with _id
     *
     * @returns {Object}
     */
    findWithId: {
      params: {
        query: { type: "object" }
      },
      // cache: {
      // 	keys: ["#cartID"]
      // },
      handler(ctx) {
        let queryObject = ctx.params.query;
        let self = this;
        Object.keys(queryObject).forEach(function(key,index) {
          if (key==='_id' && typeof queryObject[key] === "string") {
            queryObject[key] = self.fixStringToId(queryObject[key]);
          }
        });
        return this.adapter.find({
          "query": queryObject
        });
      }
    },


		/**
		 * Get detail of page.
		 *
		 * @actions
		 *
		 * @returns {Object} Page entity
		 */
		detail: {
			// auth: "",
			params: {
				page: { type: "string", min: 2 }, 
				category: { type: "string", optional: true }, 
				lang: { type: "string", min: 2, optional: true } 
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				let self = this;
				let lang = "en";
				if ( ctx.params.lang && ctx.params.lang.trim()!="" ) {
					lang = ctx.params.lang;
				}

				let pageSlugArray = ctx.params.page.split("---");
				let pageName = pageSlugArray[0];
				let templateName = "_default";
				if ( pageSlugArray.length>1 ) {
					templateName = pageSlugArray[1];
				}
				let filepath = "./resources/pages/"+templateName+"/"+pageName+"/"+pageName+"-"+lang+".html";
				filepath = pathResolve(filepath);
				console.log("page.detail filepath:", filepath);
				
				return self.getCorrectFile(filepath)
				.then( (result) => {
					let staticData = null;
					console.log("page file read result:", result);
					let regex = /<\!-- {{editor_WYSIWYG}} \/\/-->/gmi, regExResult, occurences = [];
					while ( (regExResult = regex.exec(result)) ) {
						occurences.push(regExResult.index);
					}
					if ( occurences.length>0 ) {
						return self.adapter.find({
							"query": {
								"slug": ctx.params.page
							}
						})
						.then(page => {
							if ( page && page.length>0 && typeof page[0] !== "undefined" ) {
								page = page[0];
							}
							if (page && page.data && page.data.blocks && page.data.blocks.length>0) {
								result = result.replace(
									"<!-- {{editor_WYSIWYG}} //-->",
									'<div data-editable data-name="content">'+page.data.blocks[0][ctx.params.lang]+'</div>'
								);
							}
							return { body: result, data: page };
						})
						.then( result => {
							if (ctx.params.category && result.data.categories.length>0) {
								return ctx.call("categories.detail", {
									categoryPath: result.data.categories[0],
									type: "pages"
								})
								.then(parentCategoryDetail => {
									result.data["parentCategoryDetail"] = parentCategoryDetail;
									return result;
								});
							} else {
								result.data["parentCategoryDetail"] = null;
								return result;
							}
						});
					}
	
					return { body: result, data: null };
				})
				.catch( error => {
					console.log("error:", error);
				});
			}
		},




		/**
		 * Get list of available tags
		 *
		 * @returns {Object} Tag list
		 */
		tags: {
			cache: {
				keys: []
			},
			handler(ctx) {
				return this.Promise.resolve()
					.then(() => this.adapter.find({ fields: ["tagList"], sort: ["dates.dateCreated"] }))
					.then(list => {
						return _.uniq(_.compact(_.flattenDeep(list.map(o => o.tagList))));
					})
					.then(tags => ({ tags }));
			}
		},



		/**
		 * Import page data:
		 *  - pages - with categories
		 *
		 * @actions
		 *
		 * @returns {Object} Page entity
		 */
		import: {
			auth: "required",
			params: {
				pages: { type: "array", items: "object", optional: true },
			},
      cache: false,
			handler(ctx) {
				console.log('--- import pages ---');
				let pages = ctx.params.pages;
				let promises = [];
				let mythis = this;

        if (ctx.meta.user.type=='admin') {
  				if ( pages && pages.length>0 ) {
  					// loop pages to import
  					pages.forEach(function(entity) {
  						promises.push(
  							// add page results into result variable
  							mythis.adapter.findById(entity.id)
  								.then(found => {
  									if (found) { // page found, update it
											console.log("\n\n page entity found:", entity);

											if ( entity && entity.dates ) {
												Object.keys(entity.dates).forEach(function(key) {
													let date = entity.dates[key];
													if ( date && date!=null && date.trim()!="" ) {
														entity.dates[key] = new Date(entity.dates[key]);
													}
												});
											}

  										return mythis.validateEntity(entity)
  											.then(() => {
  												if (!entity.dates) {
  													entity.dates = {};
  												}
  												entity.dates.dateUpdated = new Date();
  												entity.dates.dateSynced = new Date();
                          let entityId = entity.id;
                          delete entity.id;
          								const update = {
          									"$set": entity
          								};
  												return mythis.adapter.updateById(entityId, update);
  											});
  									} else { // no page found, create one
  										return mythis.validateEntity(entity)
  										.then(() => {
  											// set generic variables
  											if ( !entity.slug || entity.slug.trim() == "") {
                          let lang = ctx.meta.localsDefault.lang;
                          if ( ctx.meta.localsDefault.lang.code ) {
                            lang = ctx.meta.localsDefault.lang.code;
                          }
  												entity.slug = slug(entity.name[lang], { lower: true });
                          // + "-" + (Math.random() * Math.pow(36, 6) | 0).toString(36);
  											}
  											return ctx.call("pages.find", {
          								"query": {
                            slug: entity.slug
                          }
                        })
  											.then(slugFound => {
  												if (slugFound && slugFound.constructor !== Array) {
  													return { 'error' : "Slug "+entity.slug+" already used." };
  												}

  												// TODO - check if slug paths don't already exist
  												if (ctx.meta.user && ctx.meta.user.email) {
  													entity.publisher = ctx.meta.user.email.toString();
  												}
  												if (!entity.dates) {
  													entity.dates = {};
  												}
  												entity.dates.dateCreated = new Date();
  												entity.dates.dateUpdated = new Date();
  												entity.dates.dateSynced = new Date();

  												return mythis.adapter.insert(entity)
  													.then(doc => mythis.transformDocuments(ctx, {}, doc))
  													.then(json => mythis.entityChanged("created", json, ctx).then(() => json));
  											});
  										});
  									}
  								})); // push with find end
  					});
  				}

  				// return multiple promises results
  				return Promise.all(promises).then(prom => {
  			    return prom;
  				});
        } else { // not admin user
          return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
        }
			} // handler end
		},


		/**
		 * Delete page data by id
		 *
		 * @actions
		 *
		 * @returns {Object} Page entity
		 */
		delete: {
			auth: "required",
			params: {
				pages: { type: "array", items: "object", optional: true },
			},
			// cache: {
			// 	keys: ["#cartID"]
			// },
			handler(ctx) {
				console.log('--- delete pages ---');
				let pages = ctx.params.pages;
				let promises = [];
				let mythis = this;

        if (ctx.meta.user.type=='admin') {
  				if ( pages && pages.length>0 ) {
  					// loop pages to import
  					pages.forEach(function(entity) {
  						promises.push(
  							// add page results into result variable
  							mythis.adapter.findById(entity.id)
  								.then(found => {
  									if (found) { // page found, delete it
                      console.log("DELETING page "+found._id);
  										return ctx.call("pages.remove", {id: found._id} )
                      .then((deletedCount) => {
                        console.log("deleted page Count: ",deletedCount);
                        return deletedCount;
                      }); // returns number of removed items
  									} else {
                      console.log(entity.id+" not found");
                    }
  								})); // push with find end
  					});
  				}

  				// return multiple promises results
  				return Promise.all(promises).then(() => {
  				    return promises;
  				});
        } else { // not admin user
          return Promise.reject(new MoleculerClientError("Permission denied", 403, "", []));
        }
			} // handler end
		},


    updatePageImage: {
			auth: "required",
			params: {
				data: { type: "object" },
				params: { type: "object" }
			},
			handler(ctx) {
        let self = this;
        console.log("updatePageImage ctx.params:", ctx.params);
        if (ctx.params.params && ctx.params.params.slug) {
					console.log("page.updatePageImage");
          return;
        }
        return;
      }
    },
		

    // check page authorship
    checkAuthor: {
      auth: "required",
      params: {
        data: { type: "object" }
      },
      handler(ctx) {
        if (ctx.params.data && ctx.params.data.slug && ctx.params.data.publisher) {
          return this.adapter.find({
            "query": {
              "slug": ctx.params.data.slug,
              "publisher": ctx.params.data.publisher
            }
          })
          .then(pages => {
            // console.log("product.checkAuthor", products);
            if (pages && pages.length>0 && pages[0].slug==ctx.params.data.slug) {
              return true;
            }
          })
          .catch(err => {
            console.log("\n PAGE checkAuthor ERROR: ", err);
            return false;
          });
        }
        return false;
      }
    },


	}, // *** actions end

	/**
	 * Methods
	 */
	methods: {

	},

	events: {
		// "cache.clean.cart"() {
		// 	if (this.broker.cacher)
		// 		this.broker.cacher.clean(`${this.name}.*`);
		// }
	}
};
