/**
 * The folder structure created inside a new client folder in SharePoint.
 *
 * Lives outside the `"use server"` modules so the settings form, the settings
 * action and the provisioning action can all import it — a `"use server"` file
 * may only export async functions.
 *
 * The convention is stored in settings rather than here, so changing it does
 * not need a deploy. These values are only the starting point.
 */

export const DEFAULT_CLIENT_FOLDERS = [
  "01 Agreements & Scopes",
  "02 Delivery & Tracking",
  "04 SEO & Store",
  "05 Reports & Handover",
] as const;

export const DEFAULT_CLIENT_FOLDER_TEXT = DEFAULT_CLIENT_FOLDERS.join("\n");

/**
 * One folder per line, in the order they should be created.
 *
 * `null` means the setting has never been touched, so the default applies. An
 * empty string is a deliberate choice and means no subfolders at all — the
 * client folder is created bare.
 */
export function parseFolderTemplate(value: string | null | undefined): string[] {
  if (value === null || value === undefined) return [...DEFAULT_CLIENT_FOLDERS];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
