/**
 * Package metadata endpoint
 * GET /packages/:scope/:package/:version/metadata
 * Returns metadata for a specific package version
 */

import { OpenAPIRoute, contentJson, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { PackageMetadata, ErrorResponse } from "../types";
import { getMetadata } from "../utils/storage";

export class PackageMetadataEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Packages"],
		summary: "Get package version metadata",
		description:
			"Retrieve metadata for a specific package version, including integrity hash, size, and upload information.",
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
		},
		responses: {
			"200": {
				description: "Package metadata",
				...contentJson(PackageMetadata),
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

		// Get metadata from R2
		const metadata = await getMetadata(
			c.env.PACKAGES,
			scope,
			packageName,
			version
		);

		if (!metadata) {
			return Response.json(
				{
					success: false,
					error: "not_found",
					message: `Package @${scope}/${packageName}@${version} not found`,
				},
				{ status: 404 }
			);
		}

		return metadata;
	}
}