/**
 * Production-ready Rate Limiter using Cloudflare Durable Objects
 *
 * Implements IP-based rate limiting for package uploads:
 * - 10 uploads per hour per IP address
 * - Persistent state across worker restarts
 * - Distributed consistency per IP
 */

import { DurableObject } from "cloudflare:workers";

interface RateLimitData {
	count: number;
	resetAt: number; // timestamp in milliseconds
}

export class RateLimiter extends DurableObject {
	private readonly UPLOAD_LIMIT = 10;
	private readonly WINDOW_MS = 60 * 60 * 1000; // 1 hour

	/**
	 * Check if the IP has exceeded the rate limit
	 */
	async checkLimit(): Promise<{
		allowed: boolean;
		remaining: number;
		resetAt: number;
	}> {
		const now = Date.now();
		const data = await this.ctx.storage.get<RateLimitData>("rateLimit");

		// If no data exists or window has expired, allow the request
		if (!data || now >= data.resetAt) {
			return {
				allowed: true,
				remaining: this.UPLOAD_LIMIT - 1, // Assuming this check is followed by increment
				resetAt: now + this.WINDOW_MS,
			};
		}

		// Check if limit has been exceeded
		const allowed = data.count < this.UPLOAD_LIMIT;
		const remaining = Math.max(0, this.UPLOAD_LIMIT - data.count);

		return {
			allowed,
			remaining,
			resetAt: data.resetAt,
		};
	}

	/**
	 * Increment the upload count for this IP
	 */
	async increment(): Promise<void> {
		const now = Date.now();
		const data = await this.ctx.storage.get<RateLimitData>("rateLimit");

		// If no data exists or window has expired, start a new window
		if (!data || now >= data.resetAt) {
			const resetAt = now + this.WINDOW_MS;
			await this.ctx.storage.put<RateLimitData>("rateLimit", {
				count: 1,
				resetAt,
			});

			// Set alarm to clean up expired data
			await this.ctx.storage.setAlarm(resetAt + 1000); // 1 second after reset
			return;
		}

		// Increment the count
		await this.ctx.storage.put<RateLimitData>("rateLimit", {
			count: data.count + 1,
			resetAt: data.resetAt,
		});
	}

	/**
	 * Reset the rate limit for this IP (admin override)
	 */
	async reset(): Promise<void> {
		await this.ctx.storage.delete("rateLimit");
		await this.ctx.storage.deleteAlarm();
	}

	/**
	 * Get the current rate limit status for this IP
	 */
	async getStatus(): Promise<{
		count: number;
		resetAt: number;
		remaining: number;
	} | null> {
		const now = Date.now();
		const data = await this.ctx.storage.get<RateLimitData>("rateLimit");

		if (!data || now >= data.resetAt) {
			return null;
		}

		return {
			count: data.count,
			resetAt: data.resetAt,
			remaining: Math.max(0, this.UPLOAD_LIMIT - data.count),
		};
	}

	/**
	 * Alarm handler for automatic cleanup of expired entries
	 */
	async alarm(): Promise<void> {
		const now = Date.now();
		const data = await this.ctx.storage.get<RateLimitData>("rateLimit");

		// If data has expired, clean it up
		if (data && now >= data.resetAt) {
			await this.ctx.storage.delete("rateLimit");
		}
	}

    __DURABLE_OBJECT_BRAND: never;
}
