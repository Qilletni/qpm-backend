/**
 * Package download endpoint
 * GET /packages/:scope/:package/:version
 * Public endpoint (no authentication required)
 */

import { OpenAPIRoute, contentJson, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { ErrorResponse } from "../types";
import { getPackage, getMetadata } from "../utils/storage";

export class PackageDownload extends OpenAPIRoute {
	schema = {
		tags: ["Packages"],
		summary: "Download a package version",
		description:
			"Download a specific version of a package. No authentication required. Returns the package archive with caching headers.",
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
				description:
					"Package archive (binary gzip data with cache headers)",
				// Binary response - no content schema defined
			},
			"304": {
				description: "Not Modified - ETag matches",
			},
			"404": {
				description: "Package or version not found",
				...contentJson(ErrorResponse),
			},
			"206": {
				description: "Partial Content - Range request response",
				// Binary response - no content schema defined
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { scope, package: packageName, version } = data.params;

		// Step 1: Get package from R2
		const packageObject = await getPackage(
			c.env.PACKAGES,
			scope,
			packageName,
			version
		);

		if (!packageObject) {
			return Response.json(
				{
					success: false,
					error: "not_found",
					message: `Package @${scope}/${packageName}@${version} not found`,
				},
				{ status: 404 }
			);
		}

		// Step 2: Handle If-None-Match for 304 responses
		const ifNoneMatch = c.req.header("If-None-Match");
		if (ifNoneMatch && packageObject.etag === ifNoneMatch) {
			return new Response(null, { status: 304 });
		}

		// Step 3: Get metadata for integrity hash
		const metadata = await getMetadata(
			c.env.PACKAGES,
			scope,
			packageName,
			version
		);

		// Step 4: Handle Range header for partial downloads
		const range = c.req.header("Range");
		if (range) {
			// Parse range header (e.g., "bytes=0-1023")
			const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
			if (rangeMatch && packageObject.size) {
				const start = parseInt(rangeMatch[1], 10);
				const end = rangeMatch[2]
					? parseInt(rangeMatch[2], 10)
					: packageObject.size - 1;

				// Get range from R2
				const rangeObject = await c.env.PACKAGES.get(
					`packages/@${scope}/${packageName}/${version}/package.tar.gz`,
					{
						range: { offset: start, length: end - start + 1 },
					}
				);

				if (rangeObject && rangeObject.body) {
					return new Response(rangeObject.body, {
						status: 206,
						headers: {
							"Content-Type": "application/gzip",
							"Content-Length": (end - start + 1).toString(),
							"Content-Range": `bytes ${start}-${end}/${packageObject.size}`,
							"Cache-Control":
								"public, max-age=31536000, immutable",
							ETag: packageObject.etag,
							...(metadata && {
								"X-Package-Integrity": metadata.integrity,
							}),
						},
					});
				}
			}
		}

		// Step 5: Stream package directly to response
		const headers: Record<string, string> = {
			"Content-Type": "application/gzip",
			"Content-Length": packageObject.size?.toString() || "0",
			"Cache-Control": "public, max-age=31536000, immutable", // 1 year
			ETag: packageObject.etag,
		};

		// Add integrity hash if available
		if (metadata) {
			headers["X-Package-Integrity"] = metadata.integrity;
		}

		return new Response(packageObject.body, {
			status: 200,
			headers,
		});
	}
}