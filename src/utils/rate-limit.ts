/**
 * Production-ready rate limiting utilities using Cloudflare Durable Objects
 *
 * Rate limiting policy:
 * - 10 uploads per hour per IP address
 * - Persistent state across worker restarts
 * - Distributed consistency per IP
 *
 * Reference: https://developers.cloudflare.com/durable-objects/examples/build-a-rate-limiter/
 */

import type { Env } from "../types";
import type { RateLimiter } from "../durable-objects/RateLimiter";

/**
 * Get Durable Object stub for the given IP address
 */
function getRateLimiterStub(env: Env, ip: string): DurableObjectStub<RateLimiter> {
	// Create a consistent ID from the IP address
	const id = env.RATE_LIMITER.idFromName(ip);
	return env.RATE_LIMITER.get(id);
}

/**
 * Check if IP has exceeded rate limit for uploads
 * @param env Worker environment bindings
 * @param ip IP address (from CF-Connecting-IP header)
 * @returns Object indicating if rate limited and remaining requests
 */
export async function checkUploadRateLimit(
	env: Env,
	ip: string
): Promise<{
	allowed: boolean;
	remaining: number;
	resetAt: number;
}> {
	const stub = getRateLimiterStub(env, ip);
	return stub.checkLimit();
}

/**
 * Increment upload count for IP
 * Should be called after successful upload
 * @param env Worker environment bindings
 * @param ip IP address (from CF-Connecting-IP header)
 */
export async function incrementUploadCount(env: Env, ip: string): Promise<void> {
	const stub = getRateLimiterStub(env, ip);
	await stub.increment();
}

/**
 * Reset rate limit for IP (useful for testing or admin override)
 * @param env Worker environment bindings
 * @param ip IP address (from CF-Connecting-IP header)
 */
export async function resetIPRateLimit(env: Env, ip: string): Promise<void> {
	const stub = getRateLimiterStub(env, ip);
	await stub.reset();
}

/**
 * Get current rate limit status for IP (for debugging/monitoring)
 * @param env Worker environment bindings
 * @param ip IP address (from CF-Connecting-IP header)
 */
export async function getRateLimitStatus(
	env: Env,
	ip: string
): Promise<{
	count: number;
	resetAt: number;
	remaining: number;
} | null> {
	const stub = getRateLimiterStub(env, ip);
	return stub.getStatus();
}
