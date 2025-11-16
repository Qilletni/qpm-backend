import { fromHono } from "chanfana";
import { Hono } from "hono";
import { PackageUpload } from "./endpoints/packageUpload";
import { PackageDownload } from "./endpoints/packageDownload";
import { PackageList } from "./endpoints/packageList";
import { PackageMetadataEndpoint } from "./endpoints/packageMetadata";
import { AuthDevice } from "./endpoints/authDevice";
import { PackageRegistryList } from "./endpoints/packageRegistryList";
import { PackageVersionDelete } from "./endpoints/packageVersionDelete";
import { PermissionGrant } from "./endpoints/permissionGrant";
import { PermissionRevoke } from "./endpoints/permissionRevoke";
import { PermissionList } from "./endpoints/permissionList";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
	schema: {
		info: {
			title: "Qilletni Package Manager (QPM) Registry",
			version: "1.0.0",
			description: "Package registry for Qilletni packages with GitHub OAuth authentication",
		},
		servers: [
			{
				url: "https://qpm.qilletni.dev/",
				description: "Production server",
			},
		],
	},
});

// Register OpenAPI endpoints

// Package management endpoints
openapi.get("/packages", PackageRegistryList); // List all packages (must be before /:scope/:package)
openapi.post("/packages/:scope/:package/:version", PackageUpload);
openapi.get("/packages/:scope/:package/:version", PackageDownload);
openapi.delete("/packages/:scope/:package/:version", PackageVersionDelete);
openapi.get("/packages/:scope/:package", PackageList);
openapi.get("/packages/:scope/:package/:version/metadata", PackageMetadataEndpoint);

// Authentication endpoints
openapi.post("/auth/device/code", AuthDevice);

// Permission management endpoints
openapi.post("/permissions/:user/:permission", PermissionGrant);
openapi.delete("/permissions/:user/:permission", PermissionRevoke);
openapi.get("/permissions/:user", PermissionList);

// Export the Hono app
export default app;

// Export Durable Objects
export { RateLimiter } from "./durable-objects/RateLimiter";
