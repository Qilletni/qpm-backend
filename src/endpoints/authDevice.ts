/**
 * OAuth device flow endpoint
 * POST /auth/device/code
 * Initiates GitHub OAuth device flow
 */

import { OpenAPIRoute, contentJson } from "chanfana";
import type { AppContext } from "../types";
import {
	DeviceCodeRequest,
	DeviceCodeResponse,
	ErrorResponse,
} from "../types";
import { requestDeviceCode } from "../utils/github";

export class AuthDevice extends OpenAPIRoute {
	schema = {
		tags: ["Authentication"],
		summary: "Initiate OAuth device flow",
		description:
			"Start the GitHub OAuth device flow for CLI authentication. Returns device code and user code for authorization.",
		request: {
			body: contentJson(DeviceCodeRequest),
		},
		responses: {
			"200": {
				description: "Device code response",
				...contentJson(DeviceCodeResponse),
			},
			"500": {
				description: "Internal server error",
				...contentJson(ErrorResponse),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const scope = data.body?.scope || "read:user";

		// Request device code from GitHub
		const result = await requestDeviceCode(c.env.GITHUB_CLIENT_ID, scope);

		if (!result) {
			return Response.json(
				{
					success: false,
					error: "internal_error",
					message: "Failed to request device code from GitHub",
				},
				{ status: 500 }
			);
		}

		// Return GitHub's response directly
		return result;
	}
}