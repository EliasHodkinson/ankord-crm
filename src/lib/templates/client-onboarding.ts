/**
 * Project templates. A new project can start from one of these, which creates
 * the phases and steps ready to work through and tick off.
 *
 * "Client onboarding & system migration" is Ankor'd's own runbook, generalised
 * from real engagements — the sequence, the warnings and the order of
 * operations are the parts worth keeping.
 */

export type TemplateLink = { url: string; label: string };

export type TemplateStep = {
  title: string;
  tag: string | null;
  ownerLabel: string | null;
  description: string | null;
  warning: string | null;
  links: TemplateLink[];
  position: number;
};

export type TemplatePhase = {
  num: string;
  label: string;
  description: string | null;
  accent: string | null;
  position: number;
  steps: TemplateStep[];
};

export type ProjectTemplate = {
  key: string;
  name: string;
  description: string;
  phases: TemplatePhase[];
};

export const clientOnboarding: ProjectTemplate = {
  "key": "client-onboarding",
  "name": "Client onboarding & system migration",
  "description": "Taking over a client's Microsoft 365 tenant, domain and website from an incumbent provider, and handing genuine ownership back to them.",
  "phases": [
    {
      "num": "01",
      "label": "Engagement & Groundwork",
      "description": "Get the authority, the identities and the baseline in place before touching a live system.",
      "accent": "#33B4E5",
      "position": 0,
      "steps": [
        {
          "title": "Confirm scope and get written authority to act",
          "tag": "REQUIRED",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Before contacting the incumbent licensing provider or the incumbent IT provider, get written confirmation from the client's decision makers authorising Ankor'd to act on the client behalf.\n\nWhat to capture:\n\n1. Signed engagement / scope covering the three workstreams — M365 tenant and licensing, domain migration, website rebuild\n2. An authority-to-act statement naming Ankor'd, that can be forwarded to the incumbent licensing provider and the incumbent IT provider\n3. Confirmation of who at the client can approve decisions and spend\n4. Agreed priority order — website first, then M365 access, then domains\n\nBoth the incumbent licensing provider and the incumbent IT provider will almost certainly ask for proof of authority before releasing anything. Having it ready in writing removes days from the process.",
          "warning": "Do not start requesting credentials from third parties without this. It stalls the request and creates an awkward conversation with the incumbent provider.",
          "links": [],
          "position": 0
        },
        {
          "title": "Establish the neutral owner identity (neutral personal mailbox)",
          "tag": "FOUNDATION",
          "ownerLabel": "Client decision makers",
          "description": "Confirm or create a neutral personal mailbox belonging to the client's decision makers. This becomes the root identity for the domain registrar and any other account that sits above the domain.\n\nWhy this matters: never use an address on the client's own domain as the login for the account that controls the client's domain. If the domain or the mailbox breaks, you are locked out of the exact system you need in order to fix it.\n\nSet-up checklist:\n\n1. Confirm which address they want to use, or create a new one specifically for the purpose\n2. Enable 2-Step Verification and record the method (authenticator app strongly preferred over SMS)\n3. Record the recovery email and recovery phone — make sure both are personal, not company-domain\n4. Save the recovery / backup codes into the password vault\n5. Confirm both directors can access it, not just one person\n6. Record it in the account register\n\nThis single account underpins the whole domain workstream. Get it solid before Phase 03.",
          "warning": "Do not skip 2FA and do not let this sit under one director only. If the sole holder is unreachable, the domain becomes unrecoverable.",
          "links": [
            {
              "url": "https://myaccount.google.com/security",
              "label": "Google Account Security"
            }
          ],
          "position": 1
        },
        {
          "title": "Create client record and the password vault shared folder",
          "tag": "ADMIN",
          "ownerLabel": "Ankor'd",
          "description": "Set up the client properly inside Ankor'd systems before credentials start arriving, so nothing gets parked in an email thread or a notes app.\n\n1. Create the client record in the Ankor'd PSA / ticketing system\n2. Create a dedicated the password vault shared folder for the client\n3. Decide the folder structure now — for example: Microsoft 365, Domains and DNS, Website and Hosting, Third Party and Billing\n4. Set permissions so the folder can later be shared with the client's decision makers directly\n5. Create the project or job for tracking time against the three workstreams\n\nEvery credential captured in the Account Register on this project should also land in the password vault. The CRM is the working tracker; the password vault is the vault.",
          "warning": null,
          "links": [],
          "position": 2
        },
        {
          "title": "Capture all key contacts and their role in the migration",
          "tag": "ADMIN",
          "ownerLabel": "Ankor'd",
          "description": "Fill out the key contacts list on this project with full details for everyone involved.\n\nAt minimum:\n\n• the client — the client, director / decision maker\n• the client — the client, director / decision maker\n• their account manager — the incumbent licensing provider, holds the M365 Global Admin and licensing\n• their technical contact — the incumbent IT provider, holds the old DNS host, domains and the old website\n• Ankor'd project lead\n\nFor each: full name, role, direct email, direct phone, and what specifically you need from them. Note the best contact method — some of these handovers move much faster on a phone call than an email.",
          "warning": null,
          "links": [],
          "position": 3
        },
        {
          "title": "Baseline audit — record exactly what exists today",
          "tag": "CRITICAL",
          "ownerLabel": "Ankor'd",
          "description": "Document the current state before anything changes. This is your rollback reference and the backbone of the final handover document.\n\nCapture and screenshot:\n\nDomain\n• WHOIS for the client's domain — registrar, registrant name and ABN, expiry date, lock status\n• Any other domains the client own or have owned (.com, .net.au, old trading names, campaign domains)\n\nDNS\n• Full record list from whatever is authoritative today — A, AAAA, CNAME, MX, TXT, SRV, NS\n• Note the current nameservers\n\nMicrosoft 365\n• Tenant ID and the default .onmicrosoft.com domain\n• Verified custom domains\n• Licence SKUs and counts, and current billing arrangement\n• User list and mailbox list\n\nWebsite\n• What resolves today, what error is shown, whether hosting is still active\n• Any old URLs recoverable from search results or archives\n\nMail flow\n• Send a test to info on the client's own domain and confirm delivery works today, so you can prove whether the migration broke anything later\n\nAttach screenshots to this step. Assume you will need to prove what the configuration looked like before you touched it.",
          "warning": "Do this before requesting any change from the incumbent licensing provider or the incumbent IT provider. Once access starts moving, the original configuration can disappear without warning.",
          "links": [
            {
              "url": "https://whois.auda.org.au/",
              "label": "auDA WHOIS lookup"
            },
            {
              "url": "https://mxtoolbox.com/SuperTool.aspx",
              "label": "MXToolbox — DNS & mail check"
            }
          ],
          "position": 4
        }
      ]
    },
    {
      "num": "02",
      "label": "Microsoft 365 & Licensing",
      "description": "Recover Global Admin from the incumbent licensing provider, then move licensing onto Ankor'd.",
      "accent": "#5B8DEF",
      "position": 1,
      "steps": [
        {
          "title": "Contact the incumbent licensing provider — request GA handover",
          "tag": "BLOCKER",
          "ownerLabel": "Ankor'd → their account manager (the incumbent licensing provider)",
          "description": "the client M365 licensing currently sits with the the incumbent licensing provider, and the client do not hold their own Global Administrator account. Everything in this phase is blocked until that changes, so open this conversation on day one.\n\nWhat to ask their account manager for:\n\n1. The Global Administrator credentials for the client tenant, or confirmation that a new GA will be created for the client\n2. The tenant ID and the default .onmicrosoft.com domain\n3. A full list of current subscriptions — SKU, quantity, term, renewal date and current cost\n4. The billing arrangement and next invoice date\n5. Confirmation of what is required from the incumbent licensing provider to release the licensing to another partner\n6. Details of any the incumbent licensing provider admin accounts or partner relationships currently in the tenant\n\nInclude the written authority from Phase 01 Step 01 in the first email so it is not requested back and forth.\n\nRecord the date requested, who you spoke to and what was promised in the notes below. Follow up by phone if there is no response within two business days — this is the long pole in the engagement.",
          "warning": "Expect this to take longer than you want. Chase it early and keep a dated record of every request, because it gates the whole M365 workstream.",
          "links": [],
          "position": 0
        },
        {
          "title": "Verify tenant identity and licence position before changing anything",
          "tag": "VERIFY",
          "ownerLabel": "Ankor'd",
          "description": "Once you have access, confirm you are in the right tenant and understand what is actually being paid for.\n\nVerify and record:\n\n• Tenant ID (GUID) and default .onmicrosoft.com domain\n• All verified custom domains — confirm the client's domain is verified and healthy\n• Every subscription: product name, SKU, assigned vs purchased quantity, term, renewal date\n• Which subscriptions are actually in use versus paid for and idle\n• Current partner of record / reseller relationship\n• Billing contact and payment method on file\n\nA licence audit at this point often finds unused seats. Flag anything the client are paying for and not using — it is an easy early win to raise with the client's decision makers, and it needs deciding before the licences move to Ankor'd.",
          "warning": null,
          "links": [
            {
              "url": "https://admin.microsoft.com",
              "label": "Microsoft 365 Admin Centre"
            }
          ],
          "position": 1
        },
        {
          "title": "Receive and immediately secure the Global Admin account",
          "tag": "CRITICAL",
          "ownerLabel": "Ankor'd",
          "description": "The moment you receive GA credentials, secure them. Assume the password has been shared over email or verbally and treat it as compromised until rotated.\n\nDo all of this in the first session:\n\n1. Sign in and confirm access works\n2. Reset the password to a strong unique value generated in the password vault\n3. Enable MFA on the account — authenticator app, not SMS\n4. Check and correct the recovery email and phone so they point at the client or Ankor'd, not the incumbent licensing provider\n5. Review the alternate email address on the account\n6. Store the credentials, MFA recovery codes and recovery details in the client the password vault folder\n7. Record the account in the account register\n8. Check sign-in logs for anything unexpected\n\nDo not leave this account on its original password overnight.",
          "warning": "Until this is rotated and MFA-protected, an unknown number of people at a third party can log in as a Global Administrator of the client tenant.",
          "links": [
            {
              "url": "https://entra.microsoft.com",
              "label": "Microsoft Entra Admin Centre"
            }
          ],
          "position": 2
        },
        {
          "title": "Create dedicated admin accounts — client GA, Ankor'd, break-glass",
          "tag": "REQUIRED",
          "ownerLabel": "Ankor'd",
          "description": "Do not keep using the inherited the incumbent licensing provider-created account as the day-to-day administrator. Build a clean admin structure.\n\nCreate:\n\n1. A client-held Global Administrator for the client — this is the account the client's decision makers own and that proves they control their own tenant\n2. An Ankor'd administrative account for ongoing support (or rely on GDAP from Step 07 — decide which model you are using and be consistent)\n3. A break-glass / emergency access account: cloud-only, licence-free where possible, excluded from Conditional Access, very long password split and stored securely, MFA configured, and monitored for sign-in\n\nFor each: enable MFA, record in the password vault, record in the Account Register.\n\nOnce the new accounts are proven working, disable or remove the original inherited account rather than leaving an orphaned admin behind.",
          "warning": "Test the new admin accounts fully before disabling the inherited one. Locking yourself out of a client tenant is a very bad afternoon.",
          "links": [],
          "position": 3
        },
        {
          "title": "Full tenant audit — users, licences, mailboxes, groups, MFA",
          "tag": "AUDIT",
          "ownerLabel": "Ankor'd",
          "description": "Now that you have real access, audit what is actually in the tenant. This feeds the handover document and usually surfaces cleanup work worth quoting.\n\nAudit and record:\n\n• All users — active, disabled, never signed in, last sign-in date\n• Licence assignment per user, and any unassigned licences\n• Shared mailboxes, distribution lists, Microsoft 365 groups and Teams\n• Mail forwarding rules, especially any forwarding outside the organisation\n• MFA status per user — this is commonly patchy on small tenants\n• Conditional Access policies, if any\n• Any legacy authentication still permitted\n• Guest and external users\n• Ex-staff accounts still active\n• Data locations — SharePoint sites, OneDrive usage\n\nFlag anything that is a security concern to the client's decision makers in writing. Externally-forwarding mailboxes and active accounts for departed staff are the two to look for first.",
          "warning": null,
          "links": [],
          "position": 4
        },
        {
          "title": "Onboard the licensing from the incumbent licensing provider to Ankor'd",
          "tag": "MILESTONE",
          "ownerLabel": "Ankor'd ↔ the incumbent licensing provider",
          "description": "Move the Microsoft 365 subscriptions onto Ankor'd so the client are billed and supported by you.\n\nSequence — order matters:\n\n1. Confirm exactly which subscriptions and quantities are moving, using the audit from Step 05\n2. Confirm pricing and present it to the client's decision makers for approval before committing\n3. Raise the new subscriptions under the Ankor'd partner tenant for the client\n4. Confirm the new subscriptions are active and licences are assignable\n5. Reassign user licences from the old subscriptions to the new ones\n6. Verify every user still holds the right licence and nothing has lapsed\n7. Only then instruct the incumbent licensing provider to cancel the old subscriptions\n8. Confirm in writing with their account manager that the the incumbent licensing provider subscriptions are cancelled and note the final billing date\n\nNever cancel the the incumbent licensing provider subscriptions before the Ankor'd ones are live and assigned. A gap means mailboxes go into a grace period and users lose access.",
          "warning": "Cancel old subscriptions LAST. If the old licences drop before the new ones are assigned, users lose mailbox access and data enters a deletion countdown.",
          "links": [],
          "position": 5
        },
        {
          "title": "Establish the GDAP delegated admin relationship for Ankor'd",
          "tag": "REQUIRED",
          "ownerLabel": "Ankor'd",
          "description": "Set up Granular Delegated Admin Privileges so Ankor'd can support the tenant with scoped, time-bound, revocable access.\n\n1. Generate the GDAP relationship request from the Ankor'd partner centre\n2. Request only the roles actually needed for support, not blanket Global Administrator\n3. Send the invitation to the client-held Global Admin for acceptance\n4. Have the client accept it — this is a good moment to demonstrate to the client's decision makers that they are the ones granting access\n5. Record the relationship duration and diarise the renewal date before it expires\n6. Test that support access actually works\n\nThis is the model that gets the client out of the situation they are in now: the client owns the tenant, and the provider holds access the client can revoke at any time.",
          "warning": "GDAP relationships expire. Put the renewal date in the calendar now, or support access will silently drop at the worst possible moment.",
          "links": [
            {
              "url": "https://partner.microsoft.com",
              "label": "Microsoft Partner Center"
            }
          ],
          "position": 6
        },
        {
          "title": "Grant the client staff the permissions they need",
          "tag": "CLIENT",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Give the client practical control of their own accounts, at the level they can safely handle.\n\n1. Confirm with the client's decision makers who should be able to manage staff accounts day to day\n2. Assign appropriate roles — User Administrator or Helpdesk Administrator is usually right for an internal contact; full Global Administrator should be limited to the directors\n3. Enable MFA on every account holding an admin role\n4. Walk the nominated person through the tasks they will actually do — password resets, adding a new starter, disabling a leaver\n5. Document those procedures for the handover pack\n6. Record all admin-role accounts in the Account Register\n\nThe objective is that the client are never again in a position where they cannot get into their own tenant.",
          "warning": null,
          "links": [],
          "position": 7
        },
        {
          "title": "Remove the incumbent licensing provider residual access and confirm in writing",
          "tag": "CONFIRM",
          "ownerLabel": "Ankor'd",
          "description": "Close out the the incumbent licensing provider relationship cleanly once licensing and access have moved and been verified.\n\n1. Remove any the incumbent licensing provider-created administrator accounts remaining in the tenant\n2. Remove the the incumbent licensing provider partner relationship / reseller relationship from the tenant\n3. Check for and remove any the incumbent licensing provider service accounts, app registrations or delegated permissions\n4. Confirm the billing relationship is closed and no further charges will be raised\n5. Get written confirmation from their account manager that the transition is complete from their side\n6. Review sign-in logs afterwards for any access attempts from removed accounts\n\nSave the written confirmation — attach it to this step or file it against the client record.",
          "warning": "Only do this once the Ankor'd subscriptions and GDAP access are confirmed working. Removing the incumbent too early can leave nobody able to administer the tenant.",
          "links": [],
          "position": 8
        }
      ]
    },
    {
      "num": "03",
      "label": "Domain Migration",
      "description": "Move the client's domain out of the incumbent provider's DNS host and into the registrar account Ankor'd manages.",
      "accent": "#A78BFA",
      "position": 2,
      "steps": [
        {
          "title": "Email the incumbent IT provider — request the domain release",
          "tag": "BLOCKER",
          "ownerLabel": "Ankor'd → their technical contact (the incumbent IT provider)",
          "description": "The domain sits in a the old DNS host account controlled by the incumbent IT provider. Open this request early — it gates the whole phase and depends entirely on someone else responding.\n\nWhat to request from their technical contact:\n\n1. Release of the client's domain — unlock the domain and provide the auth / EPP transfer code\n2. A full export of the current DNS zone, or read access to the the old DNS host zone so Ankor'd can export it\n3. Confirmation of the registrant details currently on record — registrant name and ABN\n4. Any other domains held for the client in the same account\n5. The existing website files and database, plus hosting details (see Phase 04 — request both in the same email to save a round trip)\n6. Any email or DNS services running that would break if records changed\n\nAttach the written authority from Phase 01. Be professional and specific — the handover goes faster when the outgoing provider is treated well.\n\nRecord the date requested and every follow-up in the notes below.",
          "warning": "Combine this with the Phase 04 website file request. Chasing the same person twice for two things in the same account wastes days.",
          "links": [],
          "position": 0
        },
        {
          "title": "Export and snapshot the full DNS zone before anything changes",
          "tag": "CRITICAL",
          "ownerLabel": "Ankor'd",
          "description": "A domain transfer does not carry DNS records with it. If the zone is not recorded before the move, mail and services break and there is nothing to restore from.\n\nCapture all of it:\n\n1. Export the zone file from the old DNS host if you have access, or have their technical contact export it\n2. Independently query the live records yourself so you are not relying only on what you were sent\n3. Screenshot the record list in the the old DNS host dashboard\n4. Attach the export and screenshots to this step\n\nRecords that must be captured — losing any of these breaks something:\n\n• MX — mail delivery to Microsoft 365\n• TXT SPF — sender authentication, breaks outbound mail reputation if lost\n• CNAME / TXT DKIM — mail signing\n• TXT DMARC — mail policy\n• CNAME autodiscover — Outlook client configuration\n• TXT MS= — Microsoft domain verification, loss can un-verify the domain in the tenant\n• A / AAAA records for the root and www\n• Any CNAME for subdomains — mail, ftp, remote, portal, vpn, staging\n• SRV records if any are present\n• Any third-party verification TXT records — Google, Facebook, SSL validation\n\nDouble-check for subdomains you were not told about. Small businesses accumulate them.",
          "warning": "This is the single highest-risk step in the domain phase. An incomplete DNS snapshot is how a migration takes down a client mail system.",
          "links": [
            {
              "url": "https://mxtoolbox.com/SuperTool.aspx",
              "label": "MXToolbox — verify live records"
            },
            {
              "url": "https://dnschecker.org/",
              "label": "DNSChecker — global propagation"
            }
          ],
          "position": 1
        },
        {
          "title": "Verify registrant details and .au eligibility",
          "tag": "VERIFY",
          "ownerLabel": "Ankor'd",
          "description": ".au domains have licensing rules that do not apply to .com. Check these before starting the transfer, because a mismatch will stop it dead.\n\n1. Look up the client's domain on the auDA WHOIS and record the registrant name and registrant ID (ABN or ACN)\n2. Confirm the registrant is the client — not the incumbent IT provider and not an individual\n3. Confirm the ABN is current and matches the entity name the client trade under\n4. Note the expiry date and current lock status\n5. If the registrant is wrong, a change of registrant is required — this is a separate process to a transfer and is treated as a new licence, so identify it now rather than mid-transfer\n\nAlso confirm with the client's decision makers whether they hold or want any related domains — .com, .net.au, or a variant for an old trading name.",
          "warning": "If the domain is registered to the incumbent IT provider rather than the client, resolve ownership before anything else. That is a change of registrant, not a transfer, and the timeline is different.",
          "links": [
            {
              "url": "https://whois.auda.org.au/",
              "label": "auDA WHOIS"
            },
            {
              "url": "https://abr.business.gov.au/",
              "label": "ABN Lookup"
            }
          ],
          "position": 2
        },
        {
          "title": "Create the the registrar account under the neutral personal mailbox",
          "tag": "SETUP",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Set up the destination account before requesting the transfer, using the neutral identity established in Phase 01 Step 02.\n\n1. Create the the registrar account with the client's decision makers neutral personal mailbox as the login — not an address on the client's own domain\n2. Enable 2FA on the the registrar account and store the recovery codes in the password vault\n3. Link the account into the Ankor'd reseller portal so Ankor'd can manage it on their behalf\n4. Set the account and registrant contact details to the client — correct business name, ABN, address and phone\n5. Confirm the billing method and who is paying — Ankor'd via the reseller arrangement, or the client directly\n6. Record the account fully in the account register\n\nThe result should be that the client can log in and prove ownership independently, while Ankor'd manage it day to day.",
          "warning": null,
          "links": [
            {
              "url": "https://au.godaddy.com",
              "label": "GoDaddy AU"
            }
          ],
          "position": 3
        },
        {
          "title": "Unlock the domain and obtain the auth / EPP code",
          "tag": "DEPENDS ON TSIT",
          "ownerLabel": "their technical contact (the incumbent IT provider)",
          "description": "The outgoing registrar must unlock the domain and issue the transfer authorisation code.\n\n1. Confirm their technical contact has removed the registrar lock on the client's domain\n2. Obtain the auth code / EPP code / domain password\n3. Confirm the registrant email address on file, because the transfer approval is usually sent there — if it points at a the incumbent IT provider address, that needs updating first or the approval will land somewhere you cannot reach\n4. Record the code securely in the password vault, not in an email thread\n5. Note the code expiry — many registrars expire auth codes, so do not sit on it\n\nIf the registrant email is wrong or unreachable, fix that before initiating the transfer.",
          "warning": "Check where the transfer approval email will actually be delivered before you start. A transfer approval sent to an unmonitored address is the most common reason .au transfers stall.",
          "links": [],
          "position": 4
        },
        {
          "title": "Initiate the transfer into the Ankor'd reseller portal",
          "tag": "ACTION",
          "ownerLabel": "Ankor'd",
          "description": "With the zone snapshot captured and the auth code in hand, start the transfer.\n\n1. Confirm the DNS snapshot from Step 02 is complete and attached — do not proceed without it\n2. Initiate the inbound transfer for the client's domain in the the registrar reseller portal\n3. Enter the auth code\n4. Confirm the registrant details carry across correctly\n5. Record the transfer reference and the date initiated\n6. Set expectations with the client — .au transfers usually complete quickly once approved, but allow for delays\n\nPlan the DNS approach now: either pre-stage the zone at the registrar so records are ready the moment the domain lands, or keep the existing nameservers pointed where they are and cut over deliberately afterwards. Pre-staging is safer.",
          "warning": null,
          "links": [],
          "position": 5
        },
        {
          "title": "Approve and monitor the transfer through to completion",
          "tag": "MONITOR",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Transfers stall silently. Watch this one actively.\n\n1. Watch for the transfer approval email and action it promptly\n2. If the approval goes to the client, brief the client's decision makers to expect it and what to click — and to tell you the moment it arrives\n3. Confirm the transfer status moves to complete in the the registrar portal\n4. Confirm the domain now appears under the Ankor'd reseller account\n5. Verify the registrant details on the new WHOIS record\n6. Confirm the new expiry date — transfers normally add a year\n\nThroughout the transfer, keep checking that mail is still flowing. Nothing should break during the registrar move itself, but verify rather than assume.",
          "warning": null,
          "links": [],
          "position": 6
        },
        {
          "title": "Rebuild the DNS zone in the registrar and verify against the snapshot",
          "tag": "CRITICAL",
          "ownerLabel": "Ankor'd",
          "description": "Recreate every record from the Step 02 snapshot, then check it line by line.\n\n1. Enter every record from the snapshot into the the registrar zone — do not work from memory\n2. Pay particular attention to MX, SPF, DKIM, DMARC, autodiscover and the Microsoft verification TXT record\n3. Match TTLs, or lower them deliberately during the cutover for faster rollback\n4. Update the nameservers to point at the registrar\n5. Wait for propagation and then verify externally, not just in the control panel\n6. Compare the live records against the snapshot record by record and tick each one off\n7. Screenshot the completed zone and attach it here\n\nUse an external checking tool for verification. The registrar dashboard showing a record is not the same as the internet resolving it.",
          "warning": "Work through the snapshot systematically. A single missing TXT record can silently break mail authentication weeks later, long after anyone connects it to the migration.",
          "links": [
            {
              "url": "https://mxtoolbox.com/SuperTool.aspx",
              "label": "MXToolbox"
            },
            {
              "url": "https://dnschecker.org/",
              "label": "DNSChecker"
            }
          ],
          "position": 7
        },
        {
          "title": "Verify mail flow end to end",
          "tag": "CONFIRM",
          "ownerLabel": "Ankor'd",
          "description": "Prove that email still works before you call the domain phase finished. Mail is the thing the client will notice within minutes if it breaks.\n\nTest and confirm:\n\n• Send an external email in to info on the client's own domain and confirm delivery\n• Send from a the client mailbox out to an external address and confirm delivery\n• Check the received headers for SPF, DKIM and DMARC pass results\n• Test at least two different staff mailboxes, not just the shared one\n• Confirm Outlook autodiscover still works — ideally set up a profile from scratch on a test device\n• Confirm mobile mail clients still connect\n• Check the Microsoft 365 admin centre still shows the client's domain as verified and healthy\n• Check for any messages sitting in the mail queue\n\nAsk the client's decision makers to confirm they are receiving mail normally. Get that confirmation in writing.",
          "warning": "Do not rely on inbound testing alone. SPF and DKIM problems only show on outbound mail, and often only as silent spam-foldering at the recipient end.",
          "links": [
            {
              "url": "https://www.mail-tester.com/",
              "label": "Mail-Tester — check SPF/DKIM/DMARC"
            }
          ],
          "position": 8
        },
        {
          "title": "Set auto-renew, record expiry, decommission the old DNS host",
          "tag": "CLOSE OUT",
          "ownerLabel": "Ankor'd",
          "description": "Close the domain phase out properly so it does not become someone else problem in two years.\n\n1. Enable auto-renew on the client's domain\n2. Confirm the billing method on file is valid and will not expire before the renewal\n3. Enable the registrar lock now that the transfer is complete\n4. Record the expiry date in the Account Register and diarise a reminder 60 days before\n5. Confirm the registrant contact email is monitored by someone at the client\n6. Confirm with their technical contact that the the old DNS host zone can be removed, and that no other client service depends on it\n7. Keep the DNS snapshot on file permanently as part of the handover pack\n\nOnly ask for the the old DNS host zone to be deleted once the registrar has been authoritative and stable for a reasonable period. There is no cost to leaving it dormant for a few weeks and it is a free rollback path.",
          "warning": null,
          "links": [],
          "position": 9
        }
      ]
    },
    {
      "num": "04",
      "label": "Website Rebuild",
      "description": "Usually the thing the client judges the engagement on. If the site is down, get something live fast, then rebuild it properly.",
      "accent": "#F0A832",
      "position": 3,
      "steps": [
        {
          "title": "Diagnose why the site is actually down",
          "tag": "URGENT",
          "ownerLabel": "Ankor'd",
          "description": "Before assuming a full rebuild, find out what is actually broken. The fix may be much faster than the rebuild, and it changes what you ask their technical contact for.\n\nCheck:\n\n• Does the domain resolve at all, and what does it resolve to?\n• Is there an A record for the root and for www, and does the target IP respond?\n• What exactly is returned — DNS failure, connection refused, 403, 404, 500, a suspension page, a parked page, or an expired certificate warning?\n• Is the hosting account still active, expired, or suspended for non-payment?\n• Is there an SSL certificate and has it expired?\n• Is the site still there but simply not being served?\n\nLikely causes worth ruling in or out: hosting expired or unpaid, the account was closed when the relationship with the incumbent IT provider ended, DNS records were removed or repointed, the certificate lapsed, or the files and database are genuinely gone.\n\nRecord findings and screenshots here. Report the cause to the client's decision makers in plain language — they will want to know what happened.",
          "warning": null,
          "links": [],
          "position": 0
        },
        {
          "title": "Publish a holding page immediately",
          "tag": "QUICK WIN",
          "ownerLabel": "Ankor'd",
          "description": "the client currently have nothing at their web address. Anyone searching for them finds a broken site. Fix that within the first day or two — it does not depend on the M365 or domain workstreams.\n\nA simple single page with:\n\n• the client logo and branding\n• The tagline: More than just Kitchens\n• Phone (02) 60 402 007 as a click-to-call link\n• Email info on the client's own domain\n• Address: 909 Metry Street, North Riverbend NSW 2640\n• Services: Kitchens · Bathrooms · Wardrobes · Commercial\n• A short line noting the new site is on its way\n• Trading hours if available\n\nRequirements: mobile-first, fast, valid SSL, and correct business name and address markup so search engines pick it up.\n\nOnly touch the A record for this — do not disturb MX or any mail-related record.\n\nThis is the visible early win that buys goodwill while the real build happens.",
          "warning": "Only change the A / AAAA records. Leave MX, SPF, DKIM, DMARC and autodiscover exactly as they are — breaking mail while fixing the website would be a self-inflicted wound.",
          "links": [],
          "position": 1
        },
        {
          "title": "Request existing site files, database and hosting details from their technical contact",
          "tag": "DEPENDS ON TSIT",
          "ownerLabel": "their technical contact (the incumbent IT provider)",
          "description": "Ask for whatever remains of the old site. Even a broken copy is worth having — it saves rewriting content and preserves the URL structure for redirects.\n\nRequest:\n\n1. A full backup of the website files\n2. A database export if the site was WordPress or another CMS\n3. Hosting account details and whether the account is still active\n4. What platform it was built on, and which theme or page builder\n5. Any licences for premium themes or plugins\n6. Original image assets at full resolution\n7. Any email accounts or forms configured on the hosting\n8. FTP / cPanel credentials if the account is being handed over rather than closed\n\nCombine this with the domain request in Phase 03 Step 01 — same person, same account, one email.\n\nIf nothing is available, note that here and move to Step 04 for content recovery. Do not let this block the rebuild.",
          "warning": null,
          "links": [],
          "position": 2
        },
        {
          "title": "Recover content and URL structure from public archives",
          "tag": "RECOVERY",
          "ownerLabel": "Ankor'd",
          "description": "Rebuild the old site content from what is publicly available. Do this regardless of what their technical contact provides — it is fast and it protects search rankings.\n\nSources:\n\n• Wayback Machine — capture the full page list, copy, and layout of the last working version\n• Google search with a site: query for the client's domain to recover indexed page URLs and meta descriptions\n• Google Business Profile — photos, description, hours, reviews\n• Facebook and Instagram — project photography, service descriptions, customer testimonials\n• Any printed marketing, quotes or brochures the client can supply\n\nWhat to capture:\n\n1. The full list of old page URLs, so 301 redirects can be mapped on the new site and existing search rankings are not lost\n2. Existing page copy as a starting point for rewriting\n3. Any project galleries or testimonials worth carrying forward\n4. Page titles and meta descriptions that were performing\n\nSave the URL list — it becomes the redirect map at launch. This is the difference between a rebuild that keeps its search position and one that starts from zero.",
          "warning": null,
          "links": [
            {
              "url": "https://web.archive.org/web/*/maplestreet.example.com",
              "label": "Wayback Machine — maplestreet.example.com"
            }
          ],
          "position": 3
        },
        {
          "title": "Collect new imagery and content from the client",
          "tag": "CLIENT",
          "ownerLabel": "Client decision makers",
          "description": "the client's decision makers are supplying new images. Give them a specific list so it arrives in one batch rather than trickling in and stalling the build.\n\nRequest:\n\n• Completed project photography — kitchens, bathrooms, wardrobes, commercial work — full resolution originals, not compressed social media exports\n• Before and after shots if they have them\n• Team and workshop photos\n• Logo files — ideally vector, and a version that works on dark backgrounds\n• Brand colours if defined, otherwise work from the existing letterhead green\n• Written service descriptions, or notes to write from\n• Customer testimonials, with permission to publish\n• Trading hours, service area, and any accreditations, licence numbers or memberships\n• Preferred enquiry destination — which email address should form submissions go to\n\nSet a clear deadline and a simple upload method. Note what has arrived and what is outstanding here.\n\nSend them two or three reference sites you think suit them, and ask what they like — it saves a revision round later.",
          "warning": "This is the most common cause of a stalled web build. Chase it actively, keep a visible list of what is still outstanding, and start building with placeholders rather than waiting.",
          "links": [],
          "position": 4
        },
        {
          "title": "Agree scope, sitemap and platform",
          "tag": "SIGN-OFF",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Lock the shape of the site down in writing before building, so revisions stay contained.\n\nAgree and document:\n\n• Sitemap — for example Home, Kitchens, Bathrooms, Wardrobes, Commercial, Gallery, About, Contact\n• Platform and hosting, and who holds those accounts afterwards\n• Whether the client needs to edit content themselves, which drives the platform choice more than anything else\n• Enquiry form fields and where submissions are delivered\n• Whether a gallery needs to be client-updatable as new projects complete\n• Google Maps, trading hours, service area coverage\n• Number of revision rounds included\n• Target launch date\n• Ongoing costs — hosting, domain, SSL, maintenance — and who pays what\n\nGet written sign-off on the sitemap and scope from the client's decision makers before starting the build.",
          "warning": null,
          "links": [],
          "position": 5
        },
        {
          "title": "Build the site on staging",
          "tag": "BUILD",
          "ownerLabel": "Ankor'd",
          "description": "Build on a staging URL so the live holding page is never disturbed and the client can review progress.\n\nBuild checklist:\n\n• Mobile-first — most traffic for a trades business is phone\n• Fast image loading: compress, correctly size, and lazy-load the gallery\n• Click-to-call phone links on every page\n• Clear enquiry call-to-action above the fold\n• Contact page with address, map, phone, email and hours\n• Correct local business schema markup — name, address, phone, area served\n• Working enquiry form with spam protection, tested end to end to a real inbox\n• Page titles and meta descriptions written for each page\n• Sensible URL structure, and a redirect map ready from the recovered old URLs\n• Accessible contrast and alt text on images\n• Favicon and social sharing preview image\n• Staging blocked from search indexing\n\nBlock staging from indexing, and remember to unblock it at launch. Forgetting is a classic and expensive mistake.",
          "warning": "Set the noindex on staging, and put a reminder in the pre-launch checklist to remove it. A site launched with staging noindex still in place will not appear in search at all.",
          "links": [],
          "position": 6
        },
        {
          "title": "Client review and written sign-off",
          "tag": "SIGN-OFF",
          "ownerLabel": "Client decision makers",
          "description": "Walk the client's decision makers through the staging site and get approval in writing before going live.\n\n1. Send the staging link with a short guide on what to look at\n2. Ask them to check on both desktop and their phones\n3. Verify with them: business name, address, phone, email, hours, service descriptions, project photos, and that no competitor work or unlicensed images have crept in\n4. Collect all feedback in one consolidated round rather than piecemeal\n5. Apply the changes and send back for final review\n6. Get explicit written approval to launch\n\nConfirm the enquiry form delivers to the address they actually monitor. Test it with them on the call.\n\nRecord the sign-off date and who approved it here.",
          "warning": null,
          "links": [],
          "position": 7
        },
        {
          "title": "Pre-launch checklist",
          "tag": "VERIFY",
          "ownerLabel": "Ankor'd",
          "description": "Work through this before touching DNS.\n\n• Staging noindex removed\n• SSL certificate installed and valid, with http redirecting to https\n• www and non-www both resolve and redirect consistently to one canonical version\n• All internal links working, no broken links or missing images\n• Enquiry form tested to the real destination inbox, including the spam folder check\n• Mobile layout checked on a real device, not just a browser resize\n• Page load speed acceptable, images compressed\n• Redirect map in place for every recovered old URL\n• XML sitemap generated\n• robots.txt correct\n• Analytics installed\n• Search Console property ready to verify\n• Favicon and social preview image present\n• Contact details correct on every page\n• Backup taken of the finished site before cutover\n\nTick each item off. Attach screenshots of the speed test and mobile view.",
          "warning": null,
          "links": [],
          "position": 8
        },
        {
          "title": "DNS cutover and go live",
          "tag": "LAUNCH",
          "ownerLabel": "Ankor'd",
          "description": "Point the domain at the new site. Keep this surgical.\n\n1. Lower the TTL on the A record a few hours ahead so rollback is fast if needed\n2. Change only the A / AAAA records and the www CNAME — nothing else\n3. Do not touch MX, SPF, DKIM, DMARC or autodiscover under any circumstances\n4. Verify propagation externally\n5. Test the live site on desktop and mobile, on a connection outside the office\n6. Confirm SSL is valid on the live domain\n7. Test the enquiry form again on the live site — form destinations sometimes break at cutover\n8. Send a test email in and out to confirm mail is unaffected\n9. Restore the TTL to a normal value once stable\n\nGo live in the morning, not at 5pm on a Friday. If something breaks you want a working day ahead of you.",
          "warning": "Mail-related records must not change during a website cutover. Confirm mail flow immediately after the change even though you did not touch it — verify rather than assume.",
          "links": [],
          "position": 9
        },
        {
          "title": "Post-launch — Google Business Profile, Search Console, backups, monitoring",
          "tag": "CLOSE OUT",
          "ownerLabel": "Ankor'd",
          "description": "Finish the job properly so the site keeps working without anyone thinking about it.\n\n1. Claim or recover the client Google Business Profile and confirm the client hold ownership, not a previous provider\n2. Update the Business Profile with the new website URL, current hours, services and new photography\n3. Verify the site in Google Search Console and submit the sitemap\n4. Check Search Console for crawl errors and confirm the redirects are being followed\n5. Confirm analytics is recording traffic\n6. Set up automated backups and confirm a restore actually works — an untested backup is not a backup\n7. Set up uptime monitoring with alerts to Ankor'd\n8. Confirm SSL auto-renewal is configured\n9. Record hosting renewal date and cost in the Account Register\n10. Show the client's decision makers how to update content if the platform allows it\n\nCheck the Business Profile carefully — it is often still controlled by the previous provider and is the single most valuable local search asset a trades business has.",
          "warning": null,
          "links": [
            {
              "url": "https://business.google.com",
              "label": "Google Business Profile"
            },
            {
              "url": "https://search.google.com/search-console",
              "label": "Google Search Console"
            }
          ],
          "position": 10
        }
      ]
    },
    {
      "num": "05",
      "label": "Handover & Documentation",
      "description": "Give the client genuine ownership and visibility of everything, in writing.",
      "accent": "#4ADE80",
      "position": 4,
      "steps": [
        {
          "title": "Complete the Account Register",
          "tag": "DOCUMENT",
          "ownerLabel": "Ankor'd",
          "description": "Fill out every account in the register on this project. This is what the client have never had, and it is the core of the handover.\n\nFor each account record: the system, the login URL, the username, the MFA method and where the recovery codes live, who owns it, which the password vault record holds the password, the renewal or expiry date, and what it actually does.\n\nWork through the full list — Microsoft 365 admin accounts, the personal mailbox root identity, the registrar, hosting, CMS admin, Google Business Profile, Search Console, analytics, and anything else picked up along the way.\n\nBe explicit about ownership. Every account should be marked as the client-owned unless there is a specific reason otherwise, and any exception should be one the client's decision makers have knowingly agreed to.",
          "warning": null,
          "links": [],
          "position": 0
        },
        {
          "title": "Move every credential into the password vault and share with the client",
          "tag": "SECURITY",
          "ownerLabel": "Ankor'd",
          "description": "Get the real passwords out of email threads, notes and the CRM, and into a proper vault.\n\n1. Confirm every account in the register has a corresponding the password vault record\n2. Rotate any password that was ever sent over email or read out over the phone — assume anything shared in plain text is compromised\n3. Confirm MFA is enabled everywhere it can be, and that recovery codes are stored\n4. Share the client the password vault folder with the client's decision makers, or hand credentials over through whatever secure method they will realistically use\n5. If they will not use a password manager, help them set one up — this is the root cause of the situation they are in now\n6. Delete credentials from email threads, chat messages and any temporary notes\n7. If a handover file including passwords is produced, hand it over in person or through a secure channel, and tell them to store it in the vault rather than in an inbox\n\nThe objective is that the client can get into every one of their systems without Ankor'd, and that no password is sitting in plain text anywhere.",
          "warning": "Rotate anything that arrived in plain text. Credentials handed over by a previous provider by email should never be assumed private.",
          "links": [],
          "position": 1
        },
        {
          "title": "Verify the client can independently access everything",
          "tag": "VERIFY",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Sit with the client's decision makers and have them log in to each system themselves. Do not assume, and do not do it for them.\n\nWork through:\n\n• Microsoft 365 admin centre with their own Global Admin account\n• The neutral personal mailbox root identity, including the 2FA prompt\n• The the registrar domain account\n• Website hosting and CMS admin\n• Google Business Profile\n• The the password vault vault\n\nFor each: they type the credentials, they complete the MFA prompt, they confirm they can see what they expect. Fix anything that does not work on the spot.\n\nThis is the step that proves the engagement succeeded. the client started this project unable to access their own systems — this is where that ends.",
          "warning": null,
          "links": [],
          "position": 2
        },
        {
          "title": "Document ownership, renewal dates and ongoing costs",
          "tag": "DOCUMENT",
          "ownerLabel": "Ankor'd",
          "description": "Set out clearly what is owned by whom, what renews when, and what it costs. Small businesses get caught out by silent renewals and by services nobody remembers signing up for.\n\nDocument:\n\n• Domain expiry and renewal cost, and who pays\n• Microsoft 365 subscription renewal date, seat count and monthly cost\n• Hosting renewal date and cost\n• SSL renewal, if not automatic\n• Any plugin, theme or third-party service licences\n• Which of these Ankor'd manage and bill, and which the client hold directly\n• Who to contact at Ankor'd for what\n\nPut the renewal dates in a calendar that outlives this project, with reminders well ahead of each date. Include the same list in the handover pack so the client has their own copy.",
          "warning": null,
          "links": [],
          "position": 3
        },
        {
          "title": "Handover meeting and export the handover pack",
          "tag": "MILESTONE",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Sit down with the client's decision makers and walk them through the finished picture.\n\nCover:\n\n1. The systems map — what connects to what, and why the neutral personal mailbox sits above the domain\n2. Every account they now own and how to get into it\n3. What changed and why: licensing moved from the incumbent licensing provider to Ankor'd, the domain moved from the old DNS host to the registrar under their own account, and the website was rebuilt\n4. Renewal dates and costs\n5. How to raise support requests with Ankor'd\n6. What they can do themselves, and what to call about\n\nUse the Export handover pack button at the top of this project to generate the document. Choose whether to include passwords — if you do, hand it over in person or through a secure channel and tell them to store it in the password vault rather than leaving it in an inbox.\n\nSend the pack afterwards along with a short written summary. Record the meeting date here.",
          "warning": null,
          "links": [],
          "position": 4
        },
        {
          "title": "Agree ongoing support and monitoring",
          "tag": "CLOSE OUT",
          "ownerLabel": "Ankor'd · Client decision makers",
          "description": "Close the project out with a clear ongoing arrangement, so the client do not drift back into having no one looking after this.\n\nAgree and document:\n\n• The support arrangement — managed service, ad hoc, or somewhere in between\n• Response expectations and how to log a request\n• What monitoring Ankor'd have in place — uptime, backups, licence renewals, GDAP expiry\n• Who at the client is the main technical contact\n• A review point, for example a check-in in three months and annually thereafter\n• Anything deliberately left out of scope, so there is no ambiguity later\n\nDiarise the GDAP relationship expiry, the domain renewal, the M365 renewal and the hosting renewal now, before the project is closed and everyone moves on.",
          "warning": null,
          "links": [],
          "position": 5
        }
      ]
    }
  ]
};
