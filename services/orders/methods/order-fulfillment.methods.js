"use strict";

require("dotenv").config();
const passGenerator = require("generate-password");
const fetch = require("cross-fetch");
const jwt = require("jsonwebtoken");
const handlebars = require("handlebars");
const { ensureDir, pathExists } = require("fs-extra");
const pathResolve = require("path").resolve;
const SettingsMixin = require("../../../mixins/settings.mixin");
const PdfPrintMixin = require("../../../mixins/pdfprint.mixin");
const { subscriptionPaymentStatuses } = require("../constants/subscription.constants");
const { productStatuses } = require("../constants/product.constants");
const { orderStatuses } = require("../constants/order.constants");
const { update } = require("lodash");

const calcExcludedTypes = ["subscription"];

module.exports = {
	methods: {
		sendOrderedEmail(ctx, order) {
			// 3. send email about order
			let user = ctx.meta.user || ""; // ctx is default user data source
			let userEmail = user.email || "";
			let invoiceAddress = "";
			// if available, define invoiceAddress from order
			if (order.invoiceAddress) {
				invoiceAddress = order.invoiceAddress;
			}
			// if avaiblable, define email from invoiceAddress.email
			if (invoiceAddress && invoiceAddress != null && invoiceAddress.email) {
				userEmail = invoiceAddress.email;
			}
			// if order.user defined, use it
			if (order.user) {
				user = order.user;
				if (order.user.email) {
					userEmail = order.user.email;
				}
			}
			ctx.call("users.sendEmail", {
				template: "order/ordered",
				data: {
					order,
				},
				settings: {
					subject: process.env.SITE_NAME + " - Your Order #" + order._id,
					to: userEmail
				}
			})
				.then(booleanResult => {
					this.logger.info("orders.orderAfterAcceptedActions() - Email order SENT:", booleanResult);
				})
				.catch(error => {
					this.logger.error("orders.sendOrderedEmail() - email failed:", error);
				});
			return true;
		},


		getInvoiceFilePaths(order) {
			const publicDir = process.env.PATH_PUBLIC || "./public";
			const assetsPath = process.env.ASSETS_PATH || "";
			const userId = String(order?.user?.id || "");
			const invoiceId = String(order?.invoice?.id || "");
			const dir = pathResolve(publicDir, assetsPath, "invoices", userId);
			const pdfPath = pathResolve(dir, invoiceId + ".pdf");
			const sendPath = "invoices/" + userId + "/" + invoiceId + ".pdf";
			return { dir, pdfPath, sendPath };
		},


		sendOrderPaidEmail(ctx, order, html, pdfPath) {
			if (order?.dates?.emailPaidSent) {
				this.logger.info("orders.sendOrderPaidEmail() - skip duplicate paid email", {
					orderId: order._id
				});
				return Promise.resolve(true);
			}
			const settings = {
				subject: process.env.SITE_NAME + " - We received Payment for Your Order #" + order._id,
				to: order.user.email
			};
			if (pdfPath) {
				settings.attachments = [{ path: pdfPath }];
			} else {
				this.logger.warn("orders.sendOrderPaidEmail() - sending without invoice attachment", {
					orderId: order._id,
					userId: order?.user?.id
				});
			}
			return ctx.call("users.sendEmail", {
				template: "order/orderpaid",
				data: {
					order: order,
					html: html
				},
				settings
			})
				.then(booleanResult => {
					this.logger.info("orders.generateInvoice() - Email order PAID SENT:", booleanResult, {
						attachedInvoice: Boolean(pdfPath)
					});
					if (!booleanResult) {
						return booleanResult;
					}
					order.dates = order.dates || {};
					order.dates.emailPaidSent = new Date();
					if (typeof this.adapter?.updateById !== "function") {
						return booleanResult;
					}
					return this.adapter.updateById(order._id, {
						$set: { "dates.emailPaidSent": order.dates.emailPaidSent }
					})
						.catch(err => {
							this.logger.error("orders.sendOrderPaidEmail() - persist emailPaidSent failed:", err);
						})
						.then(() => booleanResult);
				})
				.catch(error => {
					this.logger.error("orders.generateInvoice() - email failed:", error);
					return false;
				});
		},


		/**
		 * Generate invoice PDF from order
		 * 
		 * @param {*} order 
		 * @param {*} ctx 
		 */
		generateInvoice(order, ctx) {
			let self = this;

			if (order) {
				let parentDir = this.settings.paths.resources + "/pdftemplates/";
				parentDir = this.removeParentTraversing(parentDir);
				let filepath = parentDir + "invoice-" + order.lang.code + ".html";
				filepath = pathResolve(filepath);

				return this.getCorrectFile(filepath)
					.then((template) => {
						let lastInvoiceNumber = 0;
						return this.adapter.find({
							sort: "-invoice.num",
							limit: 1
						})
							.then(lastDbInvoiceNum => {
								if (lastDbInvoiceNum && lastDbInvoiceNum.length > 0 &&
									lastDbInvoiceNum[0].invoice?.id) {
									lastInvoiceNumber = lastDbInvoiceNum[0].invoice.num;
								}
								return lastInvoiceNumber + 1;
							})
							.then(newInvoiceNum => {
								// get invoice number
								let needToUpdate = true;
								if (order.invoice?.num && order.invoice.num > 0) {
									newInvoiceNum = order.invoice.num;
									needToUpdate = false;
								}
								let newInvoiceIdCode = this.generateInvoiceNumber(newInvoiceNum, new Date());
								// set invoice data to order to update
								order["invoice"] = {
									num: newInvoiceNum,
									id: newInvoiceIdCode
								};
								order.dates["dateInvoiceIssued"] = new Date();
								if (!needToUpdate) {
									// update order
									return this.adapter.updateById(order._id, this.prepareForUpdate(order))
										.then(orderUpdated => {
											this.entityChanged("updated", orderUpdated, ctx);
											return template;
										});
								}
								// no need to update
								return template;
							});
					})
					.then((html) => {
						// compile html from template and data
						const template = handlebars.compile(html);
						try {
							template();
						} catch (error) {
							self.logger.error("orders.generateInvoice() - handlebars ERROR:", error);
						}
						const orderFixed = { ...order };
						orderFixed.items = orderFixed.items.filter(item => item.type !== "subscription");
						orderFixed.prices.priceTotalToPay = orderFixed.prices.priceTotal - (orderFixed.data.paymentData.paidAmountTotal ?? 0);
						let data = {
							order: orderFixed,
							business: SettingsMixin.getSiteSettings('business')
						};
						data = this.prepareDataForTemplate(data);
						html = template(data);
						return html;
					})
					.then((html) => {
						let logo1 = "./public/assets/_site/logo-words-horizontal.svg";
						return this.readFile(logo1)
							.then((logoCode) => {
								logoCode = logoCode.replace(/(width\s*=\s*["'](.*?)["'])/, 'width="240"').replace(/(height\s*=\s*["'](.*?)["'])/, 'height="53"');
								return html.toString().replace("<!-- company_logo //-->", logoCode);
							})
							.catch(logoCodeErr => {
								self.logger.error("orders.generateInvoice() - logo error:", logoCodeErr);
								return html;
							});
					})
					.then((html) => {
						// generate pdf, then send paid email (attachment only if the file exists)
						const { dir, pdfPath, sendPath } = this.getInvoiceFilePaths(order);
						self.logger.info("orders.generateInvoice() PDF - dir & sendPath:", dir, sendPath);

						return ensureDir(dir, 0o2775)
							.then(() => {
								const pdfDoc = PdfPrintMixin.generatePdfFromHtml(html);
								return Promise.resolve(pdfDoc.write(pdfPath));
							})
							.then(() => pathExists(pdfPath))
							.then((exists) => {
								if (!exists) {
									self.logger.error("orders.generateInvoice() - PDF was not written:", pdfPath);
								} else {
									self.logger.info("orders.generateInvoice() - path:", pdfPath);
								}
								return self.sendOrderPaidEmail(ctx, order, html, exists ? pdfPath : null)
									.then(() => ({ html, path: exists ? sendPath : null }));
							})
							.catch(pdfErr => {
								self.logger.error("orders.generateInvoice() - PDF generate error:", pdfErr);
								return self.sendOrderPaidEmail(ctx, order, html, null)
									.then(() => ({ html, path: null }));
							});
					});
			}
		},


		/**
		 * Generate invoice number = max 10x numeral characters
		 * 1. number (1x) - eshop code (eg. "5")
		 * 2.-7. number (6x) - date with year and month
		 * 8.-10. number (3x) - number increasing +1
		 * Date and increasing number summed into base of invoice number, 
		 * prefixed with eshop code.
		 * 
		 * @param {*} newInvoiceNum 
		 * @param {*} date 
		 */
		generateInvoiceNumber(newInvoiceNum, date) {
			let eshopNumberCode = SettingsMixin.getSiteSettings('business')?.invoiceData?.eshop?.numberCodePrefix;
			let newInvoiceNumBase = date.getFullYear() * 100 + (date.getMonth() + 1); // 4 + 2 chars
			let zerosAppend = 9 - newInvoiceNumBase.toString().length;
			let zeros = "";
			for (let i = 0; i < zerosAppend; i++) {
				zeros += "0";
			}
			newInvoiceNumBase = newInvoiceNumBase + zeros;
			let newInvoiceId = parseInt(newInvoiceNumBase) + newInvoiceNum;
			return eshopNumberCode + newInvoiceId.toString();
		},




		/**
		 * Collecting data for creating user on order of unregistered user
		 * 
		 * @param {*} ctx 
		 */
		getDataToCreateUser(ctx) {
			this.logger.info("orders.getDataToCreateUser() - ctx.params.orderParams: ", ctx.params.orderParams);
			let userName = ctx.params.orderParams.addresses.invoiceAddress.email;// +""+ ctx.params.orderParams.addresses.invoiceAddress.nameFirst;
			if (!ctx.params.orderParams.user.password) {
				userPassword = passGenerator.generate({
					length: 10,
					numbers: true
				});
			}
			let userPassword = ctx.params.orderParams.user.password;
			let userData = {
				user: {
					username: userName,
					email: ctx.params.orderParams.addresses.invoiceAddress.email,
					password: userPassword,
					type: "user",
					addresses: [ctx.params.orderParams.addresses.invoiceAddress],
					dates: {
						dateCreated: new Date()
					},
					settings: {
						language: ctx.params.orderParams.lang.code,
						currency: ctx.params.orderParams.country.code
					}
				}
			};
			return userData;
		},



		/**
		 * 
		 * @param {*} order 
		 * @param {*} includingProcessed
		 */
		countOrderItemTypes(order, includingProcessed) {
			includingProcessed = (typeof includingProcessed !== "undefined") ? includingProcessed : false;
			let result = {};
			let typesToCheck = ["subscription"]; // item types to check individualy

			// 1. get all item types
			if (order && order.items && order.items.length > 0) {
				order.items.forEach(item => {
					if (item && item.type && item.type.toString().trim() != "") {
						if (typeof result[item.type] == "undefined") {
							result[item.type] = 1;
						} else {
							result[item.type]++;
						}
					}
				});
			}

			// 2. if includingProcessed==false, use 
			// 2.1 order.data.subscription.ids[x].processed to count items
			// 2.2 and order.status to determine the rest
			if (order && !includingProcessed) {
				// 2.1 fix numbers of items that should be check individually
				typesToCheck.forEach(t => { // loop typesToCheck
					let processedToRemove = 0;
					if (result[t] && result[t] > 0) {
						if (order && order.data && order.data[t] &&
							order.data[t].ids && order.data[t].ids.length > 0) {
							order.data[t].ids.forEach(s => { // loop all items
								if (s && s.processed && s.processed.trim() !== "") {
									processedToRemove++;
								}
							});
						}
					}
					if (result && result[t]) { // subtract processed from result
						result[t] = result[t] - processedToRemove;
					}
				});

				// 2.2 fix numbers of remaining items if status is paid
				if (order.status && order.status == "paid") { // order has been paid
					Object.keys(result).forEach(function (key) {
						if (typesToCheck.indexOf(key) < 0) { // not item to check individualy
							result[key] = 0;
						}
					});
				}
			}

			return result;
		},


	}
};
