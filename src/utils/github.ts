/**
 * GitHub API integration utilities
 */

import type { GitHubUser, GitHubOrgMembership, AuthenticatedIdentity } from "../types";

const GITHUB_API_BASE = "https://api.github.com";
const TOKEN_CACHE_TTL = 15 * 60; // 15 minutes in seconds (for KV expirationTtl)
const ORG_MEMBERSHIP_CACHE_TTL = 60 * 60; // 1 hour in seconds (for KV expirationTtl)

/**
 * Hash a token using SHA-256 for secure cache key generation
 * This prevents storing actual token values in KV
 * @param token GitHub OAuth token
 * @returns Hex-encoded SHA-256 hash of the token
 */
async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(token);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate GitHub token and get authenticated identity
 * Supports both OAuth/PAT user tokens and GitHub App installation tokens
 * Uses KV cache to avoid hitting GitHub API on every request (15 minute TTL)
 * @param token GitHub token (OAuth, PAT, or installation token)
 * @param env Cloudflare Worker environment bindings
 * @returns Authenticated identity or null if invalid
 */
export async function validateGitHubToken(
	token: string,
	env: { TOKEN_CACHE: KVNamespace }
): Promise<AuthenticatedIdentity | null> {
	// Create secure cache key by hashing the token
	const cacheKey = await hashToken(token);

	// Check KV cache
	const cachedData = await env.TOKEN_CACHE.get(cacheKey);
	if (cachedData) {
		return JSON.parse(cachedData) as AuthenticatedIdentity;
	}

	// Try OAuth/PAT validation first (GET /user)
	const userIdentity = await tryValidateAsUserToken(token);
	if (userIdentity) {
		await env.TOKEN_CACHE.put(cacheKey, JSON.stringify(userIdentity), {
			expirationTtl: TOKEN_CACHE_TTL,
		});
		return userIdentity;
	}

	// Try GitHub App installation token validation
	const installationIdentity = await tryValidateAsInstallationToken(token);
	if (installationIdentity) {
		await env.TOKEN_CACHE.put(cacheKey, JSON.stringify(installationIdentity), {
			expirationTtl: TOKEN_CACHE_TTL,
		});
		return installationIdentity;
	}

	return null; // Invalid token
}

/**
 * Try to validate token as an OAuth/PAT user token
 * @param token GitHub token
 * @returns Authenticated identity or null if not a valid user token
 */
async function tryValidateAsUserToken(token: string): Promise<AuthenticatedIdentity | null> {
	try {
		const response = await fetch(`${GITHUB_API_BASE}/user`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "qpm-registry/1.0.0",
				Accept: "application/vnd.github.v3+json",
			},
		});

		if (response.status === 401 || response.status === 403) {
			return null; // Not a valid user token
		}

		if (!response.ok) {
			throw new Error(`GitHub API error: ${response.status}`);
		}

		const user = (await response.json()) as GitHubUser;

		return {
			type: 'user',
			scope: user.login.toLowerCase(),
			userId: user.id,
			displayName: user.name || user.login
		};
	} catch (error) {
		console.error('User token validation failed:', error);
		return null;
	}
}

/**
 * Try to validate token as a GitHub App installation token
 * @param token GitHub token
 * @returns Authenticated identity or null if not a valid installation token
 */
async function tryValidateAsInstallationToken(token: string): Promise<AuthenticatedIdentity | null> {
	try {
		// Get repositories accessible by this installation token
		const response = await fetch(`${GITHUB_API_BASE}/installation/repositories`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "qpm-registry/1.0.0",
				Accept: "application/vnd.github.v3+json",
			},
		});

		if (response.status === 401 || response.status === 403) {
			return null; // Not a valid installation token
		}

		if (!response.ok) {
			throw new Error(`GitHub API error: ${response.status}`);
		}

		const data = await response.json();

		if (!data.repositories || data.repositories.length === 0) {
			return null; // No repositories accessible
		}

		// Extract owner from repositories (all should have same owner)
		const owners = new Set(data.repositories.map((repo: any) => repo.owner.login.toLowerCase()));

		if (owners.size > 1) {
			console.warn('Installation token has access to multiple owners:', Array.from(owners));
		}

		const ownerLogin = Array.from(owners)[0];

		return {
			type: 'installation',
			scope: ownerLogin,
			repositories: data.repositories.map((repo: any) => repo.full_name)
		};
	} catch (error) {
		console.error('Installation token validation failed:', error);
		return null;
	}
}

