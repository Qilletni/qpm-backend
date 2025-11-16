/**
 * Package version delete endpoint
 * DELETE /packages/:scope/:package/:version
 * Requires authentication
 */

import { OpenAPIRoute, contentJson, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { DeleteVersionResponse, ErrorResponse } from "../types";
import { validateGitHubToken } from "../utils/github";
import {
	extractBearerToken,
	validatePackageName,
	validateVersion,
	buildPackageName,
} from "../utils/validation";
import {
	deletePackageVersion,
	findPackagesDependingOn,
} from "../utils/storage";
import { isAdmin } from "../utils/permissions";

export class PackageVersionDelete extends OpenAPIRoute {
	schema = {
		tags: ["Packages"],
		summary: "Delete package version",
		description:
			"Delete a specific version of a package. Requires authentication and package must be owned by the authenticated user.",
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
					description: "Version to delete",
					example: "1.0.0",
				}),
			}),
			headers: z.object({
				authorization: Str({
					description: "Bearer token for GitHub authentication",
					example: "Bearer ghp_xxxxxxxxxxxx",
				}),
			}),
		},
		responses: {
			"200": {
				description: "Version deleted successfully",
				...contentJson(DeleteVersionResponse),
			},
			"401": {
				description: "Unauthorized - invalid or missing token",
				...contentJson(ErrorResponse),
			},
			"403": {
				description: "Forbidden - package not owned by user",
				...contentJson(ErrorResponse),
			},
			"404": {
				description: "Package version not found",
				...contentJson(ErrorResponse),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { scope, package: packageName, version } = data.params;
		const { authorization } = data.headers;

		// Step 1: Extract and validate Bearer token
		const token = extractBearerToken(authorization);
		if (!token) {
			return Response.json(
				{
					success: false,
					error: "unauthorized",
					message: "Missing or invalid Authorization header. Use: Bearer <token>",
				},
				{ status: 401 }
			);
		}

		// Step 2: Validate token with GitHub
		const user = await validateGitHubToken(token, c.env);
		if (!user) {
			return Response.json(
				{
					success: false,
					error: "unauthorized",
					message: "Invalid GitHub token. Please login again.",
				},
				{ status: 401 }
			);
		}

		// Step 3: Validate package name format
		const fullPackageName = buildPackageName(scope, packageName);
		const nameValidation = validatePackageName(fullPackageName);
		if (!nameValidation.valid) {
			return Response.json(
				{
					success: false,
					error: "invalid_package_name",
					message: nameValidation.error,
				},
				{ status: 400 }
			);
		}

		// Step 4: Validate version format
		const versionValidation = validateVersion(version);
		if (!versionValidation.valid) {
			return Response.json(
				{
					success: false,
					error: "invalid_version",
					message: versionValidation.error,
				},
				{ status: 400 }
			);
		}

		// Step 5: Verify scope matches authenticated user
		// Admins can delete any package
		const userIsAdmin = await isAdmin(user.id, c.env);
		if (!userIsAdmin && scope !== user.login) {
			return Response.json(
				{
					success: false,
					error: "forbidden",
					message: `Package scope @${scope} does not match authenticated user @${user.login}. You can only delete your own packages.`,
				},
				{ status: 403 }
			);
		}

		// Step 6: Check for packages that depend on this version
		// TODO: Implement efficient dependency checking (currently causes timeouts with many packages)
		// Options: Use Durable Objects, background job, or index-based lookup
		let dependents: string[] = [];
		// DISABLED FOR PERFORMANCE: This scans ALL packages in registry, causing a ton of R2 calls
		// try {
		// 	dependents = await findPackagesDependingOn(
		// 		c.env.PACKAGES,
		// 		fullPackageName
		// 	);
		// } catch (error) {
		// 	console.warn("Failed to check dependents:", error);
		// 	// Continue even if dependent check fails
		// }

		// Step 7: Delete the version
		try {
			await deletePackageVersion(
				c.env.PACKAGES,
				scope,
				packageName,
				version
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes("does not exist")) {
				return Response.json(
					{
						success: false,
						error: "not_found",
						message: `Version ${version} of package @${scope}/${packageName} not found`,
					},
					{ status: 404 }
				);
			}

			console.error("Failed to delete package version:", error);
			return Response.json(
				{
					success: false,
					error: "internal_error",
					message: "Failed to delete package version",
				},
				{ status: 500 }
			);
		}

		// Step 8: Build response with optional warning about dependents
		const response: any = {
			success: true,
			deleted: {
				name: fullPackageName,
				version: version,
			},
		};

		if (dependents.length > 0) {
			response.warning = {
				dependents: dependents,
				message: `This version was used by ${dependents.length} other package${dependents.length > 1 ? "s" : ""}`,
			};
		}

		return Response.json(response);
	}
}
