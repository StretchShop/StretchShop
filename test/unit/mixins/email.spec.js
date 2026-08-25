"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const emailTemplate = require("../../../mixins/email.mixin");

describe("email.mixin layout wrapping", () => {
	let tmp;
	let originalPathResources;

	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-emails-"));
		originalPathResources = process.env.PATH_RESOURCES;
		process.env.PATH_RESOURCES = tmp;
	});

	afterEach(() => {
		if (originalPathResources === undefined) {
			delete process.env.PATH_RESOURCES;
		} else {
			process.env.PATH_RESOURCES = originalPathResources;
		}
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	function write(rel, content) {
		const full = path.join(tmp, "emails", "user", rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content);
	}

	it("wraps compiled body in main-{lang} layout", async () => {
		write("auth/hello-en.html", "<p>Hello {{username}}</p>");
		write("auth/hello-en.txt", "Hello {{username}}");
		write("main-en.html", "<html>LOGO {{{body}}} FOOTER {{layout.webname}}</html>");
		write("main-en.txt", "LOGO\n{{{body}}}\nFOOTER {{layout.webname}}");

		const result = await emailTemplate("auth/hello-en", {
			username: "Ada",
			layout: { webname: "Shop" }
		}, ["html", "txt"], { layout: "main-en" });

		expect(result.html).toContain("Hello Ada");
		expect(result.html).toContain("LOGO");
		expect(result.html).toContain("FOOTER Shop");
		expect(result.txt).toContain("Hello Ada");
		expect(result.txt).toContain("FOOTER Shop");
	});

	it("falls back to main-en when language layout is missing", async () => {
		write("auth/hello-sk.html", "<p>Ahoj</p>");
		write("auth/hello-sk.txt", "Ahoj");
		write("main-en.html", "<wrap>{{{body}}}</wrap>");
		write("main-en.txt", "WRAP {{{body}}}");

		const result = await emailTemplate("auth/hello-sk", {}, ["html", "txt"], { layout: "main-sk" });
		expect(result.html).toBe("<wrap><p>Ahoj</p></wrap>");
		expect(result.txt).toBe("WRAP Ahoj");
	});

	it("returns unwrapped body when no layout files exist", async () => {
		write("auth/hello-en.html", "<p>Hi</p>");
		write("auth/hello-en.txt", "Hi");

		const result = await emailTemplate("auth/hello-en", {}, ["html", "txt"], { layout: "main-en" });
		expect(result.html).toBe("<p>Hi</p>");
		expect(result.txt).toBe("Hi");
	});

	it("does not wrap when layout option is omitted", async () => {
		write("auth/hello-en.html", "<p>Hi</p>");
		write("auth/hello-en.txt", "Hi");
		write("main-en.html", "<wrap>{{{body}}}</wrap>");
		write("main-en.txt", "WRAP {{{body}}}");

		const result = await emailTemplate("auth/hello-en", {}, ["html", "txt"]);
		expect(result.html).toBe("<p>Hi</p>");
		expect(result.txt).toBe("Hi");
	});
});
