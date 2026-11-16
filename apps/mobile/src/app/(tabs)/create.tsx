import { BUSINESS_KITS, COLOR_THEMES, businessKit, themeBrief, type ProjectType } from '@mya/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KIT_ICONS, TYPE_META, TYPE_ORDER } from '@/components/bits';
import { Badge, Body, Button, Caption, Card, Chip, ErrorText, Field, H1, H3, Icon, Muted, Overline, Row, Screen, Sheet, ToggleRow, toast } from '@/components/ui';
import { api, ApiError, billing } from '@/lib/api';
import { useTheme } from '@/lib/theme';

const STYLES = ['Minimal and clean', 'Bold and modern', 'Elegant and premium', 'Warm and friendly', 'Playful and colourful'];
const STRUCTURE = `\n\nWho it's for: \nPages / sections: \nStyle: \nMust-haves: `;
const PLACEHOLDER: Partial<Record<ProjectType, string>> = {
  website: 'A portfolio for a wedding photographer with packages, a gallery and an enquiry form',
  business_website: 'A website for our dental clinic with services, doctors and appointment enquiries',
  ecommerce: 'A premium dry fruit store with pack sizes, coupons and free delivery over ₹1,500',
  saas: 'A booking app for my salon: customers sign up, pick a service and a time slot',
  custom_software: 'A budget planner that tracks monthly expenses by category',
  game: 'A neon snake game with levels, power-ups and touch controls',
  mobile_app: 'A café app with our menu, opening hours and a table-booking request form',
};

