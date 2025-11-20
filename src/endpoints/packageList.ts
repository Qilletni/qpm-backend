/**
 * Package list endpoint
 * GET /packages/:scope/:package
 * Returns list of all versions for a package
 */

import { OpenAPIRoute, contentJson, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { PackageListResponse, ErrorResponse } from "../types";
import { getVersionList } from "../utils/storage";
import {buildPackageName, extractBearerToken, normalizeScope} from "../utils/validation";

export class PackageList extends OpenAPIRoute {
	schema = {
		tags: ["Packages"],
		summary: "List package versions",
		description:
			"Get metadata and list of all published versions for a package. Returns versions array and latest version.",
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
			}),
		},
		responses: {
			"200": {
				description: "Package version list",
				...contentJson(PackageListResponse),
			},
			"404": {
				description: "Package not found",
				...contentJson(ErrorResponse),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { scope: rawScope, package: packageName } = data.params;

		// Normalize scope to lowercase for case-insensitive lookup
		const scope = normalizeScope(rawScope);

        const token = extractBearerToken(
            c.req.header("Authorization") || null
        );

		// Get version list from R2
		const versionList = await getVersionList(
			c.env.PACKAGES,
			scope,
			packageName
		);

		if (!versionList) {
			return Response.json(
				{
					success: false,
					error: "not_found",
					message: `Package @${scope}/${packageName} not found`,
				},
				{ status: 404 }
			);
		}

		const fullPackageName = buildPackageName(scope, packageName);

		return {
			name: fullPackageName,
			versions: versionList.versions,
			latest: versionList.latest || "0.0.0",
		};
	}
}