import { unzipSync } from "fflate";

/**
 * Represents a dependency in the qll.info format
 * Format can be:
 * - String: "version:@scope/package" or "^version:@scope/package"
 * - Object: { name: "@scope/package", version: "^1.0.0" }
 */
type DependencyEntry = string | { name: string; version: string };

/**
 * Structure of qll.info JSON file inside .qll packages
 */
interface QllInfo {
	name: string;
	version: string;
	author?: string;
	description?: string;
	sourceUrl?: string;
	dependencies?: DependencyEntry[];
	providerClass?: string;
	nativeBindFactoryClass?: string;
	musicStrategies?: string;
	nativeClasses?: string[];
	autoImportFiles?: string[];
}

/**
 * Extracts dependencies from a .qll package file
 * @param packageData The package file as ArrayBuffer
 * @returns Record of package name to version constraint
 * @throws Error if package is invalid or qll.info cannot be found/parsed
 */
export async function extractDependencies(
	packageData: ArrayBuffer
): Promise<Record<string, string>> {
	try {
		// Convert ArrayBuffer to Uint8Array for fflate
		const uint8Array = new Uint8Array(packageData);

		// Unzip the package
		const unzipped = unzipSync(uint8Array);

		// Find qll.info file (could be at root or in subdirectories)
		let qilletniInfoContent: Uint8Array | null = null;
		let foundPath: string | null = null;

		for (const [path, content] of Object.entries(unzipped)) {
			// Look for qll.info file (case-insensitive)
			if (path.toLowerCase().endsWith("qll.info")) {
				qilletniInfoContent = content;
				foundPath = path;
				break;
			}
		}

		if (!qilletniInfoContent) {
			throw new Error(
				"qll.info not found in package. Valid .qll packages must contain a qll.info file."
			);
		}

		// Convert Uint8Array to string
		const textDecoder = new TextDecoder();
		const jsonString = textDecoder.decode(qilletniInfoContent);

		// Parse JSON
		const qllInfo: QllInfo = JSON.parse(jsonString);

		// Extract and convert dependencies
		const dependencies: Record<string, string> = {};

		if (qllInfo.dependencies && Array.isArray(qllInfo.dependencies)) {
			for (const dep of qllInfo.dependencies) {
				if (typeof dep === "string") {
					// Format: "version:@scope/package" or "^1.0.0:@scope/package"
					const colonIndex = dep.indexOf(":");
					if (colonIndex === -1) {
						console.warn(`Invalid dependency format: ${dep}`);
						continue;
					}

					const version = dep.substring(0, colonIndex);
					const packageName = dep.substring(colonIndex + 1);

					dependencies[packageName] = version;
				} else if (typeof dep === "object" && dep.name && dep.version) {
					// Format: { name: "@scope/package", version: "^1.0.0" }
					dependencies[dep.name] = dep.version;
				} else {
					console.warn(`Unknown dependency format:`, dep);
				}
			}
		}

		return dependencies;
	} catch (error) {
		if (error instanceof Error) {
			// Re-throw with more context
			throw new Error(`Failed to extract dependencies from package: ${error.message}`);
		}
		throw new Error("Failed to extract dependencies from package: Unknown error");
	}
}

/**
 * Extracts the full qll.info metadata from a package
 * @param packageData The package file as ArrayBuffer
 * @returns The parsed QllInfo object
 * @throws Error if package is invalid or qll.info cannot be found/parsed
 */
export async function extractQllInfo(packageData: ArrayBuffer): Promise<QllInfo> {
	try {
		const uint8Array = new Uint8Array(packageData);
		const unzipped = unzipSync(uint8Array);

		let qilletniInfoContent: Uint8Array | null = null;

		for (const [path, content] of Object.entries(unzipped)) {
			if (path.toLowerCase().endsWith("qll.info")) {
				qilletniInfoContent = content;
				break;
			}
		}

		if (!qilletniInfoContent) {
			throw new Error(
				"qll.info not found in package. Valid .qll packages must contain a qll.info file."
			);
		}

		const textDecoder = new TextDecoder();
		const jsonString = textDecoder.decode(qilletniInfoContent);

		return JSON.parse(jsonString);
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Failed to extract qll.info from package: ${error.message}`);
		}
		throw new Error("Failed to extract qll.info from package: Unknown error");
	}
}
