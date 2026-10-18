/**
 * Demo data for looking at the CRM with something in it.
 *
 *   npm run db:seed           fill the database with demo records
 *   npm run db:seed -- --clean   remove them again
 *
 * Only content tables are touched — users, sessions and settings are left
 * alone, so signing in and the SharePoint configuration survive a reseed.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { clientOnboarding } from "../src/lib/templates/client-onboarding";

const {
  activity,
  communications,
  contactFacts,
  contacts,
  customers,
  documentLines,
  documents,
  items,
  shipments,
  leads,
  numberSeries,
  projectAccounts,
  projectContacts,
  projectPhases,
  projectSteps,
  projects,
  savedViews,
  tasks,
  users,
} = schema;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const client = new Client({
    connectionString: url,
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  const db = drizzle(client, { schema, casing: "snake_case" });

  try {
    console.log("Clearing demo content…");
    await db.execute(sql`
      truncate table
        ${documentLines}, ${documents}, ${items},
        ${activity}, ${communications}, ${tasks}, ${contactFacts},
        ${projectAccounts}, ${projectContacts}, ${projectSteps},
        ${projectPhases}, ${projects}, ${contacts}, ${customers}, ${leads},
        ${savedViews}
      restart identity cascade
    `);

    if (process.argv.includes("--clean")) {
      console.log("Demo data removed.");
      return;
    }

    const team = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .orderBy(asc(users.createdAt));
    const owner = team[0]?.id ?? null;
    const second = team[1]?.id ?? owner;

    if (!owner) {
      console.warn("No users yet — sign in once, then reseed to get owners assigned.");
    }

    console.log("Adding customers and people…");

    const [qak] = await db
      .insert(customers)
      .values({
        name: "Maple Street Kitchens",
        legalName: "Maple Street Kitchens Pty Ltd",
        abn: "00 000 000 000",
        status: "active",
        industry: "Cabinetry & joinery",
        segment: "Full-service retainer",
        website: "https://maplestreet.example.com",
        phone: "(02) 6040 2007",
        email: "info@maplestreet.example.com",
        ownerId: owner,
        addressLine1: "909 Metry Street",
        suburb: "North Riverbend",
        state: "NSW",
        postcode: "2640",
        tags: ["m365", "website", "migration"],
        notes:
          "Came to us with the website completely offline and no access to their own M365 tenant. Two directors, both hands-on. Decisions get made together — do not assume one speaks for the other.",
        lastActivityAt: daysAgo(11),
        createdById: owner,
      })
      .returning({ id: customers.id });

    const [border] = await db
      .insert(customers)
      .values({
        name: "Parkside Physio",
        legalName: "Parkside Physiotherapy Group Pty Ltd",
        status: "active",
        industry: "Allied health",
        segment: "Marketing retainer",
        website: "https://parksidephysio.example.com",
        phone: "(02) 6021 4488",
        email: "reception@parksidephysio.example.com",
        ownerId: second,
        suburb: "Lavington",
        state: "NSW",
        postcode: "2641",
        tags: ["seo", "retainer"],
        notes: "Three clinics. Practice manager runs everything day to day.",
        lastActivityAt: daysAgo(4),
        createdById: owner,
      })
      .returning({ id: customers.id });

    const [murray] = await db
      .insert(customers)
      .values({
        name: "Murray Valley Produce",
        status: "prospect",
        industry: "Agriculture & wholesale",
        website: "https://greenfieldproduce.example.com",
        phone: "(03) 5744 1120",
        ownerId: owner,
        suburb: "Wodonga",
        state: "VIC",
        postcode: "3690",
        tags: ["brand"],
        notes: "Scoping a brand refresh. Slow-moving, family board.",
        lastActivityAt: daysAgo(118),
        createdById: owner,
      })
      .returning({ id: customers.id });

    const [wendy] = await db
      .insert(contacts)
      .values({
        customerId: qak.id,
        firstName: "Wendy",
        lastName: "Alder",
        jobTitle: "Director",
        email: "wendy@maplestreet.example.com",
        phone: "(02) 6040 2007",
        mobile: "0400 000 101",
        isPrimary: true,
        isDecisionMaker: true,
        pronouns: "she/her",
        coffeeOrder: "Large flat white, one sugar",
        birthday: "1979-09-14",
        dietary: "Gluten free",
        preferredContact: "Phone — rarely reads email before 6pm",
        notes:
          "Straight talker. Wants to understand why, not just what. Decides jointly with Theo.",
        createdById: owner,
      })
      .returning({ id: contacts.id });

    const [stu] = await db
      .insert(contacts)
      .values({
        customerId: qak.id,
        firstName: "Theoart",
        lastName: "Alder",
        jobTitle: "Director",
        email: "theo@maplestreet.example.com",
        mobile: "0400 000 102",
        isDecisionMaker: true,
        pronouns: "he/him",
        coffeeOrder: "Long black, no sugar",
        birthday: "1976-03-02",
        notes: "On the tools most days. Best reached before 7am or after 4pm.",
        createdById: owner,
      })
      .returning({ id: contacts.id });

    const [priya] = await db
      .insert(contacts)
      .values({
        customerId: border.id,
        firstName: "Nadia",
        lastName: "Raman",
        jobTitle: "Practice Manager",
        email: "nadia@parksidephysio.example.com",
        phone: "(02) 6021 4488",
        isPrimary: true,
        isDecisionMaker: true,
        coffeeOrder: "Oat cap",
        birthday: "1988-11-27",
        dietary: "Vegetarian",
        notes: "Extremely organised. Send an agenda before any call.",
        createdById: owner,
      })
      .returning({ id: contacts.id });

    await db.insert(contactFacts).values([
      {
        contactId: wendy.id,
        kind: "event",
        label: "Daughter's wedding",
        detail: "In Beechworth — taking the fortnight off around it",
        onDate: iso(daysAhead(23)),
        recurring: false,
        remindDaysBefore: 7,
        createdById: owner,
      },
      {
        contactId: wendy.id,
        kind: "personal",
        label: "Kids play for the Riverbend Tigers",
        detail: "Home games most Saturdays through winter",
        recurring: false,
        createdById: owner,
      },
      {
        contactId: stu.id,
        kind: "preference",
        label: "Hates being called Theoart",
        detail: "Theo, always",
        createdById: owner,
      },
      {
        contactId: priya.id,
        kind: "event",
        label: "Clinic anniversary",
        detail: "Ten years in Lavington — worth a card",
        onDate: iso(daysAhead(9)),
        recurring: true,
        remindDaysBefore: 14,
        createdById: owner,
      },
    ]);

    console.log("Adding leads…");

    await db.insert(leads).values([
      {
        companyName: "Claypan Earthworks",
        contactName: "Dale Bell",
        jobTitle: "Operations Manager",
        email: "dale@claypanearthworks.example.com",
        phone: "(02) 6931 7788",
        website: "https://claypanearthworks.example.com",
        suburb: "Wagga Wagga",
        state: "NSW",
        stage: "proposal",
        source: "Referral — Chamber of Commerce",
        interest: "Website rebuild + Microsoft 365 migration off a personal account",
        valueAud: "18500",
        probability: 65,
        expectedCloseDate: iso(daysAhead(18)),
        ownerId: owner,
        nextAction: "Follow up on the proposal — he asked for a phased option",
        nextActionAt: iso(daysAhead(2)),
        lastActivityAt: daysAgo(2),
        tags: ["m365", "website"],
        notes: "Currently on a consumer Gmail. Three site offices, no shared drive.",
        createdById: owner,
      },
      {
        companyName: "Riverbend Dental Theodio",
        contactName: "Dr Ingrid Sorensen",
        jobTitle: "Principal",
        email: "ingrid@riverbenddental.example.com",
        phone: "(02) 6021 9900",
        suburb: "Riverbend",
        state: "NSW",
        stage: "qualified",
        source: "Google search",
        interest: "SEO retainer and a booking integration",
        valueAud: "2400",
        probability: 40,
        expectedCloseDate: iso(daysAhead(35)),
        ownerId: second,
        nextAction: "Send the retainer scope and two reference sites",
        nextActionAt: iso(daysAhead(5)),
        lastActivityAt: daysAgo(9),
        tags: ["seo", "retainer"],
        createdById: owner,
      },
      {
        companyName: "Longhaul Freight Services",
        contactName: "Ray Aliprandi",
        email: "ray@longhaulfreight.example.com",
        phone: "(02) 6058 1200",
        suburb: "Wodonga",
        state: "VIC",
        stage: "contacted",
        source: "Cold outreach",
        interest: "Wants their quoting process automated",
        valueAud: "32000",
        probability: 20,
        ownerId: owner,
        nextAction: "Book a discovery call",
        nextActionAt: iso(daysAgo(2)),
        lastActivityAt: daysAgo(24),
        tags: ["ai", "automation"],
        notes: "Interested but slow to reply. Try the mobile.",
        createdById: owner,
      },
      {
        companyName: "Kingfisher Brewing Co",
        contactName: "Robin Naylor",
        email: "robin@kingfisherbrewing.example.com",
        suburb: "Kingfisher Flat",
        state: "NSW",
        stage: "new",
        source: "Instagram",
        interest: "Ecommerce store for the taproom",
        valueAud: "9800",
        ownerId: second,
        nextAction: "Qualify — do they already have a POS to integrate with?",
        nextActionAt: iso(daysAhead(4)),
        lastActivityAt: daysAgo(1),
        createdById: owner,
      },
      {
        companyName: "Table Top Landscaping",
        contactName: "Sam Okonkwo",
        email: "sam@ironbarklandscaping.example.com",
        suburb: "Table Top",
        state: "NSW",
        stage: "lost",
        source: "Referral",
        interest: "Small brochure site",
        valueAud: "4200",
        ownerId: owner,
        lostReason: "Went with a cheaper template build from a mate",
        createdById: owner,
      },
    ]);

    console.log("Building the Maple Street Kitchens onboarding project…");

    const [project] = await db
      .insert(projects)
      .values({
        customerId: qak.id,
        name: "Onboarding & system migration",
        code: "MSK-ONB",
        status: "active",
        health: "at_risk",
        priority: "high",
        summary:
          "Take over the Microsoft 365 tenant, move the domain across, and rebuild the website.",
        headline: "The Maple Street Kitchens website is completely offline",
        headlineDetail:
          "This is the client's most urgent issue and the one they will judge the engagement on. Get a holding page live before the slower M365 and domain workstreams complete — it does not depend on either of them.",
        ownerId: owner,
        startDate: iso(daysAgo(21)),
        targetDate: iso(daysAhead(38)),
        budgetAud: "24500",
        stateBefore:
          "Maple Street Kitchens do not hold the keys to their own systems.\n\nThe incumbent licensing provider holds the Microsoft 365 Global Administrator account — Maple Street Kitchens have no admin access to their own tenant.\n\nThe incumbent IT provider holds the account that controls the domain and all DNS.\n\nMail is working and must not be disturbed. The website has been down for weeks and the cause is unconfirmed.",
        stateAfter:
          "Maple Street Kitchens own every root account; Ankor'd holds delegated access to support them, not to lock them out.\n\nA neutral personal mailbox owned by the directors is the root identity for the registrar — deliberately not an address on the company domain.\n\nLicensing sits with Ankor'd as CSP. DNS is rebuilt identically so mail flow never breaks. The new website is live.",
        templateKey: clientOnboarding.key,
        lastActivityAt: daysAgo(11),
        createdById: owner,
      })
      .returning({ id: projects.id });

    // Same code path the app uses when a project is created from a template.
    const phaseIds: string[] = [];
    for (const phase of clientOnboarding.phases) {
      const [created] = await db
        .insert(projectPhases)
        .values({
          projectId: project.id,
          num: phase.num,
          label: phase.label,
          description: phase.description,
          accent: phase.accent,
          position: phase.position,
        })
        .returning({ id: projectPhases.id });
      phaseIds.push(created.id);

      if (phase.steps.length === 0) continue;
      await db.insert(projectSteps).values(
        phase.steps.map((step) => ({
          projectId: project.id,
          phaseId: created.id,
          title: step.title,
          tag: step.tag,
          ownerLabel: step.ownerLabel,
          description: step.description,
          warning: step.warning,
          links: step.links,
          position: step.position,
        })),
      );
    }

    // Phase 01 done, phase 02 part way, one step blocked on a third party.
    const allSteps = await db
      .select({ id: projectSteps.id, phaseId: projectSteps.phaseId, position: projectSteps.position })
      .from(projectSteps)
      .where(eq(projectSteps.projectId, project.id))
      .orderBy(asc(projectSteps.position));

    const inPhase = (index: number) =>
      allSteps
        .filter((s) => s.phaseId === phaseIds[index])
        .sort((a, b) => a.position - b.position);

    for (const step of inPhase(0)) {
      await db
        .update(projectSteps)
        .set({ status: "done", completedAt: daysAgo(14), completedById: owner })
        .where(eq(projectSteps.id, step.id));
    }

    const phase2 = inPhase(1);
    if (phase2[0]) {
      await db
        .update(projectSteps)
        .set({
          status: "blocked",
          blockedOn: "Incumbent licensing provider — account manager on leave",
          blockedSince: daysAgo(9),
          assigneeId: owner,
          notes:
            "Called twice and emailed. They want written authority from the directors before they will move the Global Admin account.",
        })
        .where(eq(projectSteps.id, phase2[0].id));
    }
    if (phase2[1]) {
      await db
        .update(projectSteps)
        .set({ status: "in_progress", assigneeId: owner, dueDate: iso(daysAhead(3)) })
        .where(eq(projectSteps.id, phase2[1].id));
    }

    const phase4 = inPhase(3);
    if (phase4[0]) {
      await db
        .update(projectSteps)
        .set({ status: "done", completedAt: daysAgo(18), completedById: owner })
        .where(eq(projectSteps.id, phase4[0].id));
    }
    if (phase4[1]) {
      await db
        .update(projectSteps)
        .set({
          status: "done",
          completedAt: daysAgo(17),
          completedById: owner,
          notes: "Holding page live with phone number and a contact form. Client happy.",
        })
        .where(eq(projectSteps.id, phase4[1].id));
    }
    if (phase4[4]) {
      await db
        .update(projectSteps)
        .set({
          status: "blocked",
          blockedOn: "Client — photography",
          blockedSince: daysAgo(6),
          assigneeId: second,
          notes: "Sent the shot list. Two of eight galleries received so far.",
        })
        .where(eq(projectSteps.id, phase4[4].id));
    }

    await db.insert(projectContacts).values([
      {
        projectId: project.id,
        contactId: wendy.id,
        name: "Wendy Alder",
        organisation: "Maple Street Kitchens",
        role: "Director — decision maker",
        email: "wendy@maplestreet.example.com",
        phone: "0400 000 101",
        needed: "Written authority to act, and sign-off on the sitemap",
        bestContactMethod: "Phone",
        position: 0,
      },
      {
        projectId: project.id,
        contactId: stu.id,
        name: "Theoart Alder",
        organisation: "Maple Street Kitchens",
        role: "Director — decision maker",
        email: "theo@maplestreet.example.com",
        phone: "0400 000 102",
        needed: "Project photography and the trade references",
        bestContactMethod: "Mobile, early morning",
        position: 1,
      },
      {
        projectId: project.id,
        name: "Account manager",
        organisation: "Incumbent licensing provider",
        role: "Holds the Microsoft 365 Global Admin and licensing",
        email: "accounts@example.com",
        needed: "Global Admin handover and licence transfer approval",
        bestContactMethod: "Phone — email goes unanswered",
        isBlocker: true,
        position: 2,
      },
      {
        projectId: project.id,
        name: "Technical contact",
        organisation: "Incumbent IT provider",
        role: "Holds the DNS account, domain and old website files",
        email: "support@example.com",
        needed: "Domain auth code, DNS zone export, and the old site files",
        bestContactMethod: "Email, then chase by phone",
        isBlocker: true,
        position: 3,
      },
    ]);

    await db.insert(projectAccounts).values([
      {
        projectId: project.id,
        customerId: qak.id,
        system: "Microsoft 365 — Global Admin",
        loginUrl: "https://admin.microsoft.com",
        username: "admin@maplestreet.onmicrosoft.com",
        mfaMethod: "Authenticator app",
        recoveryCodesLocation: "Vault record attachment",
        vaultRecord: "Keeper › Clients › Maple Street Kitchens › M365 Global Admin",
        ownedBy: "Maple Street Kitchens",
        purpose: "Tenant administration",
        position: 0,
      },
      {
        projectId: project.id,
        customerId: qak.id,
        system: "Domain registrar",
        loginUrl: "https://au.godaddy.com",
        username: "alder.msk@example.com",
        mfaMethod: "Authenticator app",
        vaultRecord: "Keeper › Clients › Maple Street Kitchens › Registrar",
        ownedBy: "Maple Street Kitchens — directors' personal mailbox",
        renewalDate: iso(daysAhead(214)),
        costAud: "24.95",
        purpose: "Domain registration and DNS",
        notes:
          "Deliberately not an @maplestreet.example.com login — the account that controls the domain must not depend on the domain.",
        position: 1,
      },
      {
        projectId: project.id,
        customerId: qak.id,
        system: "Website hosting",
        loginUrl: "https://vercel.com",
        username: "alder.msk@example.com",
        mfaMethod: "Authenticator app",
        vaultRecord: "Keeper › Clients › Maple Street Kitchens › Hosting",
        ownedBy: "Maple Street Kitchens",
        renewalDate: iso(daysAhead(320)),
        costAud: "0",
        purpose: "New website",
        position: 2,
      },
    ]);

    console.log("Logging communications…");

    await db.insert(communications).values([
      {
        customerId: qak.id,
        projectId: project.id,
        contactId: wendy.id,
        type: "call",
        direction: "outbound",
        subject: "Kick-off — priorities and authority to act",
        preview:
          "Agreed the website comes first. Wendy and Theo will send written authority so we can approach both incumbents.",
        body:
          "Agreed the website comes first — it is what customers see and what they are being judged on.\n\nWendy and Theo will send written authority so we can approach both incumbent providers. Confirmed they have never had admin access to their own tenant.\n\nAction: send the authority-to-act wording for them to sign.",
        occurredAt: daysAgo(21),
        loggedById: owner,
      },
      {
        customerId: qak.id,
        projectId: project.id,
        type: "email",
        direction: "outbound",
        subject: "Maple Street Kitchens — request for Global Administrator handover",
        preview:
          "Formal request with the signed authority attached. Asked for the GA account, tenant ID and licence position.",
        body:
          "Formal request with the signed authority attached. Asked for the Global Administrator account, the tenant ID, the verified domains and the current licence position.",
        occurredAt: daysAgo(16),
        fromName: "Ankor'd",
        fromEmail: "hello@ankord.com.au",
        toRecipients: [{ name: "Account manager", address: "accounts@example.com" }],
        loggedById: owner,
      },
      {
        customerId: qak.id,
        projectId: project.id,
        contactId: stu.id,
        type: "meeting",
        direction: "outbound",
        subject: "Site visit — photography brief",
        preview:
          "Walked the showroom and two recent jobs. Theo to send full-resolution originals, not social exports.",
        body:
          "Walked the showroom and two recent installs.\n\nAgreed the shot list: eight completed kitchens, two bathrooms, the workshop, and a team photo.\n\nTheo to send full-resolution originals — not compressed social media exports.",
        occurredAt: daysAgo(11),
        loggedById: second,
      },
      {
        customerId: qak.id,
        projectId: project.id,
        contactId: wendy.id,
        type: "note",
        direction: "internal",
        subject: "Holding page is live",
        preview:
          "Phone number, address and a working enquiry form. Wendy rang to say a customer found them through it the same afternoon.",
        body:
          "Holding page live with the phone number, address, trading hours and a working enquiry form.\n\nWendy rang to say a customer found them through it the same afternoon. Worth remembering when we talk about the value of the full rebuild.",
        occurredAt: daysAgo(17),
        loggedById: owner,
      },
      {
        customerId: border.id,
        contactId: priya.id,
        type: "call",
        direction: "inbound",
        subject: "Monthly check-in",
        preview: "Rankings up for two of the three clinic pages. Wants a blog cadence.",
        body:
          "Rankings up for two of the three clinic pages. Nadia wants a monthly blog cadence and asked what we would charge to write them.",
        occurredAt: daysAgo(4),
        loggedById: second,
      },
    ]);

    await db.insert(activity).values([
      {
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        customerId: qak.id,
        actorId: owner,
        verb: "created",
        summary: "Started Onboarding & system migration from the client onboarding template",
        createdAt: daysAgo(21),
      },
      {
        entityType: "customer",
        entityId: qak.id,
        customerId: qak.id,
        actorId: owner,
        verb: "created",
        summary: "Added customer Maple Street Kitchens",
        createdAt: daysAgo(22),
      },
      {
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        actorId: second,
        verb: "step_blocked",
        summary: "Marked the photography step blocked on the client",
        createdAt: daysAgo(6),
      },
    ]);

    await db.insert(tasks).values([
      {
        title: "Chase the Global Admin handover by phone",
        detail: "Email has gone unanswered twice. Try the direct line before 9am.",
        status: "open",
        priority: "urgent",
        dueDate: iso(daysAgo(1)),
        assigneeId: owner,
        customerId: qak.id,
        projectId: project.id,
        createdById: owner,
      },
      {
        title: "Send Murray Valley the brand discovery questionnaire",
        status: "open",
        priority: "normal",
        dueDate: iso(daysAhead(6)),
        assigneeId: second,
        customerId: murray.id,
        createdById: owner,
      },
    ]);

    console.log("Adding items and sales documents…");

    // Xero-type documents are seeded `pending` with no number: Xero numbers
    // them on the first push, once a (demo) Xero organisation is connected.
    const [cards, banner, design, setup] = await db
      .insert(items)
      .values([
        {
          code: "BC-500",
          name: "Business cards (500)",
          description: "500 business cards, 350gsm, double sided",
          tracksStock: true,
          unit: "box of 500",
          isSold: true,
          isPurchased: true,
          salePrice: "150",
          purchasePrice: "62.5",
          salesTaxType: "OUTPUT",
          purchaseTaxType: "INPUT",
          createdById: owner,
        },
        {
          code: "BAN-PULL",
          name: "Pull-up banner",
          description: "850 × 2000mm pull-up banner with stand",
          tracksStock: true,
          unit: "ea",
          isSold: true,
          isPurchased: true,
          salePrice: "295",
          salesTaxType: "OUTPUT",
          purchaseTaxType: "INPUT",
          createdById: owner,
        },
        {
          code: "DES-HR",
          name: "Design time",
          description: "Graphic design",
          tracksStock: false,
          unit: "hr",
          isSold: true,
          salePrice: "120",
          salesTaxType: "OUTPUT",
          createdById: owner,
        },
        {
          code: "SETUP",
          name: "Setup fee",
          description: "Artwork setup and proofing",
          tracksStock: false,
          isSold: true,
          salePrice: "45",
          salesTaxType: "OUTPUT",
          createdById: owner,
        },
      ])
      .returning();

    const today = iso(new Date());
    const [quote] = await db
      .insert(documents)
      .values({
        type: "quote",
        status: "draft",
        partnerId: qak.id,
        partnerName: "Maple Street Kitchens",
        reference: "Showroom reopening",
        docDate: today,
        dueDate: iso(daysAhead(30)),
        ownerId: owner,
        title: "Showroom reopening print",
        subtotal: "1035.00",
        taxTotal: "103.50",
        total: "1138.50",
        xeroSyncState: "pending",
        createdById: owner,
      })
      .returning({ id: documents.id });
    await db.insert(documentLines).values([
      { documentId: quote.id, position: 0, rowType: "text", description: "Printing" },
      { documentId: quote.id, position: 1, itemId: cards.id, itemCode: cards.code, unit: cards.unit, tracksStock: true, description: cards.description!, quantity: "4", unitPrice: "150", taxType: "OUTPUT", taxRate: "10", lineAmount: "600.00", taxAmount: "60.00" },
      { documentId: quote.id, position: 2, itemId: banner.id, itemCode: banner.code, unit: banner.unit, tracksStock: true, description: banner.description!, quantity: "1", unitPrice: "295", taxType: "OUTPUT", taxRate: "10", lineAmount: "295.00", taxAmount: "29.50" },
      { documentId: quote.id, position: 3, itemId: setup.id, itemCode: setup.code, description: setup.description!, quantity: "1", unitPrice: "140", taxType: "OUTPUT", taxRate: "10", lineAmount: "140.00", taxAmount: "14.00" },
      { documentId: quote.id, position: 4, rowType: "alternative", itemId: design.id, itemCode: design.code, unit: design.unit, description: "Refresh the menu design", quantity: "3", unitPrice: "120", taxType: "OUTPUT", taxRate: "10", lineAmount: "360.00", taxAmount: "36.00" },
    ]);

    // A standalone order, so the fulfilment column has something to show.
    const [series] = await db
      .update(numberSeries)
      .set({ nextValue: sql`${numberSeries.nextValue} + 1` })
      .where(eq(numberSeries.key, "sales_order"))
      .returning({ prefix: numberSeries.prefix, value: sql<number>`${numberSeries.nextValue} - 1`, padTo: numberSeries.padTo });
    const [order] = await db
      .insert(documents)
      .values({
        type: "sales_order",
        number: series ? `${series.prefix}${String(series.value).padStart(series.padTo, "0")}` : null,
        status: "open",
        partnerId: border.id,
        partnerName: "Parkside Physio",
        reference: "PP-2291",
        docDate: today,
        dueDate: iso(daysAhead(10)),
        ownerId: second,
        subtotal: "1015.00",
        taxTotal: "101.50",
        total: "1116.50",
        fulfilment: "to_order",
        issuedAt: new Date(),
        xeroSyncState: "local_only",
        createdById: owner,
      })
      .returning({ id: documents.id });
    await db.insert(documentLines).values([
      { documentId: order.id, position: 0, itemId: banner.id, itemCode: banner.code, unit: banner.unit, tracksStock: true, description: banner.description!, quantity: "3", unitPrice: "295", taxType: "OUTPUT", taxRate: "10", lineAmount: "885.00", taxAmount: "88.50" },
      { documentId: order.id, position: 1, itemId: design.id, itemCode: design.code, unit: design.unit, description: "Banner artwork", quantity: "1", unitPrice: "130", taxType: "OUTPUT", taxRate: "10", lineAmount: "130.00", taxAmount: "13.00" },
    ]);

    // Purchasing: a supplier, and a draft PO raised for the order's banners
    // (sourceLineId), with a courier shipment on its way. The PO stays
    // `pending` — Xero numbers it once a demo organisation is connected.
    const [inkwell] = await db
      .insert(customers)
      .values({
        name: "Inkwell Print Co",
        status: "active",
        industry: "Printing",
        isCustomer: false,
        isSupplier: true,
        supplierTermsDays: 30,
        ownerId: owner,
      })
      .returning({ id: customers.id });
    await db.update(items).set({ preferredSupplierId: inkwell.id, purchasePrice: "140" }).where(eq(items.id, banner.id));
    const bannerLine = await db
      .select({ id: documentLines.id })
      .from(documentLines)
      .where(eq(documentLines.documentId, order.id))
      .orderBy(asc(documentLines.position))
      .limit(1);
    const [po] = await db
      .insert(documents)
      .values({
        type: "purchase_order",
        status: "draft",
        partnerId: inkwell.id,
        partnerName: "Inkwell Print Co",
        reference: `${series ? `${series.prefix}${String(series.value).padStart(series.padTo, "0")}` : "SO"} · Parkside Physio`,
        docDate: today,
        dueDate: iso(daysAhead(7)),
        ownerId: owner,
        salesOrderId: order.id,
        subtotal: "420.00",
        taxTotal: "42.00",
        total: "462.00",
        fulfilment: "to_receive",
        xeroSyncState: "pending",
        createdById: owner,
      })
      .returning({ id: documents.id });
    await db.insert(documentLines).values({
      documentId: po.id,
      position: 0,
      itemId: banner.id,
      itemCode: banner.code,
      unit: banner.unit,
      tracksStock: true,
      description: banner.description!,
      quantity: "3",
      unitPrice: "140",
      taxType: "INPUT",
      taxRate: "10",
      lineAmount: "420.00",
      taxAmount: "42.00",
      sourceLineId: bannerLine[0]?.id ?? null,
    });
    await db.update(documentLines).set({ qtyOrdered: "3" }).where(eq(documentLines.id, bannerLine[0].id));
    await db.update(documents).set({ fulfilment: "on_order" }).where(eq(documents.id, order.id));
    await db.insert(shipments).values({
      documentId: po.id,
      carrier: "startrack",
      trackingNumber: "INK0000123",
      trackingUrl: "https://startrack.com.au/track/details/INK0000123",
      shippedOn: today,
      eta: iso(daysAhead(3)),
      createdById: owner,
    });

    // A couple of saved views so the feature is discoverable rather than empty.
    await db.insert(savedViews).values([
      {
        entity: "leads",
        name: "Mine, still open",
        query: "owner=me&view=list",
        isShared: false,
        ownerId: owner,
        createdById: owner,
        position: 0,
      },
      {
        entity: "leads",
        name: "Everything in play",
        query: "stage=all&view=list",
        isShared: true,
        createdById: owner,
        position: 1,
      },
      {
        entity: "sales_orders",
        name: "Needs ordering",
        query: "fulfilment=to_order",
        isShared: true,
        createdById: owner,
        position: 0,
      },
      {
        entity: "customers",
        name: "Prospects",
        query: "status=prospect",
        isShared: true,
        createdById: owner,
        position: 0,
      },
    ]);

    console.log("Done. Demo data is in place.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
