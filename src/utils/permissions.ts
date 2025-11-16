import type { Env } from "../types";

/**
 * Fetches the permissions array for a given user ID from KV storage
 *
 * @param userId - GitHub user ID (numeric)
 * @param env - Cloudflare environment bindings
 * @returns Array of permission strings (e.g., ['admin']) or empty array if no permissions
 */
export async function getUserPermissions(
	userId: number,
	env: Env
): Promise<string[]> {
	const key = userId.toString();
	const permissionsJson = await env.PERMISSIONS.get(key);

	if (!permissionsJson) {
		return [];
	}

	try {
		const permissions = JSON.parse(permissionsJson);
		if (Array.isArray(permissions)) {
			return permissions;
		}
		return [];
	} catch {
		return [];
	}
}

/**
 * Checks if a user has a specific permission
 *
 * @param userId - GitHub user ID (numeric)
 * @param permission - Permission name to check (e.g., 'admin')
 * @param env - Cloudflare environment bindings
 * @returns True if user has the permission, false otherwise
 */
export async function hasPermission(
	userId: number,
	permission: string,
	env: Env
): Promise<boolean> {
	const permissions = await getUserPermissions(userId, env);
	return permissions.includes(permission);
}

/**
 * Convenience function to check if a user is an admin
 *
 * @param userId - GitHub user ID (numeric)
 * @param env - Cloudflare environment bindings
 * @returns True if user has admin permission, false otherwise
 */
export async function isAdmin(
	userId: number,
	env: Env
): Promise<boolean> {
	return hasPermission(userId, "admin", env);
}

/**
 * Grants a permission to a user
 *
 * @param userId - GitHub user ID (numeric)
 * @param permission - Permission name to grant (e.g., 'admin')
 * @param env - Cloudflare environment bindings
 */
export async function grantPermission(
	userId: number,
	permission: string,
	env: Env
): Promise<void> {
	const permissions = await getUserPermissions(userId, env);

	// Only add if not already present
	if (!permissions.includes(permission)) {
		permissions.push(permission);
		const key = userId.toString();
		await env.PERMISSIONS.put(key, JSON.stringify(permissions));
	}
}

/**
 * Revokes a permission from a user
 *
 * @param userId - GitHub user ID (numeric)
 * @param permission - Permission name to revoke (e.g., 'admin')
 * @param env - Cloudflare environment bindings
 */
export async function revokePermission(
	userId: number,
	permission: string,
	env: Env
): Promise<void> {
	const permissions = await getUserPermissions(userId, env);
	const filteredPermissions = permissions.filter(p => p !== permission);

	const key = userId.toString();

	// If no permissions left, delete the key entirely
	if (filteredPermissions.length === 0) {
		await env.PERMISSIONS.delete(key);
	} else {
		await env.PERMISSIONS.put(key, JSON.stringify(filteredPermissions));
	}
}
