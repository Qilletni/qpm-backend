import {isAdmin} from "./permissions";
import {normalizeScope} from "./validation";
import {validateOrgMembership} from "./github";
import {AppContext, AuthenticatedIdentity} from "../types";

/**
 * Checks if the requesting identity has sufficient permissions to perform an action on the given scope.
 * Supports both user tokens (OAuth/PAT) and installation tokens (GITHUB_TOKEN).
 *
 * @param c        The app context
 * @param identity The authenticated identity (user or installation)
 * @param scope    The scope of the package (username or organization name)
 * @param token    The token (only used for org membership validation with user tokens)
 */
export async function checkPermissions(c: AppContext, identity: AuthenticatedIdentity, scope: string, token: string): Promise<Response | undefined> {
    const normalizedScope = normalizeScope(scope);

    // Check if identity is a global admin (only for user tokens with userId)
    if (identity.type === 'user' && identity.userId) {
        const identityIsAdmin = await isAdmin(identity.userId, c.env);
        if (identityIsAdmin) {
            return undefined; // Admin has access to everything
        }
    }

    // Check if scope matches authenticated identity
    if (identity.scope === normalizedScope) {
        return undefined; // Identity matches scope, allow access
    }

    // For user tokens, check organization membership
    if (identity.type === 'user') {
        const orgCheck = await validateOrgMembership(
            token,
            identity.scope, // Use scope (normalized username)
            normalizedScope,
            c.env
        );

        if (orgCheck.error === "insufficient_permissions") {
            return Response.json(
                {
                    success: false,
                    error: "insufficient_permissions",
                    message: "Cannot verify organization membership. Please re-authenticate with 'read:org' scope: qpm login",
                },
                {status: 403}
            );
        }

        if (!orgCheck.isAdmin) {
            return Response.json(
                {
                    success: false,
                    error: "forbidden",
                    message: `Package scope @${normalizedScope} does not match your GitHub username (@${identity.scope}) and you are not an admin of an organization named '${normalizedScope}'. Visit https://github.com/orgs/${normalizedScope}/people to verify your role.`,
                },
                {status: 403}
            );
        }

        // User is an org admin, allow access
        return undefined;
    }

    // For installation tokens, deny access to other scopes
    // Installation tokens can only publish to their owner's scope
    if (identity.type === 'installation') {
        return Response.json(
            {
                success: false,
                error: "installation_scope_mismatch",
                message: `Installation token can only publish to @${identity.scope}/* packages. Requested: @${normalizedScope}/*`
            },
            {status: 403}
        );
    }

    // Should not reach here, but return forbidden as fallback
    return Response.json(
        {
            success: false,
            error: "forbidden",
            message: `Insufficient permissions to publish to @${normalizedScope}/*`
        },
        {status: 403}
    );
}