/**
 * Validate organization membership and check if user is an admin
 * Uses KV cache to avoid hitting GitHub API on every request (1 hour TTL)
 * @param token GitHub OAuth token (with read:org scope)
 * @param username GitHub username to check
 * @param orgName Organization name (normalized to lowercase)
 * @param env Cloudflare Worker environment bindings
 * @returns true if user is an admin of the org, false otherwise
 */
export async function validateOrgMembership(
	token: string,
	username: string,
	orgName: string,
	env: { ORG_MEMBERSHIP_CACHE: KVNamespace }
): Promise<{ isAdmin: boolean; error?: string }> {
	// Create cache key: hash(token) + username + orgname
	const tokenHash = await hashToken(token);
	const cacheKey = `${tokenHash}:${username}:${orgName}`;

	// Check KV cache
	const cachedData = await env.ORG_MEMBERSHIP_CACHE.get(cacheKey);
	if (cachedData) {
		return { isAdmin: cachedData === "admin" };
	}

	// Fetch from GitHub API
	try {
		const response = await fetch(
			`${GITHUB_API_BASE}/orgs/${orgName}/memberships/${username}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					"User-Agent": "qpm-registry/1.0.0",
					Accept: "application/vnd.github.v3+json",
				},
			}
		);

		// Handle various error cases
		if (response.status === 404) {
			// User is not a member of the org
			await env.ORG_MEMBERSHIP_CACHE.put(cacheKey, "not_member", {
				expirationTtl: ORG_MEMBERSHIP_CACHE_TTL,
			});
			return { isAdmin: false };
		}

		if (response.status === 403) {
			// Token lacks read:org scope
			return {
				isAdmin: false,
				error: "insufficient_permissions"
			};
		}

		if (!response.ok) {
			// Other errors (rate limit, server error, etc.)
			console.error(`GitHub org membership API error: ${response.status}`);
			return { isAdmin: false, error: "github_api_error" };
		}

		const membership = (await response.json()) as GitHubOrgMembership;

		// Check if user is an admin with active state
		const isAdmin = membership.role === "admin" && membership.state === "active";

		// Store in KV cache with TTL
		await env.ORG_MEMBERSHIP_CACHE.put(
			cacheKey,
			isAdmin ? "admin" : "member",
			{ expirationTtl: ORG_MEMBERSHIP_CACHE_TTL }
		);

		return { isAdmin };
	} catch (error) {
		console.error("GitHub org membership API error:", error);
		return { isAdmin: false, error: "github_api_error" };
	}
}

/**
 * Request device code from GitHub for OAuth device flow
 * @param clientId GitHub OAuth app client ID
 * @param scope OAuth scopes to request (default: "read:user")
 * @returns Device code response or null on error
 */
export async function requestDeviceCode(
	clientId: string,
	scope = "read:user"
): Promise<{
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
} | null> {
	try {
		const response = await fetch(
			"https://github.com/login/device/code",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					client_id: clientId,
					scope,
				}),
			}
		);

		if (!response.ok) {
			return null;
		}

		return await response.json();
	} catch (error) {
		console.error("GitHub device code request error:", error);
		return null;
	}
}

/**
 * Clear token from cache (useful for testing or explicit invalidation)
 * @param token GitHub OAuth token
 * @param env Cloudflare Worker environment bindings
 */
export async function clearTokenCache(
	token: string,
	env: { TOKEN_CACHE: KVNamespace }
): Promise<void> {
	const cacheKey = await hashToken(token);
	await env.TOKEN_CACHE.delete(cacheKey);
}