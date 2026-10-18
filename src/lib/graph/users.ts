import "server-only";
import { graphFetch } from "./client";

/**
 * Finding and inviting people in the Ankor'd tenant. Delegated, like the rest
 * of Graph: an admin can only invite if their own directory role allows it.
 */

export type DirectoryUser = {
  id: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
};

/** OData string literals escape a single quote by doubling it. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The person with this address in the tenant, member or guest, if there is one. */
export async function findDirectoryUser(
  token: string,
  email: string,
): Promise<DirectoryUser | null> {
  const address = email.trim().toLowerCase();
  // mail and userPrincipalName are both in the basic profile, so this works
  // with the User.ReadBasic.All the CRM already holds. A guest's mail is their
  // own address; a member's UPN is usually their Ankor'd one.
  const filter = `mail eq ${literal(address)} or userPrincipalName eq ${literal(address)}`;
  const result = await graphFetch<{ value: DirectoryUser[] }>(
    token,
    `/users?$filter=${encodeURIComponent(filter)}&$select=id,displayName,mail,userPrincipalName`,
  );
  return result.value[0] ?? null;
}

export const isGuestPrincipal = (user: DirectoryUser) =>
  (user.userPrincipalName ?? "").includes("#EXT#");

export type Invitation = {
  invitedUser: { id: string };
  inviteRedeemUrl: string;
  status: string;
};

/**
 * Invites someone from outside Ankor'd as a B2B guest. They sign in with their
 * own email — no Ankor'd licence and no password the CRM ever sees — and land
 * on the CRM once they have accepted.
 */
export function inviteGuest(
  token: string,
  opts: { email: string; displayName: string; redirectUrl: string; sendEmail: boolean },
): Promise<Invitation> {
  return graphFetch<Invitation>(token, "/invitations", {
    method: "POST",
    body: JSON.stringify({
      invitedUserEmailAddress: opts.email,
      invitedUserDisplayName: opts.displayName,
      inviteRedirectUrl: opts.redirectUrl,
      sendInvitationMessage: opts.sendEmail,
      invitedUserType: "Guest",
    }),
  });
}
