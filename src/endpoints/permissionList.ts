/**
 * Permission list endpoint
 * GET /permissions/:user
 * Requires admin authentication
 */

import { OpenAPIRoute, Str, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { ErrorResponse } from "../types";
import { validateGitHubToken } from "../utils/github";
import { extractBearerToken } from "../utils/validation";
import { isAdmin, getUserPermissions } from "../utils/permissions";

// Success response schema
const PermissionListResponse = z.object({
	success: z.literal(true),
	user: z.number({
		description: "GitHub user ID"
	}),
	permissions: z.array(Str()).describe("Array of permission names"),
});

export class PermissionList extends OpenAPIRoute {
	schema = {
		tags: ["Permissions"],
		summary: "List user permissions",
		description:
			"Get the list of all permissions for a user by their GitHub user ID. Only admins can use this endpoint.",
		request: {
			params: z.object({
				user: Str({
					description: "GitHub user ID (numeric)",
					example: "12345",
				}),
			}),
			headers: z.object({
				authorization: z
					.string()
					.describe("Bearer token from GitHub OAuth (must be admin)"),
			}),
		},
		responses: {
			"200": {
				description: "Permissions retrieved successfully",
				...contentJson(PermissionListResponse),
			},
			"401": {
				description: "Unauthorized - Invalid or missing token",
				...contentJson(ErrorResponse),
			},
			"403": {
				description: "Forbidden - Requester is not an admin",
				...contentJson(ErrorResponse),
			},
			"400": {
				description: "Bad Request - Invalid user ID format",
				...contentJson(ErrorResponse),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { user: userIdStr } = data.params;

		// Step 1: Authenticate the requester
		const authHeader = data.headers.authorization;
		const token = extractBearerToken(authHeader);

		if (!token) {
			return Response.json(
				{
					success: false,
					error: "unauthorized",
					message: "Missing or invalid Authorization header",
				},
				{ status: 401 }
			);
		}

		const requester = await validateGitHubToken(token, c.env);
		if (!requester) {
			return Response.json(
				{
					success: false,
					error: "unauthorized",
					message: "Invalid or expired authentication token",
				},
				{ status: 401 }
			);
		}

		// Step 2: Check if requester is an admin
		const requesterIsAdmin = await isAdmin(requester.id, c.env);
		if (!requesterIsAdmin) {
			return Response.json(
				{
					success: false,
					error: "forbidden",
					message: "Only admins can view user permissions",
				},
				{ status: 403 }
			);
		}

		// Step 3: Parse and validate target user ID
		const userId = parseInt(userIdStr, 10);
		if (isNaN(userId) || userId <= 0) {
			return Response.json(
				{
					success: false,
					error: "bad_request",
					message: "User ID must be a positive integer",
				},
				{ status: 400 }
			);
		}

		// Step 4: Get user permissions
		const permissions = await getUserPermissions(userId, c.env);

		// Step 5: Return the permissions
		return Response.json(
			{
				success: true,
				user: userId,
				permissions: permissions,
			},
			{ status: 200 }
		);
	}
}
