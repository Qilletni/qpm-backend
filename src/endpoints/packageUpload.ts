/**
 * Package upload endpoint
 * POST /packages/:scope/:package/:version
 * Requires authentication
 */

import { contentJson, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { UploadSuccessResponse, ErrorResponse } from "../types";
import { validateGitHubToken } from "../utils/github";
import {
	extractBearerToken,
	validatePackageName,
	validateVersion,
	validateFileSize,
	buildPackageName,
	validateDependencies,
} from "../utils/validation";
import {
	packageVersionExists,
	storePackage,
	storeMetadata,
	updateIndex,
	computeIntegrity,
	streamToArrayBuffer,
} from "../utils/storage";
import {
	checkUploadRateLimit,
	incrementUploadCount,
} from "../utils/rate-limit";
import { extractDependencies } from "../utils/package-parser";
import { isAdmin } from "../utils/permissions";

export class PackageUpload extends OpenAPIRoute {
	schema = {
		tags: ["Packages"],
		summary: "Upload a package version",
		description:
			"Upload a new package version to the registry. Requires GitHub authentication. Package scope must match authenticated user.",
		request: {
			params: z.object({
				scope: Str({
					description: "Package scope (username without @)",
					example: "alice",
				}),
				package: Str({
					description: "Package name",
					example: "postgres",
				}),
				version: Str({
					description: "Package version (semver format)",
					example: "1.0.0",
				}),
			}),
			headers: z.object({
				authorization: z
					.string()
					.describe("Bearer token from GitHub OAuth"),
				"content-type": z
					.literal("application/gzip")
					.describe("Must be application/gzip"),
				"content-length": z
					.string()
					.describe("Size of package in bytes"),
			}),
			// Binary body (gzip) - not using contentJson
		},
		responses: {
			"201": {
				description: "Package uploaded successfully",
				...contentJson(UploadSuccessResponse),
			},
			"401": {
				description: "Unauthorized - Invalid or missing token",
				...contentJson(ErrorResponse),
			},
			"403": {
				description: "Forbidden - Scope mismatch or validation error",
				...contentJson(ErrorResponse),
			},
			"409": {
				description: "Conflict - Version already exists",
				...contentJson(ErrorResponse),
			},
			"413": {
				description: "Payload Too Large - Exceeds 50MB limit",
				...contentJson(ErrorResponse),
			},
			"429": {
				description: "Too Many Requests - Rate limit exceeded",
				...contentJson(ErrorResponse),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { scope, package: packageName, version } = data.params;

		// Step 0: Extract IP address for rate limiting
		const ip = c.req.header("CF-Connecting-IP");
		if (!ip) {
			return Response.json(
				{
					success: false,
					error: "bad_request",
					message: "Could not determine client IP address",
				},
				{ status: 400 }
			);
		}

		// Step 1: Extract and validate token
		const token = extractBearerToken(
			c.req.header("Authorization") || null
		);
		if (!token) {
			return Response.json(
				{
					success: false,
					error: "unauthorized",
					message: "Missing authentication token",
				},
				{ status: 401 }
			);
		}

		// Step 2: Validate token with GitHub API
		const user = await validateGitHubToken(token, c.env);
		if (!user) {
			return Response.json(
				{
					success: false,
					error: "unauthorized",
					message: "Invalid authentication token",
				},
				{ status: 401 }
			);
		}

		// Step 3: Build and validate package name
		const fullPackageName = buildPackageName(scope, packageName);
		const nameValidation = validatePackageName(fullPackageName);
		if (!nameValidation.valid) {
			return Response.json(
				{
					success: false,
					error: "invalid_package_name",
					message: nameValidation.error,
				},
				{ status: 403 }
			);
		}

		// Step 4: Validate scope matches authenticated user
		// Admins can upload to any scope
		const userIsAdmin = await isAdmin(user.id, c.env);
		if (!userIsAdmin && scope !== user.login) {
			return Response.json(
				{
					success: false,
					error: "forbidden",
					message: `Package scope @${scope} does not match authenticated user @${user.login}`,
				},
				{ status: 403 }
			);
		}

		// Step 5: Validate version format
		const versionValidation = validateVersion(version);
		if (!versionValidation.valid) {
			return Response.json(
				{
					success: false,
					error: "invalid_version",
					message: versionValidation.error,
				},
				{ status: 403 }
			);
		}

		// Step 6: Check if version already exists
		const exists = await packageVersionExists(
			c.env.PACKAGES,
			scope,
			packageName,
			version
		);
		if (exists) {
			return Response.json(
				{
					success: false,
					error: "version_exists",
					message: `Version ${version} of ${fullPackageName} already exists (versions are immutable)`,
				},
				{ status: 409 }
			);
		}

		// Step 7: Check rate limits
		const rateLimit = await checkUploadRateLimit(c.env, ip);
		if (!rateLimit.allowed) {
			const resetDate = new Date(rateLimit.resetAt).toISOString();
			return Response.json(
				{
					success: false,
					error: "rate_limit_exceeded",
					message: `Rate limit exceeded. Limit resets at ${resetDate}`,
				},
				{
					status: 429,
					headers: {
						"X-RateLimit-Limit": "10",
						"X-RateLimit-Remaining": "0",
						"X-RateLimit-Reset": Math.floor(
							rateLimit.resetAt / 1000
						).toString(),
					},
				}
			);
		}

		// Step 8: Validate file size
		const contentLength = parseInt(
			c.req.header("Content-Length") || "0",
			10
		);
		const sizeValidation = validateFileSize(contentLength);
		if (!sizeValidation.valid) {
			return Response.json(
				{
					success: false,
					error: "payload_too_large",
					message: sizeValidation.error,
				},
				{ status: 413 }
			);
		}

		// Step 9: Read request body
		let packageData: ArrayBuffer;
		try {
			if (c.req.arrayBuffer) {
                packageData = await c.req.arrayBuffer()
			} else {
				return Response.json(
					{
						success: false,
						error: "invalid_request",
						message: "Request body is empty",
					},
					{ status: 400 }
				);
			}
		} catch (error) {
			return Response.json(
				{
					success: false,
					error: "invalid_request",
					message: "Failed to read request body",
				},
				{ status: 400 }
			);
		}

		// Step 10: Compute integrity hash
		const integrity = await computeIntegrity(packageData);

		// Step 11: Store package in R2
		try {
			await storePackage(
				c.env.PACKAGES,
				scope,
				packageName,
				version,
				packageData
			);
		} catch (error) {
			console.error("Failed to store package:", error);
			return Response.json(
				{
					success: false,
					error: "internal_error",
					message: "Failed to store package",
				},
				{ status: 500 }
			);
		}

		// Step 12: Extract dependencies from package
		let dependencies: Record<string, string> = {};
		try {
			dependencies = await extractDependencies(packageData);
			console.log(`Extracted ${Object.keys(dependencies).length} dependencies from ${fullPackageName}@${version}`);

			// Validate dependencies format
			if (Object.keys(dependencies).length > 0) {
				const validation = validateDependencies(dependencies);
				if (!validation.valid) {
					console.warn(`Invalid dependencies in ${fullPackageName}@${version}:`, validation.errors);
					// Continue with the dependencies anyway, but log the validation errors
					// This allows packages with minor format issues to still be uploaded
				}
			}
		} catch (error) {
			console.warn(`Failed to extract dependencies from ${fullPackageName}@${version}:`, error);
			// Continue with empty dependencies rather than failing the upload
			// This allows packages without qll.info or with parsing issues to still be uploaded
		}

		// Step 13: Store metadata
		const metadata = {
			name: fullPackageName,
			version,
			integrity,
			size: packageData.byteLength,
			uploadedAt: new Date().toISOString(),
			uploadedBy: user.login,
			dependencies: dependencies,
		};

		try {
			await storeMetadata(
				c.env.PACKAGES,
				scope,
				packageName,
				version,
				metadata
			);
		} catch (error) {
			console.error("Failed to store metadata:", error);
			return Response.json(
				{
					success: false,
					error: "internal_error",
					message: "Failed to store metadata",
				},
				{ status: 500 }
			);
		}

		// Step 13: Update index.json
		try {
			await updateIndex(c.env.PACKAGES, scope, packageName, metadata);
		} catch (error) {
			console.error("Failed to update index:", error);
			// Don't fail the upload if index update fails
		}

		// Step 14: Increment rate limit counter
		await incrementUploadCount(c.env, ip);

		// Step 15: Return success response
		return Response.json(
			{
				success: true,
                packageInfo: {
					name: fullPackageName,
					version,
					integrity,
					size: packageData.byteLength,
				},
			},
			{
				status: 201,
				headers: {
					"X-RateLimit-Limit": "10",
					"X-RateLimit-Remaining": rateLimit.remaining.toString(),
					"X-RateLimit-Reset": Math.floor(
						rateLimit.resetAt / 1000
					).toString(),
				},
			}
		);
	}
}