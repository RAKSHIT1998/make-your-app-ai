import type { ProjectType } from '@mya/shared';
import { Boxes, Briefcase, Globe, LayoutDashboard, ShoppingBag, Smartphone, type LucideIcon } from 'lucide-react';

export interface ProjectTypeOption {
  type: ProjectType;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Whether AI generation is live for this type. Others are shown honestly as "coming soon". */
  available: boolean;
}

export const PROJECT_TYPE_OPTIONS: ProjectTypeOption[] = [
  { type: 'website', label: 'Website', description: 'Responsive, SEO-ready site built with Next.js', icon: Globe, available: true },
  { type: 'business_website', label: 'Business Website', description: 'Your company, services and contact', icon: Briefcase, available: true },
  { type: 'mobile_app', label: 'Mobile App', description: 'iOS and Android with React Native', icon: Smartphone, available: false },
  { type: 'ecommerce', label: 'Online Store', description: 'Catalog, cart, checkout and store admin', icon: ShoppingBag, available: false },
  { type: 'saas', label: 'SaaS Platform', description: 'Auth, subscriptions and dashboards', icon: LayoutDashboard, available: false },
  { type: 'custom_software', label: 'Custom Software', description: 'CRM, ERP, internal tools and APIs', icon: Boxes, available: false },
];

export const projectTypeOption = (t: string) => PROJECT_TYPE_OPTIONS.find((o) => o.type === t);
