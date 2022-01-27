"use strict";

const fs = require("fs-extra");
// const sppf = require("../../../mixins/subproject.helper");
// let resourcesDirectory = process.env.PATH_RESOURCES || sppf.subprojectPathFix(__dirname, "/../../../resources");
// const businessSettings = require( resourcesDirectory+"/settings/business");


module.exports = {
	methods: {

		parseCookies(cookiesString) {
			let list = {};

			cookiesString && cookiesString.split(";").forEach(function( cookie ) {
				let parts = cookie.split("=");
				list[parts.shift().trim()] = decodeURI(parts.join("="));
			});

			return list;
		},




		/**
		 * set of commands for move & copy of file actions, with copy callback for move action
		 * original patch from https://stackoverflow.com/questions/8579055/how-do-i-move-files-in-node-js/29105404#29105404
		 */
		renameFile(path, newPath) {
			return new Promise((res, rej) => {
				fs.rename(path, newPath, (err, data) =>
					err
						? rej(err)
						: res(data));
			});
		},
		// --
		copyFile(path, newPath, flags) {
			return new Promise((res, rej) => {
				const readStream = fs.createReadStream(path),
					writeStream = fs.createWriteStream(newPath, {flags});

				readStream.on("error", rej);
				writeStream.on("error", rej);
				writeStream.on("finish", res);
				readStream.pipe(writeStream);
			});
		},
		// --
		unlinkFile(path) {
			return new Promise((res, rej) => {
				fs.unlink(path, (err, data) =>
					err
						? rej(err)
						: res(data));
			});
		},
		// -- the main function to call
		moveFile(path, newPath, flags) {
			return this.renameFile(path, newPath)
				.catch(e => {
					if (e.code !== "EXDEV") {
						this.logger.error("api.moveFile() error: ", e);
						throw new e;
					} else {
						return this.copyFile(path, newPath, flags)
							.then(() => {
								return this.unlinkFile(path);
							});
					}
				});
		},



		getProductFileNameByType(params) {
			if ( params.type && params.type=="gallery" ) {
				return ["p:number"];
			} else {
				return [":orderCode", "default"];
			}
		},



		getActiveUploadPath(req) {
			let paths = [
				{
					url: "/user/image",
					destination: "users/profile",
					fileName: ["profile"],
					validUserTypes: ["user", "admin"],
					stringToChunk: (req.$ctx.meta.user && req.$ctx.meta.user._id) ? req.$ctx.meta.user._id.toString() : "",
					chunkSize: 6,
					postAction: "users.updateMyProfileImage"
				},
				{
					url: "/products/upload/:orderCode/:type",
					destination: "products",
					fileName: this.getProductFileNameByType(req.$params),
					validUserTypes: ["author", "admin"],
					checkAuthorAction: "products.checkAuthor",
					checkAuthorActionParams: {
						"orderCode": req.$params.orderCode,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.orderCode ? req.$params.orderCode : "",
					chunkSize: 3,
					postAction: "products.updateProductImage",
				},
				{
					url: "/pages/upload/:slug",
					destination: "pages/editor",
					fileName: ["----ORIGINAL----"], // keep original name - only for WYSIWYG editor
					validUserTypes: ["author", "admin"],
					checkAuthorAction: "pages.checkAuthor",
					checkAuthorActionParams: {
						"slug": req.$params.slug,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.slug ? req.$params.slug : "",
					chunkSize: 0, // do not chunk, use the whole string
					postAction: "pages.updatePageImage",
				},
				{
					url: "/pages/upload/:slug/:type",
					destination: "pages/cover",
					fileName: ["cover"],
					validUserTypes: ["author", "admin"],
					checkAuthorAction: "pages.checkAuthor",
					checkAuthorActionParams: {
						"slug": req.$params.slug,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.slug ? req.$params.slug : "",
					chunkSize: 0,
					postAction: "pages.updatePageImage",
				},
				{
					url: "/categories/upload/:slug",
					destination: "categories",
					fileName: [":slug"],
					validUserTypes: ["user","admin"],
					checkAuthorAction: "categories.checkAuthor",
					checkAuthorActionParams: {
						"slug": req.$params.slug,
						"publisher": req.$ctx.meta.user.email
					},
					stringToChunk: req.$params.slug ? req.$params.slug : "",
					chunkSize: 0,
					postAction: "categories.updateCategoryImage",
				}
			];

			for ( let i=0; i<paths.length; i++ ) {
				let requestPathPattern = "/"+req.$alias.path;
				if ( paths[i].url == requestPathPattern ) {
					return paths[i];
				}
			}

			return null;
		},



		/**
		 * Prepare paths and filenames required for upload
		 * @param {*} req 
		 * @param {*} activePath 
		 * @param {*} fields 
		 * @param {*} files 
		 * @param {*} property 
		 * @returns Object
		 */
		prepareFilePathNameData(req, activePath, fields, files, property) {
			this.logger.info("api.parseUploadedFile() files-"+property+": ", files[property]);
			let fileFrom = files[property].path;
			let copyBaseDir = req.$ctx.service.settings.assets.folder+"/"+process.env.ASSETS_PATH + this.stringReplaceParams(activePath.destination, req.$params);
			let urlBaseDir = process.env.ASSETS_PATH + this.stringReplaceParams(activePath.destination, req.$params);
			let targetDir = activePath.stringToChunk;
			if (activePath.chunkSize>0) {
				targetDir = this.stringChunk(activePath.stringToChunk, activePath.chunkSize);
			}
			// set new filename
			let re = /(?:\.([^.]+))?$/;
			let fileExt = re.exec(files[property].name);
			let fileNameReplaced = this.arrayReplaceParams( activePath.fileName, req.$params );
			fileNameReplaced = this.arrayReplaceParams( fileNameReplaced, fields );
			let resultFileName = files[property].name;
			if ( fileNameReplaced.join("-") !== "----ORIGINAL----" ) { // if not set to keep original name - only for WYSIWYG editor
				resultFileName = fileNameReplaced.join("-")+"."+fileExt[1];
			}
			let resultFullPath = targetDir+"/"+resultFileName;
			// set result paths
			let fileToSave = copyBaseDir+"/"+resultFullPath;
			let fileToUrl = urlBaseDir+"/"+resultFullPath;
			this.logger.info("api.parseuploadeFile() files-vars: ", fileFrom, fileToSave, fileToUrl, targetDir);

			return {
				copyBaseDir, 
				targetDir,
				fileFrom,
				fileToSave,
				fileToUrl,
				resultFullPath,
				resultFileName
			};
		},



		buildGlobalSearchQuery(query, langs) {
			let fields = [ "name", "descriptionShort", "descriptionLong" ];
			let orArray = [];

			if ( langs && langs.length > 0 ) {
				fields.forEach(f => {
					langs.forEach(l => {
						let line = {};
						line[f+"."+l] = { "$regex": query, "$options": "i"  };
						orArray.push(line);
					});
				});
			}

			return {
				query: { "$or": orArray },
				limit: 10
			};
		}



	}
};
