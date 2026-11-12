/**
 * Customer-facing policy DRAFTS. They state how the product actually behaves (as built) and leave legal identity
 * details for the company to complete. They claim no certifications. Have counsel review before launch.
 */
type Doc = { title: string; sections: [string, string][] };

const CO = '[Company legal name], [registered address], India';

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
      ['Changes and termination', 'We will give notice of material changes. You may close your account at any time. Governing law: India; courts of [city].'],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['Data we collect', 'Account data (email, name), workspace and project content you create, billing records (we never store card numbers — payments are processed by Razorpay or Stripe), usage records (AI tokens, credits) and security logs (IP address, actions).'],
      ['How we use it', 'To provide and secure the service, process payments, prevent abuse, provide support and meet legal obligations. Your prompts and project files are sent to AI model providers solely to generate your software.'],
      ['Processors', 'Supabase (authentication, database), AI model providers (e.g. Anthropic), Razorpay and Stripe (payments), and our cloud hosting providers. [Complete with the final list and regions.]'],
      ['Retention', 'Projects are retained while your account exists; expiring a subscription never deletes projects. Billing records are kept as required by law. You can request deletion of your account.'],
      ['Your rights', 'You can access, correct, export or delete your data, subject to legal retention requirements, by contacting [privacy@domain]. This policy is designed for India\'s Digital Personal Data Protection Act, 2023 and similar laws; [confirm with counsel].'],
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
      ['Subscriptions', 'You can cancel any time; your plan stays active until the end of the paid period. [State whether first-payment refunds are offered, e.g. within 7 days if fewer than N credits were used.]'],
      ['Credit top-ups', 'Purchased credits are non-refundable once used. Unused top-ups may be refunded within [N] days on request.'],
      ['Failed or duplicate charges', 'Duplicate or erroneous charges are refunded in full to the original payment method.'],
      ['How', 'Contact [billing@domain] with your invoice number (e.g. MYA-000123).'],
    ],
  },
  subscriptions: {
    title: 'Subscription Policy',
    sections: [
      ['Billing', 'Plans are billed monthly or yearly in advance through Razorpay (INR) or Stripe (other currencies). Prices include applicable taxes unless stated.'],
      ['Activation', 'A plan becomes active only after the payment provider confirms payment to our servers.'],
      ['Allowances', 'Each billing period grants the plan\'s AI credit allowance. Unused allowance expires at the end of the period. Purchased credits are used after the allowance.'],
      ['Upgrades and downgrades', 'Changing plan starts a new subscription immediately at the new price; the previous subscription stops renewing. [Proration is not currently applied.]'],
      ['Failed payments and expiry', 'If a renewal fails, the provider retries; if the subscription is halted or ends, your workspace moves to the Free plan. Projects are never deleted. If you have more active projects than the Free plan allows, they stay safe and viewable, but AI changes are paused until you archive projects or upgrade.'],
    ],
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL);
