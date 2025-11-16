/**
 * R2 storage utilities for package management
 */

import type { PackageMetadataType, PackageIndexType } from "../types";
import { findLatestVersion } from "./validation";
import {VersionInfoType} from "../types";

/**
 * Build R2 key for package archive
 * Format: packages/@scope/package/version/package.tar.gz
 */
export function buildPackageKey(
	scope: string,
	packageName: string,
	version: string
): string {
	return `packages/@${scope}/${packageName}/${version}/package.tar.gz`;
}

/**
 * Build R2 key for package metadata
 * Format: packages/@scope/package/version/metadata.json
 */
export function buildMetadataKey(
	scope: string,
	packageName: string,
	version: string
): string {
	return `packages/@${scope}/${packageName}/${version}/metadata.json`;
}

/**
 * Build R2 key for package index
 * Format: packages/@scope/package/index.json
 */
export function buildIndexKey(scope: string, packageName: string): string {
	return `packages/@${scope}/${packageName}/index.json`;
}

/**
 * Check if a package version exists in R2
 */
export async function packageVersionExists(
	bucket: R2Bucket,
	scope: string,
	packageName: string,
	version: string
): Promise<boolean> {
	const key = buildPackageKey(scope, packageName, version);
	const object = await bucket.head(key);
	return object !== null;
}

/**
 * Store package metadata in R2
 */
export async function storeMetadata(
	bucket: R2Bucket,
	scope: string,
	packageName: string,
	version: string,
	metadata: PackageMetadataType
): Promise<void> {
	const key = buildMetadataKey(scope, packageName, version);
	await bucket.put(key, JSON.stringify(metadata, null, 2), {
		httpMetadata: {
			contentType: "application/json",
		},
	});
}

/**
 * Retrieve package metadata from R2
 */
export async function getMetadata(
	bucket: R2Bucket,
	scope: string,
	packageName: string,
	version: string
): Promise<PackageMetadataType | null> {
	const key = buildMetadataKey(scope, packageName, version);
	const object = await bucket.get(key);

	if (!object) {
		return null;
	}

	const text = await object.text();
	return JSON.parse(text) as PackageMetadataType;
}

/**
 * Store package archive in R2
 */
export async function storePackage(
	bucket: R2Bucket,
	scope: string,
	packageName: string,
	version: string,
	data: ArrayBuffer | ReadableStream
): Promise<void> {
	const key = buildPackageKey(scope, packageName, version);
	await bucket.put(key, data, {
		httpMetadata: {
			contentType: "application/gzip",
			cacheControl: "public, max-age=31536000, immutable", // 1 year cache
		},
	});
}

/**
 * Retrieve package archive from R2
 */
export async function getPackage(
	bucket: R2Bucket,
	scope: string,
	packageName: string,
	version: string
): Promise<R2ObjectBody | null> {
	const key = buildPackageKey(scope, packageName, version);
	return await bucket.get(key);
}

/**
 * Get package index from R2
 */
export async function getIndex(
	bucket: R2Bucket,
	scope: string,
	packageName: string
): Promise<PackageIndexType | null> {
	const key = buildIndexKey(scope, packageName);
	const object = await bucket.get(key);

	if (!object) {
		return null;
	}

	const text = await object.text();
	return JSON.parse(text) as PackageIndexType;
}

/**
 * Update package index with new version
 * Creates index if it doesn't exist
 */
export async function updateIndex(
	bucket: R2Bucket,
	scope: string,
	packageName: string,
	metadata: PackageMetadataType
): Promise<void> {
	const key = buildIndexKey(scope, packageName);
	const fullPackageName = `@${scope}/${packageName}`;

	// Get existing index or create new one
	let index: PackageIndexType;
	const existingObject = await bucket.get(key);

	if (existingObject) {
		const text = await existingObject.text();
		index = JSON.parse(text) as PackageIndexType;
	} else {
		index = {
			name: fullPackageName,
			versions: [],
		};
	}

	// Check if version already exists (shouldn't happen due to earlier check)
	const versionExists = index.versions.some(
		(v) => v.version === metadata.version
	);

	if (!versionExists) {
		// Add new version
		index.versions.push({
			version: metadata.version,
			integrity: metadata.integrity,
			size: metadata.size,
			uploadedAt: metadata.uploadedAt,
			dependencies: metadata.dependencies,
		});

		// Sort versions (newest first)
		index.versions.sort((a, b) => {
			const aParts = a.version.split(".").map(Number);
			const bParts = b.version.split(".").map(Number);

			for (let i = 0; i < 3; i++) {
				if (aParts[i] !== bParts[i]) {
					return bParts[i] - aParts[i];
				}
			}
			return 0;
		});
	}

	// Store updated index
	await bucket.put(key, JSON.stringify(index, null, 2), {
		httpMetadata: {
			contentType: "application/json",
			cacheControl: "public, max-age=300", // 5 minute cache for index
		},
	});
}

/**
 * Get list of version strings with latest version
 */
