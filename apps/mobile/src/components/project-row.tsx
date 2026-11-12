import type { ProjectDto } from '@mya/shared';
import { PROJECT_TYPE_LABELS } from '@mya/shared';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Card, StatusBadge } from './ui';

export function ProjectRow({ project }: { project: ProjectDto }) {
  const { c } = useTheme();
  return (
    <Link href={{ pathname: '/project/[id]', params: { id: project.id } }} asChild>
      <Pressable accessibilityRole="link">
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>{project.name}</Text>
            <Text style={{ color: c.textMuted, fontSize: 14 }}>{PROJECT_TYPE_LABELS[project.type]}</Text>
          </View>
          <StatusBadge status={project.status} />
        </Card>
      </Pressable>
    </Link>
  );
}