export default function Create() {
  const { c, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ type?: string; kit?: string }>();
  const [type, setType] = useState<ProjectType>('website');
  const [idea, setIdea] = useState('');
  const [name, setName] = useState('');
  const [style, setStyle] = useState('');
  const [themeId, setThemeId] = useState('');
  const [planFirst, setPlanFirst] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [kitsOpen, setKitsOpen] = useState(false);
  const flags = useQuery({ queryKey: ['flags'], queryFn: api.flags });
  const overview = useQuery({ queryKey: ['billing'], queryFn: billing.overview });
  const estimate = useQuery({ queryKey: ['estimate'], queryFn: api.estimate });
  const allowed = new Set(overview.data?.entitlements.projectTypes ?? ['website', 'business_website']);
  const planAllowed = flags.data?.plan_first_builder !== false;
  const usePlan = planAllowed && planFirst;
  const theme = COLOR_THEMES.find((t) => t.id === themeId);

  // Deep links: /create?type=game, /create?kit=crm
  useEffect(() => {
    const kit = params.kit ? businessKit(params.kit) : undefined;
    if (kit) { setType('saas'); setIdea(kit.prompt); setName(kit.name); }
    else if (params.type && params.type in TYPE_META) setType(params.type as ProjectType);
  }, [params.type, params.kit]);

  const prompt = () => {
    const prefs = [style && `Visual style: ${style}`, theme && themeBrief(theme)].filter(Boolean).join('. ');
    return `${idea.trim()}${prefs ? `\n\nPreferences: ${prefs}.` : ''}`.slice(0, 8000);
  };
  const projectName = () => name.trim() || idea.trim().split(/[.,\n]/)[0]!.slice(0, 60) || 'Untitled project';

  const create = useMutation({
    mutationFn: async () => {
      const project = await api.createProject({ name: projectName(), type, description: idea.trim().slice(0, 4000) });
      try {
        await api.generate(project.id, prompt(), { mode: usePlan ? 'plan' : 'build' });
      } catch (e) {
        // The project exists even if the build couldn't start: open it so the person can retry from there.
        router.push({ pathname: '/project/[id]', params: { id: project.id } });
        throw e;
      }
      return project;
    },
    onSuccess: (p) => {
      setConfirm(false);
      setIdea(''); setName(''); setStyle(''); setThemeId('');
      for (const k of ['projects', 'activity', 'billing', 'credits', 'estimate']) void qc.invalidateQueries({ queryKey: [k] });
      router.push({ pathname: '/project/[id]', params: { id: p.id } });
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(e instanceof Error ? e.message : 'Could not start building.');
    },
  });

  const valid = idea.trim().length >= 10;
  const typical = estimate.data?.typical.create;
  const balance = estimate.data?.balance ?? overview.data?.credits.total;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView testID="create" contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, gap: 22, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 4 }}>
            <H1>Create</H1>
            <Muted>Pick what you're making, then describe it in your own words.</Muted>
          </View>

          <View style={{ gap: 10 }}>
            <Overline>What are you building?</Overline>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {TYPE_ORDER.map((t) => {
                const on = type === t;
                const locked = !!overview.data && !allowed.has(t);
                return (
                  <Pressable key={t} onPress={() => setType(t)} disabled={locked} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: locked }} accessibilityLabel={`${TYPE_META[t].label}${locked ? ', not included in your plan' : ''}`}
                    style={{ width: '48%', flexGrow: 1, padding: 12, gap: 6, borderRadius: radius.xl, borderWidth: on ? 2 : 1, borderColor: on ? c.primary : c.border, backgroundColor: c.surface, opacity: locked ? 0.5 : 1 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Icon name={TYPE_META[t].icon} size={20} />
                      {locked ? <Icon name="lock" size={14} color={c.textSubtle} /> : on ? <Icon name="check-circle" size={16} color={c.accent} /> : null}
                    </Row>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 15 }}>{TYPE_META[t].label}</Text>
                    <Caption numberOfLines={2}>{locked ? 'Not included in your plan' : TYPE_META[t].blurb}</Caption>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {type === 'saas' ? (
            <Card onPress={() => setKitsOpen(true)} accessibilityLabel="Start from a business kit">
              <Row gap={12}>
                <Icon name="package" size={20} />
                <View style={{ flex: 1 }}><H3>Start from a business kit</H3><Caption>CRM, point of sale, inventory, bookings, hotel desk and more</Caption></View>
                <Icon name="chevron-right" color={c.textSubtle} />
              </Row>
            </Card>
          ) : null}

          <View style={{ gap: 8 }}>
            <Field label="Your idea" value={idea} onChangeText={setIdea} multiline maxLength={8000} placeholder={PLACEHOLDER[type]}
              hint={idea.length > 0 && !valid ? 'A little more detail helps.' : 'Who it is for, what it must do, and the feel you want.'} />
            <Row gap={8} wrap>
              <Chip label="Add structure" icon="list" onPress={() => setIdea((v) => (v.includes("Who it's for:") ? v : `${v.trimEnd()}${STRUCTURE}`))} />
            </Row>
          </View>

          <Field label="Project name" value={name} onChangeText={setName} placeholder="Optional — we'll suggest one" maxLength={80} />

          <View style={{ gap: 10 }}>
            <Overline>Visual style</Overline>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label="Let AI decide" selected={!style} onPress={() => setStyle('')} />
              {STYLES.map((s) => <Chip key={s} label={s} selected={style === s} onPress={() => setStyle(style === s ? '' : s)} />)}
            </ScrollView>
          </View>

          <View style={{ gap: 10 }}>
            <Overline>Colour theme</Overline>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {COLOR_THEMES.map((t) => {
                const on = t.id === themeId;
                return (
                  <Pressable key={t.id} onPress={() => setThemeId(on ? '' : t.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${t.name} colour theme`}
                    style={{ width: 120, padding: 8, gap: 6, borderRadius: radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? c.primary : c.border, backgroundColor: c.surface }}>
                    <View style={{ height: 34, flexDirection: 'row', borderRadius: radius.md, overflow: 'hidden' }}>{t.colors.map((col) => <View key={col.hex} style={{ flex: 1, backgroundColor: col.hex }} />)}</View>
                    <Text numberOfLines={1} style={{ color: c.text, fontSize: 13, fontWeight: '600' }}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {planAllowed ? (
            <Card style={{ paddingVertical: 6 }}>
              <ToggleRow label="Plan first" hint="See a plan and answer a few questions before any code is written." value={planFirst} onChange={setPlanFirst} />
            </Card>
          ) : null}

          <Button title={usePlan ? 'Draft the plan' : 'Build it'} icon={usePlan ? 'map' : 'zap'} onPress={() => setConfirm(true)} disabled={!valid} full />
          {flags.data?.ai_generation === false ? <Caption>Building is paused for maintenance right now. Your idea is kept here.</Caption> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title={usePlan ? 'Draft a plan?' : 'Start building?'}>
        <Card style={{ gap: 6 }}>
          <Row><Badge label={TYPE_META[type].label} icon={TYPE_META[type].icon} /><Caption numberOfLines={1} style={{ flex: 1 }}>{projectName()}</Caption></Row>
          <Body numberOfLines={4}>{idea.trim()}</Body>
        </Card>
        <Muted>
          {usePlan
            ? 'The AI drafts pages, data and a few questions first. Planning uses a small number of credits; you decide before anything is built.'
            : typical ? `Builds like this usually use about ${typical.median} credits (up to ${typical.p90}).` : 'Credits are charged for the AI work actually done.'}
          {balance !== undefined ? ` You have ${balance.toLocaleString()} credits.` : ''}
        </Muted>
        <Caption>Where facts are unknown we use clearly marked placeholders, never invented reviews or numbers.</Caption>
        <ErrorText error={create.error instanceof ApiError && create.error.status === 402 ? new Error("You don't have enough credits for this right now.") : null} />
        <Button title={usePlan ? 'Draft the plan' : 'Start building'} onPress={() => create.mutate()} loading={create.isPending} full />
      </Sheet>

      <Sheet open={kitsOpen} onClose={() => setKitsOpen(false)} title="Business kits">
        <Muted>A detailed brief for a team-only app. Edit it with your business details before building.</Muted>
        {BUSINESS_KITS.map((k) => (
          <Card key={k.id} onPress={() => { setIdea(k.prompt); setName(k.name); setKitsOpen(false); }} accessibilityLabel={`Use the ${k.name} kit`}>
            <Row gap={12}>
              <View style={{ width: 38, height: 38, borderRadius: radius.md, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}><Icon name={KIT_ICONS[k.icon]} /></View>
              <View style={{ flex: 1, gap: 2 }}><H3>{k.name}</H3><Caption numberOfLines={2}>{k.tagline}</Caption></View>
            </Row>
          </Card>
        ))}
      </Sheet>
    </Screen>
  );
}
