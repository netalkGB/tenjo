import { Code2, FileText, Presentation, Sheet, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentCategory } from './types';

interface CategoryIconProps {
  category: AgentCategory | 'all';
  className?: string;
}

const ICON_MAP = {
  coding: Code2,
  document: FileText,
  slides: Presentation,
  spreadsheet: Sheet,
  all: Sparkles
} as const;

export function CategoryIcon({ category, className }: CategoryIconProps) {
  const Icon = ICON_MAP[category];
  return <Icon className={cn('size-4 text-muted-foreground', className)} />;
}