export async function getVersionList(
	bucket: R2Bucket,
	scope: string,
	packageName: string
): Promise<{ versions: VersionInfoType[]; latest: VersionInfoType | null } | null> {
	const index = await getIndex(bucket, scope, packageName);

	if (!index) {
		return null;
	}

	const latest = findLatestVersion(index.versions);

	return {
        versions: index.versions,
        latest: latest,
	};
}

/**
 * Compute SHA-256 integrity hash for package data
 * Returns hash in "sha256-<base64>" format (compatible with npm)
 */
export async function computeIntegrity(data: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashBase64 = btoa(String.fromCharCode(...hashArray));
	return `sha256-${hashBase64}`;
}

/**
 * Read stream into ArrayBuffer
 */
export async function streamToArrayBuffer(
	stream: ReadableStream
): Promise<ArrayBuffer> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		totalLength += value.length;
	}

	// Combine chunks into single ArrayBuffer
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result.buffer;
}

/**
 * List all packages in the registry
 * @param bucket R2 bucket
 * @returns Array of unique package names (@scope/package)
 */
export async function listAllPackages(bucket: R2Bucket): Promise<string[]> {
	const packages = new Set<string>();
	const prefix = "packages/";

	// List all objects in R2 with packages/ prefix
	let cursor: string | undefined = undefined;
	let hasMore = true;

	while (hasMore) {
		const listed = await bucket.list({
			prefix,
			cursor,
			limit: 1000,
		});

		// Parse each key to extract @scope/package
		for (const object of listed.objects) {
			// Key format: packages/@scope/package/version/... or packages/@scope/package/index.json
			const path = object.key.substring(prefix.length); // Remove "packages/" prefix
			const parts = path.split("/");

			// Need at least @scope and package name
			if (parts.length >= 2) {
				const scope = parts[0]; // e.g., "@alice"
				const packageName = parts[1]; // e.g., "postgres"
				const fullName = `${scope}/${packageName}`;
				packages.add(fullName);
			}
		}

		hasMore = listed.truncated;
		cursor = listed.cursor;
	}

	return Array.from(packages).sort();
}

/**
 * Get the latest version for a package from its index
 * @param bucket R2 bucket
 * @param scope Package scope (without @)
 * @param packageName Package name
 * @returns Latest version string or null if not found
 */
export async function getPackageLatestVersion(
	bucket: R2Bucket,
	scope: string,
	packageName: string
): Promise<string | null> {
	const versionList = await getVersionList(bucket, scope, packageName);
	return versionList?.latest || null;
}

/**
 * Delete a specific package version
 * @param bucket R2 bucket
 * @param scope Package scope (without @)
 * @param packageName Package name
 * @param version Version to delete
 * @throws Error if version doesn't exist or deletion fails
 */
export async function deletePackageVersion(
	bucket: R2Bucket,
	scope: string,
	packageName: string,
	version: string
): Promise<void> {
	// Check if version exists
	const exists = await packageVersionExists(bucket, scope, packageName, version);
	if (!exists) {
		throw new Error(`Version ${version} of package @${scope}/${packageName} does not exist`);
	}

	// Delete package tarball
	const packageKey = buildPackageKey(scope, packageName, version);
	await bucket.delete(packageKey);

	// Delete metadata
	const metadataKey = buildMetadataKey(scope, packageName, version);
	await bucket.delete(metadataKey);

	// Update index.json - remove this version from the list
	const index = await getIndex(bucket, scope, packageName);
	if (index) {
		// Remove the version from the versions array
		index.versions = index.versions.filter((v) => v.version !== version);

		if (index.versions.length === 0) {
			// If no more versions, delete the index
			const indexKey = buildIndexKey(scope, packageName);
			await bucket.delete(indexKey);
		} else {
			// Update the index with remaining versions
			const indexKey = buildIndexKey(scope, packageName);
			await bucket.put(indexKey, JSON.stringify(index, null, 2), {
				httpMetadata: {
					contentType: "application/json",
					cacheControl: "public, max-age=300",
				},
			});
		}
	}
}

/**
 * Find all packages that depend on a specific package
 * @param bucket R2 bucket
 * @param targetPackage Package name to search for (e.g., "@alice/postgres")
 * @returns Array of package names that depend on the target
 */
export async function findPackagesDependingOn(
	bucket: R2Bucket,
	targetPackage: string
): Promise<string[]> {
	const dependents = new Set<string>();

	// Get all packages in the registry
	const allPackages = await listAllPackages(bucket);

	// For each package, check if any version depends on the target
	for (const packageName of allPackages) {
		// Skip checking the target package itself
		if (packageName === targetPackage) {
			continue;
		}

		// Parse scope and package name
		const parts = packageName.split("/");
		if (parts.length !== 2) continue;

		const scope = parts[0].substring(1); // Remove @ prefix
		const pkgName = parts[1];

		// Get the package index
		const index = await getIndex(bucket, scope, pkgName);
		if (!index) continue;

		// Check each version's dependencies
		for (const versionInfo of index.versions) {
			if (versionInfo.dependencies && targetPackage in versionInfo.dependencies) {
				dependents.add(packageName);
				break; // No need to check other versions of this package
			}
		}
	}

	return Array.from(dependents).sort();
}