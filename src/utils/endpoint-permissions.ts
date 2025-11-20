import {isAdmin} from "./permissions";
import {normalizeScope} from "./validation";
import {validateOrgMembership} from "./github";
import {AppContext, GitHubUser} from "../types";

/**
 * Checks if the requesting user has insufficient permissions to perform an action on the given scope.
 *
 * @param c    The app context
 * @param user The user making the request
 * @param scope The scope of the package (username or organization name)
 * @param token The user's token
 */
export async function checkPermissions(c: AppContext, user: GitHubUser, scope: string, token: string): Promise<Response | undefined> {
    const userIsAdmin = await isAdmin(user.id, c.env);
    if (!userIsAdmin) {
        const normalizedUsername = normalizeScope(user.login);

        // Check if scope matches user's username
        if (scope !== normalizedUsername) {
            // Scope doesn't match username, check if it's an org
            const orgCheck = await validateOrgMembership(
                token,
                user.login,
                scope,
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
                        message: `Package scope @${scope} does not match your GitHub username (@${user.login}) and you are not an admin of an organization named '${scope}'. Visit https://github.com/orgs/${scope}/people to verify your role.`,
                    },
                    {status: 403}
                );
            }

            // User is an org admin, proceed with upload
        }
    }

    return undefined;
}