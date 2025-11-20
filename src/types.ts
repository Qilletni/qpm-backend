import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

// Cloudflare Worker environment bindings
export interface Env {
	PACKAGES: R2Bucket;
	RATE_LIMITER: DurableObjectNamespace;
	PERMISSIONS: KVNamespace;
	TOKEN_CACHE: KVNamespace;
	ORG_MEMBERSHIP_CACHE: KVNamespace;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	JWT_SECRET?: string;
}

export type AppContext = Context<{ Bindings: Env }>;

// Package metadata schema (stored in R2 as metadata.json)
export const PackageMetadata = z.object({
	name: Str({
		example: "@alice/postgres",
		description: "Full package name with scope"
	}),
	version: Str({
		example: "1.0.0",
		description: "Package version"
	}),
	integrity: Str({
		example: "sha256-abc123def456...",
		description: "SHA-256 integrity hash (base64)"
	}),
	size: z.number({
		// example: "1024000",
		description: "Package size in bytes"
	}),
	uploadedAt: DateTime({
		description: "Upload timestamp (ISO 8601)"
	}),
	uploadedBy: Str({
		example: "alice",
		description: "Username of uploader"
	}),
	dependencies: z.record(Str()).optional().describe("Package dependencies"),
});

export type PackageMetadataType = z.infer<typeof PackageMetadata>;

// Version info for index.json
export const VersionInfo = z.object({
	version: Str({ example: "1.0.0" }),
	integrity: Str({ example: "sha256-abc123..." }),
	size: z.number({  }),
	uploadedAt: DateTime(),
	dependencies: z.record(Str()).optional().describe("Package dependencies"),
});

export type VersionInfoType = z.infer<typeof VersionInfo>;

// Package index schema (stored in R2 as index.json)
export const PackageIndex = z.object({
	name: Str({
		example: "@alice/postgres",
		description: "Full package name with scope"
	}),
	versions: z.array(VersionInfo).describe("List of all published versions"),
});

export type PackageIndexType = z.infer<typeof PackageIndex>;

// Package list response (for GET /packages/@scope/package)
export const PackageListResponse = z.object({
	name: Str({ example: "@alice/postgres" }),
	versions: z.array(Str()).describe("Array of version strings"),
	latest: Str({
		example: "2.0.0",
		description: "Latest version (highest semver)"
	}),
});

// Upload success response
export const UploadSuccessResponse = z.object({
	success: z.boolean().describe("Always true for success"),
	package: z.object({
		name: Str({ example: "@alice/postgres" }),
		version: Str({ example: "1.0.0" }),
		integrity: Str({ example: "sha256-abc123..." }),
		size: z.number({}),
	}),
});

// Error response schema
export const ErrorResponse = z.object({
	success: z.literal(false),
	error: Str({
		example: "unauthorized",
		description: "Error code"
	}),
	message: Str({
		example: "Invalid or missing authentication token",
		description: "Human-readable error message"
	}),
});

// OAuth device flow request
export const DeviceCodeRequest = z.object({
	scope: Str({
		example: "read:user read:org",
		required: false,
		description: "OAuth scopes to request"
	}).optional(),
});

// OAuth device flow response (from GitHub)
export const DeviceCodeResponse = z.object({
	device_code: Str({ description: "Device code for polling" }),
	user_code: Str({
		example: "ABCD-1234",
		description: "Code for user to enter"
	}),
	verification_uri: Str({
		example: "https://github.com/login/device",
		description: "URL for user to visit"
	}),
	expires_in: z.number({
		// example: 900,
		description: "Expiration time in seconds"
	}),
	interval: z.number({
		// example: 5,
		description: "Polling interval in seconds"
	}),
});

// GitHub user info (from API)
export interface GitHubUser {
	login: string;
	id: number;
	avatar_url: string;
	type: string;
	name?: string;
	email?: string;
}

// GitHub organization membership info (from API)
// GET /orgs/{org}/memberships/{username}
export interface GitHubOrgMembership {
	role: "admin" | "member";
	state: "active" | "pending";
	organization: {
		login: string;
		id: number;
	};
	user: {
		login: string;
		id: number;
	};
}

// Package list item for registry-wide listing
export const PackageListItem = z.object({
	name: Str({
		example: "@alice/postgres",
		description: "Full package name with scope"
	}),
	latest: Str({
		example: "1.0.2",
		description: "Latest version"
	}).optional(),
	versionCount: z.number({
		description: "Number of published versions"
	}).optional(),
});

// Registry-wide package list response (for GET /packages)
export const PackageRegistryListResponse = z.object({
	packages: z.array(PackageListItem).describe("Array of all packages in registry"),
	total: z.number({description: "Total number of packages"}),
});

// Delete version response
export const DeleteVersionResponse = z.object({
	success: z.literal(true),
	deleted: z.object({
		name: Str({ example: "@alice/postgres" }),
		version: Str({ example: "1.0.0" }),
	}),
	warning: z.object({
		dependents: z.array(Str()).describe("Packages that depend on this version"),
		message: Str({
			example: "This version is used by 2 other packages",
			description: "Warning message about dependents"
		}),
	}).optional(),
});
