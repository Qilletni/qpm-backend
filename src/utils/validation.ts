/**
 * Validation utilities for package names, versions, and tokens
 */
import {VersionInfoType} from "../types";

// Package name validation
const PACKAGE_NAME_REGEX = /^@([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)$/;
const MAX_PACKAGE_NAME_LENGTH = 214;

// Version validation
const VERSION_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

// File size limit
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes

/**
 * Validate package name format
 * @param name Full package name (e.g., "@alice/postgres")
 * @returns Object with validation result
 */
export function validatePackageName(name: string): {
	valid: boolean;
	error?: string;
	scope?: string;
	packageName?: string;
} {
	// Check length
	if (name.length > MAX_PACKAGE_NAME_LENGTH) {
		return {
			valid: false,
			error: `Package name exceeds maximum length of ${MAX_PACKAGE_NAME_LENGTH} characters`,
		};
	}

	// Check format
	const match = name.match(PACKAGE_NAME_REGEX);
	if (!match) {
		return {
			valid: false,
			error: "Invalid package name format. Must be @username/package-name with alphanumeric characters and hyphens",
		};
	}

	const [, scope, packageName] = match;

	return {
		valid: true,
		scope,
		packageName,
	};
}

/**
 * Validate that package scope matches authenticated user
 * @param packageName Full package name (e.g., "@alice/postgres")
 * @param username Authenticated username
 * @returns Object with validation result
 */
export function validatePackageScope(
	packageName: string,
	username: string
): { valid: boolean; error?: string } {
	const validation = validatePackageName(packageName);
	if (!validation.valid) {
		return validation;
	}

	if (validation.scope !== username) {
		return {
			valid: false,
			error: `Package scope @${validation.scope} does not match authenticated user @${username}`,
		};
	}

	return { valid: true };
}

/**
 * Validate version format (semver)
 * @param version Version string (e.g., "1.0.0", "1.0.0-SNAPSHOT")
 * @returns Object with validation result
 */
export function validateVersion(version: string): {
	valid: boolean;
	error?: string;
} {
	if (!VERSION_REGEX.test(version)) {
		return {
			valid: false,
			error: "Invalid version format. Must be valid semver (e.g., 1.0.0, 1.0.0-SNAPSHOT)",
		};
	}

	return { valid: true };
}

/**
 * Extract Bearer token from Authorization header
 * @param authHeader Authorization header value
 * @returns Token string or null if invalid format
 */
export function extractBearerToken(authHeader: string | null): string | null {
	if (!authHeader) {
		return null;
	}

	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	if (!match) {
		return null;
	}

	return match[1];
}

/**
 * Build full package name from scope and package
 * @param scope Username (without @)
 * @param packageName Package name
 * @returns Full package name (e.g., "@alice/postgres")
 */
export function buildPackageName(scope: string, packageName: string): string {
	return `@${scope}/${packageName}`;
}

/**
 * Normalize scope to lowercase for case-insensitive comparison and storage
 * @param scope Scope string (with or without @ prefix)
 * @returns Normalized (lowercase) scope without @ prefix
 * @example
 * normalizeScope("MyOrg") => "myorg"
 * normalizeScope("@MyOrg") => "myorg"
 * normalizeScope("alice") => "alice"
 */
export function normalizeScope(scope: string): string {
	// Remove @ prefix if present, then convert to lowercase
	return scope.startsWith("@") ? scope.slice(1).toLowerCase() : scope.toLowerCase();
}

/**
 * Validate file size
 * @param size File size in bytes
 * @returns Object with validation result
 */
export function validateFileSize(size: number): {
	valid: boolean;
	error?: string;
} {
	if (size > MAX_FILE_SIZE) {
		return {
			valid: false,
			error: `Package size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
		};
	}

	if (size === 0) {
		return {
			valid: false,
			error: "Package file is empty",
		};
	}

	return { valid: true };
}

/**
 * Compare versions using semver logic
 * @param a First version
 * @param b Second version
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
	const aParts = a.split(/[-+]/)[0].split(".").map(Number);
	const bParts = b.split(/[-+]/)[0].split(".").map(Number);

	for (let i = 0; i < 3; i++) {
		if (aParts[i] > bParts[i]) return 1;
		if (aParts[i] < bParts[i]) return -1;
	}

	return 0;
}

/**
 * Find the latest version from a list
 * @param versions Array of version strings
 * @returns Latest version string
 */
export function findLatestVersion(versions: VersionInfoType[]): VersionInfoType | null {
	if (versions.length === 0) return null;

	return versions.reduce((latest, current) => {
		return compareVersions(current.version, latest.version) > 0 ? current : latest;
	});
}

// Version constraint regex (supports exact, caret, and tilde)
const VERSION_CONSTRAINT_REGEX = /^[\^~]?\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

/**
 * Validate dependencies format
 * @param dependencies Record of package name to version constraint
 * @returns Object with validation result and details about any errors
 */
export function validateDependencies(dependencies: Record<string, string>): {
	valid: boolean;
	errors?: string[];
} {
	const errors: string[] = [];

	for (const [packageName, versionConstraint] of Object.entries(dependencies)) {
		// Validate package name format
		const nameValidation = validatePackageName(packageName);
		if (!nameValidation.valid) {
			errors.push(`Invalid package name "${packageName}": ${nameValidation.error}`);
		}

		// Validate version constraint format
		if (!VERSION_CONSTRAINT_REGEX.test(versionConstraint)) {
			errors.push(
				`Invalid version constraint "${versionConstraint}" for package "${packageName}". Must be valid semver with optional ^ or ~ prefix (e.g., "1.0.0", "^1.0.0", "~1.0.0")`
			);
		}
	}

	return {
		valid: errors.length === 0,
		errors: errors.length > 0 ? errors : undefined,
	};
}