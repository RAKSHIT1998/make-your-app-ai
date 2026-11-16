import type { ProjectDto, ProjectType, BusinessKit } from '@mya/shared';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { ChallengePhase, ShowcaseCard } from '@/lib/api';
import { ago, plural } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { Badge, Caption, H3, Icon, Row, StatusBadge, type IconName, type Tone } from './ui';

export const TYPE_META: Record<ProjectType, { label: string; icon: IconName; blurb: string }> = {
  website: { label: 'Website', icon: 'globe', blurb: 'Responsive, SEO-ready site' },
  business_website: { label: 'Business website', icon: 'briefcase', blurb: 'Services, team and enquiries' },
  ecommerce: { label: 'Online store', icon: 'shopping-bag', blurb: 'Products, cart and checkout' },
  saas: { label: 'Full-stack app', icon: 'layers', blurb: 'Sign-in, database and access rules' },
  custom_software: { label: 'Web app', icon: 'grid', blurb: 'Calculators, planners and trackers' },
  game: { label: 'Game', icon: 'play-circle', blurb: 'Playable HTML5 game' },
  mobile_app: { label: 'Mobile app', icon: 'smartphone', blurb: 'iOS and Android with Expo' },
};
/** Order on the Create screen. */
export const TYPE_ORDER: ProjectType[] = ['website', 'business_website', 'ecommerce', 'saas', 'custom_software', 'game', 'mobile_app'];

export const KIT_ICONS: Record<BusinessKit['icon'], IconName> = {
  contact: 'users', 'shopping-cart': 'shopping-cart', boxes: 'package', 'calendar-clock': 'calendar', receipt: 'file-text', 'life-buoy': 'life-buoy',
  plane: 'sun', utensils: 'coffee', dumbbell: 'activity', wrench: 'tool', bed: 'home',
};

export function BrandMark({ size = 40 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityLabel="Make Your App AI" style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.primaryFg, fontSize: size * 0.46, fontWeight: '800', letterSpacing: -1 }}>M</Text>
      <View style={{ position: 'absolute', right: size * 0.16, top: size * 0.16, width: size * 0.16, height: size * 0.16, borderRadius: size, backgroundColor: c.accent }} />
    </View>
  );
}

export function TypeTile({ type, size = 40 }: { type: ProjectType; size?: number }) {
  const { c, radius } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: radius.lg, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={TYPE_META[type]?.icon ?? 'box'} size={size * 0.45} />
    </View>
  );
}

export function ProjectRow({ project }: { project: ProjectDto }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push({ pathname: '/project/[id]', params: { id: project.id } })} accessibilityRole="button" accessibilityLabel={`Open ${project.name}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surfaceMuted : c.surface })}>
      <TypeTile type={project.type} />
      <View style={{ flex: 1, gap: 2 }}>
        <H3 numberOfLines={1}>{project.name}</H3>
        <Caption numberOfLines={1}>{TYPE_META[project.type]?.label ?? project.type} · {ago(project.updatedAt)}</Caption>
      </View>
      <StatusBadge status={project.status} />
    </Pressable>
  );
}

/** A colour swatch from the published palette, so cards differ without screenshots. */
function Swatch({ palette }: { palette: Record<string, string> | null }) {
  const { c, radius } = useTheme();
  const colours = Object.values(palette ?? {}).filter((v) => /^#[0-9a-f]{6}$/i.test(v)).slice(0, 4);
  return (
    <View style={{ height: 64, borderRadius: radius.lg, overflow: 'hidden', flexDirection: 'row', backgroundColor: c.surfaceMuted }}>
      {colours.length ? colours.map((col, i) => <View key={i} style={{ flex: i === 0 ? 3 : 1, backgroundColor: col }} />) : null}
    </View>
  );
}

export function ShowcaseTile({ item, onPress, footer }: { item: ShowcaseCard; onPress?: () => void; footer?: React.ReactNode }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  return (
    <Pressable onPress={onPress ?? (() => router.push({ pathname: '/p/[slug]', params: { slug: item.slug } }))} accessibilityRole="button" accessibilityLabel={`${item.title} by ${item.creator.name ?? 'a creator'}`}
      style={({ pressed }) => ({ padding: 12, gap: 10, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surfaceMuted : c.surface })}>
      <Swatch palette={item.palette} />
      <View style={{ gap: 4 }}>
        <Row>
          <H3 numberOfLines={1} style={{ flex: 1 }}>{item.title}</H3>
          {item.featured ? <Badge label="Featured" tone="accent" icon="star" /> : null}
        </Row>
        {item.description ? <Caption numberOfLines={2}>{item.description}</Caption> : null}
        <Row gap={12} style={{ marginTop: 2 }}>
          <Caption>{TYPE_META[item.type]?.label}</Caption>
          <Row gap={4}><Icon name="heart" size={13} color={c.textSubtle} /><Caption>{item.likes}</Caption></Row>
          <Row gap={4}><Icon name="git-branch" size={13} color={c.textSubtle} /><Caption>{item.remixes}</Caption></Row>
          {item.creator.name ? <Caption numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{item.creator.name}</Caption> : null}
        </Row>
      </View>
      {footer}
    </Pressable>
  );
}

export const PHASE: Record<ChallengePhase, [string, Tone]> = {
  draft: ['Draft', 'neutral'], upcoming: ['Coming up', 'info'], open: ['Open for entries', 'accent'], voting: ['Voting', 'warning'], ended: ['Ended', 'neutral'], cancelled: ['Cancelled', 'danger'],
};
export const PhaseBadge = ({ phase }: { phase: ChallengePhase }) => <Badge label={PHASE[phase][0]} tone={PHASE[phase][1]} />;
export const entriesText = (n: number) => plural(n, 'entry', 'entries');
