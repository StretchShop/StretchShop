"use strict";

/**
 * Export live OpenAPI schema by starting the broker briefly, or call exportDocs if server is running.
 * Writes docs/openapi/generated.json for drift comparison with SwaggerHub.
 *
 * Usage: npm run openapi:export
 */

require("dotenv").config();
process.env.OPENAPI_ENABLED = "true";
process.env.NODE_ENV = process.env.NODE_ENV || "development";

const fs = require("fs");
const path = require("path");
const { ServiceBroker } = require("moleculer");

const OUT_PATH = path.resolve(__dirname, "../docs/openapi/generated.json");
const SWAGGERHUB_PATH = path.resolve(__dirname, "../docs/openapi/swaggerhub-export.json");

async function main() {
	const savedMongoUri = process.env.MONGO_URI;
	delete process.env.MONGO_URI;

	const broker = new ServiceBroker({
		logger: false,
		metrics: false,
		tracing: false,
		cacher: false,
		skipProcessEventRegistration: true,
	});

	broker.loadServices(path.resolve(__dirname, "../services"));

	await broker.start();

	try {
		const schema = await broker.call("openapi.generateDocs");
		fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
		fs.writeFileSync(OUT_PATH, JSON.stringify(schema, null, 2));
		console.log(`Exported OpenAPI schema to ${OUT_PATH}`);

		const pathCount = Object.keys(schema.paths || {}).length;
		const methodCount = Object.values(schema.paths || {}).reduce(
			(n, item) => n + Object.keys(item).filter((k) => !k.startsWith("x-")).length,
			0
		);
		console.log(`Paths: ${pathCount}, operations: ${methodCount}`);

		if (fs.existsSync(SWAGGERHUB_PATH)) {
			const hub = JSON.parse(fs.readFileSync(SWAGGERHUB_PATH, "utf8"));
			const normalize = (p) => p.replace(/^\/api\/v1/, "").replace(/^\/apis\/v1/, "") || "/";
			const hubPaths = new Set(Object.keys(hub.paths || {}).map(normalize));
			const genPaths = new Set(
				Object.keys(schema.paths || {})
					.filter((p) => !p.startsWith("/openapi") && p !== "/health")
					.map(normalize)
			);
			const onlyGenerated = [...genPaths].filter((p) => !hubPaths.has(p));
			const onlyHub = [...hubPaths].filter((p) => !genPaths.has(p));
			if (onlyGenerated.length) {
				console.log("\nPaths in generated but not SwaggerHub export:");
				onlyGenerated.forEach((p) => console.log(`  + ${p}`));
			}
			if (onlyHub.length) {
				console.log("\nPaths in SwaggerHub export but not generated:");
				onlyHub.forEach((p) => console.log(`  - ${p}`));
			}
		} else {
			console.log(`\nTip: save SwaggerHub export as ${SWAGGERHUB_PATH} to enable drift diff`);
		}
	} finally {
		await broker.stop();
		if (savedMongoUri !== undefined) {
			process.env.MONGO_URI = savedMongoUri;
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
