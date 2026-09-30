"use strict";

const crypto = require("crypto");
const { MoleculerClientError } = require("moleculer").Errors;
const { isNonProductionEnv } = require("../../../mixins/env.helpers");

const MFA_CODE_TTL_MS = 10 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;
const MFA_RESEND_COOLDOWN_MS = 60 * 1000;
const MFA_MAX_SENDS = 5;

function hashMfaCode(secret, challengeId, code) {
	return crypto.createHmac("sha256", String(secret)).update(`${challengeId}:${code}`).digest("hex");
}

function userLanguage(user, ctx) {
	let lang = user?.settings?.language || ctx?.meta?.localsDefault?.lang || "en";
	if (lang && typeof lang === "object") {
		lang = lang.code || "en";
	}
	if (!lang || lang === "null") {
		return "en";
	}
	return String(lang);
}

function invalidMfaError() {
	return new MoleculerClientError(
		"Invalid or expired code",
		422,
		"",
		[{ field: "code", message: "invalid or expired" }]
	);
}

function mfaSendFailedError() {
	return new MoleculerClientError(
		"Could not send sign-in code",
		422,
		"",
		[{ field: "email", message: "mfa send failed" }]
	);
}

function mfaResendCooldownError() {
	return new MoleculerClientError(
		"Please wait before requesting another code",
		422,
		"",
		[{ field: "code", message: "resend cooldown" }]
	);
}

module.exports = {
	methods: {
		/**
		 * @param {boolean} remember
		 * @returns {{ code: string, mfa: object }}
		 */
		createMfaChallenge(remember) {
			const challengeId = crypto.randomBytes(32).toString("hex");
			const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
			const now = new Date();
			const mfa = {
				challengeId,
				codeHash: hashMfaCode(this.settings.JWT_SECRET, challengeId, code),
				expiresAt: new Date(now.getTime() + MFA_CODE_TTL_MS),
				attempts: 0,
				sends: 1,
				remember: remember === true,
				sentAt: now,
			};
			return { code, mfa };
		},

		/**
		 * New code on an existing challenge. Keeps challengeId, expiry, and remember.
		 * @param {object} mfa
		 * @returns {{ code: string, mfa: object }}
		 */
		rotateMfaCode(mfa) {
			const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
			const next = {
				...mfa,
				codeHash: hashMfaCode(this.settings.JWT_SECRET, mfa.challengeId, code),
				attempts: 0,
				sends: (mfa.sends || 1) + 1,
				sentAt: new Date(),
			};
			return { code, mfa: next };
		},

		mfaCodeMatches(mfa, code) {
			if (!mfa?.codeHash || !mfa?.challengeId || code == null) {
				return false;
			}
			const actual = hashMfaCode(this.settings.JWT_SECRET, mfa.challengeId, String(code).trim());
			const expected = String(mfa.codeHash);
			if (actual.length !== expected.length) {
				return false;
			}
			return crypto.timingSafeEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
		},

		isMfaExpired(mfa) {
			if (!mfa?.expiresAt) {
				return true;
			}
			return new Date(mfa.expiresAt).getTime() <= Date.now();
		},

		mfaAttemptsExhausted(mfa) {
			return (mfa?.attempts || 0) >= MFA_MAX_ATTEMPTS;
		},

		mfaShouldLockAfterFailure(mfa) {
			return (mfa?.attempts || 0) >= MFA_MAX_ATTEMPTS - 1;
		},

		mfaSendsExhausted(mfa) {
			return (mfa?.sends || 1) >= MFA_MAX_SENDS;
		},

		mfaResendCoolingDown(mfa) {
			if (!mfa?.sentAt) {
				return false;
			}
			return Date.now() - new Date(mfa.sentAt).getTime() < MFA_RESEND_COOLDOWN_MS;
		},

		/**
		 * Plaintext code in the response only for local/CI when explicitly enabled.
		 * @param {string} code
		 * @returns {string|undefined}
		 */
		peekMfaDebugCode(code) {
			if (isNonProductionEnv() && process.env.MFA_DEBUG_RETURN_CODE === "1") {
				return code;
			}
			return undefined;
		},

		mfaChallengeResponse(challengeId, code) {
			const body = { mfaRequired: true, challengeId };
			const debugCode = this.peekMfaDebugCode(code);
			if (debugCode) {
				body.debugCode = debugCode;
			}
			return body;
		},

		invalidMfaError,
		mfaSendFailedError,
		mfaResendCooldownError,

		sendMfaCodeEmail(user, code, ctx) {
			const emailSetup = {
				settings: {
					to: user.email,
					subject: (process.env.SITE_NAME || "StretchShop") + " - Sign-in code",
				},
				functionSettings: {
					language: userLanguage(user, ctx),
				},
				template: "auth/mfacode",
				data: {
					username: user.username,
					email: user.email,
					code,
					minutes: 10,
				},
			};
			return ctx.call("users.sendEmail", emailSetup);
		},

		/**
		 * Tell both the previous and the new address that an admin sign-in email changed.
		 * Failures are logged and do not reject the profile update.
		 */
		sendAdminEmailChanged(oldEmail, newEmail, user, ctx) {
			const subject = (process.env.SITE_NAME || "StretchShop") + " - Sign-in email changed";
			const langCode = userLanguage(user, ctx);
			const recipients = [...new Set([oldEmail, newEmail].filter((address) => address && String(address).trim()))];
			return Promise.all(recipients.map((to) => {
				return ctx.call("users.sendEmail", {
					settings: { to, subject },
					functionSettings: { language: langCode },
					template: "auth/emailchanged",
					data: {
						username: user.username,
						old_email: oldEmail,
						new_email: newEmail,
					},
				}).catch((err) => {
					this.logger.error("users.sendAdminEmailChanged failed", err?.message || err);
					return false;
				});
			}));
		},

		/**
		 * Persist last-login metadata and drop any pending email challenge.
		 * @param {object} user
		 * @param {object} ctx
		 */
		recordSuccessfulLogin(user, ctx) {
			if (!user.dates) {
				user.dates = {};
			}
			user.dates.dateLastLogin = new Date();
			if (!user.ip) {
				user.ip = {
					ipRegistration: null,
					ipLastLogin: null,
				};
			}
			user.ip.ipLastLogin = (ctx.meta.remoteAddress || "") + ":" + (ctx.meta.remotePort || "");
			if (user.security?.mfa) {
				delete user.security.mfa;
			}
			return this.adapter.updateById(user._id, this.prepareForUpdate(user));
		},

		/**
		 * Reset the password-attempt bucket, bind the cart, and issue the session cookie.
		 * @param {object} doc
		 * @param {object} ctx
		 * @param {{ keyExtra?: string }} [loginRate]
		 */
		issueLoginSession(doc, ctx, loginRate) {
			const reset = loginRate
				? this.resetRateLimit(ctx, "login", loginRate)
				: Promise.resolve();
			return reset
				.then(() => this.transformDocuments(ctx, {}, doc))
				.then((user) => {
					if (ctx.meta.cart) {
						ctx.meta.cart.user = user._id;
					}
					user = this.removePrivateData(user);
					return this.transformEntity(user, true, ctx);
				});
		},
	},
	MFA_CODE_TTL_MS,
	MFA_MAX_ATTEMPTS,
	MFA_RESEND_COOLDOWN_MS,
	MFA_MAX_SENDS,
};
