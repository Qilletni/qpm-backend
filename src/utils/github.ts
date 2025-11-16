/**
 * GitHub API integration utilities
 */

import type { GitHubUser } from "../types";

const GITHUB_API_BASE = "https://api.github.com";
const TOKEN_CACHE_TTL = 15 * 60; // 15 minutes in seconds (for KV expirationTtl)

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
 * Validate GitHub token and get user info
 * Uses KV cache to avoid hitting GitHub API on every request (15 minute TTL)
 * @param token GitHub OAuth token
 * @param env Cloudflare Worker environment bindings
 * @returns GitHub user object or null if invalid
 */
export async function validateGitHubToken(
	token: string,
	env: { TOKEN_CACHE: KVNamespace }
): Promise<GitHubUser | null> {
	// Create secure cache key by hashing the token
	const cacheKey = await hashToken(token);

	// Check KV cache
	const cachedData = await env.TOKEN_CACHE.get(cacheKey, "json");
	if (cachedData) {
		return cachedData as GitHubUser;
	}

	// Fetch from GitHub API
	try {
		const response = await fetch(`${GITHUB_API_BASE}/user`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "qpm-registry/1.0.0",
				Accept: "application/vnd.github.v3+json",
			},
		});

		if (!response.ok) {
			// Clear cache on error
			await env.TOKEN_CACHE.delete(cacheKey);
			return null;
		}

		const user = (await response.json()) as GitHubUser;

		// Store in KV cache with TTL
		await env.TOKEN_CACHE.put(cacheKey, JSON.stringify(user), {
			expirationTtl: TOKEN_CACHE_TTL,
		});

		return user;
	} catch (error) {
		console.error("GitHub API error:", error);
		return null;
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