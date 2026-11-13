import type { ProjectType } from '@mya/shared';
import { Boxes, Briefcase, Gamepad2, Globe, LayoutDashboard, ShoppingBag, Smartphone, type LucideIcon } from 'lucide-react';

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
  { type: 'mobile_app', label: 'Mobile App', description: 'iOS and Android with React Native (Expo)', icon: Smartphone, available: true },
  { type: 'game', label: 'Game', description: 'Playable HTML5 game that runs in any browser', icon: Gamepad2, available: true },
  { type: 'custom_software', label: 'Web App', description: 'Calculators, planners and trackers that run in the browser', icon: Boxes, available: true },
  { type: 'ecommerce', label: 'Online Store', description: 'Catalog, cart, checkout and store admin', icon: ShoppingBag, available: false },
  { type: 'saas', label: 'Full-stack App', description: 'Sign-up and login, a real database and access rules', icon: LayoutDashboard, available: true },
];

export const projectTypeOption = (t: string) => PROJECT_TYPE_OPTIONS.find((o) => o.type === t);
