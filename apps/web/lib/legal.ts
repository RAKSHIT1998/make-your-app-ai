/**
 * Customer-facing policy DRAFTS. They state how the product actually behaves (as built) and leave legal identity
 * details for the company to complete. They claim no certifications. Have counsel review before launch.
 */
type Doc = { title: string; sections: [string, string][] };

/** Company details come from configuration (NEXT_PUBLIC_LEGAL_*) — never invented. Missing values stay visibly marked. */
const env = (v: string | undefined, label: string) => (v && v.trim() ? v.trim() : `[${label} — to be completed]`);
export const LEGAL_INFO = {
  company: env(process.env.NEXT_PUBLIC_LEGAL_COMPANY, 'Company legal name'),
  address: env(process.env.NEXT_PUBLIC_LEGAL_ADDRESS, 'Registered address'),
  email: env(process.env.NEXT_PUBLIC_LEGAL_EMAIL, 'Contact email'),
  grievance: env(process.env.NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER, 'Grievance officer name and email'),
  jurisdiction: env(process.env.NEXT_PUBLIC_LEGAL_JURISDICTION, 'City for courts'),
  refundDays: env(process.env.NEXT_PUBLIC_LEGAL_REFUND_DAYS, 'Number of days'),
};
/** True once every company detail is configured; pages show a draft banner until then. */
export const LEGAL_COMPLETE = Object.values(LEGAL_INFO).every((v) => !v.startsWith('['));
const CO = `${LEGAL_INFO.company}, ${LEGAL_INFO.address}`;

export const LEGAL: Record<string, Doc> = {
  terms: {
    title: 'Terms of Service',
    sections: [
      ['Who we are', `Make Your App AI is operated by ${CO} ("we"). By creating an account you agree to these terms.`],
      ['Your account', 'You must provide accurate information and keep your credentials secure. You are responsible for activity in your workspaces. You must be legally able to enter into a contract.'],
      ['What you own', 'You own the projects, source code and content you create with the service, subject to third-party licences of included open-source components. You grant us a limited licence to host and process your content solely to provide the service.'],
      ['AI output', 'Generated code and content can contain errors. Review, test and take responsibility for what you publish. We do not guarantee that generated software is fit for a particular purpose, and we do not guarantee approval by Apple, Google or any other platform.'],
      ['Acceptable use', 'You must follow our Acceptable Use Policy. We may suspend accounts that break it.'],
      ['Plans, credits and payment', 'Paid plans renew automatically until cancelled. AI credits measure AI usage; monthly allowances do not roll over; purchased credits do not expire while your account is open. See the Subscription and Refund policies.'],
      ['Availability', 'We aim for high availability but provide the service "as is". Our total liability is limited to the fees you paid us in the 12 months before the claim, to the extent permitted by law.'],
      ['Changes and termination', `We will give notice of material changes. You may close your account at any time. Governing law: India; courts of ${LEGAL_INFO.jurisdiction}.`],
      ['Grievances', `Questions or complaints about content or the service: ${LEGAL_INFO.grievance}. We acknowledge complaints within 24 hours and aim to resolve them within 15 days.`],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['Data we collect', 'Account data (email, name), workspace and project content you create, billing records (we never store card numbers — payments are processed by Razorpay or Stripe), usage records (AI tokens, credits) and security logs (IP address, actions).'],
      ['How we use it', 'To provide and secure the service, process payments, prevent abuse, provide support and meet legal obligations. Your prompts and project files are sent to AI model providers solely to generate your software.'],
      ['Processors', 'Supabase (authentication, database), AI model providers (e.g. Anthropic), Razorpay and Stripe (payments), Vercel (hosting of websites you deploy) and our cloud hosting provider for the platform. Contact us for the current list and data locations.'],
      ['Retention', 'Projects are retained while your account exists; expiring a subscription never deletes projects. Billing records are kept as required by law. You can request deletion of your account.'],
      ['Your rights', `You can access, correct, export or delete your data, subject to legal retention requirements, by contacting ${LEGAL_INFO.email}. This policy is designed with India\'s Digital Personal Data Protection Act, 2023 in mind.`],
    ],
  },
  'acceptable-use': {
    title: 'Acceptable Use Policy',
    sections: [
      ['Not allowed', 'Malware, phishing or credential-harvesting sites; impersonating real organisations; fraud, scams or deceptive financial schemes; content that infringes intellectual property; harassment or targeting of individuals; sexual content involving minors; illegal goods or services; spam; attempts to break out of build sandboxes or attack our systems.'],
      ['Fair usage', 'Plans include usage limits (credits, daily limits, projects). Automated or excessive use designed to circumvent limits is not allowed.'],
      ['Enforcement', 'We may pause generation, suspend accounts or remove hosted content that violates this policy, and we keep an audit trail of such actions.'],
    ],
  },
  refunds: {
    title: 'Refund Policy',
    sections: [
      ['Subscriptions', `You can cancel any time; your plan stays active until the end of the paid period. A first subscription payment can be refunded within ${LEGAL_INFO.refundDays} days if you contact us and have used little of the plan; renewals are not refunded.`],
      ['Credit top-ups', `Purchased credits are non-refundable once used. Unused top-ups may be refunded within ${LEGAL_INFO.refundDays} days on request.`],
      ['Failed or duplicate charges', 'Duplicate or erroneous charges are refunded in full to the original payment method.'],
      ['How', `Contact ${LEGAL_INFO.email} with your invoice number (e.g. MYA-000123).`],
    ],
  },
  subscriptions: {
    title: 'Subscription Policy',
    sections: [
      ['Billing', 'Plans are billed monthly or yearly in advance through Razorpay (INR) or Stripe (other currencies). Prices include applicable taxes unless stated.'],
      ['Activation', 'A plan becomes active only after the payment provider confirms payment to our servers.'],
      ['Allowances', 'Each billing period grants the plan\'s AI credit allowance. Unused allowance expires at the end of the period. Purchased credits are used after the allowance.'],
      ['Upgrades and downgrades', 'Changing plan starts a new subscription immediately at the new price; the previous subscription stops renewing. Unused time on the previous plan is not prorated.'],
      ['Failed payments and expiry', 'If a renewal fails, the provider retries; if the subscription is halted or ends, your workspace moves to the Free plan. Projects are never deleted. If you have more active projects than the Free plan allows, they stay safe and viewable, but AI changes are paused until you archive projects or upgrade.'],
    ],
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL);
