/**
 * Package registry list endpoint
 * GET /packages
 * Returns list of all packages in the registry
 */

import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../types";
import { PackageRegistryListResponse } from "../types";
import { listAllPackages, getIndex } from "../utils/storage";

export class PackageRegistryList extends OpenAPIRoute {
	schema = {
		tags: ["Packages"],
		summary: "List all packages",
		description:
			"Get a list of all packages in the registry with their latest versions and version counts.",
		responses: {
			"200": {
				description: "List of all packages in registry",
				...contentJson(PackageRegistryListResponse),
			},
		},
	};

	async handle(c: AppContext) {
		// Get all package names from R2
		const packageNames = await listAllPackages(c.env.PACKAGES);

		// For each package, get latest version and version count
		const packages = await Promise.all(
			packageNames.map(async (name) => {
				// Parse scope and package name
				const parts = name.split("/");
				if (parts.length !== 2) {
					return null;
				}

				const scope = parts[0].substring(1); // Remove @ prefix
				const packageName = parts[1];

				// Get package index
				const index = await getIndex(c.env.PACKAGES, scope, packageName);

				if (!index) {
					return null;
				}

				// Find latest version (already sorted in index, first is latest)
				const latest = index.versions[0]?.version;
				const versionCount = index.versions.length;

				return {
					name,
					latest,
					versionCount,
				};
			})
		);

		// Filter out any null entries (packages that couldn't be loaded)
		const validPackages = packages.filter((pkg) => pkg !== null);

		return Response.json({
			packages: validPackages,
			total: validPackages.length,
		});
	}
}
