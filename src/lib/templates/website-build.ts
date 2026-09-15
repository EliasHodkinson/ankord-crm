import type { ProjectTemplate } from "./client-onboarding";

/** A standalone site build for a client who already owns their own systems. */
export const websiteBuild: ProjectTemplate = {
  key: "website-build",
  name: "Website design & build",
  description:
    "Scoping, designing, building and launching a website — without touching mail flow.",
  phases: [
    {
      num: "01",
      label: "Scope & Discovery",
      description: "Agree what is being built, for whom, and what success looks like.",
      accent: "#33B4E5",
      position: 0,
      steps: [
        {
          title: "Agree scope, sitemap and platform in writing",
          tag: "SIGN-OFF",
          ownerLabel: "Ankor'd · Client",
          description:
            "Lock the shape of the site down before building, so revisions stay contained.\n\nAgree and document:\n\n• Sitemap, page by page\n• Platform and hosting, and who holds those accounts afterwards\n• Whether the client needs to edit content themselves — this drives the platform choice more than anything else\n• Enquiry form fields and where submissions are delivered\n• Number of revision rounds included\n• Target launch date\n• Ongoing costs — hosting, domain, SSL, maintenance — and who pays what",
          warning: null,
          links: [],
          position: 0,
        },
        {
          title: "Collect imagery, copy and brand assets from the client",
          tag: "CLIENT",
          ownerLabel: "Client",
          description:
            "Give them one specific list so it arrives in a batch rather than trickling in.\n\nRequest full-resolution photography, logo files including a version that works on dark backgrounds, brand colours, written service descriptions, testimonials with permission to publish, trading hours, service area, and any accreditations or licence numbers.\n\nSet a deadline and a simple upload method. Note what has arrived and what is outstanding here.",
          warning:
            "This is the most common cause of a stalled web build. Chase it actively and start building with placeholders rather than waiting.",
          links: [],
          position: 1,
        },
        {
          title: "Confirm where the domain and DNS live today",
          tag: "VERIFY",
          ownerLabel: "Ankor'd",
          description:
            "Before design starts, know who controls the domain and who can change DNS at launch. Record the registrar, the DNS host, the current nameservers and the full record list, and note who has to be in the room on cutover day.",
          warning:
            "If the client cannot get into their own registrar, find out now — not the afternoon you planned to go live.",
          links: [],
          position: 2,
        },
      ],
    },
    {
      num: "02",
      label: "Design & Build",
      description: "Build on staging so nothing is disturbed until it is ready.",
      accent: "#5B8DEF",
      position: 1,
      steps: [
        {
          title: "Design direction approved",
          tag: "SIGN-OFF",
          ownerLabel: "Ankor'd · Client",
          description:
            "Show the home page and one interior template. Get written approval on the direction before building the rest — it is far cheaper to change a direction than a finished site.",
          warning: null,
          links: [],
          position: 0,
        },
        {
          title: "Build the site on staging",
          tag: "BUILD",
          ownerLabel: "Ankor'd",
          description:
            "Mobile first. Compress and lazy-load imagery. Click-to-call on every page. A clear enquiry call to action above the fold. Correct local business schema. A working enquiry form tested end to end to a real inbox. Page titles and meta descriptions written per page. Accessible contrast and alt text. Favicon and social sharing preview.\n\nBlock staging from search indexing while you work.",
          warning:
            "Set noindex on staging, and put removing it in the pre-launch checklist. A site launched with staging noindex still in place will not appear in search at all.",
          links: [],
          position: 1,
        },
        {
          title: "Client review and written sign-off",
          tag: "SIGN-OFF",
          ownerLabel: "Client",
          description:
            "Walk them through staging on desktop and on their phones. Verify business name, address, phone, email, hours, service descriptions and photography. Collect feedback in one consolidated round, apply it, then get explicit written approval to launch.",
          warning: null,
          links: [],
          position: 2,
        },
      ],
    },
    {
      num: "03",
      label: "Launch",
      description: "Go live carefully, and never touch mail records on the way.",
      accent: "#F0A832",
      position: 2,
      steps: [
        {
          title: "Pre-launch checklist",
          tag: "VERIFY",
          ownerLabel: "Ankor'd",
          description:
            "Staging noindex removed. SSL valid with http redirecting to https. www and non-www resolving consistently to one canonical version. No broken links or missing images. Enquiry form tested to the real destination inbox, spam folder included. Mobile checked on a real device. Redirect map in place for every old URL. XML sitemap generated, robots.txt correct, analytics installed, Search Console ready to verify. Backup taken before cutover.",
          warning: null,
          links: [],
          position: 0,
        },
        {
          title: "DNS cutover and go live",
          tag: "LAUNCH",
          ownerLabel: "Ankor'd",
          description:
            "Lower the TTL on the A record a few hours ahead so rollback is fast. Change only the A / AAAA records and the www CNAME. Verify propagation externally, test the live site on a connection outside the office, confirm SSL, and test the enquiry form again on the live domain.\n\nGo live in the morning, not at 5pm on a Friday.",
          warning:
            "Do not touch MX, SPF, DKIM, DMARC or autodiscover. Confirm mail flow immediately afterwards anyway — verify rather than assume.",
          links: [],
          position: 1,
        },
        {
          title: "Post-launch — profile, search console, backups, monitoring",
          tag: "CLOSE OUT",
          ownerLabel: "Ankor'd",
          description:
            "Claim or recover the Google Business Profile and confirm the client owns it, not a previous provider. Update it with the new URL, hours, services and photography. Verify in Search Console and submit the sitemap. Confirm analytics is recording. Set up automated backups and test a restore. Set up uptime monitoring. Record hosting renewal date and cost in the account register.",
          warning: null,
          links: [],
          position: 2,
        },
      ],
    },
  ],
};
